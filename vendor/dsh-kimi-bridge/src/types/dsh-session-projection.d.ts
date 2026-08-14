/**
 * Ambient type shim for the session-projection seam.
 *
 * The @deepseek-ai/* packages are NOT published on the public npm registry;
 * the harness resolves them at load time. Standalone typecheck relies on this
 * loose surface; the real package ships the strict interface.
 */

declare module '@deepseek-ai/dsh-session-projection/types' {
  /** The single projection type table; domain plugins merge their key here. */
  export interface SessionProjectionMap {}
}

declare module '@deepseek-ai/dsh-session-projection' {
  import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
  import type { ZodType } from 'zod'
  import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types'

  /** One domain's state-driven computation unit (loose standalone shape). */
  export interface ProjectionDefinition<K extends keyof SessionProjectionMap, S> {
    key: K
    schema: ZodType<SessionProjectionMap[K]>
    init(): S
    apply(state: S, event: SessionEvent): S
    view(state: S): SessionProjectionMap[K]
    stateVersion: number
  }

  /** One consistent read cut over every registered unit for one session. */
  export interface ProjectionSnapshot {
    asOfSeq: number
    values: Partial<SessionProjectionMap>
  }

  export type ProjectionChangeListener = (
    session: Session,
    key: Extract<keyof SessionProjectionMap, string>,
    value: unknown,
    seq: number,
  ) => void

  /** The registry provided as `ctx.sessionProjections` by the harness. */
  export interface SessionProjectionRegistry {
    register<K extends keyof SessionProjectionMap, S>(
      definition: ProjectionDefinition<K, S>,
    ): () => void
    onChanged(listener: ProjectionChangeListener): () => void
    snapshot(session: Session): ProjectionSnapshot
  }
}
