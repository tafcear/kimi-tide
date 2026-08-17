/**
 * TideDock — the 月汐 composer-dock panel. One compact row (mode toggle,
 * route chip, quota chips, local tokens, freshness), plus a <details> fold
 * with membership, reset countdowns, the router settings form, and the
 * reasoning status line. Reads 'kimi-tide/panel' via the standard-kit
 * useProjection hook; writes via remote slash commands.
 */
import { useState, type CSSProperties } from 'react'
import type { KimiTidePanelProjection } from '../types.js'

export interface TideDockProps {
  sessionId: string
  useProjection: (key: 'kimi-tide/panel') => KimiTidePanelProjection | null | undefined
  /** Remote command executor (standard kit via ctx.remote in index; passed as prop by the slot renderer is NOT
   *  available — TideDock reads it from the closure registered below). */
}

/** Wired in client/index.ts apply(): the dock component calls back into cordis ctx. */
export interface TideDockBridge {
  execute: (sessionId: string, line: string) => Promise<unknown>
}
export const tideDockBridge: TideDockBridge = { execute: async () => undefined }

function pct(used: number, limit: number): number {
  return limit > 0 ? Math.round((used / limit) * 100) : 0
}

function pctClass(p: number): string {
  if (p >= 90) return 'kt-danger'
  if (p >= 80) return 'kt-warn'
  return ''
}

function fmtClock(ts: number): string {
  if (ts <= 0) return '--:--'
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtCountdown(resetTime: string): string {
  const t = Date.parse(resetTime)
  if (!Number.isFinite(t)) return ''
  const ms = t - Date.now()
  if (ms <= 0) return '已到期'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h}h${m}m 后重置` : `${m}m 后重置`
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
      const result = await tideDockBridge.execute(props.sessionId, line) as { ok?: boolean; value?: { matched?: boolean } } | undefined
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
    return <div className="kimi-tide-dock"><span className="kt-label">🌙 月汐</span><span>面板数据加载中…</span></div>
  }

  const { quota, local, router } = panel
  const weekPct = quota === null ? 0 : pct(quota.weekly.used, quota.weekly.limit)
  const fivePct = quota === null ? 0 : pct(quota.fiveHour.used, quota.fiveHour.limit)
  const inTok = local.today.inputTokens ?? 0
  const outTok = local.today.outputTokens ?? 0
  const cacheTok = local.today.cacheReadTokens ?? 0
  const cachePct = inTok + cacheTok > 0 ? Math.round((cacheTok / (inTok + cacheTok)) * 100) : 0

  return (
    <div className="kimi-tide-dock">
      <span className="kt-label">🌙 月汐</span>

      <span role="group" aria-label="route mode">
        {(['off', 'cost', 'capability'] as const).map((m) => (
          <button
            key={m}
            disabled={busy}
            className={router.mode === m ? 'kt-active' : ''}
            onClick={() => void run(`/kimi-tide mode ${m}`)}
          >{m}</button>
        ))}
      </span>

      {router.mode !== 'off' && (
        <span style={chip}>
          {router.primary.model}
          {router.premiumBudget !== undefined && router.mode === 'cost' && ` · 预算 ${Math.round(router.premiumBudget * 100)}%`}
        </span>
      )}

      {quota === null ? (
        <span style={chip} className="kt-stale">配额不可用</span>
      ) : (
        <span style={chip} className={quota.stale ? 'kt-stale' : ''}>
          <span className={pctClass(weekPct)}>wk {weekPct}%</span>
          {' · '}
          <span className={pctClass(fivePct)}>5h {fivePct}%</span>
          {` · upd ${fmtClock(quota.fetchedAt)}`}
          {quota.stale && ' (过期)'}
        </span>
      )}

      <span style={chip}>今日 in {inTok} · out {outTok} · cache {cachePct}%</span>

      <button disabled={busy} onClick={() => void run('/kimi-tide refresh')}>刷新</button>

      <details>
        <summary>设置</summary>
        <div>
          {quota !== null && (
            <span>
              会员 {quota.membershipLevel || '未知'}
              {quota.weekly.resetTime !== '' && ` · 周配额 ${fmtCountdown(quota.weekly.resetTime)}`}
              {quota.fiveHour.resetTime !== '' && ` · 5h 窗口 ${fmtCountdown(quota.fiveHour.resetTime)}`}
            </span>
          )}
          <QuotaForm router={router} busy={busy} run={run} />
          <span>推理输出已启用（DSH 原生渲染 reasoning-delta）</span>
          {notice !== '' && <span className="kt-warn">{notice}</span>}
        </div>
      </details>
    </div>
  )
}

function QuotaForm({ router, busy, run }: {
  router: KimiTidePanelProjection['router']
  busy: boolean
  run: (line: string) => Promise<void>
}) {
  const fields: Array<{ key: string; label: string; value: string | number | boolean | undefined }> = [
    { key: 'premiumBudget', label: 'Kimi 预算占比', value: router.premiumBudget },
    { key: 'budgetWindow', label: '预算窗口', value: router.budgetWindow },
    { key: 'charsPerToken', label: '字符/token 比', value: router.charsPerToken },
    { key: 'escalateWhen.estimatedTokensGt', label: '升级 token 阈值', value: router.escalateWhen?.estimatedTokensGt },
    { key: 'primary.model', label: '主力模型', value: router.primary.model },
    { key: 'premium.model', label: 'Kimi 模型', value: router.premium.model },
    { key: 'premiumLong.model', label: '长上下文模型', value: router.premiumLong?.model },
  ]
  return (
    <>
      {fields.map((f) => (
        <label key={f.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ width: 110 }}>{f.label}</span>
          <input
            defaultValue={f.value === undefined ? '' : String(f.value)}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run(`/kimi-tide set ${f.key} ${(e.target as HTMLInputElement).value}`)
            }}
          />
        </label>
      ))}
      <span style={{ opacity: 0.7 }}>回车保存单项；模式切换用上方按钮。保存即写入 patch 文件并即时生效。</span>
    </>
  )
}
