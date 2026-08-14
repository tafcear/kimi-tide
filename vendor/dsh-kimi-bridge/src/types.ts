/**
 * Shared wire types for dsh-kimi-bridge: the kimi session record, the
 * projection value, and the module augmentations that carry them (session
 * event type + projection table key). These types are consumed by both the
 * host half (append / projection unit) and the browser half (projection
 * reader), so they must stay plain JSON and never import Node or React.
 */

/** Lifecycle of one kimi session as seen by both the agent and the browser. */
export type KimiSessionStatus = 'queued' | 'running' | 'done' | 'error' | 'aborted'

/** One step of the kimi agent loop (bounded sliding window; whole-value in the record). */
export interface AgentLoopStep {
  /** Monotonic step counter within the session. */
  readonly seq: number
  readonly kind: 'turn_start' | 'turn_end' | 'message' | 'tool' | 'reasoning' | 'error'
  /** Unix epoch ms (event timestamp when present, else receive time). */
  readonly time: number
  /** message/reasoning preview text (1KB cap; full message text also lives in transcript). */
  readonly text?: string
  /** Tool name (a kimi function name). */
  readonly tool?: string
  /** Stable provider tool-call id; one tool row is upserted by this id. */
  readonly callId?: string
  readonly status?: 'running' | 'done' | 'failed'
  readonly startedAt?: number
  readonly completedAt?: number
  /** Tool arguments preview (512B cap). */
  readonly argsPreview?: string
  /** Tool output preview (1KB head+tail cap, `truncated` marks the cut). */
  readonly outputPreview?: string
  readonly exitCode?: number | null
  /** Whether any preview field was truncated. */
  readonly truncated?: boolean
  readonly error?: string
}

/** Bounded-window aggregate metadata (what was evicted / omitted). */
export interface AgentLoopMeta {
  readonly droppedSteps: number
  readonly droppedByKind: Readonly<Record<string, number>>
  readonly oversizedOutputs: number
  readonly firstRetainedSeq: number
}

/**
 * One kimi session's complete post-change state. Carried whole in both the
 * session event (`kimi/session`) and the projection value (`kimi/sessions`)
 * per the projection whole-value rule.
 */
export interface KimiSessionView {
  /** Plugin-minted stable id (`kimi-<8 hex>`); the key in every map. */
  readonly id: string
  /** The kimi CLI's own session id (from the `session.resume_hint` stream event). */
  readonly kimiId?: string
  readonly status: KimiSessionStatus
  /** The prompt sent to kimi (bounded by maxPromptChars). */
  readonly prompt: string
  /** Working root kimi ran in (kimi uses the process cwd; locked to the session cwd). */
  readonly cwd: string
  /** Model override (`-m`); absent = kimi config default. */
  readonly model?: string
  /** Unix epoch ms of creation (queued). */
  readonly createdAt: number
  /** Unix epoch ms the process actually started. */
  readonly startedAt?: number
  /** Unix epoch ms of the terminal state. */
  readonly finishedAt?: number
  /** Process exit code (present on done; null on signal death). */
  readonly exitCode?: number | null
  /** Short failure reason: spawn-failed | timeout | aborted | non-zero | signal. */
  readonly error?: string
  /** Accumulated assistant text (bounded by maxTranscriptChars; tail-truncated with a marker). */
  readonly transcript: string
  /** Final answer = the last assistant content (present on done). */
  readonly answer?: string
  readonly durationMs?: number
  /** Lifetime limit in ms for this session (0 = unlimited). */
  readonly timeoutMs: number
  /** How this record was created: a fresh ask or a steer on a parent session. */
  readonly kind?: 'ask' | 'steer'
  /** Plugin-side id of the parent kimi session this record steers (kind='steer'). */
  readonly parent?: string
  /** Bounded sliding window of the agent loop (see AgentLoopStep). */
  readonly loop: readonly AgentLoopStep[]
  /** Window aggregate metadata (evictions / oversized omissions). */
  readonly loopMeta?: AgentLoopMeta
}

/** Projection value for the `kimi/sessions` key: every kimi session of one dsh session. */
export interface KimiSessionsProjection {
  readonly sessions: readonly KimiSessionView[]
}

/** The agent-facing result of an call_kimi / kimi_status / kimi_abort call. */
export type KimiToolResult =
  | { readonly status: 'started'; readonly kimi_session_id: string; readonly session_id: string; readonly prompt_preview: string; readonly cwd: string; readonly queued_at: number; readonly parent?: string; readonly kind?: 'ask' | 'steer' }
  | { readonly status: 'completed'; readonly kimi_session_id: string; readonly answer: string; readonly exit_code: number | null; readonly duration_ms: number; readonly transcript_preview: string }
  | { readonly status: 'cancelled'; readonly kimi_session_id: string; readonly reason: string }
  | { readonly status: 'error'; readonly kimi_session_id: string; readonly error: string }
  | { readonly status: 'aborted'; readonly kimi_session_id: string }
  | { readonly status: 'not-found'; readonly kimi_session_id: string }
  | { readonly status: 'list'; readonly kimi_sessions: readonly KimiSessionView[] }

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /**
     * One kimi session's complete post-change state (whole-value rule).
     * Log-only (never model surface); the projection unit folds it.
     */
    'kimi/session': KimiSessionView
    /**
     * Retained-history eviction tombstone: the projection fold must drop
     * these kimi session ids (bounded by maxRetained).
     */
    'kimi/evict': { ids: readonly string[] }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Every kimi session of the dsh session, sorted by creation. */
    'kimi/sessions': KimiSessionsProjection
  }
}
