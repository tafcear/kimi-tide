import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { installRouter, KimiRouter, type RouterConfig } from '../src/router.js'

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

const CONFIG: RouterConfig = {
  mode: 'cost',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'k3' },
  escalateWhen: { patterns: ['审查'] },
  premiumBudget: 0.2,
}

const baseConfig = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

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
    installRouter(ctx as never, new KimiRouter(CONFIG, { info: () => {} }))

    await dispatch.preStep({ agent, messages: [textMessage('@kimi 请审查这段代码')], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    expect(config).toMatchObject({ provider: 'kimi-tide', model: 'k3' })
  })

  it('escalates on pattern match at the first step of the turn', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG, { info: () => {} }))

    await dispatch.preStep({ agent, messages: [textMessage('请审查一下这个实现')], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    expect(config).toMatchObject({ provider: 'kimi-tide', model: 'k3' })
  })

  it('does not re-decide inside the tool loop (step > 1 leaves the logged config alone)', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG, { info: () => {} }))

    // Realistic loop shape: pre-step(1) → request(1) → pre-step(2) → request(2).
    await dispatch.preStep({ agent, messages: [textMessage('普通任务')], turn: 1, step: 1, signal: signal() })
    const first = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)
    expect(first).toEqual(baseConfig) // keep decision: no escalation matched

    await dispatch.preStep({ agent, messages: [], turn: 1, step: 2, signal: signal() })
    const second = await dispatch.request({ agent, turn: 1, step: 2, signal: signal() }, baseConfig)

    expect(second).toEqual(baseConfig)
  })
})

describe('installRouter image guard (direction: text-only primary → multimodal Kimi)', () => {
  it('reroutes an image-bearing keep step from the text-only primary to premium', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG, { info: () => {} }))

    // '看图' matches no escalation pattern → decision is keep; the guard must
    // still move the image-bearing step off the text-only deepseek route.
    const imageMessage = {
      role: 'user',
      content: [{ type: 'text', text: '看图说话' }, { type: 'image' }],
    } as unknown as UserMessage
    await dispatch.preStep({ agent, messages: [imageMessage], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    expect(config).toMatchObject({ provider: 'kimi-tide', model: 'k3' })
  })

  it('leaves an image-bearing step already routed to multimodal Kimi untouched', async () => {
    const { ctx, dispatch } = makeCtx()
    installRouter(ctx as never, new KimiRouter(CONFIG, { info: () => {} }))

    const imageMessage = {
      role: 'user',
      content: [{ type: 'text', text: '@kimi 看这张图' }, { type: 'image' }],
    } as unknown as UserMessage
    await dispatch.preStep({ agent, messages: [imageMessage], turn: 1, step: 1, signal: signal() })
    const config = await dispatch.request({ agent, turn: 1, step: 1, signal: signal() }, baseConfig)

    expect(config).toMatchObject({ provider: 'kimi-tide', model: 'k3' })
  })
})
