/**
 * view 表：routing-view.ts（统一路由视图模型）的全部用户可见文案——
 * 默认目标原因、决策链五档 title/detail、行条件/目标标签、带图三态短标签、摘要拼装。
 * 中文逐字保留自 routing-view.ts 原字面量（既有 1000+ 测试断言钉住）；占位符 `{0}`/`{1}`。
 */
export const zh = {
  /* ---- 默认目标行原因（§4.3） ---- */
  'view.fallback.closed': '路由已关闭',
  'view.fallback.presetMissing': '激活预设不存在',
  'view.fallback.driverFollowHost': '主驱动跟随宿主默认',
  'view.fallback.driverSticky': '主驱动恒定（{0}）',
  'view.fallback.presetDefault': '预设「{0}」默认',
  /* ---- 决策链五档（§4.2） ---- */
  'view.tier.at.title': '显式 @指令',
  'view.tier.at.detail': '按需：消息里写 @provider 或 @provider/model 时才参与裁决',
  'view.tier.caller.title': '调用方点名',
  'view.tier.caller.detail': '按需：仅子代理；调用方点名的模型与默认目标不同时保持该模型不变',
  'view.tier.role.title': '分工表角色',
  'view.tier.role.detailClosedWithRoles': '路由已关闭：分工表 {0} 个角色不发生任何改道（仅存档）',
  'view.tier.role.detailClosedEmpty': '路由已关闭（未配置分工表）',
  'view.tier.role.detailActive': '{0} 个角色参与派发改道',
  'view.tier.role.detailEmpty': '未配置分工表（队友不改道）',
  'view.tier.rule.title': '关键词规则',
  'view.tier.rule.detailInactive': '路由未激活',
  'view.tier.rule.detailRules': '预设「{0}」共 {1} 条规则（仅主会话参与）',
  'view.tier.rule.detailEmpty': '预设「{0}」无规则，未命中即使用默认目标',
  'view.tier.fallback.title': '默认目标',
  /* 档 5 detail 的拼接层（全角括号属文案）：{0}=目标键，{1}=原因（P2 补漏）。 */
  'view.tier.fallback.detail': '{0}（{1}）',
  /* ---- 拼接层连接符（摘要用；zh 侧逐字保留，含空格；P2 补漏） ---- */
  'view.join.list': '、',
  'view.join.chunk': ' ｜ ',
  /* ---- 行条件/目标标签（摘要用） ---- */
  'view.label.image': '带图',
  'view.label.flow': '协作流 {0}',
  /* ---- imageFallback 三态短标签：键集与 client/help-content.ts 的 FALLBACK_HINTS
     同组状态名（latch/blind/transcribe-lazy），跨模块测试钉住，别拆。 ---- */
  'view.fallbackShort.latch': '锁存视觉模型',
  'view.fallbackShort.blind': '盲答',
  'view.fallbackShort.transcribeLazy': '懒转述',
  /* ---- 摘要拼装（describeRouting 单源） ---- */
  'view.summary.closed': '路由已关闭：所有请求保持宿主当前模型。',
  'view.summary.presetMissing': '路由已关闭：激活预设不存在。',
  'view.summary.hostDefault': '宿主默认',
  'view.summary.noRules': '主会话没有可命中的规则，全部使用默认目标（{0}）',
  'view.summary.orphanSuffix': '；另有 {0} 组关键词组未接入任何规则，暂不生效',
  'view.summary.ruleItem': '命中「{0}」时改用 {1}',
  'view.summary.mainRules': '主会话以 {0} 为默认目标，{1}',
  'view.summary.dispatch': '派发：{0}',
  'view.summary.dispatchItem': '{0}→{1}',
  'view.summary.image': '带图：{0}',
} as const
