/**
 * SettingsCard — 官方设置页的「月汐」卡片（settings.section，id kimi-tide-router）。
 *
 * 渲染 mode 三选、候选 + 每候选评分滑杆（继承/覆盖显示）、数值区，以及高级
 * 折叠（classify.patterns / costTiers / allowedProviders 只读 + textarea 整值）。
 * 所有写操作都经 card-store 的 saveTop / saveScores 路由到 scope.set 或
 * connection.api.settings.mutate（多段 path），不经过 dock 的 import-config 通道。
 *
 * 候选/评分 UI 自包含实现（而非直接 import CandidateList/ScoreEditor）：那两个
 * 组件的写通道是 onCommand(sidecar YAML) → import-config，与设置命名空间的
 * scope/connection 写路径在架构上不兼容；本文件复用它们的展示惯例与 scores.ts
 * 的 scoreFor 基线合并逻辑。Files 清单也未授权改动那两个组件文件。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createCardStore } from './card-store.js'
import type { ConnectionLike, SettingsScopeLike } from './card-store.js'
import { configKey, DIMS, type Dim, type RouteTarget, type RouterConfigV2 } from '../config.js'
import { scoreFor } from '../scores.js'

export interface SettingsCardProps {
  scope: SettingsScopeLike | null
  connection: ConnectionLike | null
  close: () => void
}

const MODES: Array<RouterConfigV2['mode']> = ['off', 'cost', 'capability']
const MODE_LABELS: Record<RouterConfigV2['mode'], string> = {
  off: '关闭',
  cost: '省钱',
  capability: '能力',
}

const DIM_LABELS: Record<Dim, string> = {
  code: '代码',
  reasoning: '推理',
  writing: '写作',
  tooluse: '工具',
  vision: '视觉',
  longctx: '长上下文',
}

const SNAP = (v: number): number => Math.min(5, Math.max(0, Math.round(v * 2) / 2))

type NumberField = 'routeThreshold' | 'lambda' | 'premiumBudget' | 'budgetWindow' | 'charsPerToken'
const NUM_FIELDS: Array<{ field: NumberField; label: string; step: number; min: number; max: number }> = [
  { field: 'routeThreshold', label: '升级阈值', step: 0.05, min: 0, max: 1 },
  { field: 'lambda', label: 'λ 权衡', step: 0.05, min: 0, max: 1 },
  { field: 'premiumBudget', label: '预算比例', step: 0.05, min: 0, max: 1 },
  { field: 'budgetWindow', label: '预算窗口', step: 1, min: 1, max: 1000 },
  { field: 'charsPerToken', label: '每 token 字符', step: 0.5, min: 0.5, max: 10 },
]

/** 把 default + candidates 去重成评分目标列表。 */
function scoreTargets(config: RouterConfigV2): RouteTarget[] {
  const out: RouteTarget[] = []
  const seen = new Set<string>()
  for (const target of [config.default, ...config.candidates]) {
    const key = configKey(target)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(target)
  }
  return out
}

/** 高级折叠区的一段 JSON 文本域：只读摘要 + textarea 整值保存。 */
function JsonField(props: {
  label: string
  value: unknown
  writable: boolean
  onSave: (parsed: unknown) => void
}) {
  const { label, value, writable, onSave } = props
  const [draft, setDraft] = useState(() => JSON.stringify(value ?? {}, null, 2))

  const save = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft)
    } catch {
      return
    }
    onSave(parsed)
  }

  return (
    <div className="kt-row kt-json">
      <span className="kt-field-label">{label}</span>
      <textarea
        aria-label={label}
        disabled={!writable}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button type="button" disabled={!writable} onClick={save}>保存</button>
    </div>
  )
}

export function SettingsCard(props: SettingsCardProps) {
  const { scope, connection } = props
  const [store] = useState(() => createCardStore(scope, connection))
  // connection 路径是异步 describe：mount 后拉一次（scope 路径已在创建时同步读入）。
  useEffect(() => {
    void store.load()
  }, [store])

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const config = snapshot.config

  if (config === null) {
    return (
      <div className="kimi-tide-settings">
        <span className="kt-hint">⚙️ 路由设置不可用</span>
      </div>
    )
  }

  const writable = snapshot.writable
  const targets = scoreTargets(config)

  return (
    <div className="kimi-tide-settings">
      <div className="kt-mode-row">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={m === config.mode ? 'kt-mode kt-active' : 'kt-mode'}
            aria-pressed={m === config.mode}
            disabled={!writable}
            onClick={() => void store.saveTop('mode', m)}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      <div className="kt-candidates">
        <span className="kt-h">🧩 候选模型（0–5 步长 0.5）</span>
        {targets.map((target) => {
          const key = configKey(target)
          const effective = scoreFor(config, target)
          const isDefault = target.provider === config.default.provider && target.model === config.default.model
          return (
            <div key={key} className="kt-candidate">
              <span className="kt-meta">
                {key}
                {isDefault ? '（默认）' : ''}
              </span>
              <div className="kt-score-grid">
                {DIMS.map((dim) => {
                  const overridden = typeof snapshot.user?.scores?.[key]?.[dim] === 'number'
                  return (
                    <label key={dim} className="kt-score-row">
                      <span className="kt-field-label">{DIM_LABELS[dim]}</span>
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={0.5}
                        value={effective[dim]}
                        disabled={!writable}
                        onChange={(e) => void store.saveScores(key, dim, SNAP(Number(e.target.value)))}
                      />
                      <span className="kt-score-values">
                        <span className={overridden ? 'kt-score-override' : 'kt-score-baseline'}>
                          {overridden ? `覆盖 ${effective[dim].toFixed(1)}` : `继承 ${effective[dim].toFixed(1)}`}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="kt-grid">
        {NUM_FIELDS.map(({ field, label, step, min, max }) => (
          <label key={field} className="kt-row">
            <span className="kt-field-label">{label}</span>
            <input
              type="number"
              step={step}
              min={min}
              max={max}
              value={config[field]}
              disabled={!writable}
              onChange={(e) => void store.saveTop(field, Number(e.target.value))}
            />
          </label>
        ))}
      </div>

      <details className="kt-advanced">
        <summary>高级</summary>
        <JsonField
          label="classify.patterns"
          value={config.classify?.patterns ?? {}}
          writable={writable}
          onSave={(parsed) => void store.saveTop('classify', { ...config.classify, patterns: parsed })}
        />
        <JsonField
          label="costTiers"
          value={config.costTiers}
          writable={writable}
          onSave={(parsed) => void store.saveTop('costTiers', parsed)}
        />
        <JsonField
          label="allowedProviders"
          value={config.allowedProviders}
          writable={writable}
          onSave={(parsed) => void store.saveTop('allowedProviders', parsed)}
        />
      </details>
    </div>
  )
}

export default SettingsCard
