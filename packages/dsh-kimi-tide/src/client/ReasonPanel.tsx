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
import type { CopyKey } from '../locales/index.js'
import { copy, useCopy } from './locale.js'

/**
 * 派发行摘要（Task 6）：角色/队友 → provider/model · 依据。
 * who 回退链：roleLabel > teammate > 依据词（explicit=点名 / unclaimed=未在分工表 /
 * 其余=继承）。纯函数便于单测；dock 摘要槽与本面板明细行共用同一形状，
 * 由 TideDock 转出口（定义于此而非 TideDock：避免组件互引成环）。
 *
 * §8-6 护栏形态（R8 修复轮 2）：role 目标不可用的兜底记账（basis='keep' 且带
 * roleLabel）渲染成明确的「「〈角色名〉」目标不可用 → 保持继承（实际生效目标）」
 * 文案——与无角色的普通 keep（「继承 → … · keep」）区分开，面板才能如实说出
 * 「没改道」。判据只用既有字段：不新增 basis 枚举值、不改投影 schema。
 */
export function formatDispatch(entry: DispatchEntry): string {
  if (entry.basis === 'keep' && entry.roleLabel !== undefined) {
    return copy('panel.reason.dispatchKeepRole', { 0: entry.roleLabel, 1: entry.target.provider, 2: entry.target.model })
  }
  const who = entry.roleLabel ?? entry.teammate ?? (entry.basis === 'explicit' ? copy('panel.reason.whoExplicit') : entry.basis === 'unclaimed' ? copy('panel.reason.whoUnclaimed') : copy('panel.reason.whoKeep'))
  return copy('panel.reason.dispatchLine', { 0: who, 1: entry.target.provider, 2: entry.target.model, 3: entry.basis })
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

// 配置来源标签（W2 locale 化）：模块级只存「键」（模块加载时没有语言概念），渲染处 t(key) 取值。
const SOURCE_KEYS: Record<ConfigSource, CopyKey> = {
  settings: 'panel.reason.sourceSettings',
  // 评审 P3/C7：平实措辞——原键仍经下方（{configSource}）括注保留供排障。
  sidecar: 'panel.reason.sourceSidecar',
  patch: 'panel.reason.sourcePatch',
  default: 'panel.reason.sourceDefault',
}

export function ReasonPanel(props: ReasonPanelProps) {
  // 文案经 useCopy() 取当前语言；语言切换由 locale 订阅触发重渲染
  //（模块级 formatDispatch 等非组件上下文仍用 copy()）。
  const t = useCopy()
  const { configSource, decision, presetName, lastFlowEvent, dispatch } = props
  const sourceKey = SOURCE_KEYS[configSource] as CopyKey | undefined
  const source = sourceKey === undefined ? configSource : t(sourceKey)

  return (
    <div className="kt-reason">
      <span className="kt-h">{t('panel.reason.title')}</span>
      <span className="kt-meta">{t('panel.reason.configSource', { 0: source, 1: configSource })}</span>
      {decision === null ? (
        <span className="kt-meta">
          {t('panel.reason.actualRoute')}{presetName === null ? t('panel.reason.routeOff') : t('panel.reason.noDecision')}
        </span>
      ) : (
        <>
          <span>
            {t('panel.reason.actualRoute')}<strong>{decision.chosen.provider}/{decision.chosen.model}</strong>
            <span className="kt-meta">{t('panel.reason.routerDecision')}</span>
          </span>
          {/* decision.reason 是宿主侧拼好的中文串（/api/kimi-tide/panel 数据），原样透传。 */}
          <span className="kt-meta">{t('panel.reason.reason', { 0: decision.reason })}</span>
        </>
      )}
      {/* 0.6.x 池#1：流执行事件行（投影 v6 lastFlowEvent，推送侧 ≤120 截断）。宿主数据，透传。 */}
      {lastFlowEvent !== undefined && <span className="kt-meta">{t('panel.reason.lastFlowEvent', { 0: lastFlowEvent })}</span>}
      {/* Task 6：派发明细，照上行「最近流事件」行式逐行渲染；台账侧已收口 20 条
          且新在前，slice(0, 20) 是客户端兜底（绕校验的实时载荷也至多 20 行）。
          终审 M8②：明细行用稳定键（at + 归属标签组合），不再用数组下标。 */}
      {dispatch !== undefined && dispatch.length > 0 && (
        <>
          <span className="kt-h">{t('panel.reason.dispatchSection')}</span>
          {dispatch.slice(0, 20).map((entry) => (
            <span key={`${entry.at}:${entry.roleLabel ?? entry.teammate ?? entry.basis}`} className="kt-meta">{t('panel.reason.dispatchRow', { 0: formatDispatch(entry) })}</span>
          ))}
        </>
      )}
    </div>
  )
}
