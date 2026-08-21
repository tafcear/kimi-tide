import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG_V3, DEFAULT_CONFIG_V4, type RouterConfigV3 } from '../src/config.js'
import { coerceRouterConfig, coerceRouterConfigV4, hasKimiTideResidue, migrateV1, migrateV2, migrateV3 } from '../src/migrate.js'

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
    expect(JSON.stringify(out).includes('kimi-tide')).toBe(false)
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

describe('migrateV3', () => {
  it('mode off → activePreset null，预设保持内置', () => {
    const v4 = migrateV3({ version: 3, mode: 'off', default: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } })
    expect(v4.version).toBe(4)
    expect(v4.activePreset).toBeNull()
    expect(v4.presets.saving.default.model).toBe('deepseek-v4-flash')
  })
  it('mode cost → saving；default 与内置相同 → 不覆盖', () => {
    const v4 = migrateV3({ version: 3, mode: 'cost', default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    expect(v4.activePreset).toBe('saving')
    expect(v4.presets.saving.default.model).toBe('deepseek-v4-flash')
  })
  it('mode capability + 自定义 default → capability 且 default 写入该预设', () => {
    const v4 = migrateV3({ version: 3, mode: 'capability', default: { provider: 'kimi-coding', model: 'kimi-for-coding-highspeed' } })
    expect(v4.activePreset).toBe('capability')
    expect(v4.presets.capability.default).toEqual({ provider: 'kimi-coding', model: 'kimi-for-coding-highspeed' })
    expect(v4.presets.saving.default.model).toBe('deepseek-v4-flash')  // 另一预设不动
  })
  it('Ruling 11：capability + deepseek 默认（遗留便宜默认，本机实况）→ 不覆盖，保留内置 k3 打底', () => {
    const v4 = migrateV3({ version: 3, mode: 'capability', default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    expect(v4.activePreset).toBe('capability')
    expect(v4.presets.capability.default).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(v4.presets.saving.default.model).toBe('deepseek-v4-flash')
  })
  it('Ruling 11：cost + deepseek 非内置默认 → saving 仍无条件覆盖（省钱映射语义不变）', () => {
    const v4 = migrateV3({ version: 3, mode: 'cost', default: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } })
    expect(v4.activePreset).toBe('saving')
    expect(v4.presets.saving.default).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(v4.presets.capability.default.model).toBe('k3')
  })
  it('scores/candidates/classify/预算参数一律不迁移', () => {
    const v4 = migrateV3({ version: 3, mode: 'cost', default: { provider: 'a', model: 'b' }, scores: { 'a/b': { code: 5 } }, premiumBudget: 0.9 })
    expect(v4).not.toHaveProperty('scores')
    expect(v4).not.toHaveProperty('premiumBudget')
  })
  it('v4 直通（幂等）', () => {
    const c = DEFAULT_CONFIG_V4()
    expect(migrateV3(c)).toBe(c)
  })
  it('coerceRouterConfigV4：v2 链（kimi-tide 改名 → 语义映射）', () => {
    const v4 = coerceRouterConfigV4({ version: 2, mode: 'cost', default: { provider: 'kimi-tide', model: 'k3' }, candidates: [] }, () => {})
    expect(v4.activePreset).toBe('saving')
    expect(v4.presets.saving.default.provider).toBe('kimi-coding')
  })
  it('hasKimiTideResidue：version!==4 → true；v4 无残留 → false', () => {
    expect(hasKimiTideResidue({ version: 3 })).toBe(true)
    expect(hasKimiTideResidue(DEFAULT_CONFIG_V4())).toBe(false)
    const dirty = DEFAULT_CONFIG_V4(); dirty.presets.saving.name = 'kimi-tide 遗留'
    expect(hasKimiTideResidue(dirty)).toBe(true)
  })
})
