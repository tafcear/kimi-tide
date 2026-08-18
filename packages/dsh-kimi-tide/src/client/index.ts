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
    .kimi-tide-dock .kt-settings { gap: 6px; }
    .kimi-tide-dock .kt-h { font-size: 11px; opacity: 0.65; margin-top: 2px; }
    .kimi-tide-dock .kt-meta { opacity: 0.85; }
    .kimi-tide-dock .kt-hint { opacity: 0.6; }
    .kimi-tide-dock .kt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 4px 14px; }
    .kimi-tide-dock .kt-row { display: flex; align-items: center; gap: 6px; }
    .kimi-tide-dock .kt-field-label { width: 108px; flex: none; opacity: 0.85; }
    .kimi-tide-dock .kt-row select { flex: 1; min-width: 0; }
    .kimi-tide-dock .kt-row input:not([type="range"]):not(.kt-num) { flex: 1; min-width: 0; }
    .kimi-tide-dock .kt-budget input[type="range"] { flex: 1; min-width: 60px; accent-color: var(--dsw-alias-brand-primary, #4d6bfe); }
    .kimi-tide-dock .kt-num { width: 52px; flex: none; }
    /* 面板 v3（Task 10）：候选管理 / 评分编辑 / 决策可观测 */
    .kimi-tide-dock .kt-candidates, .kimi-tide-dock .kt-scores, .kimi-tide-dock .kt-reason {
      display: flex; flex-direction: column; gap: 4px; padding: 4px 0; border-top: 1px dashed var(--dsw-alias-border-l1, #e4e7ee); }
    .kimi-tide-dock .kt-candidate { gap: 6px; }
    .kimi-tide-dock .kt-candidate-default { display: flex; align-items: center; gap: 3px; flex: none; opacity: 0.85; }
    .kimi-tide-dock .kt-candidate select { flex: 1; min-width: 0; }
    .kimi-tide-dock .kt-unavailable { opacity: 0.5; }
    .kimi-tide-dock .kt-candidate-add select { flex: 1; min-width: 0; }
    .kimi-tide-dock .kt-score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 2px 14px; }
    .kimi-tide-dock .kt-score-row input[type="range"] { flex: 1; min-width: 60px; accent-color: var(--dsw-alias-brand-primary, #4d6bfe); }
    .kimi-tide-dock .kt-score-values { display: flex; gap: 8px; flex: none; white-space: nowrap; }
    .kimi-tide-dock .kt-score-override { color: var(--dsw-alias-brand-primary, #4d6bfe); font-variant-numeric: tabular-nums; }
    .kimi-tide-dock .kt-score-baseline { font-variant-numeric: tabular-nums; }
    .kimi-tide-dock .kt-decision-chip { color: var(--dsw-alias-brand-primary, #4d6bfe); }
  `
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove())
}
