/**
 * ReasonPanel — 面板 v3 决策可观测组件（Task 10 / Step 3）。
 *
 * 显示：配置来源（configSource）、本步路由决策（decision.reason/scoreDelta），
 * 以及「实际路由：xxx（router 决策）」。模式切换入口保留在主行（见 TideDock）。
 */
import type { ConfigSource, DecisionSummary } from '../types.js'

export interface ReasonPanelProps {
  configSource: ConfigSource
  /** 本步决策摘要；off/keep 或尚无决策时为 null。 */
  decision: DecisionSummary | null
  mode: 'off' | 'cost' | 'capability'
}

const SOURCE_LABELS: Record<ConfigSource, string> = {
  sidecar: '📄 sidecar 文件',
  patch: '🩹 patch 静态块',
  default: '⚙️ 内置默认',
}

export function ReasonPanel(props: ReasonPanelProps) {
  const { configSource, decision, mode } = props
  const source = SOURCE_LABELS[configSource] ?? configSource

  return (
    <div className="kt-reason">
      <span className="kt-h">🔭 决策可观测</span>
      <span className="kt-meta">🧰 配置来源：{source}（{configSource}）</span>
      {decision === null ? (
        <span className="kt-meta">
          🧭 实际路由：{mode === 'off' ? '（路由已关闭）' : '（暂无本步决策 — 尚未发生能力路由或为 keep）'}
        </span>
      ) : (
        <>
          <span>
            🧭 实际路由：<strong>{decision.chosen.provider}/{decision.chosen.model}</strong>
            <span className="kt-meta">（router 决策）</span>
          </span>
          <span className="kt-meta">💡 原因：{decision.reason}</span>
          {decision.scoreDelta !== null && (
            <span className="kt-meta">Δ 评分差：{decision.scoreDelta}</span>
          )}
        </>
      )}
    </div>
  )
}
