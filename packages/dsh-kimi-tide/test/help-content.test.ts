/**
 * help-content 结构与防腐烂闸（说明页签 spec v2 §7/§11.1-M6）。
 *
 * 三类断言：
 * - 结构完整性 + 覆盖双向闸（DOCK_ELEMENTS / SETTINGS_SECTIONS 与条目互查）；
 * - 防腐烂闸：FEATURE_KEYS 全路径在「含全部可选字段」的样例配置上必须走通，
 *   且 schema 顶层键集反向 ⊆ FEATURE_KEYS 首段集合（新增配置字段而不补说明条目 → 红）；
 * - WHATS_NEW（「本次新版」导览）的**结构完整性**：它与 HELP_SECTIONS 分开（时效文案、
 *   无锚点、不参与覆盖闸），但空条目/重复 id 同样要拦住。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_V5, rowsFromLegacy, type RouterConfigV5 } from '../src/config.js'
import { routerConfigSchema } from '../src/settings-schema.js'
import { DOCK_ELEMENTS, FEATURE_KEYS, HELP_SECTIONS, LEGACY_CONFIG_KEYS, SETTINGS_SECTIONS, WHATS_NEW } from '../src/client/help-content.js'

/** 含全部可选字段的样例配置（可选字段不在 DEFAULT_CONFIG_V5 里，须单独构造）。 */
function fullSample(): RouterConfigV5 {
  const c = DEFAULT_CONFIG_V5()
  c.auxTargets = { 'session-title': { provider: 'deepseek-official', model: 'deepseek-flash' } }
  const preset = c.presets.saving!
  preset.imageFallback = 'latch'
  preset.imageFallbackFlow = 'transcribe'
  preset.rules = [{ id: 'r1', when: { kind: 'keywords', group: 'code', minHits: 2 }, target: { provider: 'deepseek-official', model: 'deepseek-flash' } }]
  c.flows.review = {
    type: 'review',
    reviewer: { provider: 'qwen-token-plan-cn', model: 'qwen3.8-max' },
    trigger: 'keywords',
    keywordGroup: 'review',
    rounds: 1,
    autoRevise: false,
    recheck: true,
  }
  // v6（团队派发）顶层键：FEATURE_KEYS 首段占位闸要求样例含全部可选字段。
  const v6 = c as RouterConfigV5 & {
    driver?: { provider: string; model: string } | null
    driverSticky?: boolean
    rulesApplyToChildren?: boolean
    roles?: Record<string, unknown>
    version?: number
    routes?: unknown[]
  }
  v6.driver = { provider: 'kimi-coding', model: 'k3' }
  v6.driverSticky = true
  v6.rulesApplyToChildren = false
  v6.roles = { frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'k3' } } }
  // v7（统一路由表）：真源字段。schemastery 对未声明键是**透传保留**（实测往返不丢），
  // 故反向闸扫不到 `routes`；这里靠 FEATURE_KEYS 正向闸保证「样例能走通 routes.* 路径」。
  v6.version = 7
  v6.routes = rowsFromLegacy(c as never) as unknown[]
  return c
}

/** 按 'a.b.c' 路径取值；任一层缺失返回 undefined。 */
function resolvePath(root: unknown, path: string): unknown {
  let cur: unknown = root
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

describe('help-content：结构完整性', () => {
  it('八个分区，每个分区有条目、条目 id 全局唯一、标题与正文非空', () => {
    expect(HELP_SECTIONS).toHaveLength(8)
    const ids = new Set<string>()
    for (const section of HELP_SECTIONS) {
      expect(section.id).not.toBe('')
      expect(section.title).not.toBe('')
      expect(section.entries.length).toBeGreaterThan(0)
      for (const entry of section.entries) {
        expect(entry.id).not.toBe('')
        expect(entry.title).not.toBe('')
        expect(entry.body.length).toBeGreaterThan(0)
        expect(entry.body.every((line) => line.trim() !== '')).toBe(true)
        expect(ids.has(entry.id)).toBe(false)
        ids.add(entry.id)
      }
    }
  })

  it('覆盖闸（双向）：DOCK_ELEMENTS 与 SETTINGS_SECTIONS 逐项有说明，且说明不写幽灵元素', () => {
    const declared = new Set<string>([...DOCK_ELEMENTS, ...SETTINGS_SECTIONS])
    const referenced = new Set<string>()
    for (const section of HELP_SECTIONS) {
      for (const entry of section.entries) {
        for (const anchor of entry.anchors ?? []) {
          referenced.add(anchor)
          // 幽灵文档：说明里引用了不存在的元素/区块
          expect(declared.has(anchor)).toBe(true)
        }
      }
    }
    // 漏写：声明了却在说明里找不到
    for (const id of declared) expect(referenced.has(id)).toBe(true)
  })
})

describe('help-content：本次新版导览（WHATS_NEW）', () => {
  it('条目非空、id 唯一、标题与每行正文非空', () => {
    expect(WHATS_NEW.length).toBeGreaterThan(0)
    const ids = new Set<string>()
    for (const entry of WHATS_NEW) {
      expect(entry.id).not.toBe('')
      expect(entry.title).not.toBe('')
      expect(entry.body.length).toBeGreaterThan(0)
      expect(entry.body.every((line) => line.trim() !== '')).toBe(true)
      expect(ids.has(entry.id)).toBe(false)
      ids.add(entry.id)
    }
  })

  it('导览 id 与 HELP_SECTIONS 的条目 id 不冲突（两套 key 同处一棵 React 树）', () => {
    const sectionIds = new Set<string>()
    for (const section of HELP_SECTIONS) for (const entry of section.entries) sectionIds.add(entry.id)
    for (const entry of WHATS_NEW) expect(sectionIds.has(entry.id)).toBe(false)
  })
})

describe('help-content：防腐烂闸（FEATURE_KEYS × 配置面）', () => {
  it('每条特性键在含全部可选字段的样例配置上都能走通', () => {
    const sample = fullSample()
    for (const key of FEATURE_KEYS) {
      expect(resolvePath(sample, key), `FEATURE_KEYS 路径走不通: ${key}`).not.toBeUndefined()
    }
  })

  it('反向闸：schema 顶层键集 ⊆ FEATURE_KEYS 首段 ∪ 遗留键（顶层新增字段不补条目即红；嵌套字段不在本闸范围）', () => {
    const parsed = routerConfigSchema({} as never) as Record<string, unknown>
    // 空转防线（评审 #9）：若 schema 对象键变得不可枚举，下面的循环会恒绿——先钉下限
    // （当前实测 5 个键；探针不是契约：掉到 0 说明枚举机制坏了）。
    expect(Object.keys(parsed).length).toBeGreaterThanOrEqual(5)
    const featureRoots = new Set(FEATURE_KEYS.map((k) => k.split('.')[0]))
    const legacy = new Set<string>(LEGACY_CONFIG_KEYS)
    for (const key of Object.keys(parsed)) {
      expect(featureRoots.has(key) || legacy.has(key), `配置字段「${key}」没有任何说明条目`).toBe(true)
    }
  })
})
