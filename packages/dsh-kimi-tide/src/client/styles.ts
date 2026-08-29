/**
 * Plugin CSS 正文（从 client/index.ts 搬出，2026-08-29）。
 * 导出为常量供结构钉测试（test/ClientStyles.test.ts）逐字断言——
 * 决策面板 portal 挂 body，布局关键属性必须留在裸选择器上（评审 P1-1）。
 */
export const CLIENT_CSS = `
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
    /* 决策原因块：布局属性放裸选择器——portal（挂 body）与 dock 内联双上下文
       通吃（2026-08-29 评审 P1-1：嵌前缀致 portal 面板退化为行内流） */
    .kt-reason { display: flex; flex-direction: column; gap: 4px; }
    .kimi-tide-dock .kt-reason { padding: 4px 0;
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
