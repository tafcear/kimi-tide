/**
 * kimi-tide: UsageMonitor — official quota polling (GET /coding/v1/usages) via API key.
 * Pure data source: emits onUpdate (throttled 2s); pushing projections is
 * the caller's job (index.ts).
 */
import { parseQuotaSnapshot, type QuotaLike } from './types.js'

const USAGES_URL = 'https://api.kimi.com/coding/v1/usages'
const NOTIFY_THROTTLE_MS = 2000
/** 本监控探测的配额来源 provider（0.8.x⑨：投影 quotaProvider 标记同源）。 */
export const QUOTA_SOURCE_PROVIDER = 'kimi-coding'

/**
 * 一次取数的结果（S1：三态的事实来源）。
 * `pending` = 尚未取过（首轮之前）；`no-key` = 凭据未配置；`error` = 取数失败。
 */
export type UsageOutcome = 'pending' | 'ok' | 'no-key' | 'error'

export interface UsageMonitorOptions {
  pollMs: number
  onUpdate: () => void
  /** Per-request API key resolution (dsh-credentials contract: per-operation read). */
  resolveKey: () => Promise<string | null>
  /** 配额端点（缺省 = Kimi coding usages；多 plan 2026-08-29 起可注入其它源）。 */
  url?: string
  /** 响应解析（缺省 = Kimi usages 形状；其它 plan 注入自己的解析器）。 */
  parse?: (json: unknown, now: number) => QuotaLike | null
  /**
   * 有界超时（M4，2026-09-15）：缺省沿用 `0.8 × pollMs`——对 60s 的用量源合适，
   * 但余额源必须显式给短值（300s 周期会挂 240s）。
   */
  timeoutMs?: number
  /** Test seam: inject a fake fetch. */
  fetchFn?: typeof fetch
  /** Test seam: inject a clock. */
  now?: () => number
}

export class UsageMonitor {
  private quota: QuotaLike | null = null
  private outcomeState: UsageOutcome = 'pending'
  private timer: ReturnType<typeof setInterval> | null = null
  private lastNotify = -Infinity
  private inFlight: Promise<void> | null = null
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly url: string
  private readonly parse: (json: unknown, now: number) => QuotaLike | null

  constructor(private readonly options: UsageMonitorOptions) {
    this.fetchFn = options.fetchFn ?? fetch
    this.now = options.now ?? (() => Date.now())
    this.url = options.url ?? USAGES_URL
    this.parse = options.parse ?? parseQuotaSnapshot
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

  /** Fetch the usages endpoint once; a failed fetch marks any prior snapshot stale. */
  async refresh(): Promise<void> {
    // In-flight 去重（评审修复 2026-08-23）：setInterval 到点即 void refresh()，
    // 端点挂起时若无守卫，挂起请求会逐 tick 累积泄漏 socket。并发调用折进
    // 在途那次——共享同一个完成语义。
    if (this.inFlight !== null) return this.inFlight
    const run = this.refreshOnce()
    this.inFlight = run
    try {
      await run
    } finally {
      this.inFlight = null
    }
  }

  private async refreshOnce(): Promise<void> {
    const snapshot = await this.fetchQuota()
    if (snapshot !== null) {
      this.quota = snapshot
    } else if (this.quota !== null) {
      this.quota = { ...this.quota, stale: true }
    }
    this.notify()
  }

  snapshot(): { quota: QuotaLike | null; outcome: UsageOutcome } {
    return { quota: this.quota, outcome: this.outcomeState }
  }

  private async fetchQuota(): Promise<QuotaLike | null> {
    try {
      // 每次轮询现取 key（dsh-credentials 契约：per-operation read）。
      const key = await this.options.resolveKey()
      if (key === null || key.length === 0) {
        this.outcomeState = 'no-key'
        return null
      }
      // 有界超时（评审修复 2026-08-23）：裸 fetch 在端点挂起时永不 settle。
      // 缺省 0.8 倍轮询周期；显式 timeoutMs 优先（余额源给 15s，M4）。
      // AbortSignal.timeout 为 Node 17.3+ API；缺席的宿主退化为无超时。
      const budget = this.options.timeoutMs ?? Math.max(1, Math.floor(this.options.pollMs * 0.8))
      const timeout = typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(Math.max(1, Math.floor(budget)))
        : undefined
      const response = await this.fetchFn(this.url, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        ...(timeout === undefined ? {} : { signal: timeout }),
      })
      if (!response.ok) {
        this.outcomeState = 'error'
        return null
      }
      const parsed = this.parse(await response.json(), this.now())
      this.outcomeState = parsed === null ? 'error' : 'ok'
      return parsed
    } catch {
      this.outcomeState = 'error'
      return null
    }
  }

  private notify(): void {
    const t = this.now()
    if (t - this.lastNotify < NOTIFY_THROTTLE_MS) return
    this.lastNotify = t
    this.options.onUpdate()
  }
}
