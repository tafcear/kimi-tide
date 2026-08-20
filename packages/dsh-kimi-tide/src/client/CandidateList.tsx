/**
 * CandidateList — 面板 v3 候选管理组件（Task 10 / Step 1）。
 *
 * 渲染 RouterConfigV3 的候选池：每行一对 provider/model 下拉（选项来自
 * projection.models 全量）、「默认」单选、不可用候选标灰，以及增/删行。
 *
 * 命令面（Task 9）的 SETTABLE_KEYS 没有 candidates 键，因此增删改走简报
 * 约定的「set 表达式占位」：本组件把每一行的结构变更翻译成一段 sidecar YAML
 * 文本，交给宿主的 import-config 通道一次性落盘（保持命令面最小，不扩
 * SETTABLE_KEYS）。具体的往返由 TideDock 的 onCommand 回调承载。
 */
import { useState } from 'react'
import type { CandidateSummary } from '../types.js'
import type { RouteTarget } from '../config.js'

export interface CandidateListProps {
  /** 候选池摘要（projection.candidates）。 */
  candidates: CandidateSummary[]
  /** 当前默认路由目标（router.default → v1 视图 primary）。 */
  defaultTarget: RouteTarget
  /** 可选模型全量（projection.models 合并去重）。 */
  modelOptions: string[]
  busy: boolean
  /** 结构变更回调：携带一段 sidecar YAML 文本，由宿主经 import-config 落盘。 */
  onCommand: (sidecarText: string) => void
}

const PROVIDER_OPTIONS = ['kimi-coding', 'deepseek-official']

function sameTarget(a: RouteTarget, b: RouteTarget): boolean {
  return a.provider === b.provider && a.model === b.model
}

/** 把候选池 + 默认目标渲染成最小 sidecar YAML（仅本组件可观测的字段）。 */
export function candidatesToSidecar(candidates: RouteTarget[], defaultTarget: RouteTarget): string {
  const lines: string[] = ['version: 3', 'default:', `  provider: ${defaultTarget.provider}`, `  model: ${defaultTarget.model}`, 'candidates:']
  for (const c of candidates) {
    lines.push(`  - provider: ${c.provider}`, `    model: ${c.model}`)
  }
  return lines.join('\n')
}

export function CandidateList(props: CandidateListProps) {
  const { candidates, defaultTarget, modelOptions, busy, onCommand } = props
  const [newProvider, setNewProvider] = useState(PROVIDER_OPTIONS[0])
  const [newModel, setNewModel] = useState(modelOptions[0] ?? '')

  const emit = (next: CandidateSummary[], nextDefault: RouteTarget) => {
    onCommand(candidatesToSidecar(next.map(({ provider, model }) => ({ provider, model })), nextDefault))
  }

  const setDefault = (row: CandidateSummary) => {
    emit(candidates, { provider: row.provider, model: row.model })
  }

  const removeRow = (index: number) => {
    const removed = candidates[index]
    const next = candidates.filter((_, i) => i !== index)
    // 删除默认行时，把默认回退到剩余第一行（若有）。
    const nextDefault = sameTarget(removed, defaultTarget) && next.length > 0
      ? { provider: next[0].provider, model: next[0].model }
      : defaultTarget
    emit(next, nextDefault)
  }

  const changeModel = (index: number, model: string) => {
    const next = candidates.map((c, i) => (i === index ? { ...c, model } : c))
    emit(next, defaultTarget)
  }

  const changeProvider = (index: number, provider: string) => {
    const next = candidates.map((c, i) => (i === index ? { ...c, provider } : c))
    emit(next, defaultTarget)
  }

  const addRow = () => {
    if (newModel === '') return
    const added: CandidateSummary = { provider: newProvider, model: newModel, available: true }
    emit([...candidates, added], defaultTarget)
  }

  return (
    <div className="kt-candidates">
      <span className="kt-h">🧩 候选模型（默认单选 · 不可用标灰）</span>
      {candidates.length === 0 && <span className="kt-meta">（暂无候选，点击下方「添加候选」）</span>}
      {candidates.map((row, i) => {
        const isDefault = sameTarget(row, defaultTarget)
        const options = row.model !== '' && !modelOptions.includes(row.model) ? [row.model, ...modelOptions] : modelOptions
        return (
          <div key={`${row.provider}/${row.model}-${i}`} className={`kt-row kt-candidate${row.available ? '' : ' kt-unavailable'}`}>
            <label className="kt-candidate-default" title="设为默认路由目标">
              <input
                type="radio"
                name="kt-default-candidate"
                checked={isDefault}
                disabled={busy}
                onChange={() => setDefault(row)}
              />
              <span>默认</span>
            </label>
            <select
              aria-label="provider"
              disabled={busy || !row.available}
              value={row.provider}
              onChange={(e) => changeProvider(i, e.target.value)}
            >
              {(PROVIDER_OPTIONS.includes(row.provider) ? PROVIDER_OPTIONS : [row.provider, ...PROVIDER_OPTIONS]).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select
              aria-label="model"
              disabled={busy || !row.available}
              value={row.model}
              onChange={(e) => changeModel(i, e.target.value)}
            >
              {options.length === 0 && <option value={row.model}>{row.model === '' ? '（无可选模型）' : row.model}</option>}
              {options.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {!row.available && <span className="kt-meta">（不可用）</span>}
            <button disabled={busy} title="删除该候选" onClick={() => removeRow(i)}>🗑️ 删除</button>
          </div>
        )
      })}

      <div className="kt-row kt-candidate-add">
        <select aria-label="new provider" disabled={busy} value={newProvider} onChange={(e) => setNewProvider(e.target.value)}>
          {PROVIDER_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select aria-label="new model" disabled={busy} value={newModel} onChange={(e) => setNewModel(e.target.value)}>
          {modelOptions.length === 0 && <option value="">（无可选模型）</option>}
          {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button disabled={busy || newModel === ''} onClick={addRow}>➕ 添加候选</button>
      </div>
    </div>
  )
}
