/**
 * Ambient type shim for @deepseek-ai/dsh-session.
 *
 * The @deepseek-ai/* packages are NOT published on the public npm registry;
 * the harness resolves them at load time. Standalone typecheck relies on this
 * loose surface; the real package ships the strict interface. Keep the
 * surface minimal to what this plugin reads.
 */

declare module '@deepseek-ai/dsh-session' {
  /** Opaque branded session identity (loose standalone). */
  export type SessionId = string & { readonly brand?: unique symbol }

  /** Session identity factory for standalone use. */
  export function SessionId(id: string): SessionId

  /** Merge-extensible event map; plugins augment it via declaration merging. */
  export interface SessionEventMap {}

  /** A durable event-sourced session (loose standalone shape). */
  export interface Session {
    readonly id: SessionId
    readonly events: readonly unknown[]
    readonly seq: number
    readonly header: { createdAt: number; cwd?: string }
    append<K extends keyof SessionEventMap>(
      type: K,
      data: SessionEventMap[K],
      options?: { surfaceOp?: unknown },
    ): unknown
  }

  /** A session event, discriminated by `type` over the merged event map. */
  export type SessionEvent<T extends keyof SessionEventMap = keyof SessionEventMap> = {
    [K in keyof SessionEventMap]: {
      type: K
      seq: number
      time: number
      data: SessionEventMap[K]
    }
  }[T]

  /** A message-producing event (loose; used for typing only). */
  export interface UserMessage {
    content: Array<{ type: string; text?: string; [key: string]: unknown }>
    source: unknown
  }
}
