/**
 * The session projection unit for dsh-kimi-bridge: key `kimi/sessions`
 * folds every `kimi/session` event into the whole list of kimi sessions of
 * one dsh session, pushed to the browser by the harness (session/projection
 * frames). Pure functions only — no subscriptions, no ctx.
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { KimiSessionsProjection, KimiSessionView } from './types.js'

/** Fold state: kimi session id → latest whole record. */
export interface KimiSessionsState {
  readonly sessions: Readonly<Record<string, KimiSessionView>>
}

const codexSessionSchema = z.object({
  id: z.string(),
  kimiId: z.string().optional(),
  status: z.enum(['queued', 'running', 'done', 'error', 'aborted']),
  prompt: z.string(),
  cwd: z.string(),
  model: z.string().optional(),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  exitCode: z.number().nullable().optional(),
  error: z.string().optional(),
  transcript: z.string(),
  answer: z.string().optional(),
  durationMs: z.number().optional(),
  timeoutMs: z.number(),
  kind: z.enum(['ask', 'steer']).optional(),
  parent: z.string().optional(),
  loop: z.array(z.object({
    seq: z.number(),
    kind: z.enum(['turn_start', 'turn_end', 'message', 'tool', 'reasoning', 'error']),
    time: z.number(),
    text: z.string().optional(),
    tool: z.string().optional(),
    callId: z.string().optional(),
    status: z.enum(['running', 'done', 'failed']).optional(),
    startedAt: z.number().optional(),
    completedAt: z.number().optional(),
    argsPreview: z.string().optional(),
    outputPreview: z.string().optional(),
    exitCode: z.number().nullable().optional(),
    truncated: z.boolean().optional(),
    error: z.string().optional(),
  })).optional(),
  loopMeta: z.object({
    droppedSteps: z.number(),
    droppedByKind: z.record(z.string(), z.number()),
    oversizedOutputs: z.number(),
    firstRetainedSeq: z.number(),
  }).optional(),
})

// Zod's optional output includes explicit `undefined`; with
// exactOptionalPropertyTypes the public interface permits omission only.
const codexSessionsSchema = z.object({
  sessions: z.array(codexSessionSchema),
}) as unknown as z.ZodType<KimiSessionsProjection>

/** Bump when the fold semantics or the wire shape change (persisted-cache invalidation). */
export const KIMI_PROJECTION_STATE_VERSION = 5

export const kimiProjectionDefinition:
ProjectionDefinition<'kimi/sessions', KimiSessionsState> = {
  key: 'kimi/sessions',
  schema: codexSessionsSchema,
  stateVersion: KIMI_PROJECTION_STATE_VERSION,
  init: () => ({ sessions: {} }),
  apply: (state, event) => {
    if (event.type === 'kimi/session') {
      // Whole-value rule: the event carries the complete post-change record, so
      // the fold is a single map set.
      return { sessions: { ...state.sessions, [event.data.id]: event.data } }
    }
    if (event.type === 'kimi/evict') {
      // Retained-history tombstone: drop the evicted ids (bounded by maxRetained).
      const next: Record<string, KimiSessionView> = { ...state.sessions }
      for (const id of event.data.ids) delete next[id]
      return { sessions: next }
    }
    return state
  },
  view: (state) => ({
    sessions: Object.values(state.sessions).sort((a, b) => a.createdAt - b.createdAt),
  }),
}
