// test/routing-view.test.ts
// C1 统一视图模型（设计稿 2026-10-07 §3）：session/dispatch 双作用域投影、
// 词表接线、重叠解释、打底可见、决策链五档、派发预览、人话摘要单源。
import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYWORD_GROUPS, type ReviewFlow, type RoleEntry, type RouteTarget, type RouterConfigV6, type RouterPreset, type RouterRule } from '../src/config.js'
import { buildRoutingView, describeRouting, IMAGE_FALLBACK_SHORT, previewDispatch } from '../src/routing-view.js'
import { FALLBACK_HINTS } from '../src/client/help-content.js'

const t = (provider: string, model: string): RouteTarget => ({ provider, model })
const K3 = t('kimi-coding', 'k3')
const FLASH = t('deepseek-official', 'deepseek-v4-flash')
const GLM = t('zai-coding-cn', 'glm-5.3')

const rule = (id: string, group: string, target: RouteTarget, minHits?: number): RouterRule => ({
  id, when: { kind: 'keywords', group, ...(minHits === undefined ? {} : { minHits }) }, target,
})

const v6 = (over: Partial<RouterConfigV6> = {}): RouterConfigV6 => ({
  version: 6,
  activePreset: 'main',
  presets: { main: { name: '主力', default: FLASH, rules: [] } satisfies RouterPreset },
  flows: {},
  keywordGroups: { ...DEFAULT_KEYWORD_GROUPS },
  roles: {},
  ...over,
})

const reviewFlow = (group: string): Record<string, ReviewFlow> => ({
  review: { type: 'review', reviewer: K3, trigger: 'keywords', keywordGroup: group, rounds: 1, autoRevise: false },
})

describe('C1：groups 接线状态', () => {
  it('空规则 + 有词表 ⇒ 全部 orphan，摘要明写「全部走打底」与悬空组数（实机 capability rules:[] 形态）', () => {
    const view = buildRoutingView(v6())
    expect(Object.keys(DEFAULT_KEYWORD_GROUPS)).toHaveLength(7)
    expect(view.groups).toHaveLength(7)
    expect(view.groups.every((g) => g.wiring === 'orphan')).toBe(true)
    expect(view.session).toEqual([])
    expect(view.summary).toContain('全部走打底')
    expect(view.summary).toContain('7 组词表')
  })

  it('词表被规则引用 ⇒ referenced + referencedBy 列出规则 id（含非激活预设的规则）', () => {
    const spare: RouterPreset = { name: '备用', default: FLASH, rules: [rule('spare-translate', 'translate', FLASH)] }
    const cfg = v6({
      presets: {
        main: { name: '主力', default: FLASH, rules: [rule('code-kfc', 'code', K3)] satisfies RouterPreset },
        spare,
      },
    })
    const view = buildRoutingView(cfg)
    expect(view.groups.find((g) => g.name === 'code')?.wiring).toBe('referenced')
    expect(view.groups.find((g) => g.name === 'code')?.referencedBy).toEqual(['code-kfc'])
    expect(view.groups.find((g) => g.name === 'translate')?.referencedBy).toContain('spare-translate')
    expect(view.groups.find((g) => g.name === 'math')?.wiring).toBe('orphan')
  })

  it('词表被协作流认领（flows[*].keywordGroup === 组名）⇒ claimed-by-flow；挂其上的 session 行同步标记', () => {
    const cfg = v6({
      presets: { main: { name: '主力', default: FLASH, rules: [rule('review-k3', 'review', K3)] satisfies RouterPreset } },
      flows: reviewFlow('review'),
    })
    const view = buildRoutingView(cfg)
    expect(view.groups.find((g) => g.name === 'review')?.wiring).toBe('claimed-by-flow')
    expect(view.session.find((r) => r.id === 'review-k3')?.wiring).toBe('claimed-by-flow')
  })
})

describe('C1：overlaps 重叠解释', () => {
  const roles = (backendTarget: RouteTarget): Record<string, RoleEntry> => ({
    backend: { id: 'backend', label: '后端', target: backendTarget, aliases: ['代码'] },
  })

  it('词表词与角色别名交集且 session 规则目标 ≠ 角色目标 ⇒ overlaps 命中一条', () => {
    const view = buildRoutingView(v6({
      presets: { main: { name: '主力', default: FLASH, rules: [rule('code-kfc', 'code', K3)] satisfies RouterPreset } },
      roles: roles(GLM),
    }))
    expect(view.overlaps).toHaveLength(1)
    expect(view.overlaps[0]).toMatchObject({ group: 'code', word: '代码', roleId: 'backend', sessionTarget: 'kimi-coding/k3', dispatchTarget: 'zai-coding-cn/glm-5.3' })
  })

  it('目标相同（或无规则引用该词表）⇒ 不算重叠', () => {
    const sameTarget = buildRoutingView(v6({
      presets: { main: { name: '主力', default: FLASH, rules: [rule('code-kfc', 'code', K3)] satisfies RouterPreset } },
      roles: roles(K3),
    }))
    expect(sameTarget.overlaps).toEqual([])
    const noRule = buildRoutingView(v6({ roles: roles(GLM) }))
    expect(noRule.overlaps).toEqual([])
  })
})

describe('C1：fallback 打底行', () => {
  it('driverSticky=true 时取 driver；false 时取激活预设 default', () => {
    const sticky = buildRoutingView(v6({ driver: GLM, driverSticky: true }))
    expect(sticky.fallback.target).toEqual(GLM)
    expect(sticky.fallback.reason).toContain('主驱动')
    const loose = buildRoutingView(v6({ driver: GLM, driverSticky: false }))
    expect(loose.fallback.target).toEqual(FLASH)
    expect(loose.fallback.reason).toContain('主力')
  })

  it('activePreset=null ⇒ reason 明写「路由已关闭」', () => {
    const view = buildRoutingView(v6({ activePreset: null }))
    expect(view.fallback.reason).toContain('路由已关闭')
  })

  it('目标不可用（availability 三态）⇒ 对应行 unavailable=true', () => {
    const cfg = v6({ presets: { main: { name: '主力', default: FLASH, rules: [rule('code-kfc', 'code', K3)] satisfies RouterPreset } } })
    const view = buildRoutingView(cfg, { availability: { 'kimi-coding/k3': false } })
    expect(view.session.find((r) => r.id === 'code-kfc')?.unavailable).toBe(true)
    expect(view.session.find((r) => r.id === 'code-kfc')?.target).toEqual(K3)
  })
})

describe('C1：precedence 决策链五档', () => {
  it('五档齐全且顺序 = 显式 @ > 调用方点名 > 分工表 role > 关键词规则 > 打底', () => {
    const view = buildRoutingView(v6({
      presets: { main: { name: '主力', default: FLASH, rules: [rule('code-kfc', 'code', K3)] satisfies RouterPreset } },
      roles: { frontend: { id: 'frontend', label: '前端', target: K3 } },
    }))
    expect(view.precedence.map((p) => p.tier)).toEqual([1, 2, 3, 4, 5])
    expect(view.precedence.map((p) => p.title)).toEqual(['显式 @指令', '调用方点名', '分工表角色', '关键词规则', '打底'])
    // 三态（2026-10-07 修）：1/2 档是按需触发，不得再写死 active=true
    // ——否则界面出现「5 档里 4 档都亮着」，看不出谁在决定这一轮。
    expect(view.precedence.map((p) => p.state)).toEqual(['on-demand', 'on-demand', 'ready', 'ready', 'ready'])
    expect(view.precedence.map((p) => p.active)).toEqual([false, false, true, true, true])
  })

  it('空分工表 / 空规则 ⇒ 对应档 off（不再用 active 布尔区分）', () => {
    const view = buildRoutingView(v6())
    expect(view.precedence.find((p) => p.tier === 3)?.state).toBe('off')
    expect(view.precedence.find((p) => p.tier === 4)?.state).toBe('off')
    expect(view.precedence.find((p) => p.tier === 5)?.state).toBe('ready')
    expect(view.precedence.find((p) => p.tier === 3)?.active).toBe(false)
    expect(view.precedence.find((p) => p.tier === 4)?.active).toBe(false)
    expect(view.precedence.find((p) => p.tier === 5)?.active).toBe(true)
  })
})

describe('C1：previewDispatch 派发预览', () => {
  const view = buildRoutingView(v6({
    roles: { frontend: { id: 'frontend', label: '前端', target: K3, teammate: ['ui'] } },
  }))

  it('命中角色（id 或认领队友名）⇒ basis role + 该角色 target + roleLabel', () => {
    expect(previewDispatch(view, 'frontend')).toEqual({ target: K3, basis: 'role', roleLabel: '前端' })
    expect(previewDispatch(view, 'ui')).toEqual({ target: K3, basis: 'role', roleLabel: '前端' })
  })

  it('未认领 ⇒ unclaimed + target null', () => {
    expect(previewDispatch(view, 'nobody')).toEqual({ target: null, basis: 'unclaimed' })
  })
})

describe('C1：describeRouting 摘要单源', () => {
  it('= view.summary（单源），输出为纯中文人话，不含内部字段名', () => {
    const cfg = v6({
      presets: { main: { name: '主力', default: FLASH, rules: [rule('code-kfc', 'code', K3)] satisfies RouterPreset } },
      roles: { frontend: { id: 'frontend', label: '前端', target: K3 }, backend: { id: 'backend', label: '后端', target: GLM } },
    })
    const summary = describeRouting(cfg)
    expect(summary).toBe(buildRoutingView(cfg).summary)
    for (const internal of ['presetId', 'roleId', 'wiring', 'via', 'minHits', 'keywordGroup', 'driverSticky']) {
      expect(summary).not.toContain(internal)
    }
    expect(summary).toContain('主会话')
    expect(summary).toContain('派发')
    expect(summary).toContain('前端')
  })
})

describe('C1 修复（2026-10-07 复核⑥）：路由关闭时第 3 档与派发面不得报「生效」', () => {
  // 事实：activePreset=null 时 installRouter 不挂载（index.ts hasActivePreset 门控），
  // 任何改道（含分工表）都不会发生——视图模型必须如实表达「路由已关闭」。
  const view = buildRoutingView(v6({
    activePreset: null,
    presets: { main: { name: '主力', default: FLASH, rules: [rule('code-kfc', 'code', K3)] satisfies RouterPreset } },
    roles: { backend: { id: 'backend', label: '后端', target: GLM } },
  }))

  it('第 3 档 off 且 detail 说明分工表不生效（不再按 dispatch.length 报 ready）', () => {
    const tier3 = view.precedence.find((p) => p.tier === 3)!
    expect(tier3.state).toBe('off')
    expect(tier3.active).toBe(false)
    expect(tier3.detail).toContain('路由已关闭')
  })

  it('全视图不出现「参与派发改道」这类肯定表述（含摘要与各档 detail）', () => {
    expect(JSON.stringify(view)).not.toContain('参与派发改道')
    expect(view.summary).toContain('路由已关闭')
  })
})

describe('C1 修复（2026-10-07 复核⑦）：overlaps 口径对齐 summarize', () => {
  it('被协作流认领（claimed-by-flow）的 session 行不参与重叠解释', () => {
    const cfg = v6({
      presets: { main: { name: '主力', default: FLASH, rules: [rule('review-k3', 'review', K3)] satisfies RouterPreset } },
      flows: reviewFlow('review'),
      roles: { backend: { id: 'backend', label: '后端', target: GLM, aliases: ['审查'] } },
    })
    const view = buildRoutingView(cfg)
    // 该规则行已被流认领（wiring=claimed-by-flow），summarize 不把它列入生效规则，
    // overlaps 也不得为它产出「主会话说『审查』走 …」的解释条。
    expect(view.session.find((r) => r.id === 'review-k3')?.wiring).toBe('claimed-by-flow')
    expect(view.overlaps).toEqual([])
  })

  it('未被认领的行照常产出解释条（对齐过滤不误伤）', () => {
    const cfg = v6({
      presets: { main: { name: '主力', default: FLASH, rules: [rule('code-kfc', 'code', K3)] satisfies RouterPreset } },
      flows: reviewFlow('review'),   // 认领的是 review 组，code 不受影响
      roles: { backend: { id: 'backend', label: '后端', target: GLM, aliases: ['代码'] } },
    })
    expect(buildRoutingView(cfg).overlaps).toHaveLength(1)
  })

  it('minHits>1 的行 ⇒ 解释条携带 minHits（供文案渲染「说 X（≥N 词）」）；缺省不落键', () => {
    const cfg = v6({
      presets: { main: { name: '主力', default: FLASH, rules: [rule('code-kfc', 'code', K3, 2)] satisfies RouterPreset } },
      roles: { backend: { id: 'backend', label: '后端', target: GLM, aliases: ['代码'] } },
    })
    const hit = buildRoutingView(cfg).overlaps[0]!
    expect(hit.minHits).toBe(2)
    expect('minHits' in buildRoutingView(v6({
      presets: { main: { name: '主力', default: FLASH, rules: [rule('code-kfc', 'code', K3)] satisfies RouterPreset } },
      roles: { backend: { id: 'backend', label: '后端', target: GLM, aliases: ['代码'] } },
    })).overlaps[0]!).toBe(false)
  })
})

describe('C1：摘要第三段「带图」（§4.1，2026-10-07 补）', () => {
  const withFallback = (imageFallback?: RouterPreset['imageFallback']): RouterConfigV6 => v6({
    presets: {
      main: {
        name: '主力', default: FLASH, rules: [],
        ...(imageFallback === undefined ? {} : { imageFallback }),
      } satisfies RouterPreset,
    },
  })

  it('按预设的 imageFallback 出短标签；缺省与卡片下拉一致（latch）', () => {
    // Fails if：summarize 里那段 `带图：…` 被删（四条全红）或标签写反。
    expect(describeRouting(withFallback('latch'))).toContain('带图：锁存视觉模型')
    expect(describeRouting(withFallback('blind'))).toContain('带图：盲答')
    expect(describeRouting(withFallback('transcribe-lazy'))).toContain('带图：懒转述')
    expect(describeRouting(withFallback())).toContain('带图：锁存视觉模型')
  })

  it('短标签键集与 client/help-content.ts 的 FALLBACK_HINTS 一致（跨模块防漂移）', () => {
    // 两处各有一份「三态」的名字：那边是给用户看的一句话后果，这边只取一个词。
    // 任一侧漏一个状态（或改名）即红——不允许两处各自维护一套状态名。
    expect(Object.keys(IMAGE_FALLBACK_SHORT).sort()).toEqual(Object.keys(FALLBACK_HINTS).sort())
  })
})
