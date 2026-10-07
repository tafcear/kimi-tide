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
    .kimi-tide-settings { position: relative; display: flex; flex-direction: column; gap: 8px; font-size: 12px;
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
    /* ---- Task 7 修复轮 1：分工表角色行 + 主驱动卡（新增编辑区样式补齐，沿用 kt-* 体系）---- */
    .kimi-tide-settings .kt-roles, .kimi-tide-settings .kt-driver { display: flex; flex-direction: column; gap: 6px; }
    .kimi-tide-settings .kt-roles summary, .kimi-tide-settings .kt-driver summary { cursor: pointer; opacity: 0.85; }
    .kimi-tide-settings .kt-roles > .kt-hint, .kimi-tide-settings .kt-driver > .kt-hint { margin: 0; }
    /* 角色行：短字段定宽、长字段（队友名/别名）与目标下拉弹性伸展；行间虚线分隔 */
    .kimi-tide-settings .kt-role-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 5px 0; }
    .kimi-tide-settings .kt-role-row + .kt-role-row { border-top: 1px dashed var(--dsw-alias-border-l1, #e4e7ee); }
    .kimi-tide-settings .kt-role-row .kt-role-label { width: 84px; flex: none; }
    .kimi-tide-settings .kt-role-row .kt-role-id { width: 110px; flex: none; }
    .kimi-tide-settings .kt-role-row .kt-role-names { flex: 1; min-width: 140px; }
    .kimi-tide-settings .kt-role-row .kt-target-wrap { flex: 1 1 160px; }
    /* 分工表行内按钮（删除/新增角色/填入三条示例）：与关键词组按钮同款描边壳 + 紫 hover */
    .kimi-tide-settings .kt-roles button { font-size: 12px; cursor: pointer;
      border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      background: transparent; color: inherit; border-radius: 6px; padding: 1px 8px;
      transition: background 0.12s ease, border-color 0.12s ease; }
    .kimi-tide-settings .kt-roles button:hover:not(:disabled) {
      background: var(--kt-accent-soft); border-color: var(--kt-accent-line); }
    /* 主驱动卡：目标行下拉弹性占满余宽；开关行复用 .kt-row / .kt-field-label 既有规则 */
    .kimi-tide-settings .kt-driver-row { display: flex; align-items: center; gap: 6px; }
    .kimi-tide-settings .kt-driver-row .kt-target-wrap { flex: 1; min-width: 0; }
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
    /* 2026-09-15 v2（评审 M1/M2）：页签可见性 = 每页签一个 .kt-tabpanel 容器 + hidden 属性。
       旧的 data-tab :not() 链**退役**——那套写法正是「测试场藏错误横幅 / 藏已保存」
       两起 bug 的成因；容器方案下 .kt-tabs/.kt-error/.kt-saved 在容器之外，任何页签都可见。
       作者级 [hidden] 兜底必须带 !important：容器上的 display 会压过 UA 的 [hidden]。 */
    .kimi-tide-settings > .kt-tabpanel { display: block; }
    .kimi-tide-settings > .kt-tabpanel[hidden] { display: none !important; }
    /* 说明页（只读）：分区折叠 + 条目列表 + 状态感知行 */
    .kimi-tide-settings .kt-help-sec { margin-bottom: 8px; }
    .kimi-tide-settings .kt-help-entry { padding: 6px 0;
      border-top: 1px dashed var(--dsw-alias-border-l1, #e4e7ee); }
    .kimi-tide-settings .kt-help-entry:first-of-type { border-top: none; }
    .kimi-tide-settings .kt-help-title { font-size: 12px; font-weight: 600; }
    .kimi-tide-settings .kt-help-body { margin: 4px 0 0; padding-left: 18px; font-size: 12px;
      color: var(--dsw-alias-label-secondary, #8b93a7); }
    .kimi-tide-settings .kt-help-live { margin-top: 4px; font-size: 12px;
      color: var(--kt-accent-strong); }
    .kimi-tide-settings .kt-saved { font-size: 11px; color: var(--kt-accent-strong); }
    /* 1.4.1：状态位脱离文档流（实机反馈：每次落盘闪现都把下方内容顶下去再弹回）。
       锚在卡片右上——页签行右侧的空白区，芯片短、不会压到页签；错误文案可能较长，
       限宽 50% 并右对齐换行，仍不参与布局（出现/消失零位移）。 */
    .kimi-tide-settings .kt-status-slot { position: absolute; top: 0; right: 0; z-index: 3;
      display: flex; align-items: center; justify-content: flex-end; gap: 8px;
      max-width: 50%; text-align: right; }
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
    /* ---- v1.4.x 紧凑态：输入工具行右端（提交按钮左侧）一行两个小按钮 ----
       工具行本身是紧凑控件带（权限/模型/语音），故这里只保留最小高度与最大宽度：
       超出用 ellipsis 收在芯片内，绝不换行、不推挤旁边的宿主控件。 */
    .kimi-tide-dock.kt-dock-c { flex-direction: row; align-items: center; gap: 6px;
      min-width: 0; max-width: 320px; font-size: 12px; }
    .kimi-tide-dock.kt-dock-c .kt-c-main { display: inline-flex; align-items: center; gap: 4px;
      min-width: 0; max-width: 220px; height: 26px; padding: 0 8px; border-radius: 8px;
      border: 1px solid var(--dsw-alias-border-l1, #e4e7ee); background: transparent;
      color: var(--dsw-alias-label-secondary, #8b93a7); font: inherit; font-size: 12px; cursor: pointer; }
    .kimi-tide-dock.kt-dock-c .kt-c-main:hover { background: var(--kt-accent-soft, rgb(139 111 244 / 0.14));
      border-color: var(--kt-accent-line, rgb(139 111 244 / 0.45)); }
    .kimi-tide-dock.kt-dock-c .kt-c-main.kt-armed { border-style: solid;
      border-color: var(--kt-accent-line, rgb(139 111 244 / 0.45)); color: var(--kt-accent-strong, #7c5cf0); }
    .kimi-tide-dock.kt-dock-c .kt-c-preset { flex: none; font-weight: 600;
      color: var(--dsw-alias-label-primary, #2b3245); }
    .kimi-tide-dock.kt-dock-c .kt-c-warn { display: inline-flex; flex: none;
      color: var(--dsw-alias-warning-strong, #d97706); }
    .kimi-tide-dock.kt-dock-c .kt-c-quota { display: inline-flex; align-items: center; gap: 4px;
      flex: none; height: 26px; padding: 0 8px; border-radius: 8px;
      border: 1px solid var(--dsw-alias-border-l1, #e4e7ee); background: transparent;
      color: var(--dsw-alias-label-secondary, #8b93a7); font-size: 11.5px; cursor: pointer;
      font-variant-numeric: tabular-nums; }
    .kimi-tide-dock.kt-dock-c .kt-c-quota:hover { background: var(--kt-accent-soft, rgb(139 111 244 / 0.14));
      border-color: var(--kt-accent-line, rgb(139 111 244 / 0.45)); }
    .kimi-tide-dock.kt-dock-c .kt-c-quota.kt-armed { border-color: var(--kt-accent-line, rgb(139 111 244 / 0.45));
      color: var(--kt-accent-strong, #7c5cf0); }
    .kimi-tide-dock.kt-dock-c .kt-c-state { white-space: nowrap; }
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
    /* Task 6 派发摘要槽：字号随 r2 行级 11.5px（同其他 .kt-slot）；超长省略号——
       截断落在内层 .kt-ellip 文本 span（评审 A6：flex 容器上 text-overflow 无效）。 */
    .kimi-tide-dock .kt-dispatch { overflow: hidden; }
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
    /* 2026-09-15 配额条改「剩余」语义：快耗尽 = 短条，故条身随警示/危险色一起变
       （currentColor 继承槽位的 .kt-warn/.kt-danger color），红色信号不再只落在图标上。 */
    .kimi-tide-dock .kt-quota-slot.kt-warn .kt-quota-bar i,
    .kimi-tide-dock .kt-quota-slot.kt-danger .kt-quota-bar i { background: currentColor; }
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
    /* 总览入口按钮（独立类，勿复用 .kt-refresh——那是刷新按钮的测试钩子，
       2026-09-15 实测复用会让 .kt-refresh 选择器同时命中两个元素） */
    .kimi-tide-dock .kt-ov-toggle { display: inline-flex; align-items: center; padding: 0;
      border: 0; background: transparent; color: inherit; cursor: pointer; }
    /* 用量总览（spec §6.2）：一屏列全部源；无数据行置灰但恒渲染（结构恒定） */
    .kt-dock-pop.kt-ov { width: min(360px, calc(100vw - 16px)); }
    .kt-ov-list { list-style: none; margin: 6px 0 0; padding: 0;
      display: flex; flex-direction: column; gap: 4px; }
    .kt-ov-row { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
    .kt-ov-row.kt-dim { opacity: 0.55; }
    .kt-ov-provider { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kt-ov-kind { flex: none; font-size: 11px; color: var(--dsw-alias-label-secondary, #8b93a7); }
    .kt-ov-value { flex: none; font-variant-numeric: tabular-nums; }
    .kt-ov-when { flex: none; font-size: 11px; color: var(--dsw-alias-label-secondary, #8b93a7); }

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
    /* ---- v1.4.0 评审闭环：结论标签 + 「让它重做」 + 退回卡 ---- */
    .kt-review-verdict { flex: none; font-size: 11px; padding: 0 6px; border-radius: 6px;
      border: 1px solid currentColor; opacity: 0.85; }
    .kt-review-verdict-pass { color: var(--dsw-alias-success-strong, #2f9e63); }
    .kt-review-verdict-conditional { color: var(--dsw-alias-warning-strong, #b8760a); }
    .kt-review-verdict-fail { color: var(--dsw-alias-danger-strong, #e5484d); }
    .kt-review-verdict-unknown { color: var(--dsw-alias-label-tertiary, #8b93a7); }
    .kt-review-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .kt-review-revise { font: inherit; font-size: 12px; padding: 2px 10px; cursor: pointer;
      border-radius: 6px; color: var(--kt-accent-strong, #7c5cf0);
      border: 1px solid var(--kt-accent-line, rgb(139 111 244 / 0.45));
      background: transparent; }
    .kt-review-revise:hover:not(:disabled) { background: rgb(139 111 244 / 0.12); }
    .kt-review-revise:disabled { cursor: default; opacity: 0.5; }
    .kt-review-note { font-size: 11px; min-width: 0; overflow-wrap: break-word; opacity: 0.8; }
    .kt-revise-card { gap: 4px; }
    .kt-revise-badge { color: var(--kt-accent-strong, #7c5cf0); }
    .kt-revise-card-stopped { border-color: var(--dsw-alias-border-l2, #d4d9e3);
      background: rgb(148 163 184 / 0.10); }
    .kt-revise-card-stopped .kt-revise-badge { color: var(--dsw-alias-label-secondary, #8b93a7); }
    .kt-revise-summary { font-size: 11px; opacity: 0.85; }

    /* ---- A 项路由决策链（2026-10-07 设计稿 §4/§9）：顶部摘要 + 五档竖直链 +
       空状态 + 词表接线徽标。§9.2 硬规则：档位区分只靠布局与语义分层（底色/透明
       度/状态字），禁第二道边框与阴影；圆角消费 --dsw-radius-* token、描边/文字
       色消费 --dsw-alias-* token（沿用本文件 var(token, 回退) 惯例）。 ---- */
    /* 路由页面板本体改 flex 列：链/摘要/操作行之间保持 8px 节奏（[hidden] 兜底
       规则带 !important，页签切换不受影响） */
    .kimi-tide-settings > .kt-tabpanel.kt-route { display: flex; flex-direction: column; gap: 8px; }
    .kimi-tide-settings .kt-route-summary { margin: 0; font-size: 12px; line-height: 1.6;
      color: var(--dsw-alias-label-secondary, #8b93a7); }
    .kimi-tide-settings .kt-chain { list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 4px; }
    .kimi-tide-settings .kt-tier { display: flex; flex-direction: column; gap: 3px;
      padding: 6px 8px; border-radius: var(--dsw-radius-md, 12px); }
    /* 激活档位：品牌紫微底（语义分层的主手段；未激活档靠降透明度 + 状态字区分，
       不加边框、不加阴影——§9.2） */
    .kimi-tide-settings .kt-tier:not(.kt-tier-off) { background: var(--kt-accent-soft); }
    .kimi-tide-settings .kt-tier-off { opacity: 0.55; }
    .kimi-tide-settings .kt-tier-head { display: flex; align-items: center; gap: 6px; }
    .kimi-tide-settings .kt-tier-no { flex: none; width: 16px; height: 16px; font-size: 11px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: var(--dsw-radius-xs, 4px); background: var(--kt-accent);
      color: #fff; font-variant-numeric: tabular-nums; }
    .kimi-tide-settings .kt-tier-title { font-size: 12.5px; font-weight: 600;
      color: var(--dsw-alias-label-primary, #2b3245); }
    .kimi-tide-settings .kt-tier-state { font-size: 11px;
      color: var(--dsw-alias-label-tertiary, #8b93a7); }
    .kimi-tide-settings .kt-tier-line { margin: 0; font-size: 11.5px; display: flex; gap: 6px;
      color: var(--dsw-alias-label-secondary, #8b93a7); }
    .kimi-tide-settings .kt-tier-tag { flex: none; opacity: 0.7; }
    /* A-④ 空状态：rules 为空不再是空表——明示「全部走打底」与悬空词表数量 */
    .kimi-tide-settings .kt-rules-empty { display: flex; flex-direction: column; gap: 2px;
      font-size: 12px; color: var(--dsw-alias-label-secondary, #8b93a7);
      border-top: 1px dashed var(--dsw-alias-border-l1, #e4e7ee); padding-top: 4px; }
    /* A-⑤ 词表接线徽标：三态色调（被引用=中性描边、被流认领=品牌紫、悬空=警示色） */
    .kimi-tide-settings .kt-wire { flex: none; font-size: 11px; padding: 0 6px;
      border-radius: var(--dsw-radius-sm, 8px);
      border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      color: var(--dsw-alias-label-secondary, #8b93a7); }
    .kimi-tide-settings .kt-wire-flow { color: var(--kt-accent-strong);
      border-color: var(--kt-accent-line); background: var(--kt-accent-soft); }
    .kimi-tide-settings .kt-wire-warn { color: var(--dsw-alias-warning-strong, #d97706);
      border-color: var(--dsw-alias-warning-strong, #d97706); }
    /* B 项（2026-10-07 §5）：行容器（词表行/角色行 + 其下挂的重叠解释条） */
    .kimi-tide-settings .kt-group-item { display: flex; flex-direction: column; gap: 4px; }
    /* B-③ 重叠解释条：解释不是报错——中性虚线描边 + 次级文字（区别于
       kt-conflict-banner 的警示色实底）；圆角消费 token，禁本地字面量（§9.2） */
    .kimi-tide-settings .kt-overlap { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      font-size: 11px; color: var(--dsw-alias-label-secondary, #8b93a7);
      border: 1px dashed var(--dsw-alias-border-l1, #e4e7ee);
      border-radius: var(--dsw-radius-sm, 8px); padding: 4px 8px; }
  `
