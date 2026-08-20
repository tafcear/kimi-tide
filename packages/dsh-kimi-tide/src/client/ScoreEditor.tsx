/**
 * ScoreEditor — 面板 v3 能力评分编辑组件（Task 10 / Step 2）。
 *
 * 针对选中的候选渲染六维（code/reasoning/writing/tooluse/vision/longctx）
 * 滑杆，0–5、步长 0.5，并同时显示「基线分 vs 覆盖分」。
 *
 * 提交机制（简报 Step 2 裁定）：命令面 SETTABLE_KEYS 不含 scores 键，为保持
 * 命令面最小，本组件不新增 set 键 —— 滑杆只改本地 draft，点击「保存评分」时
 * 把整份 draft 序列化成一段 sidecar YAML 文本，经宿主的 import-config 通道
 * 一次性落盘生效。baseline 取自 scores.ts 的内置基线表（与 host 同源）。
 */
import { useEffect, useState } from 'react'
import { DIMS, configKey, type Dim, type RouteTarget, type RouterConfigV3 } from '../config.js'
import { scoreFor } from '../scores.js'

export interface ScoreEditorProps {
  /** 当前选中要编辑评分的候选。 */
  target: RouteTarget
  /** 已有的用户覆盖分（RouterConfigV3.scores[configKey]，可空）。 */
  overrideScores?: Partial<Record<Dim, number>>
  busy: boolean
  /** 一次性保存：携带一段 sidecar YAML 文本，由宿主经 import-config 落盘。 */
  onCommand: (sidecarText: string) => void
}

const DIM_LABELS: Record<Dim, string> = {
  code: '💻 代码',
  reasoning: '🧠 推理',
  writing: '✍️ 写作',
  tooluse: '🔧 工具',
  vision: '👁️ 视觉',
  longctx: '📜 长上下文',
}

const SNAP = (v: number): number => Math.min(5, Math.max(0, Math.round(v * 2) / 2))

/** 用默认 host 名构造一个最小 v2，只为复用 scoreFor 的基线合并逻辑。 */
function baselineFor(target: RouteTarget): Record<Dim, number> {
  const stub: RouterConfigV3 = {
    version: 2, mode: 'off', default: target, candidates: [target],
    scores: {}, classify: {}, allowedProviders: [], costTiers: {},
    routeThreshold: 0.75, lambda: 0.5, premiumBudget: 0.2, budgetWindow: 20, charsPerToken: 2,
  }
  return scoreFor(stub, target)
}

/** 把目标 + 覆盖分渲染成最小 sidecar YAML（仅 scores 段）。 */
export function scoresToSidecar(target: RouteTarget, scores: Partial<Record<Dim, number>>): string {
  const key = configKey(target)
  const lines: string[] = ['version: 2', 'scores:', `  "${key}":`]
  for (const dim of DIMS) {
    const v = scores[dim]
    if (v !== undefined) lines.push(`    ${dim}: ${v}`)
  }
  return lines.join('\n')
}

export function ScoreEditor(props: ScoreEditorProps) {
  const { target, overrideScores, busy, onCommand } = props
  const baseline = baselineFor(target)

  const [draft, setDraft] = useState<Record<Dim, number>>(() => ({
    ...baseline,
    ...(overrideScores ?? {}),
  }))

  // 切换候选或外部覆盖分变化时重置 draft。
  useEffect(() => {
    setDraft({ ...baselineFor(target), ...(overrideScores ?? {}) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey(target), JSON.stringify(overrideScores ?? {})])

  const dirty = DIMS.some((d) => draft[d] !== (overrideScores?.[d] ?? baseline[d]))

  const save = () => onCommand(scoresToSidecar(target, draft))

  return (
    <div className="kt-scores">
      <span className="kt-h">🎚️ 能力评分（{configKey(target)} · 0–5 步长 0.5）</span>
      <span className="kt-meta kt-hint">基线分为内置默认值；拖动滑杆设置覆盖分，点击「保存评分」经 import-config 一次性生效。</span>
      <div className="kt-score-grid">
        {DIMS.map((dim) => (
          <label key={dim} className="kt-row kt-score-row">
            <span className="kt-field-label">{DIM_LABELS[dim]}</span>
            <input
              type="range"
              min={0}
              max={5}
              step={0.5}
              value={draft[dim]}
              disabled={busy}
              onChange={(e) => setDraft((prev) => ({ ...prev, [dim]: SNAP(Number(e.target.value)) }))}
            />
            <span className="kt-score-values">
              <span className="kt-score-override">覆盖 {draft[dim].toFixed(1)}</span>
              <span className="kt-score-baseline kt-meta">基线 {baseline[dim].toFixed(1)}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="kt-row">
        <button disabled={busy || !dirty} onClick={save}>💾 保存评分</button>
        {dirty && <span className="kt-meta">（有未保存修改）</span>}
      </div>
    </div>
  )
}
