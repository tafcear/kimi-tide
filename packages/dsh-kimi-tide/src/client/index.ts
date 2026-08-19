/**
 * Browser half of dsh-kimi-tide: registers the 月汐 dock panel into the
 * conversation composer dock band (read-only dashboard under the composer
 * card, beside the shipped stats line), and the 月汐 settings card into the
 * official settings panel (settings.section). Panel data rides the
 * 'kimi-tide/panel' session projection; dock actions go back through
 * ctx.remote.commands.execute(sessionId, '/kimi-tide …'), while settings-card
 * writes go through the settings namespace (scope.set / connection.api.settings.mutate).
 */
import type { Context } from '@deepseek-ai/cordis'
import { TideDock, tideDockBridge } from './TideDock.js'
import { SettingsCard } from './SettingsCard.js'

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

  // 设置页「月汐」卡片。settingsScope / connection 均为可选读取：bind 在
  // inject 内惰性执行（挂载到卡片时才绑定，不因宿主缺服务而阻塞本插件激活）。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'kimi-tide-router',
    order: 100,
    label: () => '月汐',
    inject: () => ({
      scope: (ctx.get('settingsScope') as { bind?: (spec: { namespace: string }) => unknown } | undefined)
        ?.bind({ namespace: 'kimi-tide-router' }) ?? null,
      connection: (ctx.get('connection') as unknown) ?? null,
    }),
  }, SettingsCard))

  // Plugin-scoped styles; the slot/loader lifecycle removes them on unload.
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-kimi-tide'
  style.textContent = `
    /* ---- dock（只读仪表）---- */
    .kimi-tide-dock { display: flex; align-items: center; gap: 10px; font-size: 12px;
      color: var(--dsw-alias-label-tertiary, #8b93a7); flex-wrap: wrap; }
    .kimi-tide-dock .kt-label { font-weight: 600; color: var(--dsw-alias-label-primary, #2b3245); }
    .kimi-tide-dock .kt-warn { color: var(--dsw-alias-warning-strong, #d97706); }
    .kimi-tide-dock .kt-danger { color: var(--dsw-alias-danger-strong, #e5484d); }
    .kimi-tide-dock .kt-stale { opacity: 0.55; }
    .kimi-tide-dock button { font-size: 12px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      background: transparent; color: inherit; border-radius: 6px; padding: 1px 8px; }
    .kimi-tide-dock .kt-h { font-size: 11px; opacity: 0.65; margin-top: 2px; }
    .kimi-tide-dock .kt-meta { opacity: 0.85; }
    .kimi-tide-dock .kt-hint { opacity: 0.6; }
    .kimi-tide-dock .kt-reason { display: flex; flex-direction: column; gap: 4px; padding: 4px 0;
      border-top: 1px dashed var(--dsw-alias-border-l1, #e4e7ee); }
    .kimi-tide-dock .kt-decision-chip { color: var(--dsw-alias-brand-primary, #4d6bfe); }

    /* ---- settings card（设置页「月汐」）---- */
    .kimi-tide-settings { display: flex; flex-direction: column; gap: 10px; font-size: 12px;
      color: var(--dsw-alias-label-primary, #2b3245); }
    .kimi-tide-settings .kt-mode-row { display: flex; gap: 6px; }
    .kimi-tide-settings .kt-mode { font-size: 12px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      background: transparent; color: inherit; border-radius: 6px; padding: 2px 10px; }
    .kimi-tide-settings .kt-mode.kt-active { background: var(--dsw-alias-interactive-bg-hover-accent, rgba(77,107,254,0.12));
      color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: currentColor; }
    .kimi-tide-settings .kt-candidates { display: flex; flex-direction: column; gap: 6px; }
    .kimi-tide-settings .kt-h { font-size: 11px; opacity: 0.65; }
    .kimi-tide-settings .kt-meta { opacity: 0.85; }
    .kimi-tide-settings .kt-hint { opacity: 0.6; }
    .kimi-tide-settings .kt-candidate { display: flex; flex-direction: column; gap: 4px; padding: 4px 0;
      border-top: 1px dashed var(--dsw-alias-border-l1, #e4e7ee); }
    .kimi-tide-settings .kt-score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 2px 14px; }
    .kimi-tide-settings .kt-score-row { display: flex; align-items: center; gap: 6px; }
    .kimi-tide-settings .kt-field-label { width: 108px; flex: none; opacity: 0.85; }
    .kimi-tide-settings .kt-score-row input[type="range"] { flex: 1; min-width: 60px; accent-color: var(--dsw-alias-brand-primary, #4d6bfe); }
    .kimi-tide-settings .kt-score-values { display: flex; gap: 8px; flex: none; white-space: nowrap; }
    .kimi-tide-settings .kt-score-override { color: var(--dsw-alias-brand-primary, #4d6bfe); font-variant-numeric: tabular-nums; }
    .kimi-tide-settings .kt-score-baseline { font-variant-numeric: tabular-nums; }
    .kimi-tide-settings .kt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 4px 14px; }
    .kimi-tide-settings .kt-row { display: flex; align-items: center; gap: 6px; }
    .kimi-tide-settings .kt-row input[type="number"] { flex: 1; min-width: 0; }
    .kimi-tide-settings input, .kimi-tide-settings select, .kimi-tide-settings textarea { font-size: 12px; padding: 2px 6px;
      border: 1px solid var(--dsw-alias-border-l2, #d4d9e3); border-radius: 6px; background: var(--dsw-alias-bg-base, #fff);
      color: var(--dsw-alias-label-primary, #2b3245); }
    .kimi-tide-settings .kt-advanced { display: flex; flex-direction: column; gap: 6px; }
    .kimi-tide-settings .kt-row.kt-json { align-items: flex-start; }
    .kimi-tide-settings .kt-json textarea { flex: 1; min-height: 48px; font-family: inherit; resize: vertical; }
  `
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove())
}
