import { describe, expect, it } from 'vitest'
import { kimiTideProjectionDefinition, KIMI_TIDE_PANEL_EVENT } from '../src/projection.js'
import { emptyLocalTokenStats, type KimiTidePanelProjection } from '../src/types.js'
import type { RouterConfig } from '../src/router.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const router: RouterConfig = {
  mode: 'off',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
}

function panel(quotaUsed: number): KimiTidePanelProjection {
  return {
    quota: {
      weekly: { used: quotaUsed, limit: 100, resetTime: 'w' },
      fiveHour: { used: 0, limit: 100, resetTime: 'f' },
      membershipLevel: 'LEVEL_INTERMEDIATE',
      fetchedAt: 1,
      stale: false,
    },
    local: emptyLocalTokenStats(),
    router,
    reasoning: { enabled: true },
  }
}

describe('panelSchema (candidates scores, 0.3.0 final review)', () => {
  // Fails if: the wire schema strips `scores` from candidate summaries — the
  // panel needs them to seed ScoreEditor drafts (host fills cfg.scores[key]).
  const parse = (kimiTideProjectionDefinition.schema as { parse: (v: unknown) => unknown }).parse.bind(
    kimiTideProjectionDefinition.schema as never,
  ) as (v: unknown) => KimiTidePanelProjection | null

  it('keeps per-candidate override scores when present', () => {
    const p = panel(1)
    p.candidates = [
      { provider: 'kimi-tide', model: 'kimi-for-coding', available: true, scores: { code: 4.5, vision: 3 } },
      { provider: 'deepseek-official', model: 'deepseek-v4-flash', available: true },
    ]
    p.configSource = 'sidecar'
    p.decision = null
    const out = parse(p)
    expect(out!.candidates[0].scores).toEqual({ code: 4.5, vision: 3 })
    expect(out!.candidates[1].scores).toBeUndefined()
  })
})

function eventOf(data: unknown): SessionEvent {
  return { type: KIMI_TIDE_PANEL_EVENT, data } as unknown as SessionEvent
}

describe('kimiTideProjectionDefinition', () => {
  it('init is null (no data pushed yet)', () => {
    expect(kimiTideProjectionDefinition.init()).toBeNull()
  })

  it('apply replaces the whole value (same state reference rules do not apply across events)', () => {
    const p = panel(9)
    const s1 = kimiTideProjectionDefinition.apply(null, eventOf(p))
    expect(s1).toEqual(p)
    const s2 = kimiTideProjectionDefinition.apply(s1, eventOf(panel(9)))
    expect(s2).toEqual(p)
  })

  it('apply ignores unrelated events (same reference back)', () => {
    const other = { type: 'kimi/session', data: {} } as unknown as SessionEvent
    const before = kimiTideProjectionDefinition.apply(null, eventOf(panel(1)))
    expect(kimiTideProjectionDefinition.apply(before, other)).toBe(before)
  })

  it('view passes the state through', () => {
    const p = panel(3)
    expect(kimiTideProjectionDefinition.view(p)).toBe(p)
    expect(kimiTideProjectionDefinition.view(null)).toBeNull()
  })
})
