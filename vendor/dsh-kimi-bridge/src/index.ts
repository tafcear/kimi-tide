/**
 * dsh-kimi-bridge — a dual-face (host + browser) DeepSeek Harness plugin.
 *
 * Host half: registers the call_kimi / kimi_status / kimi_abort tools and
 * a `kimi/sessions` session projection; every kimi session is a spawned
 * `kimi -a never exec --json` child process, state changes are appended to
 * the dsh session log as whole-value `kimi/session` events and pushed to the
 * browser as projection frames. Telemetry exports redact the prompt and
 * transcript of kimi/session records.
 *
 * Browser half (src/client/): a Kimi tab in the conversation pane
 * (conversation.view slot) that selects and observes the current session's
 * kimi sessions through useProjection('kimi/sessions').
 *
 * Design + kimi review outcomes: kimi-bridge-design.md (task folder).
 * This is a UX channel, not a security boundary — but the model-facing
 * surface is deliberately tight: kimi always runs in the session working
 * directory, never with danger-full-access (config may raise the default),
 * and `allowedAgents`/`maxParallel`/`maxSessionsPerSession` bound resource
 * amplification.
 * @module dsh-kimi-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { KimiSessionManager, type KimiManagerConfig } from './kimi-manager.js'
import { kimiProjectionDefinition } from './projection.js'
import { defineAskKimiTool, defineKimiAbortTool, defineKimiStatusTool, defineKimiSteerTool } from './tools.js'

export const name = 'dsh-kimi-bridge'
export const inject = ['tools', 'agents', 'sessionProjections'] as const

/** Plugin configuration (validated by schemastery; defaults live on the schema). */
export interface Config {
  /** kimi executable: absolute path or a PATH lookup name. */
  kimiPath?: string
  /** Review-only mode: run kimi under a managed home whose [tools] allowlist is read-only. */
  reviewOnly?: boolean
  /** Source Kimi home carrying config + auth ('' = KIMI_CODE_HOME env, else ~/.kimi-code). */
  kimiHome?: string
  /** Where the managed review home lives ('' = $DSH_HOME/kimi-review-home). */
  reviewHomeDir?: string
  /** Hard cap on any session's timeout_ms. */
  maxTimeoutMs?: number
  /** Default lifetime limit for kimi sessions in ms (0 = unlimited). */
  defaultTimeoutMs?: number
  /** Global cap on concurrently running kimi processes. */
  maxParallel?: number
  /** Cap on live kimi sessions per dsh session. */
  maxSessionsPerSession?: number
  /** Cap on retained (settled) records per dsh session. */
  maxRetained?: number
  /** Cap on the prompt text recorded into events/projections (execution gets the full prompt). */
  maxPromptChars?: number
  /** Cap on the transcript text recorded into events/projections. */
  maxTranscriptChars?: number
  /** Bounded agent-loop window (steps kept in the record/projection). */
  maxLoopSteps?: number
  /** Serialized-byte cap for the loop window (UTF-8). */
  maxLoopBytes?: number
  /** Which agents may open kimi sessions: top-level only, or any live agent. */
  allowedAgents?: 'roots' | 'all'
  /** SIGTERM → SIGKILL grace (ms) when aborting a kimi process group. */
  killGraceMs?: number
}

export const Config: z<Config> = z.object({
  kimiPath: z.string().default('kimi'),
  reviewOnly: z.boolean().default(true),
  kimiHome: z.string().default(''),
  reviewHomeDir: z.string().default(''),
  maxTimeoutMs: z.number().step(1).min(1).default(30 * 60 * 1000),
  // Kimi print mode can wait ~25 days on background work by default: a finite
  // default timeout is the safety baseline (consult recommendation).
  defaultTimeoutMs: z.number().step(1).min(0).default(10 * 60 * 1000),
  maxParallel: z.number().step(1).min(1).default(3),
  maxSessionsPerSession: z.number().step(1).min(1).default(8),
  maxRetained: z.number().step(1).min(1).default(16),
  maxPromptChars: z.number().step(1).min(1).default(16 * 1024),
  maxTranscriptChars: z.number().step(1).min(1024).default(16 * 1024),
  maxLoopSteps: z.number().step(1).min(8).default(32),
  maxLoopBytes: z.number().step(1).min(4096).default(16 * 1024),
  allowedAgents: z.union([z.const('roots'), z.const('all')]).default('roots'),
  // Kimi's own headless cleanup takes up to 8s: 10s grace so SIGKILL never
  // lands before it can restore permission state.
  killGraceMs: z.number().step(1).min(0).default(10_000),
})

/** The fully-defaulted config after schemastery validation. */
type ResolvedConfig = Required<Config>

import { redactTelemetryRecord, type TelemetryRecord } from './redact.js'

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = config as ResolvedConfig

  // The strict persistence reader refuses stored logs containing event types
  // outside the build's generated catalog. The catalog is a live exported Set
  // shared with the harness (resolved through the profile module fallback, so
  // this mutates the SAME instance the harness checks), making stored
  // `kimi/session` events readable again after a web restart.
  KNOWN_SESSION_EVENT_TYPES.add('kimi/session')

  const manager = new KimiSessionManager(ctx, resolved, (session: Session) => {
    const snapshot = ctx.sessionProjections.snapshot(session)
    return snapshot.values['kimi/sessions']
  })

  // Tool registrations are effects: HMR unwinds them with this fiber.
  ctx.tools.register(defineAskKimiTool(manager))
  ctx.tools.register(defineKimiStatusTool(manager))
  ctx.tools.register(defineKimiAbortTool(manager))
  ctx.tools.register(defineKimiSteerTool(manager))

  // The projection unit rides the registry's effect lifecycle. `sessionProjections`
  // is in the inject set, so the service is live before apply runs.
  ctx.sessionProjections.register(kimiProjectionDefinition)

  // Session disposal: kill every kimi session of that session (no orphan trees).
  ctx.on('session/disposed', (session: Session) => {
    manager.disposeSession(String(session.id))
  })

  // Telemetry privacy: exported ledger records never carry kimi prompt/output
  // text (the canonical session log keeps the real values).
  ctx.on('telemetry/record', (_record: unknown, next: () => TelemetryRecord) => {
    return redactTelemetryRecord(next())
  })

  // Plugin teardown: kill everything still running.
  ctx.effect(() => () => {
    manager.disposeAll()
  }, 'dsh-kimi-bridge: shutdown')
}

export type { KimiManagerConfig, AskKimiArgs, KimiSteerArgs } from './kimi-manager.js'
export type { KimiSessionStatus, KimiSessionView, KimiSessionsProjection } from './types.js'
export { KimiSessionManager } from './kimi-manager.js'
export { kimiProjectionDefinition, KIMI_PROJECTION_STATE_VERSION } from './projection.js'
export type { KimiSessionsState } from './projection.js'
export type { Agent }
