// test/routes-runtime.test.ts
// C2b 运行期接线（设计稿 2026-10-07 §6.4）：projectRoutesToLegacy 纯函数 +
// 读边界（applyConfig / import / persist）接线的行为判据。
// 核心验收：① 无 routes ⇒ 原引用返回、零行为变更；② routes ≡ 旧字段（迁移
// 产物）⇒ 投影前后 matchingRules / previewRoute / buildRoutingView 逐字节相等；
// ③ 只改 routes、旧字段陈旧 ⇒ 投影后运行期按 routes 走（本任务的关键新行为）。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG_V6, DEFAULT_KEYWORD_GROUPS, projectRoutesToLegacy,
  type RouteRowV7, type RouteTarget, type RouterConfigV6, type RouterPreset, type RouterRule,
} from '../src/config.js'
import { migrateV6 } from '../src/migrate.js'
import { matchingRules, previewRoute } from '../src/rules.js'
import { buildRoutingView, previewDispatch } from '../src/routing-view.js'

const t = (provider: string, model: string): RouteTarget => ({ provider, model })
const K3 = t('kimi-coding', 'k3')
const FLASH = t('deepseek-official', 'deepseek-v4-flash')
const GLM = t('zai-coding-cn', 'glm-5.3')

const kw = (id: string, group: string, target: RouteTarget, minHits?: number): RouterRule => ({
  id, when: { kind: 'keywords', group, ...(minHits === undefined ? {} : { minHits }) }, target,
})

/** 富 v6 夹具（与 routes-v7.test.ts 同款形状）：双预设、minHits、image 规则、带元数据的 roles。 */
const v6 = (): RouterConfigV6 => ({
  version: 6,
  activePreset: 'main',
  presets: {
    main: {
      name: '主力', default: FLASH,
      rules: [
        { id: 'image-k3', when: { kind: 'image' }, target: K3 },
        kw('code-kfc', 'code', K3, 2),
        kw('review-k3', 'review', K3),
      ],
    },
    spare: {
      name: '备用', default: K3,
      rules: [
        { id: 'image-k3', when: { kind: 'image' }, target: FLASH },
        kw('math-pro', 'math', t('deepseek-official', 'deepseek-v4-pro')),
      ],
    },
  } satisfies Record<string, RouterPreset>,
  flows: {},
  keywordGroups: { ...DEFAULT_KEYWORD_GROUPS },
  roles: {
    frontend: { id: 'frontend', label: '前端', target: K3, teammate: ['ui'], aliases: ['界面'], note: 'n1' },
    backend: { id: 'backend', label: '后端', target: GLM },
  },
  driverSticky: false,
})

/** 全文本矩阵（× hasImage 两态）：覆盖多词命中 / 平手 / 无命中 / minHits 门槛。 */
const TEXTS = [
  '帮我看看这段代码，有个 bug 报错',
  '审查一下这个 review 意见',
  '随便聊聊天气',
  '代码 审查 评审',
  '数学 证明 推导 求解',
  '翻译一下这段话',
  '',
]

describe('C2b：projectRoutesToLegacy 纯函数', () => {
  it('无 routes 的 v6 配置 ⇒ 原引用返回（零开销、零变更）', () => {
    const cfg = v6()
    expect(projectRoutesToLegacy(cfg)).toBe(cfg)
    const builtin = DEFAULT_CONFIG_V6()
    expect(projectRoutesToLegacy(builtin)).toBe(builtin)
  })

  it('routes 为空数组 ⇒ 同样原引用返回（视为缺席）', () => {
    const cfg = { ...v6(), routes: [] } as never
    expect(projectRoutesToLegacy(cfg)).toBe(cfg)
  })

  it('routes ≡ 旧字段（迁移产物）⇒ 投影后 matchingRules 全文本矩阵逐字节相等', () => {
    const src = v6()
    const projected = projectRoutesToLegacy(migrateV6(src))
    for (const text of TEXTS) {
      for (const hasImage of [false, true]) {
        expect(JSON.stringify(matchingRules(projected, text, hasImage)))
          .toBe(JSON.stringify(matchingRules(src, text, hasImage)))
      }
    }
  })

  it('routes ≡ 旧字段 ⇒ 投影后 previewRoute / buildRoutingView 逐字节相等（核心判据）', () => {
    const src = v6()
    const projected = projectRoutesToLegacy(migrateV6(src))
    for (const text of TEXTS) {
      expect(JSON.stringify(previewRoute(projected, text, { availability: null })))
        .toBe(JSON.stringify(previewRoute(src, text, { availability: null })))
    }
    expect(JSON.stringify(buildRoutingView(projected))).toBe(JSON.stringify(buildRoutingView(src)))
  })

  it('只改 routes、旧字段陈旧 ⇒ 投影后运行期按 routes 走（关键新行为）', () => {
    const src = v6()
    const cfg = migrateV6(src)
    // 只改 routes：code 规则目标 K3 → GLM；backend 角色目标 GLM → FLASH。旧字段原样（陈旧）。
    cfg.routes = cfg.routes.map((row) =>
      row.id === 'code-kfc' ? { ...row, target: GLM }
        : row.id === 'backend' ? { ...row, target: FLASH } : row)
    const projected = projectRoutesToLegacy(cfg)
    // session：规则目标按 routes（旧字段里的 K3 被覆盖）
    const hits = matchingRules(projected, '帮我看看这段代码报错', false)
    expect(hits.find((r) => r.id === 'code-kfc')?.target).toEqual(GLM)
    expect(previewRoute(projected, '帮我看看这段代码报错', { availability: null }).outcome)
      .toMatchObject({ kind: 'rule', ruleId: 'code-kfc' })
    expect((previewRoute(projected, '帮我看看这段代码报错', { availability: null }).outcome as { target: RouteTarget }).target).toEqual(GLM)
    // dispatch：角色目标按 routes（buildRoutingView/previewDispatch 自 C2 起即
    // 经 rowsFromConfig 读 routes，本行钉住投影后的最终形态）
    const view = buildRoutingView(projected)
    expect(previewDispatch(view, 'backend')?.target).toEqual(FLASH)
    // 反证：吃旧字段的 matchingRules 仍是旧目标——钉住「接线前后的行为差」
    expect(matchingRules(cfg, '帮我看看这段代码报错', false).find((r) => r.id === 'code-kfc')?.target).toEqual(K3)
  })

  it('顺序语义：同 preset 的 session 行按 routes 数组相对序还原；跨 preset 互不干扰', () => {
    const cfg = migrateV6(v6())
    // 重排：main 三行倒序且与 spare 行交错——相对序必须逐行保留
    cfg.routes = [
      cfg.routes.find((r) => r.id === 'math-pro')!,
      cfg.routes.find((r) => r.id === 'review-k3')!,
      cfg.routes.find((r) => r.id === 'image-k3' && r.preset === 'spare')!,
      cfg.routes.find((r) => r.id === 'code-kfc')!,
      cfg.routes.find((r) => r.id === 'image-k3' && r.preset === 'main')!,
      ...cfg.routes.filter((r) => r.scope === 'dispatch'),
    ]
    const projected = projectRoutesToLegacy(cfg)
    expect(projected.presets.main!.rules.map((r) => r.id)).toEqual(['review-k3', 'code-kfc', 'image-k3'])
    expect(projected.presets.spare!.rules.map((r) => r.id)).toEqual(['math-pro', 'image-k3'])
    // 平手按列表序：review 与 code 同为 2 词命中时，列表序在前的 review 先出
    const hits = matchingRules(projected, '审查 评审 代码 报错', false)
    expect(hits.map((r) => r.id)).toEqual(['review-k3', 'code-kfc'])
  })

  it('dispatch 行还原的 roles 与 v6 RoleEntry 逐字段等价（含 teammate/aliases/note 缺省）', () => {
    const src = v6()
    const projected = projectRoutesToLegacy(migrateV6(src))
    expect(projected.roles).toEqual(src.roles)
    // 缺省字段不落键（不是 undefined 值键）
    expect(Object.keys(projected.roles.backend!)).toEqual(['id', 'label', 'target'])
    // 手写 dispatch 行缺 label ⇒ 回落 id（RoleEntry.label 必填）
    const row: RouteRowV7 = { id: 'devops', scope: 'dispatch', when: { kind: 'role' }, target: K3 }
    const out = projectRoutesToLegacy({ ...migrateV6(src), routes: [...src.presets.main!.rules.map((r) => ({ ...r })), row] } as never)
    expect(out.roles.devops).toEqual({ id: 'devops', label: 'devops', target: K3 })
  })

  it('不修改入参：presets/roles/flights 原引用保留；routes 自身保留在返回值里', () => {
    const src = v6()
    const cfg = migrateV6(src)
    const before = JSON.stringify(cfg)
    const out = projectRoutesToLegacy(cfg)
    expect(JSON.stringify(cfg)).toBe(before)                       // 入参未被改写
    expect(out.routes).toBe(cfg.routes)                            // routes 原引用保留
    expect(out.flows).toBe(cfg.flows)
    expect(out.keywordGroups).toBe(cfg.keywordGroups)
    expect(out.presets.main!.name).toBe(cfg.presets.main!.name)    // preset 其余字段原引用/原值
    expect(out.presets.main!.default).toBe(cfg.presets.main!.default)
    expect(out).not.toBe(cfg)                                      // 但整体是浅拷贝
    expect(out.presets).not.toBe(cfg.presets)
    expect(out.presets.main!.rules).not.toBe(cfg.presets.main!.rules)
  })

  it('无 session 行的 preset ⇒ rules 还原为空数组；悬空 preset 行被丢弃', () => {
    const cfg = migrateV6(v6())
    cfg.routes = cfg.routes.filter((r) => r.preset !== 'spare')
    const projected = projectRoutesToLegacy(cfg)
    expect(projected.presets.spare!.rules).toEqual([])
    const dangling = projectRoutesToLegacy({
      ...cfg,
      routes: [...cfg.routes, { id: 'ghost', scope: 'session', when: { kind: 'image' }, target: K3, preset: 'nope' }],
    } as never)
    expect(dangling.presets.main!.rules.map((r) => r.id)).not.toContain('ghost')
  })
})
