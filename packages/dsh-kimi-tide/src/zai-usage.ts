/**
 * zai-coding-cn（GLM Coding Plan）配额源解析器（2026-08-29 用户裁定：所有
 * code plan 的余额功能）。端点契约溯源：Z.ai 订阅管理内部接口
 * GET /api/monitor/usage/quota/limit（PowerUserZ/OpenTokenUsage
 * docs/providers/zai.md，2026-08-29 抓取；Z.ai 公开 API 文档未收录）——
 * TOKENS_LIMIT unit:3/number:5 = 5h 会话 token 窗；unit:6/number:7 = 7 天周窗。
 */
import type { QuotaSnapshot, QuotaWindow } from './types.js'

export const ZAI_QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit'
export const ZAI_PROVIDER = 'zai-coding-cn'

interface ZaiLimitEntry {
  type?: string
  unit?: number
  number?: number
  usage?: number
  currentValue?: number
  nextResetTime?: number
}

/** 缺席窗口零填充（limit 0 → dock 进度条空、pct 0，不产出 NaN）。 */
const zeroWindow = (): QuotaWindow => ({ used: 0, limit: 0, resetTime: '' })

/** 把 quota/limit 载荷解析为面板 QuotaSnapshot；非契约载荷返回 null。 */
export function parseZaiQuota(json: unknown, now: number): QuotaSnapshot | null {
  const data = (json as { data?: { limits?: ZaiLimitEntry[] } } | null)?.data
  const limits = Array.isArray(data?.limits) ? data.limits : null
  if (limits === null) return null
  const windowOf = (unit: number, days: number): QuotaWindow => {
    const entry = limits.find(
      (l) => l.type === 'TOKENS_LIMIT' && l.unit === unit && l.number === days,
    )
    if (entry === undefined) return zeroWindow()
    return {
      used: typeof entry.currentValue === 'number' ? entry.currentValue : 0,
      limit: typeof entry.usage === 'number' ? entry.usage : 0,
      resetTime: typeof entry.nextResetTime === 'number' && entry.nextResetTime > 0
        ? new Date(entry.nextResetTime).toISOString()
        : '',
    }
  }
  return {
    weekly: windowOf(6, 7),
    fiveHour: windowOf(3, 5),
    // 套餐名在 /api/biz/subscription/list（另一次请求）；dock 不展示该字段，
    // 不为它每轮多打一发——留空，不虚构套餐档位。
    membershipLevel: '',
    fetchedAt: now,
    stale: false,
  }
}
