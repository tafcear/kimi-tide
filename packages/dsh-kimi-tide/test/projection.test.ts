import { describe, expect, it } from 'vitest'
import { kimiTideProjectionDefinition, KIMI_TIDE_PANEL_EVENT } from '../src/projection.js'
import type { KimiTidePanelProjection, RouterPanelView } from '../src/types.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const router: RouterPanelView = {
  activePreset: null,
  presetName: null,
  defaultTarget: null,
  ruleCount: 0,
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
    kimi: { route: true, key: true },
    router,
    reasoning: { enabled: true },
    configSource: 'default',
    candidates: [],
    decision: null,
  }
}

describe('panelSchema (projection v5)', () => {
  const parse = (kimiTideProjectionDefinition.stateSchema as { parse: (v: unknown) => unknown }).parse.bind(
    kimiTideProjectionDefinition.stateSchema as never,
  ) as (v: unknown) => KimiTidePanelProjection | null

  it('pins stateVersion 5 (v5 投影)', () => {
    expect(kimiTideProjectionDefinition.stateVersion).toBe(5)
  })

  it("accepts configSource 'settings' and still rejects unknown sources", () => {
    const p = panel(1)
    p.configSource = 'settings'
    expect(parse(p)!.configSource).toBe('settings')
    expect(() => parse({ ...p, configSource: 'nope' })).toThrow()
  })

  it('accepts candidates without scores and strips any score payload', () => {
    const p = panel(1)
    p.candidates = [
      { provider: 'kimi-coding', model: 'kimi-for-coding', available: true },
      { provider: 'deepseek-official', model: 'deepseek-v4-flash', available: true, scores: { code: 4.5 } },
    ]
    const out = parse(p)
    expect(out!.candidates[0]).toEqual({ provider: 'kimi-coding', model: 'kimi-for-coding', available: true })
    expect((out!.candidates[1] as { scores?: unknown }).scores).toBeUndefined()
  })

  it('accepts a decision without scoreDelta', () => {
    const p = panel(1)
    p.decision = { chosen: { provider: 'kimi-coding', model: 'kimi-for-coding' }, reason: '规则「code」命中' }
    const out = parse(p)
    expect(out!.decision).toEqual({
      chosen: { provider: 'kimi-coding', model: 'kimi-for-coding' },
      reason: '规则「code」命中',
    })
  })

  it('projection v4：携带 kimi 二态接入指示，拒绝缺失字段', () => {
    const p = panel(1)
    const out = parse(p)
    expect(out!.kimi).toEqual({ route: true, key: true })
    const { kimi: _kimi, ...rest } = p
    expect(() => parse(rest as never)).toThrow()
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

  it('wire.view passes the state through', () => {
    const p = panel(3)
    expect(kimiTideProjectionDefinition.wire!.view(p)).toBe(p)
    expect(kimiTideProjectionDefinition.wire!.view(null)).toBeNull()
  })

  it('wire.viewSchema accepts valid payload and rejects invalid', () => {
    const p = panel(3)
    expect(kimiTideProjectionDefinition.wire!.viewSchema.parse(p)).toEqual(p)
    expect(() => kimiTideProjectionDefinition.wire!.viewSchema.parse({ nope: true })).toThrow()
  })
})
