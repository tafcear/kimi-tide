/**
 * SettingsCard 渲染健壮性（2026-10-07 独立交叉复核 ⑤）：buildRoutingView 抛异常时
 * 设置卡**仍可编辑**——规则编辑器与分工表照常渲染，导览（顶部摘要）/决策链整组跳过
 * 而不崩。官方明文：render 路径抛错会把 slot 条目整块搞白，故构建必须被
 * safeBuildRoutingView 的 try/catch 兜住、回落 null。
 *
 * 本文件单独成档的原因：vi.mock 按文件生效——把 buildRoutingView 换成抛异常的桩会
 * 波及同文件全部用例，不能并入 SettingsCard.test.tsx。
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { SettingsCard } from '../src/client/SettingsCard.js'
import type { CardSnapshot, CardStore } from '../src/client/card-store.js'
import { DEFAULT_CONFIG_V6, type RouterConfigV6 } from '../src/config.js'

// 只把 buildRoutingView 换成抛异常的桩，模块其余导出保持真实（previewDispatch 等
// 仍被「派给谁」消费，不能缺）。
vi.mock('../src/routing-view.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/routing-view.js')>()
  return {
    ...actual,
    buildRoutingView: (): never => {
      throw new Error('boom: routing view build failed')
    },
  }
})

/** 预制快照的 CardStore 夹具（与 SettingsCard.test.tsx 同型：方法全空操作）。 */
const storeWith = (config: RouterConfigV6) => (): CardStore => ({
  load: async () => {},
  saveTop: async () => {},
  saveActivePreset: async () => {},
  savePreset: async () => {},
  createPreset: async () => {},
  deletePreset: async () => {},
  saveKeywordGroups: async () => {},
  saveFlows: async () => {},
  deleteFlow: async () => {},
  saveRoles: async () => {},
  saveDriver: async () => {},
  saveDriverSticky: async () => {},
  saveRulesApplyToChildren: async () => {},
  resetField: async () => {},
  getSnapshot: (): CardSnapshot => ({
    status: 'ready',
    config,
    base: null,
    user: null,
    writable: true,
    error: null,
    catalog: null,
    availability: null,
    efforts: null,
  }),
  subscribe: () => () => {},
})

describe('SettingsCard 渲染健壮性：buildRoutingView 抛错兜底（§9.3）', () => {
  it('视图模型构建失败 ⇒ 规则编辑器与分工表仍渲染、导览/决策链整组跳过、渲染不崩', () => {
    const cfg: RouterConfigV6 = { ...DEFAULT_CONFIG_V6(), activePreset: 'saving' }
    cfg.roles = { frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'k3' } } }
    // Fails if: ① safeBuildRoutingView 的 try/catch 被移除（render 抛错 = 官方设置页
    // slot 条目整块搞白）；② 兜底分支丢编辑能力（规则编辑器/分工表没渲染）；
    // ③ 链/摘要没整组跳过（半截视图模型残骸混进界面）。
    const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(cfg) }))
    // 编辑能力不丢：预设编辑器（默认模型/新增规则）与分工表（角色行/新增角色）都在。
    expect(html).toContain('aria-label="默认模型"')
    expect(html).toContain('新增规则')
    expect(html).toContain('aria-label="角色 id"')
    expect(html).toContain('新增角色')
    // 导览（顶部摘要）与五档决策链整组跳过。
    expect(html).not.toContain('kt-route-summary')
    expect(html).not.toContain('kt-chain')
  })
})
