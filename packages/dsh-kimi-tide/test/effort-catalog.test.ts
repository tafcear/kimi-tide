import { describe, expect, it } from 'vitest'
import { buildEffortCatalog, buildMountedModels, EMPTY_CATALOG_RETRY_DELAYS_MS, isEmptyEffortCatalog, planEmptyCatalogRetry, readPublishedCatalog } from '../src/effort-catalog.js'
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

// 2.2.5（2026-10-19 桌面端实机）：修前「空池」与「有模型但无档位」共用一条判据——
// 空池（挂载表为空）被判成「provider 尚未注册、等宿主事件」，于是**不重试**；实机真身
// 是 DSH 0.2.1-rc.2 适配器已注册、listModels 在挂载窗口内还回空，几秒后才回填 ⇒ 档位表
// 永久为空。现在两者都排有界重试；空池还额外「不覆盖已发布目录」（见 index.ts）。
describe('planEmptyCatalogRetry（2.2.5：空池与空表都重试，有界）', () => {
  it('档位表为空且池子非空 ⇒ 按顺序给下一次时延', () => {
    expect(planEmptyCatalogRetry({ efforts: {}, emptyPool: false, attempt: 0 })).toBe(EMPTY_CATALOG_RETRY_DELAYS_MS[0])
    expect(planEmptyCatalogRetry({ efforts: {}, emptyPool: false, attempt: 1 })).toBe(EMPTY_CATALOG_RETRY_DELAYS_MS[1])
  })
  it('空池 ⇒ 即使已发布目录非空也排重试（本轮枚举是瞬态，需要再枚举）', () => {
    expect(planEmptyCatalogRetry({ efforts: { 'kimi-coding/k3': ['low', 'high'] }, emptyPool: true, attempt: 0 }))
      .toBe(EMPTY_CATALOG_RETRY_DELAYS_MS[0])
  })
  it('空池且无已发布目录（冷启动现场）⇒ 同样排重试', () => {
    expect(planEmptyCatalogRetry({ efforts: {}, emptyPool: true, attempt: 0 })).toBe(EMPTY_CATALOG_RETRY_DELAYS_MS[0])
  })
  it('重试次数用尽 ⇒ undefined（有界，不无限重排/不刷屏）', () => {
    expect(planEmptyCatalogRetry({ efforts: {}, emptyPool: true, attempt: EMPTY_CATALOG_RETRY_DELAYS_MS.length })).toBeUndefined()
    expect(planEmptyCatalogRetry({ efforts: {}, emptyPool: false, attempt: EMPTY_CATALOG_RETRY_DELAYS_MS.length })).toBeUndefined()
  })
  it('已取到任何档位且非空池 ⇒ undefined（自愈即停）', () => {
    expect(planEmptyCatalogRetry({ efforts: { 'kimi-coding/k3': ['high'] }, emptyPool: false, attempt: 0 })).toBeUndefined()
  })
  it('时延表可注入（测试与宿主共用同一判据，不给测试开后门）', () => {
    expect(planEmptyCatalogRetry({ efforts: {}, emptyPool: false, attempt: 1, delays: [1, 2, 3] })).toBe(2)
  })
})

// 2.2.5：插件重载后首帧不得把上一轮已发布的目录覆盖成空（实机 16:54 现场）。
describe('readPublishedCatalog（2.2.5：插件重载时读回上一轮目录）', () => {
  it('读条目原始 config 的 efforts / mounted（profile patch 原文形态）', () => {
    const raw = { router: { activePreset: 'capability' }, efforts: { 'kimi-coding/k3': ['low', 'high'] }, mounted: ['kimi-coding/k3'] }
    expect(readPublishedCatalog(raw)).toEqual({
      efforts: { 'kimi-coding/k3': ['low', 'high'] },
      mounted: ['kimi-coding/k3'],
    })
  })
  it('解开 schemastery 引用（.get()）', () => {
    const ref = (value: unknown) => ({ get: () => value })
    expect(readPublishedCatalog({ efforts: ref({ 'zai-coding-cn/glm-5.3': ['low', 'max'] }), mounted: ref(['zai-coding-cn/glm-5.3']) }))
      .toEqual({ efforts: { 'zai-coding-cn/glm-5.3': ['low', 'max'] }, mounted: ['zai-coding-cn/glm-5.3'] })
  })
  it('缺键按空表处理（只发布了 mounted 的半截现场也保留）', () => {
    expect(readPublishedCatalog({ mounted: ['kimi-coding/k3'] })).toEqual({ efforts: {}, mounted: ['kimi-coding/k3'] })
  })
  it('没有任何目录字段 ⇒ null（首装：退回旧行为，不伪造数据）', () => {
    expect(readPublishedCatalog(undefined)).toBeNull()
    expect(readPublishedCatalog(null)).toBeNull()
    expect(readPublishedCatalog({ router: {} })).toBeNull()
  })
  it('形状不合 ⇒ null（不把脏数据当真表）', () => {
    expect(readPublishedCatalog({ efforts: [], mounted: [] })).toBeNull()
    expect(readPublishedCatalog({ efforts: { 'kimi-coding/k3': 'low' }, mounted: [] })).toBeNull()
    expect(readPublishedCatalog({ efforts: { 'kimi-coding/k3': [1] }, mounted: [] })).toBeNull()
    expect(readPublishedCatalog({ efforts: {}, mounted: 'kimi-coding/k3' })).toBeNull()
    expect(readPublishedCatalog({ efforts: {}, mounted: [42] })).toBeNull()
  })
})
