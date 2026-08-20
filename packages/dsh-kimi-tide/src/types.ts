/**
 * kimi-tide: shared types for the 月汐 panel (quota / kimi 二态接入指示 / projection).
 * The usages endpoint is undocumented — parsing is deliberately lenient
 * (string-or-number fields, missing sections degrade instead of throwing).
 */
import type { Dim } from './config.js'
import type { RouterConfig } from './router.js'

/**
 * Where the effective router config came from. 'settings' is the 0.4.0 primary
 * store (the dsh-settings namespace `kimi-tide-router`); the sidecar > patch >
 * default chain remains the fallback for hosts without a settings service.
 */
export type ConfigSource = 'settings' | 'sidecar' | 'patch' | 'default'

/** Compact per-candidate summary for the panel (full metas stay host-side). */
export interface CandidateSummary {
  provider: string
  model: string
  available: boolean
  /** 用户覆盖分（RouterConfigV3.scores['provider/model']），无覆盖时缺省——
   *  ScoreEditor 用它做滑杆初值，避免已保存覆盖分显示成基线值。 */
  scores?: Partial<Record<Dim, number>>
}

/**
 * Routing decision summary (spec §2.7: payload 受控). Present only when a
 * decision was observed this turn cycle AND the mode is capability AND the
 * decision is not keep; `reason` is truncated to 120 characters.
 */
export interface DecisionSummary {
  chosen: { provider: string; model: string }
  reason: string
  scoreDelta: number | null
}

export interface QuotaWindow {
  used: number
  limit: number
  resetTime: string
}

export interface QuotaSnapshot {
  weekly: QuotaWindow
  fiveHour: QuotaWindow
  membershipLevel: string
  fetchedAt: number
  /** true when the last refresh failed and this snapshot is from an earlier fetch. */
  stale: boolean
}

/** 0.4.x 二态接入指示：kimi-coding 路由已注册（llm 目录）+ API key 可解析。 */
export interface KimiAccessStatus {
  route: boolean
  key: boolean
}

export interface KimiTidePanelProjection {
  quota: QuotaSnapshot | null
  /** 0.4.x 二态接入指示（spec §3.5/验收 5）：路由已注册 + key 可解析。 */
  kimi: KimiAccessStatus
  /** Currently effective router config (panel form initial values). */
  router: RouterConfig
  reasoning: { enabled: true }
  /** Selectable model ids per provider family (settings dropdown options). */
  models?: { kimi: string[]; deepseek: string[] }
  /** Effective config source: settings namespace > sidecar file > patch static block > built-in default. */
  configSource: ConfigSource
  /** Enumerated candidate pool summary (provider-agnostic; whitelist-filtered). */
  candidates: CandidateSummary[]
  /** Latest capability routing decision summary; null when off/keep or none yet. */
  decision: DecisionSummary | null
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function toWindow(value: unknown): QuotaWindow {
  const v = (value ?? {}) as Record<string, unknown>
  return {
    used: toNumber(v.used),
    limit: toNumber(v.limit),
    resetTime: typeof v.resetTime === 'string' ? v.resetTime : '',
  }
}

/**
 * 五小时窗条目：实机响应（2026-08-20 验收④探针）把数字嵌在
 * `limits[0].detail`（`{ window, detail: { used, limit, resetTime } }`），
 * 平铺形态（测试夹具/旧假设）兜底直读。
 */
function toFiveHour(entry: unknown): QuotaWindow {
  const v = (entry ?? {}) as Record<string, unknown>
  return toWindow(v.detail ?? v)
}

/**
 * Parse `GET /coding/v1/usages` JSON into a QuotaSnapshot.
 * Returns null only when the weekly `usage` section is absent entirely.
 */
export function parseQuotaSnapshot(json: unknown, fetchedAt: number): QuotaSnapshot | null {
  if (json === null || typeof json !== 'object') return null
  const root = json as Record<string, unknown>
  if (root.usage === undefined || root.usage === null) return null
  const limits = Array.isArray(root.limits) ? root.limits : []
  const user = (root.user ?? {}) as Record<string, unknown>
  const membership = (user.membership ?? {}) as Record<string, unknown>
  return {
    weekly: toWindow(root.usage),
    fiveHour: limits.length > 0 ? toFiveHour(limits[0]) : { used: 0, limit: 0, resetTime: '' },
    membershipLevel: typeof membership.level === 'string' ? membership.level : '',
    fetchedAt,
    stale: false,
  }
}
