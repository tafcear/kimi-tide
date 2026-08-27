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
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createCardStore } from './card-store.js'
import type { CardStore, ConnectionLike, SettingsScopeLike } from './card-store.js'
import { previewRoute, ruleConditionSummary, ruleLabel } from '../rules.js'
import {
  configKey,
  DEFAULT_FLOWS,
  isFlowTarget,
  type CollaborationFlow,
  type ImageFallback,
  type ReviewFlow,
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

/** imageFallback 三态的一句话后果提示（spec §7）。 */
const FALLBACK_HINTS: Record<ImageFallback, string> = {
  latch: '带图后锁定视觉模型，后续文本轮继续走视觉（0.5.x 语义）',
  blind: '文本轮当无图处理——看不到历史图，可能盲答',
  'transcribe-lazy': '文本轮先把历史图转写为文字再作答（多一次视觉调用）',
}

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

const omitKey = (obj: Record<string, string[]>, key: string): Record<string, string[]> => {
  const next = { ...obj }
  delete next[key]
  return next
}

/** 目标下拉：只列可用（已挂载）模型；当前值未挂载时不作为 option 兜底，改灰字提示
 *  （用户裁定 2026-08-21：未接入的模型不应出现在下拉选择里）。
 *  flowOptions（0.6.0）：规则目标下拉追加「协作流」optgroup（调用方只传
 *  transcribe 流——P1 边界）；不传/空数组 = 无分组（v4 与默认模型下拉行为保持）。 */
function TargetSelect(props: {
  label: string
  value: string
  options: string[]
  flowOptions?: Array<{ id: string; label: string }>
  unavailable: boolean
  disabled: boolean
  onChange: (value: string) => void
}) {
  const flowOptions = props.flowOptions ?? []
  const known = props.options.includes(props.value)
    || flowOptions.some((flow) => flowValue(flow.id) === props.value)
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
        {!known && <option value="" disabled>— 选择目标 —</option>}
        {props.options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
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
 *  → 只渲染禁用态「跟随默认」；value 不在选项集 → 视同「跟随默认」。 */
function EffortSelect(props: {
  label: string
  value: string | undefined
  options: string[] | undefined
  disabled: boolean
  onChange: (effort: string | undefined) => void
}) {
  const options = props.options ?? []
  const known = props.value !== undefined && options.includes(props.value)
  return (
    <select
      aria-label={`effort ${props.label}`}
      value={known ? props.value! : ''}
      disabled={props.disabled || options.length === 0}
      onChange={(e) => props.onChange(e.target.value === '' ? undefined : e.target.value)}
    >
      <option value="">跟随默认</option>
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  )
}

/** 关键词组行：组名 + 词表 textarea（失焦整段保存）+ 删除组。 */
function KeywordGroupRow(props: {
  name: string
  words: string[]
  writable: boolean
  onSave: (words: string[]) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(() => props.words.join('\n'))
  return (
    <div className="kt-group-row">
      <span className="kt-field-label">{props.name}</span>
      <textarea
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
 * 协作流行（0.6.0 spec §7）：类型徽标 + 流 id + 参数控件（改即整段写 flows）。
 * transcribe：视觉模型 + failurePolicy；review：评审模型 + trigger（keywords 时
 * 补关键词组选择）+ rounds（1..3 夹取，validate 界内）+ autoRevise。
 * 预置流（DEFAULT_FLOWS 键）可改不可删；自建流可删，被引用时禁用删除按钮
 * （store.deleteFlow 的引用守卫是写路径兜底）。无 useState——hooks 置顶纪律
 * 下本组件保持零 hook（参数变更直接落盘，与规则行同款）。
 */
function FlowRow(props: {
  id: string
  flow: CollaborationFlow
  /** 预置流：可改不可删（防规则悬空）。 */
  preset: boolean
  /** 仍被规则 target / imageFallbackFlow 引用：禁用删除按钮。 */
  referenced: boolean
  writable: boolean
  modelOptions: string[]
  availability: Record<string, boolean> | null
  groupNames: string[]
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
            unavailable={props.availability?.[configKey(flow.visionModel)] === false}
            disabled={!props.writable}
            onChange={(value) => props.onSave({ ...flow, visionModel: parseTarget(value) })}
          />
          <EffortSelect
            label={`${props.id} 视觉模型`}
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
            unavailable={props.availability?.[configKey(flow.reviewer)] === false}
            disabled={!props.writable}
            onChange={(value) => props.onSave({ ...flow, reviewer: parseTarget(value) })}
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
          <input
            aria-label={`${props.id} 评审轮次`}
            type="number"
            min={1}
            max={3}
            step={1}
            value={flow.rounds}
            disabled={!props.writable}
            onChange={(e) => {
              const rounds = Math.round(Number(e.target.value))
              // validate 界内才写（rounds 须为 1..3 整数），界外输入直接忽略。
              if (Number.isInteger(rounds) && rounds >= 1 && rounds <= 3) {
                props.onSave({ ...flow, rounds })
              }
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
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const config = snapshot.config

  // hooks 纪律（2026-08-20 生产事故回归钉）：全部 useState 必须先于下方
  // `config === null` 提前返回——首帧 loading → ready 的重渲染若 hook 数变化，
  // React 直接卸载整卡（设置页「月汐」卡片空白；回归见 test/SettingsCard.dom.test.tsx）。
  const [newPresetName, setNewPresetName] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [trialText, setTrialText] = useState('')

  if (config === null) {
    // 现状不可用态原样保留。
    return (
      <div className="kimi-tide-settings">
        <span className="kt-hint">⚙️ 路由设置不可用</span>
        {snapshot.error !== null && <span className="kt-warn">⚠️ {snapshot.error}</span>}
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
  const catalog = snapshot.catalog ?? []
  // 下拉只列可用模型（用户裁定 2026-08-21）：availability 明确 false（未挂载/目录未列出）即剔除；
  // availability 为 null（无连接通道）时不设灰态，全目录入选项。
  const modelOptions = catalog.flatMap((group) =>
    group.models
      .filter((model) => snapshot.availability === null || snapshot.availability[`${group.provider}/${model}`] !== false)
      .map((model) => `${group.provider}/${model}`),
  )
  // 目标灰态：读快照 availability（数据源 = connection.api.llm.models，
  // 见 card-store.loadAvailability）；null（无通道/拉取失败）时无灰态。
  const availability = snapshot.availability
  // effort 选项取数（0.8.0 D3）：宿主档位表（snapshot.efforts，configKey 索引）；
  // null/undefined（无通道/失败/模型未声明）→ 无档位可选（下拉禁用「跟随默认」）。
  const effortsOf = (target: RouteTarget): string[] | undefined =>
    efforts === null || efforts === undefined ? undefined : efforts[configKey(target)]
  const groupNames = Object.keys(config.keywordGroups)

  /* ---- 0.6.0 协作流（v5 门控；v4 配置下本节全部为空/不渲染，行为保持）---- */
  const isV5 = config.version === 5
  const flows = isV5 ? config.flows : {}
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

  // 规则编辑：全部组装 next 后经 store 整段写。
  const updateRules = (presetId: string, rules: RouterRule[]): void => {
    const preset = config.presets[presetId]
    if (preset === undefined) return
    void store.savePreset(presetId, { ...preset, rules })
  }

  const editActiveRule = (index: number, patch: Partial<RouterRule>): void => {
    if (activeId === null || active === null) return
    updateRules(activeId, active.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)))
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
    updateRules(activeId, active.rules.filter((_, i) => i !== index))
  }

  const addRule = (): void => {
    if (activeId === null || active === null) return
    updateRules(activeId, [
      ...active.rules,
      { id: newRuleId(active.rules), when: { kind: 'image' }, target: active.default },
    ])
  }

  const saveDefault = (value: string): void => {
    if (activeId === null || active === null) return
    void store.savePreset(activeId, { ...active, default: parseTarget(value) })
  }

  const saveImageFallback = (value: ImageFallback): void => {
    if (activeId === null || active === null) return
    void store.savePreset(activeId, { ...active, imageFallback: value })
  }

  const saveImageFallbackFlow = (flowId: string): void => {
    if (activeId === null || active === null) return
    void store.savePreset(activeId, { ...active, imageFallbackFlow: flowId })
  }

  const createPreset = (): void => {
    const name = newPresetName.trim()
    const id = presetSlug(name, config.presets)
    const fallbackDefault: RouteTarget = active?.default
      ?? (modelOptions.length > 0
        ? parseTarget(modelOptions[0])
        : { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    void store.createPreset(id, { name: name !== '' ? name : id, default: fallbackDefault, rules: [] })
    setNewPresetName('')
  }

  const duplicateActive = (): void => {
    if (activeId === null || active === null) return
    const name = `${active.name} 副本`
    void store.createPreset(presetSlug(name, config.presets), { ...active, name, rules: [...active.rules] })
  }

  const deleteActive = (): void => {
    if (activeId === null) return
    void store.deletePreset(activeId)
  }

  const addGroup = (): void => {
    const name = newGroupName.trim()
    if (name === '' || Object.hasOwn(config.keywordGroups, name)) return
    void store.saveKeywordGroups({ ...config.keywordGroups, [name]: [] })
    setNewGroupName('')
  }

  return (
    <div className="kimi-tide-settings">
      {snapshot.error !== null && <span className="kt-warn">⚠️ {snapshot.error}</span>}

      {/* 预设选择行：关闭 + 各预设（点击即写 activePreset，全局生效）。 */}
      <div className="kt-preset-row">
        <button
          type="button"
          className={activeId === null ? 'kt-preset kt-active' : 'kt-preset'}
          aria-pressed={activeId === null}
          disabled={!writable}
          onClick={() => void store.saveActivePreset(null)}
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
            onClick={() => void store.saveActivePreset(id)}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* 当前预设编辑器（选中非「关闭」时显示）。 */}
      {active !== null && activeId !== null && (
        <div className="kt-editor">
          <label className="kt-row">
            <span className="kt-field-label">默认模型</span>
            <TargetSelect
              label="默认模型"
              value={configKey(active.default)}
              options={modelOptions}
              unavailable={availability?.[configKey(active.default)] === false}
              disabled={!writable}
              onChange={saveDefault}
            />
            {/* 切换默认模型天然清空 effort（parseTarget 不产 effort 字段，D3 UI 语义） */}
            <EffortSelect
              label="默认模型"
              value={active.default.effort}
              options={effortsOf(active.default)}
              disabled={!writable}
              onChange={(effort) => {
                const next: RouteTarget = effort === undefined
                  ? { provider: active.default.provider, model: active.default.model }
                  : { ...active.default, effort }
                void store.savePreset(activeId, { ...active, default: next })
              }}
            />
          </label>

          <div className="kt-rules">
            <span className="kt-h">规则（命中词数多者优先，平手按列表序，带图恒第一）</span>
            {active.rules.map((rule, index) => {
              const targetKey = ruleTargetValue(rule.target)
              const missingGroup = rule.when.kind === 'keywords' && !Object.hasOwn(config.keywordGroups, rule.when.group)
              return (
                <div key={rule.id} className="kt-rule-row">
                  <select
                    aria-label="条件"
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
                    <label className="kt-row">
                      <span className="kt-hint">最少命中词数</span>
                      <input
                        aria-label="最少命中词数"
                        title="≥N 个词同时命中才触发"
                        className="kt-minhits"
                        type="number"
                        min={1}
                        step={1}
                        value={rule.when.minHits ?? 1}
                        disabled={!writable}
                        onChange={(e) => {
                          const n = Math.round(Number(e.target.value))
                          if (Number.isInteger(n) && n >= 1) {
                            editActiveRule(index, { when: { ...rule.when, minHits: n } })
                          }
                        }}
                      />
                    </label>
                  )}
                  <TargetSelect
                    label="目标"
                    value={targetKey}
                    options={modelOptions}
                    flowOptions={transcribeFlowOptions}
                    unavailable={availability?.[targetKey] === false}
                    disabled={!writable}
                    onChange={(value) => editActiveRule(index, { target: parseRuleTarget(value) })}
                  />
                  {/* 切换规则目标天然清空 effort（parseRuleTarget 不产 effort 字段，D3 UI 语义） */}
                  <span className="kt-hint">{ruleConditionSummary(rule, config)}</span>
                  {!isFlowTarget(rule.target) && (
                    <EffortSelect
                      label={rule.id}
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
                  )}
                  <button
                    type="button"
                    aria-label="上移"
                    disabled={!writable || index === 0}
                    onClick={() => moveRule(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="下移"
                    disabled={!writable || index === active.rules.length - 1}
                    onClick={() => moveRule(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label="删除规则"
                    disabled={!writable}
                    onClick={() => removeRule(index)}
                  >
                    删除
                  </button>
                </div>
              )
            })}
            <button type="button" disabled={!writable} onClick={addRule}>新增规则</button>
          </div>

          {/* 带图兜底三态（0.6.0，仅 v5）：锁存/盲答/懒转述 + 一句话后果提示；
              懒转述流选择器仅 transcribe-lazy 态渲染（缺省指向预置 transcribe）。 */}
          {isV5 && (
            <div className="kt-fallback">
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
        </div>
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
            <button type="button" disabled={!canManagePresets} onClick={deleteActive}>删除</button>
          </>
        )}
      </div>

      {/* 「试一句」测试器（0.8.0 D2）：纯文本语义预测——命中规则（词数）+ 最终
          目标；带图输入只展示规则命中、不承诺最终改道（浏览器侧无 modalities）。 */}
      <details className="kt-trial">
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
            flows: isV5 ? config.flows : undefined,
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
                最终路由：{preview.outcome.kind === 'off' ? preview.outcome.reason
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

      {/* 关键词组管理区：组列表 + 每组词表编辑（逗号/换行分隔）+ 新建/删除组。 */}
      <details className="kt-groups">
        <summary>关键词组</summary>
        {groupNames.map((name) => (
          <KeywordGroupRow
            key={name}
            name={name}
            words={config.keywordGroups[name]}
            writable={writable}
            onSave={(words) => void store.saveKeywordGroups({ ...config.keywordGroups, [name]: words })}
            onDelete={() => void store.saveKeywordGroups(omitKey(config.keywordGroups, name))}
          />
        ))}
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

      {/* 协作流注册表（0.6.0 spec §7，仅 v5）：预置流可改不可删；自建流可删
          （被引用时禁用删除，store.deleteFlow 守卫兜底并上浮 error）。 */}
      {isV5 && (
        <details className="kt-flows">
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
              availability={availability}
              groupNames={groupNames}
              effortsOf={effortsOf}
              onSave={(next) => void store.saveFlows({ ...flows, [flowId]: next })}
              onDelete={() => void store.deleteFlow(flowId)}
            />
          ))}
        </details>
      )}
    </div>
  )
}

export default SettingsCard
