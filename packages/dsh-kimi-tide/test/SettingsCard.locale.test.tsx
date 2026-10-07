/**
 * SettingsCard locale 化（W1）验收：
 * 1. 英文渲染：假 locale 服务（register/bind/subscribe/getSnapshot 最简桩，active 'en-US'）
 *    经 attachLocaleService 接线后渲染卡片——顶部摘要 / 五档链标题 / 页签标题必须是英文，
 *    且不含对应中文原句（含 buildRoutingView 的 copy: t 注入路径——不给 copy 时本条变红，
 *    负控证据见 W1 报告）。
 * 2. settings 表键集：zh/en 完全相等（运行期断言；类型层另有 Record 钉住）。
 * 3. 占位符一致：同一键 zh/en 的 {0}/{name} 占位符集合相同（遍历全表）。
 *
 * 本文件单独成档的原因：attachLocaleService 写入模块态且没有复位口——英文接线会留在
 * 本文件后续渲染路径上，不能并入做中文断言的 SettingsCard.test.tsx（该文件同款问题靠
 * 「译:」桩回落 zh 真值化解，见彼处注释）。
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { SettingsCard } from '../src/client/SettingsCard.js'
import { attachLocaleService } from '../src/client/locale.js'
import type { CardSnapshot, CardStore } from '../src/client/card-store.js'
import { DEFAULT_CONFIG_V5, type RouterConfigV5 } from '../src/config.js'
import { en, formatCopy, zh } from '../src/locales/index.js'
import { zh as zhSettings } from '../src/locales/zh/settings.js'
import { en as enSettings } from '../src/locales/en/settings.js'

// 本机 Node 正则引擎不吃 \p{Han}，用显式 CJK 码位范围（与 test/locales.test.ts 同款）。
const HAN = /[㐀-䶿一-鿿豈-﫿]/

/** 预制快照的 CardStore 夹具（与 SettingsCard.test.tsx 同型：方法全空操作）。 */
const storeWith = (config: RouterConfigV5) => (): CardStore => ({
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

/** 最简 locale 服务桩：register 捕获字典，bind 按捕获的 en 表取值（含占位符替换）。 */
function makeEnglishLocaleCtx() {
  const registered: Array<[string, { zh: Record<string, string>; en: Record<string, string> }]> = []
  const locale = {
    register: (ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }) => {
      registered.push([ns, dicts])
      return () => {}
    },
    bind: (_ns: string) => (key: string, params?: Record<string, string | number>) => {
      const dict = registered[0]?.[1].en ?? (en as Record<string, string>)
      return formatCopy(dict[key] ?? key, params)
    },
    subscribe: (_cb: () => void) => () => {},
    getSnapshot: () => ({ active: 'en-US' }),
  }
  const ctx = {
    get: (name: string) => (name === 'locale' ? locale : undefined),
    effect: (execute: () => unknown) => {
      execute()
      return () => {}
    },
    inject: () => {
      throw new Error('服务直接在场，不应走 inject 延迟路径')
    },
  }
  return { ctx, registered }
}

describe('SettingsCard 英文渲染（W1：假 locale 服务 active=en-US）', () => {
  it('顶部摘要 / 五档链标题 / 页签标题 / 规则卡标题走英文，且不含对应中文原句', () => {
    const { ctx, registered } = makeEnglishLocaleCtx()
    attachLocaleService(ctx as never)
    // 字典确经 register 注册（bind 消费的就是这份）。
    expect(registered).toHaveLength(1)
    expect(registered[0]![1].en['settings.tab.route']).toBe('Routing')

    const cfg: RouterConfigV5 = { ...DEFAULT_CONFIG_V5(), activePreset: 'saving' }
    const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(cfg) }))

    // 页签标题（settings.tab.* / settings.flows.label）
    expect(html).toContain('>Routing<')
    expect(html).toContain('>Collaboration flows<')
    expect(html).toContain('>Playground<')
    expect(html).toContain('>Help<')
    expect(html).not.toContain('>路由<')
    expect(html).not.toContain('>协作流<')
    // 规则卡标题与主按钮（settings.rules.*）
    expect(html).toContain('kt-card-title">Rules<')
    expect(html).not.toContain('kt-card-title">规则<')
    expect(html).toContain('>Add rule<')
    expect(html).not.toContain('>新增规则<')
    // 带图兜底三态提示经 FALLBACK_HINT_KEYS → help.fallback.* 走英文（W1/W4 冻结契约）
    expect(html).toContain('Locks the vision model after an image turn')
    expect(html).not.toContain('带图后锁定视觉模型')

    // 五档链标题 = view.* 英文（证明 buildRoutingView 拿到了 copy: t——不给则回落中文，本条变红）
    expect(html).toContain('Explicit @mention')
    expect(html).toContain('Keyword rules')
    expect(html).toContain('Default target')
    expect(html).not.toContain('kt-tier-title">显式 @指令<')

    // 顶部摘要：整段无汉字（describeRouting 单源经 copy 注入产出英文）
    const summary = html.match(/kt-route-summary">([^<]*)</)?.[1] ?? ''
    expect(summary).not.toBe('')
    expect(HAN.test(summary)).toBe(false)
  })
})

describe('settings 表结构（W1）', () => {
  it('zh/en 键集完全相等', () => {
    expect(Object.keys(enSettings).sort()).toEqual(Object.keys(zhSettings).sort())
  })

  it('同一键 zh/en 占位符集合一致（遍历全表）', () => {
    const placeholders = (value: string): string[] =>
      [...value.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]!).sort()
    for (const key of Object.keys(zhSettings) as Array<keyof typeof zhSettings>) {
      expect(placeholders(enSettings[key]), `键 ${String(key)} 占位符漂移`).toEqual(placeholders(zhSettings[key]))
    }
  })

  it('中文真源钉住（抽样三键，防搬运期润色）', () => {
    expect(zh['settings.tab.route']).toBe('路由')
    expect(zh['settings.rules.title']).toBe('规则')
    expect(zh['settings.diag.presetIdConflict']).toBe('预设 id 冲突：{0} 已存在')
    expect(formatCopy(zh['settings.diag.presetIdConflict'], { 0: 'saving' })).toBe('预设 id 冲突：saving 已存在')
  })
})
