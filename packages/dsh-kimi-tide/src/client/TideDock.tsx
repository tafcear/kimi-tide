/**
 * TideDock — the 月汐 composer-dock panel, degraded to a read-only dashboard.
 *
 * Task 5（设置界面迁移）：路由设置表单整体迁至官方设置页「月汐」卡片
 * （settings.section，见 SettingsCard）。本 dock 只渲染只读信息：
 * 主行 chips（预设 chip / 默认模型 chip / kimi 接入指引 / 配额 / 决策 chip）。
 * 布局（2026-08-20 用户裁定）：紧凑单行——ReasonPanel 决策可观测区默认
 * 折叠（有决策时点 🧭 chip 展开/收起），「推理输出已启用」与「路由设置
 * 已迁至 设置 → 月汐」两条静态提示并入 🌙 标签的 hover tooltip。
 * 全部写控件已移除；仅保留主行只读侧「🔄 刷新配额」按钮
 * （/kimi-tide refresh 重读配额数据，不写配置）。
 * 0.5.0（Task 9）：v4 视图——📡 显示当前预设名（无预设=「关闭」），
 * ⚡ 显示预设默认模型（activePreset 为 null 时不渲染）；💰 premiumBudget
 * 段与决策 chip 的 Δ scoreDelta 随评分面退役删除。
 */
import { useState, type CSSProperties } from 'react'
import type { KimiTidePanelProjection } from '../types.js'
import { ReasonPanel } from './ReasonPanel.js'

export interface TideDockProps {
  sessionId: string
  useProjection: (key: 'kimi-tide/panel') => KimiTidePanelProjection | null | undefined
  /** 测试缝/深链：初始即展开决策可观测区（默认折叠，点 🧭 chip 展开）。 */
  defaultExpanded?: boolean
}

/** Wired in client/index.ts apply(): the dock component calls back into cordis ctx. */
export interface TideDockBridge {
  execute: (sessionId: string, line: string) => Promise<unknown>
}
export const tideDockBridge: TideDockBridge = { execute: async () => undefined }

function pct(used: number, limit: number): number {
  return limit > 0 ? Math.round((used / limit) * 100) : 0
}

/** Color by USAGE percentage: hot when little remains. */
function pctClass(usedPct: number): string {
  if (usedPct >= 90) return 'kt-danger'
  if (usedPct >= 80) return 'kt-warn'
  return ''
}

function fmtClock(ts: number): string {
  if (ts <= 0) return '--:--'
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const chip: CSSProperties = { whiteSpace: 'nowrap' }

export function TideDock(props: TideDockProps) {
  const panel = props.useProjection('kimi-tide/panel')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  // 决策可观测区默认折叠（紧凑单行布局）；有决策时点 🧭 chip 展开。
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? false)

  const run = async (line: string) => {
    setBusy(true)
    setNotice('')
    try {
      const result = await tideDockBridge.execute(props.sessionId, line) as
        | { ok?: boolean; message?: string; error?: unknown }
        | undefined
      if (result !== undefined && 'ok' in result && result.ok === false) {
        // rc.8 命令 RPC 失败形态：error/result 字段可读时展示原文，否则提示通道。
        const detail = (result as { error?: { message?: string } }).error?.message
          ?? (result as { message?: string }).message
        setNotice(detail !== undefined ? `命令执行失败：${detail}` : '命令通道不可用（需 dsh-api-remotes）')
      }
    } catch (error) {
      console.error('kimi-tide dock execute failed:', error)
      setNotice(`命令执行失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  if (panel === undefined || panel === null) {
    return <div className="kimi-tide-dock"><span className="kt-label">🌙 月汐</span><span>⏳ 面板数据加载中…</span></div>
  }

  const { quota, router, kimi } = panel
  const weekUsedPct = quota === null ? 0 : pct(quota.weekly.used, quota.weekly.limit)
  const fiveUsedPct = quota === null ? 0 : pct(quota.fiveHour.used, quota.fiveHour.limit)
  const weekRemain = quota === null ? 0 : Math.max(0, quota.weekly.limit - quota.weekly.used)
  const fiveRemain = quota === null ? 0 : Math.max(0, quota.fiveHour.limit - quota.fiveHour.used)

  return (
    <div className="kimi-tide-dock">
      <span className="kt-label" title="✨ 推理输出已启用（DSH 原生渲染 reasoning-delta） · 路由设置已迁至 设置 → 月汐">🌙 月汐</span>

      <span style={chip} title="当前路由预设">📡 {router.presetName ?? '关闭'}</span>

      {router.activePreset !== null && (
        <span style={chip}>
          ⚡ {router.defaultTarget?.model}
        </span>
      )}

      {panel.decision !== null && (
        <button
          type="button"
          style={chip}
          className="kt-decision-chip kt-decision-toggle"
          title={`${expanded ? '收起' : '展开'}决策可观测`}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '▾' : '▸'} 🧭 {panel.decision.chosen.model} · {panel.decision.reason}
        </button>
      )}

      {(!kimi.route || !kimi.key) && (
        <span style={chip} className="kt-warn" title="缺少 kimi-coding 路由或 API key（设置 → Models 配置，apiKeyEnv 指向你的凭据）">
          ⚠️ Kimi 未接入：设置 → Models
        </span>
      )}

      {quota === null ? (
        <span style={chip} className="kt-stale">🌫️ 配额不可用</span>
      ) : (
        <span style={chip} className={quota.stale ? 'kt-stale' : ''}>
          <span className={pctClass(weekUsedPct)}>📊 周 剩{weekRemain}</span>
          {' · '}
          <span className={pctClass(fiveUsedPct)}>⏳ 5h 剩{fiveRemain}</span>
          {` · 🕐 ${fmtClock(quota.fetchedAt)}`}
          {quota.stale && ' (过期)'}
        </span>
      )}

      <button disabled={busy} title="刷新配额" onClick={() => void run('/kimi-tide refresh')}>🔄</button>

      {expanded && panel.decision !== null && (
        <ReasonPanel configSource={panel.configSource} decision={panel.decision} presetName={router.presetName} />
      )}

      {notice !== '' && <span className="kt-warn">⚠️ {notice}</span>}
    </div>
  )
}
