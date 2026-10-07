// src/routing-view.ts
/**
 * C1 统一视图模型（设计稿 2026-10-07 §3）：把「关键词规则（session 作用域）」
 * 与「分工表（dispatch 作用域）」投影成同一张路由表，附人话摘要、词表接线、
 * 重叠解释与决策链数据——A（决策链一屏）/ B（作用域标签 + 派发预览）的公共
 * 基础设施。
 *
 * 不变量：
 * - 纯函数、零宿主依赖：只 import 本包 config/rules/roles 的类型与纯函数
 *   （router.js 仅为 RouterConfigAny 的 type-only 引用，编译期擦除）；
 * - **零路由行为变更**：不参与 decide/previewRoute，只读配置做投影；
 * - `describeRouting` 是摘要**单源**：设置页顶部摘要 / renderTeamSkill 的
 *   description / `/kimi-tide show` 命令三处共用，不得各自拼文案（防漂移）；
 * - 作用域语义对齐运行期：关键词规则只服务主会话、分工表只服务队友（§1.3），
 *   两者在视图里并列展示但**不互相改写**；
 * - C2（v7）：行集一律经 config.rowsFromConfig 取得（字段判据：routes 存在用
 *   routes，否则旧字段投影）——v6 与 v7 输入产出**等价视图**，对外 API 与
 *   返回结构不变（A/B 只依赖本模块，不感知配置版本）。
 */
import { configKey, isFlowTarget, isV5Plus, rowsFromConfig, type CollaborationFlow, type ImageFallback, type RouteRowV7, type RouteTarget, type RouterConfigV7, type RouterPreset, type RuleTarget } from './config.js'
import { claimedReviewGroups } from './rules.js'
import type { RouterConfigAny } from './router.js'

/** 视图可吃的配置面：v4/v5/v6/v7（RouterConfigAny ∪ RouterConfigV7）。 */
export type RoutingConfigLike = RouterConfigAny | RouterConfigV7

/** 行作用域：session = 主会话关键词/带图规则；dispatch = 分工表角色改道。 */
export type RouteScope = 'session' | 'dispatch'

/** 词表接线状态：被规则引用 / 被协作流认领（规则被静态抑制）/ 悬空。 */
export type WiringState = 'referenced' | 'claimed-by-flow' | 'orphan'

/**
 * 行条件三态。role 档携带认领集合与显示名：认领集合 = teammate[] ∪ {id}
 * （D2 裁定，roles.roleClaimSet 单源），`previewDispatch` 据此按队友名反查。
 */
export type RoutingRowCondition =
  | { kind: 'image' }
  | { kind: 'keywords'; group: string; minHits?: number }
  | { kind: 'role'; label: string; claims: string[] }

/** 统一路由表的一行。target 复用 RuleTarget（模型或协作流引用）。 */
export interface RoutingRow {
  id: string
  scope: RouteScope
  /** 同作用域内的相对序（session = 激活预设规则序；dispatch = roles 插入序）。 */
  order: number
  condition: RoutingRowCondition
  target: RuleTarget
  /** scope === 'session' 时必填（归属预设 id）。 */
  presetId?: string
  /** scope === 'dispatch' 时必填（= role.id）。 */
  roleId?: string
  wiring: WiringState
  /** 复用 availability 三态（'provider/model' → boolean；缺键/null = 可用）。 */
  unavailable: boolean
}

/** 词表接线徽标数据（§4.5）。 */
export interface GroupInfo {
  name: string
  words: number
  wiring: WiringState
  /** 引用该组的规则 id（跨全部预设扫描；含被流认领后遭抑制的规则）。 */
  referencedBy: string[]
}

/** 重叠解释条数据（§5.2）：解释条不是报错——机制上两者本就不冲突（§1.3）。 */
export interface OverlapInfo {
  group: string
  word: string
  roleId: string
  sessionTarget: string
  dispatchTarget: string
  /**
   * 行门槛 >1 时透出（复核⑦）：客户端解释条文案据此渲染「说 X（≥N 词）」，
   * 否则用户按字面一词命中却发现规则不生效（minHits 门槛不可见）。
   */
  minHits?: number
}

/**
 * 档位状态（§4.2）：**三态而非布尔**。
 * - `ready`     本档此刻真的会参与裁决（已配置）
 * - `on-demand` 按需触发：只有满足条件时才参与（显式 `@` / 子代理调用方点名）
 * - `off`       本档在当前配置下不参与（无角色 / 无规则 / 路由关闭）
 *
 * 为什么不是布尔：第 1、2 档曾写死 `true`，界面于是出现「5 档里 4 档都亮着」，
 * 反而看不出谁在决定这一轮（2026-10-07 用真实配置预检时发现）。
 */
export type TierState = 'ready' | 'on-demand' | 'off'

/** 决策链一档（§4.2）：与 router.ts 优先级链逐档对齐。 */
export interface PrecedenceTier {
  tier: number
  title: string
  state: TierState
  /** 便捷布尔（= `state === 'ready'`）：保留给既有消费者，语义 = 「已就绪」。 */
  active: boolean
  detail: string
}

/**
 * 打底行（§4.3 打底可见）。target 为 null 表示「无打底目标可展示」：
 * 路由关闭（activePreset=null）/ 激活预设缺失 / driverSticky 且 driver=null
 * （主驱动跟随宿主默认）——与 decide 的 keep 分支同款形态。
 */
export interface FallbackInfo {
  target: RouteTarget | null
  reason: string
}

/** 统一视图模型（§3）。 */
export interface RoutingView {
  fallback: FallbackInfo
  /** 当前激活预设的 session 行（路由关闭/预设缺失 ⇒ 空数组）。 */
  session: RoutingRow[]
  /** 全部 dispatch 行。 */
  dispatch: RoutingRow[]
  groups: GroupInfo[]
  overlaps: OverlapInfo[]
  /** 人话摘要（= describeRouting 的单源产物）。 */
  summary: string
  precedence: PrecedenceTier[]
}

/** 视图依赖：目标可用性三态表（'provider/model' → boolean；null/缺键 = 可用）。 */
export interface ViewDeps {
  availability?: Record<string, boolean> | null
}

/** v5+ 取 flows 注册表；v4 无注册表 → 空表（与 router.flowsOf 同口径）。 */
function flowsOf(config: RoutingConfigLike): Record<string, CollaborationFlow> {
  return isV5Plus(config) ? config.flows : {}
}

/** 行条件（RoutingRowCondition）从 v7 行投影：role 档补 label 与认领集合
 *  （= teammate[] ∪ {id}，D2 裁定；与 roles.roleClaimSet 同款构造序）。 */
function conditionOf(row: RouteRowV7): RoutingRowCondition {
  if (row.when.kind === 'image') return { kind: 'image' }
  if (row.when.kind === 'keywords') {
    return { kind: 'keywords', group: row.when.group, ...(row.when.minHits === undefined ? {} : { minHits: row.when.minHits }) }
  }
  const claims = new Set<string>(row.teammate ?? [])
  claims.add(row.id)
  return { kind: 'role', label: row.label ?? row.id, claims: [...claims] }
}

/**
 * 构建统一视图（纯函数）。行集一律走 rowsFromConfig（字段判据：routes 存在用
 * routes，否则旧字段投影——R2 裁定，禁止版本号门控）；分工层开关
 * （driver/driverSticky）同样只认字段本身。
 */
export function buildRoutingView(config: RoutingConfigLike, deps: ViewDeps = {}): RoutingView {
  const availability = deps.availability ?? null
  const unavailableModel = (target: RouteTarget): boolean => availability?.[configKey(target)] === false
  const flows = flowsOf(config)
  const unavailableTarget = (target: RuleTarget): boolean => {
    if (isFlowTarget(target)) {
      const flow = flows[target.flow]
      if (flow === undefined || flow.type !== 'transcribe') return true
      return unavailableModel(flow.visionModel)
    }
    return unavailableModel(target)
  }

  // 分工层（v4/v5 无这些字段 → 空表/undefined，字段判据不门控版本号）。
  const team = config as { roles?: unknown; driver?: RouteTarget | null; driverSticky?: boolean }
  const claimed = claimedReviewGroups(config as RouterConfigAny)
  const preset: RouterPreset | undefined = config.activePreset === null ? undefined : config.presets[config.activePreset]

  /* ---- 行集（C2）：routes ?? 旧字段投影；session 行按「归属激活预设」过滤，
     保持数组相对序（= v6 激活预设规则序）；dispatch 行全量保序。 ---- */
  const rows = rowsFromConfig(config)
  const sessionSource = rows.filter((r) => r.scope === 'session')
  const activeSession = config.activePreset === null ? [] : sessionSource.filter((r) => r.preset === config.activePreset)

  const session: RoutingRow[] = activeSession.map((row, order) => ({
    id: row.id,
    scope: 'session' as const,
    order,
    condition: conditionOf(row),
    target: row.target,
    presetId: config.activePreset ?? undefined,
    wiring: row.when.kind === 'keywords'
      ? claimed.has(row.when.group)
        ? 'claimed-by-flow'
        : config.keywordGroups[row.when.group] === undefined ? 'orphan' : 'referenced'
      : 'referenced',
    unavailable: unavailableTarget(row.target),
  }))

  const dispatch: RoutingRow[] = rows
    .filter((r) => r.scope === 'dispatch')
    .map((row, order) => ({
      id: row.id,
      scope: 'dispatch' as const,
      order,
      condition: conditionOf(row),
      target: row.target,
      roleId: row.id,
      wiring: 'referenced' as const,
      unavailable: unavailableTarget(row.target),
    }))

  /* ---- 词表接线：跨全部 session 行扫规则引用（= v6 跨全部预设扫规则）；
     流认领优先于规则引用（徽标单值）。 ---- */
  const referencedBy = new Map<string, string[]>()
  for (const row of sessionSource) {
    if (row.when.kind !== 'keywords') continue
    const list = referencedBy.get(row.when.group) ?? []
    list.push(row.id)
    referencedBy.set(row.when.group, list)
  }
  const groups: GroupInfo[] = Object.entries(config.keywordGroups).map(([name, words]) => {
    const refs = referencedBy.get(name) ?? []
    const wiring: WiringState = claimed.has(name) ? 'claimed-by-flow' : refs.length > 0 ? 'referenced' : 'orphan'
    return { name, words: words.length, wiring, referencedBy: refs }
  })

  /* ---- 重叠解释（§5.2）：词表词 ∈ 角色身份词（id/label/aliases）且激活作用域中
     该组规则目标 ≠ 角色目标。只看激活预设的 session 行（非激活的不生效）。
     口径对齐 summarize（复核⑦）：wiring 为 claimed-by-flow 的行被协作流静态
     抑制、不产生「主会话说 X」的改道 ⇒ 不参与重叠解释（否则解释条在描述一条
     不生效的规则）。
     已知小漏（复核⑦ 标注，不改行为）：① 目标比较只看 provider/model（configKey，
     不含 effort——两侧仅 effort 不同会被当成「目标相同」不算重叠）；② 词匹配
     大小写敏感（identity.has(word) 精确等，'Code' 与 'code' 不互 match）。 ---- */
  const overlaps: OverlapInfo[] = []
  for (const row of activeSession) {
    if (row.when.kind !== 'keywords' || isFlowTarget(row.target)) continue
    if (claimed.has(row.when.group)) continue
    const words = config.keywordGroups[row.when.group] ?? []
    const sessionKey = configKey(row.target as RouteTarget)
    for (const dispatchRow of rows) {
      if (dispatchRow.scope !== 'dispatch') continue
      const identity = new Set<string>([dispatchRow.id, dispatchRow.label ?? dispatchRow.id, ...(dispatchRow.aliases ?? [])])
      const dispatchKey = configKey(dispatchRow.target as RouteTarget)
      if (sessionKey === dispatchKey) continue
      for (const word of words) {
        if (identity.has(word)) overlaps.push({
          group: row.when.group, word, roleId: dispatchRow.id, sessionTarget: sessionKey, dispatchTarget: dispatchKey,
          ...(row.when.minHits !== undefined && row.when.minHits > 1 ? { minHits: row.when.minHits } : {}),
        })
      }
    }
  }

  /* ---- 打底（§4.3）：driverSticky ? driver : 预设默认；关闭/缺失 ⇒ null + 原因。 ---- */
  let fallback: FallbackInfo
  if (config.activePreset === null) fallback = { target: null, reason: '路由已关闭' }
  else if (preset === undefined) fallback = { target: null, reason: '激活预设不存在' }
  else if (team.driverSticky === true) {
    fallback = team.driver == null
      ? { target: null, reason: '主驱动跟随宿主默认' }
      : { target: { ...team.driver }, reason: `主驱动恒定（${configKey(team.driver)}）` }
  } else fallback = { target: { ...preset.default }, reason: `预设「${preset.name}」默认` }

  /* ---- 决策链五档（§4.2）：与 router.ts 优先级链逐档对齐。
     三态语义见 TierState：按需档（1/2）不置灰，只有当前配置下真的不参与的档才算 off。
     复核⑥（2026-10-07）：activePreset 为 null/空（判据镜像 settings-port.hasActivePreset
     ——本模块零宿主依赖不能 import）时 index.ts 的 hasActivePreset 门控根本不挂载
     installRouter，**任何改道（含分工表）都不会发生**——第 3 档必须如实 off，
     不得按 dispatch.length 报 ready；dispatch 行仍列出（分工表内容是真实的配置
     数据，供「派给谁」预览），但界面与 detail 都不得声称其参与改道。 ---- */
  const routerOn = typeof config.activePreset === 'string' && config.activePreset.length > 0
  const tier3: TierState = routerOn && dispatch.length > 0 ? 'ready' : 'off'
  const tier4: TierState = preset !== undefined && session.length > 0 ? 'ready' : 'off'
  const tier5: TierState = preset !== undefined ? 'ready' : 'off'
  const precedence: PrecedenceTier[] = [
    { tier: 1, title: '显式 @指令', state: 'on-demand', active: false, detail: '按需：消息里写 @provider 或 @provider/model 时才参与裁决' },
    { tier: 2, title: '调用方点名', state: 'on-demand', active: false, detail: '按需：仅子代理；调用方点名的模型与打底不同时保持该模型不变' },
    {
      tier: 3,
      title: '分工表角色',
      state: tier3,
      active: tier3 === 'ready',
      detail: !routerOn
        ? (dispatch.length > 0 ? `路由已关闭：分工表 ${dispatch.length} 个角色不发生任何改道（仅存档）` : '路由已关闭（未配置分工表）')
        : dispatch.length > 0 ? `${dispatch.length} 个角色参与派发改道` : '未配置分工表（队友不改道）',
    },
    {
      tier: 4,
      title: '关键词规则',
      state: tier4,
      active: tier4 === 'ready',
      detail: preset === undefined ? '路由未激活' : session.length > 0 ? `预设「${preset.name}」共 ${session.length} 条规则（仅主会话参与）` : `预设「${preset.name}」无规则，未命中即走打底`,
    },
    {
      tier: 5,
      title: '打底',
      state: tier5,
      active: tier5 === 'ready',
      detail: fallback.target === null ? fallback.reason : `${configKey(fallback.target)}（${fallback.reason}）`,
    },
  ]

  const summary = summarize({ config, preset, session, dispatch, groups, fallback })
  return { fallback, session, dispatch, groups, overlaps, summary, precedence }
}

/** 行条件的人话标签（摘要用；image → 带图，keywords → 组名，role → 显示名）。 */
function conditionLabel(condition: RoutingRowCondition): string {
  if (condition.kind === 'image') return '带图'
  if (condition.kind === 'keywords') return condition.group
  return condition.label
}

/** 行目标的人话键（摘要用；模型 → provider/model，流引用 → 协作流 flow）。 */
function targetLabel(target: RuleTarget): string {
  return isFlowTarget(target) ? `协作流 ${target.flow}` : configKey(target)
}

/**
 * imageFallback 三态的**短标签**（摘要用，§4.1 示例的第三段）。
 * 与 `client/help-content.ts` 的 `FALLBACK_HINTS` 是**同一组键**——那边是给用户看的
 * 一句话后果（长），这里只要一个词；**键集由跨模块测试钉住**（任一侧漏一个状态即红），
 * 避免"两处各自维护一套状态名"的老问题。
 */
export const IMAGE_FALLBACK_SHORT: Record<ImageFallback, string> = {
  latch: '锁存视觉模型',
  blind: '盲答',
  'transcribe-lazy': '懒转述',
}

/** 摘要组装（describeRouting 的单一实现，纯中文人话、不含内部字段名）。 */
function summarize(parts: {
  config: RoutingConfigLike
  preset: RouterPreset | undefined
  session: RoutingRow[]
  dispatch: RoutingRow[]
  groups: GroupInfo[]
  fallback: FallbackInfo
}): string {
  const { preset, session, dispatch, groups, fallback } = parts
  if (parts.config.activePreset === null) return '路由已关闭：所有请求保持宿主当前模型。'
  if (preset === undefined) return '路由已关闭：激活预设不存在。'
  const base = fallback.target === null ? '宿主默认' : configKey(fallback.target)
  const orphan = groups.filter((g) => g.wiring === 'orphan').length
  const chunks: string[] = []
  if (session.length === 0) {
    // 空状态说人话（§4.4，实机 capability rules:[] 形态）。
    chunks.push(`主会话：未命中任何规则 ⇒ 全部走打底（${base}）${orphan > 0 ? `；已备 ${orphan} 组词表无规则引用，暂不生效` : ''}`)
  } else {
    const effective = session.filter((r) => r.wiring !== 'claimed-by-flow')
    const listed = (effective.length > 0 ? effective : session).slice(0, 3)
      .map((r) => `命中「${conditionLabel(r.condition)}」走 ${targetLabel(r.target)}`)
    chunks.push(`主会话：${base} 打底 → ${listed.join('、')}`)
  }
  if (dispatch.length > 0) {
    chunks.push(`派发：${dispatch.map((r) => `${conditionLabel(r.condition)}→${targetLabel(r.target)}`).join('、')}`)
  }
  // §4.1 第三段：带图兜底同样是"谁来决定"的一部分（缺省 latch，与卡片下拉缺省一致）。
  chunks.push(`带图：${IMAGE_FALLBACK_SHORT[preset.imageFallback ?? 'latch']}`)
  return chunks.join(' ｜ ')
}

/**
 * 路由人话摘要（**单源**）：= buildRoutingView(...).summary。设置页顶部摘要 /
 * renderTeamSkill 的 description / `/kimi-tide show` 三处共用，不得各自拼文案。
 */
export function describeRouting(config: RoutingConfigLike, deps: ViewDeps = {}): string {
  return buildRoutingView(config, deps).summary
}

/**
 * 派发预览（§5.3）：在视图上按角色 id 或认领队友名反查改道目标——建在
 * view.dispatch 之上，不重复实现匹配逻辑。未认领 ⇒ unclaimed + target null
 *（与派发台账依据枚举 role | unclaimed 的两态子集对齐；explicit/keep 属于
 * 请求期上下文，静态视图判不出）。
 */
export function previewDispatch(
  view: RoutingView,
  claim: string,
): { target: RouteTarget | null; basis: 'role' | 'unclaimed'; roleLabel?: string } {
  for (const row of view.dispatch) {
    if (row.condition.kind === 'role' && row.condition.claims.includes(claim)) {
      // dispatch 行目标恒为模型目标（RoleEntry.target），窄化安全。
      const target = row.target as RouteTarget
      return { target: { ...target }, basis: 'role', roleLabel: row.condition.label }
    }
  }
  return { target: null, basis: 'unclaimed' }
}
