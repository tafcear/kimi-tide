/**
 * zai-coding-cn（GLM Coding Plan）配额解析器单测。
 * 端点契约溯源：Z.ai 内部接口 GET /api/monitor/usage/quota/limit——
 * ①用户套餐实抓（2026-08-29）：CREDIT_LIMIT 积分制，unit3/5=5h 窗、unit6/1=周窗，
 *   data.level=套餐档；②文档形态（OpenTokenUsage zai.md）：TOKENS_LIMIT，
 *   unit6/number 7 周窗。两种 type 均须解析。每个用例注释标注「会使其失败的生产改动」。
 */
import { describe, expect, it } from 'vitest'
import { parseZaiQuota } from '../src/zai-usage.js'

const NOW = 1770648000000

/** 真实响应夹具（2026-08-29 用户套餐实抓：CREDIT_LIMIT 积分制 + level pro）。 */
const realPayload = {
  code: 200,
  msg: 'Operation successful',
  data: {
    limits: [
      { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 12000, currentValue: 2561, remaining: 9438, percentage: 21, nextResetTime: 1788029352319 },
      { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 60000, currentValue: 34781, remaining: 25218, percentage: 57, nextResetTime: 1788354696998 },
    ],
    level: 'pro',
  },
  success: true,
}

/** 文档形态夹具（TOKENS_LIMIT，unit6/number 7 周窗）——保持兼容。 */
const docPayload = {
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
  it('真实响应（CREDIT_LIMIT）：unit3/5 → fiveHour、unit6/1 → weekly、level → membershipLevel', () => {
    const snap = parseZaiQuota(realPayload, NOW)
    // Fails if: 解析器只认文档的 TOKENS_LIMIT（用户套餐是 CREDIT_LIMIT → 假数据剩0）
    expect(snap).not.toBeNull()
    expect(snap!.fiveHour).toEqual({ used: 2561, limit: 12000, resetTime: new Date(1788029352319).toISOString() })
    expect(snap!.weekly).toEqual({ used: 34781, limit: 60000, resetTime: new Date(1788354696998).toISOString() })
    expect(snap!.membershipLevel).toBe('pro')
    expect(snap!.stale).toBe(false)
    expect(snap!.fetchedAt).toBe(NOW)
  })

  it('文档形态（TOKENS_LIMIT unit6/7）保持兼容', () => {
    const snap = parseZaiQuota(docPayload, NOW)
    // Fails if: type 白名单收窄到只认 CREDIT_LIMIT（其他套餐形态被丢）
    expect(snap!.fiveHour.used).toBe(127694464)
    expect(snap!.weekly.used).toBe(500000000)
  })

  it('周窗缺席 → 零窗填充（limit 0 → 槽位空条，不 NaN）', () => {
    const onlySession = { code: 200, data: { limits: [realPayload.data.limits[0]] }, success: true }
    const snap = parseZaiQuota(onlySession, NOW)
    // Fails if: 缺席窗口产出 NaN/undefined（dock 进度条与剩N 会烂）
    expect(snap!.weekly).toEqual({ used: 0, limit: 0, resetTime: '' })
    expect(snap!.fiveHour.used).toBe(2561)
  })

  it('非契约载荷（缺 data.limits / 非 JSON 对象）→ null（stale 兜底接住）', () => {
    // Fails if: 解析器对垃圾输入抛异常或编造快照
    expect(parseZaiQuota({}, NOW)).toBeNull()
    expect(parseZaiQuota(null, NOW)).toBeNull()
    expect(parseZaiQuota({ data: {} }, NOW)).toBeNull()
  })
})
