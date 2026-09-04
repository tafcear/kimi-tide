import { describe, expect, it } from 'vitest'
import { buildEffortCatalog, buildMountedModels } from '../src/effort-catalog.js'
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
