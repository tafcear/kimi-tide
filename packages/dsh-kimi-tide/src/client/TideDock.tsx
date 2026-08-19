/**
 * TideDock — the 月汐 composer-dock panel, degraded to a read-only dashboard.
 *
 * Task 5（设置界面迁移）：路由设置表单整体迁至官方设置页「月汐」卡片
 * （settings.section，见 SettingsCard）。本 dock 只渲染只读信息 + 指引行：
 * 主行 chips（mode 徽标 / 路由 chip / 配额 / 用量 / 本地 token / decision chip）、
 * ReasonPanel 决策可观测区（configSource/decision 展示，本身只读）、推理状态行，
 * 以及一行「路由设置已迁至 设置 → 月汐」。全部写控件（mode 按钮 / 设置折叠区
 * 内的候选、评分、预算滑杆、输入框、保存按钮）已移除；仅保留主行只读侧
 * 「🔄 刷新配额」按钮（/kimi-tide refresh 重读配额数据，不写配置）。
 */
import { useState, type CSSProperties } from 'react'
import type { KimiTidePanelProjection } from '../types.js'
import { ReasonPanel } from './ReasonPanel.js'

export interface TideDockProps {
  sessionId: string
  useProjection: (key: 'kimi-tide/panel') => KimiTidePanelProjection | null | undefined
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

  const run = async (line: string) => {
    setBusy(true)
    setNotice('')
    try {
      const result = await tideDockBridge.execute(props.sessionId, line) as { ok?: boolean } | undefined
      if (result !== undefined && 'ok' in result && result.ok === false) {
        setNotice('命令通道不可用（需 dsh-api-remotes）')
      }
    } catch {
      setNotice('命令执行失败')
    } finally {
      setBusy(false)
    }
  }

  if (panel === undefined || panel === null) {
    return <div className="kimi-tide-dock"><span className="kt-label">🌙 月汐</span><span>⏳ 面板数据加载中…</span></div>
  }

  const { quota, local, router } = panel
  const weekUsedPct = quota === null ? 0 : pct(quota.weekly.used, quota.weekly.limit)
  const fiveUsedPct = quota === null ? 0 : pct(quota.fiveHour.used, quota.fiveHour.limit)
  const weekRemain = quota === null ? 0 : Math.max(0, quota.weekly.limit - quota.weekly.used)
  const fiveRemain = quota === null ? 0 : Math.max(0, quota.fiveHour.limit - quota.fiveHour.used)
  const inTok = local.today.inputTokens ?? 0
  const outTok = local.today.outputTokens ?? 0
  const cacheTok = local.today.cacheReadTokens ?? 0
  const cachePct = inTok + cacheTok > 0 ? Math.round((cacheTok / (inTok + cacheTok)) * 100) : 0

  return (
    <div className="kimi-tide-dock">
      <span className="kt-label">🌙 月汐</span>

      <span style={chip} title="当前路由模式">📡 {router.mode}</span>

      {router.mode !== 'off' && (
        <span style={chip}>
          ⚡ {router.primary.model}
          {router.mode === 'cost' && router.premiumBudget !== undefined && ` · 💰 ${Math.round(router.premiumBudget * 100)}%`}
        </span>
      )}

      {panel.decision !== null && (
        <span style={chip} className="kt-decision-chip" title={`Δ ${panel.decision.scoreDelta ?? '—'}`}>
          🧭 {panel.decision.chosen.model} · {panel.decision.reason}
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

      <span style={chip}>📥 {inTok} · 📤 {outTok} · 💾 {cachePct}%</span>

      <button disabled={busy} title="刷新配额" onClick={() => void run('/kimi-tide refresh')}>🔄</button>

      <ReasonPanel configSource={panel.configSource} decision={panel.decision} mode={router.mode} />

      <span className="kt-meta">✨ 推理输出已启用（DSH 原生渲染 reasoning-delta）</span>
      <span className="kt-hint">路由设置已迁至 设置 → 月汐</span>
      {notice !== '' && <span className="kt-warn">⚠️ {notice}</span>}
    </div>
  )
}
