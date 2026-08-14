/**
 * Browser half of dsh-kimi-bridge: registers the Kimi tab into the
 * conversation view ring (conversation.view slot), on par with Chat and
 * Trajectory. The component observes the current session's kimi sessions
 * through the framework's useProjection('kimi/sessions') hook — the host
 * pushes whole-value projection frames, so no client→host channel is needed.
 */

import type { Context } from '@deepseek-ai/cordis'
import { KimiView } from './KimiView.js'

/** Required services: the slot system (runtime provides `slots`). */
export const inject = ['slots']

/**
 * Browser plugin body: register the kimi view tab. The registration rides
 * the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'kimi',
    order: 30, // after chat (0), trajectory (10), codex (20)
    label: 'Kimi',
  }, KimiView))
}
