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
import { fetchEffortsViaDescribe } from './effort-remote.js'

export const inject = ['slots', 'remote', 'remote.commands']

/** Minimal structural face of the browser locale service (dsh-client-locale). */
interface LocaleFace {
  register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string, params?: Record<string, unknown>) => string
}

const LOCALE_NS = 'settings.kimi-tide'

export function apply(ctx: Context): void {
  // 0.8.0 effort 档位表（B5 换道 2026-08-27）：客户端经 settings.describe 读
  // kimi-tide-catalog 命名空间（宿主枚举刷新时写入）。原 typert $mount 手工
  // 贡献通道实机证伪（vendored kernel 静默挂起），已弃用——见 effort-remote.ts
  // 头注。取数失败由 card-store.loadEfforts 降级（下拉「跟随默认」禁用态）。

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
      fetchEfforts: () => fetchEffortsViaDescribe(
        (ctx.get('connection') as Parameters<typeof fetchEffortsViaDescribe>[0]) ?? null,
      ).catch(() => ({})),
      // 0.8.x④：绑 catalog 命名空间 scope 作变更信号（官方 document-updated
      // 推送缝）——宿主 adapters 刷新重写档位表时卡片重取 efforts。
      catalogScope: ((ctx.get('settingsScope') as { bind?: (spec: { namespace: string }) => unknown } | undefined)
        ?.bind({ namespace: 'kimi-tide-catalog' }) ?? null) as { subscribe(listener: () => void): () => void } | null,
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

    /* ---- settings card（设置页「月汐」，0.5.0 预设管理器；⑥-B 打磨三 2026-08-29
         卡片化 + 8px 节奏 + 字号分级 11/12/12.5）---- */
    .kimi-tide-settings { display: flex; flex-direction: column; gap: 8px; font-size: 12px;
      color: var(--dsw-alias-label-primary, #2b3245); }
    .kimi-tide-settings .kt-warn { color: var(--dsw-alias-warning-strong, #d97706); }
    .kimi-tide-settings .kt-h { font-size: 11px; opacity: 0.65; }
    .kimi-tide-settings .kt-hint { opacity: 0.6; }
    .kimi-tide-settings .kt-field-label { width: 108px; flex: none; opacity: 0.85; }
    .kimi-tide-settings .kt-row { display: flex; align-items: center; gap: 6px; }
    /* 区块卡片化：规则/带图兜底/试一句/关键词组/协作流 */
    .kimi-tide-settings .kt-card { border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      border-radius: 10px; padding: 8px 10px; }
    .kimi-tide-settings .kt-card-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
    .kimi-tide-settings .kt-card-title { font-size: 12.5px; font-weight: 600;
      color: var(--dsw-alias-label-primary, #2b3245); }
    /* 预设选择行（关闭/各预设单选按钮组） */
    .kimi-tide-settings .kt-preset-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .kimi-tide-settings .kt-preset { font-size: 12px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      background: transparent; color: inherit; border-radius: 6px; padding: 2px 10px; }
    .kimi-tide-settings .kt-preset.kt-active { background: var(--dsw-alias-interactive-bg-hover-accent, rgba(77,107,254,0.12));
      color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: currentColor; }
    /* 当前预设编辑器 + 规则表（紧凑表格：序/条件/目标/档位/操作，所见即优先级）；
       单一表格容器共享列轨 + 行 subgrid——表头与数据列对齐（⑥-B 打磨三修订） */
    .kimi-tide-settings .kt-editor { display: flex; flex-direction: column; gap: 8px; }
    .kimi-tide-settings .kt-rules { display: flex; flex-direction: column; gap: 6px; }
    .kimi-tide-settings .kt-rule-table { display: grid;
      grid-template-columns: 20px minmax(0, 1.15fr) minmax(0, 1.3fr) 92px auto;
      gap: 4px 6px; align-items: center; }
    .kimi-tide-settings .kt-rule-grid { display: grid; grid-template-columns: subgrid;
      grid-column: 1 / -1; }
    .kimi-tide-settings .kt-rule-head { font-size: 11px; font-weight: 600;
      color: var(--dsw-alias-label-tertiary, #8b93a7);
      padding-bottom: 3px; border-bottom: 1px dashed var(--dsw-alias-border-l1, #e4e7ee); }
    .kimi-tide-settings .kt-rule-no { font-size: 11px; opacity: 0.6;
      font-variant-numeric: tabular-nums; text-align: center; }
    .kimi-tide-settings .kt-cond { display: inline-flex; align-items: center; gap: 4px;
      min-width: 0; flex-wrap: nowrap; }
    .kimi-tide-settings .kt-cond select { min-width: 0; flex: 1 1 60px; }
    .kimi-tide-settings .kt-cond .kt-minhits { width: 44px; flex: none; }
    .kimi-tide-settings .kt-cell { display: inline-flex; align-items: center; min-width: 0; }
    .kimi-tide-settings .kt-cell .kt-target-wrap { width: 100%; }
    .kimi-tide-settings .kt-ops { display: inline-flex; gap: 4px; }
    /* 条件互斥：存量重复行标警示 + 顶部警示条 + 阻止提示 */
    .kimi-tide-settings .kt-rule-row.kt-conflict { background: rgba(217, 119, 6, 0.07); border-radius: 6px; }
    .kimi-tide-settings .kt-conflict-hint { grid-column: 1 / -1; font-size: 11px;
      color: var(--dsw-alias-warning-strong, #d97706); }
    .kimi-tide-settings .kt-conflict-banner { display: flex; align-items: center;
      justify-content: space-between; gap: 8px; font-size: 11.5px;
      border: 1px solid rgba(217, 119, 6, 0.4); background: rgba(217, 119, 6, 0.08);
      border-radius: 8px; padding: 4px 8px; }
    .kimi-tide-settings .kt-rule-conflict-msg { font-size: 11.5px; }
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
    /* ---- 协作流注册表 + 试一句 + 间隙控件（0.6.x池#8 样式欠账补齐）---- */
    .kimi-tide-settings .kt-flows { display: flex; flex-direction: column; gap: 6px; }
    .kimi-tide-settings .kt-flows summary, .kimi-tide-settings .kt-trial summary { cursor: pointer; opacity: 0.85; }
    .kimi-tide-settings .kt-flow-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .kimi-tide-settings .kt-flow-badge { flex: none; font-size: 11px; padding: 0 6px; border-radius: 6px;
      border: 1px solid var(--dsw-alias-border-l1, #e4e7ee); opacity: 0.85; }
    .kimi-tide-settings .kt-flow-new { opacity: 0.95; }
    .kimi-tide-settings .kt-fallback { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .kimi-tide-settings .kt-minhits { width: 64px; }
    .kimi-tide-settings .kt-trial { display: flex; flex-direction: column; gap: 4px; }
    .kimi-tide-settings .kt-trial-hit { opacity: 0.9; }
    .kimi-tide-settings .kt-trial-result { display: flex; flex-direction: column; gap: 2px; }
    .kimi-tide-settings .kt-trial-outcome { opacity: 0.9; }
    /* ---- ⑥-B 三页签（data-tab 可见性切换；区块保持挂载）---- */
    .kimi-tide-settings .kt-tabs { display: flex; gap: 4px; }
    .kimi-tide-settings .kt-tab { font-size: 12px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      background: transparent; color: var(--dsw-alias-label-secondary, #8b93a7); border-radius: 8px; padding: 3px 14px; }
    .kimi-tide-settings .kt-tab-on { background: var(--dsw-alias-interactive-bg-hover-accent, rgba(77,107,254,.12));
      color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: currentColor; font-weight: 600; }
    .kimi-tide-settings[data-tab='route'] > .kt-trial, .kimi-tide-settings[data-tab='route'] > .kt-flows,
    .kimi-tide-settings[data-tab='flows'] > :not(.kt-flows):not(.kt-tabs),
    .kimi-tide-settings[data-tab='trial'] > :not(.kt-trial):not(.kt-tabs) { display: none; }
    /* ---- ⑥-B dock 两行（2026-08-29 打磨：骨架恒定）---- */
    .kimi-tide-dock.kt-dock-b { flex-direction: column; align-items: stretch; row-gap: 4px; }
    /* r1 锁单行：决策原因不进文本流（在开关 title 里），长原因不再挤换行 */
    .kimi-tide-dock .kt-dock-r1 { display: flex; align-items: center; gap: 8px; width: 100%;
      white-space: nowrap; overflow: hidden; }
    .kimi-tide-dock .kt-dock-r1-end { margin-left: auto; flex: none; }
    /* r2 槽位常驻：左=额度槽+图像上下文，右贴=取数时间+刷新（对比稿欠账补齐） */
    .kimi-tide-dock .kt-dock-r2 { display: flex; align-items: center; gap: 10px; width: 100%;
      white-space: nowrap; font-size: 11.5px; border-top: 1px dashed var(--dsw-alias-border-l1, #e4e7ee); padding-top: 4px; }
    .kimi-tide-dock .kt-dock-r2-end { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; flex: none; }
    .kimi-tide-dock .kt-slot { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
    .kimi-tide-dock .kt-chip { white-space: nowrap; }
    .kimi-tide-dock .kt-ellip { overflow: hidden; text-overflow: ellipsis; }
    .kimi-tide-dock .kt-dim { opacity: 0.45; }
    .kimi-tide-dock .kt-route-arrow { color: var(--dsw-alias-label-tertiary, #8b93a7); flex: none; }
    .kimi-tide-dock .kt-route-target { color: var(--dsw-alias-brand-primary, #4d6bfe); font-weight: 600; }
    /* 图标语义色（⑥-B 打磨二轮 2026-08-29）：色彩即语义，明暗主题双适配；
       额度槽告警/危险态（≥80%/90%）下图标回归 chip 色——「越用越红」不被覆盖 */
    .kimi-tide-dock .kt-ic-moon { color: #a78bfa; }
    .kimi-tide-dock .kt-ic-route { color: #0ea5e9; }
    .kimi-tide-dock .kt-ic-base { color: #94a3b8; }
    .kimi-tide-dock .kt-ic-target, .kimi-tide-dock .kt-ic-compass,
    .kimi-tide-dock .kt-ic-calendar { color: var(--dsw-alias-brand-primary, #4d6bfe); }
    .kimi-tide-dock .kt-ic-gauge { color: #14b8a6; }
    .kimi-tide-dock .kt-ic-image { color: #f59e0b; }
    .kimi-tide-dock .kt-quota-slot.kt-warn .kt-ic-calendar, .kimi-tide-dock .kt-quota-slot.kt-danger .kt-ic-calendar,
    .kimi-tide-dock .kt-quota-slot.kt-warn .kt-ic-gauge, .kimi-tide-dock .kt-quota-slot.kt-danger .kt-ic-gauge { color: inherit; }
    .kimi-tide-dock .kt-quota-bar { display: inline-block; width: 46px; height: 4px; flex: none;
      border-radius: 4px; background: var(--dsw-alias-border-l1, #e4e7ee); margin: 0 2px; overflow: hidden; }
    .kimi-tide-dock .kt-quota-bar i { display: block; height: 100%;
      background: var(--dsw-alias-brand-primary, #4d6bfe); border-radius: 4px; }
    /* 决策面板 portal 悬浮层（挂 body，选择器不嵌 .kimi-tide-dock） */
    .kt-dock-pop { position: fixed; z-index: 10000; width: min(430px, calc(100vw - 16px));
      max-height: min(320px, 60vh); overflow: auto; padding: 8px 10px; font-size: 12px;
      background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #fff));
      border: 1px solid var(--dsw-alias-border-l2, #d4d9e3); border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16); color: var(--dsw-alias-label-primary, #2b3245); }
    .kt-dock-pop .kt-reason { border-top: none; padding: 0; gap: 5px; }
  `
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove())
}
