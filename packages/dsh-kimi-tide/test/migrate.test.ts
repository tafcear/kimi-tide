import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG_V3, DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, DEFAULT_CONFIG_V6, DEFAULT_FLOWS, type RouterConfigV3, type RouterConfigV5, type RouterConfigV6 } from '../src/config.js'
import { coerceRouterConfig, coerceRouterConfigV4, coerceRouterConfigV5, coerceRouterConfigV6, hasKimiTideResidue, hasKimiTideResidueV5, hasKimiTideResidueV6, migrateV1, migrateV2, migrateV3, migrateV4, migrateV5 } from '../src/migrate.js'

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

describe('migrateV4（v4→v5 行为保持）', () => {
  it('v4 输入（自定义预设/规则/关键词组）：version=5、presets/keywordGroups 逐字相等、flows=两预置、不注入 imageFallback', () => {
    const v4 = DEFAULT_CONFIG_V4()
    v4.activePreset = 'saving'
    v4.presets.custom = {
      name: '自定义',
      default: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      rules: [
        { id: 'r1', when: { kind: 'keywords', group: 'g1' }, target: { provider: 'kimi-coding', model: 'k3' } },
        { id: 'r2', when: { kind: 'image' }, target: { provider: 'kimi-coding', model: 'kimi-for-coding' } },
      ],
    }
    v4.keywordGroups.g1 = ['评审', 'review']
    const v5 = migrateV4(v4)
    expect(v5.version).toBe(5)
    expect(v5.activePreset).toBe('saving')
    expect(v5.presets).toEqual(v4.presets)
    expect(v5.keywordGroups).toEqual(v4.keywordGroups)
    expect(v5.flows).toEqual(DEFAULT_FLOWS())
    expect(Object.keys(v5.flows).sort()).toEqual(['review', 'transcribe'])
    for (const p of Object.values(v5.presets)) {
      expect(p).not.toHaveProperty('imageFallback')
      expect(p).not.toHaveProperty('imageFallbackFlow')
    }
  })
  it('v5 直通幂等（同引用）', () => {
    const c = DEFAULT_CONFIG_V5()
    expect(migrateV4(c)).toBe(c)
    expect(coerceRouterConfigV5(c, () => {})).toBe(c)
  })
  it('v3 链路端到端出 v5（语义映射 → 行为保持展开）', () => {
    const v5 = migrateV4({ version: 3, mode: 'capability', default: { provider: 'kimi-coding', model: 'kimi-for-coding-highspeed' } })
    expect(v5.version).toBe(5)
    expect(v5.activePreset).toBe('capability')
    expect(v5.presets.capability.default).toEqual({ provider: 'kimi-coding', model: 'kimi-for-coding-highspeed' })
    expect(v5.flows).toEqual(DEFAULT_FLOWS())
    expect(v5.presets.saving.default.model).toBe('deepseek-v4-flash')
  })
  it('v1 链路端到端出 v5（kimi-tide 改名全程贯通、无残留）', () => {
    const v5 = coerceRouterConfigV5(V1, () => {})
    expect(v5.version).toBe(5)
    expect(v5.activePreset).toBe('saving')                       // V1.mode='cost' → saving
    expect(v5.presets.saving.default).toEqual(V1.primary)
    expect(JSON.stringify(v5).includes('kimi-tide')).toBe(false)
  })
  it('coerceRouterConfigV5：v2 链（kimi-tide 改名 → 语义映射 → v5 展开）', () => {
    const v5 = coerceRouterConfigV5(V2, () => {})
    expect(v5.version).toBe(5)
    expect(v5.activePreset).toBe('capability')
    expect(v5.presets.capability.default).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(v5.flows).toEqual(DEFAULT_FLOWS())
  })
  it('hasKimiTideResidueV5：version!==5 → true；v5 无残留 → false；v5 含 kimi-tide 串 → true', () => {
    expect(hasKimiTideResidueV5({ version: 4 })).toBe(true)
    expect(hasKimiTideResidueV5(DEFAULT_CONFIG_V4())).toBe(true)
    expect(hasKimiTideResidueV5(DEFAULT_CONFIG_V5())).toBe(false)
    const dirty = DEFAULT_CONFIG_V5(); dirty.presets.saving.name = 'kimi-tide 遗留'
    expect(hasKimiTideResidueV5(dirty)).toBe(true)
  })
})

describe('migrateV5（v5→v6：存量保持旧行为）', () => {
  it('自定义 v5 输入：预设/流/词组逐字保持；driverSticky 显式 false；不写 driver / rulesApplyToChildren', () => {
    const v5 = DEFAULT_CONFIG_V5()
    v5.activePreset = 'saving'
    const v6 = migrateV5(v5)
    expect(v6.version).toBe(6)
    expect(v6.presets).toEqual(v5.presets)
    expect(v6.flows).toEqual(v5.flows)
    expect(v6.keywordGroups).toEqual(v5.keywordGroups)
    expect(v6.roles).toEqual({})
    expect(v6.driverSticky).toBe(false)          // 存量保持 v1.4.1 行为
    expect(v6).not.toHaveProperty('driver')
    expect(v6).not.toHaveProperty('rulesApplyToChildren')
  })

  it('终审 I3：v5 输入已带分工层字段 ⇒ 透传保留（export→import 往返不丢分工表）', () => {
    // R2 常态：存量升级用户经设置卡写 roles/driver 后，文档仍是 version:5 且携带
    // 分工层字段，export-config 原样产出。migrateV5 逐字段重建 ⇒ import 后 roles
    // 被重置 {}、driver/driverSticky 静默蒸发（数据丢失，且无任何提示）。
    const v5 = DEFAULT_CONFIG_V5() as RouterConfigV5 & Partial<RouterConfigV6>
    v5.activePreset = 'saving'
    v5.roles = {
      frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'kimi-for-coding' }, teammate: ['fe'] },
    }
    v5.driver = { provider: 'kimi-coding', model: 'k3' }
    v5.driverSticky = true
    v5.rulesApplyToChildren = true
    const v6 = migrateV5(v5)
    // Fails if: 重建式迁移——roles 恒 {}、driverSticky 恒 false、driver/rulesApplyToChildren 不携带
    expect(v6.roles).toEqual(v5.roles)
    expect(v6.driver).toEqual(v5.driver)
    expect(v6.driverSticky).toBe(true)
    expect(v6.rulesApplyToChildren).toBe(true)
  })

  it('终审 I3：v5 输入显式 driver:null ⇒ 透传 null（「跟随宿主默认」的显式选择不丢）', () => {
    const v5 = DEFAULT_CONFIG_V5() as RouterConfigV5 & { driver?: unknown }
    v5.driver = null
    // Fails if: 只在「非空目标」时携带——显式 null 被当成缺席而丢键
    expect(migrateV5(v5).driver).toBeNull()
  })

  it('终审 I3/F4 口径接缝：v5 输入缺席 driverSticky ⇒ 仍显式写 false（存量口径不变）', () => {
    // 透传只针对「输入已存在」的字段；driverSticky 缺席时迁移路径必须保持
    // 「存量显式 false」裁定（否则未迁移文档会被静默读成新装默认 true）。
    const v6 = migrateV5(DEFAULT_CONFIG_V5())
    expect(v6.driverSticky).toBe(false)
  })

  it('同引用直通幂等：已是 v6 的输入原样返回', () => {
    const v6 = migrateV5(DEFAULT_CONFIG_V5())
    expect(migrateV5(v6)).toBe(v6)
    expect(coerceRouterConfigV6(v6, () => {})).toBe(v6)
  })

  it('v1 → v6 端到端：走完整链路不抛错，且 flows 为内置流', () => {
    const v6 = coerceRouterConfigV6(V1, () => {})
    expect(v6.version).toBe(6)
    expect(v6.flows).toEqual(DEFAULT_FLOWS())
  })

  it('hasKimiTideResidueV6：v6 无残留为 false；v5 残留为 true', () => {
    expect(hasKimiTideResidueV6(DEFAULT_CONFIG_V6())).toBe(false)
    expect(hasKimiTideResidueV6(DEFAULT_CONFIG_V5())).toBe(true)
  })
})
