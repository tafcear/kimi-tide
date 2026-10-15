import { describe, expect, it } from 'vitest'
import { buildEffortCatalog, buildMountedModels, EMPTY_CATALOG_RETRY_DELAYS_MS, isEmptyEffortCatalog, planEmptyCatalogRetry } from '../src/effort-catalog.js'
import type { CandidateMeta } from '../src/config.js'

// 1.1.0 A8（2026-09-04 实机缺陷）：试一句的 reviewer 不可用判定需要路由器
// 真实挂载表（decide 侧 metas 语义）。kimi-tide-catalog 命名空间新增 mounted
// 键 = 本函数产物；efforts 只收带档位条目，不能充当挂载表。

const meta = (provider: string, model: string, available = true, efforts?: string[]): CandidateMeta => ({
  provider,
  model,
  modalities: ['text'],
  available,
  ...(efforts === undefined ? {} : { reasoningEfforts: efforts }),
})

describe('buildMountedModels（1.1.0 A8：真实挂载表发布）', () => {
  it('收 available 条目的 provider/model 键', () => {
    expect(buildMountedModels([
      meta('kimi-coding', 'k3'),
      meta('zai-coding-cn', 'glm-5.3', true),
    ])).toEqual(['kimi-coding/k3', 'zai-coding-cn/glm-5.3'])
  })
  it('available=false 剔除（decide 侧 reviewerAvailable 同语义：m.available 真值）', () => {
    expect(buildMountedModels([
      meta('kimi-coding', 'k3', true),
      meta('kimi-coding', 'ghost-model', false),
    ])).toEqual(['kimi-coding/k3'])
  })
  it('不要求带档位（efforts 表遗漏无档位模型，mounted 不遗漏）', () => {
    const metas = [meta('kimi-coding', 'no-effort-model')]
    expect(buildEffortCatalog(metas)).toEqual({})
    expect(buildMountedModels(metas)).toEqual(['kimi-coding/no-effort-model'])
  })
  it('空候选池 → 空表', () => {
    expect(buildMountedModels([])).toEqual([])
  })
})

// 2.2.4（2026-10-15 桌面端实机缺陷）：「档位不可选」现场的真身是**空档位表**——
// 挂载表 4 个模型、档位表 `{}`，而设置页唯一的禁用文案说「该模型未声明档位」，
// 把"没数据"说成"模型不支持"。判据下沉为纯函数，宿主与客户端同源。
describe('isEmptyEffortCatalog（2.2.4：空表 ≠ 该模型未声明档位）', () => {
  it('零键 / null / undefined 都是空表（客户端据此说「档位表未取到」）', () => {
    expect(isEmptyEffortCatalog({})).toBe(true)
    expect(isEmptyEffortCatalog(null)).toBe(true)
    expect(isEmptyEffortCatalog(undefined)).toBe(true)
  })
  it('有任意键即非空（表有数据、缺该模型的键走「该模型未声明档位」）', () => {
    expect(isEmptyEffortCatalog({ 'kimi-coding/k3': ['low', 'high', 'max'] })).toBe(false)
    expect(isEmptyEffortCatalog({ 'kimi-coding/k3': [] })).toBe(false)
  })
})

describe('planEmptyCatalogRetry（2.2.4：空表自动重枚举，有界）', () => {
  const mounted = ['kimi-coding/k3']
  it('挂载表非空而档位表为空 ⇒ 按顺序给下一次时延', () => {
    expect(planEmptyCatalogRetry({ efforts: {}, mounted, attempt: 0 })).toBe(EMPTY_CATALOG_RETRY_DELAYS_MS[0])
    expect(planEmptyCatalogRetry({ efforts: {}, mounted, attempt: 1 })).toBe(EMPTY_CATALOG_RETRY_DELAYS_MS[1])
  })
  it('重试次数用尽 ⇒ undefined（宿主本就不报档位时不无限重排）', () => {
    expect(planEmptyCatalogRetry({ efforts: {}, mounted, attempt: EMPTY_CATALOG_RETRY_DELAYS_MS.length })).toBeUndefined()
  })
  it('已取到任何档位 ⇒ undefined（自愈即停）', () => {
    expect(planEmptyCatalogRetry({ efforts: { 'kimi-coding/k3': ['high'] }, mounted, attempt: 0 })).toBeUndefined()
  })
  it('挂载表也为空 ⇒ undefined（枚举整体没拿到东西，再等适配器注册没意义）', () => {
    expect(planEmptyCatalogRetry({ efforts: {}, mounted: [], attempt: 0 })).toBeUndefined()
  })
  it('时延表可注入（测试与宿主共用同一判据，不给测试开后门）', () => {
    expect(planEmptyCatalogRetry({ efforts: {}, mounted, attempt: 1, delays: [1, 2, 3] })).toBe(2)
  })
})
