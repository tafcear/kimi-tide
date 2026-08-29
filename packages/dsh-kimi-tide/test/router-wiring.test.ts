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

interface HookRecord<T> {
  callback: T
}

function makeCtx() {
  const listeners = new Map<string, Array<HookRecord<Listener>>>()
  const streamListeners: Array<HookRecord<StreamListener>> = []
  const logs: string[] = []
  /** llm/stream 瀑布终点（伪适配器）收到的 options，按到达序记录。 */
  const adapterCalls: unknown[] = []
  const ctx = {
    logger: { info: (message: string) => logs.push(message) },
    effect: (execute: () => unknown) => {
      // 真实效应语义：回调返回的 cleanup 由 effect 返回的注销器执行——
      // 生产 installRouter 的注销链（disposePre/Request/Stream/Admission）
      // 依赖此语义，重挂载回归测试需要真实注销。
      const cleanup = execute()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
    on: (name: string, listener: Listener | StreamListener, options?: { prepend?: boolean }) => {
      const prepend = options?.prepend ?? false
      if (name === 'llm/stream') {
        const record: HookRecord<StreamListener> = { callback: listener as StreamListener }
        prepend ? streamListeners.unshift(record) : streamListeners.push(record)
        return () => {
          const i = streamListeners.indexOf(record)
          if (i >= 0) streamListeners.splice(i, 1)
        }
      }
      const arr = listeners.get(name) ?? []
      listeners.set(name, arr)
      const record: HookRecord<Listener> = { callback: listener as Listener }
      prepend ? arr.unshift(record) : arr.push(record)
      return () => {
        const i = arr.indexOf(record)
        if (i >= 0) arr.splice(i, 1)
      }
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
            : streamListeners[i].callback(options, () => walk(i + 1))
        return walk(0)
      },
    },
  }
  const dispatch = {
    /**
     * cordis waterfall 语义（EventsService.waterfall，lib/index.js:317-325）：
     * 监听器按注册序外层优先执行；next() 回放原始载荷调用下一层；
     * 瀑布结果 = 最外层监听器的返回值。支持 prepend（unshift）与真实注销
     * ——2026-08-23 回归：宿主 rc.2 installModelSelection 在 agent 创建时
     * 注册 agent/request 覆盖监听器；kimi-tide 配置变更重挂载会把自身监听器
     * push 到链尾（内层），路由返回值被外层覆盖丢弃——prepend 恒外层修复。
     */
    async preStep(payload: object): Promise<unknown> {
      const cbs = [...(listeners.get('agent/pre-step') ?? [])].map((r) => r.callback)
      const inner = () => Promise.resolve({ kind: 'enter' })
      const next = () => (cbs.shift() ?? inner)(payload, next)
      return next()
    },
    async request(payload: object, base: object): Promise<unknown> {
      const cbs = [...(listeners.get('agent/request') ?? [])].map((r) => r.callback)
      const inner = () => Promise.resolve(base)
      const next = () => (cbs.shift() ?? inner)(payload, next)
      return next()
    },
    /**
     * Host prompt pre-check deferral: mirrors cordis `serial` bail semantics
     * (EventsService.serial) — listeners run in order; the first bail value
     * (non-null/false/undefined) wins; no listener → undefined (reject).
     */
    async admission(payload: object): Promise<unknown> {
      for (const record of listeners.get('agent/image-admission') ?? []) {
        const result = await record.callback(payload, () => Promise.resolve(undefined))
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
    /** I-2：转述调用有界超时（测试传小值）；缺省走生产默认 30s。 */
    transcribeTimeoutMs?: number
  }
  images: ImageStateStore
  transcriber: Transcriber
  callerCalls: Array<{ target: RouteTarget; prompt: string; images: readonly ResolvedImage[] }>
  decisions: Array<{ decision: RouteDecision; extra?: { flowId?: string; flowDigest?: string } }>
}

/** installRouter 0.6.0 deps 夹具：真实 ImageStateStore + 真实 Transcriber（caller 可注入）。 */
function makeDeps(caller?: VisionCaller, cacheCap?: number): DepsFixture {
  const images = new ImageStateStore()
  const callerCalls: DepsFixture['callerCalls'] = []
  const decisions: DepsFixture['decisions'] = []
  const transcriber = new Transcriber({
    caller: caller ?? (async (target, prompt, imgs) => {
      callerCalls.push({ target, prompt, images: imgs })
      return '转述文字'
    }),
    ...(cacheCap === undefined ? {} : { cacheCap }),
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

describe('installRouter vs 宿主模型选择覆盖（rc.2 installModelSelection 回归，2026-08-23）', () => {
  // 实机回归（0.6.0 验收 turn 10 实锤）：rc.2 dsh-host-apiproxy 在 agent
  // 创建时安装 installModelSelection——agent/request 监听器把 provider/model
  // 覆盖回会话选定模型（selectionFor→installModelSelection，
  // dsh-host-apiproxy/lib/index.js:1692-1715，selection.current 回退链 =
  // picked → 会话 request/header → 默认）。cordis waterfall 结果 = 最外层
  // 监听器返回值；kimi-tide 每次配置变更重挂载（applyConfig → mountRouter
  // → 注销+重注册）把自身监听器 push 到链尾（内层），路由返回值被外层覆盖
  // 丢弃——面板决策正确但实际请求恒为会话模型（assistant/message.source
  // 实锤 deepseek-v4-pro）。修复：全部监听器 {prepend:true} 恒外层。
  it('配置重挂载后路由决策仍覆盖宿主 model-selection 监听器（prepend 恒外层）', async () => {
    const { ctx, dispatch } = makeCtx()
    const router = new KimiRouter(CONFIG(), METAS, { info: () => {} })
    const disposeFirst = installRouter(ctx as never, router, makeDeps().deps)

    // 模拟宿主 apiproxy：agent 创建（晚于插件启动）时注册 model-selection
    // 覆盖监听器——把 resolved 覆盖回会话选定模型（生产=请求头回退链）。
    const hostDispose = ctx.on('agent/request', async (payload, next) => {
      const resolved = await next()
      return { ...(resolved as object), provider: 'session-selected', model: 'session-model' }
    })

    // 模拟设置卡片保存：applyConfig → mountRouter 注销并重挂路由器
    // （生产每次配置变更发生一次；重挂后监听器 push 到链尾）。
    disposeFirst()
    installRouter(ctx as never, router, makeDeps().deps)

    await dispatch.preStep({ agent, messages: [textMessage('@kimi 请审查这段代码')], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    // 无 prepend 时：链序 [host, kimi-tide]，host 外层胜出 → config =
    // session-selected（RED，复现生产回归）。prepend 后：链序
    // [kimi-tide, host]，kimi-tide 外层胜出 → 路由决策生效。
    expect(config).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
    hostDispose()
  })

  it('源码钉桩：installRouter 四个监听器注册均携带 prepend:true', async () => {
    const { readFile } = await import('node:fs/promises')
    const src = await readFile(new URL('../src/router.ts', import.meta.url), 'utf8')
    const installBody = src.slice(src.indexOf('export function installRouter'))
    const markers = ['agent/pre-step', 'agent/request', 'llm/stream', 'agent/image-admission']
    const positions = markers.map((name) => installBody.indexOf(`ctx.on('${name}'`))
    expect(positions.every((p) => p !== -1)).toBe(true)
    for (let i = 0; i < positions.length; i++) {
      const from = positions[i]
      const to = i + 1 < positions.length ? positions[i + 1] : installBody.length
      // 每段（该 ctx.on 到下一 ctx.on）内含其回调的 {prepend:true} 尾参——
      // 防止未来重构静默丢失 prepend。
      expect(installBody.slice(from, to)).toContain('prepend: true')
    }
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

  // I-1 钉桩（spec §5.1 新语义）：0.5.0 布尔锁存使「带图轮之后的文本轮」
  // hasImage 恒真 → 图像规则永远首中（hijack 规则链）。0.6.0 hasImage=本轮
  // 未转述图：文本轮图像规则不中，code 关键词规则（目标 kimi-for-coding，
  // 多模态）可中——锁存/latch fallback 只防崩防盲，不劫持规则链。
  // 0.5.0 锁存副作用不复活，spec §6 措辞已收窄。
  it('带图轮之后的关键词命中轮走关键词规则（code-kfc → kimi-for-coding），不回 k3', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }), makeDeps().deps)

    // Turn 1 带图：image-k3 规则命中 → k3（登记 native，latchTarget=k3）
    await dispatch.preStep({ agent, messages: [imageMessage('看图说话')], turn: 1, step: 1, signal: signal() })
    const first = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)
    expect(first).toMatchObject({ provider: 'kimi-coding', model: 'k3' })

    // Turn 2 纯文本含 code 关键词：0.5.0 锁存语义下 hasImage 恒真、image-k3
    // 首中落 k3；新语义下图像规则不中，code-kfc 命中落 kimi-for-coding
    // （多模态目标，不崩不盲，无需 latch fallback 改道）。
    await dispatch.preStep({ agent, messages: [textMessage('帮我看看这段 code 的实现')], turn: 2, step: 1, signal: signal() })
    const second = await dispatch.request({ agent, turn: 2, step: 1, signal: signal() }, baseConfig)
    expect(second).toMatchObject({ provider: 'kimi-coding', model: 'kimi-for-coding' })
    expect(second).not.toMatchObject({ model: 'k3' })
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
    expect(fx.decisions[0].extra).toMatchObject({ flowId: 'transcribe' })

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
    expect(fx.decisions[0].extra).toMatchObject({ flowId: 'transcribe' })
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

  it('④本轮多图并发转述（评审修复 2026-08-23）：图间无依赖，不应串行叠加视觉调用延迟', async () => {
    const { ctx, dispatch } = makeCtx()
    // 在途探针：串行实现下 maxInFlight 恒 1；并发实现下 3 张图同时在途。
    let inFlight = 0
    let maxInFlight = 0
    const fx = makeDeps(async (_t, _p, images) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return `转述:${images[0].attachmentId}`
    })
    installRouter(ctx as never, new KimiRouter(FLOW_CONFIG(), FLOW_METAS, { info: () => {} }), fx.deps)

    const multi = {
      role: 'user',
      content: [
        { type: 'text', text: '三张截图一起看' },
        { type: 'image', attachment: imageRef('att-1') },
        { type: 'image', attachment: imageRef('att-2') },
        { type: 'image', attachment: imageRef('att-3') },
      ],
    } as unknown as UserMessage
    await dispatch.preStep({ agent, messages: [multi], turn: 1, step: 1, signal: signal() })

    expect(maxInFlight).toBe(3)
    for (const id of ['att-1', 'att-2', 'att-3']) {
      expect(fx.images.get(agent as never, id)?.state).toBe('transcribed')
    }
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)
    expect(config).toEqual(SAVING_DEFAULT) // 全成 → hasImage=false 重跑 → 文本默认
  })

  it('0.6.x池#a：flow 决策 extra 携带转述成败摘要（flowDigest：ok/total + 败图 id）', async () => {
    const { ctx, dispatch } = makeCtx()
    const fx = makeDeps(async (_t, _p, images) => {
      if (images[0].attachmentId === 'att-2') throw new Error('vision down')
      return `转述:${images[0].attachmentId}`
    })
    installRouter(ctx as never, new KimiRouter(FLOW_CONFIG(), FLOW_METAS, { info: () => {} }), fx.deps)

    const multi = {
      role: 'user',
      content: [
        { type: 'text', text: '两张截图' },
        { type: 'image', attachment: imageRef('att-1') },
        { type: 'image', attachment: imageRef('att-2') },
      ],
    } as unknown as UserMessage
    await dispatch.preStep({ agent, messages: [multi], turn: 1, step: 1, signal: signal() })

    // Fails if: extra 只有 flowId——lastFlowEvent 无法表达成败（语义缩水，
    // 客户端补渲染也拿不到转述成败）。
    expect(fx.decisions[0]?.extra?.flowId).toBe('transcribe')
    expect(fx.decisions[0]?.extra?.flowDigest).toContain('转述 1/2')
    expect(fx.decisions[0]?.extra?.flowDigest).toContain('att-2')
  })
})

describe('installRouter 转述中止/超时（I-2：视觉端黑洞不得挂死整轮）', () => {
  it('caller 挂起 + 有界超时 → text() 返回 null → failurePolicy latch-image 落 visionModel', async () => {
    const { ctx, dispatch } = makeCtx()
    const seenSignals: Array<AbortSignal | undefined> = []
    // caller 黑洞：永不 resolve，仅在收到中止信号时 reject（模拟视觉端挂死）。
    // 无信号送达时立即 reject，避免 RED 阶段挂起等待测试超时。
    const fx = makeDeps(async (_target, _prompt, _images, signal) => {
      seenSignals.push(signal)
      if (signal === undefined) throw new Error('no signal delivered')
      return await new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('transcribe aborted (timeout)')), { once: true })
      })
    })
    fx.deps.transcribeTimeoutMs = 20 // 测试可控的小超时（生产默认 30s）
    installRouter(ctx as never, new KimiRouter(FLOW_CONFIG(), FLOW_METAS, { info: () => {} }), fx.deps)

    await dispatch.preStep({ agent, messages: [imageMessage('看这个报错截图')], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    // 有界信号真实送达 caller 且已中止（pre-step 未挂死，本断言先于路由断言失败即 RED）
    expect(seenSignals).toHaveLength(1)
    expect(seenSignals[0]).toBeInstanceOf(AbortSignal)
    expect(seenSignals[0]!.aborted).toBe(true)
    // 中止/超时视同转述失败：失败集 + failurePolicy latch-image 既有分支
    expect(config).toMatchObject(VISION_EXP)
    expect(fx.images.get(agent as never, 'att-1')?.state).toBe('native')
    expect(fx.decisions[0].extra).toMatchObject({ flowId: 'transcribe' })
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

  it('③b lazy 路径多图历史并发补转述（评审修复 2026-08-23）', async () => {
    const { ctx, dispatch } = makeCtx()
    let inFlight = 0
    let maxInFlight = 0
    const fx = makeDeps(async (_t, _p, images) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return `转述:${images[0].attachmentId}`
    })
    const config = DEFAULT_CONFIG_V5()
    config.activePreset = 'saving'
    config.presets.saving.imageFallback = 'transcribe-lazy'
    installRouter(ctx as never, new KimiRouter(config, FLOW_METAS, { info: () => {} }), fx.deps)

    // Turn 1 三张图：image 规则 → k3 原生作答，不触发转述
    const multi = {
      role: 'user',
      content: [
        { type: 'text', text: '看图' },
        { type: 'image', attachment: imageRef('att-1') },
        { type: 'image', attachment: imageRef('att-2') },
        { type: 'image', attachment: imageRef('att-3') },
      ],
    } as unknown as UserMessage
    await dispatch.preStep({ agent, messages: [multi], turn: 1, step: 1, signal: signal() })
    const first = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)
    expect(first).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
    expect(maxInFlight).toBe(0)

    // Turn 2 纯文本：三张历史 native 图并发补转述（串行 = 3 倍视觉延迟叠加）
    await dispatch.preStep({ agent, messages: [textMessage('继续')], turn: 2, step: 1, signal: signal() })
    expect(maxInFlight).toBe(3)
    for (const id of ['att-1', 'att-2', 'att-3']) {
      expect(fx.images.get(agent as never, id)?.state).toBe('transcribed')
    }
    const second = await dispatch.request({ agent, turn: 2, step: 1, signal: signal() }, baseConfig)
    expect(second).toEqual(SAVING_DEFAULT)
  })

  it('0.6.x池#2：lazy 补转述失败（failurePolicy latch-image）→ 败图保持 native、本轮落 visionModel', async () => {
    const { ctx, dispatch } = makeCtx()
    const fx = makeDeps(async () => { throw new Error('vision down') })
    const config = DEFAULT_CONFIG_V5()
    config.activePreset = 'saving'
    config.presets.saving.imageFallback = 'transcribe-lazy'
    installRouter(ctx as never, new KimiRouter(config, FLOW_METAS, { info: () => {} }), fx.deps)

    // Turn 1 带图：image 规则 → k3 原生作答（native 登记历史图）
    await dispatch.preStep({ agent, messages: [imageMessage('看图说话')], turn: 1, step: 1, signal: signal() })
    await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)
    // Turn 2 纯文本：lazy 补转述失败 → latch-image → 本轮落 flow.visionModel
    await dispatch.preStep({ agent, messages: [textMessage('继续')], turn: 2, step: 1, signal: signal() })
    const second = await dispatch.request({ agent, turn: 2, step: 1, signal: signal() }, baseConfig)

    // Fails if: lazy 侧失败两态语义与 eager 不一致（latch 分支未生效）。
    expect(second).toMatchObject(VISION_EXP)
    expect(fx.images.get(agent as never, 'att-1')?.state).toBe('native')
  })

  it('0.6.x池#2：lazy 补转述失败（failurePolicy blind）→ 败图标 blind、放行文本默认', async () => {
    const { ctx, dispatch } = makeCtx()
    const fx = makeDeps(async () => { throw new Error('vision down') })
    const config = DEFAULT_CONFIG_V5()
    config.activePreset = 'saving'
    config.presets.saving.imageFallback = 'transcribe-lazy'
    const flow = config.flows.transcribe
    if (flow.type !== 'transcribe') throw new Error('fixture')
    flow.failurePolicy = 'blind'
    installRouter(ctx as never, new KimiRouter(config, FLOW_METAS, { info: () => {} }), fx.deps)

    await dispatch.preStep({ agent, messages: [imageMessage('看图说话')], turn: 1, step: 1, signal: signal() })
    await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)
    await dispatch.preStep({ agent, messages: [textMessage('继续')], turn: 2, step: 1, signal: signal() })
    const second = await dispatch.request({ agent, turn: 2, step: 1, signal: signal() }, baseConfig)

    expect(second).toEqual(SAVING_DEFAULT)
    expect(fx.images.get(agent as never, 'att-1')?.state).toBe('blind')
  })

  it('③c 转述缓存 LRU 逐出 → 状态表降级回 native → 后续文本轮重转述（评审修复 2026-08-23）', async () => {
    const { ctx, dispatch } = makeCtx()
    const calls: string[] = []
    const fx = makeDeps(async (_t, _p, images) => {
      calls.push(images[0].attachmentId)
      return `转述:${images[0].attachmentId}`
    }, 1) // cacheCap=1：第二张图转述成功必逐出第一张
    const config = DEFAULT_CONFIG_V5()
    config.activePreset = 'saving'
    config.presets.saving.imageFallback = 'transcribe-lazy'
    installRouter(ctx as never, new KimiRouter(config, FLOW_METAS, { info: () => {} }), fx.deps)
    const k3Target = { provider: 'kimi-coding', model: 'k3' }

    // Turn 1 带图 att-1：image 规则 → k3 原生（native + latchTarget=k3），不转述
    await dispatch.preStep({ agent, messages: [imageMessage('看图', 'att-1')], turn: 1, step: 1, signal: signal() })
    await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)
    // Turn 2 纯文本：lazy 转述 att-1 → transcribed（缓存 {att-1}）
    await dispatch.preStep({ agent, messages: [textMessage('继续')], turn: 2, step: 1, signal: signal() })
    await dispatch.request({ agent, turn: 2, step: 1, signal: signal() }, baseConfig)
    expect(fx.images.get(agent as never, 'att-1')?.state).toBe('transcribed')
    // Turn 3 带图 att-2：k3 原生
    await dispatch.preStep({ agent, messages: [imageMessage('再看', 'att-2')], turn: 3, step: 1, signal: signal() })
    await dispatch.request({ agent, turn: 3, step: 1, signal: signal() }, baseConfig)
    // Turn 4 纯文本：lazy 转述 att-2 → cap 1 逐出 att-1（缓存 {att-2}）
    await dispatch.preStep({ agent, messages: [textMessage('嗯')], turn: 4, step: 1, signal: signal() })
    await dispatch.request({ agent, turn: 4, step: 1, signal: signal() }, baseConfig)
    expect(fx.transcriber.peek('att-1')).toBeUndefined() // 逐出实锤（修复前后均成立的前提断言）
    expect(calls).toEqual(['att-1', 'att-2'])

    // Turn 5 纯文本：att-1 标 transcribed 但缓存落空 → 降级回 native → lazy 重转述
    await dispatch.preStep({ agent, messages: [textMessage('继续聊')], turn: 5, step: 1, signal: signal() })
    expect(calls.filter((id) => id === 'att-1')).toHaveLength(2)
    // 重转述成功：transcribed；latchTarget 全程保留（lazy 标记点与降级均不清除）
    expect(fx.images.get(agent as never, 'att-1')).toEqual({ state: 'transcribed', latchTarget: k3Target })
    const fifth = await dispatch.request({ agent, turn: 5, step: 1, signal: signal() }, baseConfig)
    expect(fifth).toEqual(SAVING_DEFAULT)
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

describe('llm/stream 辅助请求改道（0.8.x⑧：purpose → auxTargets）', () => {
  /** 池⑧夹具：saving 激活 + 可选 auxTargets（purpose → 模型目标）。 */
  const AUX = (auxTargets?: RouterConfigV5['auxTargets']): RouterConfigV5 => {
    const c = DEFAULT_CONFIG_V5()
    c.activePreset = 'saving'
    c.auxTargets = auxTargets
    return c
  }
  /** 宿主标题请求信封形态（池⑦取证）：主路由打 k3 思考 + envelope 带 purpose。 */
  const TITLE_OPTS = () => ({
    provider: 'kimi-coding',
    model: 'k3',
    purpose: 'session-title',
    reasoningEffort: 'max',
    messages: [textMessage('给这段对话起个标题')],
  })

  it('purpose 命中 auxTargets 且目标可用 → 覆写 provider/model（短路自派，适配器只见改写载荷）', async () => {
    const { ctx, adapterCalls } = makeCtx()
    installRouter(ctx as never, new KimiRouter(AUX({ 'session-title': SAVING_DEFAULT }), METAS, { info: () => {} }), makeDeps().deps)
    await drain((ctx.llm as { stream: (o: unknown) => AsyncIterable<unknown> }).stream(TITLE_OPTS()))
    // Fails if: llm/stream 拦截器不消费 envelope purpose（辅助请求改道缺失，
    // 标题请求跟随主路由打思考模型——池⑦主根因的插件侧根治）。
    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('改道后 effort 语义与 replaceRoute 一致：继承 reasoningEffort 面对无支持集目标 → 剥离（标题请求不携带思考等级）', async () => {
    const { ctx, adapterCalls } = makeCtx()
    installRouter(ctx as never, new KimiRouter(AUX({ 'session-title': SAVING_DEFAULT }), METAS, { info: () => {} }), makeDeps().deps)
    await drain((ctx.llm as { stream: (o: unknown) => AsyncIterable<unknown> }).stream(TITLE_OPTS()))
    // Fails if: 改道只换 provider/model 而保留 k3 的 reasoningEffort（思考等级
    // 泄漏进非思考快模型——0.8.0 图像护栏 M5 同族教训）。
    expect('reasoningEffort' in (adapterCalls[0] as Record<string, unknown>)).toBe(false)
  })

  it('无 purpose 的普通请求不改道（agent-loop 语义不变）', async () => {
    const { ctx, adapterCalls } = makeCtx()
    installRouter(ctx as never, new KimiRouter(AUX({ 'session-title': SAVING_DEFAULT }), METAS, { info: () => {} }), makeDeps().deps)
    await drain((ctx.llm as { stream: (o: unknown) => AsyncIterable<unknown> }).stream({
      provider: 'kimi-coding', model: 'k3', reasoningEffort: 'max', messages: [textMessage('继续')],
    }))
    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
    expect((adapterCalls[0] as Record<string, unknown>).reasoningEffort).toBe('max')
  })

  it('purpose 无 auxTargets 键（或整表缺省）→ 原样放行（向后兼容缺省不改道）', async () => {
    const { ctx, adapterCalls } = makeCtx()
    installRouter(ctx as never, new KimiRouter(AUX(undefined), METAS, { info: () => {} }), makeDeps().deps)
    await drain((ctx.llm as { stream: (o: unknown) => AsyncIterable<unknown> }).stream(TITLE_OPTS()))
    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
  })

  it('v4 存量配置（无 auxTargets 形）→ 原样放行', async () => {
    const { ctx, adapterCalls } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }), makeDeps().deps)
    await drain((ctx.llm as { stream: (o: unknown) => AsyncIterable<unknown> }).stream(TITLE_OPTS()))
    expect(adapterCalls[0]).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
  })

  it('auxTarget 目录不可用 → 原样放行（保守不改道，与规则目标不可用跳过同向）', async () => {
    const { ctx, adapterCalls } = makeCtx()
    installRouter(ctx as never, new KimiRouter(AUX({ 'session-title': { provider: 'deepseek-official', model: 'ghost-model' } }), METAS, { info: () => {} }), makeDeps().deps)
    await drain((ctx.llm as { stream: (o: unknown) => AsyncIterable<unknown> }).stream(TITLE_OPTS()))
    expect(adapterCalls[0]).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
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
  // 0.8.0（Task 5）：签名改 (ctx, resolveEfforts)；本块夹具目标无 effort 字段，
  // 注入 () => undefined 保持「不携带 reasoningEffort」的默认语义断言不变。
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
    const caller = createStreamVisionCaller(ctx as never, () => undefined)
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
    const caller = createStreamVisionCaller(ctx as never, () => undefined)
    await expect(caller(VISION_EXP, 'p', [{ attachmentId: 'a', ref: imageRef('a') }])).rejects.toThrow('boom')
  })

  it('signal 透传进 ctx.llm.stream options（I-2：pre-step 中止/有界超时的链路终点）', async () => {
    const { ctx, calls } = fakeLlm([{ type: 'finish', reason: { kind: 'stop' } }])
    const caller = createStreamVisionCaller(ctx as never, () => undefined)
    const controller = new AbortController()
    await caller(VISION_EXP, 'p', [{ attachmentId: 'a', ref: imageRef('a') }], controller.signal)
    expect((calls[0] as Record<string, unknown>).signal).toBe(controller.signal)
  })

  it('多图一次性送达（同一 user 消息多图块）', async () => {
    const { ctx, calls } = fakeLlm([{ type: 'finish', reason: { kind: 'stop' } }])
    const caller = createStreamVisionCaller(ctx as never, () => undefined)
    await caller(VISION_EXP, 'p', [
      { attachmentId: 'a1', ref: imageRef('a1') },
      { attachmentId: 'a2', ref: imageRef('a2') },
    ])
    const messages = (calls[0] as { messages: Array<{ content: unknown[] }> }).messages
    expect(messages[0].content).toHaveLength(3) // text + 2 image
  })

  it('abort 中途：流迭代中 reject（AbortError）→ caller 抛错传播（评审补合同：与 finish aborted 同语义）', async () => {
    // 既有正确行为的合同钉桩：for-await 不吞不挂，流内异常原样传播给
    // Transcriber 的 catch（记失败集，同图不重打）。
    const ctx = {
      llm: {
        stream: (_options: unknown) => (async function* () {
          yield { type: 'text-delta', index: 0, text: '半截' }
          throw new DOMException('The operation was aborted', 'AbortError')
        })(),
      },
    }
    const caller = createStreamVisionCaller(ctx as never, () => undefined)
    await expect(caller(VISION_EXP, 'p', [{ attachmentId: 'a', ref: imageRef('a') }])).rejects.toThrow(/aborted/i)
  })

  it('空文本合同：流正常结束但零 text-delta → 返回空串（成败裁决在 Transcriber 层：空白视同失败）', async () => {
    // 评审补合同（2026-08-23）：caller 只忠实回报模型输出；「空串=失败、
    // 进失败集」的裁决钉在 Transcriber.text（见 transcribe.test.ts），本层
    // 不二次裁决——任何 VisionCaller 实现都受同一条不变量保护。
    const { ctx } = fakeLlm([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 0 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const caller = createStreamVisionCaller(ctx as never, () => undefined)
    await expect(caller(VISION_EXP, 'p', [{ attachmentId: 'a', ref: imageRef('a') }])).resolves.toBe('')
  })
})
