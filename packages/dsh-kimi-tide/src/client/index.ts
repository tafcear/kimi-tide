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
import { mountEffortCatalog, type EffortCatalogFetcher } from './effort-remote.js'

export const inject = ['slots', 'remote', 'remote.commands']

/** Minimal structural face of the browser locale service (dsh-client-locale). */
interface LocaleFace {
  register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string, params?: Record<string, unknown>) => string
}

const LOCALE_NS = 'settings.kimi-tide'

export function apply(ctx: Context): void {
  // 0.8.0 effort 档位目录：$mount 手工贡献，失败降级为空表（卡片显示
  // 「跟随默认」禁用态）。catch 显式吞掉——绝不产生 unhandled rejection。
  const effortFetcher: Promise<EffortCatalogFetcher> = mountEffortCatalog(ctx.remote).catch(
    (error: unknown) => {
      console.warn(`[kimi-tide] effort 档位目录不可用（${error instanceof Error ? error.message : String(error)}）`)
      return async () => ({})
    },
  )

  // Wire the bridge so TideDock can call remote commands without receiving ctx as a prop.
  // The commands/execute contract differs by host version:
  //   - rc.8 (web): (agent, line, images) — images is a required business arg;
  //     a 2-arg call rejects with "expected 3 business argument(s)... got 2".
  //   - desktop 4.0.1+ (dsh-api-gateway): (agent, line) plus an OPTIONAL trailing
  //     caller AbortSignal — a third positional [] is parsed as the signal and
  //     every call fails with "Failed to convert value to 'AbortSignal'"
  //     (2026-08-21 live diagnosis: all panel commands dead on desktop).
  // Try the 2-arg form first; fall back to the rc.8 3-arg form only when the
  // gateway reports the 3-business-argument arity error.
  const commands = (ctx as unknown as { remote: { commands: { execute: (sid: string, l: string, images?: never[]) => Promise<unknown> } } }).remote.commands
  tideDockBridge.execute = (sessionId, line) =>
    commands.execute(sessionId, line).catch((cause: unknown) =>
      /expected 3 business argument/.test(String(cause)) ? commands.execute(sessionId, line, []) : Promise.reject(cause))

  // Settings-card nav label (spec §3.1): locale-bound `t('nav')` like the
  // official Models section, falling back to the hardcoded copy when the
  // locale service is absent (it is not in this plugin's inject, so its
  // absence must not block activation).
  const locale = ctx.get('locale') as LocaleFace | undefined
  let navLabel = (): string => '月汐'
  if (locale?.register !== undefined && locale?.bind !== undefined) {
    ctx.effect(() => locale.register(LOCALE_NS, {
      zh: { nav: '月汐' },
      en: { nav: 'Kimi Tide' },
    }))
    const t = locale.bind(LOCALE_NS)
    navLabel = () => t('nav')
  }

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'kimi-tide',
    order: 10, // after the shipped stats line (order 0)
    label: '月汐',
  }, TideDock))

  // 设置页「月汐」卡片。settingsScope / connection 均为可选读取：bind 在
  // inject 内惰性执行（挂载到卡片时才绑定，不因宿主缺服务而阻塞本插件激活）。
  // 候选「不可用」灰态：settings.section 是 root 作用域 slot，拿不到 session
  // 级 'kimi-tide/panel' 投影，故由 card-store 经 connection.api.llm.models
  // （宿主模型目录，session 无关，设置页 Models 官方先例同通道）拉取可用性
  // （验收⑥修复）；无 connection 通道时降级为无灰态。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'kimi-tide-router',
    order: 100,
    label: navLabel,
    inject: () => ({
      scope: (ctx.get('settingsScope') as { bind?: (spec: { namespace: string }) => unknown } | undefined)
        ?.bind({ namespace: 'kimi-tide-router' }) ?? null,
      connection: (ctx.get('connection') as unknown) ?? null,
      fetchEfforts: () => effortFetcher.then((fetch) => fetch()),
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
    .kimi-tide-dock .kt-decision-toggle { border: 1px dashed var(--dsw-alias-border-l1, #e4e7ee); }

    /* ---- settings card（设置页「月汐」，0.5.0 预设管理器）---- */
    .kimi-tide-settings { display: flex; flex-direction: column; gap: 10px; font-size: 12px;
      color: var(--dsw-alias-label-primary, #2b3245); }
    .kimi-tide-settings .kt-warn { color: var(--dsw-alias-warning-strong, #d97706); }
    .kimi-tide-settings .kt-h { font-size: 11px; opacity: 0.65; }
    .kimi-tide-settings .kt-hint { opacity: 0.6; }
    .kimi-tide-settings .kt-field-label { width: 108px; flex: none; opacity: 0.85; }
    .kimi-tide-settings .kt-row { display: flex; align-items: center; gap: 6px; }
    /* 预设选择行（关闭/各预设单选按钮组） */
    .kimi-tide-settings .kt-preset-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .kimi-tide-settings .kt-preset { font-size: 12px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      background: transparent; color: inherit; border-radius: 6px; padding: 2px 10px; }
    .kimi-tide-settings .kt-preset.kt-active { background: var(--dsw-alias-interactive-bg-hover-accent, rgba(77,107,254,0.12));
      color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: currentColor; }
    /* 当前预设编辑器 + 规则表 */
    .kimi-tide-settings .kt-editor { display: flex; flex-direction: column; gap: 6px; }
    .kimi-tide-settings .kt-rules { display: flex; flex-direction: column; gap: 4px; }
    .kimi-tide-settings .kt-rule-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .kimi-tide-settings .kt-unavailable { opacity: 0.5; }
    /* 预设操作行 + 规则行按钮 */
    .kimi-tide-settings .kt-preset-ops { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .kimi-tide-settings .kt-preset-ops button, .kimi-tide-settings .kt-rule-row button,
    .kimi-tide-settings .kt-rules > button, .kimi-tide-settings .kt-groups button {
      font-size: 12px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      background: transparent; color: inherit; border-radius: 6px; padding: 1px 8px; }
    .kimi-tide-settings button:disabled { opacity: 0.5; cursor: default; }
    /* 关键词组管理区 */
    .kimi-tide-settings .kt-groups { display: flex; flex-direction: column; gap: 6px; }
    .kimi-tide-settings .kt-group-row { display: flex; align-items: flex-start; gap: 6px; }
    .kimi-tide-settings .kt-group-row textarea { flex: 1; min-height: 40px; font-family: inherit; resize: vertical; }
    .kimi-tide-settings .kt-target-wrap { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
    .kimi-tide-settings .kt-target-wrap select { flex: 1; min-width: 0; }
    .kimi-tide-settings .kt-target-missing { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .kimi-tide-settings input, .kimi-tide-settings select, .kimi-tide-settings textarea { font-size: 12px; padding: 2px 6px;
      border: 1px solid var(--dsw-alias-border-l2, #d4d9e3); border-radius: 6px; background: var(--dsw-alias-bg-base, #fff);
      color: var(--dsw-alias-label-primary, #2b3245); }
  `
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove())
}
