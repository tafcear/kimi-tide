/**
 * kimi-tide: UsageMonitor — official quota polling (GET /coding/v1/usages)
 * plus a local token bucket fed by the adapter's usage chunks.
 * Pure data source: emits onUpdate (throttled 2s); pushing projections is
 * the caller's job (index.ts).
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { KimiOAuthManager } from './oauth.js'
import { emptyLocalTokenStats, parseQuotaSnapshot, type LocalTokenStats, type QuotaSnapshot } from './types.js'

const USAGES_URL = 'https://api.kimi.com/coding/v1/usages'
const NOTIFY_THROTTLE_MS = 2000

export interface UsageMonitorOptions {
  pollMs: number
  onUpdate: () => void
  /** Test seam: inject a fake fetch. */
  fetchFn?: typeof fetch
  /** Test seam: inject a clock. */
  now?: () => number
}

export class UsageMonitor {
  private quota: QuotaSnapshot | null = null
  private local: LocalTokenStats = emptyLocalTokenStats()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastNotify = -Infinity
  private todayKey = ''
  private readonly fetchFn: typeof fetch
  private readonly now: () => number

  constructor(
    private readonly oauth: KimiOAuthManager,
    private readonly options: UsageMonitorOptions,
  ) {
    this.fetchFn = options.fetchFn ?? fetch
    this.now = options.now ?? (() => Date.now())
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => { void this.refresh() }, this.options.pollMs)
    void this.refresh()
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /** Fetch the usages endpoint once; on 401 refresh the token and retry once. */
  async refresh(): Promise<void> {
    const snapshot = await this.fetchQuota(false)
    if (snapshot !== null) {
      this.quota = snapshot
    } else if (this.quota !== null) {
      this.quota = { ...this.quota, stale: true }
    }
    this.notify()
  }

  /** Feed one adapter usage chunk into the local buckets. */
  tapUsage(usage: TokenUsage): void {
    this.rollDayIfNeeded()
    this.local = {
      today: addUsage(this.local.today, usage),
      session: addUsage(this.local.session, usage),
      calls: this.local.calls + 1,
    }
    this.notify()
  }

  snapshot(): { quota: QuotaSnapshot | null; local: LocalTokenStats } {
    return { quota: this.quota, local: this.local }
  }

  private async fetchQuota(retried: boolean): Promise<QuotaSnapshot | null> {
    const token = this.oauth.getAccessToken()
    if (token.length === 0) return null
    try {
      const response = await this.fetchFn(USAGES_URL, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      if (response.status === 401 && !retried) {
        const refreshed = await this.oauth.refresh()
        if (refreshed) return this.fetchQuota(true)
        return null
      }
      if (!response.ok) return null
      return parseQuotaSnapshot(await response.json(), this.now())
    } catch {
      return null
    }
  }

  private notify(): void {
    const t = this.now()
    if (t - this.lastNotify < NOTIFY_THROTTLE_MS) return
    this.lastNotify = t
    this.options.onUpdate()
  }

  private rollDayIfNeeded(): void {
    const key = new Date(this.now()).toDateString()
    if (this.todayKey === key) return
    this.todayKey = key
    this.local = { ...this.local, today: { inputTokens: 0, outputTokens: 0 } }
  }
}

function addUsage(base: TokenUsage, delta: TokenUsage): TokenUsage {
  const out: TokenUsage = { ...base }
  out.inputTokens = (out.inputTokens ?? 0) + (delta.inputTokens ?? 0)
  out.outputTokens = (out.outputTokens ?? 0) + (delta.outputTokens ?? 0)
  if (delta.cacheReadTokens !== undefined) out.cacheReadTokens = (out.cacheReadTokens ?? 0) + delta.cacheReadTokens
  if (delta.cacheWriteTokens !== undefined) out.cacheWriteTokens = (out.cacheWriteTokens ?? 0) + delta.cacheWriteTokens
  return out
}
