/**
 * Tool definitions for dsh-kimi-bridge: call_kimi (async = parallel,
 * block = wait for the answer), kimi_status (list), kimi_abort (cancel).
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { KimiSessionView, KimiToolResult } from './types.js'
import { KimiSessionManager, type AskKimiArgs, type KimiSteerArgs } from './kimi-manager.js'

/** Render one tool result to model-facing text. */
function renderResult(value: KimiToolResult): string {
  switch (value.status) {
    case 'started':
      return [
        `Started kimi session ${value.kimi_session_id} (parallel).`,
        `cwd=${value.cwd}; queued_at=${value.queued_at}`,
        `prompt: ${value.prompt_preview}`,
        'Poll with kimi_status, or block on it by calling call_kimi with mode="block" and the same kimi_session_id.',
      ].join('\n')
    case 'completed':
      return [
        `Kimi session ${value.kimi_session_id} completed (exit ${value.exit_code ?? 'signal'}, ${value.duration_ms}ms).`,
        '',
        value.answer,
      ].join('\n')
    case 'cancelled':
      return `Waiting on kimi session ${value.kimi_session_id} was cancelled by the caller (${value.reason}); the kimi session was stopped.`
    case 'error':
      return `Kimi session ${value.kimi_session_id} failed: ${value.error}`
    case 'aborted':
      return `Aborted kimi session ${value.kimi_session_id}.`
    case 'not-found':
      return `No kimi session ${value.kimi_session_id} in this session.`
    case 'list':
      return value.kimi_sessions.length === 0
        ? 'No kimi sessions in this session yet.'
        : value.kimi_sessions
          .map(s => `${s.status.padEnd(7)} ${s.id}${s.kimiId === undefined ? '' : ` (kimi ${s.kimiId})`} created=${s.createdAt}${s.error === undefined ? '' : ` error=${s.error}`}`)
          .join('\n')
  }
}

/** The shared output schema for call_kimi results. */
const resultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['started', 'completed', 'cancelled', 'error', 'aborted', 'not-found', 'list'] },
    kimi_session_id: { type: 'string' },
    session_id: { type: 'string' },
    prompt_preview: { type: 'string' },
    cwd: { type: 'string' },
    queued_at: { type: 'number' },
    answer: { type: 'string' },
    exit_code: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    duration_ms: { type: 'number' },
    transcript_preview: { type: 'string' },
    reason: { type: 'string' },
    error: { type: 'string' },
    parent: { type: 'string' },
    kind: { type: 'string' },
    kimi_sessions: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
} as const

/** Map a settled record onto the tool result vocabulary. */
function recordResult(record: KimiSessionView): Extract<KimiToolResult, { status: 'completed' | 'error' | 'aborted' }> {
  switch (record.status) {
    case 'done':
      return {
        status: 'completed',
        kimi_session_id: record.id,
        answer: record.answer ?? record.transcript,
        exit_code: record.exitCode ?? null,
        duration_ms: record.durationMs ?? 0,
        transcript_preview: record.transcript.slice(0, 500),
      }
    case 'aborted':
      return { status: 'aborted', kimi_session_id: record.id }
    case 'error':
      return { status: 'error', kimi_session_id: record.id, error: record.error ?? 'unknown error' }
    default:
      // The wait returned a still-live record (should not happen after settle).
      return { status: 'error', kimi_session_id: record.id, error: `session still ${record.status}` }
  }
}

/** The `call_kimi` tool: parallel (async) or blocking kimi invocation. */
export function defineAskKimiTool(
  manager: KimiSessionManager,
) {
  return defineTool({
    name: 'call_kimi',
    description:
      'Call the Kimi CLI a question in a kimi session. '
      + 'mode="async" (default) starts the session and returns immediately with a kimi_session_id — multiple async calls run in parallel; '
      + 'poll with kimi_status, block on one with call_kimi mode="block" kimi_session_id=<id>, or cancel with kimi_abort. '
      + 'mode="block" starts a session (or, with kimi_session_id, waits on an existing one) and returns only when it finishes, '
      + 'with the final answer. kimi runs in the session working directory (its tool permissions come from the '
      + 'kimi config.toml, not from this tool).',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'Question or instructions for Kimi.',
      },
      mode: {
        type: 'string',
        enum: ['async', 'block'],
        description: 'async starts and returns immediately (parallel); block waits for the final answer. Default: async.',
      },
      model: {
        type: 'string',
        description: 'Optional model override for kimi (-m).',
      },
      timeout_ms: {
        type: 'number',
        description: 'Lifetime limit for the session in ms (0 = unlimited). On expiry the session is aborted. Default: configured defaultTimeoutMs.',
      },
      kimi_session_id: {
        type: 'string',
        description: 'Only with mode="block": wait on this previously started async session instead of starting a new one.',
      },
    },
    output: {
      schema: resultSchema,
      render: (_args, value) => [{ type: 'text', text: renderResult(value as KimiToolResult) }],
    },
    // async calls return immediately and only touch per-session state with
    // commutative map writes — safe to overlap with sibling tool calls.
    isConcurrencySafe: (args: AskKimiArgs) => args.mode !== 'block',
    async execute(args: AskKimiArgs, exec): Promise<KimiToolResult> {
      const agent = exec.agent
      if (agent === undefined || !manager.allowed(agent)) {
        return { status: 'error', kimi_session_id: '', error: 'agent-not-allowed' }
      }
      // Blocking on an existing session: no new session is opened.
      if (args.mode === 'block' && args.kimi_session_id !== undefined) {
        return await blockOn(manager, agent, args.kimi_session_id, exec.signal)
      }
      let record: KimiSessionView
      try {
        record = manager.ask(agent, args)
      } catch (error) {
        return { status: 'error', kimi_session_id: '', error: error instanceof Error ? error.message : String(error) }
      }
      if (args.mode !== 'block') {
        return {
          status: 'started',
          kimi_session_id: record.id,
          session_id: String(agent.session.id),
          prompt_preview: record.prompt.slice(0, 200),
          cwd: record.cwd,
          queued_at: record.createdAt,
          ...(record.parent === undefined ? {} : { parent: record.parent }),
          ...(record.kind === undefined ? {} : { kind: record.kind }),
        }
      }
      // A blocking wait cancelled by the caller stops the kimi work too
      // (killOnCancel): stop = stop, not a silently orphaned session.
      const awaited = await manager.waitFor(agent, record.id, exec.signal, { killOnCancel: true })
      if (awaited === 'cancelled') {
        return { status: 'cancelled', kimi_session_id: record.id, reason: 'caller-aborted' }
      }
      return recordResult(awaited)
    },
    presentCall: (args: { prompt: string }) => ({
      card: 'generic',
      title: 'Call Kimi',
      kind: 'execute',
      rawInput: args.prompt.slice(0, 80),
    }),
  })
}

/** Wait on an existing session by id (block mode with kimi_session_id). */
async function blockOn(
  manager: KimiSessionManager,
  agent: Agent,
  codexSessionId: string,
  signal: AbortSignal,
): Promise<KimiToolResult> {
  const record = manager.list(agent).find(s => s.id === codexSessionId)
  if (record === undefined) {
    return { status: 'not-found', kimi_session_id: codexSessionId }
  }
  const awaited = await manager.waitFor(agent, codexSessionId, signal, { killOnCancel: true })
  if (awaited === 'cancelled') {
    return { status: 'cancelled', kimi_session_id: codexSessionId, reason: 'caller-aborted' }
  }
  return recordResult(awaited)
}

/** The `kimi_status` tool: list the current session's kimi sessions. */
export function defineKimiStatusTool(manager: KimiSessionManager) {
  return defineTool({
    name: 'kimi_status',
    description:
      'List the kimi sessions opened by the current session, with status, prompt preview, and progress. '
      + 'Use it to poll sessions started with call_kimi mode="async".',
    parameters: {},
    output: {
      schema: resultSchema,
      render: (_args, value) => [{ type: 'text', text: renderResult(value as KimiToolResult) }],
    },
    isConcurrencySafe: () => true, // pure read of per-session state
    execute(_args, exec): KimiToolResult {
      const agent = exec.agent
      if (agent === undefined || !manager.allowed(agent)) return { status: 'list', kimi_sessions: [] }
      return { status: 'list', kimi_sessions: manager.list(agent) }
    },
  })
}

/** The `kimi_abort` tool: cancel one running kimi session. */
export function defineKimiAbortTool(manager: KimiSessionManager) {
  return defineTool({
    name: 'kimi_abort',
    description:
      'Abort one running kimi session of the current session (SIGTERM, then SIGKILL). '
      + 'The session settles as aborted in kimi_status and in the Kimi tab.',
    parameters: {
      kimi_session_id: { type: 'string', required: true, description: 'The kimi session id returned by call_kimi.' },
    },
    output: {
      schema: resultSchema,
      render: (_args, value) => [{ type: 'text', text: renderResult(value as KimiToolResult) }],
    },
    // Aborting is idempotent-ish (second call → not-found) and only touches
    // per-session state with commutative writes — safe to overlap.
    isConcurrencySafe: () => true,
    execute(args: { kimi_session_id: string }, exec): KimiToolResult {
      const agent = exec.agent
      if (agent === undefined || !manager.allowed(agent)) return { status: 'not-found', kimi_session_id: args.kimi_session_id }
      const outcome = manager.abort(agent, args.kimi_session_id)
      if (outcome === 'not-found') {
        return { status: 'not-found', kimi_session_id: args.kimi_session_id }
      }
      return { status: 'aborted', kimi_session_id: args.kimi_session_id }
    },
    presentCall: (args: { kimi_session_id: string }) => ({
      card: 'generic',
      title: 'Abort kimi session',
      kind: 'execute',
      rawInput: args.kimi_session_id,
    }),
  })
}


/** The `kimi_steer` tool: continue a settled kimi session's thread. */
export function defineKimiSteerTool(manager: KimiSessionManager) {
  return defineTool({
    name: 'kimi_steer',
    description:
      'Start a follow-up turn on a SETTLED kimi session: kimi resumes the parent thread with '
      + 'a new message (the model sees the persisted session context, so you can redirect, ask '
      + 'follow-ups, or correct direction). The parent must be finished (kimi_status shows '
      + 'done/error/aborted), have a resumable thread id, and be the latest record on its thread. '
      + 'mode="async" returns immediately (parallel); mode="block" waits for the steer result. '
      + 'The new session appears in kimi_status and the Kimi tab linked to its parent.',
    parameters: {
      kimi_session_id: {
        type: 'string',
        required: true,
        description: 'Plugin-side id of the settled parent kimi session (from call_kimi / kimi_status).',
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'The steering message: what to continue with / change.',
      },
      mode: {
        type: 'string',
        enum: ['async', 'block'],
        description: 'async starts and returns immediately; block waits for the steer result. Default: async.',
      },
      model: {
        type: 'string',
        description: 'Optional model override for this steer (-m).',
      },
      timeout_ms: {
        type: 'number',
        description: 'Lifetime limit for the steer session in ms (0 = unlimited). Default: configured defaultTimeoutMs.',
      },
    },
    output: {
      schema: resultSchema,
      render: (_args, value) => [{ type: 'text', text: renderResult(value as KimiToolResult) }],
    },
    isConcurrencySafe: (args: KimiSteerArgs) => args.mode !== 'block',
    async execute(args: KimiSteerArgs, exec): Promise<KimiToolResult> {
      const agent = exec.agent
      if (agent === undefined || !manager.allowed(agent)) {
        return { status: 'error', kimi_session_id: '', error: 'agent-not-allowed' }
      }
      let record: KimiSessionView
      try {
        record = manager.steer(agent, args)
      } catch (error) {
        return { status: 'error', kimi_session_id: args.kimi_session_id, error: error instanceof Error ? error.message : String(error) }
      }
      if (args.mode !== 'block') {
        return {
          status: 'started',
          kimi_session_id: record.id,
          session_id: String(agent.session.id),
          prompt_preview: record.prompt.slice(0, 200),
          cwd: record.cwd,
          queued_at: record.createdAt,
          parent: record.parent,
          kind: record.kind,
        }
      }
      const awaited = await manager.waitFor(agent, record.id, exec.signal, { killOnCancel: true })
      if (awaited === 'cancelled') {
        return { status: 'cancelled', kimi_session_id: record.id, reason: 'caller-aborted' }
      }
      return recordResult(awaited)
    },
    presentCall: (args: { prompt: string; kimi_session_id: string }) => ({
      card: 'generic',
      title: 'Steer kimi session',
      kind: 'execute',
      rawInput: `${args.kimi_session_id}: ${args.prompt.slice(0, 60)}`,
    }),
  })
}
