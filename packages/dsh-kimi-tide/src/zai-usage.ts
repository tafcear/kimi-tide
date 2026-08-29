/**
 * zai-coding-cn（GLM Coding Plan）配额源解析器（2026-08-29 用户裁定：所有
 * code plan 的余额功能）。端点契约溯源：Z.ai 内部接口
 * GET /api/monitor/usage/quota/limit（Z.ai 公开 API 文档未收录）——
 * 实测两形态：①用户套餐实抓（2026-08-29）：CREDIT_LIMIT 积分制，
 * unit3/number5=5h 窗、unit6/number1=周窗、data.level=套餐档；
 * ②文档形态（OpenTokenUsage zai.md）：TOKENS_LIMIT token 制，unit6/number7=周窗。
 * 窗口由 unit 判定（3=5h、6=周），number 随套餐档位浮动，不作匹配条件。
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
  const payload = json as { data?: { limits?: ZaiLimitEntry[]; level?: string } } | null
  const data = payload?.data
  const limits = Array.isArray(data?.limits) ? data.limits : null
  if (limits === null || data === undefined) return null
  const knownTypes = new Set(['CREDIT_LIMIT', 'TOKENS_LIMIT'])
  const windowOf = (unit: number): QuotaWindow => {
    const entry = limits.find((l) => knownTypes.has(l.type ?? '') && l.unit === unit)
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
    weekly: windowOf(6),
    fiveHour: windowOf(3),
    // 实测 data.level 携带套餐档位（如 pro）——透出，不虚构。
    membershipLevel: typeof data.level === 'string' ? data.level : '',
    fetchedAt: now,
    stale: false,
  }
}
