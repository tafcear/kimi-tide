// test/review-orchestration.test.ts（1.1.0 Task 5：编排层——armed/累计/
// turn-stopping 异步评审/手动评审钩子；spec §5/§7/§8）
//
// 夹具说明（brief Step 1）：
// - fake ctx 沿用 integration.test.ts makeCtx 模式：ctx.on 把监听器存
//   listeners Map，测试直呼监听器（dispatch 辅助）；
// - fake agent = { ctx: { on: capture }, session: { append: vi.fn() } }——
//   agent.ctx.on 捕获该 agent 的 session/event 监听器（M2：feed 注册在
//   agent.ctx，dsh-scope 作用域过滤的宿主语义按「每 agent 独立捕获」复刻）；
// - fake llm.stream 用 async generator 形状（Task 3 同款）。
//
// 载荷线形按实读源码（与 brief snippet 的差异见 task-5-report）：
// - session/event 监听器收 (session, event) 双参（dsh-session types/index.d.ts:66），
//   event 信封 = { type, seq, time, data }；turn/message/interrupted/source
//   全部嵌套在 data（SessionEventMap：assistant/message 载荷 {turn, step,
//   message, interrupted?}；user/message 载荷 = UserMessage（含 source））。
// - agent/turn-stopping 载荷 {agent, turn, signal}（agentEvents fused 注入
//   agent，dsh-agent lib/index.js:335-339）。
import { describe, expect, it, vi } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { DEFAULT_CONFIG_V5, DEFAULT_FLOWS, type CandidateMeta } from '../src/config.js'
import { ImageStateStore } from '../src/image-state.js'
import { installRouter, KimiRouter } from '../src/router.js'
import { REVIEW_INPUT_LIMIT } from '../src/review.js'
import { Transcriber } from '../src/transcribe.js'

/** v5Claimed 同 review-flow.test.ts（复制小夹具，brief 允许）。 */
const v5Claimed = () => {
  const config = DEFAULT_CONFIG_V5()
  config.activePreset = 'capability'
  config.flows = {
    ...DEFAULT_FLOWS(),
    review: { ...DEFAULT_FLOWS().review, trigger: 'keywords', keywordGroup: 'review' },
  }
  return config
}

/** reviewer（kimi-coding/k3）可用的候选池。 */
const metas = (k3Available = true): CandidateMeta[] => [
  { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available: k3Available },
  { provider: 'kimi-coding', model: 'kimi-for-coding', modalities: ['text', 'image'], available: true },
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], available: true },
]

const text = (t: string): UserMessage =>
  ({ role: 'user', content: [{ type: 'text', text: t }] }) as unknown as UserMessage

const signal = (): AbortSignal => new AbortController().signal

/** 排空微任务链（runReview 的 for-await → .then → append 至少跨数个微任务）。 */
const flush = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)) }

/** fake agent：agent.ctx 捕获 session/event 监听器；session.append 记录调用。 */
function makeAgent(appendImpl?: () => void) {
  const sessionListeners: Array<(session: unknown, event: unknown) => void> = []
  const append = appendImpl ? vi.fn(appendImpl) : vi.fn()
  const agent = {
    ctx: {
      on: (name: string, listener: (session: unknown, event: unknown) => void) => {
        if (name === 'session/event') sessionListeners.push(listener)
        return () => {}
      },
    },
    session: { append },
  }
  return { agent, sessionListeners, append }
}

type PreStepListener = (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>
type StopListener = (payload: unknown) => unknown

/** fake ctx（integration.test.ts makeCtx 模式）+ 直呼监听器的 dispatch 辅助。 */
function makeHarness(k3Available = true) {
  const listeners = new Map<string, Array<PreStepListener | StopListener>>()
  const warns: string[] = []
  const streamCalls: Array<{ provider: string; model: string; messages: Array<{ content: Array<{ type: string; text?: string }> }> }> = []
  const reviewEvents: Array<{ type: string; data: Record<string, unknown> }> = [
    { type: 'text-delta', text: '评审意见：未发现实质问题' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const ctx = {
    logger: { info: () => {}, warn: (message: string) => { warns.push(message) } },
    effect: (execute: () => unknown) => {
      const cleanup = execute()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
    on: (name: string, listener: PreStepListener | StopListener) => {
      const arr = listeners.get(name) ?? []
      arr.push(listener)
      listeners.set(name, arr)
      return () => {
        const current = listeners.get(name)
        const index = current?.indexOf(listener) ?? -1
        if (current !== undefined && index >= 0) current.splice(index, 1)
      }
    },
    llm: {
      stream: (options: unknown) => {
        streamCalls.push(options as never)
        async function* fake(): AsyncGenerator<unknown> {
          for (const chunk of reviewEvents) yield chunk
        }
        return fake()
      },
    },
  }

  /** waterfall 直呼（cordis 语义：监听器收 (payload, next)）。 */
  const preStep = async (agent: unknown, turn: number, message: UserMessage): Promise<void> => {
    for (const listener of [...(listeners.get('agent/pre-step') ?? [])]) {
      await (listener as PreStepListener)(
        { agent, messages: [message], turn, step: 1, signal: signal() },
        () => Promise.resolve({ kind: 'enter' }),
      )
    }
  }
  /** serial 直呼：同步调用并回收返回值（零阻塞断言=返回值不得是 thenable——serial 派发被 loop await）。 */
  const turnStopping = (agent: unknown, turn: number): unknown[] => {
    const returns: unknown[] = []
    for (const listener of [...(listeners.get('agent/turn-stopping') ?? [])]) {
      returns.push((listener as StopListener)({ agent, turn, signal: signal() }))
    }
    return returns
  }
  /** 把 session 事件信封投给 agent 的 session/event 监听器（(session, event) 双参）。 */
  const sessionEvent = (agentFixture: ReturnType<typeof makeAgent>, envelope: unknown): void => {
    for (const listener of [...agentFixture.sessionListeners]) listener({}, envelope)
  }

  return { ctx, warns, streamCalls, preStep, turnStopping, sessionEvent }
}

let seq = 0
/** user/message 信封：data = UserMessage（source 区分人类/注入，L3 锚点）。 */
const userEvent = (t: string, source: { kind: string; plugin?: string } = { kind: 'user' }) => ({
  type: 'user/message',
  seq: ++seq,
  time: 0,
  data: { role: 'user', content: [{ type: 'text', text: t }], source, id: `u${seq}` },
})
/** assistant/message 信封：turn/message/interrupted 嵌套在 data（实读锚定）。 */
const assistantEvent = (turn: number, t: string, interrupted = false) => ({
  type: 'assistant/message',
  seq: ++seq,
  time: 0,
  data: {
    turn,
    step: 1,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: t }],
      source: { kind: 'model', provider: 'kimi-coding', model: 'k3' },
      id: `a${seq}`,
    },
    ...(interrupted ? { interrupted: true as const } : {}),
  },
})

/** installRouter deps 夹具（真实 ImageStateStore/Transcriber，caller 恒成功）。 */
function makeDeps() {
  const images = new ImageStateStore()
  const transcriber = new Transcriber({ caller: async () => '转述文字' })
  const onReviewEvent = vi.fn()
  const onManualReview = vi.fn()
  return {
    deps: {
      images,
      transcriber,
      resolveImages: () => [],
      onDecision: () => {},
      onReviewEvent,
      onManualReview,
    },
    onReviewEvent,
    onManualReview,
  }
}

/** 评审输入全文（单条 user 消息的单个 text 块）。 */
const reviewInput = (calls: ReturnType<typeof makeHarness>['streamCalls'], index = 0): string => {
  const options = calls[index]
  return options.messages[0].content[0].text ?? ''
}

/** 评审输入的产出段（[主模型本轮产出] 之后）。 */
const outputSegment = (input: string): string => input.split('[主模型本轮产出]\n')[1] ?? ''

/** 标准武装轮事件序：user(人类) → assistant ×2。 */
async function armedTurn(
  fx: ReturnType<typeof makeHarness>,
  agentFixture: ReturnType<typeof makeAgent>,
  turn: number,
  userText: string,
  outputs: [string, string],
): Promise<void> {
  await fx.preStep(agentFixture.agent, turn, text(userText))
  fx.sessionEvent(agentFixture, userEvent(userText))
  fx.sessionEvent(agentFixture, assistantEvent(turn, outputs[0]))
  fx.sessionEvent(agentFixture, assistantEvent(turn, outputs[1]))
}

describe('review 编排：armed→累计→turn-stopping（spec §5）', () => {
  it('1) 全链路：评审调用载荷含需求+产出且 append 收到 kimi-tide/review ok:true；turn-stopping handler 同步返回（先返回后 append）', async () => {
    const fx = makeHarness()
    const agentFixture = makeAgent()
    const { deps } = makeDeps()
    installRouter(fx.ctx as never, new KimiRouter(v5Claimed(), metas(), { info: () => {} }), deps)

    await armedTurn(fx, agentFixture, 7, '帮我评审一下这个方案', ['产出内容甲', '产出内容乙'])
    const stopReturns = fx.turnStopping(agentFixture.agent, 7)
    // 零阻塞双重锁：① handler 同步返回 undefined（非 thenable——serial 派发被
    // loop await，返回 Promise 即阻塞轮关闭）；② handler 返回时评审尚未 append。
    expect(stopReturns.every((value) => value === undefined)).toBe(true)
    expect(agentFixture.append).not.toHaveBeenCalled()
    await flush()

    expect(fx.streamCalls).toHaveLength(1)
    expect(fx.streamCalls[0]).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
    const input = reviewInput(fx.streamCalls)
    expect(input).toContain('[本轮用户需求]')
    expect(input).toContain('帮我评审一下这个方案')
    expect(input).toContain('产出内容甲')
    expect(input).toContain('产出内容乙')
    expect(agentFixture.append).toHaveBeenCalledTimes(1)
    const [type, payload] = agentFixture.append.mock.calls[0]
    expect(type).toBe('kimi-tide/review')
    expect(payload).toMatchObject({ flowId: 'review', turn: 7, ok: true, reviewer: { provider: 'kimi-coding', model: 'k3' } })
    expect(deps.onReviewEvent).toHaveBeenCalledWith(agentFixture.agent, expect.objectContaining({ ok: true }))
  })

  it('2) 产出为空（无 assistant/message）→ 不发起评审（llm.stream 零调用）', async () => {
    const fx = makeHarness()
    const agentFixture = makeAgent()
    installRouter(fx.ctx as never, new KimiRouter(v5Claimed(), metas(), { info: () => {} }), makeDeps().deps)

    await fx.preStep(agentFixture.agent, 7, text('帮我评审一下这个方案'))
    fx.sessionEvent(agentFixture, userEvent('帮我评审一下这个方案'))
    fx.turnStopping(agentFixture.agent, 7)
    await flush()

    expect(fx.streamCalls).toHaveLength(0)
    expect(agentFixture.append).not.toHaveBeenCalled()
  })

  it('3) 评审流事件回灌（type=kimi-tide/review）→ 不累计、不评审（防环，两端断言）', async () => {
    const fx = makeHarness()
    const agentFixture = makeAgent()
    installRouter(fx.ctx as never, new KimiRouter(v5Claimed(), metas(), { info: () => {} }), makeDeps().deps)

    await armedTurn(fx, agentFixture, 7, '帮我评审一下这个方案', ['真实产出', '第二条'])
    // 回灌：评审事件混进 session/event 流（先于 turn-stopping 到达）
    fx.sessionEvent(agentFixture, {
      type: 'kimi-tide/review',
      seq: ++seq,
      time: 0,
      data: { flowId: 'review', turn: 6, userText: '旧需求', reviewText: '回灌的评审意见XXX', ok: true, durationMs: 1, at: 't' },
    })
    fx.turnStopping(agentFixture.agent, 7)
    await flush()

    // 端一：不评审——只发起本轮一次评审（回灌不触发第二次）
    expect(fx.streamCalls).toHaveLength(1)
    // 端二：不累计——评审输入的产出段不含回灌文本，仅本轮 assistant 文本
    const segment = outputSegment(reviewInput(fx.streamCalls))
    expect(segment).not.toContain('回灌的评审意见XXX')
    expect(segment).toContain('真实产出')
  })

  it('4) 显式 @ 轮（@kimi 评审）→ 不 armed（turn-stopping 后零调用）', async () => {
    const fx = makeHarness()
    const agentFixture = makeAgent()
    installRouter(fx.ctx as never, new KimiRouter(v5Claimed(), metas(), { info: () => {} }), makeDeps().deps)

    await armedTurn(fx, agentFixture, 7, '@kimi 帮我评审', ['产出'])
    fx.turnStopping(agentFixture.agent, 7)
    await flush()

    expect(fx.streamCalls).toHaveLength(0)
    expect(agentFixture.append).not.toHaveBeenCalled()
  })

  it('5) turn 不匹配（armed turn=7，turn-stopping turn=8）→ 不发起评审', async () => {
    const fx = makeHarness()
    const agentFixture = makeAgent()
    installRouter(fx.ctx as never, new KimiRouter(v5Claimed(), metas(), { info: () => {} }), makeDeps().deps)

    await armedTurn(fx, agentFixture, 7, '帮我评审一下这个方案', ['产出'])
    fx.turnStopping(agentFixture.agent, 8)
    await flush()

    expect(fx.streamCalls).toHaveLength(0)
  })

  it('6) interrupted:true 的 assistant/message 不计入产出', async () => {
    const fx = makeHarness()
    const agentFixture = makeAgent()
    installRouter(fx.ctx as never, new KimiRouter(v5Claimed(), metas(), { info: () => {} }), makeDeps().deps)

    await fx.preStep(agentFixture.agent, 7, text('帮我评审一下这个方案'))
    fx.sessionEvent(agentFixture, userEvent('帮我评审一下这个方案'))
    fx.sessionEvent(agentFixture, assistantEvent(7, '完整产出'))
    fx.sessionEvent(agentFixture, assistantEvent(7, '被打断的半截产出', true))
    fx.turnStopping(agentFixture.agent, 7)
    await flush()

    expect(fx.streamCalls).toHaveLength(1)
    const segment = outputSegment(reviewInput(fx.streamCalls))
    expect(segment).toContain('完整产出')
    expect(segment).not.toContain('被打断的半截产出')
  })

  it('7) append 抛错 → 不向上抛、ctx.logger.warn 收到（评审修复 M4）', async () => {
    const fx = makeHarness()
    const agentFixture = makeAgent(() => { throw new Error('session gone') })
    installRouter(fx.ctx as never, new KimiRouter(v5Claimed(), metas(), { info: () => {} }), makeDeps().deps)

    await armedTurn(fx, agentFixture, 7, '帮我评审一下这个方案', ['产出'])
    fx.turnStopping(agentFixture.agent, 7)
    await flush() // 不抛出即通过（unhandled rejection 会使测试失败）

    expect(fx.warns.some((message) => message.includes('review append failed'))).toBe(true)
  })

  it('8) 第二轮 pre-step 覆盖 armed（turn 7→8），两轮评审互相独立、各自 append', async () => {
    const fx = makeHarness()
    const agentFixture = makeAgent()
    installRouter(fx.ctx as never, new KimiRouter(v5Claimed(), metas(), { info: () => {} }), makeDeps().deps)

    await armedTurn(fx, agentFixture, 7, '第一轮需求评审', ['第一轮产出'])
    fx.turnStopping(agentFixture.agent, 7)
    await flush()
    await armedTurn(fx, agentFixture, 8, '第二轮需求评审', ['第二轮产出'])
    fx.turnStopping(agentFixture.agent, 8)
    await flush()

    expect(fx.streamCalls).toHaveLength(2)
    expect(reviewInput(fx.streamCalls, 0)).toContain('第一轮产出')
    expect(reviewInput(fx.streamCalls, 1)).toContain('第二轮产出')
    expect(reviewInput(fx.streamCalls, 1)).not.toContain('第一轮产出')
    expect(agentFixture.append).toHaveBeenCalledTimes(2)
    expect(agentFixture.append.mock.calls[0][1]).toMatchObject({ turn: 7 })
    expect(agentFixture.append.mock.calls[1][1]).toMatchObject({ turn: 8 })
  })

  it('9) onManualReview 收到非 null 函数；effect dispose 后收到 null（重挂载语义）', () => {
    const fx = makeHarness()
    const { deps, onManualReview } = makeDeps()
    const dispose = installRouter(fx.ctx as never, new KimiRouter(v5Claimed(), metas(), { info: () => {} }), deps)

    expect(onManualReview).toHaveBeenCalledTimes(1)
    expect(typeof onManualReview.mock.calls[0][0]).toBe('function')
    dispose()
    expect(onManualReview).toHaveBeenCalledTimes(2)
    expect(onManualReview.mock.calls[1][0]).toBeNull()
  })

  it('10) 手动评审路径：fn(agent) 评审 lastTurn 缓存；注入上下文不覆盖 userText；无缓存 agent 返 ok:false', async () => {
    const fx = makeHarness()
    const agentFixture = makeAgent()
    const fresh = makeAgent()
    const { deps, onManualReview } = makeDeps()
    installRouter(fx.ctx as never, new KimiRouter(v5Claimed(), metas(), { info: () => {} }), deps)
    const manualFn = onManualReview.mock.calls[0][0] as (agent: unknown) => Promise<{ ok: boolean; message: string }>

    // 先 pre-step + turn-stopping 造一轮 lastTurn（自动评审 #1；文本含评审词以武装）
    await armedTurn(fx, agentFixture, 7, '人类的第一轮需求，帮我评审', ['第一轮产出'])
    fx.turnStopping(agentFixture.agent, 7)
    await flush()
    expect(fx.streamCalls).toHaveLength(1)

    // L3：synthetic 注入上下文（source.kind='plugin'）不覆盖 userText
    fx.sessionEvent(agentFixture, userEvent('注入的运行时上下文内容', { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' }))

    const outcome = await manualFn(agentFixture.agent)
    expect(outcome).toEqual({ ok: true, message: '评审已发起' })
    await flush()
    expect(fx.streamCalls).toHaveLength(2)
    expect(reviewInput(fx.streamCalls, 1)).toContain('人类的第一轮需求')
    expect(reviewInput(fx.streamCalls, 1)).not.toContain('注入的运行时上下文内容')
    expect(agentFixture.append).toHaveBeenCalledTimes(2)
    expect(agentFixture.append.mock.calls[1][1]).toMatchObject({ turn: -1, userText: '人类的第一轮需求，帮我评审' })

    // 无缓存 agent → ok:false 可呈现文案
    await expect(manualFn(fresh.agent)).resolves.toEqual({ ok: false, message: '无可评审的上一轮' })
  })

  it(`11) 产出累计超 REVIEW_INPUT_LIMIT（${REVIEW_INPUT_LIMIT}）停收：output 段以「…（已截断）」收尾且不超限（评审修复 L5）`, async () => {
    const fx = makeHarness()
    const agentFixture = makeAgent()
    installRouter(fx.ctx as never, new KimiRouter(v5Claimed(), metas(), { info: () => {} }), makeDeps().deps)

    await fx.preStep(agentFixture.agent, 1, text('帮我评审一下这个方案'))
    fx.sessionEvent(agentFixture, userEvent('帮我评审一下这个方案'))
    fx.sessionEvent(agentFixture, assistantEvent(1, 'x'.repeat(REVIEW_INPUT_LIMIT)))
    fx.sessionEvent(agentFixture, assistantEvent(1, 'y'.repeat(500)))
    fx.turnStopping(agentFixture.agent, 1)
    await flush()

    expect(fx.streamCalls).toHaveLength(1)
    const segment = outputSegment(reviewInput(fx.streamCalls))
    expect(segment.endsWith('…（已截断）')).toBe(true)
    expect(segment.length).toBeLessThanOrEqual(REVIEW_INPUT_LIMIT)
  })

  it('12) 无 turn-stopping 的关闭路径容忍锁定（评审修复 L2）：stale armed 静默跳过，下一轮 pre-step 正常覆盖', async () => {
    const fx = makeHarness()
    const agentFixture = makeAgent()
    installRouter(fx.ctx as never, new KimiRouter(v5Claimed(), metas(), { info: () => {} }), makeDeps().deps)

    // armed turn=7，但只收到 turn=8 的 turn-stopping（≠armed.turn）→ 本轮不评审
    await fx.preStep(agentFixture.agent, 7, text('帮我评审一下这个方案'))
    fx.sessionEvent(agentFixture, userEvent('帮我评审一下这个方案'))
    fx.sessionEvent(agentFixture, assistantEvent(7, '第七轮产出'))
    fx.turnStopping(agentFixture.agent, 8)
    await flush()
    expect(fx.streamCalls).toHaveLength(0)

    // 下一轮 pre-step(turn=8) 正常覆盖 armed——评审照常发起（静默跳过不残留）
    await armedTurn(fx, agentFixture, 8, '继续评审这个方案', ['第八轮产出'])
    fx.turnStopping(agentFixture.agent, 8)
    await flush()
    expect(fx.streamCalls).toHaveLength(1)
    expect(reviewInput(fx.streamCalls)).toContain('第八轮产出')
  })

  it('13) reviewer 不可用（gated 判定 false）→ 不 armed、不评审（R7：运行期武装尊重可用性）', async () => {
    const fx = makeHarness()
    const agentFixture = makeAgent()
    installRouter(fx.ctx as never, new KimiRouter(v5Claimed(), metas(false), { info: () => {} }), makeDeps().deps)

    await armedTurn(fx, agentFixture, 7, '帮我评审一下这个方案', ['产出'])
    fx.turnStopping(agentFixture.agent, 7)
    await flush()

    expect(fx.streamCalls).toHaveLength(0)
    expect(agentFixture.append).not.toHaveBeenCalled()
  })
})
