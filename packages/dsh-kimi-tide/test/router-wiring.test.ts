import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import {
  DEFAULT_CONFIG_V4,
  DEFAULT_CONFIG_V5,
  type CandidateMeta,
  type RouteTarget,
  type RouterConfigV4,
  type RouterConfigV5,
} from '../src/config.js'
import { ImageStateStore } from '../src/image-state.js'
import {
  createStreamVisionCaller,
  extractResolvedImages,
  installRouter,
  KimiRouter,
  type RouteDecision,
} from '../src/router.js'
import { Transcriber, type ResolvedImage, type VisionCaller } from '../src/transcribe.js'

/**
 * Integration tests for installRouter against the VERIFIED dsh-agent-loop
 * event contract (rc.6 and rc.7 identical; anchors in
 * dsh-agent-loop/lib/index.js):
 *
 *   - `turn()` computes `const step = phase.step + 1` BEFORE calling
 *     `preStep()`, and every turn starts with `phase.step = 0`
 *     (wakeDriver init + turn-boundary reset) → the first model step of
 *     every turn arrives as payload.step === 1. It is NEVER 0.
 *   - `agentEvents()` (dsh-agent) injects `payload.agent` into every
 *     agent-scoped event payload.
 *
 * Regression (2026-08-18): the original gate `payload.step === 0` never
 * matched, so no decision slot was ever written and the whole router
 * (explicit @kimi, image guard, budget, escalation) idled in production.
 *
 * 0.6.0（Task 9）：installRouter 第三参改 deps 对象（images/transcriber/
 * resolveImages/onDecision）；hasImage 语义 = 本轮未转述图；布尔锁存
 * imageSeen 退役，按图状态表 + imageFallback 接管跨轮锁存。图块线形按
 * rc.2 实证（spike S1）：`{ type:'image', attachment: ImageAttachmentRef }`。
 */

const METAS: CandidateMeta[] = [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], available: true },
  { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available: true },
  { provider: 'kimi-coding', model: 'kimi-for-coding', modalities: ['text', 'image'], available: true },
]

/** 含 rc.2 视觉试验模型的候选池（协作流测试用）。 */
const FLOW_METAS: CandidateMeta[] = [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], available: true },
  { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', modalities: ['text', 'image'], available: true },
  { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available: true },
]

const VISION_EXP: RouteTarget = { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' }

/**
 * v4 配置夹具：省钱预设 + 自定义 review 关键词组规则（目标 k3）——保留旧
 * v1 夹具 `escalateWhen.patterns: ['审查'] → premium(k3)` 的断言语义，
 * 配置词汇改 v4（预设/规则/关键词组）。
 */
const CONFIG = (): RouterConfigV4 => {
  const c = DEFAULT_CONFIG_V4()
  c.activePreset = 'saving'
  c.keywordGroups.review = ['审查']
  c.presets.saving.rules.unshift({
    id: 'review-k3',
    when: { kind: 'keywords', group: 'review' },
    target: { provider: 'kimi-coding', model: 'k3' },
  })
  return c
}

/** v5 夹具：省钱预设的 image 规则改挂 transcribe 流（eager 转述姿态）。 */
const FLOW_CONFIG = (): RouterConfigV5 => {
  const c = DEFAULT_CONFIG_V5()
  c.activePreset = 'saving'
  c.presets.saving.rules = [{ id: 'image-flow', when: { kind: 'image' }, target: { flow: 'transcribe' } }]
  return c
}

// 与省钱预设默认（deepseek-official/deepseek-v4-flash）不同的哨兵路由：
// 打底语义下「普通任务」route 到预设默认，若 baseConfig 与预设默认相同，
// `toEqual(baseConfig)` 会失去 route/keep 判别力（评审建议，T3 延期 Minor）。
const baseConfig = { provider: 'sentinel-provider', model: 'sentinel-model' }
const SAVING_DEFAULT = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

interface Listener {
  (payload: unknown, next: () => Promise<unknown>): Promise<unknown>
}

type StreamListener = (options: unknown, next: () => AsyncIterable<unknown>) => AsyncIterable<unknown>

function makeCtx() {
  const listeners = new Map<string, Listener[]>()
  const streamListeners: StreamListener[] = []
  const logs: string[] = []
  /** llm/stream 瀑布终点（伪适配器）收到的 options，按到达序记录。 */
  const adapterCalls: unknown[] = []
  const ctx = {
    logger: { info: (message: string) => logs.push(message) },
    effect: (execute: () => unknown) => {
      execute()
      return () => {}
    },
    on: (name: string, listener: Listener | StreamListener) => {
      if (name === 'llm/stream') {
        streamListeners.push(listener as StreamListener)
        return () => {}
      }
      const arr = listeners.get(name) ?? []
      arr.push(listener as Listener)
      listeners.set(name, arr)
      return () => {}
    },
    llm: {
      /**
       * 伪 LlmRuntime.stream：走 llm/stream 瀑布后到达终点。
       * cordis waterfall 语义（lib/index.js:317-325）：next() 回放原始载荷，
       * 链终值 = 首个不调用 next 的监听器的返回值（短路自派由此成立）。
       */
      stream: (options: unknown): AsyncIterable<unknown> => {
        const walk = (i: number): AsyncIterable<unknown> =>
          i >= streamListeners.length
            ? (adapterCalls.push(options), fakeAdapterStream())
            : streamListeners[i](options, () => walk(i + 1))
        return walk(0)
      },
    },
  }
  const dispatch = {
    async preStep(payload: object): Promise<unknown> {
      let result: unknown = { kind: 'enter' }
      for (const listener of listeners.get('agent/pre-step') ?? []) {
        result = await listener(payload, () => Promise.resolve(result))
      }
      return result
    },
    async request(payload: object, base: object): Promise<unknown> {
      let result: unknown = base
      for (const listener of listeners.get('agent/request') ?? []) {
        result = await listener(payload, () => Promise.resolve(result))
      }
      return result
    },
    /**
     * Host prompt pre-check deferral: mirrors cordis `serial` bail semantics
     * (EventsService.serial) — listeners run in order; the first bail value
     * (non-null/false/undefined) wins; no listener → undefined (reject).
     */
    async admission(payload: object): Promise<unknown> {
      for (const listener of listeners.get('agent/image-admission') ?? []) {
        const result = await listener(payload, () => Promise.resolve(undefined))
        if (result !== null && result !== false && result !== undefined) return result
      }
      return undefined
    },
  }
  return { ctx, dispatch, logs, adapterCalls }
}

/** 伪适配器流：一个 text-delta + finish(stop)。 */
async function* fakeAdapterStream(): AsyncGenerator<unknown> {
  yield { type: 'text-delta', index: 0, text: 'ok' }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** 耗尽流（拦截器测试只关心终态载荷，逐块消费防挂起）。 */
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) { /* discard */ }
}

/** Opaque agent identity — agentEvents() injects it as payload.agent. */
const agent = {}

function signal(): AbortSignal {
  return new AbortController().signal
}

function textMessage(text: string): UserMessage {
  return { role: 'user', content: [{ type: 'text', text }] } as unknown as UserMessage
}

/** rc.2 图块线形（spike S1 实证）：ImageBlock.attachment = 持久引用。 */
function imageRef(id: string) {
  return { attachmentId: id, mediaType: 'image/png', bytes: 4, width: 1, height: 1 }
}

function imageMessage(text: string, id = 'att-1'): UserMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }, { type: 'image', attachment: imageRef(id) }],
  } as unknown as UserMessage
}

/** 测试侧 resolveImages：从消息图块提取 {attachmentId, ref}（生产实现同形，另有单测）。 */
function testResolveImages(messages: readonly UserMessage[]): ResolvedImage[] {
  const out: ResolvedImage[] = []
  for (const message of messages) {
    for (const block of message.content) {
      const b = block as { type?: string; attachment?: { attachmentId?: unknown } }
      if (b?.type === 'image' && typeof b.attachment?.attachmentId === 'string') {
        out.push({ attachmentId: b.attachment.attachmentId, ref: b.attachment })
      }
    }
  }
  return out
}

interface DepsFixture {
  deps: {
    images: ImageStateStore
    transcriber: Transcriber
    resolveImages: (messages: readonly UserMessage[]) => ResolvedImage[]
    onDecision?: (agent: unknown, decision: RouteDecision, extra?: { flowId?: string }) => void
  }
  images: ImageStateStore
  transcriber: Transcriber
  callerCalls: Array<{ target: RouteTarget; prompt: string; images: readonly ResolvedImage[] }>
  decisions: Array<{ decision: RouteDecision; extra?: { flowId?: string } }>
}

/** installRouter 0.6.0 deps 夹具：真实 ImageStateStore + 真实 Transcriber（caller 可注入）。 */
function makeDeps(caller?: VisionCaller): DepsFixture {
  const images = new ImageStateStore()
  const callerCalls: DepsFixture['callerCalls'] = []
  const decisions: DepsFixture['decisions'] = []
  const transcriber = new Transcriber({
    caller: caller ?? (async (target, prompt, imgs) => {
      callerCalls.push({ target, prompt, images: imgs })
      return '转述文字'
    }),
  })
  return {
    images,
    transcriber,
    callerCalls,
    decisions,
    deps: {
      images,
      transcriber,
      resolveImages: testResolveImages,
      onDecision: (_agent, decision, extra) => { decisions.push({ decision, extra }) },
    },
  }
}

describe('installRouter step contract (regression: step===0 gate idled the router)', () => {
  it('routes @kimi on the first model step exactly as dsh-agent-loop sends it (payload.step === 1)', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }), makeDeps().deps)

    await dispatch.preStep({ agent, messages: [textMessage('@kimi 请审查这段代码')], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    expect(config).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
  })

  it('escalates on pattern match at the first step of the turn', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }), makeDeps().deps)

    await dispatch.preStep({ agent, messages: [textMessage('请审查一下这个实现')], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    expect(config).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
  })

  it('does not re-decide inside the tool loop (step > 1 leaves the logged config alone)', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }), makeDeps().deps)

    // Realistic loop shape: pre-step(1) → request(1) → pre-step(2) → request(2).
    await dispatch.preStep({ agent, messages: [textMessage('普通任务')], turn: 1, step: 1, signal: signal() })
    const first = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)
    expect(first).toEqual(SAVING_DEFAULT) // 未命中规则 → 打底路由到预设默认（≠ baseConfig，判别力）

    await dispatch.preStep({ agent, messages: [], turn: 1, step: 2, signal: signal() })
    const second = await dispatch.request({ agent, turn: 1, step: 2, signal: signal() }, baseConfig)

    expect(second).toEqual(baseConfig)
  })
})

describe('installRouter image guard (direction: text-only primary → multimodal Kimi)', () => {
  it('reroutes an image-bearing keep step from the text-only primary to premium', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }), makeDeps().deps)

    // '看图说话' 不命中关键词规则，但带图命中省钱预设的 image 规则 → k3；
    // request 侧护栏作为兜底仍在（目标已多模态时不再改道）。
    await dispatch.preStep({ agent, messages: [imageMessage('看图说话')], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    expect(config).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
  })

  it('leaves an image-bearing step already routed to multimodal Kimi untouched', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }), makeDeps().deps)

    await dispatch.preStep({ agent, messages: [imageMessage('@kimi 看这张图')], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    expect(config).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
  })
})

describe('installRouter session image latch (regression: text turn after an image turn must stay multimodal)', () => {
  // 2026-08-19 real-session regression: turn 3 committed an image message
  // (routed to kimi-coding/k3 by the step-scoped guard); turn 4 carried only
  // text, so the per-step guard did not fire, the request went to
  // deepseek-v4-flash, and dsh-llm-deepseek's serializeMessages rejected the
  // FULL conversation (which still holds the image block) with
  // UNSUPPORTED_CONTENT. The agent/pre-step payload only carries the claimed
  // (current-turn) messages — dsh-agent-loop preStep(): `messages: claimed` —
  // so once an image enters the session history the router must latch the
  // agent onto a multimodal candidate for every later turn.
  //
  // 0.6.0（Task 9）：锁存由「按图状态表 + imageFallback latch 改道」实现——
  // 图轮登记 native（latchTarget=本轮有效视觉候选），后续文本轮 decide 落
  // text-only 默认时改道 latchTarget，与 0.5.0 布尔锁存逐字节同效。
  it('keeps a later text-only turn on the multimodal route after an image turn', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }), makeDeps().deps)

    await dispatch.preStep({ agent, messages: [imageMessage('看图说话')], turn: 1, step: 1, signal: signal() })
    const first = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)
    expect(first).toMatchObject({ provider: 'kimi-coding', model: 'k3' })

    // Next turn: plain text only — the image is still in the session history,
    // so routing back to the text-only deepseek adapter would throw
    // UNSUPPORTED_CONTENT. The latch must keep this turn multimodal.
    await dispatch.preStep({ agent, messages: [textMessage('继续')], turn: 2, step: 1, signal: signal() })
    const second = await dispatch.request({ agent, turn: 2, step: 1, signal: signal() }, baseConfig)
    expect(second).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
  })

  it('latch is per-agent: a fresh agent with no image history routes normally', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }), makeDeps().deps)

    const other = {}
    await dispatch.preStep({ agent: other, messages: [textMessage('普通任务')], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent: other, turn: 1, step: 1, signal: signal() }, baseConfig)
    expect(config).toEqual(SAVING_DEFAULT) // 打底路由到预设默认（≠ baseConfig，判别力）
  })
})

describe('installRouter image admission probe (host prompt pre-check deferral)', () => {
  // Regression (2026-08-18, b66ee0d follow-up): the host prompt admission
  // gate rejects image prompts whose current model selection is text-only
  // BEFORE the agent loop runs, so a fresh session (default = text-only
  // deepseek) never reaches the per-step image guard. The host patch defers
  // via `agent/image-admission` (cordis serial bail): installRouter must
  // claim (truthy) only when it can actually reroute the image.

  it('claims image admission when the router is active and the pool holds a multimodal candidate', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }), makeDeps().deps)

    expect(await dispatch.admission({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })).toBe(true)
  })

  it('leaves the host rejection in charge when the pool holds no multimodal candidate', async () => {
    const { ctx, dispatch } = makeCtx()
    const textOnlyMetas = METAS.map((m) => ({ ...m, modalities: ['text'] }))
    installRouter(ctx as never, new KimiRouter(CONFIG(), textOnlyMetas, { info: () => {} }), makeDeps().deps)

    expect(await dispatch.admission({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })).toBeUndefined()
  })

  it('does not claim when the router is not mounted (activePreset null)', async () => {
    const { ctx, dispatch } = makeCtx()
    const off = CONFIG()
    off.activePreset = null
    installRouter(ctx as never, new KimiRouter(off, METAS, { info: () => {} }), makeDeps().deps)

    expect(await dispatch.admission({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })).toBeUndefined()
  })
})

describe('installRouter 协作编排：eager 转述（image 规则挂 transcribe 流）', () => {
  it('①本轮新图命中 transcribe 流 → pre-step 内转述 → 请求落文本默认模型（decide 以 hasImage=false 重跑）', async () => {
    const { ctx, dispatch } = makeCtx()
    const fx = makeDeps()
    installRouter(ctx as never, new KimiRouter(FLOW_CONFIG(), FLOW_METAS, { info: () => {} }), fx.deps)

    await dispatch.preStep({ agent, messages: [imageMessage('看这个报错截图')], turn: 1, step: 1, signal: signal() })

    // pre-step 内完成转述：caller 被调一次，目标 = flow.visionModel，图块原样送达
    expect(fx.callerCalls).toHaveLength(1)
    expect(fx.callerCalls[0].target).toEqual(VISION_EXP)
    expect(fx.callerCalls[0].images).toEqual([{ attachmentId: 'att-1', ref: imageRef('att-1') }])
    // 状态表标 transcribed
    expect(fx.images.get(agent as never, 'att-1')?.state).toBe('transcribed')
    // onDecision 携带 flowId
    expect(fx.decisions).toHaveLength(1)
    expect(fx.decisions[0].extra).toEqual({ flowId: 'transcribe' })

    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)
    // decide 以 hasImage=false 重跑：image 规则不再命中 → 落预设默认文本模型；
    // 若未重跑，决策停留 flow → applyTo 不动 → config 仍是哨兵 baseConfig。
    expect(config).toEqual(SAVING_DEFAULT)
  })

  it('②转述失败（failurePolicy latch-image）→ 该图保持 native 且本轮落 flow.visionModel 原生视觉作答', async () => {
    const { ctx, dispatch } = makeCtx()
    const fx = makeDeps(async () => { throw new Error('vision down') })
    installRouter(ctx as never, new KimiRouter(FLOW_CONFIG(), FLOW_METAS, { info: () => {} }), fx.deps)

    await dispatch.preStep({ agent, messages: [imageMessage('看这个报错截图')], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    expect(config).toMatchObject(VISION_EXP)
    const entry = fx.images.get(agent as never, 'att-1')
    expect(entry?.state).toBe('native')
    expect(entry?.latchTarget).toEqual(VISION_EXP)
    expect(fx.decisions[0].extra).toEqual({ flowId: 'transcribe' })
  })

  it('②b 转述失败（failurePolicy blind）→ 该图标 blind，放行文本默认模型', async () => {
    const { ctx, dispatch } = makeCtx()
    const fx = makeDeps(async () => { throw new Error('vision down') })
    const config = FLOW_CONFIG()
    const flow = config.flows.transcribe
    if (flow.type !== 'transcribe') throw new Error('fixture')
    flow.failurePolicy = 'blind'
    installRouter(ctx as never, new KimiRouter(config, FLOW_METAS, { info: () => {} }), fx.deps)

    await dispatch.preStep({ agent, messages: [imageMessage('看这个报错截图')], turn: 1, step: 1, signal: signal() })
    const cfg = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    expect(cfg).toEqual(SAVING_DEFAULT)
    expect(fx.images.get(agent as never, 'att-1')?.state).toBe('blind')
  })
})

describe('installRouter 协作编排：lazy 转述（imageFallback = transcribe-lazy）', () => {
  it('③带图轮原生视觉作答不动；后续文本轮先补转述再放行文本目标', async () => {
    const { ctx, dispatch } = makeCtx()
    const fx = makeDeps()
    const config = DEFAULT_CONFIG_V5()
    config.activePreset = 'saving'
    // 正典 lazy 配置：image 规则 → k3（带图轮原生视觉），imageFallback 懒转述
    config.presets.saving.imageFallback = 'transcribe-lazy'
    installRouter(ctx as never, new KimiRouter(config, FLOW_METAS, { info: () => {} }), fx.deps)

    // Turn 1 带图：image 规则 → k3 原生作答，不触发转述
    await dispatch.preStep({ agent, messages: [imageMessage('看图说话')], turn: 1, step: 1, signal: signal() })
    const first = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)
    expect(first).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
    expect(fx.callerCalls).toHaveLength(0)
    expect(fx.images.get(agent as never, 'att-1')?.state).toBe('native')

    // Turn 2 纯文本：历史 native 图面对 text-only 默认目标 → 先转述再放行
    await dispatch.preStep({ agent, messages: [textMessage('继续')], turn: 2, step: 1, signal: signal() })
    expect(fx.callerCalls).toHaveLength(1)
    expect(fx.callerCalls[0].target).toEqual(VISION_EXP)
    expect(fx.images.get(agent as never, 'att-1')?.state).toBe('transcribed')
    const second = await dispatch.request({ agent, turn: 2, step: 1, signal: signal() }, baseConfig)
    expect(second).toEqual(SAVING_DEFAULT)

    // Turn 3 纯文本：已转述（缓存命中），caller 不再重打，仍放行文本目标
    await dispatch.preStep({ agent, messages: [textMessage('再说说')], turn: 3, step: 1, signal: signal() })
    const third = await dispatch.request({ agent, turn: 3, step: 1, signal: signal() }, baseConfig)
    expect(third).toEqual(SAVING_DEFAULT)
    expect(fx.callerCalls).toHaveLength(1)
  })
})

describe('llm/stream 智能投影拦截器（S4c，spike 实证范式）', () => {
  /** 预置转述缓存：att-1 → '转述文字'。 */
  async function seeded() {
    const fx = makeDeps()
    const flow = DEFAULT_CONFIG_V5().flows.transcribe
    if (flow.type !== 'transcribe') throw new Error('fixture')
    await fx.transcriber.text(flow, { attachmentId: 'att-1', ref: imageRef('att-1') })
    const { ctx, adapterCalls } = makeCtx()
    installRouter(ctx as never, new KimiRouter(FLOW_CONFIG(), FLOW_METAS, { info: () => {} }), fx.deps)
    return { fx, ctx, adapterCalls }
  }

  function streamMessages() {
    return [
      {
        role: 'user',
        content: [
          { type: 'text', text: '问题' },
          { type: 'image', attachment: imageRef('att-1') }, // 已转述
          { type: 'image', attachment: imageRef('att-2') }, // 无缓存（native）
        ],
      },
    ]
  }

  it('text-only 目标：命中转述缓存的图块被替换为文本块，无缓存图块保留 native', async () => {
    const { ctx, adapterCalls } = await seeded()
    const messages = streamMessages()
    await drain((ctx.llm as { stream: (o: unknown) => AsyncIterable<unknown> }).stream({
      provider: 'deepseek-official', model: 'deepseek-v4-flash', messages,
    }))

    expect(adapterCalls).toHaveLength(1)
    const sent = (adapterCalls[0] as { messages: Array<{ content: Array<Record<string, unknown>> }> }).messages
    expect(sent[0].content[1]).toEqual({ type: 'text', text: '转述文字' })
    expect(sent[0].content[2]).toEqual({ type: 'image', attachment: imageRef('att-2') })
    // 绝不原地 mutation：新数组/新块
    expect(sent).not.toBe(messages)
    expect(sent[0].content).not.toBe(messages[0].content)
    expect(messages[0].content[1]).toEqual({ type: 'image', attachment: imageRef('att-1') })
  })

  it('视觉目标直放（不改写，零分配传递原始引用）', async () => {
    const { ctx, adapterCalls } = await seeded()
    const messages = streamMessages()
    await drain((ctx.llm as { stream: (o: unknown) => AsyncIterable<unknown> }).stream({
      provider: 'kimi-coding', model: 'k3', messages,
    }))

    expect(adapterCalls).toHaveLength(1)
    expect((adapterCalls[0] as { messages: unknown }).messages).toBe(messages)
  })

  it('无缓存图块不重写：text-only 目标但全部图块无缓存 → 原始引用直放', async () => {
    const { ctx, adapterCalls } = await seeded()
    const messages = [
      { role: 'user', content: [{ type: 'image', attachment: imageRef('att-2') }] },
    ]
    await drain((ctx.llm as { stream: (o: unknown) => AsyncIterable<unknown> }).stream({
      provider: 'deepseek-official', model: 'deepseek-v4-flash', messages,
    }))

    expect(adapterCalls).toHaveLength(1)
    expect((adapterCalls[0] as { messages: unknown }).messages).toBe(messages)
  })

  it('短路自派不递归：改写恰好一次，适配器只见改写后载荷', async () => {
    const { ctx, adapterCalls } = await seeded()
    const messages = streamMessages()
    await drain((ctx.llm as { stream: (o: unknown) => AsyncIterable<unknown> }).stream({
      provider: 'deepseek-official', model: 'deepseek-v4-flash', messages,
    }))
    // 重入守卫：自派的 opts2 再入瀑布时被守卫放行到 next()——若递归则栈溢出/计数失真
    expect(adapterCalls).toHaveLength(1)
    const sent = adapterCalls[0] as { messages: Array<{ content: Array<Record<string, unknown>> }> }
    expect(sent.messages[0].content[1]).toEqual({ type: 'text', text: '转述文字' })
  })

  it('tool-result 嵌套图块递归同款处理', async () => {
    const { ctx, adapterCalls } = await seeded()
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'image', attachment: imageRef('att-1') }] },
        ],
      },
    ]
    await drain((ctx.llm as { stream: (o: unknown) => AsyncIterable<unknown> }).stream({
      provider: 'deepseek-official', model: 'deepseek-v4-flash', messages,
    }))

    expect(adapterCalls).toHaveLength(1)
    const sent = (adapterCalls[0] as { messages: Array<{ content: Array<{ content: Array<Record<string, unknown>> }> }> }).messages
    expect(sent[0].content[0].content[0]).toEqual({ type: 'text', text: '转述文字' })
  })
})

describe('布尔锁存退役', () => {
  it('⑤router.ts 不再引用 imageSeen（状态表替代布尔锁存）', async () => {
    const { readFile } = await import('node:fs/promises')
    const src = await readFile(new URL('../src/router.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('imageSeen')
  })
})

describe('extractResolvedImages（生产图块提取，spike S1 线形）', () => {
  it('从 user 消息提取 {attachmentId, ref}，ref 按身份原样直传', () => {
    const messages = [imageMessage('看图', 'att-9')]
    const out = extractResolvedImages(messages)
    expect(out).toHaveLength(1)
    expect(out[0].attachmentId).toBe('att-9')
    const block = (messages[0].content[1] as { attachment: unknown }).attachment
    expect(out[0].ref).toBe(block)
  })

  it('递归提取 tool-result 嵌套图块；无 attachmentId 的图块忽略', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'image', attachment: imageRef('att-t') }] },
        ],
      },
      { role: 'user', content: [{ type: 'image' }] }, // 无线形 ref → 忽略
    ] as unknown as UserMessage[]
    const out = extractResolvedImages(messages)
    expect(out).toEqual([{ attachmentId: 'att-t', ref: imageRef('att-t') }])
  })

  it('无图消息 → 空数组', () => {
    expect(extractResolvedImages([textMessage('纯文本')])).toEqual([])
  })
})

describe('createStreamVisionCaller（生产 VisionCaller，Ruling 2）', () => {
  function fakeLlm(chunks: unknown[]) {
    const calls: unknown[] = []
    return {
      calls,
      ctx: {
        llm: {
          stream: (options: unknown) => {
            calls.push(options)
            return (async function* () { for (const c of chunks) yield c })()
          },
        },
      },
    }
  }

  it('text-delta 累计为转述文字；图块按 ref 线形直传；不传 reasoningEffort（Ruling 2）', async () => {
    const { ctx, calls } = fakeLlm([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '第一' },
      { type: 'text-delta', index: 0, text: '第二' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const caller = createStreamVisionCaller(ctx as never)
    const ref = imageRef('att-v')
    const out = await caller(VISION_EXP, '提示词', [{ attachmentId: 'att-v', ref }])

    expect(out).toBe('第一第二')
    expect(calls).toHaveLength(1)
    const options = calls[0] as Record<string, unknown>
    expect(options.provider).toBe('deepseek-official')
    expect(options.model).toBe('deepseek-v4-flash-vision-exp')
    expect('reasoningEffort' in options).toBe(false) // Ruling 2：adapter 默认
    const messages = options.messages as Array<{ role: string; content: unknown[] }>
    expect(messages[0].role).toBe('user')
    expect(messages[0].content[0]).toEqual({ type: 'text', text: '提示词' })
    expect(messages[0].content[1]).toEqual({ type: 'image', attachment: ref })
  })

  it('finish reason.kind=error → 抛错（转述失败由 Transcriber 记失败集）', async () => {
    const { ctx } = fakeLlm([
      { type: 'finish', reason: { kind: 'error', failure: { code: 'UPSTREAM', message: 'boom' } } },
    ])
    const caller = createStreamVisionCaller(ctx as never)
    await expect(caller(VISION_EXP, 'p', [{ attachmentId: 'a', ref: imageRef('a') }])).rejects.toThrow('boom')
  })

  it('多图一次性送达（同一 user 消息多图块）', async () => {
    const { ctx, calls } = fakeLlm([{ type: 'finish', reason: { kind: 'stop' } }])
    const caller = createStreamVisionCaller(ctx as never)
    await caller(VISION_EXP, 'p', [
      { attachmentId: 'a1', ref: imageRef('a1') },
      { attachmentId: 'a2', ref: imageRef('a2') },
    ])
    const messages = (calls[0] as { messages: Array<{ content: unknown[] }> }).messages
    expect(messages[0].content).toHaveLength(3) // text + 2 image
  })
})
