/**
 * TideDock — the 月汐 composer-dock panel (v3). One compact row (mode toggle,
 * route chip, quota chips, local tokens, freshness, decision chip), plus a
 * <details> fold with membership/reset countdowns, the v2 settings (候选管理 +
 * 能力评分 + 预算阈值), the ReasonPanel 决策可观测区, and the reasoning status
 * line. Reads 'kimi-tide/panel' via the standard-kit useProjection hook; writes
 * via remote slash commands.
 *
 * 面板 v3（Task 10）：保存通道已从 v1 键（primary.model/premium.model/
 * premiumLong.model/escalateWhen.estimatedTokensGt —— Task 9 已将其移出
 * SETTABLE_KEYS）迁到 v2 六键（lambda/routeThreshold/premiumBudget/
 * budgetWindow/charsPerToken/default.model）。候选结构变更与能力评分经
 * import-config（sidecar 文本）一次性落盘，保持命令面最小。
 */
import { useEffect, useState, type CSSProperties } from 'react'
import type { KimiTidePanelProjection } from '../types.js'
import type { RouteTarget } from '../config.js'
import { CandidateList } from './CandidateList.js'
import { ScoreEditor } from './ScoreEditor.js'
import { ReasonPanel } from './ReasonPanel.js'

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

const MODE_LABELS: Array<{ id: 'off' | 'cost' | 'capability'; label: string }> = [
  { id: 'off', label: '🚫 关' },
  { id: 'cost', label: '💰 省钱' },
  { id: 'capability', label: '🧠 能力' },
]

export function TideDock(props: TideDockProps) {
  const panel = props.useProjection('kimi-tide/panel')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [scoreTarget, setScoreTarget] = useState<RouteTarget | null>(null)

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

  // v2: 默认目标 = v1 视图的 primary；可选模型全量（kimi + deepseek 合并去重）。
  const defaultTarget: RouteTarget = router.primary
  const modelOptions = [...new Set([...(panel.models?.kimi ?? []), ...(panel.models?.deepseek ?? [])])]
  const effectiveScoreTarget = scoreTarget ?? defaultTarget

  return (
    <div className="kimi-tide-dock">
      <span className="kt-label">🌙 月汐</span>

      <span role="group" aria-label="route mode">
        {MODE_LABELS.map((m) => (
          <button
            key={m.id}
            disabled={busy}
            className={router.mode === m.id ? 'kt-active' : ''}
            onClick={() => void run(`/kimi-tide mode ${m.id}`)}
          >{m.label}</button>
        ))}
      </span>

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

      <details>
        <summary>⚙️ 设置</summary>
        <div className="kt-settings">
          {quota !== null && (
            <span className="kt-meta">
              💎 {quota.membershipLevel || '未知会员'}
              {quota.weekly.resetTime !== '' && ` · 🗓️ 周配额 已用 ${quota.weekly.used}/${quota.weekly.limit}（${fmtCountdown(quota.weekly.resetTime)}）`}
              {quota.fiveHour.resetTime !== '' && ` · ⏳ 5h 窗口 已用 ${quota.fiveHour.used}/${quota.fiveHour.limit}（${fmtCountdown(quota.fiveHour.resetTime)}）`}
            </span>
          )}

          <CandidateList
            candidates={panel.candidates}
            defaultTarget={defaultTarget}
            modelOptions={modelOptions}
            busy={busy}
            onCommand={(sidecarText) => void run(`/kimi-tide import-config ${sidecarText}`)}
          />

          <ScoreEditor
            target={effectiveScoreTarget}
            // 已保存覆盖分按 configKey 查表下发（final review #2）：无覆盖时
            // 缺省 → ScoreEditor 回退基线；有覆盖时滑杆初值=覆盖分，避免重开
            // 面板把已保存值看成基线初值而二次误保存。
            overrideScores={panel.candidates.find(
              (c) => `${c.provider}/${c.model}` === `${effectiveScoreTarget.provider}/${effectiveScoreTarget.model}`,
            )?.scores}
            busy={busy}
            onCommand={(sidecarText) => void run(`/kimi-tide import-config ${sidecarText}`)}
          />
          <div className="kt-row">
            <span className="kt-field-label">🎯 评分对象</span>
            <select
              aria-label="score target"
              disabled={busy}
              value={`${effectiveScoreTarget.provider}/${effectiveScoreTarget.model}`}
              onChange={(e) => {
                const [provider, ...rest] = e.target.value.split('/')
                setScoreTarget({ provider, model: rest.join('/') })
              }}
            >
              {[defaultTarget, ...panel.candidates].filter((t, i, arr) =>
                arr.findIndex((x) => x.provider === t.provider && x.model === t.model) === i,
              ).map((t) => (
                <option key={`${t.provider}/${t.model}`} value={`${t.provider}/${t.model}`}>
                  {t.provider}/{t.model}
                </option>
              ))}
            </select>
          </div>

          <span className="kt-h">💰 预算与阈值（v2）</span>
          <div className="kt-grid">
            <BudgetSlider
              value={router.premiumBudget}
              busy={busy}
              onCommit={(v) => void run(`/kimi-tide set premiumBudget ${v}`)}
            />
            <NumberField label="🪟 预算窗口" value={router.budgetWindow} busy={busy} onCommit={(v) => void run(`/kimi-tide set budgetWindow ${v}`)} />
            <NumberField label="🔤 字符/token" value={router.charsPerToken} busy={busy} onCommit={(v) => void run(`/kimi-tide set charsPerToken ${v}`)} />
          </div>

          <ReasonPanel configSource={panel.configSource} decision={panel.decision} mode={router.mode} />

          <span className="kt-meta">✨ 推理输出已启用（DSH 原生渲染 reasoning-delta）</span>
          {notice !== '' && <span className="kt-warn">⚠️ {notice}</span>}
          <span className="kt-meta kt-hint">💾 滑杆松手或回车即保存；候选与评分经 import-config 一次性落盘并即时生效。</span>
        </div>
      </details>
    </div>
  )
}

/** Percentage slider + synced number box; commits 0..1 on release/Enter/blur. */
function BudgetSlider({ value, busy, onCommit }: {
  value: number | undefined
  busy: boolean
  onCommit: (ratio: number) => void
}) {
  const initial = value ?? 0.2
  const [draftPct, setDraftPct] = useState(Math.round(initial * 100))
  // 外部 premiumBudget 变化（CLI set / import-config / 另一会话保存）时同步
  // 滑杆——0.2.x 原行为；draft 编辑中被覆盖是与原行为一致的可接受代价。
  useEffect(() => setDraftPct(Math.round((value ?? 0.2) * 100)), [value])
  const commit = () => onCommit(Math.min(100, Math.max(0, draftPct)) / 100)
  return (
    <label className="kt-row kt-budget">
      <span className="kt-field-label">💰 Kimi 预算占比</span>
      <input
        type="range" min={0} max={100} step={5}
        value={draftPct}
        disabled={busy}
        onChange={(e) => setDraftPct(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={(e) => { if (e.key.startsWith('Arrow')) commit() }}
      />
      <input
        type="number" min={0} max={100} step={5} className="kt-num"
        value={draftPct}
        disabled={busy}
        onChange={(e) => setDraftPct(Number(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
        onBlur={commit}
      />
      <span>%</span>
    </label>
  )
}

function NumberField({ label, value, busy, onCommit }: {
  label: string
  value: number | undefined
  busy: boolean
  onCommit: (value: number) => void
}) {
  return (
    <label className="kt-row">
      <span className="kt-field-label">{label}</span>
      <input
        defaultValue={value === undefined ? '' : String(value)}
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = Number((e.target as HTMLInputElement).value)
            if (Number.isFinite(n)) onCommit(n)
          }
        }}
      />
    </label>
  )
}
