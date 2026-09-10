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

/**
 * 旧载荷容忍回归（2026-09-04 交接单 → 09-10 单；09-10 会话历史修复会话定性为
 * 第一优先项）。
 *
 * 现象：0.6.0 之前的会话整卷加载失败——`stateSchema.parse(旧载荷)` 抛 zod 错
 * （`kimi`/`configSource`/`candidates`/`decision` 四个后加字段为必填），宿主
 * 投影 fold 一抛即整卷拒载（`failed to project session`）。
 *
 * 实测载荷（09-10 从真实 v3 日志解出，形状逐字保真、仅裁剪无关数组长度）：
 * - pre-0.4 形状（session-4fb0f4d5，543/543 全旧）：只有
 *   quota/local/router/reasoning/models，四字段全缺；
 * - 0.4–0.5 形状（session-6ca2f899 53 条 + session-c01dab3c 616 条）：有
 *   configSource/candidates/decision，**只缺 `kimi`**。
 *
 * 修法约束（09-10 已纠偏）：不能用 `.optional()`——客户端读的是
 * `panel.decision !== null`（TideDock.tsx:232/237/261），`undefined !== null`
 * 为真 → 直接读 `.chosen.provider` 崩。必须用 `z.preprocess` 在 parse 前注入
 * 默认值，**保持输出形状不变**（客户端零改动、stateVersion 不必递升）。
 */
const legacyPre04Payload = {
  quota: {
    weekly: { used: 3, limit: 100, resetTime: '2026-08-25T09:56:09.776951Z' },
    fiveHour: { used: 0, limit: 0, resetTime: '' },
    membershipLevel: 'LEVEL_INTERMEDIATE',
    fetchedAt: 1787060453613,
    stale: false,
  },
  local: { today: { inputTokens: 0, outputTokens: 0 }, session: { inputTokens: 0, outputTokens: 0 }, calls: 0 },
  router: {
    mode: 'cost',
    primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    premium: { provider: 'kimi-tide', model: 'k3' },
    premiumLong: { provider: 'kimi-tide', model: 'k3' },
    premiumBudget: 0.2,
    escalateWhen: { patterns: ['看图', '图像', '截图', '审查', 'review'] },
  },
  reasoning: { enabled: true },
  models: { kimi: ['k3', 'k3-256k'], deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
}

const legacy04Payload = {
  quota: {
    weekly: { used: 0, limit: 100, resetTime: '2026-08-23T08:00:00.000Z' },
    fiveHour: { used: 0, limit: 100, resetTime: '2026-08-23T08:00:00.000Z' },
    membershipLevel: 'LEVEL_ADVANCED',
    fetchedAt: 1787472000000,
    stale: false,
  },
  local: { today: { inputTokens: 42226, outputTokens: 745 }, session: { inputTokens: 42226, outputTokens: 745 }, calls: 4 },
  router: {
    mode: 'off',
    primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    premium: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    premiumBudget: 0.2,
    budgetWindow: 20,
    charsPerToken: 2,
  },
  reasoning: { enabled: true },
  models: { kimi: ['k3', 'kimi-for-coding-highspeed'], deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
  configSource: 'settings',
  candidates: [{ provider: 'kimi-coding', model: 'k3', available: true }],
  decision: null,
}

describe('panelSchema 旧载荷容忍（0.6.0 前会话整卷拒载回归）', () => {
  const parse = (kimiTideProjectionDefinition.stateSchema as { parse: (v: unknown) => unknown }).parse.bind(
    kimiTideProjectionDefinition.stateSchema as never,
  ) as (v: unknown) => KimiTidePanelProjection | null

  it('pre-0.4 载荷（四字段全缺）可投影，不再整卷拒载', () => {
    // Fails if: panelSchema 维持四个必填字段（09-10 实测 4 issues →
    // 543 条旧事件的会话打开即 failed to project）。
    const out = parse(legacyPre04Payload)
    expect(out).not.toBeNull()
    expect(out!.kimi).toEqual({ route: false, key: false })
    expect(out!.configSource).toBe('default')
    expect(out!.candidates).toEqual([])
  })

  it('0.4–0.5 载荷（只缺 kimi）可投影', () => {
    // Fails if: 容忍逻辑绑定「四字段一起缺席」（真实世界只缺 kimi 的载荷仍炸）。
    const out = parse(legacy04Payload)
    expect(out!.kimi).toEqual({ route: false, key: false })
    // 存量字段原样保留，不被默认值覆盖。
    expect(out!.configSource).toBe('settings')
    expect(out!.candidates).toEqual([{ provider: 'kimi-coding', model: 'k3', available: true }])
  })

  it('decision 缺席补 null（不是 undefined）——客户端 `!== null` 门控的前提', () => {
    // Fails if: 改用 .optional()——`undefined !== null` 为真 → TideDock.tsx:232
    // 进分支后读 `.chosen.provider` 直接崩（09-10 修法纠偏的原始理由）。
    const out = parse(legacyPre04Payload)
    expect(out!.decision).toBeNull()
    expect(out!.decision === null).toBe(true)
  })

  it('旧载荷的 `local` 字段按零改动惯例被剥除（schema 未列该键）', () => {
    const out = parse(legacyPre04Payload) as unknown as Record<string, unknown>
    expect(out.local).toBeUndefined()
  })

  it('现代载荷逐字往返（容忍层不改动已有值）', () => {
    const p = panel(7)
    p.decision = { chosen: { provider: 'kimi-coding', model: 'k3' }, reason: '规则「code」命中' }
    expect(parse(p)).toEqual(p)
  })

  it('现代载荷缺字段（无旧版标记）仍然拒绝——容忍不得变成纵容', () => {
    // 旧版标记：router.mode（0.4 前）/ 全套 local+configSource+candidates+decision。
    // 现代载荷半损坏 → 必须照旧抛错（否则损坏数据静默成「空面板」）。
    const p = panel(1)
    const { decision: _decision, ...rest } = p
    expect(() => parse(rest as never)).toThrow()
    const broken = { ...panel(1), kimi: 'nope' }
    expect(() => parse(broken as never)).toThrow()
  })

  it('旧载荷 null/非对象仍安全拒绝（容忍层不得吞掉非法输入）', () => {
    expect(parse(null)).toBeNull()
    expect(() => parse('nope')).toThrow()
    expect(() => parse([1, 2])).toThrow()
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
