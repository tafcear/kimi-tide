/**
 * KimiView — the Kimi tab content. Selects one of the current session's
 * kimi sessions (left list) and observes it (right detail): status, prompt,
 * streamed transcript, final answer, exit code, duration.
 *
 * Props are hand-typed to the framework standard kit members this component
 * reads (sessionId, useProjection); the slot renderer passes the full kit.
 * Selection is component-local state (viewing state; resets on tab switch to
 * the latest session — acceptable for v1).
 */

import { useMemo, useState, type CSSProperties } from 'react'
import type { AgentLoopStep, KimiSessionsProjection, KimiSessionView } from '../types.js'

export interface KimiViewProps {
  /** The framework-resolved current session id. */
  sessionId: string
  /** Key-addressed projection reader (standard kit). */
  useProjection: (key: 'kimi/sessions') => KimiSessionsProjection | undefined
}

const STATUS_LABEL: Record<KimiSessionView['status'], string> = {
  queued: '排队中',
  running: '运行中',
  done: '已完成',
  error: '失败',
  aborted: '已中止',
}

const STATUS_COLOR: Record<KimiSessionView['status'], string> = {
  queued: 'var(--dsw-alias-label-dimmed, #8b93a7)',
  running: 'var(--dsw-alias-brand-primary, #4d6bfe)',
  done: 'var(--dsw-alias-success-strong, #2fbf71)',
  error: 'var(--dsw-alias-danger-strong, #e5484d)',
  aborted: 'var(--dsw-alias-label-dimmed, #8b93a7)',
}

const MONO: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    gap: 12,
    height: '100%',
    width: '100%',
    padding: 12,
    boxSizing: 'border-box' as const,
    minHeight: 0,
    overflow: 'hidden' as const,
  },
  list: {
    width: 260,
    flexShrink: 0,
    overflowY: 'auto' as const,
    overscrollBehavior: 'contain' as const,
    borderRight: '1px solid var(--dsw-alias-border-l, #e4e7ee)',
    paddingRight: 8,
    // The composer seat floats absolutely over this view (composer-overlay
    // contract): reserve room so the last item can scroll above it.
    paddingBottom: 'calc(var(--dsh-composer-height, 152px) + 16px)',
  },
  item: {
    padding: '8px 10px',
    borderRadius: 8,
    cursor: 'pointer',
    marginBottom: 4,
  },
  itemSelected: {
    background: 'var(--dsw-alias-interactive-bg-hover-accent, rgba(77,107,254,0.12))',
  },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
  },
  detail: {
    flex: 1,
    minWidth: 0,
    overflowY: 'auto' as const,
    overscrollBehavior: 'contain' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    paddingBottom: 'calc(var(--dsh-composer-height, 152px) + 16px)',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
  },
  meta: {
    fontSize: 12,
    color: 'var(--dsw-alias-label-dimmed, #8b93a7)',
    lineHeight: 1.7,
  },
  block: {
    border: '1px solid var(--dsw-alias-border-l, #e4e7ee)',
    borderRadius: 8,
    padding: '8px 10px',
    background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06))',
  },
  blockTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--dsw-alias-label-dimmed, #8b93a7)',
    marginBottom: 4,
  },
  empty: {
    color: 'var(--dsw-alias-label-dimmed, #8b93a7)',
    fontSize: 13,
    padding: 24,
    textAlign: 'center' as const,
  },
  turnSep: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 11,
    color: 'var(--dsw-alias-label-dimmed, #8b93a7)',
    margin: '6px 0',
  },
  turnLine: { flex: 1, borderTop: '1px solid var(--dsw-alias-border-l, #e4e7ee)' },
  msg: {
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: '4px 0',
  },
  toolCard: {
    border: '1px solid var(--dsw-alias-border-l, #e4e7ee)',
    borderRadius: 6,
    margin: '4px 0',
    background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06))',
  },
  toolHeader: { fontSize: 12, fontWeight: 600, padding: '4px 8px', cursor: 'pointer' },
  toolBody: { padding: '0 8px 8px' },
  exitBadge: {
    display: 'inline-block',
    fontSize: 11,
    padding: '0 6px',
    borderRadius: 4,
    marginLeft: 6,
    background: 'var(--dsw-alias-bg-skeleton, rgba(127,127,127,0.15))',
  },
  reasoning: {
    fontSize: 12,
    color: 'var(--dsw-alias-label-dimmed, #8b93a7)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  loopError: {
    fontSize: 12,
    color: 'var(--dsw-alias-danger-strong, #e5484d)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  tab: {
    fontSize: 12,
    padding: '3px 10px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l, #e4e7ee)',
    background: 'transparent',
    color: 'var(--dsw-alias-label-dimmed, #8b93a7)',
    cursor: 'pointer',
  },
  tabActive: {
    color: 'var(--dsw-alias-label-primary, #2b3245)',
    background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.1))',
  },
}

/** Relative time, zh-CN short form. */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const s = Math.max(0, Math.floor(diff / 1000))
  if (s < 60) return `${s}秒前`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  return new Date(ts).toLocaleString()
}

function SessionMeta({ session }: { session: KimiSessionView }) {
  const lines = [
    `id: ${session.id}${session.kimiId === undefined ? '' : ` (kimi ${session.kimiId})`}`,
    ...(session.kind === 'steer' && session.parent !== undefined ? [`steer of: ${session.parent}`] : []),
    `cwd: ${session.cwd}`,
    ...(session.model === undefined ? [] : [`model: ${session.model}`]),
    `created: ${new Date(session.createdAt).toLocaleString()}${session.durationMs === undefined ? '' : ` · duration: ${(session.durationMs / 1000).toFixed(1)}s`}`,
    ...(session.exitCode === undefined ? [] : [`exit: ${String(session.exitCode)}`]),
    ...(session.error === undefined ? [] : [`error: ${session.error}`]),
  ]
  return <div style={styles.meta}>{lines.join('\n')}</div>
}

/** One step of the agent loop, rendered in a waterfall. */
function LoopStepView({ step }: { step: AgentLoopStep }) {
  switch (step.kind) {
    case 'turn_start':
      return (
        <div style={styles.turnSep}>
          <span>— turn start —</span>
          <span style={styles.turnLine} />
        </div>
      )
    case 'turn_end':
      return (
        <div style={styles.turnSep}>
          <span style={styles.turnLine} />
          <span>— turn end —</span>
        </div>
      )
    case 'message':
      return <div style={styles.msg}>{step.text ?? ''}</div>
    case 'reasoning':
      return (
        <details>
          <summary style={{ ...styles.toolHeader, color: 'var(--dsw-alias-label-dimmed, #8b93a7)' }}>reasoning</summary>
          <div style={{ ...styles.toolBody, ...styles.reasoning }}>{step.text ?? ''}</div>
        </details>
      )
    case 'tool': {
      const failed = step.status === 'failed'
      const duration = step.startedAt !== undefined && step.completedAt !== undefined
        ? ` · ${((step.completedAt - step.startedAt) / 1000).toFixed(1)}s`
        : ''
      const marker = step.truncated === true ? ' · truncated' : ''
      return (
        <div style={styles.toolCard}>
          <details open={failed}>
            <summary style={styles.toolHeader}>
              {step.status === 'running' ? '▶' : failed ? '✕' : '↩'} {step.tool ?? 'tool'}
              <span style={styles.exitBadge}>
                {step.status ?? 'pending'}{duration}{marker}
                {step.exitCode !== undefined && step.exitCode !== null ? ` · exit ${String(step.exitCode)}` : ''}
              </span>
            </summary>
            {step.argsPreview !== undefined && <div style={{ ...styles.toolBody, ...MONO }}>args: {step.argsPreview}</div>}
            <div style={{ ...styles.toolBody, ...MONO }}>{step.outputPreview ?? '（空输出）'}</div>
          </details>
        </div>
      )
    }
    case 'error':
      return <div style={styles.loopError}>✕ {step.error ?? 'error'}</div>
  }
}

/** The bounded agent-loop waterfall (default Activity view). */
function LoopBlock({ loop, meta }: { loop: readonly AgentLoopStep[]; meta: import('../types.js').AgentLoopMeta | undefined }) {
  if (loop.length === 0) return null
  const dropped = meta !== undefined && meta.droppedSteps > 0
    ? `（此前 ${meta.droppedSteps} 步未保留）`
    : ''
  return (
    <div style={styles.block}>
      <div style={styles.blockTitle}>Agent Loop{dropped}</div>
      {loop.map(step => <LoopStepView key={step.seq} step={step} />)}
    </div>
  )
}

export function KimiView(props: KimiViewProps) {
  const projection = props.useProjection('kimi/sessions')
  const sessions = projection?.sessions ?? []
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [detailMode, setDetailMode] = useState<'activity' | 'text'>('activity')
  const selected = useMemo(() => {
    if (sessions.length === 0) return undefined
    const byId = selectedId === undefined ? undefined : sessions.find(s => s.id === selectedId)
    return byId ?? sessions[sessions.length - 1]
  }, [sessions, selectedId])

  if (sessions.length === 0) {
    return (
      <div data-conversation-composer-overlay=""
        style={{ ...styles.root, justifyContent: 'center', alignItems: 'center', paddingBottom: 'calc(var(--dsh-composer-height, 152px) + 16px)' }}>
        <div style={styles.empty}>
          当前 session 还没有 kimi session。
          <br />
          agent 可调用 call_kimi 发起（mode=&quot;async&quot; 并行 / mode=&quot;block&quot; 阻塞）。
        </div>
      </div>
    )
  }

  return (
    <div data-conversation-composer-overlay="" style={styles.root}>
      <div style={styles.list}>
        {sessions.map(session => (
          <div
            key={session.id}
            style={{ ...styles.item, ...(selected?.id === session.id ? styles.itemSelected : {}) }}
            onClick={() => setSelectedId(session.id)}
            title={session.prompt.slice(0, 200)}
          >
            <div style={styles.itemRow}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: STATUS_COLOR[session.status], display: 'inline-block' }} />
              <span style={{ fontWeight: 600 }}>{session.id}</span>
            </div>
            <div style={{ ...styles.meta, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {session.prompt.slice(0, 40)}{session.prompt.length > 40 ? '…' : ''}
            </div>
            {session.kind === 'steer' && session.parent !== undefined && (
              <div style={{ ...styles.meta, marginTop: 2, paddingLeft: 10 }}>
                ↳ steer of {session.parent}
              </div>
            )}
            <div style={{ ...styles.meta, marginTop: 2 }}>
              {STATUS_LABEL[session.status]} · {relativeTime(session.createdAt)}
            </div>
          </div>
        ))}
      </div>

      {selected === undefined ? null : (
        <div style={styles.detail}>
          <div style={styles.badge}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: STATUS_COLOR[selected.status], display: 'inline-block' }} />
            {selected.id} — {STATUS_LABEL[selected.status]}
          </div>
          <SessionMeta session={selected} />
          <div style={styles.block}>
            <div style={styles.blockTitle}>提示词 (prompt)</div>
            <div style={MONO}>{selected.prompt}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {(['activity', 'text'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setDetailMode(mode)}
                style={{
                  ...styles.tab,
                  ...(detailMode === mode ? styles.tabActive : {}),
                }}
              >
                {mode === 'activity' ? 'Activity' : 'Text'}
              </button>
            ))}
          </div>
          {detailMode === 'activity' ? (
            <LoopBlock loop={selected.loop ?? []} meta={selected.loopMeta} />
          ) : (
            <>
              <div style={styles.block}>
                <div style={styles.blockTitle}>输出 (transcript)</div>
                <div style={MONO}>{selected.transcript.length === 0 ? '（暂无输出）' : selected.transcript}</div>
              </div>
              {selected.answer !== undefined && (
                <div style={styles.block}>
                  <div style={styles.blockTitle}>最终回答 (answer)</div>
                  <div style={MONO}>{selected.answer}</div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
