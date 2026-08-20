// test/settings-schema.test.ts（重写）
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_V4 } from '../src/config.js'
import { mergeResolved, routerConfigSchema, validateRouterConfig } from '../src/settings-schema.js'

describe('routerConfigSchema v4', () => {
  it('v4 默认往返相等（单一真相源）', () => {
    expect(routerConfigSchema(DEFAULT_CONFIG_V4() as never)).toEqual(DEFAULT_CONFIG_V4())
  })
  it('存量 v3 节可过 schema（注册不被拒绝）', () => {
    const v3 = { version: 3, mode: 'capability', default: { provider: 'kimi-coding', model: 'k3' }, candidates: [], scores: {}, classify: {}, allowedProviders: [], costTiers: {}, routeThreshold: 0.75, lambda: 0.5, premiumBudget: 0.2, budgetWindow: 20, charsPerToken: 2 }
    const parsed = routerConfigSchema(v3 as never) as { version: number; mode?: string; default?: { model: string } }
    expect(parsed.version).toBe(3)
    expect(parsed.mode).toBe('capability')          // migrateV3 需要 mode+default 存活
    expect(parsed.default?.model).toBe('k3')
  })
  it('存量 v2 节可过 schema', () => {
    expect((routerConfigSchema({ version: 2, mode: 'cost', default: { provider: 'kimi-tide', model: 'k3' } } as never) as { version: number }).version).toBe(2)
  })
})

describe('validateRouterConfig v4', () => {
  it('合法默认配置通过', () => {
    expect(validateRouterConfig(DEFAULT_CONFIG_V4())).toBeUndefined()
  })
  it('activePreset 不存在于 presets → 拒绝', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'ghost'
    expect(validateRouterConfig(c)).toContain('ghost')
  })
  it('规则引用缺失关键词组 → 拒绝并指出组名', () => {
    const c = DEFAULT_CONFIG_V4(); delete c.keywordGroups.code
    expect(validateRouterConfig(c)).toContain('code')
  })
  it('规则 target 缺 model → 拒绝', () => {
    const c = DEFAULT_CONFIG_V4(); c.presets.saving.rules[0].target.model = ''
    expect(validateRouterConfig(c)).toContain('image-k3')
  })
  it('legacy version（≠4）直通不校验（迁移兜底）', () => {
    expect(validateRouterConfig({ version: 3 } as never)).toBeUndefined()
  })
  it('mergeResolved：空 entry → v4 默认；部分覆盖深合并', () => {
    expect(mergeResolved(undefined)).toEqual(DEFAULT_CONFIG_V4())
    const merged = mergeResolved({ activePreset: 'saving' })
    expect(merged.activePreset).toBe('saving')
    expect(merged.presets.capability.rules).toHaveLength(2)
  })
})
