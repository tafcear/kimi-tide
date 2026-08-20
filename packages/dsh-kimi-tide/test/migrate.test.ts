import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG_V3, type RouterConfigV3 } from '../src/config.js'
import { coerceRouterConfig, hasKimiTideResidue, migrateV1, migrateV2 } from '../src/migrate.js'

const V1 = {
  mode: 'cost',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
  premiumLong: { provider: 'kimi-tide', model: 'k3' },
  premiumBudget: 0.3,
}

const V2: Record<string, unknown> = {
  version: 2, mode: 'capability',
  default: { provider: 'kimi-tide', model: 'k3' },
  candidates: [
    { provider: 'kimi-tide', model: 'k3' },
    { provider: 'kimi-tide', model: 'kimi-for-coding' },
    { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  ],
  scores: { 'kimi-tide/k3': { code: 4.7 }, 'kimi-tide/kimi-for-coding': { code: 4.5 } },
  classify: { patterns: { code: ['审查'] } },
  allowedProviders: ['kimi-tide', 'deepseek-official'],
  costTiers: { 'kimi-tide/k3': 'mid' },
  routeThreshold: 0.8, lambda: 0.4, premiumBudget: 0.2, budgetWindow: 20, charsPerToken: 2,
}

describe('migrateV1', () => {
  it('maps primary→default, premium→candidates[0], drops premiumLong with one warn', () => {
    const warn = vi.fn()
    const out = migrateV1(V1, warn)
    expect(out.version).toBe(3)
    expect(out.default).toEqual(V1.primary)
    expect(out.candidates[0]).toEqual({ provider: 'kimi-coding', model: 'kimi-for-coding' })
    expect(out.premiumBudget).toBe(0.3)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('premiumLong')
  })
  it('non-v1 input falls back to defaults without throwing', () => {
    expect(migrateV1({ nonsense: 1 }, () => {}).version).toBe(3)
    expect(migrateV1(null, () => {}).version).toBe(3)
  })
})

describe('migrateV2（kimi-tide → kimi-coding）', () => {
  it('rewrites provider values in default/candidates/allowedProviders', () => {
    const out = migrateV2(V2)
    expect(out.version).toBe(3)
    expect(out.default).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(out.candidates.map((c) => c.provider)).toEqual(['kimi-coding', 'kimi-coding', 'deepseek-official'])
    expect(out.allowedProviders).toEqual(['kimi-coding', 'deepseek-official'])
  })

  it('rewrites kimi-tide/ key prefixes in scores and costTiers, keeps other fields', () => {
    const out = migrateV2(V2)
    expect(out.scores).toEqual({
      'kimi-coding/k3': { code: 4.7 },
      'kimi-coding/kimi-for-coding': { code: 4.5 },
    })
    expect(out.costTiers).toEqual({ 'kimi-coding/k3': 'mid' })
    expect(out.classify).toEqual({ patterns: { code: ['审查'] } })
    expect(out.routeThreshold).toBe(0.8)
    expect(out.lambda).toBe(0.4)
    expect(out.mode).toBe('capability')
    expect(out.premiumBudget).toBe(0.2)
    expect(out.budgetWindow).toBe(20)
    expect(out.charsPerToken).toBe(2)
    expect(out.default.model).toBe('k3')
  })

  it('is idempotent: a v3 config with no residue passes through unchanged', () => {
    const out = migrateV2(migrateV2(V2))
    expect(out).toEqual(migrateV2(V2))
    expect(hasKimiTideResidue(out)).toBe(false)
    expect(migrateV2(out)).toBe(out)   // 原引用返回 = 幂等
  })
})

describe('coerceRouterConfig 版本分派', () => {
  it('version 3 passes through, version 2 migrates, v1 shape migrates via migrateV1', () => {
    const v3 = migrateV2(V2)
    expect(coerceRouterConfig(v3, () => {})).toBe(v3)
    expect(coerceRouterConfig(V2, () => {}).default.provider).toBe('kimi-coding')
    const v1 = { mode: 'cost', primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, premium: { provider: 'kimi-tide', model: 'k3' } }
    const fromV1 = coerceRouterConfig(v1, () => {})
    expect(fromV1.version).toBe(3)
    expect(fromV1.candidates[0]).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(migrateV1(v1, () => {}).default).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })
})
