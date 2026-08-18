import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import {
  applyImageGuard,
  canClaimImageAdmission,
  KimiRouter,
  messagesContainImage,
  textOnlyProviders,
  type RouterConfig,
} from '../src/router.js'

/**
 * Real capability matrix (verified in @earendil-works/pi-ai provider data,
 * 2026-08-18): deepseek-v4-flash/pro declare `input: ["text"]` (text-only),
 * the Kimi k3 family declares `input: ["text","image"]` (multimodal). The
 * v1 assumption was inverted — the image guard must move image-bearing
 * steps OFF the text-only primary ONTO multimodal Kimi, never the reverse.
 */
const BASE: RouterConfig = {
  mode: 'capability',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
  premiumLong: { provider: 'kimi-tide', model: 'k3' },
}

function userMessage(blocks: Array<{ type: string; text?: string }>): UserMessage {
  return { role: 'user', content: blocks } as unknown as UserMessage
}

describe('messagesContainImage', () => {
  it('detects image blocks in user messages', () => {
    expect(messagesContainImage([userMessage([{ type: 'text', text: 'hi' }, { type: 'image' }])])).toBe(true)
  })

  it('ignores text-only batches', () => {
    expect(messagesContainImage([userMessage([{ type: 'text', text: 'hi' }])])).toBe(false)
  })
})

describe('textOnlyProviders (real capability matrix)', () => {
  it('defaults to the primary provider (deepseek-v4-* is text-only per pi-ai catalog)', () => {
    expect([...textOnlyProviders(BASE)]).toEqual(['deepseek-official'])
  })

  it('honors an explicit config override', () => {
    const config: RouterConfig = { ...BASE, textOnlyProviders: ['deepseek-official', 'other-text'] }
    expect([...textOnlyProviders(config)].sort()).toEqual(['deepseek-official', 'other-text'])
  })
})

describe('image guard (direction: text-only route → multimodal Kimi)', () => {
  it('reroutes an image-bearing step from the text-only primary to the multimodal premium', () => {
    const guard = applyImageGuard({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, BASE, true)
    expect(guard).not.toBeNull()
    expect(guard!.target).toEqual(BASE.premium)
  })

  it('guards keep decisions too: cost mode keeps the primary, image still escalates to Kimi', () => {
    const router = new KimiRouter({ ...BASE, mode: 'cost' }, { info: () => {} })
    const decision = router.decide([userMessage([{ type: 'image' }])], 1)
    expect(decision.kind).toBe('keep')
    const guard = router.guardImage({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, true)
    expect(guard?.target.provider).toBe('kimi-tide')
  })

  it('leaves multimodal Kimi targets alone', () => {
    expect(applyImageGuard({ provider: 'kimi-tide', model: 'k3' }, BASE, true)).toBeNull()
    expect(applyImageGuard({ provider: 'kimi-tide', model: 'kimi-for-coding' }, BASE, true)).toBeNull()
  })

  it('leaves image-free steps alone', () => {
    expect(applyImageGuard({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, BASE, false)).toBeNull()
  })

  it('does not touch providers outside the text-only set', () => {
    expect(applyImageGuard({ provider: 'other', model: 'x' }, BASE, true)).toBeNull()
  })

  it('bails out when the premium route is itself text-only (no safe multimodal reroute)', () => {
    const config: RouterConfig = { ...BASE, textOnlyProviders: ['deepseek-official', 'kimi-tide'] }
    expect(applyImageGuard({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, config, true)).toBeNull()
  })
})

describe('KimiRouter.decide', () => {
  it('routes explicit @kimi directives to premium regardless of escalation config', () => {
    const router = new KimiRouter({ ...BASE, mode: 'cost' }, { info: () => {} })
    const decision = router.decide([userMessage([{ type: 'text', text: '@kimi 帮我看看这个' }])], 1)
    expect(decision.kind).toBe('route')
    if (decision.kind === 'route') expect(decision.target).toEqual(BASE.premium)
  })

  it('cost mode keeps the primary when no escalation condition matches', () => {
    const router = new KimiRouter({ ...BASE, mode: 'cost', escalateWhen: { patterns: ['审查'] } }, { info: () => {} })
    const decision = router.decide([userMessage([{ type: 'text', text: '普通任务' }])], 1)
    expect(decision.kind).toBe('keep')
  })

  it('cost mode exhausts the premium budget window and falls back to keep', () => {
    const router = new KimiRouter(
      { ...BASE, mode: 'cost', escalateWhen: { patterns: ['审查'] }, premiumBudget: 0.2, budgetWindow: 5 },
      { info: () => {} },
    )
    const messages = [userMessage([{ type: 'text', text: '请审查这段代码' }])]
    for (let i = 0; i < 5; i++) {
      expect(router.decide(messages, 1).kind).toBe('route')
    }
    const exhausted = router.decide(messages, 1)
    expect(exhausted.kind).toBe('keep')
    // The exhaustion decision records 'primary', sliding one premium out of
    // the 5-slot window: 4 premium + 1 primary.
    expect(router.budgetUsage()).toMatchObject({ premium: 4, window: 5 })
  })
})

describe('canClaimImageAdmission (host prompt pre-check deferral)', () => {
  // The host (dsh-host-apiproxy prompt RPC) rejects image prompts whose
  // CURRENT model selection is text-only BEFORE the agent loop runs — the
  // per-step image guard never gets a chance on a fresh session (default
  // model = text-only deepseek). The host patch defers via the agent-scoped
  // serial event `agent/image-admission`: a listener returning a truthy
  // value claims the image will be rerouted. Claim only when this router is
  // active AND the premium route is multimodal (a text-only premium cannot
  // serve the image — mirror of applyImageGuard's anti-ping-pong rule).

  it('claims when the router is active and the premium route is multimodal', () => {
    expect(canClaimImageAdmission({ ...BASE, mode: 'cost' })).toBe(true)
    expect(canClaimImageAdmission(BASE)).toBe(true) // capability mode
  })

  it('does not claim when the router is off (host keeps its friendly rejection)', () => {
    expect(canClaimImageAdmission({ ...BASE, mode: 'off' })).toBe(false)
  })

  it('does not claim when the premium route is itself text-only (no safe reroute)', () => {
    const config: RouterConfig = { ...BASE, mode: 'cost', textOnlyProviders: ['deepseek-official', 'kimi-tide'] }
    expect(canClaimImageAdmission(config)).toBe(false)
  })

  it('honors an explicit textOnlyProviders override listing the premium provider', () => {
    const config: RouterConfig = { ...BASE, mode: 'cost', textOnlyProviders: ['kimi-tide'] }
    expect(canClaimImageAdmission(config)).toBe(false)
  })

  it('claims when the text-only set does not include the premium provider', () => {
    const config: RouterConfig = { ...BASE, mode: 'cost', textOnlyProviders: ['deepseek-official'] }
    expect(canClaimImageAdmission(config)).toBe(true)
  })
})
