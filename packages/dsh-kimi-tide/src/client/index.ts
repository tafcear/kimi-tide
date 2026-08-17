/**
 * Browser half of dsh-kimi-tide: registers the 月汐 dock panel into the
 * conversation composer dock band (ambient readout under the composer card,
 * beside the shipped stats line). Panel data rides the
 * 'kimi-tide/panel' session projection; user actions go back through
 * ctx.remote.commands.execute(sessionId, '/kimi-tide …').
 */
import type { Context } from '@deepseek-ai/cordis'
import { TideDock, tideDockBridge } from './TideDock.js'

export const inject = ['slots', 'remote', 'remote.commands']

export function apply(ctx: Context): void {
  // Wire the bridge so TideDock can call remote commands without receiving ctx as a prop.
  tideDockBridge.execute = (sessionId, line) =>
    (ctx as unknown as { remote: { commands: { execute: (sid: string, l: string) => Promise<unknown> } } })
      .remote.commands.execute(sessionId, line)

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'kimi-tide',
    order: 10, // after the shipped stats line (order 0)
    label: '月汐',
  }, TideDock))

  // Plugin-scoped styles; the slot/loader lifecycle removes them on unload.
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-kimi-tide'
  style.textContent = `
    .kimi-tide-dock { display: flex; align-items: center; gap: 10px; font-size: 12px;
      color: var(--dsw-alias-label-tertiary, #8b93a7); flex-wrap: wrap; }
    .kimi-tide-dock .kt-label { font-weight: 600; color: var(--dsw-alias-label-primary, #2b3245); }
    .kimi-tide-dock .kt-warn { color: var(--dsw-alias-warning-strong, #d97706); }
    .kimi-tide-dock .kt-danger { color: var(--dsw-alias-danger-strong, #e5484d); }
    .kimi-tide-dock .kt-stale { opacity: 0.55; }
    .kimi-tide-dock button { font-size: 12px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      background: transparent; color: inherit; border-radius: 6px; padding: 1px 8px; }
    .kimi-tide-dock button.kt-active { background: var(--dsw-alias-interactive-bg-hover-accent, rgba(77,107,254,0.12));
      color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: currentColor; }
    .kimi-tide-dock details { flex-basis: 100%; }
    .kimi-tide-dock details > div { padding: 6px 0 2px; display: flex; flex-direction: column; gap: 4px; }
    .kimi-tide-dock input, .kimi-tide-dock select { font-size: 12px; padding: 1px 6px;
      border: 1px solid var(--dsw-alias-border-l2, #d4d9e3); border-radius: 6px; background: var(--dsw-alias-bg-base, #fff);
      color: var(--dsw-alias-label-primary, #2b3245); }
  `
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove())
}
