import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { DEFAULT_CONFIG_V4, type CandidateMeta, type RouterConfigV4 } from '../src/config.js'
import { installRouter, KimiRouter } from '../src/router.js'

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
 */

const METAS: CandidateMeta[] = [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], costTier: 'mid', available: true },
  { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], costTier: 'mid', available: true },
  { provider: 'kimi-coding', model: 'kimi-for-coding', modalities: ['text', 'image'], costTier: 'mid', available: true },
]

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

// 与省钱预设默认（deepseek-official/deepseek-v4-flash）不同的哨兵路由：
// 打底语义下「普通任务」route 到预设默认，若 baseConfig 与预设默认相同，
// `toEqual(baseConfig)` 会失去 route/keep 判别力（评审建议，T3 延期 Minor）。
const baseConfig = { provider: 'sentinel-provider', model: 'sentinel-model' }
const SAVING_DEFAULT = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

interface Listener {
  (payload: unknown, next: () => Promise<unknown>): Promise<unknown>
}

function makeCtx() {
  const listeners = new Map<string, Listener[]>()
  const logs: string[] = []
  const ctx = {
    logger: { info: (message: string) => logs.push(message) },
    effect: (execute: () => unknown) => {
      execute()
      return () => {}
    },
    on: (name: string, listener: Listener) => {
      const arr = listeners.get(name) ?? []
      arr.push(listener)
      listeners.set(name, arr)
      return () => {}
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
  return { ctx, dispatch, logs }
}

/** Opaque agent identity — agentEvents() injects it as payload.agent. */
const agent = {}

function signal(): AbortSignal {
  return new AbortController().signal
}

function textMessage(text: string): UserMessage {
  return { role: 'user', content: [{ type: 'text', text }] } as unknown as UserMessage
}

describe('installRouter step contract (regression: step===0 gate idled the router)', () => {
  it('routes @kimi on the first model step exactly as dsh-agent-loop sends it (payload.step === 1)', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }))

    await dispatch.preStep({ agent, messages: [textMessage('@kimi 请审查这段代码')], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    expect(config).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
  })

  it('escalates on pattern match at the first step of the turn', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }))

    await dispatch.preStep({ agent, messages: [textMessage('请审查一下这个实现')], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    expect(config).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
  })

  it('does not re-decide inside the tool loop (step > 1 leaves the logged config alone)', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }))

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
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }))

    // '看图说话' 不命中关键词规则，但带图命中省钱预设的 image 规则 → k3；
    // request 侧护栏作为兜底仍在（目标已多模态时不再改道）。
    const imageMessage = {
      role: 'user',
      content: [{ type: 'text', text: '看图说话' }, { type: 'image' }],
    } as unknown as UserMessage
    await dispatch.preStep({ agent, messages: [imageMessage], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    expect(config).toMatchObject({ provider: 'kimi-coding', model: 'k3' })
  })

  it('leaves an image-bearing step already routed to multimodal Kimi untouched', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }))

    const imageMessage = {
      role: 'user',
      content: [{ type: 'text', text: '@kimi 看这张图' }, { type: 'image' }],
    } as unknown as UserMessage
    await dispatch.preStep({ agent, messages: [imageMessage], turn: 1, step: 1, signal: signal() })
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
  it('keeps a later text-only turn on the multimodal route after an image turn', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }))

    const imageMessage = {
      role: 'user',
      content: [{ type: 'text', text: '看图说话' }, { type: 'image' }],
    } as unknown as UserMessage
    await dispatch.preStep({ agent, messages: [imageMessage], turn: 1, step: 1, signal: signal() })
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
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }))

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
    installRouter(ctx as never, new KimiRouter(CONFIG(), METAS, { info: () => {} }))

    expect(await dispatch.admission({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })).toBe(true)
  })

  it('leaves the host rejection in charge when the pool holds no multimodal candidate', async () => {
    const { ctx, dispatch } = makeCtx()
    const textOnlyMetas = METAS.map((m) => ({ ...m, modalities: ['text'] }))
    installRouter(ctx as never, new KimiRouter(CONFIG(), textOnlyMetas, { info: () => {} }))

    expect(await dispatch.admission({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })).toBeUndefined()
  })

  it('does not claim when the router is not mounted (activePreset null)', async () => {
    const { ctx, dispatch } = makeCtx()
    const off = CONFIG()
    off.activePreset = null
    installRouter(ctx as never, new KimiRouter(off, METAS, { info: () => {} }))

    expect(await dispatch.admission({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })).toBeUndefined()
  })
})
