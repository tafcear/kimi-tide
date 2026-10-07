// test/routes-v7.test.ts
// C2 配置面 v7（设计稿 2026-10-07 §6）：统一路由表 routes 的类型/默认值/投影、
// v6→v7 迁移语义等价、校验（含 routes × 旧字段冲突检测）、C1 视图等价、schema 透传。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG_V6, DEFAULT_CONFIG_V7, DEFAULT_KEYWORD_GROUPS, rowsFromConfig,
  type RouteRowV7, type RouteTarget, type RouterConfigV6, type RouterConfigV7, type RouterPreset, type RouterRule,
} from '../src/config.js'
import { coerceRouterConfigV7, migrateV6 } from '../src/migrate.js'
import { matchingScored } from '../src/rules.js'
import { buildRoutingView, describeRouting, previewDispatch } from '../src/routing-view.js'
import { routerConfigSchema, validateRouterConfig } from '../src/settings-schema.js'

const t = (provider: string, model: string): RouteTarget => ({ provider, model })
const K3 = t('kimi-coding', 'k3')
const FLASH = t('deepseek-official', 'deepseek-v4-flash')
const GLM = t('zai-coding-cn', 'glm-5.3')

const kw = (id: string, group: string, target: RouteTarget, minHits?: number): RouterRule => ({
  id, when: { kind: 'keywords', group, ...(minHits === undefined ? {} : { minHits }) }, target,
})

/** 富 v6 夹具：双预设（规则 id 跨预设复用——内置 saving/capability 即此形态）、
 *  minHits、image 规则、带 teammate/aliases 的 roles。 */
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
        { id: 'image-k3', when: { kind: 'image' }, target: FLASH },   // 与 main 同 id（跨预设复用）
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

describe('C2：DEFAULT_CONFIG_V7 / rowsFromConfig', () => {
  it('默认配置：version 7；routes = 内置预设 session 行（保序，先 saving 后 capability）；dispatch 行空；presets.rules 迁出为空', () => {
    const cfg = DEFAULT_CONFIG_V7()
    expect(cfg.version).toBe(7)
    const session = cfg.routes.filter((r) => r.scope === 'session')
    expect(cfg.routes.every((r) => r.scope === 'session')).toBe(true)
    expect(session.map((r) => r.preset)).toEqual([
      ...Array(3).fill('saving'), ...Array(8).fill('capability'),
    ])
    expect(session[0]).toMatchObject({ id: 'image-k3', preset: 'saving' })
    expect(session.map((r) => r.id)).toContain('chitchat-flash')
    for (const p of Object.values(cfg.presets)) expect(p.rules).toEqual([])
    // 其余字段与 v6 默认同源
    expect(cfg.keywordGroups).toEqual(DEFAULT_CONFIG_V6().keywordGroups)
    expect(cfg.flows).toEqual(DEFAULT_CONFIG_V6().flows)
    expect(cfg.driverSticky).toBe(true)
  })

  it('rowsFromConfig：v6 输入投影出 session 行（保序、填 preset、when/target 原样）+ dispatch 行（保序、搬元数据）', () => {
    const rows = rowsFromConfig(v6())
    expect(rows).toHaveLength(7)
    expect(rows.slice(0, 5).every((r) => r.scope === 'session')).toBe(true)
    expect(rows[0]).toEqual({ id: 'image-k3', scope: 'session', when: { kind: 'image' }, target: K3, preset: 'main' })
    expect(rows[1]).toEqual({ id: 'code-kfc', scope: 'session', when: { kind: 'keywords', group: 'code', minHits: 2 }, target: K3, preset: 'main' })
    expect(rows[3]).toEqual({ id: 'image-k3', scope: 'session', when: { kind: 'image' }, target: FLASH, preset: 'spare' })
    expect(rows[5]).toEqual({ id: 'frontend', scope: 'dispatch', when: { kind: 'role' }, target: K3, label: '前端', teammate: ['ui'], aliases: ['界面'], note: 'n1' })
    expect(rows[6]).toEqual({ id: 'backend', scope: 'dispatch', when: { kind: 'role' }, target: GLM, label: '后端' })
  })

  it('rowsFromConfig：有 routes 用 routes（原引用）；无 routes 走 legacy 投影（禁止版本号门控）', () => {
    const cfg = DEFAULT_CONFIG_V7()
    expect(rowsFromConfig(cfg)).toBe(cfg.routes)
    expect(rowsFromConfig(DEFAULT_CONFIG_V6())).toEqual(rowsFromConfig({ ...DEFAULT_CONFIG_V6(), version: 5 } satisfies never))
  })
})

describe('C2：migrateV6（v6→v7 投影，语义等价）', () => {
  it('浅拷贝语义：presets/roles/flows 原引用保留（旧字段不删可回退）；version 7；routes = legacy 投影', () => {
    const src = v6()
    const out = migrateV6(src)
    expect(out.version).toBe(7)
    expect(out.presets).toBe(src.presets)
    expect(out.roles).toBe(src.roles)
    expect(out.flows).toBe(src.flows)
    expect(out.routes).toEqual(rowsFromConfig(src))
    expect(out.activePreset).toBe('main')
  })

  it('session 匹配结果与排序迁移前后逐字节一致（命中词数 desc / 平手列表序 / image 恒 +∞）', () => {
    const src = v6()
    const out = migrateV6(src)
    for (const text of [
      '帮我看看这段代码，有个 bug 报错',            // code 多词命中
      '审查一下这个 review 意见',                    // review 命中
      '随便聊聊天气',                                // 无命中 → 空
      '代码 审查 评审',                              // code(1) < minHits2 与 review 平手/单命中
      '数学 证明 推导 求解',                          // spare 预设规则不参与（activePreset=main）
    ]) {
      expect(JSON.stringify(matchingScored(out, text, false))).toBe(JSON.stringify(matchingScored(src, text, false)))
      expect(JSON.stringify(matchingScored(out, text, true))).toBe(JSON.stringify(matchingScored(src, text, true)))
    }
    // image 恒 +∞：带图轮首条恒为 image-k3（main 预设）
    const hits = matchingScored(out, '代码 代码 报错', true)
    expect(hits[0]?.rule.id).toBe('image-k3')
    expect(hits[0]?.score).toBe(Number.POSITIVE_INFINITY)
  })

  it('dispatch 认领与目标迁移前后一致（previewDispatch 逐字节等价）', () => {
    const before = buildRoutingView(v6())
    const after = buildRoutingView(migrateV6(v6()))
    for (const claim of ['frontend', 'ui', 'backend', 'nobody']) {
      expect(previewDispatch(after, claim)).toEqual(previewDispatch(before, claim))
    }
  })

  it('幂等：v7 输入原引用直通（coerceRouterConfigV7 同款）', () => {
    const v7 = migrateV6(v6())
    expect(migrateV6(v7)).toBe(v7)
    expect(coerceRouterConfigV7(v7, () => {})).toBe(v7)
  })

  it('v5 输入携带分工层字段（R2 常态）⇒ 全链保住 roles 并投影 dispatch 行', () => {
    const v5 = { ...v6(), version: 5 } as unknown
    const out = coerceRouterConfigV7(v5, () => {})
    expect(out.version).toBe(7)
    expect(out.roles).toEqual(v6().roles)
    expect(out.routes.filter((r) => r.scope === 'dispatch').map((r) => r.id)).toEqual(['frontend', 'backend'])
  })
})

describe('C2：validateRouterConfig routes 块', () => {
  it('迁移产物（routes ≡ 旧字段）⇒ 校验通过（同时存在但语义一致不报错）', () => {
    expect(validateRouterConfig(migrateV6(v6()))).toBeUndefined()
    expect(validateRouterConfig(DEFAULT_CONFIG_V7())).toBeUndefined()
  })

  it('session 行与同名旧规则目标不同 ⇒ 报冲突（不静默择一）', () => {
    const cfg = migrateV6(v6())
    cfg.routes = cfg.routes.map((r) => r.id === 'code-kfc' && r.preset === 'main'
      ? { ...r, target: GLM } : r)
    const err = validateRouterConfig(cfg)
    expect(err).toContain('冲突')
    expect(err).toContain('code-kfc')
  })

  it('dispatch 行与同名旧角色目标/认领不同 ⇒ 报冲突', () => {
    const cfg = migrateV6(v6())
    cfg.routes = cfg.routes.map((r) => r.id === 'backend'
      ? { ...r, target: K3, teammate: ['srv'] } : r)
    const err = validateRouterConfig(cfg)
    expect(err).toContain('冲突')
    expect(err).toContain('backend')
  })

  it('session 行与同名旧规则条件不同 ⇒ 报冲突', () => {
    const cfg = migrateV6(v6())
    cfg.routes = cfg.routes.map((r) => r.id === 'review-k3'
      ? { ...r, when: { kind: 'keywords', group: 'writing' } } : r)
    expect(validateRouterConfig(cfg)?.includes('冲突')).toBe(true)
  })

  it('routes 为真源：旧字段没有的行（新增规则/角色）不算冲突', () => {
    const cfg = migrateV6(v6())
    const extra: RouteRowV7 = { id: 'fresh', scope: 'session', when: { kind: 'keywords', group: 'writing' }, target: K3, preset: 'spare' }
    cfg.routes = [...cfg.routes, extra]
    expect(validateRouterConfig(cfg)).toBeUndefined()
  })

  it('形状与界：同一预设内 id 重复 / session 缺 preset / preset 不存在 / minHits 越界 / 认领名跨行重复 / 目标不完整 / dispatch 收流引用', () => {
    const base = DEFAULT_CONFIG_V7()
    const dupId = { ...base, routes: [...base.routes, { ...base.routes[0]! }] }
    expect(validateRouterConfig(dupId)).toContain('id')
    const noPreset = { ...base, routes: [{ id: 'x', scope: 'session', when: { kind: 'image' }, target: K3 } as RouteRowV7] }
    expect(validateRouterConfig(noPreset)).toContain('preset')
    const badPreset = { ...base, routes: [{ id: 'x', scope: 'session', when: { kind: 'image' }, target: K3, preset: 'nope' } as RouteRowV7] }
    expect(validateRouterConfig(badPreset)).toContain('nope')
    const badHits = { ...base, routes: [{ id: 'x', scope: 'session', when: { kind: 'keywords', group: 'code', minHits: 0 }, target: K3, preset: 'saving' } as RouteRowV7] }
    expect(validateRouterConfig(badHits)).toContain('minHits')
    const badTarget = { ...base, routes: [{ id: 'x', scope: 'session', when: { kind: 'image' }, target: { provider: '', model: 'm' }, preset: 'saving' } as unknown as RouteRowV7] }
    expect(validateRouterConfig(badTarget)).toContain('target')
    const claimDup = { ...base, routes: [
      { id: 'ra', scope: 'dispatch', when: { kind: 'role' }, target: K3, teammate: ['x'] } as RouteRowV7,
      { id: 'rb', scope: 'dispatch', when: { kind: 'role' }, target: GLM, teammate: ['x'] } as RouteRowV7,
    ] }
    expect(validateRouterConfig(claimDup)).toContain('认领名')
    const flowOnDispatch = { ...base, routes: [
      { id: 'ra', scope: 'dispatch', when: { kind: 'role' }, target: { flow: 'transcribe' } } as unknown as RouteRowV7,
    ] }
    expect(validateRouterConfig(flowOnDispatch)).toContain('dispatch')
    // scope 与 when 档位错配：session 行不得挂 role 条件
    const roleOnSession = { ...base, routes: [{ id: 'x', scope: 'session', when: { kind: 'role' }, target: K3, preset: 'saving' } as unknown as RouteRowV7] }
    expect(validateRouterConfig(roleOnSession)).toBeTruthy()
  })
})

describe('C2：routing-view 吃 v6 与 v7 等价', () => {
  it('migrateV6 前后 buildRoutingView 全视图 JSON 逐字节相等（session/dispatch/groups/overlaps/summary/precedence）', () => {
    const src = v6()
    const before = buildRoutingView(src)
    const after = buildRoutingView(migrateV6(src))
    expect(JSON.stringify(after)).toBe(JSON.stringify(before))
  })

  it('describeRouting 同摘要（v6 文档 vs 迁移后 v7 文档）', () => {
    const src = v6()
    expect(describeRouting(migrateV6(src))).toBe(describeRouting(src))
  })

  it('v7 输入直接给 routes（presets.rules 为空）也能投影出 session/dispatch 行', () => {
    const cfg: RouterConfigV7 = {
      ...DEFAULT_CONFIG_V7(),
      activePreset: 'capability',
      routes: [
        { id: 'code-kfc', scope: 'session', when: { kind: 'keywords', group: 'code' }, target: K3, preset: 'capability' },
        { id: 'backend', scope: 'dispatch', when: { kind: 'role' }, target: GLM, label: '后端', teammate: ['be'] },
      ],
    }
    const view = buildRoutingView(cfg)
    expect(view.session.map((r) => r.id)).toEqual(['code-kfc'])
    expect(view.dispatch).toHaveLength(1)
    expect(view.dispatch[0]?.condition).toMatchObject({ kind: 'role', label: '后端', claims: ['be', 'backend'] })
    expect(previewDispatch(view, 'be').target).toEqual(GLM)
  })
})

describe('C2：schema 透传（v7 文档经命名空间 schema 不丢 routes）', () => {
  it('routerConfigSchema 接受 version 7 且 routes 未知键透传保留', () => {
    const cfg = DEFAULT_CONFIG_V7()
    const out = routerConfigSchema(JSON.parse(JSON.stringify(cfg)) as never) as unknown as RouterConfigV7
    expect(out.version).toBe(7)
    expect(out.routes).toEqual(cfg.routes)
  })
})
