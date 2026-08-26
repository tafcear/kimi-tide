// test/settings-schema.test.ts（v5 重写）
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, DEFAULT_FLOWS, type RouterConfigV5 } from '../src/config.js'
import { mergeResolved, routerConfigSchema, validateRouterConfig } from '../src/settings-schema.js'

describe('routerConfigSchema v5', () => {
  it('v5 默认往返相等（单一真相源）', () => {
    expect(routerConfigSchema(DEFAULT_CONFIG_V5() as never)).toEqual(DEFAULT_CONFIG_V5())
  })
  it('v5 节缺 flows → 注入 {}（dict 隐式默认；预置流默认值由 mergeResolved deepMerge 供给）', () => {
    const { flows: _, ...rest } = DEFAULT_CONFIG_V5()
    const parsed = routerConfigSchema(rest as never) as RouterConfigV5
    expect(parsed.version).toBe(5)
    expect(parsed.flows).toEqual({})
  })
  it('规则 target 流引用过 schema（union 流分支）；imageFallback/imageFallbackFlow 缺省不注入', () => {
    const c = DEFAULT_CONFIG_V5()
    c.presets.saving.rules.push({ id: 'img-flow', when: { kind: 'image' }, target: { flow: 'transcribe' } })
    c.presets.saving.imageFallback = 'latch'
    const parsed = routerConfigSchema(c as never) as RouterConfigV5
    expect(parsed.presets.saving.rules[2].target).toEqual({ flow: 'transcribe' })
    expect(parsed.presets.saving.imageFallback).toBe('latch')
    expect(parsed.presets.saving.imageFallbackFlow).toBeUndefined()
    expect(parsed.presets.capability.imageFallback).toBeUndefined()
  })
  it('imageFallback 非法值 → schema 拒绝（存在即校验）', () => {
    const c = DEFAULT_CONFIG_V5()
    ;(c.presets.saving as { imageFallback?: string }).imageFallback = 'bogus'
    expect(() => routerConfigSchema(c as never)).toThrow(/imageFallback/)
  })
  it('存量 v4 节可过 schema（version 4 保留，flows 注入 {}）', () => {
    const parsed = routerConfigSchema(DEFAULT_CONFIG_V4() as never) as RouterConfigV5
    expect(parsed.version).toBe(4)
    expect(parsed.flows).toEqual({})
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

describe('validateRouterConfig v5', () => {
  it('合法 v5 默认配置通过（schema 往返后亦然）', () => {
    expect(validateRouterConfig(routerConfigSchema(DEFAULT_CONFIG_V5() as never) as RouterConfigV5)).toBeUndefined()
  })
  it('activePreset 不存在于 presets → 拒绝', () => {
    const c = DEFAULT_CONFIG_V5(); c.activePreset = 'ghost'
    expect(validateRouterConfig(c)).toContain('ghost')
  })
  it('规则引用缺失关键词组 → 拒绝并指出组名', () => {
    const c = DEFAULT_CONFIG_V5(); delete c.keywordGroups.code
    expect(validateRouterConfig(c)).toContain('code')
  })
  it('规则 target 缺 model → 拒绝', () => {
    const c = DEFAULT_CONFIG_V5()
    ;(c.presets.saving.rules[0].target as { model: string }).model = ''
    expect(validateRouterConfig(c)).toContain('image-k3')
  })
  it('规则 target 引用不存在的协作流 → 拒绝并指出流名', () => {
    const c = DEFAULT_CONFIG_V5()
    c.presets.saving.rules.push({ id: 'img-flow', when: { kind: 'image' }, target: { flow: 'ghost' } })
    expect(validateRouterConfig(c)).toContain('ghost')
  })
  it('review 流作规则目标 → 拒绝（P1 仅 transcribe 可作规则目标）', () => {
    const c = DEFAULT_CONFIG_V5()
    c.presets.saving.rules.push({ id: 'rev-flow', when: { kind: 'image' }, target: { flow: 'review' } })
    expect(validateRouterConfig(c)).toContain('review')
  })
  it("imageFallback='transcribe-lazy' 缺 imageFallbackFlow → 默认解析预置 transcribe，通过", () => {
    const c = DEFAULT_CONFIG_V5()
    c.presets.saving.imageFallback = 'transcribe-lazy'
    const parsed = routerConfigSchema(c as never) as RouterConfigV5
    expect(parsed.presets.saving.imageFallback).toBe('transcribe-lazy')
    expect(parsed.presets.saving.imageFallbackFlow).toBeUndefined()  // 无 default 不注入
    expect(validateRouterConfig(parsed)).toBeUndefined()             // 级联缺省 = flows.transcribe
  })
  it('imageFallbackFlow 指向不存在的流 → 拒绝', () => {
    const c = DEFAULT_CONFIG_V5()
    c.presets.saving.imageFallback = 'transcribe-lazy'
    c.presets.saving.imageFallbackFlow = 'ghost'
    expect(validateRouterConfig(c)).toContain('ghost')
  })
  it('imageFallbackFlow 指向 review 流 → 拒绝（级联目标必须是 transcribe 流）', () => {
    const c = DEFAULT_CONFIG_V5()
    c.presets.saving.imageFallback = 'transcribe-lazy'
    c.presets.saving.imageFallbackFlow = 'review'
    expect(validateRouterConfig(c)).toContain('review')
  })
  it('review 流 rounds 越界（<1 或 >3）→ 拒绝', () => {
    const c = DEFAULT_CONFIG_V5()
    ;(c.flows.review as { rounds: number }).rounds = 4
    expect(validateRouterConfig(c)).toContain('rounds')
    ;(c.flows.review as { rounds: number }).rounds = 0
    expect(validateRouterConfig(c)).toContain('rounds')
  })
  it('review 流 trigger=keywords 无 keywordGroup → 拒绝', () => {
    const c = DEFAULT_CONFIG_V5()
    c.flows.review = { type: 'review', reviewer: { provider: 'kimi-coding', model: 'k3' }, trigger: 'keywords', rounds: 2, autoRevise: true }
    expect(validateRouterConfig(c)).toContain('keywordGroup')
  })
  it('legacy version（≤4）直通不校验（迁移兜底，注册期不做语义校验）', () => {
    expect(validateRouterConfig({ version: 3 } as never)).toBeUndefined()
    const v4 = DEFAULT_CONFIG_V4(); v4.activePreset = 'ghost'   // v4 语义下非法，v5 注册期直通
    expect(validateRouterConfig(v4 as never)).toBeUndefined()
  })
})

describe('mergeResolved v5', () => {
  it('空 entry → v5 默认（flows 预置由 deepMerge(DEFAULT_CONFIG_V5()) 供给）', () => {
    expect(mergeResolved(undefined)).toEqual(DEFAULT_CONFIG_V5())
  })
  it('部分覆盖深合并', () => {
    const merged = mergeResolved({ activePreset: 'saving' })
    expect(merged.activePreset).toBe('saving')
    expect(merged.presets.capability.rules).toHaveLength(2)
    expect(merged.flows).toEqual(DEFAULT_FLOWS())
  })
})

describe('validateRouterConfig minHits（0.7.0）', () => {
  const withMin = (mh: number) => {
    const c = structuredClone(DEFAULT_CONFIG_V5()); c.activePreset = 'saving'
    c.presets.saving.rules.unshift({
      id: 'x', when: { kind: 'keywords', group: 'code', minHits: mh },
      target: { provider: 'kimi-coding', model: 'k3' },
    })
    return validateRouterConfig(c)
  }
  it('越界（0/小数/负数）拒写；1/2/缺省通过', () => {
    expect(withMin(0)).toContain('minHits')
    expect(withMin(1.5)).toContain('minHits')
    expect(withMin(-1)).toContain('minHits')
    expect(withMin(1)).toBeUndefined()
    expect(withMin(2)).toBeUndefined()
  })
})
