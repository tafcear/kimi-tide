/**
 * SettingsCard — 官方设置页的「月汐」卡片（settings.section，id kimi-tide-router）。
 *
 * 0.5.0 预设管理器（spec §8）：预设选择行（关闭/各预设，点击即写 activePreset）
 * + 当前预设编辑器（默认模型下拉 = 全量目录、规则表 = 条件/目标/上移/下移/删除
 * + 新增规则）+ 预设操作（新建/复制/删除）+ 关键词组管理（组词表 textarea，
 * 逗号/换行分隔，新建/删除组）。
 *
 * 0.6.0 协作流配置（spec §7，仅 v5 配置渲染；v4 逐字节保持）：
 * 规则目标下拉增「协作流」分组（仅 transcribe 流可作规则目标——P1 边界）+
 * 每预设 imageFallback 三态（锁存/盲答/懒转述，带后果提示；懒转述流选择器
 * 仅 transcribe-lazy 态可编）+「协作流」手风琴区（预置流可改不可删，自建流
 * 可删——删前 store 守卫检查规则/imageFallbackFlow 引用，有引用拒删并上浮
 * error 通道）。
 *
 * 所有写操作都经 card-store 方法整段写（saveActivePreset / savePreset /
 * createPreset / deletePreset / saveKeywordGroups / saveFlows / deleteFlow）
 * 路由到 scope.set 或 connection.api.settings.mutate，不经过 dock 的
 * import-config 通道；宿主 validate-on-write 拒绝一律上浮 error 通道，不静默。
 *
 * 0.7.0 规则行关键词条件增「最少命中词数」输入（minHits，1..n 整数才写）。
 *
 * 0.8.0 可解释性 + effort（D2/D3）：规则区标题改真语义文案（命中词数多者优先）
 * + minHits 可见标签 + 行级自动条件摘要 +「试一句」纯文本路由预测器（标注
 * 「按当前激活预设」与「仅文本探针」偏差声明）；目标旁 EffortSelect 下拉
 * （选项 = 宿主档位表 snapshot.efforts，未声明档位 → 禁用「跟随默认」）。
 *
 * 1.1.0 认领提示 + review-flow outcome（spec §4）：review 流 trigger=keywords 认领
 * 其 keywordGroup → 认领组规则行灰态 + 行尾一句提示（认领与规则共存合法，只提示
 * 不拦保存）；「试一句」outcome 增 review-flow 枝（文案 = 本轮路由到 <routed
 * 摘要> + <label>，label 已含「评审模型不可用」盲区语义）。
 *
 * 1.4.1（2026-10-03 桌面端实机）：评审行补「档位」下拉（撤销 M7，与转述行对齐）；
 * 档位表取数修复见 client/effort-remote.ts（0.1.7+ 改读本条目 Config 的 volatile
 * 字段）；模型未声明档位时下拉唯一项文案自解释（「跟随默认（该模型未声明档位）」）。
 *
 * Task 7 修复轮 1（控制器 R6 漏项补齐）：「路由」页新增主驱动卡——v6 顶层三键
 * driver（TargetSelect 增可选 nullLabel「跟随宿主默认」档 = null）/ driverSticky /
 * rulesApplyToChildren 的设置控件，写通道 = card-store 的 saveDriver /
 * saveDriverSticky / saveRulesApplyToChildren（saveTop 薄封装）。
 *
 * B 项（2026-10-07 设计稿 §5，C1 视图模型消费侧）：B2 作用域徽标（规则行
 * 「主会话」/ 角色行「派发时」，kt-wire 样式）；B3 重叠解释器（view.overlaps
 * ⇒ 词表行与角色行两侧各挂解释条 + 「规则跟随该角色 / 词并入该角色别名」
 * 两个一键动作，走 storeWriter 既有写通道）；B4 测试场「派给谁」（previewDispatch 预判队友
 * 改道目标与依据 role/unclaimed，文案点明 D6 两套作用域）；B5 词表 → 角色
 * 接入（orphan 词表组批量生成角色，目标兜底同「填入三条示例」）。
 */
import { Fragment, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createCardStore } from './card-store.js'
import { Icon } from './icons.js'
import { FALLBACK_HINTS } from './help-content.js'
import { HelpTab } from './HelpTab.js'
import type { CardStore, ConnectionLike, SettingsScopeLike } from './card-store.js'
import { claimedGroupRuleConflicts, claimedReviewGroups, duplicateRuleIds, previewRoute, ruleConditionKey, ruleConditionSummary, ruleLabel } from '../rules.js'
import { buildRoutingView, previewDispatch, type GroupInfo, type OverlapInfo, type RoutingConfigLike, type RoutingView } from '../routing-view.js'
import {
  configKey,
  DEFAULT_FLOWS,
  isFlowTarget,
  isV5Plus as isV5PlusConfig,
  type CollaborationFlow,
  type HitConfirm,
  type ImageFallback,
  type ReviewFlow,
  type RoleEntry,
  type RouteTarget,
  type RouterRule,
  type RuleCondition,
  type RuleTarget,
  type TranscribeFlow,
} from '../config.js'

export interface SettingsCardProps {
  scope: SettingsScopeLike | null
  connection: ConnectionLike | null
  close?: () => void
  /** 0.8.0：per-model 推理档位取数（宿主自有通道）；缺席/失败 → 下拉「跟随默认」。 */
  fetchEfforts?: () => Promise<Record<string, string[]>>
  /**
   * 0.8.x④：kimi-tide-catalog 命名空间 scope（settings/document-updated 推送
   * 缝）。宿主 adapters 刷新重写档位表 → 该 scope 收到变更通知 → 卡片重取
   * efforts，修「挂载时取一次、之后不刷新」的显示陈旧。缺席（旧宿主无
   * settingsScope）→ 不订阅，保持既有单次取数行为。
   */
  catalogScope?: { subscribe(listener: () => void): () => void } | null
  /**
   * store 工厂缝（测试用）：默认 createCardStore。renderToString 不跑
   * effect，异步 availability 只能靠预制快照的 store 注入来覆盖渲染断言。
   */
  storeFactory?: (scope: SettingsScopeLike | null, connection: ConnectionLike | null) => CardStore
}

/**
 * 预设 id 的 slug 化（brief Task 8 Step 3 逐字规则）：trim + 小写 +
 * 非 [a-z0-9\u4e00-\u9fff] 折叠为 '-'；空 → `preset-<Date.now()%100000>`；
 * 与现有预设键冲突 → 递增后缀 `-2/-3…`（竞态冲突由 store.createPreset 的
 * error 通道兜底）。
 */
export function presetSlug(name: string, existing: Record<string, unknown>): string {
  const folded = name.trim().toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-')
  const base = folded !== '' ? folded : `preset-${Date.now() % 100000}`
  if (!Object.hasOwn(existing, base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!Object.hasOwn(existing, candidate)) return candidate
  }
}

/** 规则条件下拉的取值编码：image 条件用字面量 'image'，关键词组用 'kw:<组名>'。 */
const IMAGE_VALUE = 'image'
const kwValue = (group: string): string => `kw:${group}`

const conditionValue = (rule: RouterRule): string =>
  rule.when.kind === 'image' ? IMAGE_VALUE : kwValue(rule.when.group)

const parseCondition = (value: string): RuleCondition =>
  value === IMAGE_VALUE ? { kind: 'image' } : { kind: 'keywords', group: value.slice(3) }

/** 'provider/model' → RouteTarget（configKey 的逆运算；无 '/' 时整段作 provider）。 */
const parseTarget = (value: string): RouteTarget => {
  const slash = value.indexOf('/')
  return slash < 0
    ? { provider: value, model: '' }
    : { provider: value.slice(0, slash), model: value.slice(slash + 1) }
}

/** 规则目标下拉的取值编码：模型目标用 'provider/model'，协作流引用用 'flow:<id>'。 */
const FLOW_PREFIX = 'flow:'
const flowValue = (id: string): string => `${FLOW_PREFIX}${id}`
const ruleTargetValue = (target: RuleTarget): string =>
  isFlowTarget(target) ? flowValue(target.flow) : configKey(target)
const parseRuleTarget = (value: string): RuleTarget =>
  value.startsWith(FLOW_PREFIX) ? { flow: value.slice(FLOW_PREFIX.length) } : parseTarget(value)

/** 规则 id 生成：rule-<n> 递增避让（预设内唯一即可，React key 用）。 */
const newRuleId = (rules: RouterRule[]): string => {
  const ids = new Set(rules.map((rule) => rule.id))
  let n = rules.length + 1
  while (ids.has(`rule-${n}`)) n += 1
  return `rule-${n}`
}

/** 词表文本域解析：逗号（中英文）/分号（中英文）/换行分隔，去空白空串。 */
const parseWords = (text: string): string[] =>
  text.split(/[\n,，;；]+/).map((word) => word.trim()).filter((word) => word !== '')

/**
 * 角色 id 的 slug 化（Task 7）：trim + 小写 + 非 [a-z0-9] 折叠为 '-'、首尾 '-' 剥掉
 * （严格 lower-kebab-case——角色 id 同时是默认认领的队友名，须满足宿主队友名规则）；
 * 空 → `role-<Date.now()%100000>`；与现有角色键冲突 → 递增后缀 `-2/-3…`
 * （与 presetSlug 同款；竞态冲突由 store.saveRoles 的守卫兜底）。
 */
export function roleSlug(name: string, existing: Record<string, unknown>): string {
  const folded = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const base = folded !== '' ? folded : `role-${Date.now() % 100000}`
  if (!Object.hasOwn(existing, base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!Object.hasOwn(existing, candidate)) return candidate
  }
}

/**
 * 三条示例分工（Task 7 brief：前端/后端/写作，一键填入后由用户改目标）。
 * 占位策略（brief 二选一，按 TargetSelect/宿主 validate 现状定夺并已在测试钉住）：
 * 宿主 validateRouterConfig 要求 role.target 完整（provider/model 非空），
 * 空串占位必被拒写——示例目标以 fallback（调用方取激活预设 default）兜底。
 */
export function EXAMPLE_ROLES(fallback: RouteTarget): Record<string, RoleEntry> {
  const target = { provider: fallback.provider, model: fallback.model }
  return {
    frontend: { id: 'frontend', label: '前端', target },
    backend: { id: 'backend', label: '后端', target },
    writer: { id: 'writer', label: '写作', target },
  }
}

/** 逗号分隔文本 → 列表；空文本 → undefined（不落空数组键）。 */
const listFromText = (text: string): string[] | undefined => {
  const arr = parseWords(text)
  return arr.length > 0 ? arr : undefined
}

const omitKey = (obj: Record<string, string[]>, key: string): Record<string, string[]> => {
  const next = { ...obj }
  delete next[key]
  return next
}

/**
 * A 项（2026-10-07 设计稿 §3/§4）：统一视图模型的防御性构建——§9.3 硬规则
 * 「render 路径抛错会把 slot 条目整块搞白」，buildRoutingView 任何异常都回落
 * null（决策链/摘要/接入徽标整组跳过，预设选择行与编辑控件不受影响）。
 */
const safeBuildRoutingView = (config: RoutingConfigLike, availability: Record<string, boolean> | null): RoutingView | null => {
  try {
    return buildRoutingView(config, { availability })
  } catch {
    return null
  }
}

/**
 * A-② 决策链档位说明文案（实现锚点 = src/router.ts 优先级链）：档位序号/标题/
 * active/detail 由 view.precedence 单源给出，本表只补「触发条件 / 关闭后的
 * 影响」两行静态说明——纯展示层文案，不参与任何决策。
 */
const TIER_WHEN: Record<number, string> = {
  1: '消息里写了 @provider 或 @provider/model 时',
  // 2026-10-07 复核修：只有子代理（delegationDepth > 0）才保留调用方目标，
  // 主会话点名会被预设覆盖（router.ts shouldKeepExternalTarget）——与同屏
  // 第 2 档 detail「按需：仅子代理」（routing-view.ts）同口径，不得再写「宿主」。
  2: '子代理调用方指定了模型，且与默认目标不同时',
  3: '请求来自被分工表认领的队友时',
  4: '主会话消息命中激活预设的某条规则时',
  5: '以上各档都没接住时',
}
const TIER_OFF: Record<number, string> = {
  1: '无开关，始终最先判定',
  2: '无开关，按调用方指定',
  // 2026-10-07 复核修：D6 起子代理默认不参与关键词规则，清空分工表后队友请求
  // 只落到默认目标——「落到下一档（关键词规则/默认目标）」是旧口径，已按实修正。
  3: '清空分工表后，队友请求落到默认目标（子代理默认不参与关键词规则；仅开启「子代理参与关键词规则」时才可能被规则接管）',
  4: '关闭路由或清空规则后，主会话全部使用默认目标',
  5: '无开关，它是最后一档',
}

/**
 * A-⑤ 词表接入徽标（§4.5）：三态文案 + 色调。流认领优先于规则引用（与
 * buildRoutingView 的徽标单值口径一致）；视图缺该组数据 → null（行不渲染徽标）。
 */
const wiringBadge = (group: GroupInfo | undefined): { text: string; tone: 'ok' | 'flow' | 'warn' } | null => {
  if (group === undefined) return null
  if (group.wiring === 'claimed-by-flow') return { text: '被协作流认领', tone: 'flow' }
  if (group.wiring === 'referenced') {
    return { text: `被 ${group.referencedBy.length} 条规则引用（${group.referencedBy.join('、')}）`, tone: 'ok' }
  }
  return { text: '⚠ 未接入', tone: 'warn' }
}

/** 目标下拉：只列可用（已挂载）模型；当前值未挂载时不作为 option 兜底，改灰字提示
 *  （用户裁定 2026-08-21：未接入的模型不应出现在下拉选择里）。
 *  flowOptions（0.6.0）：规则目标下拉追加「协作流」optgroup（调用方只传
 *  transcribe 流——P1 边界）；不传/空数组 = 无分组（v4 与默认模型下拉行为保持）。
 *  groups/labels（2026-09-11）：与官方 Models 页/模型选择器一致的显示——目录内
 *  模型按提供方分组（组头 = 提供方显示名）、选项文本 = 模型友好名（title 悬停
 *  可见完整 provider/model 键）；groups 缺席 → 按平铺 options 渲染（行为保持），
 *  labels 缺键 → 回退裸键（写入路径的 value 零变化）。 */
function TargetSelect(props: {
  label: string
  value: string
  options: string[]
  groups?: Array<{ label?: string; options: string[] }>
  labels?: Record<string, string>
  flowOptions?: Array<{ id: string; label: string }>
  /**
   * 「空值档」文案（Task 7 修复轮 1，主驱动选择器专用）：传入后 value===''
   * 视为已知档（不弹「未挂载」提示、不落「— 选择目标 —」占位），下拉渲染该
   * 文案的 option；未传 = 行为与此前逐字节一致（既有调用方零改动）。
   */
  nullLabel?: string
  unavailable: boolean
  disabled: boolean
  onChange: (value: string) => void
}) {
  const flowOptions = props.flowOptions ?? []
  const known = props.options.includes(props.value)
    || flowOptions.some((flow) => flowValue(flow.id) === props.value)
    || (props.nullLabel !== undefined && props.value === '')
  const groups = props.groups ?? [{ options: props.options }]
  return (
    <span className="kt-target-wrap">
      {!known && (
        <span className="kt-unavailable kt-target-missing" title="该目标未接入（模型：设置 → Models 挂载后出现；流：flows 注册表缺失）">
          （未挂载）{props.value}
        </span>
      )}
      <select
        aria-label={props.label}
        className={props.unavailable ? 'kt-unavailable' : undefined}
        value={known ? props.value : ''}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {/* 占位档须先于 nullLabel 档：存量值未知（!known）时 select value=''
            命中首个同值 option——先占位档才能如实显示「— 选择目标 —」而非
            误显空值档文案；已知空值态（nullLabel 档本身）不占位、不撞档。 */}
        {!known && <option value="" disabled>— 选择目标 —</option>}
        {props.nullLabel !== undefined && <option value="">{props.nullLabel}</option>}
        {groups.map((group, groupIndex) => {
          const options = group.options.map((option) => (
            <option key={option} value={option} title={option}>{props.labels?.[option] ?? option}</option>
          ))
          return group.label === undefined
            ? <Fragment key={groupIndex}>{options}</Fragment>
            : <optgroup key={groupIndex} label={group.label}>{options}</optgroup>
        })}
        {flowOptions.length > 0 && (
          <optgroup label="协作流">
            {flowOptions.map((flow) => (
              <option key={flow.id} value={flowValue(flow.id)}>{flow.label}</option>
            ))}
          </optgroup>
        )}
      </select>
    </span>
  )
}

/** effort 下拉（0.8.0 D3）：选项 = 该模型支持档位（宿主档位表）；未声明档位
 *  → 只渲染禁用态「跟随默认」。0.8.x⑤：存量值不在选项集（表缺席/漂移）时
 *  追加显示存量原值——运行期由支持集判定（effortForTarget），显示不撒谎；
 *  无选项集仍禁用（不可改选）。 */
function EffortSelect(props: {
  label: string
  value: string | undefined
  options: string[] | undefined
  disabled: boolean
  onChange: (effort: string | undefined) => void
}) {
  const options = props.options ?? []
  const known = props.value !== undefined && options.includes(props.value)
  const stored = props.value !== undefined && !known
  return (
    <select
      aria-label={props.label}
      value={known || stored ? props.value! : ''}
      disabled={props.disabled || options.length === 0}
      onChange={(e) => props.onChange(e.target.value === '' ? undefined : e.target.value)}
    >
      {/* 1.4.1：模型未在宿主目录声明档位时这一项就是唯一选项（下拉禁用）——文案
          自解释，别让用户对着灰框猜原因（实机反馈：「模型能力没法设置」）。 */}
      <option value="">{options.length === 0 ? '跟随默认（该模型未声明档位）' : '跟随默认'}</option>
      {stored && <option value={props.value!}>{props.value!}</option>}
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  )
}

/** 关键词组行：组名 + 接入徽标（A-⑤，可选）+ 词表 textarea（失焦整段保存）+ 删除组。 */
function KeywordGroupRow(props: {
  name: string
  words: string[]
  writable: boolean
  /** A-⑤ 接入徽标（§4.5）：被 N 条规则引用 / 被协作流认领 / ⚠ 未接入；缺省不渲染。 */
  badge?: string
  badgeTone?: 'ok' | 'flow' | 'warn'
  onSave: (words: string[]) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(() => props.words.join('\n'))
  // 评审 P2-4（2026-08-29）：草稿仅挂载时初始化 → 外部推送（他端/他 agent 改
  // 词表）后失焦会用旧草稿整段覆盖新值 = 静默丢修改。joined 变化且本行
  // textarea 未聚焦时重同步；聚焦中不打断编辑（失焦保存本地草稿仍是既有语义）。
  const joined = props.words.join('\n')
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (document.activeElement !== taRef.current) setDraft(joined)
    // draft 不入依赖：仅在权威词表变化时重同步，用户击键不触发。
  }, [joined])
  return (
    <div className="kt-group-row">
      <span className="kt-field-label">{props.name}</span>
      {props.badge !== undefined && (
        <span className={`kt-wire kt-wire-${props.badgeTone ?? 'ok'}`}>{props.badge}</span>
      )}
      <textarea
        ref={taRef}
        aria-label={`${props.name} 词表`}
        disabled={!props.writable}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => props.onSave(parseWords(draft))}
      />
      <button type="button" disabled={!props.writable} onClick={props.onDelete}>删除组</button>
    </div>
  )
}

/**
 * 分工表角色行（Task 7）：显示名/id/队友名/别名文本框（本地草稿、失焦保存——
 * KeywordGroupRow 同款，避免逐击键写盘）+ 目标/档位下拉（改即保存——FlowRow 同款）
 * + 删除。id 变更只上交原文，rekey 与去重 slug 由父层算。草稿重同步与关键词组行
 * 同纪律：外部推送（他端改 roles）且本行未聚焦时重同步，聚焦中不打断编辑。
 */
function RoleRow(props: {
  role: RoleEntry
  writable: boolean
  modelOptions: string[]
  optionGroups: Array<{ label?: string; options: string[] }>
  modelNames: Record<string, string>
  availability: Record<string, boolean> | null
  effortsOf: (target: RouteTarget) => string[] | undefined
  onSave: (next: RoleEntry) => void
  onRename: (rawId: string) => void
  onDelete: () => void
}) {
  const { role } = props
  const [draft, setDraft] = useState(() => ({
    label: role.label,
    id: role.id,
    teammate: (role.teammate ?? []).join(','),
    aliases: (role.aliases ?? []).join(','),
  }))
  const rowRef = useRef<HTMLDivElement | null>(null)
  const joined = `${role.label}\n${role.id}\n${(role.teammate ?? []).join(',')}\n${(role.aliases ?? []).join(',')}`
  useEffect(() => {
    if (rowRef.current === null || !rowRef.current.contains(document.activeElement)) {
      setDraft({
        label: role.label,
        id: role.id,
        teammate: (role.teammate ?? []).join(','),
        aliases: (role.aliases ?? []).join(','),
      })
    }
    // draft 不入依赖：仅在权威角色变化时重同步，用户击键不触发。
  }, [joined])
  return (
    <div className="kt-role-row" ref={rowRef}>
      <input
        aria-label="角色显示名"
        className="kt-role-label"
        value={draft.label}
        disabled={!props.writable}
        onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        onBlur={() => {
          const label = draft.label.trim()
          if (label !== '' && label !== role.label) props.onSave({ ...role, label })
        }}
      />
      <input
        aria-label="角色 id"
        className="kt-role-id"
        value={draft.id}
        disabled={!props.writable}
        title="lower-kebab-case；同时是默认认领的队友名"
        onChange={(e) => setDraft({ ...draft, id: e.target.value })}
        onBlur={() => { if (draft.id.trim() !== role.id) props.onRename(draft.id) }}
      />
      {/* B2 作用域徽标（§5.1）：分工表行 = 「派发时」——只对派给该队友/角色的
          请求改道，主会话不看分工表（与规则行的「主会话」相对）。 */}
      <span className="kt-wire" title="作用域：仅在请求派给该队友/角色时改道（主会话不受分工表影响）">派发时</span>
      <TargetSelect
        label={`${role.label} 目标`}
        value={configKey(role.target)}
        options={props.modelOptions}
        groups={props.optionGroups}
        labels={props.modelNames}
        unavailable={props.availability?.[configKey(role.target)] === false}
        disabled={!props.writable}
        onChange={(value) => props.onSave({ ...role, target: parseTarget(value) })}
      />
      {/* 切换目标天然清空 effort（parseTarget 不产 effort 字段，与规则行同款语义） */}
      <EffortSelect
        label={`${role.label} 目标 · 档位`}
        value={role.target.effort}
        options={props.effortsOf(role.target)}
        disabled={!props.writable}
        onChange={(effort) => {
          const next: RouteTarget = effort === undefined
            ? { provider: role.target.provider, model: role.target.model }
            : { ...role.target, effort }
          props.onSave({ ...role, target: next })
        }}
      />
      <input
        aria-label="队友名"
        className="kt-role-names"
        value={draft.teammate}
        disabled={!props.writable}
        placeholder="额外认领的队友名，逗号分隔"
        onChange={(e) => setDraft({ ...draft, teammate: e.target.value })}
        onBlur={() => {
          const teammate = listFromText(draft.teammate)
          if ((teammate ?? []).join(',') !== (role.teammate ?? []).join(',')) {
            const { teammate: _prev, ...rest } = role
            props.onSave(teammate === undefined ? rest : { ...rest, teammate })
          }
        }}
      />
      <input
        aria-label="别名"
        className="kt-role-names"
        value={draft.aliases}
        disabled={!props.writable}
        placeholder="供模型识别的别名，逗号分隔"
        onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
        onBlur={() => {
          const aliases = listFromText(draft.aliases)
          if ((aliases ?? []).join(',') !== (role.aliases ?? []).join(',')) {
            const { aliases: _prev, ...rest } = role
            props.onSave(aliases === undefined ? rest : { ...rest, aliases })
          }
        }}
      />
      <button type="button" aria-label={`删除角色 ${role.id}`} disabled={!props.writable} onClick={props.onDelete}>删除</button>
    </div>
  )
}

/**
 * 协作流行（0.6.0 spec §7）：类型徽标 + 流 id + 参数控件（改即整段写 flows）。
 * transcribe：视觉模型 + 档位 + failurePolicy；review：评审模型 + 档位（1.4.1
 * 撤销 M7——评审调用现在同样下发推理档位）+ trigger（keywords 时补关键词组选择）
 * + rounds（1..3 夹取，validate 界内）+ autoRevise。
 * 预置流（DEFAULT_FLOWS 键）可改不可删；自建流可删，被引用时禁用删除按钮
 * （store.deleteFlow 的引用守卫是写路径兜底）。无 useState——hooks 置顶纪律
 * 下本组件保持零 hook（参数变更直接落盘，与规则行同款）。
 */
function FlowRow(props: {
  id: string
  flow: CollaborationFlow
  /** 预置流：可改不可删（防规则失去引用目标）。 */
  preset: boolean
  /** 仍被规则 target / imageFallbackFlow 引用：禁用删除按钮。 */
  referenced: boolean
  writable: boolean
  modelOptions: string[]
  /** 下拉分组/显示名（2026-09-11 与官方一致）：透传给 TargetSelect。 */
  optionGroups: Array<{ label?: string; options: string[] }>
  modelNames: Record<string, string>
  availability: Record<string, boolean> | null
  groupNames: string[]
  /** 2026-09-20 回归钉住：本流一旦以 keywords 认领某组，会被抑制成死规则的预设规则。 */
  claimConflicts: Array<{ presetId: string; presetName: string; ruleId: string; group: string }>
  /** effort 选项取数（0.8.0 D3）：宿主档位表按 configKey 查询。 */
  effortsOf: (target: RouteTarget) => string[] | undefined
  onSave: (flow: CollaborationFlow) => void
  onDelete: () => void
}) {
  const { flow } = props
  return (
    <div className="kt-flow-row">
      <span className="kt-flow-badge">{flow.type === 'transcribe' ? '转述' : '评审'}</span>
      <span className="kt-field-label">{props.id}</span>
      {flow.type === 'transcribe' ? (
        <>
          <TargetSelect
            label={`${props.id} 视觉模型`}
            value={configKey(flow.visionModel)}
            options={props.modelOptions}
            groups={props.optionGroups}
            labels={props.modelNames}
            unavailable={props.availability?.[configKey(flow.visionModel)] === false}
            disabled={!props.writable}
            onChange={(value) => props.onSave({ ...flow, visionModel: parseTarget(value) })}
          />
          <EffortSelect
            label={`${props.id} 视觉模型 · 档位`}
            value={flow.visionModel.effort}
            options={props.effortsOf(flow.visionModel)}
            disabled={!props.writable}
            onChange={(effort) => {
              const v = flow.visionModel
              const next: RouteTarget = effort === undefined
                ? { provider: v.provider, model: v.model }
                : { ...v, effort }
              props.onSave({ ...flow, visionModel: next })
            }}
          />
          <select
            aria-label={`${props.id} 失败策略`}
            value={flow.failurePolicy}
            disabled={!props.writable}
            onChange={(e) => props.onSave({ ...flow, failurePolicy: e.target.value as TranscribeFlow['failurePolicy'] })}
          >
            <option value="latch-image">失败锁存</option>
            <option value="blind">失败盲答</option>
          </select>
        </>
      ) : (
        <>
          <TargetSelect
            label={`${props.id} 评审模型`}
            value={configKey(flow.reviewer)}
            options={props.modelOptions}
            groups={props.optionGroups}
            labels={props.modelNames}
            unavailable={props.availability?.[configKey(flow.reviewer)] === false}
            disabled={!props.writable}
            onChange={(value) => props.onSave({ ...flow, reviewer: parseTarget(value) })}
          />
          <EffortSelect
            label={`${props.id} 评审模型 · 档位`}
            value={flow.reviewer.effort}
            options={props.effortsOf(flow.reviewer)}
            disabled={!props.writable}
            onChange={(effort) => {
              const r = flow.reviewer
              const next: RouteTarget = effort === undefined
                ? { provider: r.provider, model: r.model }
                : { ...r, effort }
              props.onSave({ ...flow, reviewer: next })
            }}
          />
          <select
            aria-label={`${props.id} 触发方式`}
            value={flow.trigger}
            disabled={!props.writable}
            onChange={(e) => {
              const trigger = e.target.value as ReviewFlow['trigger']
              const next: ReviewFlow = { ...flow, trigger }
              // validate-on-write 纪律：trigger=keywords 必须有存在的 keywordGroup——
              // 切换时自动带上首个可用组，避免写出过不了 validate 的中间态。
              if (trigger === 'keywords' && (next.keywordGroup === undefined || !props.groupNames.includes(next.keywordGroup))) {
                next.keywordGroup = props.groupNames[0]
              }
              props.onSave(next)
            }}
          >
            <option value="manual">手动</option>
            <option value="keywords" disabled={props.groupNames.length === 0}>关键词组</option>
          </select>
          {flow.trigger === 'keywords' && (
            <select
              aria-label={`${props.id} 触发关键词组`}
              value={flow.keywordGroup ?? ''}
              disabled={!props.writable}
              onChange={(e) => props.onSave({ ...flow, keywordGroup: e.target.value })}
            >
              {flow.keywordGroup !== undefined && !props.groupNames.includes(flow.keywordGroup) && (
                <option value={flow.keywordGroup} disabled>{flow.keywordGroup}（缺失）</option>
              )}
              {props.groupNames.map((group) => (
                <option key={group} value={group}>{group}</option>
              ))}
            </select>
          )}
          {flow.trigger === 'keywords' && props.claimConflicts.length > 0 && (
            <span className="kt-claimed-hint kt-claim-conflict">
              本流认领该组后，下列预设规则将不再参与路由：
              {props.claimConflicts.map((c) => `${c.ruleId}（${c.presetName}）`).join('、')}
            </span>
          )}
          <input
            aria-label={`${props.id} 评审轮次`}
            type="number"
            min={1}
            max={3}
            step={1}
            value={flow.rounds}
            disabled={!props.writable}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') return // 清空中间态不写盘（受控值随下次渲染回显）
              const rounds = Math.round(Number(raw))
              if (!Number.isInteger(rounds)) return
              // 0.6.x池#c：界外输入回显钳制值（1..3），不再静默忽略致显示与落盘分叉。
              props.onSave({ ...flow, rounds: Math.min(3, Math.max(1, rounds)) })
            }}
          />
          <label className="kt-row">
            <input
              aria-label={`${props.id} 自动修订`}
              type="checkbox"
              checked={flow.autoRevise}
              disabled={!props.writable}
              onChange={(e) => props.onSave({ ...flow, autoRevise: e.target.checked })}
            />
            自动修订
          </label>
          <label className="kt-row">
            <input
              aria-label={`${props.id} 复检`}
              type="checkbox"
              // v1.4.0：默认开（用户 2026-10-02 裁定）——存量配置没写该键也显示为勾选；
              // 取消勾选显式落盘 false（`!== false` 语义的写侧对应）。
              checked={flow.recheck !== false}
              disabled={!props.writable}
              onChange={(e) => props.onSave({ ...flow, recheck: e.target.checked })}
            />
            修订后复检
          </label>
          {/* v1.4.0 配额护栏（spec §3.5）：两个开关各多花一次调用，写清代价再让人勾。
              上限口径 = **每会话每流**（与 README/CHANGELOG 一致，复核 F4 修正「每轮会话」）。 */}
          <span className="kt-flow-quota-hint">
            开启自动修订或复检后：每次退回会多一轮主模型调用
            {flow.recheck !== false ? '，复检再各多一次评审调用' : ''}
            ；本会话该流最多修订 {Math.min(3, Math.max(1, Math.round(flow.rounds) || 1))} 次（= 轮次上限，手动退回同计）。
          </span>
        </>
      )}
      {!props.preset && (
        <button
          type="button"
          aria-label={`删除流 ${props.id}`}
          disabled={!props.writable || props.referenced}
          title={props.referenced ? '仍被规则或 imageFallbackFlow 引用，请先清除引用' : undefined}
          onClick={props.onDelete}
        >
          删除
        </button>
      )}
    </div>
  )
}

export function SettingsCard(props: SettingsCardProps) {
  const { scope, connection } = props
  const [store] = useState(() => (props.storeFactory ?? createCardStore)(scope, connection))
  // connection 路径是异步 describe：mount 后拉一次（scope 路径已在创建时同步读入）。
  useEffect(() => {
    void store.load()
  }, [store])
  useEffect(() => {
    if (props.fetchEfforts !== undefined) {
      void store.loadEfforts(props.fetchEfforts)
    }
  }, [store, props.fetchEfforts])
  // 0.8.x④：档位表随宿主 adapters 刷新——catalogScope（kimi-tide-catalog
  // 命名空间，settings/document-updated 推送缝）通知即重取；退订随 effect
  // cleanup（副作用可逆）。
  useEffect(() => {
    const catalog = props.catalogScope
    if (catalog === undefined || catalog === null) return undefined
    return catalog.subscribe(() => {
      if (props.fetchEfforts !== undefined) {
        void store.loadEfforts(props.fetchEfforts)
      }
    })
  }, [store, props.fetchEfforts, props.catalogScope])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const config = snapshot.config

  // hooks 纪律（2026-08-20 生产事故回归钉）：全部 useState 必须先于下方
  // `config === null` 提前返回——首帧 loading → ready 的重渲染若 hook 数变化，
  // React 直接卸载整卡（设置页「月汐」卡片空白；回归见 test/SettingsCard.dom.test.tsx）。
  const [newPresetName, setNewPresetName] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [trialText, setTrialText] = useState('')
  // B4（2026-10-07 §5.3）：测试场「派给谁」输入（角色/队友名 → previewDispatch 预判改道）。
  const [dispatchClaim, setDispatchClaim] = useState('')
  // 0.6.x池#7：新建协作流表单（预置流模板 + slug 化 id 去重）。
  const [newFlowId, setNewFlowId] = useState('')
  const [newFlowType, setNewFlowType] = useState<'transcribe' | 'review'>('transcribe')
  // ⑥-B：设置卡三页签（路由 / 协作流 / 测试场）——CSS 可见性切换（区块保持
  // 挂载，受控表单状态与既有测试选择器零改动）。
  const [activeTab, setActiveTab] = useState<'route' | 'flows' | 'trial' | 'help'>('route')
  /**
   * 页签/面板 id 的**实例前缀**（UI 评审 #8，2026-09-15 修）：原为静态
   * `kt-tab-<key>` / `kt-panel-<key>`，同页挂两张卡（例如设置页与测试场并存、
   * 或未来多入口）即 id 撞车——`aria-controls` 会指向**另一张卡**的面板（读屏
   * 定位到错的面板），DOM 查询也只命中第一张。`useId()` 随实例变化，React 18
   * 的 SSR/并发渲染下同样稳定（本卡在客户端挂载，取到的是 `:rN:` 形态）。
   */
  const cardUid = useId()
  const tabId = (key: 'route' | 'flows' | 'trial' | 'help'): string => `${cardUid}kt-tab-${key}`
  const panelId = (key: 'route' | 'flows' | 'trial' | 'help'): string => `${cardUid}kt-panel-${key}`

  /**
   * 页签键盘操作（2026-09-15 还 UI 评审 C11/N5 的债）：←/→ 循环、Home/End 跳首尾，
   * 选中项随焦点移动（roving tabindex 在按钮上，见渲染处 tabIndex）。
   * 按 DOM 实际存在的 role=tab 计算顺序——协作流页签在 v4 下不存在，无需特判。
   */
  const onTablistKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // 带修饰键的组合不吞（Alt/Shift+← 是浏览器历史导航等系统行为，评审 #7）。
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')]
    const selected = e.currentTarget.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    const index = selected === null ? -1 : tabs.indexOf(selected)
    if (index < 0) return
    const pick = (target: HTMLElement | undefined): void => {
      if (target === undefined) return
      e.preventDefault()
      target.focus()
      // 页签键取自 data-kt-tab（评审 #8）：id 现在是实例级（useId），不能再从
      // `aria-controls` 的字符串里反推键名。
      const key = target.dataset.ktTab
      if (key === 'route' || key === 'flows' || key === 'trial' || key === 'help') setActiveTab(key)
    }
    if (e.key === 'ArrowRight') pick(tabs[(index + 1) % tabs.length])
    else if (e.key === 'ArrowLeft') pick(tabs[(index - 1 + tabs.length) % tabs.length])
    else if (e.key === 'Home') pick(tabs[0])
    else if (e.key === 'End') pick(tabs[tabs.length - 1])
  }
  // ⑥-B 打磨三（2026-08-29）：规则条件互斥——编辑产生新重复时保存被阻止的提示。
  const [ruleConflict, setRuleConflict] = useState<string | null>(null)
  // 评审 P2-2（2026-08-29）：删除预设两步确认——首击武装（3 秒自动解除），再击才删。
  const [deleteArmed, setDeleteArmed] = useState(false)
  useEffect(() => {
    if (!deleteArmed) return
    const timer = window.setTimeout(() => setDeleteArmed(false), 3000)
    return () => window.clearTimeout(timer)
  }, [deleteArmed])
  // 评审 P2-3：保存反馈——写路径全部经 storeWriter（下方包装），落盘即闪「已保存」。
  const [savedFlash, setSavedFlash] = useState(false)
  const flashTimer = useRef<number | undefined>(undefined)
  // 写方法包装器：flash 后透传原方法（读路径 load/subscribe/getSnapshot 不包装）。
  // 反馈在点击时刻亮起（写为异步，失败仍经 snapshot.error 上浮展示）。
  const storeWriter = useMemo(() => {
    const flash = (): void => {
      setSavedFlash(true)
      if (flashTimer.current !== undefined) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1600)
    }
    const wrap = <K extends keyof CardStore>(key: K): CardStore[K] =>
      ((...args: unknown[]) => {
        flash()
        return (store[key] as (...a: unknown[]) => Promise<unknown>)(...args)
      }) as CardStore[K]
    return {
      ...store,
      saveTop: wrap('saveTop'),
      saveActivePreset: wrap('saveActivePreset'),
      savePreset: wrap('savePreset'),
      createPreset: wrap('createPreset'),
      deletePreset: wrap('deletePreset'),
      saveKeywordGroups: wrap('saveKeywordGroups'),
      saveFlows: wrap('saveFlows'),
      deleteFlow: wrap('deleteFlow'),
      saveRoles: wrap('saveRoles'),
      saveDriver: wrap('saveDriver'),
      saveDriverSticky: wrap('saveDriverSticky'),
      saveRulesApplyToChildren: wrap('saveRulesApplyToChildren'),
      resetField: wrap('resetField'),
    }
    // store 由 useState 惰性初始化，实例恒定；flash 闭包稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A 项（2026-10-07 设计稿 §3/§4）：统一视图模型——顶部摘要、五档决策链、
  // 词表接入徽标、默认目标档全部单源消费 buildRoutingView，不自己拼摘要文案。
  // 防御：构建异常回落 null（§9.3：render 抛错会把 slot 条目整块搞白）——
  // 链区/徽标/空状态整组跳过，预设选择行与编辑控件照常（见渲染处兜底分支）。
  const routingView = useMemo(
    () => (config === null ? null : safeBuildRoutingView(config, snapshot.availability)),
    [config, snapshot.availability],
  )

  if (config === null) {
    // 现状不可用态原样保留。
    return (
      <div className="kimi-tide-settings">
        <span className="kt-hint">路由设置不可用</span>
        {snapshot.error !== null && <span className="kt-warn"><Icon name="warn" /> {snapshot.error}</span>}
      </div>
    )
  }

  const writable = snapshot.writable
  const efforts = snapshot.efforts
  // T7 延期 Minor 门控：createPreset 在未就绪时会整段覆盖 presets、deletePreset
  // 双写非原子——新建/复制/删除按钮只在 status==='ready' && config!==null（此点
  // 之后 config 恒非 null）且可写时可用，UI 层门控是既定缓解。
  const canManagePresets = writable && snapshot.status === 'ready'
  const activeId = config.activePreset
  const active = activeId !== null ? config.presets[activeId] ?? null : null
  // ⑥-B 打磨三：存量重复条件（首条保留，其后被遮蔽）——警示条与行标记的数据源。
  const dupIds = active !== null ? duplicateRuleIds(active.rules) : []
  const dupSet = new Set(dupIds)
  // 1.1.0 §4 认领（review 流 trigger=keywords 的非空 keywordGroup → 该组被流认领）：
  // 认领组规则的命中被路由层静态抑制（spec §4）——规则行灰态 + 行尾提示。认领与
  // 规则共存是合法态，抑制是自然结果——只提示不拦保存；v4 无 flows → 空集。
  const claimedGroups = claimedReviewGroups(config)
  // 2026-09-20 回归钉住：认领会把**挂在同组上的预设规则**抑制成死规则（出厂默认就
  // 含这一对：capability 预设的 review-k3 × 评审流）。算成数据后放进**改 trigger 的
  // 那一行**——用户在那里做决定，就该在那里看见代价。
  const claimConflicts = claimedGroupRuleConflicts(config)
  const catalog = snapshot.catalog ?? []
  // 下拉只列可用模型（用户裁定 2026-08-21）：availability 明确 false（未挂载/目录未列出）即剔除；
  // availability 为 null（无连接通道）时不设灰态，全目录入选项。
  const modelOptions = catalog.flatMap((group) =>
    group.models
      .filter((model) => snapshot.availability === null || snapshot.availability[`${group.provider}/${model}`] !== false)
      .map((model) => `${group.provider}/${model}`),
  )
  // ⑥-B 打磨三修订（实机 2026-08-29）：目录通道未列出的 provider（插件自挂
  // 等）→ 把配置中的目标并入选项，否则工作中的模型被误标（未挂载）且回显
  // 丢失；availability===false（provider 已知而模型缺失，真未挂载）仍排除
  // （2026-08-21 用户裁定保持）。
  {
    const configured: RouteTarget[] = []
    for (const preset of Object.values(config.presets)) {
      configured.push(preset.default)
      for (const rule of preset.rules) {
        if (!isFlowTarget(rule.target)) configured.push(rule.target)
      }
    }
    if (isV5PlusConfig(config)) {
      for (const flow of Object.values(config.flows)) {
        configured.push(flow.type === 'transcribe' ? flow.visionModel : flow.reviewer)
      }
    }
    for (const target of configured) {
      const key = configKey(target)
      if (snapshot.availability?.[key] !== false && !modelOptions.includes(key)) modelOptions.push(key)
    }
  }
  // 目标灰态：读快照 availability（数据源 = connection.api.llm.models，
  // 见 card-store.loadAvailability）；null（无通道/拉取失败）时无灰态。
  const availability = snapshot.availability
  // 模型显示名（2026-09-11 与官方一致）：目录给的友好名（快照映射）；缺键回退裸键。
  const modelNames = snapshot.modelNames ?? {}
  const providerNames = snapshot.providerNames ?? {}
  // 下拉分组：目录内模型按提供方分组（组头 = 提供方显示名，顺序随目录）；
  // 目录未列出的并入目标（兜底键）+ 目录外 provider（无组可归）归入无组尾段。
  // modelOptions 与分组渲染分离：已知值判定/去重仍走平铺键列表。
  const optionGroups: Array<{ label?: string; options: string[] }> = []
  {
    const grouped = new Set<string>()
    for (const group of catalog) {
      const options = modelOptions.filter((key) => key.startsWith(`${group.provider}/`))
      if (options.length === 0) continue
      for (const key of options) grouped.add(key)
      optionGroups.push({ label: providerNames[group.provider] ?? group.provider, options })
    }
    const extras = modelOptions.filter((key) => !grouped.has(key))
    if (extras.length > 0) optionGroups.push({ options: extras })
  }
  // effort 选项取数（0.8.0 D3）：宿主档位表（snapshot.efforts，configKey 索引）；
  // null/undefined（无通道/失败/模型未声明）→ 无档位可选（下拉禁用「跟随默认」）。
  const effortsOf = (target: RouteTarget): string[] | undefined =>
    efforts === null || efforts === undefined ? undefined : efforts[configKey(target)]
  const groupNames = Object.keys(config.keywordGroups)

  /* ---- 0.6.0 协作流（v5+ 门控；v4 配置下本节全部为空/不渲染，行为保持）---- */
  const isV5Plus = isV5PlusConfig(config)
  const flows = isV5Plus ? config.flows : {}
  const flowEntries = Object.entries(flows)
  // P1 边界：仅 transcribe 流可作规则目标（review 流出现在注册表区但不进分组）。
  const transcribeFlowOptions = flowEntries
    .filter(([, flow]) => flow.type === 'transcribe')
    .map(([id]) => ({ id, label: `${id}（转述）` }))
  /** 流引用检查（UI 层禁用删除；store.deleteFlow 守卫是写路径兜底）。 */
  const flowReferenced = (flowId: string): boolean =>
    Object.values(config.presets).some((preset) =>
      preset.rules.some((rule) => isFlowTarget(rule.target) && rule.target.flow === flowId)
      || preset.imageFallbackFlow === flowId
      // 缺省级联：transcribe-lazy 未显式指定流时隐式引用预置 transcribe。
      || (preset.imageFallback === 'transcribe-lazy' && preset.imageFallbackFlow === undefined && flowId === 'transcribe'))

  /* ---- Task 7 分工表（roles；运行期按字段判据读取 roles ?? {}，不以 version 门控）---- */
  const roles = (config as { roles?: Record<string, RoleEntry> }).roles ?? {}
  const roleEntries = Object.entries(roles)
  /**
   * 兜底目标（新增角色/示例的占位策略，测试已钉住）：激活预设 default → 候选池
   * 首个 → 常量兜底。宿主 validate 要求 role.target 完整（provider/model 非空），
   * 空串占位必被拒写，故不落空目标、由用户事后在下拉里改。
   */
  const roleFallbackTarget = (): RouteTarget =>
    active?.default
    ?? (modelOptions.length > 0
      ? parseTarget(modelOptions[0])
      : { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  const saveRolesRecord = (next: Record<string, RoleEntry>): void => {
    void storeWriter.saveRoles(next)
  }
  const updateRole = (id: string, next: RoleEntry): void => {
    saveRolesRecord({ ...roles, [id]: next })
  }
  const renameRole = (prevId: string, raw: string): void => {
    const nextId = roleSlug(raw, roles) // kebab 折叠 + 与现有键去重
    if (nextId === prevId) return
    const record = { ...roles }
    delete record[prevId]
    saveRolesRecord({ ...record, [nextId]: { ...roles[prevId], id: nextId } })
  }
  const addRole = (): void => {
    const id = roleSlug(`role-${roleEntries.length + 1}`, roles)
    saveRolesRecord({ ...roles, [id]: { id, label: '新角色', target: roleFallbackTarget() } })
  }
  const fillExampleRoles = (): void => {
    // 既有角色保留（同 id 以用户现值为准，示例不覆盖）；三条示例置前便于就地改目标。
    saveRolesRecord({ ...EXAMPLE_ROLES(roleFallbackTarget()), ...roles })
  }

  /**
   * B3 重叠解释器的一键动作（§5.2）：把激活预设中引用该词表组的规则目标改为
   * 跟随该角色目标——走 storeWriter 既有写通道（savePreset → B1 双写），不新增
   * 写语义。找不到对应规则/角色时静默无操作（视图与配置同源，正常不会走到）。
   */
  const followRoleTarget = (overlap: OverlapInfo): void => {
    if (activeId === null || active === null) return
    const role = roles[overlap.roleId]
    if (role === undefined) return
    const index = active.rules.findIndex(
      (rule) => rule.when.kind === 'keywords' && rule.when.group === overlap.group,
    )
    if (index < 0) return
    updateRules(activeId, active.rules.map((rule, i) => (i === index ? { ...rule, target: { ...role.target } } : rule)))
  }

  /**
   * B3 重叠解释器的第二个一键动作（§5.2，2026-10-07 复核补）：把重叠的词追加进
   * 该角色的 aliases——去重（已在别名中不落笔，避免空写）、空串不写；走
   * storeWriter.saveRoles 的守卫式写（认领名跨角色冲突拒写），失败经 error
   * 通道上浮、不静默。分工语义不变：主会话关键词与派发认领各走各的，本动作只是
   * 让角色身份词覆盖该词、供模型识别。
   */
  const mergeWordIntoRoleAliases = (overlap: OverlapInfo): void => {
    const role = roles[overlap.roleId]
    if (role === undefined) return
    const word = overlap.word.trim()
    if (word === '') return
    const aliases = role.aliases ?? []
    if (aliases.includes(word)) return
    updateRole(overlap.roleId, { ...role, aliases: [...aliases, word] })
  }

  /**
   * B3 重叠解释条（§5.2）：词表的词与某角色身份词（id/label/aliases）重叠且
   * 目标不同 ⇒ 词表行与角色行两侧各挂一条——解释条，不是报错（机制上两者本就
   * 不冲突：关键词规则只服务主会话、分工表只服务队友，§1.3）。
   */
  const renderOverlapBar = (overlap: OverlapInfo) => {
    const roleLabel = roles[overlap.roleId]?.label ?? overlap.roleId
    return (
      <div className="kt-overlap" key={`${overlap.group}:${overlap.word}:${overlap.roleId}`}>
        <span>
          设计使然：主会话说『{overlap.word}』走 {overlap.sessionTarget}；派给『{roleLabel}』做走 {overlap.dispatchTarget}。
        </span>
        <button
          type="button"
          disabled={!writable}
          title="把引用该词表组的规则目标改为跟随该角色目标"
          onClick={() => followRoleTarget(overlap)}
        >
          规则跟随该角色
        </button>
        {/* §5.2 第二个一键动作：把该词并入该角色别名（去重、空串不写）。 */}
        <button
          type="button"
          disabled={!writable}
          title="把该词追加进该角色的别名（已在别名中则不落笔）——认领集合不变，仅供模型识别"
          onClick={() => mergeWordIntoRoleAliases(overlap)}
        >
          词并入该角色别名
        </button>
      </div>
    )
  }

  /**
   * B5 词表 → 角色接入（§5.4）：把「已备但没有任何规则引用」的词表组
   * （view.groups 中 wiring=orphan 的组）批量生成分工角色；目标先取当前预设
   * 默认模型（与「填入三条示例」同款兜底策略，roleFallbackTarget）。生成仍走
   * 既有写入期校验（saveRoles 守卫：认领名跨角色唯一，冲突拒写并上浮）。
   */
  const orphanGroups = (routingView?.groups ?? []).filter((group) => group.wiring === 'orphan')
  const generateRolesFromGroups = (): void => {
    const next = { ...roles }
    for (const group of orphanGroups) {
      const id = roleSlug(group.name, next)
      next[id] = { id, label: group.name, target: roleFallbackTarget() }
    }
    if (Object.keys(next).length > roleEntries.length) saveRolesRecord(next)
  }

  // B4：datalist 候选 = 全部 dispatch 行的认领集合（teammate[] ∪ {id}，视图单源）。
  const dispatchClaims = [...new Set(
    (routingView?.dispatch ?? []).flatMap((row) => (row.condition.kind === 'role' ? row.condition.claims : [])),
  )]

  /* ---- Task 7 修复轮 1 主驱动控件（v6 顶层三键 driver / driverSticky /
     rulesApplyToChildren）：读取按字段判据（?? null / === true），与运行期
     router.ts 同口径，不做 version 门控（分工表卡同款纪律）。 ---- */
  const driver = (config as { driver?: RouteTarget | null }).driver ?? null
  const driverSticky = (config as { driverSticky?: boolean }).driverSticky === true
  const rulesApplyToChildren = (config as { rulesApplyToChildren?: boolean }).rulesApplyToChildren === true

  // 规则编辑：全部组装 next 后经 store 整段写。
  const updateRules = (presetId: string, rules: RouterRule[]): void => {
    const preset = config.presets[presetId]
    if (preset === undefined) return
    void storeWriter.savePreset(presetId, { ...preset, rules })
  }

  // ⑥-B 打磨三（2026-08-29）：条件互斥——同条件（带图 / 同组同 minHits）规则
  // 只能存在一条，后者永不优先。编辑/新增产生「新增重复」→ 阻止保存（返回
  // false，由调用方上浮提示）；存量重复不阻止编辑，走顶部警示条 + 一键清理。
  const saveRulesIfDistinct = (presetId: string, before: RouterRule[], next: RouterRule[]): boolean => {
    if (duplicateRuleIds(next).length > duplicateRuleIds(before).length) return false
    updateRules(presetId, next)
    return true
  }

  const editActiveRule = (index: number, patch: Partial<RouterRule>): void => {
    if (activeId === null || active === null) return
    const next = active.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule))
    if (!saveRulesIfDistinct(activeId, active.rules, next)) {
      setRuleConflict('条件重复（互斥）：同条件规则只能保留一条，本次修改未保存')
      return
    }
    setRuleConflict(null)
  }

  const moveRule = (index: number, delta: -1 | 1): void => {
    if (activeId === null || active === null) return
    const next = [...active.rules]
    const [rule] = next.splice(index, 1)
    next.splice(index + delta, 0, rule)
    updateRules(activeId, next)
  }

  const removeRule = (index: number): void => {
    if (activeId === null || active === null) return
    if (saveRulesIfDistinct(activeId, active.rules, active.rules.filter((_, i) => i !== index))) {
      setRuleConflict(null)
    }
  }

  const addRule = (): void => {
    if (activeId === null || active === null) return
    // ⑥-B 打磨三修订（用户实测「不能新增了」2026-08-29）：新规则不再默认
    // 带图（必撞互斥），自动选第一个未占用条件：带图空位 → 各组 minHits=1
    // 空位 → 同组 minHits 递进；全部占满（且无组可进档）才阻止并提示。
    const taken = new Set(active.rules.map((rule) => ruleConditionKey(rule.when)))
    let when: RouterRule['when'] | null = null
    if (!taken.has(ruleConditionKey({ kind: 'image' }))) {
      when = { kind: 'image' }
    } else {
      for (const group of groupNames) {
        if (!taken.has(`kw:${group}:1`)) {
          when = { kind: 'keywords', group, minHits: 1 }
          break
        }
      }
      if (when === null) {
        for (const group of groupNames) {
          for (let minHits = 2; minHits <= active.rules.length + 1; minHits += 1) {
            if (!taken.has(`kw:${group}:${minHits}`)) {
              when = { kind: 'keywords', group, minHits }
              break
            }
          }
          if (when !== null) break
        }
      }
    }
    if (when === null) {
      setRuleConflict('没有可用条件：所有条件均已被占用（可先在「关键词组」新建组，再新增规则）')
      return
    }
    updateRules(activeId, [
      ...active.rules,
      { id: newRuleId(active.rules), when, target: active.default },
    ])
    setRuleConflict(null)
  }

  const saveDefault = (value: string): void => {
    if (activeId === null || active === null) return
    void storeWriter.savePreset(activeId, { ...active, default: parseTarget(value) })
  }

  const saveImageFallback = (value: ImageFallback): void => {
    if (activeId === null || active === null) return
    void storeWriter.savePreset(activeId, { ...active, imageFallback: value })
  }

  const saveImageFallbackFlow = (flowId: string): void => {
    if (activeId === null || active === null) return
    void storeWriter.savePreset(activeId, { ...active, imageFallbackFlow: flowId })
  }

  /**
   * 语义命中确认闸（v1.3.0，spec §8.1）：整体写回 preset.hitConfirm。
   * 数字项 validate-on-write——非 1..10000 / 1..256 整数一律**不写**（保持旧值），
   * 空串视为「清除该项」（回落模块缺省），与 minHits 同款纪律。
   */
  const saveHitConfirm = (next: HitConfirm): void => {
    if (activeId === null || active === null) return
    void storeWriter.savePreset(activeId, { ...active, hitConfirm: next })
  }
  const writeHitConfirmNumber = (field: 'timeoutMs' | 'maxTokens', raw: string): void => {
    const current = active?.hitConfirm ?? {}
    const trimmed = raw.trim()
    const bounds = field === 'timeoutMs' ? { min: 1, max: 10_000 } : { min: 1, max: 256 }
    if (trimmed === '') {
      const next: HitConfirm = { ...current }
      delete next[field]
      saveHitConfirm(next)
      return
    }
    const value = Number(trimmed)
    if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) return
    saveHitConfirm({ ...current, [field]: value })
  }

  const createPreset = (): void => {
    const name = newPresetName.trim()
    const id = presetSlug(name, config.presets)
    const fallbackDefault: RouteTarget = active?.default
      ?? (modelOptions.length > 0
        ? parseTarget(modelOptions[0])
        : { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    void storeWriter.createPreset(id, { name: name !== '' ? name : id, default: fallbackDefault, rules: [] })
    setNewPresetName('')
  }

  const duplicateActive = (): void => {
    if (activeId === null || active === null) return
    const name = `${active.name} 副本`
    void storeWriter.createPreset(presetSlug(name, config.presets), { ...active, name, rules: [...active.rules] })
  }

  const deleteActive = (): void => {
    if (activeId === null) return
    void storeWriter.deletePreset(activeId)
  }

  const addGroup = (): void => {
    const name = newGroupName.trim()
    if (name === '' || Object.hasOwn(config.keywordGroups, name)) return
    void storeWriter.saveKeywordGroups({ ...config.keywordGroups, [name]: [] })
    setNewGroupName('')
  }

  /* ---- A-② 链内档位容器（设计稿 §4.2）：第 3 档内联分工表、第 4 档内联当前预设
     编辑器——两表改为链上的档位容器（不再并列折叠）。抽成 JSX 变量：视图模型缺席
     （构建异常，§9.3 防御）时兜底分支直渲同一对块，编辑能力不丢。 ---- */
  const editorBlock = active !== null && activeId !== null ? (
        <div className="kt-editor">
          <label className="kt-row">
            <span className="kt-field-label">默认模型</span>
            <TargetSelect
              label="默认模型"
              value={configKey(active.default)}
              options={modelOptions}
              groups={optionGroups}
              labels={modelNames}
              unavailable={availability?.[configKey(active.default)] === false}
              disabled={!writable}
              onChange={saveDefault}
            />
            {/* 切换默认模型天然清空 effort（parseTarget 不产 effort 字段，D3 UI 语义） */}
            <EffortSelect
              label="默认模型 · 档位"
              value={active.default.effort}
              options={effortsOf(active.default)}
              disabled={!writable}
              onChange={(effort) => {
                const next: RouteTarget = effort === undefined
                  ? { provider: active.default.provider, model: active.default.model }
                  : { ...active.default, effort }
                void storeWriter.savePreset(activeId, { ...active, default: next })
              }}
            />
            {/* A-⑥ driver 消歧（§4.6）：driverSticky 开启时主会话默认目标恒定取主驱动，
                预设「默认模型」只在主驱动关闭（跟随宿主默认）时生效。 */}
            {driverSticky && <span className="kt-hint">仅主驱动关闭时生效</span>}
          </label>
          {/* A-⑥ 同值提示：driverSticky 开且主驱动目标 = 本预设默认模型时，两处在
              界面上看不出差别（§1.1 症状 3）——显式点名，避免用户误以为重复配置。 */}
          {driverSticky && driver !== null && configKey(driver) === configKey(active.default) && (
            <span className="kt-hint">
              主驱动目标与本预设默认模型同值（{configKey(driver)}）——目前两处看不出差别，改动任一处才会分叉
            </span>
          )}

          <div className="kt-card kt-rules">
            <div className="kt-card-head">
              <h4 className="kt-card-title">规则</h4>
              <span className="kt-h">命中词数多者优先，平手按列表序，带图恒第一</span>
            </div>
            {/* ⑥-B 打磨三：存量重复条件警示条 + 一键清理被遮蔽规则。 */}
            {dupIds.length > 0 && (
              <div className="kt-conflict-banner" role="alert">
                <span className="kt-warn">
                  检测到重复条件（{dupIds.length} 条被遮蔽）——同条件规则只有首条可命中
                </span>
                <button
                  type="button"
                  disabled={!writable}
                  onClick={() => {
                    if (activeId === null || active === null) return
                    const shadowed = new Set(dupIds)
                    updateRules(activeId, active.rules.filter((rule) => !shadowed.has(rule.id)))
                  }}
                >
                  删除重复项
                </button>
              </div>
            )}
            {/* ⑥-B 打磨三修订：单一表格容器共享列轨（行用 subgrid），表头与数据列对齐。 */}
            <div className="kt-rule-table">
              {/* 评审 P2-6：表头不再 aria-hidden——列头进入可访问树（读屏可听列名）。 */}
            <div className="kt-rule-grid kt-rule-head">
                <span>#</span>
                <span>条件</span>
                <span>目标</span>
                <span>档位</span>
                <span>操作</span>
              </div>
            {active.rules.map((rule, index) => {
              const targetKey = ruleTargetValue(rule.target)
              const missingGroup = rule.when.kind === 'keywords' && !Object.hasOwn(config.keywordGroups, rule.when.group)
              const conflicted = dupSet.has(rule.id)
              const claimed = rule.when.kind === 'keywords' && claimedGroups.has(rule.when.group)
              return (
                <div key={rule.id} className={`kt-rule-grid kt-rule-row${conflicted ? ' kt-conflict' : ''}${rule.when.kind === 'image' ? ' kt-row-image' : ''}${claimed ? ' kt-rule-claimed' : ''}`}>
                  <span className="kt-rule-no">{index + 1}</span>
                  <span className="kt-cond">
                    {/* B2 作用域徽标（§5.1）：规则行 = 「主会话」——关键词规则只对
                        主会话生效（子代理不参与，D6；与分工表行的「派发时」相对）。 */}
                    <span className="kt-wire" title="作用域：只对主会话生效（子代理不参与关键词规则，D6）">主会话</span>
                    <select
                      aria-label={`第 ${index + 1} 条 · 条件`}
                      value={conditionValue(rule)}
                      disabled={!writable}
                      onChange={(e) => {
                        const parsed = parseCondition(e.target.value)
                        // 条件切换保留 minHits（0.7.0：parseCondition 不含该字段，
                        // keywords→keywords 切组时组合补回）。
                        const when = rule.when.kind === 'keywords' && parsed.kind === 'keywords'
                          ? { ...parsed, minHits: rule.when.minHits }
                          : parsed
                        editActiveRule(index, { when })
                      }}
                    >
                      <option value={IMAGE_VALUE}>带图</option>
                      {groupNames.map((group) => (
                        <option key={group} value={kwValue(group)}>{group}</option>
                      ))}
                      {rule.when.kind === 'keywords' && missingGroup && (
                        <option value={kwValue(rule.when.group)}>{rule.when.group}（缺失）</option>
                      )}
                    </select>
                    {rule.when.kind === 'keywords' && (
                      <>
                        <input
                          aria-label={`第 ${index + 1} 条 · 最少命中词数`}
                          title="最少命中词数：≥N 个词同时命中才触发"
                          className="kt-minhits"
                          type="number"
                          min={1}
                          step={1}
                          value={rule.when.minHits ?? 1}
                          disabled={!writable}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (raw === '') return // 清空中间态不写盘（受控值随下次渲染回显）
                            const n = Math.round(Number(raw))
                            if (!Number.isInteger(n)) return
                            // 0.6.x池#c：下限钳制到 1（原界外静默忽略致显示与落盘分叉）。
                            editActiveRule(index, { when: { ...rule.when, minHits: Math.max(1, n) } })
                          }}
                        />
                        <span className="kt-hint" aria-hidden="true">词</span>
                      </>
                    )}
                  </span>
                  <span className="kt-cell">
                    <TargetSelect
                      label={`第 ${index + 1} 条 · 目标`}
                      value={targetKey}
                      options={modelOptions}
                      groups={optionGroups}
                      labels={modelNames}
                      flowOptions={transcribeFlowOptions}
                      unavailable={availability?.[targetKey] === false}
                      disabled={!writable}
                      onChange={(value) => editActiveRule(index, { target: parseRuleTarget(value) })}
                    />
                  </span>
                  {/* 切换规则目标天然清空 effort（parseRuleTarget 不产 effort 字段，D3 UI 语义） */}
                  <span className="kt-cell">
                    {!isFlowTarget(rule.target) ? (
                      <EffortSelect
                        label={`第 ${index + 1} 条 · 档位`}
                        value={rule.target.effort}
                        options={effortsOf(rule.target)}
                        disabled={!writable}
                        onChange={(effort) => {
                          const t = rule.target as RouteTarget
                          const next: RouteTarget = effort === undefined
                            ? { provider: t.provider, model: t.model }
                            : { ...t, effort }
                          editActiveRule(index, { target: next })
                        }}
                      />
                    ) : (
                      <span className="kt-hint">—</span>
                    )}
                  </span>
                  <span className="kt-ops">
                    <button
                      type="button"
                      aria-label={`第 ${index + 1} 条 · 上移`}
                      disabled={!writable || index === 0}
                      onClick={() => moveRule(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`第 ${index + 1} 条 · 下移`}
                      disabled={!writable || index === active.rules.length - 1}
                      onClick={() => moveRule(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`第 ${index + 1} 条 · 删除规则`}
                      disabled={!writable}
                      onClick={() => removeRule(index)}
                    >
                      删除
                    </button>
                  </span>
                  {claimed && (
                    <span className="kt-claimed-hint">该组已被评审流认领，不再参与路由</span>
                  )}
                  {conflicted && (
                    <span className="kt-conflict-hint">条件重复：与上方某条规则条件相同，永不优先命中</span>
                  )}
                </div>
              )
            })}
            </div>
            {/* A-④ 空状态说明（§4.4）：rules 为空时不再是一张空表——明示「全部使用
                默认目标（<目标>）」；有未接入词表（已备但无规则引用）时点名数量与后果。
                默认目标与摘要同口径（view.fallback；视图缺席回落本预设默认模型）。 */}
            {active.rules.length === 0 && (() => {
              const orphans = (routingView?.groups ?? []).filter((group) => group.wiring === 'orphan').length
              const base = routingView === null
                ? configKey(active.default)
                : routingView.fallback.target !== null ? configKey(routingView.fallback.target) : '宿主默认'
              return (
                <div className="kt-rules-empty">
                  <div>主会话没有可命中的规则，全部使用默认目标（{base}）。</div>
                  {orphans > 0 && <div>另有 {orphans} 组关键词组未接入任何规则，暂不生效。</div>}
                </div>
              )
            })()}
            {ruleConflict !== null && (
              <span className="kt-warn kt-rule-conflict-msg" role="alert">{ruleConflict}</span>
            )}
            <button type="button" className="kt-btn-primary" disabled={!writable} onClick={addRule}>新增规则</button>
          </div>

          {/* 带图兜底三态（0.6.0，仅 v5+）：锁存/盲答/懒转述 + 一句话后果提示；
              懒转述流选择器仅 transcribe-lazy 态渲染（缺省指向预置 transcribe）。 */}
          {isV5Plus && (
            <div className="kt-card kt-fallback">
              <label className="kt-row">
                <span className="kt-field-label">带图兜底</span>
                <select
                  aria-label="带图兜底"
                  value={active.imageFallback ?? 'latch'}
                  disabled={!writable}
                  onChange={(e) => saveImageFallback(e.target.value as ImageFallback)}
                >
                  <option value="latch">锁存</option>
                  <option value="blind">盲答</option>
                  <option value="transcribe-lazy">懒转述</option>
                </select>
              </label>
              <span className="kt-hint">{FALLBACK_HINTS[active.imageFallback ?? 'latch']}</span>
              {(active.imageFallback ?? 'latch') === 'transcribe-lazy' && (
                <label className="kt-row">
                  <span className="kt-field-label">懒转述流</span>
                  <select
                    aria-label="懒转述流"
                    value={active.imageFallbackFlow ?? 'transcribe'}
                    disabled={!writable}
                    onChange={(e) => saveImageFallbackFlow(e.target.value)}
                  >
                    {transcribeFlowOptions.map((flow) => (
                      <option key={flow.id} value={flow.id}>{flow.id}</option>
                    ))}
                    {!transcribeFlowOptions.some((flow) => flow.id === (active.imageFallbackFlow ?? 'transcribe')) && (
                      <option value={active.imageFallbackFlow ?? 'transcribe'} disabled>
                        {active.imageFallbackFlow ?? 'transcribe'}（缺失）
                      </option>
                    )}
                  </select>
                </label>
              )}
            </div>
          )}

          {/* 语义命中确认闸（v1.3.0，仅 v5+；spec §8.1）：默认关闭。开启后关键词命中
              先由**本预设的默认模型**确认意图真伪，判否跳过该规则、继续后续规则；
              超时/目标不可用/解析失败一律按原关键词结果走（fail-open）。 */}
          {isV5Plus && (
            <div className="kt-card kt-hit-confirm">
              <label className="kt-row">
                <span className="kt-field-label">语义命中确认</span>
                <input
                  type="checkbox"
                  aria-label="语义命中确认"
                  checked={active.hitConfirm?.enabled === true}
                  disabled={!writable}
                  onChange={(e) => saveHitConfirm({ ...(active.hitConfirm ?? {}), enabled: e.target.checked })}
                />
                <span className="kt-hint">
                  命中先让本预设的默认模型（{configKey(active.default)}）确认一次；判否就跳过该条规则
                </span>
              </label>
              {active.hitConfirm?.enabled === true && (
                <>
                  <label className="kt-row">
                    <span className="kt-field-label">判官超时（毫秒）</span>
                    <input
                      type="number"
                      aria-label="判官超时"
                      min={1}
                      max={10000}
                      defaultValue={active.hitConfirm.timeoutMs ?? 1200}
                      disabled={!writable}
                      onBlur={(e) => writeHitConfirmNumber('timeoutMs', e.target.value)}
                    />
                  </label>
                  <label className="kt-row">
                    <span className="kt-field-label">判官输出上限（token）</span>
                    <input
                      type="number"
                      aria-label="判官输出上限"
                      min={1}
                      max={256}
                      defaultValue={active.hitConfirm.maxTokens ?? 64}
                      disabled={!writable}
                      onBlur={(e) => writeHitConfirmNumber('maxTokens', e.target.value)}
                    />
                  </label>
                  <span className="kt-hint">
                    问不到（超时/模型不可用/输出读不出）一律不过闸；显式 @ 轮与「带图规则已排首位」的轮不会调用判官。
                  </span>
                </>
              )}
            </div>
          )}
        </div>
  ) : null

  /* Task 7 分工表（角色 = 领域 → 模型）：details.kt-card 范式不变，容器改为决策链
     第 3 档（A-②，不再与关键词组/主驱动并列）。写通道 = storeWriter.saveRoles
     （守卫式：认领名冲突 fail() 不写盘，错误经 .kt-status-slot 状态槽上浮）。 */
  const rolesBlock = (
      <details className="kt-roles kt-card" data-kt-section="roles">
        <summary>分工表（专项活派给谁）</summary>
        <p className="kt-hint">
          每个角色 = 一个领域 → 一个模型。角色 id 与「队友名」用 lower-kebab-case（如 frontend）；
          用这些名字 spawn_teammate，月汐会把它们的请求改道到该角色的目标模型。
          认领名（id + 队友名）不得跨角色重复——冲突时保存会被拒绝。
        </p>
        {roleEntries.map(([id, role]) => (
          <div key={id} className="kt-group-item">
            <RoleRow
              role={role}
              writable={writable}
              modelOptions={modelOptions}
              optionGroups={optionGroups}
              modelNames={modelNames}
              availability={availability}
              effortsOf={effortsOf}
              onSave={(next) => updateRole(id, next)}
              onRename={(raw) => renameRole(id, raw)}
              onDelete={() => {
                const next = { ...roles }
                delete next[id]
                saveRolesRecord(next)
              }}
            />
            {/* B3 重叠解释条（角色侧，§5.2）：本角色身份词与词表词重叠且目标不同 ⇒ 行下挂解释条。 */}
            {(routingView?.overlaps ?? []).filter((overlap) => overlap.roleId === id).map(renderOverlapBar)}
          </div>
        ))}
        <div className="kt-row">
          <button type="button" disabled={!writable} onClick={addRole}>新增角色</button>
          <button
            type="button"
            disabled={!writable}
            title="填入 前端/后端/写作 三条示例（目标先取当前预设默认模型，可再在下拉里改）"
            onClick={fillExampleRoles}
          >
            填入三条示例
          </button>
          {/* B5 词表 → 角色接入（§5.4）：orphan 词表组（无规则引用）批量生成分工角色。 */}
          <button
            type="button"
            disabled={!writable || orphanGroups.length === 0}
            title="把还没有任何规则引用的词表组批量生成分工角色（目标先取当前预设默认模型，可再在下拉里改）"
            onClick={generateRolesFromGroups}
          >
            从词表生成角色
          </button>
        </div>
      </details>
  )

  return (
    <div className="kimi-tide-settings" data-tab={activeTab}>
      {/* ⑥-B：页签导航。2026-09-15 v2（评审 M1/M2）：可见性改由**容器 + hidden**
          驱动（styles.ts 有作者级 [hidden] 兜底）；旧 data-tab :not() 链退役——
          那套写法正是「测试场藏错误横幅 / 藏已保存」两起 bug 的成因。
          键盘：←/→ 循环、Home/End 跳首尾（还 UI 评审 C11/N5 的债）。
          id：**实例级**（useId，评审 #8）——静态 `kt-tab-*`/`kt-panel-*` 在同页两张卡时撞车，
          aria-controls 会指向另一张卡的面板；页签键改走 `data-kt-tab`，不再从 id 反推。 */}
      <div className="kt-tabs" role="tablist" onKeyDown={onTablistKeyDown}>
        <button type="button" role="tab" id={tabId('route')} aria-controls={panelId('route')} data-kt-tab="route"
          aria-selected={activeTab === 'route'} tabIndex={activeTab === 'route' ? 0 : -1}
          className={activeTab === 'route' ? 'kt-tab kt-tab-on' : 'kt-tab'}
          onClick={() => setActiveTab('route')}>路由</button>
        {isV5Plus && (
          <button type="button" role="tab" id={tabId('flows')} aria-controls={panelId('flows')} data-kt-tab="flows"
            aria-selected={activeTab === 'flows'} tabIndex={activeTab === 'flows' ? 0 : -1}
            className={activeTab === 'flows' ? 'kt-tab kt-tab-on' : 'kt-tab'}
            onClick={() => setActiveTab('flows')}>协作流</button>
        )}
        <button type="button" role="tab" id={tabId('trial')} aria-controls={panelId('trial')} data-kt-tab="trial"
          aria-selected={activeTab === 'trial'} tabIndex={activeTab === 'trial' ? 0 : -1}
          className={activeTab === 'trial' ? 'kt-tab kt-tab-on' : 'kt-tab'}
          onClick={() => setActiveTab('trial')}>测试场</button>
        <button type="button" role="tab" id={tabId('help')} aria-controls={panelId('help')} data-kt-tab="help"
          aria-selected={activeTab === 'help'} tabIndex={activeTab === 'help' ? 0 : -1}
          className={activeTab === 'help' ? 'kt-tab kt-tab-on' : 'kt-tab'}
          onClick={() => setActiveTab('help')}>说明</button>
      </div>
      {/* 1.4.1：瞬态状态位（错误横幅 /「已保存」闪现）收进**绝对定位**槽——它们是
          反馈而不是内容，此前在文档流里各占一行，每次落盘闪现都会把下面整块内容顶下去
          再弹回来（实机反馈：「切换完显示已保存 UI 会上下跳动」）。槽脱离文档流 ⇒
          零位移；错误与「已保存」同槽并排，互不覆盖。 */}
      <div className="kt-status-slot">
        {snapshot.error !== null && <span className="kt-warn kt-error" role="alert"><Icon name="warn" /> {snapshot.error}</span>}
        {savedFlash && <span className="kt-saved" role="status">已保存</span>}
      </div>

      {/* 路由页容器（A 项重排 2026-10-07，设计稿 §4）：顶部摘要 → 预设选择行 →
          竖直决策链（第 3 档内联分工表 / 第 4 档内联预设编辑器）→ 预设操作 →
          关键词组 → 主驱动——信息架构从「四个并列控件」改为「一条决策链」。 */}
      <div className="kt-tabpanel kt-route" role="tabpanel" id={panelId('route')} aria-labelledby={tabId('route')} tabIndex={0} hidden={activeTab !== 'route'}>

      {/* A-① 顶部摘要：describeRouting 单源输出（routingView.summary），一行，
          不自己拼文案（三处共用防漂移——设置页/技能描述/show 命令）。 */}
      {routingView !== null && <p className="kt-route-summary">{routingView.summary}</p>}

      {/* 预设选择行：关闭 + 各预设（点击即写 activePreset，全局生效）。 */}
      <div className="kt-preset-row">
        <button
          type="button"
          className={activeId === null ? 'kt-preset kt-active' : 'kt-preset'}
          aria-pressed={activeId === null}
          disabled={!writable}
          onClick={() => {
            setRuleConflict(null)
            void storeWriter.saveActivePreset(null)
          }}
        >
          关闭
        </button>
        {Object.entries(config.presets).map(([id, preset]) => (
          <button
            key={id}
            type="button"
            className={id === activeId ? 'kt-preset kt-active' : 'kt-preset'}
            aria-pressed={id === activeId}
            disabled={!writable}
            onClick={() => {
              setRuleConflict(null)
              void storeWriter.saveActivePreset(id)
            }}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* A-② 竖直决策链（§4.2）：五档直渲 view.precedence（序号/标题/active/detail
          单源），顺序 = 显式 @ > 调用方点名 > 分工表 role > 关键词规则 > 默认目标。
          第 3 档内联分工表、第 4 档内联当前预设编辑器——两表改为链上档位容器，
          不再并列。每档三行式：触发条件 / 当前取值 / 关闭后的影响。
          未激活档位只靠语义分层（透明度 + 状态字），§9.2 禁第二道边框/阴影。 */}
      {routingView !== null ? (
        <ol className="kt-chain">
          {routingView.precedence.map((tier) => (
            <li key={tier.tier} className={tier.state === 'off' ? 'kt-tier kt-tier-off' : 'kt-tier'}>
              <div className="kt-tier-head">
                <span className="kt-tier-no" aria-hidden="true">{tier.tier}</span>
                <span className="kt-tier-title">{tier.title}</span>
                {/* A-② 三态徽标（2026-10-07 修）：off ⇒ 未启用；on-demand ⇒ 按需。
                    「按需」**不置灰**——该档可用，只是要满足条件才参与（写 @ / 子代理点名）；
                    只有真正不参与的档位才走 kt-tier-off 的语义分层（§9.2 禁边框/阴影分组）。 */}
                {tier.state === 'off' && <span className="kt-tier-state">未启用</span>}
                {tier.state === 'on-demand' && <span className="kt-tier-state">按需</span>}
              </div>
              <p className="kt-tier-line"><span className="kt-tier-tag">触发条件</span>{TIER_WHEN[tier.tier] ?? '—'}</p>
              <p className="kt-tier-line">
                <span className="kt-tier-tag">当前取值</span>
                {/* A-③ 默认目标档显式渲染 view.fallback（来源 + reason；activePreset=null
                    ⇒「路由已关闭」），其余档位渲染视图模型给出的 detail。 */}
                {tier.tier === 5
                  ? routingView.fallback.target !== null
                    ? `${configKey(routingView.fallback.target)}（${routingView.fallback.reason}）`
                    : routingView.fallback.reason
                  : tier.detail !== '' ? tier.detail : '—'}
              </p>
              <p className="kt-tier-line"><span className="kt-tier-tag">关闭后的影响</span>{TIER_OFF[tier.tier] ?? '—'}</p>
              {tier.tier === 3 && rolesBlock}
              {tier.tier === 4 && editorBlock}
            </li>
          ))}
        </ol>
      ) : (
        // 兜底：视图模型构建失败（§9.3 防御）时编辑能力不丢——同一对容器降级为并列直渲。
        <>
          {editorBlock}
          {rolesBlock}
        </>
      )}

      {/* 预设操作：新建（输入显示名 → slug id）/ 复制当前 / 删除当前。
          仅 ready 且可写时可用（T7 延期 Minor 门控）。 */}
      <div className="kt-preset-ops">
        <input
          aria-label="新预设名"
          placeholder="新预设名"
          value={newPresetName}
          disabled={!canManagePresets}
          onChange={(e) => setNewPresetName(e.target.value)}
        />
        <button type="button" disabled={!canManagePresets} onClick={createPreset}>新建预设</button>
        {active !== null && (
          <>
            <button type="button" disabled={!canManagePresets} onClick={duplicateActive}>复制</button>
            {/* 评审 P2-2：删除预设连全部规则——两步确认（3 秒自动解除）。 */}
            <button
              type="button"
              className={deleteArmed ? 'kt-danger' : undefined}
              disabled={!canManagePresets}
              title={deleteArmed ? '再次点击确认删除（3 秒内有效）' : undefined}
              onClick={() => {
                if (!deleteArmed) {
                  setDeleteArmed(true)
                  return
                }
                setDeleteArmed(false)
                deleteActive()
              }}
            >
              {deleteArmed ? '确认删除？' : '删除'}
            </button>
          </>
        )}
      </div>

      {/* 关键词组管理区：组列表（A-⑤ 每行带接入徽标：被 N 条规则引用 / 被协作流
          认领 / ⚠ 未接入）+ 每组词表编辑（逗号/换行分隔）+ 新建/删除组。 */}
      <details className="kt-groups kt-card">
        <summary>关键词组</summary>
        {groupNames.map((name) => {
          const badge = wiringBadge(routingView?.groups.find((group) => group.name === name))
          // B3 重叠解释条（词表侧，§5.2）：本组有词与角色身份词重叠且目标不同 ⇒ 行下挂解释条。
          const overlaps = (routingView?.overlaps ?? []).filter((overlap) => overlap.group === name)
          return (
            <div key={name} className="kt-group-item">
              <KeywordGroupRow
                name={name}
                words={config.keywordGroups[name]}
                writable={writable}
                {...(badge === null ? {} : { badge: badge.text, badgeTone: badge.tone })}
                onSave={(words) => void storeWriter.saveKeywordGroups({ ...config.keywordGroups, [name]: words })}
                onDelete={() => void storeWriter.saveKeywordGroups(omitKey(config.keywordGroups, name))}
              />
              {overlaps.map(renderOverlapBar)}
            </div>
          )
        })}
        <div className="kt-row">
          <input
            aria-label="新组名"
            placeholder="新组名"
            value={newGroupName}
            disabled={!writable}
            onChange={(e) => setNewGroupName(e.target.value)}
          />
          <button
            type="button"
            disabled={!writable || newGroupName.trim() === '' || Object.hasOwn(config.keywordGroups, newGroupName.trim())}
            onClick={addGroup}
          >
            新建组
          </button>
        </div>
      </details>

      {/* Task 7 修复轮 1（控制器 R6 漏项补齐）：主驱动卡——v6 顶层三键
          driver / driverSticky / rulesApplyToChildren 的设置入口（此前只有帮助条目，
          设计稿 §8-1「设置页可一键打开」无从落地）。写通道 = storeWriter.saveDriver /
          saveDriverSticky / saveRulesApplyToChildren（saveTop 范式：scope.set/mutate +
          写后「意图值 vs 实读值」比对）。零新增 useState（改即保存，FlowRow 同款纪律）。 */}
      <details className="kt-driver kt-card" data-kt-section="driver">
        <summary>主驱动（团队派发）</summary>
        <p className="kt-hint">
          主驱动目标 = 主会话默认目标的常驻来源；选「跟随宿主默认」= 不锁定（driver = null）。
        </p>
        {/* ③ driver 消歧（§4.6，2026-10-07 复核修）：driverSticky 关闭时主驱动目标
            暂不生效（主会话默认目标跟随预设默认模型）——行置灰走透明度 + 状态字分层
            （§9.2 禁边框/阴影分组），并明示未启用原因；开关行保持原样——它是启用
            入口，不能灰。 */}
        <div className={driverSticky ? 'kt-driver-row' : 'kt-driver-row kt-driver-off'}>
          <span className="kt-field-label">主驱动目标</span>
          <TargetSelect
            label="主驱动目标"
            value={driver === null ? '' : configKey(driver)}
            options={modelOptions}
            groups={optionGroups}
            labels={modelNames}
            nullLabel="跟随宿主默认"
            unavailable={driver !== null && availability?.[configKey(driver)] === false}
            disabled={!writable}
            onChange={(value) => void storeWriter.saveDriver(value === '' ? null : parseTarget(value))}
          />
        </div>
        {!driverSticky && (
          <span className="kt-hint">
            未启用：「主驱动恒定」已关闭，主会话默认目标跟随预设默认模型——此目标暂不生效，开启主驱动恒定后才接管默认目标
          </span>
        )}
        <label className="kt-row">
          <span className="kt-field-label">主驱动恒定</span>
          <input
            type="checkbox"
            aria-label="主驱动恒定"
            checked={driverSticky}
            disabled={!writable}
            onChange={(e) => void storeWriter.saveDriverSticky(e.target.checked)}
          />
          <span className="kt-hint">开启后主会话默认目标恒定用主驱动目标（目标是「跟随宿主默认」时不改道）</span>
        </label>
        <label className="kt-row">
          <span className="kt-field-label">子代理参与关键词规则</span>
          <input
            type="checkbox"
            aria-label="子代理参与关键词规则"
            checked={rulesApplyToChildren}
            disabled={!writable}
            onChange={(e) => void storeWriter.saveRulesApplyToChildren(e.target.checked)}
          />
          <span className="kt-hint">关闭（默认）时子代理请求不参与关键词规则——只有分工表认领的队友会被改道</span>
        </label>
      </details>

      </div>

      {/* 测试场页容器 */}
      <div className="kt-tabpanel kt-trial" role="tabpanel" id={panelId('trial')} aria-labelledby={tabId('trial')} tabIndex={0} hidden={activeTab !== 'trial'}>

      {/* 「试一句」测试器（0.8.0 D2）：纯文本语义预测——命中规则（词数）+ 最终
          目标；带图输入只展示规则命中、不承诺最终改道（浏览器侧无 modalities）。 */}
      <details className="kt-trial kt-card" open>
        <summary>试一句</summary>
        <input
          aria-label="试一句"
          placeholder="输入一句话，看它会命中哪条规则、路由到哪个模型"
          value={trialText}
          onChange={(e) => setTrialText(e.target.value)}
        />
        {trialText.trim() !== '' && (() => {
          const preview = previewRoute(config, trialText, {
            catalog: snapshot.catalog,
            availability: snapshot.availability,
            flows: isV5Plus ? config.flows : undefined,
            mounted: snapshot.mounted,
          })
          return (
            <div className="kt-trial-result">
              <span className="kt-hint">按当前激活预设（{activeId === null ? '关闭' : active?.name ?? activeId}）</span>
              {preview.hits.length === 0 && <div className="kt-h">未命中任何规则</div>}
              {preview.hits.map(({ rule, score }) => (
                <div key={rule.id} className="kt-trial-hit">
                  {ruleLabel(rule)} 命中 {score === Number.POSITIVE_INFINITY ? '（带图规则）' : `${score} 词`}
                  —— {ruleConditionSummary(rule, config)}
                </div>
              ))}
              <div className="kt-trial-outcome">
                {/* 1.1.0 §4 review-flow outcome（A5 载体）：文案 = 本轮路由到 <routed
                    摘要> + <label>——routed 规则 → 该规则 label，default → 「预设默认」；
                    label 已含「轮末触发评审流 <id>/评审模型不可用」盲区语义，不重复处理。 */}
                最终路由：
                {preview.outcome.kind === 'review-flow' ? (
                  <span>本轮路由到 {preview.outcome.routed.kind === 'rule' ? preview.outcome.routed.label : '预设默认'} + {preview.outcome.label}</span>
                ) : preview.outcome.kind === 'off' ? preview.outcome.reason
                  : preview.outcome.kind === 'explicit' ? preview.outcome.reason
                  : preview.outcome.kind === 'rule'
                    ? `${preview.outcome.reason} → ${preview.outcome.target === null ? '（不可判）' : isFlowTarget(preview.outcome.target) ? `协作流 ${preview.outcome.target.flow}` : configKey(preview.outcome.target)}`
                    : `${preview.outcome.reason} → ${configKey(preview.outcome.target)}`}
              </div>
              <span className="kt-hint">仅文本探针：带图输入只展示规则命中，最终改道取决于图像护栏/协作流，此处不承诺。</span>
            </div>
          )
        })()}
      </details>

      {/* B4 派发层（§5.3）「派给谁」：输入或选择一个角色/队友名 ⇒ 用
          previewDispatch 在同一视图模型上反查该队友的改道目标与依据
          （role / unclaimed，复用派发台账口径）；命中时同时显示角色 label。 */}
      <details className="kt-trial kt-card" open>
        <summary>派给谁</summary>
        <input
          aria-label="派给谁"
          list={`${cardUid}kt-claim-list`}
          placeholder="输入或选择角色/队友名（如 frontend）"
          value={dispatchClaim}
          onChange={(e) => setDispatchClaim(e.target.value)}
        />
        <datalist id={`${cardUid}kt-claim-list`}>
          {dispatchClaims.map((claim) => (
            <option key={claim} value={claim} />
          ))}
        </datalist>
        {dispatchClaim.trim() !== '' && (routingView === null ? (
          <span className="kt-hint">视图模型不可用，无法预判派发结果。</span>
        ) : (() => {
          const claim = dispatchClaim.trim()
          const result = previewDispatch(routingView, claim)
          return (
            <div className="kt-trial-result">
              {result.basis === 'role' && result.target !== null ? (
                <div className="kt-trial-outcome">
                  派给「{result.roleLabel ?? claim}」（{claim}）→ 改道到 {configKey(result.target)}
                  {result.target.effort !== undefined ? `（档位 ${result.target.effort}）` : ''}
                  ；依据：role（分工表认领）
                </div>
              ) : (
                <div className="kt-trial-outcome">
                  「{claim}」未被分工表认领 ⇒ 不改道（保持调用方指定或宿主默认模型）；依据：unclaimed
                </div>
              )}
            </div>
          )
        })())}
        {/* D6 作用域声明（§5.3）：与「试一句」是两套作用域——子代理不参与关键词
            规则，上面那句的命中结果对派出去的队友不适用。 */}
        <span className="kt-hint">
          子代理不参与关键词规则（D6）：这里的「派给谁」看的是分工表改道，与上面「试一句」（主会话关键词规则）是两套作用域。
        </span>
      </details>
      </div>

      {/* 协作流页容器（flows 仅 v5+ 存在，故容器与内容一起门控） */}
      {isV5Plus && (
        <div className="kt-tabpanel kt-flows" role="tabpanel" id={panelId('flows')} aria-labelledby={tabId('flows')} tabIndex={0} hidden={activeTab !== 'flows'}>
        <details className="kt-flows kt-card" open>
          <summary>协作流</summary>
          {flowEntries.map(([flowId, flow]) => (
            <FlowRow
              key={flowId}
              id={flowId}
              flow={flow}
              preset={Object.hasOwn(DEFAULT_FLOWS(), flowId)}
              referenced={flowReferenced(flowId)}
              writable={writable}
              modelOptions={modelOptions}
              optionGroups={optionGroups}
              modelNames={modelNames}
              availability={availability}
              groupNames={groupNames}
              claimConflicts={claimConflicts}
              effortsOf={effortsOf}
              onSave={(next) => void storeWriter.saveFlows({ ...flows, [flowId]: next })}
              onDelete={() => void storeWriter.deleteFlow(flowId)}
            />
          ))}
          {/* 0.6.x池#7：新建流入口——预置流同型模板 + presetSlug 去重后缀。 */}
          <div className="kt-flow-row kt-flow-new">
            <select
              aria-label="新建流类型"
              value={newFlowType}
              disabled={!writable}
              onChange={(e) => setNewFlowType(e.target.value as 'transcribe' | 'review')}
            >
              <option value="transcribe">转述</option>
              <option value="review">评审</option>
            </select>
            <input
              aria-label="新建流 id"
              type="text"
              placeholder="新流 id"
              value={newFlowId}
              disabled={!writable}
              onChange={(e) => setNewFlowId(e.target.value)}
            />
            <button
              type="button"
              aria-label="新建流"
              disabled={!writable || newFlowId.trim() === ''}
              title="按所选类型用预置流默认参数创建（id 冲突自动 -2 后缀）；创建后可在各行内改参数"
              onClick={() => {
                const id = presetSlug(newFlowId.trim(), flows)
                void storeWriter.saveFlows({ ...flows, [id]: { ...DEFAULT_FLOWS()[newFlowType] } })
                setNewFlowId('')
              }}
            >
              新建流
            </button>
          </div>
        </details>
        </div>
      )}

      {/* 说明页容器（2026-09-15 v2）：状态感知自解释层——面板元素 + 全部设置语义。
          只读：无按钮/表单控件；静态内容来自 help-content.ts 单一内容源。 */}
      <div className="kt-tabpanel kt-help" role="tabpanel" id={panelId('help')} aria-labelledby={tabId('help')} tabIndex={0} hidden={activeTab !== 'help'}>
        <HelpTab config={config} />
      </div>
    </div>
  )
}

export default SettingsCard
