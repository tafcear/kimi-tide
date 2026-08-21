/**
 * SettingsCard — 官方设置页的「月汐」卡片（settings.section，id kimi-tide-router）。
 *
 * 0.5.0 预设管理器（spec §8）：预设选择行（关闭/各预设，点击即写 activePreset）
 * + 当前预设编辑器（默认模型下拉 = 全量目录、规则表 = 条件/目标/上移/下移/删除
 * + 新增规则）+ 预设操作（新建/复制/删除）+ 关键词组管理（组词表 textarea，
 * 逗号/换行分隔，新建/删除组）。
 *
 * 所有写操作都经 card-store v4 方法整段写（saveActivePreset / savePreset /
 * createPreset / deletePreset / saveKeywordGroups）路由到 scope.set 或
 * connection.api.settings.mutate，不经过 dock 的 import-config 通道。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createCardStore } from './card-store.js'
import type { CardStore, ConnectionLike, SettingsScopeLike } from './card-store.js'
import { configKey, type RouteTarget, type RouterRule, type RuleCondition } from '../config.js'

export interface SettingsCardProps {
  scope: SettingsScopeLike | null
  connection: ConnectionLike | null
  close?: () => void
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
 *  （用户裁定 2026-08-21：未接入的模型不应出现在下拉选择里）。 */
function TargetSelect(props: {
  label: string
  value: string
  options: string[]
  unavailable: boolean
  disabled: boolean
  onChange: (value: string) => void
}) {
  const known = props.options.includes(props.value)
  return (
    <span className="kt-target-wrap">
      {!known && (
        <span className="kt-unavailable kt-target-missing" title="该模型未接入（设置 → Models 挂载后出现）">
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
        {!known && <option value="" disabled>— 选择已挂载模型 —</option>}
        {props.options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </span>
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

export function SettingsCard(props: SettingsCardProps) {
  const { scope, connection } = props
  const [store] = useState(() => (props.storeFactory ?? createCardStore)(scope, connection))
  // connection 路径是异步 describe：mount 后拉一次（scope 路径已在创建时同步读入）。
  useEffect(() => {
    void store.load()
  }, [store])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const config = snapshot.config

  // hooks 纪律（2026-08-20 生产事故回归钉）：全部 useState 必须先于下方
  // `config === null` 提前返回——首帧 loading → ready 的重渲染若 hook 数变化，
  // React 直接卸载整卡（设置页「月汐」卡片空白；回归见 test/SettingsCard.dom.test.tsx）。
  const [newPresetName, setNewPresetName] = useState('')
  const [newGroupName, setNewGroupName] = useState('')

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
  const groupNames = Object.keys(config.keywordGroups)

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
          </label>

          <div className="kt-rules">
            <span className="kt-h">规则（有序，首条命中生效）</span>
            {active.rules.map((rule, index) => {
              const targetKey = configKey(rule.target)
              const missingGroup = rule.when.kind === 'keywords' && !Object.hasOwn(config.keywordGroups, rule.when.group)
              return (
                <div key={rule.id} className="kt-rule-row">
                  <select
                    aria-label="条件"
                    value={conditionValue(rule)}
                    disabled={!writable}
                    onChange={(e) => editActiveRule(index, { when: parseCondition(e.target.value) })}
                  >
                    <option value={IMAGE_VALUE}>带图</option>
                    {groupNames.map((group) => (
                      <option key={group} value={kwValue(group)}>{group}</option>
                    ))}
                    {rule.when.kind === 'keywords' && missingGroup && (
                      <option value={kwValue(rule.when.group)}>{rule.when.group}（缺失）</option>
                    )}
                  </select>
                  <TargetSelect
                    label="目标"
                    value={targetKey}
                    options={modelOptions}
                    unavailable={availability?.[targetKey] === false}
                    disabled={!writable}
                    onChange={(value) => editActiveRule(index, { target: parseTarget(value) })}
                  />
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
    </div>
  )
}

export default SettingsCard
