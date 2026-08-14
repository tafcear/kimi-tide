/**
 * Cordis Context augmentation for the harness services this plugin reads.
 * The harness's dsh-tools / dsh-agent / dsh-session-projection packages
 * provide these services on the cordis context; the public cordis package's
 * types do not know about them, so the narrow surface is declared here.
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Tool registry service — provided by @deepseek-ai/dsh-tools in the harness. */
    tools: {
      register(tool: unknown): () => void
      guard(guard: (exec: import('@deepseek-ai/dsh-tools').ToolExecution) => string | undefined): () => void
    }
    /** Agent registry service — provided by @deepseek-ai/dsh-agent in the harness. */
    agents: {
      roots(): readonly Agent[]
      list(): readonly Agent[]
      get(id: string): Agent | undefined
    }
    /** Projection registry — provided by @deepseek-ai/dsh-session-projection. */
    sessionProjections: SessionProjectionRegistry
    /** Optional service read (harness Context). */
    get<T>(name: string): T | undefined
    /** Register an event listener; returns the disposer. */
    on(event: string, listener: (...args: any[]) => unknown, options?: { global?: boolean }): () => void
    /** Register an effect with an optional teardown; returns the disposer. */
    effect(setup: () => (() => void) | void, label?: string): () => void
    /** The config-tree directory anchor (used by client-modules resolution). */
    baseUrl?: string
  }
}
