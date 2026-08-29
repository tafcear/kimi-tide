/**
 * 多 plan 配额投影：quotas map（provider → 快照 | null）可选字段——
 * 向后兼容（旧载荷无该字段通过；新载荷经 wire schema 不被剥离）。
 */
import { describe, expect, it } from 'vitest'
import { kimiTideProjectionDefinition } from '../src/projection.js'

const base = {
  quota: null,
  kimi: { route: true, key: true },
  router: {},
  reasoning: { enabled: true },
  configSource: 'default',
  candidates: [],
  decision: null,
}

const zaiSnap = {
  weekly: { used: 500000000, limit: 2000000000, resetTime: '2026-02-16T00:00:00.000Z' },
  fiveHour: { used: 127694464, limit: 800000000, resetTime: '2026-02-09T20:06:42.389Z' },
  membershipLevel: '',
  fetchedAt: 1,
  stale: false,
}

describe('投影 quotas map（多 plan 配额）', () => {
  it('wire schema 接受 quotas（新载荷字段不被剥离）', () => {
    const payload = { ...base, quotas: { 'zai-coding-cn': zaiSnap, 'kimi-coding': null } }
    const parsed = kimiTideProjectionDefinition.wire.viewSchema.parse(payload) as Record<string, unknown>
    // Fails if: panelSchema 未加 quotas 字段（wire 校验静默剥离 → dock 永远拿不到）
    expect((parsed.quotas as Record<string, unknown>)['zai-coding-cn']).toEqual(zaiSnap)
  })

  it('旧载荷（无 quotas）照常通过（向后兼容）', () => {
    expect(() => kimiTideProjectionDefinition.wire.viewSchema.parse(base)).not.toThrow()
  })
})
