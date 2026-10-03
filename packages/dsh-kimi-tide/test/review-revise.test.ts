// test/review-revise.test.ts（v1.4.0 评审闭环 T2：自动/手动退回编排）
//
// 验收判据（spec §5 单测 2-7）：
//   2) autoRevise=false ⇒ 零 steer
//   3) autoRevise=true + 不通过 ⇒ 恰一次 steer，且注入文本含评审意见
//   4) 达 rounds 上限 ⇒ 停，后续不通过不再 steer
//   5) 评审 ok:false ⇒ 不 steer
//   6) 幂等：同一 turn 重复投递只修一次
//   7) 手动退回：命令可达、无开关也生效、同样计上限
// 另加：复检（recheck 默认开 / 关）、修订轮不重复武装评审（source 判别）。
//
// 夹具沿用 review-orchestration.test.ts 的 fake ctx/agent 模式（把监听器存进 Map
// 后直呼，复刻 cordis 的 waterfall/serial 派发语义）。
import { describe, expect, it, vi } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { DEFAULT_CONFIG_V5, DEFAULT_FLOWS, type CandidateMeta, type ReviewFlow } from '../src/config.js'
import { ImageStateStore } from '../src/image-state.js'
import { installRouter, KimiRouter } from '../src/router.js'
import { REVISE_SOURCE_KIND } from '../src/review.js'
import { Transcriber } from '../src/transcribe.js'

const PASS_TEXT = '一、[可选] 命名可以更准\n结论：通过'
const FAIL_TEXT = '一、[阻塞] 空指针未处理\n二、[建议] 补回归测试\n结论：不通过'
const CONDITIONAL_TEXT = '一、[建议] 注释不足\n结论：有条件通过'

/** review 流（keywords 武装）+ 指定开关的配置。 */
const config = (over: Partial<ReviewFlow> = {}) => {
  const c = DEFAULT_CONFIG_V5()
  c.activePreset = 'capability'
  c.keywordGroups = { ...c.keywordGroups, review2: ['复查'] }
  c.flows = {
    ...DEFAULT_FLOWS(),
    review: { ...DEFAULT_FLOWS().review, trigger: 'keywords', keywordGroup: 'review', ...over } as ReviewFlow,
  }
  return c
}

/** 双评审流形态（分账用例）：review 用 review 词组，reviewB 用 review2 词组。 */
const twoFlowConfig = (over: Partial<ReviewFlow> = {}) => {
  const c = config(over)
  c.flows = {
    ...c.flows,
    reviewB: {
      type: 'review',
      reviewer: { provider: 'kimi-coding', model: 'k3' },
      trigger: 'keywords',
      keywordGroup: 'review2',
      rounds: 1,
      autoRevise: true,
      recheck: false,
    },
  }
  return c
}

const metas = (): CandidateMeta[] => [
  { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available: true },
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], available: true },
]

const text = (t: string): UserMessage =>
  ({ role: 'user', content: [{ type: 'text', text: t }] }) as unknown as UserMessage

const flush = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)) }

type ReviewStep = { text?: string; fail?: boolean }

/** fake ctx：on() 收集监听器；llm.stream 按队列吐评审结论。 */
function makeHarness(steps: ReviewStep[]) {
  const listeners = new Map<string, Array<(payload: unknown, next?: () => Promise<unknown>) => unknown>>()
  const warns: string[] = []
  const streamCalls: Array<{ provider: string; model: string; messages: Array<{ content: Array<{ type: string; text?: string }> }> }> = []
  const ctx = {
    logger: { info: () => {}, warn: (message: string) => { warns.push(message) } },
    effect: (execute: () => unknown) => {
      const cleanup = execute()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
    on: (name: string, listener: (payload: unknown, next?: () => Promise<unknown>) => unknown) => {
      const arr = listeners.get(name) ?? []
      arr.push(listener)
      listeners.set(name, arr)
      return () => {}
    },
    llm: {
      stream: (options: unknown) => {
        streamCalls.push(options as never)
        const step = steps.shift() ?? { text: PASS_TEXT }
        async function* fake(): AsyncGenerator<unknown> {
          if (step.fail === true) {
            yield { type: 'finish', reason: { kind: 'error', failure: { message: 'review boom', code: 'E' } } }
            return
          }
          yield { type: 'text-delta', text: step.text ?? '' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
        return fake()
      },
    },
  }
  const preStep = async (agent: unknown, turn: number, message: UserMessage): Promise<void> => {
    for (const listener of [...(listeners.get('agent/pre-step') ?? [])]) {
      await listener({ agent, messages: [message], turn, step: 1, signal: new AbortController().signal }, () => Promise.resolve({ kind: 'enter' }))
    }
  }
  const turnStopping = (agent: unknown, turn: number): void => {
    for (const listener of [...(listeners.get('agent/turn-stopping') ?? [])]) listener({ agent, turn, signal: new AbortController().signal })
  }
  return { ctx, warns, streamCalls, preStep, turnStopping }
}

/** fake agent：session/event 监听器捕获 + append 记录 + steer 记录。 */
function makeAgent() {
  const sessionListeners: Array<(session: unknown, event: unknown) => void> = []
  const append = vi.fn()
  const steer = vi.fn()
  const agent = {
    ctx: {
      on: (name: string, listener: (session: unknown, event: unknown) => void) => {
        if (name === 'session/event') sessionListeners.push(listener)
        return () => {}
      },
    },
    session: { append },
    steer,
  }
  return { agent, sessionListeners, append, steer }
}

let seq = 0
const userEvent = (t: string, source: { kind: string } = { kind: 'user' }) => ({
  type: 'user/message',
  seq: ++seq,
  time: 0,
  data: { role: 'user', content: [{ type: 'text', text: t }], source, id: `u${seq}` },
})
const assistantEvent = (turn: number, t: string) => ({
  type: 'assistant/message',
  seq: ++seq,
  time: 0,
  data: {
    turn,
    step: 1,
    message: { role: 'assistant', content: [{ type: 'text', text: t }], source: { kind: 'model', provider: 'kimi-coding', model: 'k3' }, id: `a${seq}` },
  },
})

function makeDeps(over: Record<string, unknown> = {}) {
  const onReviewEvent = vi.fn()
  const onReviewRevise = vi.fn()
  const onManualReview = vi.fn()
  let manualRevise: ((agent: unknown) => Promise<{ ok: boolean; message: string }>) | null = null
  let manualReview: ((agent: unknown) => Promise<{ ok: boolean; message: string }>) | null = null
  const deps = {
    images: new ImageStateStore(),
    transcriber: new Transcriber({ caller: async () => '转述文字' }),
    resolveImages: () => [],
    onDecision: () => {},
    onReviewEvent,
    onReviewRevise,
    onManualReview: (fn: typeof manualReview) => { manualReview = fn },
    onManualRevise: (fn: typeof manualRevise) => { manualRevise = fn },
    ...over,
  }
  return { deps, onReviewEvent, onReviewRevise, manualRevise: () => manualRevise, manualReview: () => manualReview }
}

/** 装配夹具：返回已安装的路由句柄。 */
function setup(
  over: Partial<ReviewFlow> = {},
  reviewSteps: ReviewStep[] = [],
  depsOver: Record<string, unknown> = {},
  cfg: ReturnType<typeof config> = config(over),
) {
  const fx = makeHarness(reviewSteps)
  const agentFx = makeAgent()
  const d = makeDeps(depsOver)
  installRouter(fx.ctx as never, new KimiRouter(cfg, metas(), { info: () => {} }), d.deps as never)
  return { fx, agentFx, ...d }
}

/** 把一条修订注入投给 feed（复检身份闸认的就是这条）。 */
function feedReviseInjection(agentFx: ReturnType<typeof makeAgent>, text = '〔月汐 · 按意见修订〕…'): void {
  for (const listener of [...agentFx.sessionListeners]) listener({}, userEvent(text, { kind: REVISE_SOURCE_KIND }))
}

/** 修订轮（turn）的事件序：注入 → 产出（复检身份闸认的就是那条注入）。 */
function reviseTurn(agentFx: ReturnType<typeof makeAgent>, turn: number, output: string): void {
  feedReviseInjection(agentFx)
  for (const listener of [...agentFx.sessionListeners]) listener({}, assistantEvent(turn, output))
}

/** 一轮完整事件序：武装 pre-step → 人类输入 → 产出 → 轮关闭。 */
async function armedTurn(
  fx: ReturnType<typeof makeHarness>,
  agentFx: ReturnType<typeof makeAgent>,
  turn: number,
  userText: string,
  output: string,
): Promise<void> {
  await fx.preStep(agentFx.agent, turn, text(userText))
  for (const listener of [...agentFx.sessionListeners]) listener({}, userEvent(userText))
  for (const listener of [...agentFx.sessionListeners]) listener({}, assistantEvent(turn, output))
  fx.turnStopping(agentFx.agent, turn)
}

/** steer 调用里的文本与源。 */
const steeredText = (steer: ReturnType<typeof vi.fn>, index = 0): string =>
  (steer.mock.calls[index]?.[0]?.content?.[0]?.text ?? '') as string

/** 会话 append 里某类型的载荷列表。 */
const appended = (append: ReturnType<typeof vi.fn>, type: string): Record<string, unknown>[] =>
  append.mock.calls.filter((call) => call[0] === type).map((call) => call[1] as Record<string, unknown>)

describe('评审闭环：自动修订（spec §3.2/§3.4）', () => {
  it('2) autoRevise=false ⇒ 结论再差也零 steer（只有评审事件）', async () => {
    const s = setup({ autoRevise: false }, [{ text: FAIL_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()

    expect(s.fx.streamCalls).toHaveLength(1)
    expect(s.agentFx.steer).not.toHaveBeenCalled()
    expect(appended(s.agentFx.append, 'kimi-tide/review-revise')).toHaveLength(0)
    expect(appended(s.agentFx.append, 'kimi-tide/review')).toHaveLength(1)
  })

  it('3) autoRevise=true + 不通过 ⇒ 恰一次 steer，注入文本含评审意见与结论；事件与回调齐备', async () => {
    const s = setup({ autoRevise: true }, [{ text: FAIL_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()

    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)
    const message = s.agentFx.steer.mock.calls[0]![0] as { source: { kind: string }; content: Array<{ text: string }> }
    expect(message.source.kind).toBe(REVISE_SOURCE_KIND)
    expect(steeredText(s.agentFx.steer)).toContain('[阻塞] 空指针未处理')
    expect(steeredText(s.agentFx.steer)).toContain('不通过')
    // 评审事件带结论（spec §3.3「解析结果写入事件载荷」）
    expect(appended(s.agentFx.append, 'kimi-tide/review')[0]).toMatchObject({ verdict: 'fail', ok: true })
    // 退回留痕（spec §3.6）
    const reviseEvents = appended(s.agentFx.append, 'kimi-tide/review-revise')
    expect(reviseEvents).toHaveLength(1)
    expect(reviseEvents[0]).toMatchObject({ flowId: 'review', turn: 3, reason: 'auto', verdict: 'fail', reviseIndex: 1 })
    expect(s.onReviewRevise).toHaveBeenCalledWith(s.agentFx.agent, expect.objectContaining({ reason: 'auto' }))
  })

  it('3b) 「有条件通过」也触发（用户裁定 ①）', async () => {
    const s = setup({ autoRevise: true }, [{ text: CONDITIONAL_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)
    expect(appended(s.agentFx.append, 'kimi-tide/review')[0]).toMatchObject({ verdict: 'conditional' })
  })

  it('3c) 结论=通过 ⇒ 零 steer（不过度打扰）', async () => {
    const s = setup({ autoRevise: true }, [{ text: PASS_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()
    expect(s.agentFx.steer).not.toHaveBeenCalled()
  })

  it('5) 评审 ok:false ⇒ 不 steer（失败载荷带着 verdict=unknown 落库）', async () => {
    const s = setup({ autoRevise: true }, [{ fail: true }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()

    expect(appended(s.agentFx.append, 'kimi-tide/review')[0]).toMatchObject({ ok: false, verdict: 'unknown' })
    expect(s.agentFx.steer).not.toHaveBeenCalled()
  })

  it('6) 幂等：同一 turn 重复投递只修一次', async () => {
    const s = setup({ autoRevise: true }, [{ text: FAIL_TEXT }, { text: FAIL_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()
    // 宿主重放同一轮（同 turn 又关了两次）：第二次评审照跑，但不得再 steer。
    s.fx.turnStopping(s.agentFx.agent, 3)
    await flush()

    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)
    expect(appended(s.agentFx.append, 'kimi-tide/review-revise')).toHaveLength(1)
  })

  it('4) 达 rounds 上限即停：第 2 次不通过落「已停（达上限）」事件且不再 steer', async () => {
    // rounds=1 ⇒ 只允许一次修订；复检（默认开）再判不通过时必须停下。
    const s = setup({ autoRevise: true, rounds: 1 }, [{ text: FAIL_TEXT }, { text: FAIL_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)

    // 修订轮（turn 4）：注入 → 产出 → 轮关闭 ⇒ 复检不通过 → 上限
    reviseTurn(s.agentFx, 4, '修订后的产出')
    s.fx.turnStopping(s.agentFx.agent, 4)
    await flush()

    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)
    const stops = appended(s.agentFx.append, 'kimi-tide/review-revise').filter((e) => e.stopped === 'limit')
    expect(stops).toHaveLength(1)
    expect(stops[0]).toMatchObject({ turn: 4, verdict: 'fail', reviseIndex: 1 })
  })
})

describe('评审闭环：复检（spec §3.5/§4）', () => {
  it('recheck 默认开：修订轮的轮末再评一轮', async () => {
    const s = setup({ autoRevise: true }, [{ text: FAIL_TEXT }, { text: PASS_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()
    expect(s.fx.streamCalls).toHaveLength(1)

    reviseTurn(s.agentFx, 4, '修订后的产出')
    s.fx.turnStopping(s.agentFx.agent, 4)
    await flush()

    expect(s.fx.streamCalls).toHaveLength(2)
    expect((s.fx.streamCalls[1]!.messages[0]!.content[0]!.text ?? '')).toContain('修订后的产出')
    expect(appended(s.agentFx.append, 'kimi-tide/review')).toHaveLength(2)
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1) // 复检判通过 ⇒ 不再退回
  })

  it('recheck=false ⇒ 修订轮不再评（少一次评审调用）', async () => {
    const s = setup({ autoRevise: true, recheck: false }, [{ text: FAIL_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()

    reviseTurn(s.agentFx, 4, '修订后的产出')
    s.fx.turnStopping(s.agentFx.agent, 4)
    await flush()

    expect(s.fx.streamCalls).toHaveLength(1)
    expect(appended(s.agentFx.append, 'kimi-tide/review')).toHaveLength(1)
  })

  it('复核 F1：用户插话那一轮不吃复检标记（不把无关产出当修订产出评）', async () => {
    // 时序：turn 3 评审 → 自动退回（预期 turn 4 承载修订）；但 turn 4 是用户自己
    // 插的一句话（**没有**本源注入）⇒ 复检必须跳过，而不是拿这轮产出评一份张冠李戴的卡。
    const s = setup({ autoRevise: true }, [{ text: FAIL_TEXT }, { text: FAIL_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)

    // turn 4：用户插话（人类消息 + 产出），没有注入
    for (const listener of [...s.agentFx.sessionListeners]) listener({}, userEvent('我再补充一句'))
    for (const listener of [...s.agentFx.sessionListeners]) listener({}, assistantEvent(4, '用户插话那轮的产出'))
    s.fx.turnStopping(s.agentFx.agent, 4)
    await flush()

    expect(s.fx.streamCalls).toHaveLength(1) // 只跑过第 3 轮那次评审
    expect(appended(s.agentFx.append, 'kimi-tide/review')).toHaveLength(1)
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)
  })

  it('修订轮不重复武装评审：注入文本含「意见/评审」也不额外起评审', async () => {
    // recheck 关闭 ⇒ 只剩「武装」这一条可能起评审的路径；注入消息自带源标记，
    // 必须被 pre-step 跳过（否则一次修订触发两次评审 = 配额翻倍）。
    const s = setup({ autoRevise: true, recheck: false }, [{ text: FAIL_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()
    const reviseMessage = s.agentFx.steer.mock.calls[0]![0] as UserMessage

    await s.fx.preStep(s.agentFx.agent, 4, reviseMessage)
    feedReviseInjection(s.agentFx)
    for (const listener of [...s.agentFx.sessionListeners]) listener({}, assistantEvent(4, '修订后的产出'))
    s.fx.turnStopping(s.agentFx.agent, 4)
    await flush()

    expect(s.fx.streamCalls).toHaveLength(1)
  })
})

describe('评审闭环：手动退回（spec §3.1/§5 判据 7）', () => {
  it('7) 手动退回：无开关也生效、注入与事件 reason=manual', async () => {
    const s = setup({ autoRevise: false }, [{ text: FAIL_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()
    expect(s.agentFx.steer).not.toHaveBeenCalled()

    const manualRevise = s.manualRevise()
    expect(manualRevise).not.toBeNull()
    const result = await manualRevise!(s.agentFx.agent)

    expect(result.ok).toBe(true)
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)
    expect(appended(s.agentFx.append, 'kimi-tide/review-revise')[0]).toMatchObject({ reason: 'manual', verdict: 'fail' })
  })

  it('7b) 手动退回同样计上限（rounds=1 时第二次手动被拒）', async () => {
    const s = setup({ autoRevise: false, rounds: 1 }, [{ text: FAIL_TEXT }, { text: FAIL_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()

    const manualRevise = s.manualRevise()!
    expect((await manualRevise(s.agentFx.agent)).ok).toBe(true)
    const second = await manualRevise(s.agentFx.agent)
    expect(second.ok).toBe(false)
    expect(second.message).toContain('上限')
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)
    expect(appended(s.agentFx.append, 'kimi-tide/review-revise').filter((e) => e.stopped === 'limit')).toHaveLength(1)
  })

  it('7c) 没有可退回的评审结论 ⇒ 明确文案、不 steer', async () => {
    // 不先跑评审：台账里没有 lastReview，退回必须当场拒绝（而不是编一条空意见）。
    const s = setup({ autoRevise: false })
    const result = await s.manualRevise()!(s.agentFx.agent)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('评审')
    expect(s.agentFx.steer).not.toHaveBeenCalled()
  })

  it('7d) steer 抛错 ⇒ 不落退回事件、返回可呈现失败（不炸编排）', async () => {
    const s = setup({ autoRevise: true }, [{ text: FAIL_TEXT }])
    s.agentFx.steer.mockImplementation(() => { throw new Error('driver disposed') })
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()

    expect(appended(s.agentFx.append, 'kimi-tide/review-revise')).toHaveLength(0)
    expect(s.fx.warns.join('\n')).toContain('revise failed')
  })
})

describe('评审闭环：复核补测（F2/F3 + 判据 6/7 盲区）', () => {
  it('F2 幂等跨 reason：手动先退过第 N 轮 ⇒ 第 N 轮的自动评审迟到送达也不再退', async () => {
    // 构造：第 3 轮判「通过」（不触发自动退回）→ 用户手动退回（手动不设结论闸）
    // → 第 3 轮的另一次评审（判不通过）迟到送达 ⇒ 因为手动已把 turns[N] 写上，
    // 自动支的幂等闸必须拦住它（否则同一轮被退两次）。
    const s = setup({ autoRevise: true, rounds: 3, recheck: false }, [{ text: PASS_TEXT }, { text: FAIL_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()
    expect(s.agentFx.steer).not.toHaveBeenCalled() // 判通过 ⇒ 不自动退

    const manualRevise = s.manualRevise()!
    expect((await manualRevise(s.agentFx.agent)).ok).toBe(true)
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)

    // 第 3 轮重放（宿主重放/第二条评审流）：再评一次，判不通过
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()

    expect(appended(s.agentFx.append, 'kimi-tide/review')).toHaveLength(2)
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1) // Fails if: 手动没写 turns 键 ⇒ 同轮再退一次
  })

  it('F2 按流分账：A 流用掉额度不影响 B 流（rounds 是每流配置）', async () => {
    const s = setup({ autoRevise: true, rounds: 1 }, [{ text: FAIL_TEXT }, { text: FAIL_TEXT }], {}, twoFlowConfig({ autoRevise: true, rounds: 1, recheck: false }))
    // 第 3 轮：review 流武装（「审查」）
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)

    // 第 4 轮：reviewB 流武装（「复查」）——若两流共用一本账，这里会被 A 流用尽的额度挡住
    await armedTurn(s.fx, s.agentFx, 4, '帮我复查这个方案', '产出乙')
    await flush()

    expect(s.agentFx.steer).toHaveBeenCalledTimes(2)
    expect(appended(s.agentFx.append, 'kimi-tide/review-revise').map((e) => e.flowId)).toEqual(['review', 'reviewB'])
  })

  it('7 反向边界：判「通过」也允许手动退回（人工不做结论闸）', async () => {
    const s = setup({ autoRevise: false, recheck: false }, [{ text: PASS_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()

    const result = await s.manualRevise()!(s.agentFx.agent)
    expect(result.ok).toBe(true)
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)
    expect(appended(s.agentFx.append, 'kimi-tide/review-revise')[0]).toMatchObject({ verdict: 'pass', reason: 'manual' })
  })

  it('F3 反证：autoRevise=false 时，复检判不通过也不会自动再退（手动一次 ≠ 自动链）', async () => {
    // 复核报告确认缺陷 3 主张「手动一次触发自动链」——本用例即其反证：
    // consumeReview 的 autoRevise 闸对复检同样生效，复检只出卡不动手。
    const s = setup({ autoRevise: false }, [{ text: FAIL_TEXT }, { text: FAIL_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()
    expect(s.agentFx.steer).not.toHaveBeenCalled()

    expect((await s.manualRevise()!(s.agentFx.agent)).ok).toBe(true)
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)

    // 复检轮（注入 → 产出 → 关轮），复检判不通过
    reviseTurn(s.agentFx, 4, '修订后的产出')
    s.fx.turnStopping(s.agentFx.agent, 4)
    await flush()

    expect(appended(s.agentFx.append, 'kimi-tide/review')).toHaveLength(2)
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1) // Fails if: 复检绕过了 autoRevise 闸
    expect(appended(s.agentFx.append, 'kimi-tide/review-revise')).toHaveLength(1)
  })

  it('7 手动评审（turn:-1）后的退回：复检基准取 lastTurn 真实轮号，落在修订轮上', async () => {
    const s = setup({ autoRevise: false })
    // 普通一轮（无武装：不含评审关键词）→ 手动评审 → 手动退回
    await s.fx.preStep(s.agentFx.agent, 3, text('写个函数'))
    for (const listener of [...s.agentFx.sessionListeners]) listener({}, userEvent('写个函数'))
    for (const listener of [...s.agentFx.sessionListeners]) listener({}, assistantEvent(3, '产出甲'))
    s.fx.turnStopping(s.agentFx.agent, 3)
    await flush()
    expect(s.fx.streamCalls).toHaveLength(0)

    const manualReview = s.manualReview()!
    expect((await manualReview(s.agentFx.agent)).ok).toBe(true)
    await flush()
    expect(appended(s.agentFx.append, 'kimi-tide/review')[0]).toMatchObject({ turn: -1 })

    expect((await s.manualRevise()!(s.agentFx.agent)).ok).toBe(true)
    expect(s.agentFx.steer).toHaveBeenCalledTimes(1)

    // 修订轮 4：复检应落在这里（afterTurn 取自 lastTurn 的真实轮号 3，而非载荷的 -1）
    reviseTurn(s.agentFx, 4, '修订后的产出')
    s.fx.turnStopping(s.agentFx.agent, 4)
    await flush()
    expect(s.fx.streamCalls).toHaveLength(2)
  })

  it('4 上限账目：rounds=2 时手动连点第三次被拒，且账本按次数累计', async () => {
    const s = setup({ autoRevise: false, rounds: 2, recheck: false }, [{ text: FAIL_TEXT }])
    await armedTurn(s.fx, s.agentFx, 3, '帮我审查这个方案', '产出甲')
    await flush()

    const manualRevise = s.manualRevise()!
    expect((await manualRevise(s.agentFx.agent)).ok).toBe(true)
    expect((await manualRevise(s.agentFx.agent)).ok).toBe(true)
    const third = await manualRevise(s.agentFx.agent)

    expect(third.ok).toBe(false)
    expect(third.message).toContain('上限')
    expect(s.agentFx.steer).toHaveBeenCalledTimes(2)
    const events = appended(s.agentFx.append, 'kimi-tide/review-revise')
    expect(events.filter((e) => e.stopped === 'limit')).toHaveLength(1)
    expect(events.filter((e) => e.stopped === undefined).map((e) => e.reviseIndex)).toEqual([1, 2])
  })
})
