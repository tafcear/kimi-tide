/**
 * ReasonPanel — 面板 v4 决策可观测组件（0.5.0 规则驱动路由）。
 *
 * 显示：配置来源（configSource）、本步路由决策（decision.reason），
 * 以及「实际路由：xxx（router 决策）」。预设切换入口在官方设置页「月汐」
 * 卡片。Δ 评分差行随评分面退役删除（Task 9）。
 */
import type { ConfigSource, DecisionSummary } from '../types.js'

export interface ReasonPanelProps {
  configSource: ConfigSource
  /** 本步决策摘要；无预设/尚无决策时为 null。 */
  decision: DecisionSummary | null
  /** 当前预设名；null = 路由关闭（逃生舱）。 */
  presetName: string | null
}

const SOURCE_LABELS: Record<ConfigSource, string> = {
  settings: '🛠 设置命名空间',
  sidecar: '📄 sidecar 文件',
  patch: '🩹 patch 静态块',
  default: '⚙️ 内置默认',
}

export function ReasonPanel(props: ReasonPanelProps) {
  const { configSource, decision, presetName } = props
  const source = SOURCE_LABELS[configSource] ?? configSource

  return (
    <div className="kt-reason">
      <span className="kt-h">🔭 决策可观测</span>
      <span className="kt-meta">🧰 配置来源：{source}（{configSource}）</span>
      {decision === null ? (
        <span className="kt-meta">
          🧭 实际路由：{presetName === null ? '（路由已关闭）' : '（暂无本步决策 — 尚未发生规则命中或为默认目标）'}
        </span>
      ) : (
        <>
          <span>
            🧭 实际路由：<strong>{decision.chosen.provider}/{decision.chosen.model}</strong>
            <span className="kt-meta">（router 决策）</span>
          </span>
          <span className="kt-meta">💡 原因：{decision.reason}</span>
        </>
      )}
    </div>
  )
}
