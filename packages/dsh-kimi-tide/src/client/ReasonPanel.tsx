/**
 * ReasonPanel — 面板 v4 决策可观测组件（0.5.0 规则驱动路由）。
 *
 * 显示：配置来源（configSource）、本步路由决策（decision.reason），
 * 以及「实际路由：xxx（router 决策）」。预设切换入口在官方设置页「月汐」
 * 卡片。Δ 评分差行随评分面退役删除（Task 9）。
 * ⑥-B 打磨（2026-08-29）：emoji 前缀退役（用户裁定语义不清），标签纯文字
 * 化；本组件由 TideDock 以 portal 悬浮层承载（不再内联推挤布局）。
 */
import type { ConfigSource, DecisionSummary } from '../types.js'
import type { DispatchEntry } from '../dispatch-ledger.js'

/**
 * 派发行摘要（Task 6）：角色/队友 → provider/model · 依据。
 * who 回退链：roleLabel > teammate > 依据词（explicit=点名 / unclaimed=未在分工表 /
 * 其余=继承）。纯函数便于单测；dock 摘要槽与本面板明细行共用同一形状，
 * 由 TideDock 转出口（定义于此而非 TideDock：避免组件互引成环）。
 */
export function formatDispatch(entry: DispatchEntry): string {
  const who = entry.roleLabel ?? entry.teammate ?? (entry.basis === 'explicit' ? '点名' : entry.basis === 'unclaimed' ? '未在分工表' : '继承')
  return `${who} → ${entry.target.provider}/${entry.target.model} · ${entry.basis}`
}

export interface ReasonPanelProps {
  configSource: ConfigSource
  /** 本步决策摘要；无预设/尚无决策时为 null。 */
  decision: DecisionSummary | null
  /** 当前预设名；null = 路由关闭（逃生舱）。 */
  presetName: string | null
  /** 0.6.x 池#1：最近流执行摘要（投影 v6 lastFlowEvent）；缺席 = 无流事件。 */
  lastFlowEvent?: string
  /**
   * Task 6：派发台账（面板 v7 dispatch，每父会话最近 20 条、新在前，倒序已在
   * 台账侧完成）。缺席/空数组 = 不渲染明细区（不造空区噪音）。
   */
  dispatch?: DispatchEntry[]
}

const SOURCE_LABELS: Record<ConfigSource, string> = {
  settings: '设置命名空间',
  // 评审 P3/C7：平实措辞——原键仍经下方（{configSource}）括注保留供排障。
  sidecar: '配置文件',
  patch: '补丁配置',
  default: '内置默认',
}

export function ReasonPanel(props: ReasonPanelProps) {
  const { configSource, decision, presetName, lastFlowEvent, dispatch } = props
  const source = SOURCE_LABELS[configSource] ?? configSource

  return (
    <div className="kt-reason">
      <span className="kt-h">决策可观测</span>
      <span className="kt-meta">配置来源：{source}（{configSource}）</span>
      {decision === null ? (
        <span className="kt-meta">
          实际路由：{presetName === null ? '（路由已关闭）' : '（暂无本步决策 — 尚未发生规则命中或为默认目标）'}
        </span>
      ) : (
        <>
          <span>
            实际路由：<strong>{decision.chosen.provider}/{decision.chosen.model}</strong>
            <span className="kt-meta">（router 决策）</span>
          </span>
          <span className="kt-meta">原因：{decision.reason}</span>
        </>
      )}
      {/* 0.6.x 池#1：流执行事件行（投影 v6 lastFlowEvent，推送侧 ≤120 截断）。 */}
      {lastFlowEvent !== undefined && <span className="kt-meta">最近流事件：{lastFlowEvent}</span>}
      {/* Task 6：派发明细，照上行「最近流事件」行式逐行渲染；台账侧已收口 20 条
          且新在前，slice(0, 20) 是客户端兜底（绕校验的实时载荷也至多 20 行）。 */}
      {dispatch !== undefined && dispatch.length > 0 && (
        <>
          <span className="kt-h">最近派发</span>
          {dispatch.slice(0, 20).map((entry, i) => (
            <span key={i} className="kt-meta">派发：{formatDispatch(entry)}</span>
          ))}
        </>
      )}
    </div>
  )
}
