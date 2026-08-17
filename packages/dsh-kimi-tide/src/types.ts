/**
 * kimi-tide: shared types for the 月汐 panel (quota / local tokens / projection).
 * The usages endpoint is undocumented — parsing is deliberately lenient
 * (string-or-number fields, missing sections degrade instead of throwing).
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { RouterConfig } from './router.js'

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

export interface LocalTokenStats {
  /** Counters reset at local midnight. */
  today: TokenUsage
  /** Counters for the whole process lifetime. */
  session: TokenUsage
  /** Number of usage chunks observed. */
  calls: number
}

export interface KimiTidePanelProjection {
  quota: QuotaSnapshot | null
  local: LocalTokenStats
  /** Currently effective router config (panel form initial values). */
  router: RouterConfig
  reasoning: { enabled: true }
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
    fiveHour: limits.length > 0 ? toWindow(limits[0]) : { used: 0, limit: 0, resetTime: '' },
    membershipLevel: typeof membership.level === 'string' ? membership.level : '',
    fetchedAt,
    stale: false,
  }
}

export function emptyLocalTokenStats(): LocalTokenStats {
  return { today: { inputTokens: 0, outputTokens: 0 }, session: { inputTokens: 0, outputTokens: 0 }, calls: 0 }
}
