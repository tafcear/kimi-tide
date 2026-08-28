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

describe('panelSchema (projection v6)', () => {
  const parse = (kimiTideProjectionDefinition.stateSchema as { parse: (v: unknown) => unknown }).parse.bind(
    kimiTideProjectionDefinition.stateSchema as never,
  ) as (v: unknown) => KimiTidePanelProjection | null

  it('pins stateVersion 6 (v6 投影)', () => {
    expect(kimiTideProjectionDefinition.stateVersion).toBe(6)
  })

  it('v6：imageContext/lastFlowEvent 新字段 schema 往返保留', () => {
    const p = panel(1)
    p.imageContext = { native: 1, transcribed: 2, blind: 3 }
    p.lastFlowEvent = 'transcribe ok sha256:ab12cd34 → vision-exp'
    const out = parse(p)
    expect(out!.imageContext).toEqual({ native: 1, transcribed: 2, blind: 3 })
    expect(out!.lastFlowEvent).toBe('transcribe ok sha256:ab12cd34 → vision-exp')
  })

  it('0.8.x⑨：quotaProvider 标记（配额来源 provider）往返保留；缺席合法', () => {
    const p = panel(1)
    p.quotaProvider = 'kimi-coding'
    // Fails if: schema 未列 quotaProvider（可选新字段随存载荷透传与否不确定，
    // 必须显式入 schema 钉住往返）。
    expect(parse(p)!.quotaProvider).toBe('kimi-coding')
    expect(parse(panel(1))!.quotaProvider).toBeUndefined()
  })

  it('v6：新字段缺席仍可解析（可选，对存量读取端向后兼容）', () => {
    const out = parse(panel(1))
    expect(out!.imageContext).toBeUndefined()
    expect(out!.lastFlowEvent).toBeUndefined()
  })

  it('0.6.x池#6：imageContext 计数非负整数约束（负数/小数拒绝）', () => {
    const bad = panel(1)
    bad.imageContext = { native: -1, transcribed: 0, blind: 0 }
    // Fails if: 计数字段裸 z.number()（wire 面拒负数与小数计数的防御缺口）。
    expect(() => parse(bad)).toThrow()
    const frac = panel(1)
    frac.imageContext = { native: 1, transcribed: 0.5, blind: 0 }
    expect(() => parse(frac)).toThrow()
  })

  it('v6：imageContext 三态计数缺一不可（缺项拒绝）', () => {
    const p = panel(1)
    expect(() => parse({ ...p, imageContext: { native: 1, transcribed: 2 } })).toThrow()
    expect(() => parse({ ...p, imageContext: { native: 1, transcribed: 2, blind: '3' } })).toThrow()
  })

  it('v6：lastFlowEvent 沿用 ≤120 截断惯例（120 过，121 拒）', () => {
    const p = panel(1)
    p.lastFlowEvent = 'x'.repeat(120)
    expect(parse(p)!.lastFlowEvent).toHaveLength(120)
    expect(() => parse({ ...p, lastFlowEvent: 'x'.repeat(121) })).toThrow()
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

  it('v6：wire.view 投影含图像上下文与流事件（透传同形）', () => {
    const p = panel(3)
    p.imageContext = { native: 2, transcribed: 0, blind: 1 }
    p.lastFlowEvent = 'transcribe failed timeout → latch'
    const v = kimiTideProjectionDefinition.wire!.view(p)
    expect(v).toBe(p)
    expect(v!.imageContext).toEqual({ native: 2, transcribed: 0, blind: 1 })
    expect(v!.lastFlowEvent).toBe('transcribe failed timeout → latch')
  })

  it('wire.viewSchema accepts valid payload and rejects invalid', () => {
    const p = panel(3)
    expect(kimiTideProjectionDefinition.wire!.viewSchema.parse(p)).toEqual(p)
    expect(() => kimiTideProjectionDefinition.wire!.viewSchema.parse({ nope: true })).toThrow()
  })

  it('v6：wire.viewSchema 往返保留新字段（stateSchema/wire 同形扩展）', () => {
    const p = panel(3)
    p.imageContext = { native: 1, transcribed: 1, blind: 0 }
    p.lastFlowEvent = 'transcribe ok sha256:ab12cd34 → vision-exp'
    expect(kimiTideProjectionDefinition.wire!.viewSchema.parse(p)).toEqual(p)
  })
})
