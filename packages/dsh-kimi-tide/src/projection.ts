/**
 * kimi-tide: panel projection — key 'kimi-tide/panel', whole-value push.
 * The payload is process-global (quota/router are not per-session), so the
 * host appends the same snapshot to every live session's log; the framework
 * folds and pushes it. Pure unit functions + the SessionProjectionMap merge
 * that types both ends (host register / client useProjection).
 */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { KimiTidePanelProjection } from './types.js'

export const KIMI_TIDE_PANEL_KEY = 'kimi-tide/panel' as const
/** Session event type carrying the whole panel payload (log + fold input). */
export const KIMI_TIDE_PANEL_EVENT = 'kimi-tide/panel' as const

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'kimi-tide/panel': KimiTidePanelProjection | null
  }
}

/** Wire-payload guard. Structural (passthrough) — the payload crosses one process boundary only. */
const panelSchema = z.object({
  quota: z.object({
    weekly: z.object({ used: z.number(), limit: z.number(), resetTime: z.string() }),
    fiveHour: z.object({ used: z.number(), limit: z.number(), resetTime: z.string() }),
    membershipLevel: z.string(),
    fetchedAt: z.number(),
    stale: z.boolean(),
  }).nullable(),
  local: z.object({
    today: z.record(z.string(), z.number()),
    session: z.record(z.string(), z.number()),
    calls: z.number(),
  }),
  router: z.record(z.string(), z.unknown()),
  reasoning: z.object({ enabled: z.literal(true) }),
}).nullable()

// dsh-session-projection depends on zod v4 while this package uses zod v3;
// the schema is structurally compatible at runtime (both validate plain JSON),
// so we bridge the type gap through unknown.
const bridgedSchema = panelSchema as unknown as
  import('@deepseek-ai/dsh-session-projection').ProjectionDefinition<
    typeof KIMI_TIDE_PANEL_KEY, KimiTidePanelProjection | null
  >['schema']

export const kimiTideProjectionDefinition:
ProjectionDefinition<typeof KIMI_TIDE_PANEL_KEY, KimiTidePanelProjection | null> = {
  key: KIMI_TIDE_PANEL_KEY,
  schema: bridgedSchema,
  stateVersion: 1,
  init: () => null,
  apply: (state, event) => {
    // Custom event types are not in the SessionEvent discriminated union;
    // compare via widened string check.
    if ((event as { type: string }).type === KIMI_TIDE_PANEL_EVENT) {
      return (event as { data: unknown }).data as KimiTidePanelProjection
    }
    return state
  },
  view: (state) => state,
}
