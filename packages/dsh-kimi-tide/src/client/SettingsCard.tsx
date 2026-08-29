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
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createCardStore } from './card-store.js'
import { Icon } from './icons.js'
import type { CardStore, ConnectionLike, SettingsScopeLike } from './card-store.js'
import { duplicateRuleIds, previewRoute, ruleConditionKey, ruleConditionSummary, ruleLabel } from '../rules.js'
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

/** imageFallback 三态的一句话后果提示（spec §7）。 */
const FALLBACK_HINTS: Record<ImageFallback, string> = {
  latch: '带图后锁定视觉模型，后续文本轮继续走视觉',
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
      <option value="">跟随默认</option>
      {stored && <option value={props.value!}>{props.value!}</option>}
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
  // 0.6.x池#7：新建协作流表单（预置流模板 + slug 化 id 去重）。
  const [newFlowId, setNewFlowId] = useState('')
  const [newFlowType, setNewFlowType] = useState<'transcribe' | 'review'>('transcribe')
  // ⑥-B：设置卡三页签（路由 / 协作流 / 测试场）——CSS 可见性切换（区块保持
  // 挂载，受控表单状态与既有测试选择器零改动）。
  const [activeTab, setActiveTab] = useState<'route' | 'flows' | 'trial'>('route')
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
      resetField: wrap('resetField'),
    }
    // store 由 useState 惰性初始化，实例恒定；flash 闭包稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    if (config.version === 5) {
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

  return (
    <div className="kimi-tide-settings" data-tab={activeTab}>
      {/* ⑥-B：三页签导航（CSS data-tab 可见性切换，区块保持挂载）。 */}
      <div className="kt-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={activeTab === 'route'}
          className={activeTab === 'route' ? 'kt-tab kt-tab-on' : 'kt-tab'}
          onClick={() => setActiveTab('route')}>路由</button>
        {isV5 && (
          <button type="button" role="tab" aria-selected={activeTab === 'flows'}
            className={activeTab === 'flows' ? 'kt-tab kt-tab-on' : 'kt-tab'}
            onClick={() => setActiveTab('flows')}>协作流</button>
        )}
        <button type="button" role="tab" aria-selected={activeTab === 'trial'}
          className={activeTab === 'trial' ? 'kt-tab kt-tab-on' : 'kt-tab'}
          onClick={() => setActiveTab('trial')}>测试场</button>
      </div>
      {snapshot.error !== null && <span className="kt-warn kt-error" role="alert"><Icon name="warn" /> {snapshot.error}</span>}
      {savedFlash && <span className="kt-saved" role="status">已保存</span>}

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
          </label>

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
              return (
                <div key={rule.id} className={`kt-rule-grid kt-rule-row${conflicted ? ' kt-conflict' : ''}${rule.when.kind === 'image' ? ' kt-row-image' : ''}`}>
                  <span className="kt-rule-no">{index + 1}</span>
                  <span className="kt-cond">
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
                  {conflicted && (
                    <span className="kt-conflict-hint">条件重复：与上方某条规则条件相同，永不优先命中</span>
                  )}
                </div>
              )
            })}
            </div>
            {ruleConflict !== null && (
              <span className="kt-warn kt-rule-conflict-msg" role="alert">{ruleConflict}</span>
            )}
            <button type="button" className="kt-btn-primary" disabled={!writable} onClick={addRule}>新增规则</button>
          </div>

          {/* 带图兜底三态（0.6.0，仅 v5）：锁存/盲答/懒转述 + 一句话后果提示；
              懒转述流选择器仅 transcribe-lazy 态渲染（缺省指向预置 transcribe）。 */}
          {isV5 && (
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
      <details className="kt-groups kt-card">
        <summary>关键词组</summary>
        {groupNames.map((name) => (
          <KeywordGroupRow
            key={name}
            name={name}
            words={config.keywordGroups[name]}
            writable={writable}
            onSave={(words) => void storeWriter.saveKeywordGroups({ ...config.keywordGroups, [name]: words })}
            onDelete={() => void storeWriter.saveKeywordGroups(omitKey(config.keywordGroups, name))}
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
              availability={availability}
              groupNames={groupNames}
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
      )}
    </div>
  )
}

export default SettingsCard
