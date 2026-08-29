/**
 * zai-coding-cn（GLM Coding Plan）配额解析器单测。
 * 端点契约溯源：Z.ai 订阅管理内部接口 GET /api/monitor/usage/quota/limit
 * （PowerUserZ/OpenTokenUsage docs/providers/zai.md，2026-08-29 抓取）——
 * TOKENS_LIMIT unit:3/number:5 = 5h 会话窗；unit:6/number:7 = 7 天周窗。
 * 每个用例注释标注「会使其失败的生产改动」。
 */
import { describe, expect, it } from 'vitest'
import { parseZaiQuota } from '../src/zai-usage.js'

const NOW = 1770648000000

const limitsPayload = {
  code: 200,
  data: {
    limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, usage: 800000000, currentValue: 127694464, remaining: 672305536, percentage: 15, nextResetTime: 1770648402389 },
      { type: 'TOKENS_LIMIT', unit: 6, number: 7, usage: 2000000000, currentValue: 500000000, remaining: 1500000000, percentage: 25, nextResetTime: 1771296000000 },
      { type: 'TIME_LIMIT', unit: 5, number: 1, usage: 4000, currentValue: 1828, percentage: 45 },
    ],
  },
  success: true,
}

describe('parseZaiQuota：GLM Coding Plan 用量', () => {
  it('unit3/5 → fiveHour、unit6/7 → weekly；currentValue→used、usage→limit、epoch→ISO', () => {
    const snap = parseZaiQuota(limitsPayload, NOW)
    // Fails if: 窗口映射错位或字段名不接（used/limit 取错列）
    expect(snap).not.toBeNull()
    expect(snap!.fiveHour).toEqual({ used: 127694464, limit: 800000000, resetTime: new Date(1770648402389).toISOString() })
    expect(snap!.weekly).toEqual({ used: 500000000, limit: 2000000000, resetTime: new Date(1771296000000).toISOString() })
    expect(snap!.stale).toBe(false)
    expect(snap!.fetchedAt).toBe(NOW)
  })

  it('周窗缺席 → 零窗填充（limit 0 → 槽位空条，不 NaN）', () => {
    const onlySession = { code: 200, data: { limits: [limitsPayload.data.limits[0]] }, success: true }
    const snap = parseZaiQuota(onlySession, NOW)
    // Fails if: 缺席窗口产出 NaN/undefined（dock 进度条与剩N 会烂）
    expect(snap!.weekly).toEqual({ used: 0, limit: 0, resetTime: '' })
    expect(snap!.fiveHour.used).toBe(127694464)
  })

  it('非契约载荷（缺 data.limits / 非 JSON 对象）→ null（stale 兜底接住）', () => {
    // Fails if: 解析器对垃圾输入抛异常或编造快照
    expect(parseZaiQuota({}, NOW)).toBeNull()
    expect(parseZaiQuota(null, NOW)).toBeNull()
    expect(parseZaiQuota({ data: {} }, NOW)).toBeNull()
  })
})
