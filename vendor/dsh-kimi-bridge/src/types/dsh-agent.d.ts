/**
 * Ambient type shim for @deepseek-ai/dsh-agent.
 *
 * The @deepseek-ai/* packages are NOT published on the public npm registry;
 * the harness resolves them at load time. Standalone typecheck relies on this
 * loose surface; the real package ships the strict interface.
 */

declare module '@deepseek-ai/dsh-agent' {
  import type { Session } from '@deepseek-ai/dsh-session'

  /** A live agent loop (loose standalone shape). */
  export interface Agent {
    readonly id: string
    readonly session: Session
    /** Resolves after the agent concludes its current turn. */
    whenIdle(): Promise<void>
  }
}
