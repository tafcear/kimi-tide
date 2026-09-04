/**
 * Plugin CSS 正文（从 client/index.ts 搬出，2026-08-29）。
 * 导出为常量供结构钉测试（test/ClientStyles.test.ts）逐字断言——
 * 决策面板 portal 挂 body，布局关键属性必须留在裸选择器上（评审 P1-1）。
 */
export const CLIENT_CSS = `
    /* ---- 月汐品牌主题化（2026-08-29 用户裁定）：单一紫 + 透明度派生，
       alpha 混合天然适配明暗双主题（宿主无主题分支代码，沿用 token 哲学）。
       注意：决策面板 portal 挂 body——.kt-dock-pop 自带同名变量副本（P1-1 教训）---- */
    .kimi-tide-dock, .kimi-tide-settings, .kt-dock-pop {
      --kt-accent: #8b6ff4;
      --kt-accent-soft: rgb(139 111 244 / 0.14);
      --kt-accent-line: rgb(139 111 244 / 0.45);
      --kt-accent-strong: #7c5cf0;
    }
    /* ---- dock（只读仪表）---- */
    .kimi-tide-dock { display: flex; align-items: center; gap: 10px; font-size: 12px;
      color: var(--dsw-alias-label-tertiary, #8b93a7); flex-wrap: wrap; }
    .kimi-tide-dock .kt-label { font-weight: 600; color: var(--dsw-alias-label-primary, #2b3245); }
    .kimi-tide-dock .kt-warn { color: var(--dsw-alias-warning-strong, #d97706); }
    .kimi-tide-dock .kt-danger { color: var(--dsw-alias-danger-strong, #e5484d); }
    .kimi-tide-dock .kt-stale { opacity: 0.55; }
    .kimi-tide-dock button { font-size: 12px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      background: transparent; color: inherit; border-radius: 6px; padding: 1px 8px;
      transition: background 0.12s ease, border-color 0.12s ease; }
    .kimi-tide-dock button:hover:not(:disabled) { background: var(--kt-accent-soft); border-color: var(--kt-accent-line); }
    .kimi-tide-dock button:focus-visible { outline: 2px solid var(--kt-accent-line); outline-offset: 1px; }
    .kimi-tide-dock .kt-h { font-size: 11px; opacity: 0.65; margin-top: 2px; }
    .kimi-tide-dock .kt-meta { opacity: 0.85; }
    .kimi-tide-dock .kt-hint { opacity: 0.6; }
    /* 决策原因块：布局属性放裸选择器——portal（挂 body）与 dock 内联双上下文
       通吃（2026-08-29 评审 P1-1：嵌前缀致 portal 面板退化为行内流） */
    .kt-reason { display: flex; flex-direction: column; gap: 4px; }
    .kimi-tide-dock .kt-reason { padding: 4px 0;
      border-top: 1px dashed var(--dsw-alias-border-l1, #e4e7ee); }
    .kimi-tide-dock .kt-decision-chip { color: var(--kt-accent); }
    .kimi-tide-dock .kt-decision-toggle { border: 1px dashed var(--dsw-alias-border-l1, #e4e7ee); }
    /* 决策开关展开态（P2-12 常驻后）：品牌紫强调。 */
    .kimi-tide-dock .kt-decision-toggle.kt-armed { border-style: solid;
      background: var(--kt-accent-soft); border-color: var(--kt-accent-line); }

    /* ---- settings card（设置页「月汐」，0.5.0 预设管理器；⑥-B 打磨三 2026-08-29
         卡片化 + 8px 节奏 + 字号分级 11/12/12.5）---- */
    .kimi-tide-settings { display: flex; flex-direction: column; gap: 8px; font-size: 12px;
      color: var(--dsw-alias-label-primary, #2b3245); }
    .kimi-tide-settings .kt-warn { color: var(--dsw-alias-warning-strong, #d97706); }
    .kimi-tide-settings .kt-h { font-size: 11px; opacity: 0.65; }
    .kimi-tide-settings .kt-hint { opacity: 0.6; }
    .kimi-tide-settings .kt-field-label { width: 108px; flex: none; opacity: 0.85; }
    .kimi-tide-settings .kt-row { display: flex; align-items: center; gap: 6px; }
    /* 区块卡片化：规则/带图兜底/试一句/关键词组/协作流；
       视觉升级：细描边+双层柔影浮起，圆角 12px */
    .kimi-tide-settings .kt-card { border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      border-radius: 12px; padding: 8px 10px;
      box-shadow: 0 1px 2px rgb(20 24 40 / 0.04), 0 4px 12px rgb(20 24 40 / 0.05); }
    /* 主卡（规则表）微品牌底色渐变——层级主角 */
    .kimi-tide-settings .kt-card.kt-rules {
      background: linear-gradient(180deg, var(--kt-accent-soft), transparent 30%); }
    .kimi-tide-settings .kt-card-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
    .kimi-tide-settings .kt-card-title { font-size: 12.5px; font-weight: 600; margin: 0;
      color: var(--dsw-alias-label-primary, #2b3245); }
    /* 预设选择行（关闭/各预设单选按钮组）；激活态=品牌紫描边+淡紫底+加粗 */
    .kimi-tide-settings .kt-preset-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .kimi-tide-settings .kt-preset { font-size: 12px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      background: transparent; color: inherit; border-radius: 6px; padding: 2px 10px;
      transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease; }
    .kimi-tide-settings .kt-preset:hover:not(:disabled):not(.kt-active) {
      background: var(--kt-accent-soft); }
    .kimi-tide-settings .kt-preset.kt-active { background: var(--kt-accent-soft);
      color: var(--kt-accent-strong); border-color: var(--kt-accent-line); font-weight: 600; }
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
    /* 条件互斥：存量重复行标警示 + 顶部警示条 + 阻止提示；
       带图规则行品牌紫微底（呼应「带图恒第一」） */
    .kimi-tide-settings .kt-rule-row.kt-row-image { background: var(--kt-accent-soft); border-radius: 6px; }
    .kimi-tide-settings .kt-rule-row.kt-conflict { background: rgba(217, 119, 6, 0.07); border-radius: 6px; }
    .kimi-tide-settings .kt-conflict-hint { grid-column: 1 / -1; font-size: 11px;
      color: var(--dsw-alias-warning-strong, #d97706); }
    /* 1.1.0 §4 认领提示（A4 载体）：组被 review 流认领 → 规则行灰态 + 行尾一句
       提示；认领与规则共存合法（抑制是自然结果）——纯视觉，不拦保存 */
    .kimi-tide-settings .kt-rule-claimed { opacity: 0.55; }
    .kimi-tide-settings .kt-claimed-hint { grid-column: 1 / -1; font-size: 11px;
      color: var(--dsh-text-muted, #888); margin-left: 6px; }
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
      background: transparent; color: inherit; border-radius: 6px; padding: 1px 8px;
      transition: background 0.12s ease, border-color 0.12s ease; }
    .kimi-tide-settings .kt-preset-ops button:hover:not(:disabled),
    .kimi-tide-settings .kt-rule-row button:hover:not(:disabled),
    .kimi-tide-settings .kt-rules > button:hover:not(:disabled),
    .kimi-tide-settings .kt-groups button:hover:not(:disabled) {
      background: var(--kt-accent-soft); border-color: var(--kt-accent-line); }
    /* 主按钮（新增规则）：品牌紫实心（generic 按钮规则在前，此处更高优先级覆盖） */
    .kimi-tide-settings .kt-rules > button.kt-btn-primary,
    .kimi-tide-settings .kt-btn-primary { background: var(--kt-accent); color: #fff;
      border-color: transparent; font-weight: 600; }
    .kimi-tide-settings .kt-btn-primary:hover:not(:disabled) { background: var(--kt-accent-strong) !important;
      border-color: transparent !important; }
    .kimi-tide-settings button:disabled { opacity: 0.5; cursor: default; }
    /* 焦点紫色外环（此前焦点零视觉反馈） */
    .kimi-tide-settings input:focus-visible, .kimi-tide-settings select:focus-visible,
    .kimi-tide-settings textarea:focus-visible, .kimi-tide-settings button:focus-visible {
      outline: 2px solid var(--kt-accent-line); outline-offset: 1px; }
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
    .kimi-tide-settings .kt-tab-on { background: var(--kt-accent-soft);
      color: var(--kt-accent-strong); border-color: var(--kt-accent-line); font-weight: 600; }
    .kimi-tide-settings[data-tab='route'] > .kt-trial, .kimi-tide-settings[data-tab='route'] > .kt-flows,
    /* 评审 P2-5：错误横幅任何页签可见（此前被 flows 页签的 :not 链藏住） */
    .kimi-tide-settings[data-tab='flows'] > :not(.kt-flows):not(.kt-tabs):not(.kt-error),
    .kimi-tide-settings[data-tab='trial'] > :not(.kt-trial):not(.kt-tabs) { display: none; }
    .kimi-tide-settings .kt-saved { font-size: 11px; color: var(--kt-accent-strong); }
    .kimi-tide-settings .kt-danger { color: var(--dsw-alias-danger-strong, #e5484d); }
    /* 设置导航图标标记：契约无 icon 字段——按文案标记自己的行后，
       CSS 把宿主默认齿轮换成月汐紫月牙（先例：dsh-better-sidebar）。
       导航行在宿主设置对话框内，不在本插件作用域——accent 走回退值 */
    [data-kimi-tide-settings-nav] svg { display: none; }
    [data-kimi-tide-settings-nav]::before { content: ''; width: 16px; height: 16px; flex: none;
      background: var(--kt-accent, #8b6ff4);
      -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z'/%3E%3C/svg%3E") center / contain no-repeat;
      mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z'/%3E%3C/svg%3E") center / contain no-repeat; }
    /* ---- ⑥-B dock 两行（2026-08-29 打磨：骨架恒定）---- */
    .kimi-tide-dock.kt-dock-b { flex-direction: column; align-items: stretch; row-gap: 4px; }
    /* r1 锁单行：决策原因不进文本流（在开关 title 里），长原因不再挤换行 */
    .kimi-tide-dock .kt-dock-r1 { display: flex; align-items: center; gap: 8px; width: 100%;
      white-space: nowrap; overflow: hidden; }
    .kimi-tide-dock .kt-dock-r1-end { margin-left: auto; flex: none; }
    /* r2 槽位常驻：左=额度槽+图像上下文，右贴=取数时间+刷新（对比稿欠账补齐） */
    .kimi-tide-dock .kt-dock-r2 { display: flex; align-items: center; gap: 10px; width: 100%;
      white-space: nowrap; font-size: 11.5px; border-top: 1px dashed var(--dsw-alias-border-l1, #e4e7ee); padding-top: 4px;
      overflow: hidden; }
    .kimi-tide-dock .kt-dock-r2-end { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; flex: none; }
    .kimi-tide-dock .kt-slot { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
    .kimi-tide-dock .kt-chip { white-space: nowrap; }
    /* 评审 A6：ellipsis 作用于内层文本 span（flex 容器上 text-overflow 无效） */
    .kimi-tide-dock .kt-ellip { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .kimi-tide-dock .kt-dim { opacity: 0.45; }
    .kimi-tide-dock .kt-route-arrow { color: var(--dsw-alias-label-tertiary, #8b93a7); flex: none; }
    .kimi-tide-dock .kt-route-target { color: var(--kt-accent-strong); font-weight: 600; }
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
      background: var(--kt-accent); border-radius: 4px; }
    /* 决策面板 portal 悬浮层（挂 body，选择器不嵌 .kimi-tide-dock）；
       视觉升级：月汐紫渐变顶条 + 阴影加深 */
    .kt-dock-pop { position: fixed; z-index: 10000; width: min(430px, calc(100vw - 16px));
      max-height: min(320px, 60vh); overflow: auto; padding: 8px 10px; font-size: 12px;
      background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #fff));
      border: 1px solid var(--dsw-alias-border-l2, #d4d9e3); border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.10);
      color: var(--dsw-alias-label-primary, #2b3245); }
    .kt-dock-pop::before { content: ''; display: block; height: 2px; border-radius: 2px;
      margin: -2px -4px 6px; background: linear-gradient(90deg, var(--kt-accent), rgb(139 111 244 / 0.12)); }
    .kt-dock-pop .kt-reason { border-top: none; padding: 0; gap: 5px; }

    /* ---- 评审卡（1.1.0 §7 会话流渲染；kt-review-* 自有命名不嵌宿主类——
          卡片挂在宿主 chat 行容器内，accent 变量不在 .kimi-tide-dock/.kimi-tide-settings
          作用域，一律带字面回退（设置导航图标先例））---- */
    .kt-review-card { display: flex; flex-direction: column; gap: 6px; font-size: 12px;
      padding: 8px 10px; border-radius: 10px; max-width: 720px;
      border: 1px solid var(--kt-accent-line, rgb(139 111 244 / 0.45));
      background: var(--kt-accent-soft, rgb(139 111 244 / 0.14));
      color: var(--dsw-alias-label-primary, #2b3245);
      box-shadow: 0 1px 2px rgb(20 24 40 / 0.04), 0 4px 12px rgb(20 24 40 / 0.05); }
    .kt-review-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
    .kt-review-badge { flex: none; font-size: 11px; font-weight: 600; padding: 0 8px;
      border-radius: 6px; color: var(--kt-accent-strong, #7c5cf0);
      border: 1px solid var(--kt-accent-line, rgb(139 111 244 / 0.45)); }
    .kt-review-flow { font-size: 11px; opacity: 0.75; overflow: hidden;
      text-overflow: ellipsis; min-width: 0; white-space: nowrap; }
    .kt-review-time { margin-left: auto; flex: none; font-size: 11px;
      font-variant-numeric: tabular-nums; opacity: 0.6; }
    .kt-review-body { margin: 0; font-family: inherit; font-size: 12px; line-height: 1.55;
      white-space: pre-wrap; overflow-wrap: break-word; overflow-y: auto; max-height: 340px; }
    /* 失败卡标灰（spec §7）：品牌紫描边/底全部退中性灰，正文换成 error 行 */
    .kt-review-card.kt-review-card-failed {
      border-color: var(--dsw-alias-border-l2, #d4d9e3);
      background: rgb(148 163 184 / 0.10); }
    .kt-review-card.kt-review-card-failed .kt-review-badge {
      color: var(--dsw-alias-label-tertiary, #8b93a7);
      border-color: var(--dsw-alias-border-l2, #d4d9e3); }
    .kt-review-error { font-size: 12px; line-height: 1.55;
      color: var(--dsw-alias-danger-strong, #e5484d); }
  `
