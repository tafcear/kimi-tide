/**
 * KimiSessionManager: per-dsh-session registry of kimi sessions, each a
 * spawned `kimi -p <prompt> --output-format stream-json` child process. Owns
 * the process lifecycle (spawn, stream parsing, settle, abort, timeout,
 * cleanup), the emit throttle (session event `kimi/session`), the concurrency
 * budget, retained-history eviction (tombstone `kimi/evict` events), and
 * restart reconciliation (stale queued/running records from a previous host
 * process are marked failed on first touch).
 *
 * Design notes (see codex-bridge-design.md §16, the Kimi counterpart):
 * - One kimi session = one fresh `kimi -p … --output-format stream-json` run.
 *   The prompt travels as an argv argument (`-p`); `--auto`/`--yolo` conflict
 *   with `-p`, so no permission flag is passed (verified: tool-using prompts
 *   proceed automatically in this setup). The child stdin is closed (ignored)
 *   so kimi can never block on it.
 * - The real `stream-json` event vocabulary (verified against kimi-code
 *   0.34.0): `role:"assistant"` with string `content` → transcript/answer
 *   (the last one is the final answer); `role:"meta"` with
 *   `type:"session.resume_hint"` → the kimi session id (the resume key).
 *   Everything else — `tool_calls`, `role:"tool"` results (which can be huge),
 *   and non-JSON stdout lines — is tool machinery noise and is ignored.
 * - Sessions are bound to their working directory: `kimi -S <id> -p …` must
 *   run from the same cwd. The plugin locks cwd to the session working
 *   directory, so resume inside one dsh session holds by construction.
 * - `settle` is the single terminal-state guard (try/finally: the slot and
 *   the settle promise are released even if the final append throws). A stop
 *   request (abort/timeout) is first-cause-wins and wins over any later exit
 *   code. A late throttled emit can never roll the UI back to a live state.
 * - Events carry the WHOLE post-change record (projection whole-value rule);
 *   durable progress updates are gated to ~1s / 4KiB of new transcript (on
 *   assistant-content arrival), while start and terminal are always emitted.
 * - The prompt is capped and REJECTED above maxPromptChars. kimi always runs
 *   in the session working directory; a session without one fails closed.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { KimiSessionsProjection, KimiSessionView } from './types.js'
import {
  buildReviewHome, defaultReviewHomeDir, realKimiHome, sanitizeText,
} from './review-home.js'

/** Resolved plugin config consumed by the manager (see src/index.ts Config). */
export interface KimiManagerConfig {
  readonly kimiPath: string
  /** Review-only home: a managed KIMI_CODE_HOME with a read-only [tools] allowlist. */
  readonly reviewOnly: boolean
  /** Source Kimi home for config/auth ('' = KIMI_CODE_HOME env, else ~/.kimi-code). */
  readonly kimiHome: string
  /** Where the managed review home lives ('' = $DSH_HOME/kimi-review-home). */
  readonly reviewHomeDir: string
  /** Hard cap on any session's timeout_ms (clamped in checkBudget). */
  readonly maxTimeoutMs: number
  readonly defaultTimeoutMs: number
  readonly maxParallel: number
  readonly maxSessionsPerSession: number
  readonly maxRetained: number
  readonly maxPromptChars: number
  readonly maxTranscriptChars: number
  /** Bounded agent-loop window (steps kept in the record/projection). */
  readonly maxLoopSteps: number
  /** Serialized-byte cap for the loop window (UTF-8). */
  readonly maxLoopBytes: number
  readonly allowedAgents: 'roots' | 'all'
  readonly killGraceMs: number
}

/** call_kimi arguments after schema validation (loose; the registry validated enums). */
export interface AskKimiArgs {
  readonly prompt: string
  readonly mode?: 'async' | 'block'
  readonly model?: string
  readonly timeout_ms?: number
  readonly kimi_session_id?: string
}

/** kimi_steer arguments: continue the parent session with a new message. */
export interface KimiSteerArgs {
  /** Plugin-side id of the settled parent kimi session to resume. */
  readonly kimi_session_id: string
  readonly prompt: string
  readonly mode?: 'async' | 'block'
  readonly model?: string
  readonly timeout_ms?: number
}

/** Reads the folded projection for one session (wired to ctx.sessionProjections in apply). */
export type SnapshotReader = (session: Session) => KimiSessionsProjection | undefined

/** One live kimi session: the record plus process/settle machinery. */
interface KimiHandle {
  agent: Agent
  record: KimiSessionView
  child: ChildProcess | null
  settled: boolean
  /** Stop reason; first request wins (abort beats a later timeout, and vice versa). */
  abortReason: 'aborted' | 'timeout' | undefined
  /** Session-disposal kill: the terminal settle skips the (dying) session append. */
  silent: boolean
  settlePromise: Promise<KimiSessionView>
  resolveSettle: (record: KimiSessionView) => void
  lastEmitAt: number
  /** transcriptBuf length at the last emit (delta threshold for throttling). */
  lastEmitChars: number
  timeoutTimer: NodeJS.Timeout | undefined
  /** SIGKILL + wedged-fallback timers from a stop request (cleared at settle). */
  stopTimers: NodeJS.Timeout[]
  transcriptBuf: string
  lastAnswer: string
  stderrTail: string[]
  loopBuf: import('./types.js').AgentLoopStep[]
  loopSeq: number
  /** callId → index in loopBuf for tool-row upserts (rebuilt after eviction). */
  toolIndex: Map<string, number>
  droppedSteps: number
  droppedByKind: Record<string, number>
  oversizedOutputs: number
}

/** Marker appended when a bounded field was truncated. */
const TRUNCATED = '\n…[truncated by dsh-kimi-bridge]…\n'

/** Durable progress emits: gated to once per second or per 4KiB of new transcript. */
const PROGRESS_EMIT_INTERVAL_MS = 1000
const PROGRESS_EMIT_DELTA_CHARS = 4 * 1024

/** Hard cap on the in-memory transcript accumulator (keeps tail; the record stays bounded). */
const MAX_TRANSCRIPT_BUF_CHARS = 256 * 1024

/** Per-step content caps for the agent loop (whole-value events must stay small). */
const LOOP_TEXT_CAP = 1024
const LOOP_ARGS_CAP = 512
const LOOP_OUTPUT_CAP = 1024

/** A stdout line longer than this is dropped incrementally (kimi tool results can be huge). */
const MAX_LINE_CHARS = 512 * 1024

/** Bound a string to at most `max` chars, keeping head and tail with a marker. */
function bounded(text: string, max: number): string {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.4)
  const tail = max - head
  return `${text.slice(0, head)}${TRUNCATED}${text.slice(-tail)}`
}

/** Resolve a promise against an AbortSignal, resolving `'cancelled'` on abort. */
function raceSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | 'cancelled'> {
  if (signal.aborted) return Promise.resolve('cancelled' as const)
  return new Promise((resolve) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      resolve('cancelled' as const)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then((value) => {
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    })
  })
}

/** The session working directory the kimi process runs in (locked to the session). */
function sessionCwd(agent: Agent): string | undefined {
  const header = (agent.session as { header?: { cwd?: string } }).header
  return header?.cwd
}

/** One `kimi -p … --output-format stream-json` stdout event (the fields this plugin reads). */
interface KimiStreamEvent {
  readonly role?: string
  readonly type?: string
  readonly content?: unknown
  readonly session_id?: string
  readonly tool_calls?: readonly unknown[]
  readonly tool_call_id?: string
  [key: string]: unknown
}

export class KimiSessionManager {
  /** dsh session id → kimi session id → handle. */
  private readonly byDshSession = new Map<string, Map<string, KimiHandle>>()
  private running = 0

  /** The KIMI_CODE_HOME the child processes run under (review home when reviewOnly). */
  private readonly kimiCodeHome: string

  constructor(
    private readonly ctx: Context,
    private readonly config: KimiManagerConfig,
    private readonly snapshotReader?: SnapshotReader,
  ) {
    // kimi-tide: only resolve the path here; the managed home itself is
    // (re)built before every spawn in startChild() so auth files that are
    // copies (Windows fallback) stay current.
    this.kimiCodeHome = this.config.reviewOnly
      ? (this.config.reviewHomeDir || defaultReviewHomeDir())
      : (this.config.kimiHome || realKimiHome())
  }

  /** Whether this agent may open kimi sessions (allowedAgents policy). */
  allowed(agent: Agent | undefined): boolean {
    if (agent === undefined) return false
    if (this.config.allowedAgents === 'all') return true
    return this.ctx.agents.roots().includes(agent)
  }

  /**
   * Open a new kimi session. Throws on budget/policy violations (the tool
   * maps the error to a result). Returns the queued record; the process
   * spawns asynchronously.
   */
  ask(agent: Agent, args: AskKimiArgs): KimiSessionView {
    this.validatePrompt('call_kimi', args.prompt)
    // Fail closed: kimi must never fall back to the host process cwd, which
    // may sit outside the session workspace.
    const cwd = sessionCwd(agent)
    if (cwd === undefined) {
      throw new Error('call_kimi: session has no working directory (session-cwd-unavailable)')
    }
    const { bucket, timeoutMs } = this.checkBudget(agent, args.timeout_ms)
    const handle = this.newHandle(agent, {
      prompt: args.prompt,
      model: args.model,
      timeoutMs,
      record: { kind: 'ask' as const, cwd },
    })
    bucket.set(handle.record.id, handle)
    this.evictRetained(bucket, agent)
    this.emit(handle)
    this.spawnKimi(handle, args)
    return handle.record
  }

  /**
   * Steer a settled kimi session: continue its session with a new message via
   * `kimi -S <session_id> -p …` (must run from the same directory). The new
   * record inherits the parent's cwd/kimiId and links back through `parent`.
   */
  steer(agent: Agent, args: KimiSteerArgs): KimiSessionView {
    this.validatePrompt('kimi_steer', args.prompt)
    // Parents may be live handles OR folded history (a post-restart record still
    // carries its kimiId), so look them up through list() — not just the bucket.
    const all = this.list(agent)
    const parent = all.find(s => s.id === args.kimi_session_id)
    if (parent === undefined) {
      throw new Error(`kimi_steer: parent-not-found (${args.kimi_session_id})`)
    }
    if (parent.status === 'queued' || parent.status === 'running') {
      throw new Error(`kimi_steer: parent-running (${args.kimi_session_id})`)
    }
    if (parent.kimiId === undefined) {
      throw new Error('kimi_steer: parent-not-resumable (missing-session-id)')
    }
    const thread = all.filter(s => s.kimiId === parent.kimiId)
    // Per-session single-flight FIRST: two concurrent resumes on one session
    // would race on the same rollout, and a running continuation is the most
    // actionable blocker for the caller.
    for (const record of thread) {
      if (record.status === 'queued' || record.status === 'running') {
        throw new Error(`kimi_steer: session-busy (${record.id})`)
      }
    }
    // A kimi session is LINEAR: resuming an old ancestor would silently skip
    // the records after it, and `parent` must name the direct predecessor, so
    // the requested parent must be the latest record on its session.
    const head = thread.at(-1)
    if (head === undefined || head.id !== parent.id) {
      throw new Error(`kimi_steer: stale-parent (session head is ${head?.id ?? 'unknown'})`)
    }
    const { bucket, timeoutMs } = this.checkBudget(agent, args.timeout_ms)
    const handle = this.newHandle(agent, {
      prompt: args.prompt,
      model: args.model ?? parent.model, // resume inherits the parent's model
      timeoutMs,
      record: {
        kind: 'steer',
        parent: parent.id,
        kimiId: parent.kimiId,
        cwd: parent.cwd,
      },
    })
    bucket.set(handle.record.id, handle)
    this.evictRetained(bucket, agent)
    this.emit(handle)
    this.spawnKimiResume(handle, args)
    return handle.record
  }

  /**
   * Block until one session settles. When `opts.killOnCancel` and the caller
   * signal aborts, the session is stopped (SIGTERM → SIGKILL) and the wait
   * resolves with its terminal record (bounded by the same fallback the stop
   * uses); otherwise `'cancelled'`.
   */
  async waitFor(
    agent: Agent,
    kimiSessionId: string,
    signal: AbortSignal,
    opts: { killOnCancel?: boolean } = {},
  ): Promise<KimiSessionView | 'cancelled'> {
    const handle = this.find(agent.session.id, kimiSessionId)
    if (handle === undefined) return Promise.resolve('cancelled' as const)
    if (handle.settled) return Promise.resolve(handle.record)
    const awaited = await raceSignal(handle.settlePromise, signal)
    if (awaited !== 'cancelled' || opts.killOnCancel !== true) return awaited
    // Caller aborted a blocking wait: stop the kimi work, then report its
    // terminal state. The bound covers the stop's own fallback settle.
    this.killGroup(handle, 'aborted')
    return new Promise<KimiSessionView | 'cancelled'>((resolve) => {
      const timer = setTimeout(() => resolve('cancelled' as const), this.config.killGraceMs + 2500)
      handle.settlePromise.then((record) => {
        clearTimeout(timer)
        resolve(record)
      })
    })
  }

  /** Abort one session (SIGTERM → SIGKILL group). Returns the terminal status. */
  abort(agent: Agent, kimiSessionId: string): 'aborted' | 'not-found' {
    const handle = this.find(agent.session.id, kimiSessionId)
    if (handle === undefined) return 'not-found'
    if (handle.settled) return handle.record.status === 'aborted' ? 'aborted' : 'not-found'
    this.killGroup(handle, 'aborted')
    return 'aborted'
  }

  /** Snapshot of every kimi session of one dsh session, oldest first (bucket + folded history). */
  list(agent: Agent): readonly KimiSessionView[] {
    this.reconcile(agent)
    const bucket = this.bucketOf(String(agent.session.id))
    const merged = new Map<string, KimiSessionView>()
    // Live buckets win; folded history (incl. records from before a restart)
    // fills in everything else.
    for (const handle of bucket.values()) merged.set(handle.record.id, handle.record)
    const folded = this.snapshotReader?.(agent.session)
    if (folded !== undefined) {
      for (const record of folded.sessions) {
        if (!merged.has(record.id)) merged.set(record.id, record)
      }
    }
    return [...merged.values()].sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Kill every session of one dsh session (session disposal cleanup). Records stay for terminal state. */
  disposeSession(dshSessionId: string): void {
    const bucket = this.byDshSession.get(dshSessionId)
    if (bucket === undefined) return
    for (const handle of bucket.values()) {
      handle.silent = true // the session is going away; skip the dying-session append
      if (!handle.settled) this.killGroup(handle, 'aborted')
    }
  }

  /** Kill everything (plugin teardown). */
  disposeAll(): void {
    for (const dshSessionId of [...this.byDshSession.keys()]) {
      this.disposeSession(dshSessionId)
    }
  }

  // ---- internals ----

  private validatePrompt(tool: string, prompt: string): void {
    if (prompt.trim().length === 0) {
      throw new Error(`${tool}: prompt must not be empty`)
    }
    // NUL would make Node throw at spawn time; reject it explicitly.
    if (prompt.includes('\u0000')) {
      throw new Error(`${tool}: prompt must not contain NUL characters`)
    }
    if (prompt.length > this.config.maxPromptChars) {
      throw new Error(`${tool}: prompt exceeds maxPromptChars (${this.config.maxPromptChars})`)
    }
  }

  /** Shared budget checks: reconcile stale records, then parallel/session caps. */
  private checkBudget(agent: Agent, timeoutMsArg?: number): { bucket: Map<string, KimiHandle>; timeoutMs: number } {
    this.reconcile(agent)
    if (this.running >= this.config.maxParallel) {
      throw new Error('kimi: maxParallel reached — kimi_abort running sessions or wait for them to finish')
    }
    const bucket = this.bucketOf(String(agent.session.id))
    const live = [...bucket.values()].filter(h => !h.settled).length
    if (live >= this.config.maxSessionsPerSession) {
      throw new Error(`kimi: maxSessionsPerSession (${this.config.maxSessionsPerSession}) reached for this session`)
    }
    const timeoutMs = Math.min(
      timeoutMsArg !== undefined ? Math.max(0, Math.floor(timeoutMsArg)) : this.config.defaultTimeoutMs,
      this.config.maxTimeoutMs,
    )
    return { bucket, timeoutMs }
  }

  /** Build a queued handle; `record` overrides seed the record (cwd/parent/kind/…). */
  private newHandle(
    agent: Agent,
    opts: { prompt: string; model?: string; timeoutMs: number; record: Partial<KimiSessionView> & { cwd: string } },
  ): KimiHandle {
    const id = `kimi-${randomBytes(4).toString('hex')}`
    let resolveSettle!: (record: KimiSessionView) => void
    const settlePromise = new Promise<KimiSessionView>((resolve) => { resolveSettle = resolve })
    return {
      agent,
      record: {
        id,
        status: 'queued',
        prompt: sanitizeText(opts.prompt), // recorded copy: strip ESC/C0 control chars
        createdAt: Date.now(),
        transcript: '',
        loop: [],
        timeoutMs: opts.timeoutMs,
        ...(opts.model === undefined ? {} : { model: opts.model }),
        ...opts.record,
      },
      child: null,
      settled: false,
      abortReason: undefined,
      silent: false,
      settlePromise,
      resolveSettle,
      lastEmitAt: 0,
      lastEmitChars: 0,
      timeoutTimer: undefined,
      stopTimers: [],
      transcriptBuf: '',
      lastAnswer: '',
      stderrTail: [],
      loopBuf: [],
      loopSeq: 0,
      toolIndex: new Map(),
      droppedSteps: 0,
      droppedByKind: {},
      oversizedOutputs: 0,
    }
  }

  private bucketOf(dshSessionId: string): Map<string, KimiHandle> {
    let bucket = this.byDshSession.get(dshSessionId)
    if (bucket === undefined) {
      bucket = new Map()
      this.byDshSession.set(dshSessionId, bucket)
    }
    return bucket
  }

  private find(dshSessionId: unknown, kimiSessionId: string): KimiHandle | undefined {
    return this.bucketOf(String(dshSessionId)).get(kimiSessionId)
  }

  /**
   * After a host restart no child process survives, so any folded record still
   * in `queued`/`running` with no live handle is stale: append an error record
   * once (idempotent — the folded state then carries the terminal marker).
   */
  private reconcile(agent: Agent): void {
    if (this.snapshotReader === undefined) return
    const folded = this.snapshotReader(agent.session)
    if (folded === undefined) return
    const bucket = this.bucketOf(String(agent.session.id))
    const now = Date.now()
    for (const record of folded.sessions) {
      if ((record.status === 'queued' || record.status === 'running') && !bucket.has(record.id)) {
        const start = record.startedAt ?? record.createdAt
        agent.session.append('kimi/session', {
          ...record,
          status: 'error',
          error: 'host_restarted',
          finishedAt: now,
          durationMs: now - start,
        })
      }
    }
  }

  /**
   * Bound the retained (settled) history per dsh session; never evict live
   * handles. Eviction is durable: a `kimi/evict` tombstone event lets the
   * projection fold drop the ids, so the browser/checkpoint/list all agree.
   */
  private evictRetained(bucket: Map<string, KimiHandle>, agent: Agent): void {
    if (bucket.size <= this.config.maxRetained) return
    const settled = [...bucket.values()]
      .filter(h => h.settled && h.record.finishedAt !== undefined)
      .sort((a, b) => (a.record.finishedAt ?? 0) - (b.record.finishedAt ?? 0))
    const evicted: string[] = []
    while (bucket.size > this.config.maxRetained && settled.length > 0) {
      const oldest = settled.shift()
      if (oldest === undefined) break
      bucket.delete(oldest.record.id)
      evicted.push(oldest.record.id)
    }
    if (evicted.length > 0) {
      agent.session.append('kimi/evict', { ids: evicted })
    }
  }

  /** Serialized UTF-8 bytes of the loop window + meta (the real budget gate). */
  private loopBytes(handle: KimiHandle): number {
    return Buffer.byteLength(JSON.stringify({ loop: handle.loopBuf, meta: this.loopMeta(handle) }), 'utf8')
  }

  private loopMeta(handle: KimiHandle): import('./types.js').AgentLoopMeta {
    return {
      droppedSteps: handle.droppedSteps,
      droppedByKind: handle.droppedByKind,
      oversizedOutputs: handle.oversizedOutputs,
      firstRetainedSeq: handle.loopBuf[0]?.seq ?? -1,
    }
  }

  /** Physically evict the oldest COMPLETED steps until both caps hold. */
  private evictLoop(handle: KimiHandle): void {
    while (handle.loopBuf.length > this.config.maxLoopSteps || this.loopBytes(handle) > this.config.maxLoopBytes) {
      let index = handle.loopBuf.findIndex(step => step.kind !== 'tool' || step.status !== 'running')
      if (index === -1) index = 0 // all running: evict the oldest anyway
      const [removed] = handle.loopBuf.splice(index, 1)
      if (removed === undefined) break
      handle.droppedSteps += 1
      handle.droppedByKind[removed.kind] = (handle.droppedByKind[removed.kind] ?? 0) + 1
    }
    handle.toolIndex.clear()
    handle.loopBuf.forEach((step, i) => {
      if (step.kind === 'tool' && step.callId !== undefined) handle.toolIndex.set(step.callId, i)
    })
  }

  /** Append one step and refresh the record's window. */
  private pushLoop(handle: KimiHandle, step: Omit<import('./types.js').AgentLoopStep, 'seq' | 'time'> & { time?: number }): void {
    handle.loopBuf.push({
      ...step,
      seq: handle.loopSeq++,
      time: step.time ?? Date.now(),
    })
    this.evictLoop(handle)
    handle.record = { ...handle.record, loop: [...handle.loopBuf], loopMeta: this.loopMeta(handle) }
  }

  /** Upsert one tool row by callId (tool_calls → role:tool updates share one row). */
  private upsertTool(
    handle: KimiHandle,
    callId: string,
    patch: Partial<import('./types.js').AgentLoopStep> & { kind?: 'tool' },
  ): void {
    const existing = handle.toolIndex.get(callId)
    if (existing !== undefined && handle.loopBuf[existing] !== undefined) {
      const current = handle.loopBuf[existing]
      handle.loopBuf[existing] = { ...current, ...patch, seq: current.seq, time: current.time }
    } else {
      handle.loopBuf.push({
        kind: 'tool',
        callId,
        seq: handle.loopSeq++,
        time: Date.now(),
        ...patch,
      } as import('./types.js').AgentLoopStep)
    }
    this.evictLoop(handle)
    handle.record = { ...handle.record, loop: [...handle.loopBuf], loopMeta: this.loopMeta(handle) }
  }

  /** Emit the current whole record as a session event. */
  private emit(handle: KimiHandle): void {
    handle.lastEmitAt = Date.now()
    handle.lastEmitChars = handle.transcriptBuf.length
    handle.agent.session.append('kimi/session', { ...handle.record })
  }

  /** Gate progress emits: at most once per second or per 4KiB of new transcript (on assistant-content arrival). */
  private maybeEmit(handle: KimiHandle): void {
    const now = Date.now()
    const delta = handle.transcriptBuf.length - handle.lastEmitChars
    if (now - handle.lastEmitAt >= PROGRESS_EMIT_INTERVAL_MS || delta >= PROGRESS_EMIT_DELTA_CHARS) {
      this.emit(handle)
    }
  }

  /** Spawn `kimi -p <prompt> --output-format stream-json`, stream stdout. */
  private spawnKimi(handle: KimiHandle, args: AskKimiArgs): void {
    this.startChild(handle, [
      '-p', args.prompt,
      '--output-format', 'stream-json',
      ...(handle.record.model === undefined ? [] : ['-m', handle.record.model]),
    ])
  }

  /** Spawn `kimi -S <session_id> -p <prompt> --output-format stream-json` (same cwd). */
  private spawnKimiResume(handle: KimiHandle, args: KimiSteerArgs): void {
    // kimi sessions are bound to their working directory; the record's cwd is
    // inherited from the parent and the process spawns there.
    this.startChild(handle, [
      '-S', handle.record.kimiId ?? '',
      '-p', args.prompt,
      '--output-format', 'stream-json',
      ...(handle.record.model === undefined ? [] : ['-m', handle.record.model]),
    ])
  }

  /** Shared child lifecycle: spawn, stream parse, settle on close. */
  private startChild(handle: KimiHandle, argv: string[]): void {
    let child: ChildProcess
    try {
      // kimi-tide: refresh the managed home before every spawn so the tools
      // allowlist and copied auth files (Windows fallback) stay current.
      if (this.config.reviewOnly) {
        buildReviewHome(this.kimiCodeHome, this.config.kimiHome || realKimiHome())
      }
      child = spawn(this.config.kimiPath, argv, {
        stdio: ['ignore', 'pipe', 'pipe'], // stdin closed: kimi must never block on it
        detached: true, // own process group so abort can kill the whole tree
        cwd: handle.record.cwd,
        env: {
          ...process.env,
          KIMI_CODE_HOME: this.kimiCodeHome,
          // Protocol pinning + privacy + background safety (see the Kimi consult).
          KIMI_CODE_NO_AUTO_UPDATE: '1',
          KIMI_DISABLE_TELEMETRY: '1',
          KIMI_DISABLE_CRON: '1',
        },
      })
    } catch {
      this.settle(handle, { status: 'error', error: 'spawn-failed' })
      return
    }
    handle.child = child
    this.running += 1
    handle.record = { ...handle.record, status: 'running', startedAt: Date.now() }
    this.emit(handle)

    child.on('error', (error) => {
      this.settle(handle, { status: 'error', error: `spawn-failed: ${error.message}` })
    })

    child.stdout?.setEncoding('utf8')
    let stdoutBuf = ''
    let oversizedDropped = 0
    child.stdout?.on('data', (chunk: string) => {
      stdoutBuf += chunk
      // A kimi tool result is a single enormous JSON line; buffering it whole
      // before parsing would be a memory DoS, so any line beyond the cap is
      // discarded incrementally until the next newline (counted as a diagnostic).
      if (stdoutBuf.length > MAX_LINE_CHARS) {
        const newline = stdoutBuf.indexOf('\n')
        if (newline === -1) {
          oversizedDropped += 1
          stdoutBuf = ''
          return
        }
        stdoutBuf = stdoutBuf.slice(newline + 1)
        oversizedDropped += 1
      }
      let newline = stdoutBuf.indexOf('\n')
      while (newline !== -1) {
        const line = stdoutBuf.slice(0, newline)
        stdoutBuf = stdoutBuf.slice(newline + 1)
        this.consumeLine(handle, line)
        newline = stdoutBuf.indexOf('\n')
      }
    })

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      handle.stderrTail = [...handle.stderrTail, sanitizeText(chunk)].slice(-8)
    })

    child.on('close', (code, signal) => {
      if (handle.settled) return
      // Drain a final line that never got a trailing newline.
      if (stdoutBuf.length > 0) {
        this.consumeLine(handle, stdoutBuf)
        stdoutBuf = ''
      }
      if (handle.abortReason !== undefined) {
        // A stop request wins over whatever the process did afterwards:
        // the caller asked for a stop, so report the stop.
        this.settle(handle, { status: 'aborted', error: handle.abortReason, exitCode: code })
        return
      }
      if (code === 0) {
        // Protocol markers are required for a success verdict: at least one
        // assistant content block AND the session.resume_hint id. A bare exit 0
        // with neither is a protocol error, not a success.
        if (handle.lastAnswer.length === 0 || handle.record.kimiId === undefined) {
          const missing = [
            handle.lastAnswer.length === 0 ? 'assistant-content' : null,
            handle.record.kimiId === undefined ? 'resume-hint' : null,
          ].filter(Boolean).join(',')
          this.settle(handle, {
            status: 'error',
            exitCode: 0,
            error: `protocol-error (missing ${missing})${oversizedDropped > 0 ? `; dropped ${oversizedDropped} oversized line(s)` : ''}`,
          })
          return
        }
        this.settle(handle, {
          status: 'done',
          exitCode: 0,
          answer: bounded(
            handle.lastAnswer.length > 0 ? handle.lastAnswer : handle.transcriptBuf.trim(),
            this.config.maxTranscriptChars,
          ),
        })
      } else {
        const stderr = handle.stderrTail.join('').trim().slice(-400)
        const prefix = handle.record.kind === 'steer' ? 'resume-failed' : 'kimi'
        this.settle(handle, {
          status: 'error',
          exitCode: code,
          error: code === null
            ? `${prefix}: killed by signal ${String(signal)}`
            : `${prefix}: non-zero exit (${code})${stderr.length > 0 ? `: ${stderr}` : ''}`,
        })
      }
    })

    if (handle.record.timeoutMs > 0) {
      handle.timeoutTimer = setTimeout(() => {
        this.killGroup(handle, 'timeout')
      }, handle.record.timeoutMs)
    }
  }

  /** Fold one stdout line into the record (stream-json events + noise tolerance). */
  private consumeLine(handle: KimiHandle, line: string): void {
    if (handle.settled) return
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    let event: KimiStreamEvent
    try {
      event = JSON.parse(trimmed) as KimiStreamEvent
    } catch {
      // Non-JSON stdout lines are kimi tool-machinery noise (e.g. printed
      // command output) — never transcript material, silently ignored.
      return
    }
    if (event.role === 'assistant') {
      if (typeof event.content === 'string' && event.content.length > 0) {
        const content = sanitizeText(event.content)
        if (content.length === 0) return
        handle.transcriptBuf = `${handle.transcriptBuf}${content}\n`.slice(-MAX_TRANSCRIPT_BUF_CHARS)
        handle.lastAnswer = event.content
        handle.record = {
          ...handle.record,
          transcript: bounded(handle.transcriptBuf, this.config.maxTranscriptChars),
        }
        this.pushLoop(handle, { kind: 'message', text: content.slice(0, LOOP_TEXT_CAP) })
        this.maybeEmit(handle)
      }
      // Tool intent: one tool row per requested function call, keyed by its id.
      const calls = event.tool_calls
      if (Array.isArray(calls)) {
        for (const call of calls) {
          const callObj = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } }
          const callId = typeof callObj.id === 'string' ? callObj.id : `kimi-tool-${handle.loopSeq}`
          const fn = callObj.function
          if (fn === undefined) continue
          const name = typeof fn.name === 'string' ? fn.name : 'tool'
          const raw = typeof fn.arguments === 'string' ? fn.arguments : ''
          this.upsertTool(handle, callId, {
            tool: name,
            status: 'running',
            argsPreview: sanitizeText(raw).slice(0, LOOP_ARGS_CAP),
            startedAt: Date.now(),
          })
        }
        this.maybeEmit(handle)
      }
      return
    }
    if (event.role === 'tool') {
      // Tool result: update the pending row by tool_call_id (never array order).
      const content = typeof event.content === 'string' ? sanitizeText(event.content) : ''
      const callId = typeof event.tool_call_id === 'string' ? event.tool_call_id : undefined
      if (callId !== undefined) {
        const truncated = content.length > LOOP_OUTPUT_CAP
        this.upsertTool(handle, callId, {
          status: 'done',
          outputPreview: bounded(content, LOOP_OUTPUT_CAP),
          truncated,
          completedAt: Date.now(),
        })
        this.maybeEmit(handle)
      }
      return
    }
    if (event.role === 'meta' && event.type === 'session.resume_hint') {
      const sessionId = event.session_id
      if (typeof sessionId === 'string' && sessionId.length > 0) {
        if (handle.record.kind === 'steer' && handle.record.kimiId !== undefined && sessionId !== handle.record.kimiId) {
          // The resumed session is not the one we asked for: fail loudly rather
          // than silently recording a mismatched continuation.
          this.settle(handle, { status: 'error', error: 'session-mismatch' })
          return
        }
        if (handle.record.kimiId === undefined) {
          handle.record = { ...handle.record, kimiId: sessionId }
          this.emit(handle)
        }
      }
      return
    }
    // role 'tool' results (content can be enormous) and anything else: ignored.
  }

  /**
   * The single terminal-state guard. `update` is applied to the record, the
   * final event is emitted, the settle promise resolves, and the concurrency
   * slot frees. Idempotent; the slot release and promise resolve are
   * guaranteed even if the final append throws (dying session).
   */
  private settle(handle: KimiHandle, update: Partial<KimiSessionView>): void {
    if (handle.settled) return
    handle.settled = true
    try {
      const finishedAt = Date.now()
      handle.record = {
        ...handle.record,
        ...update,
        status: update.status ?? handle.record.status,
        finishedAt,
        durationMs: finishedAt - handle.record.createdAt,
        transcript: bounded(handle.transcriptBuf, this.config.maxTranscriptChars),
      }
      if (!handle.silent) {
        try {
          this.emit(handle)
        } catch (error) {
          handle.stderrTail = [...handle.stderrTail, `terminal append failed: ${String(error)}`].slice(-8)
        }
      }
    } finally {
      if (handle.timeoutTimer !== undefined) clearTimeout(handle.timeoutTimer)
      for (const timer of handle.stopTimers) clearTimeout(timer)
      handle.stopTimers = []
      this.running = Math.max(0, this.running - 1)
      handle.resolveSettle(handle.record)
    }
  }

  /** Stop a session: SIGTERM the process group, then SIGKILL after the grace period. */
  private killGroup(handle: KimiHandle, reason: 'aborted' | 'timeout'): void {
    if (handle.settled) return
    // First-cause-wins: the first stop request names the terminal status.
    if (handle.abortReason === undefined) handle.abortReason = reason
    const child = handle.child
    const term = (): void => {
      if (child === null || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        try { child.kill('SIGTERM') } catch { /* already gone */ }
      }
    }
    term()
    handle.stopTimers.push(setTimeout(() => {
      if (child === null || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        try { child.kill('SIGKILL') } catch { /* already gone */ }
      }
    }, this.config.killGraceMs))
    // Bounded fallback: if the child never emits close (wedged), settle anyway.
    handle.stopTimers.push(setTimeout(() => {
      if (!handle.settled) {
        this.settle(handle, { status: 'aborted', error: reason, exitCode: null })
      }
    }, this.config.killGraceMs + 2000))
  }
}
