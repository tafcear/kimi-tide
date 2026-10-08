/**
 * shared 表：跨界面共用的 chrome 文案（导航标签、面板取数失败原因），
 * 以及 W6 收口搬迁的四个**宿主/浏览器共享模块**（config/rules/roles/review-verdict）
 * 的全部字符串文案——中文逐字保留自原字面量（既有测试断言钉住），占位符 `{0}`/`{1}`/`{2}`。
 * 中文是唯一真源；键命名 `<surface>.<area>.<name>`，全小写 camelCase 段。
 */
export const zh = {
  'shared.nav': '月汐',
  'shared.panel.fetchFailed': '网络请求失败：{0}',
  'shared.panel.httpError': 'HTTP {0}',
  'shared.panel.invalidJson': '响应体不是合法 JSON',
  'shared.panel.okNotTrue': '路由返回 ok!=true',
  'shared.panel.noPanel': '路由未返回面板数据',
  /* ---- 连接通道诊断（client/index.ts buildConnectionFace；开发者诊断文案，中文逐字保留，P2 补漏） ---- */
  'shared.diag.describeUnavailable': 'settings.describe 通道不可用（connection api 面缺席且 loopback 未挂载）',
  'shared.diag.mutateUnavailable': 'settings.mutate 通道不可用（connection api 面缺席且 loopback 未挂载）',
  'shared.diag.modelsUnavailable': '模型目录通道不可用（session/llm loopback 与 connection api 均缺席）',
  /* ---- config.ts 读边界 warn（纯宿主诊断，浏览器不渲染；W6） ---- */
  'shared.diag.routesRowMalformedRead': 'dsh-kimi-tide: routes 第 {0} 行畸形（非对象或 scope 非法），读路径保守丢弃该行',
  'shared.diag.routesNotArray': 'dsh-kimi-tide: routes 非数组（读路径视为缺失，回落 presets[*].rules / roles 投影）',
  'shared.diag.routesRowMalformedProject': 'dsh-kimi-tide: routes 第 {0} 行畸形（非对象或 scope 非法），投影时保守丢弃该行',
  /* ---- rules.ts：条件标签/摘要与「试一句」outcome 文案（W6） ---- */
  'shared.rules.image': '带图',
  'shared.rules.condition': '命中 {0} 组 ≥{1} 词',
  'shared.rules.off': '路由已关闭',
  'shared.rules.presetMissing': '激活预设不存在',
  'shared.rules.explicit.unknownCatalog': '显式 @{0} 指令（候选目录不可判）',
  'shared.rules.explicit.directive': '显式 @{0}{1} 指令',
  'shared.rules.explicit.fallback': '显式 @{0}{1} 指令（不可用 → 回落）',
  'shared.rules.explicit.configured': '显式 @{0} 指令 → 预设内已配置目标',
  'shared.rules.explicit.catalogFirst': '显式 @{0} 指令 → 目录序首个',
  'shared.rules.ruleHitFlow': '规则「{0}」命中 {1} 词（协作流 {2}）',
  'shared.rules.ruleHit': '规则「{0}」命中 {1} 词',
  'shared.rules.reviewFlow': '轮末触发评审流 {0}',
  'shared.rules.reviewFlowUnavailable': '评审流已认领但评审模型不可用',
  'shared.rules.presetDefault': '预设「{0}」默认',
  /* ---- roles.ts：队友名规则、认领冲突、分工表 skill 拼装（W6） ---- */
  'shared.roles.teammateNameRule': 'lower-kebab-case（小写字母/数字/连字符）、≤64 字符、不得为 lead',
  'shared.roles.claimConflict': '认领名「{0}」同时属于角色「{1}」与「{2}」',
  /* 列表连接符（join 用标点也是文案）：roles 摘要/认领集合/别名拼接共用。 */
  'shared.roles.listJoin': '、',
  'shared.roles.readFirst': '派活前读我：{0}',
  'shared.roles.readFirstOverflow': '派活前读我：共 {0} 个角色（{1}…）',
  'shared.roles.effortSuffix': '（effort {0}）',
  /* ---- 派发护栏（修复路线③，2026-10-08）：命中角色领域却派裸子代理时的拒绝理由。
     守栏人是宿主 ctx.tools.guard —— 它**只能拒绝、不能改派**，所以文案必须自带
     「下一步怎么做」；{0}=角色 id/队友名 {1}=角色显示名 {2}=指路串（{2} 内部再带一层
     {0}=显示名；formatCopy 单遍替换，不会递归展开）。 ---- */
  'shared.roles.guard.rejectSubagent': '本任务命中角色「{1}」：请派给它的队友 `{0}`。普通子代理不参与分工表改道，会跑在默认模型上。做法：`spawn_teammate(name="{0}", …)` 建起该队友（已存在就直接派给它），任务照原样派过去；若不归它，去掉「{1}」这类领域词后重派。备选：{2}',
  'shared.roles.guard.fixHint': '给角色「{0}」填 keywords（逗号分隔）：填了就优先按它判领域，留空则回退到显示名与别名。',
  'shared.roles.guard.roleKeywordsFallback': '角色「{0}」未配置 keywords，本次判定回退到它的显示名与别名；想收紧/放宽请在设置页填该角色的 keywords。',
  /* ↑ fixHint 与 roleKeywordsFallback 的 {0} 都是**角色显示名（label）**——同一条拒绝理由里
     与「角色「{1}」」保持同一称呼，不混用 id（id 只在 rejectSubagent 的 {0} 出现）。 */
  /* workflow 分支拒绝理由（2026-10-08 护栏扩面）：脚本的 agent() 一次都没点名目标 ⇒
     全部跑默认目标。四件事一次说清：①为什么会全跑默认目标 ②分工表/关键词规则不参与
     的原因 ③两条正确改法 ④确实要走默认目标的出路（显式点名即放行）。 */
  'shared.roles.guard.rejectWorkflow': '这次 workflow 的 `agent()` 一次都没点名目标——所有子代理都会跑在**默认目标**上，分工表与关键词规则都不会参与（workflow 的子代理不是队友，分工表改道对它不适用）。两种改法：① 给每次 `agent(prompt, { provider, model })` 点名目标；② 改用 `spawn_teammate(name="<角色 id>")` 派给该角色的队友。确实要走默认目标的话，把默认目标显式写进 `provider` / `model` 即可——本护栏对点过名的派发一律放行。',
  /* 分工表 skill 正文（模型面向的宿主侧注入文本，不经浏览器渲染；逐字保留）。 */
  'shared.roles.skill.title': '# 月汐分工表（团队派发）',
  'shared.roles.skill.intro': '当任务属于某个专项领域时，**用 `spawn_teammate` 派给该角色的队友**（队友名取自上表的「队友名（认领）」一列或角色 id），不要自己硬做、也不要派给普通子代理。',
  'shared.roles.skill.tableHeader': '| 角色 | id | 目标模型 | 队友名（认领） | 别名 | 备注 |',
  'shared.roles.skill.howto': '## 怎么派（两种形态，都要）',
  'shared.roles.skill.oneShot': '1. **一次性任务**（做完即回收）：用 `workflow` 的 `agent(prompt, { provider, model })` 指定上表的目标，提示词必须自带任务所需的全部上下文。',
  'shared.roles.skill.persistent': '2. **常驻队友**（可多次差遣）：用 `spawn_teammate` 建队友，**队友名必须取自上表的「队友名（认领）」一列**（或该角色的 id）——月汐据此把它的请求改道到目标模型。',
  'shared.roles.skill.nameRuleTitle': '## 队友名合法性',
  'shared.roles.skill.nameRule': '队友名须满足：{0}；名字永不复用，且一旦失败也占用名额。',
  'shared.roles.skill.whenNot': '## 什么时候不要派',
  'shared.roles.skill.whenNot1': '- 琐碎到不值得起一个子代理的活（改个错别字、一句话问答）；',
  'shared.roles.skill.whenNot2': '- 没有对应角色的领域 —— 要么自己答，要么先请用户在设置里加一个角色；',
  'shared.roles.skill.whenNot3': '- 需要与本轮上下文强耦合的连续操作（子代理只有你给它的提示词）。',
  /* 派完怎么验（2026-10-08 实测事故的另一半修法）：派完必须回读宿主持久真源，
     展示层字段改道后不回写。 */
  'shared.roles.skill.verifyTitle': '## 派完怎么验（必做）',
  'shared.roles.skill.verify1': '1. **派完必验**：回读每个子会话的**首条 `request/header` 事件**（宿主持久真源），与你要派的目标逐字对照。',
  'shared.roles.skill.verify2': '2. **只有 `request/header` 靠得住**：会话头、`subagent` 返回的 `descriptor.agentModel`、`list_agents` 在改道后都不会回写（展示层漂移）——照它们判会判错。',
  'shared.roles.skill.verify3': '3. 在 kimi-tide 仓内一条命令：`node scripts/acceptance/check-dispatch-routing.mjs <父会话 id> [--last N] [--expect provider/model,...]`（退出码 0=通过 / 1=不一致 / 2=用法或读取错误）。',
  'shared.roles.skill.verify4': '4. 不在本仓时的通用做法：解 `$DSH_HOME/sessions/<工作区 slug>/<子会话 id>/session.v4.jsonl.zstd`（回落 `~/.dsh/sessions/...`），取首条 `request/header` 事件。',
  'shared.roles.skill.verify5': '5. 没验成怎么办：重派时显式点名 `provider` / `model`，或改用 `spawn_teammate` 派给该角色的队友。',
  'shared.roles.skill.verify6': '6. 一句实话：「我以为我传了」不算证据。',
  /* ---- review-verdict.ts：结论标签（注入文本与面板摘要共用单源；W6） ----
     word* 两键是解析词表（匹配数据），render 侧不用；与 label 同表仅为键集对称。 */
  'shared.verdict.pass': '通过',
  'shared.verdict.conditional': '有条件通过',
  'shared.verdict.fail': '不通过',
  'shared.verdict.unknown': '无明确结论',
  'shared.verdict.wordNotPassed': '未通过',
  'shared.verdict.wordNeedsChanges': '需要修改',
  /* ---- config.ts 内置真相源：预设名与默认关键词组（设置卡可见；W6） ----
     关键词组一组一键、词与词之间 \n 分隔（消费侧 split('\n') 还原数组，免 56 键）。 */
  'shared.config.preset.saving': '省钱',
  'shared.config.preset.capability': '能力',
  'shared.config.kw.code': '代码\ncode\nbug\n重构\nrefactor\n实现\n函数\n测试\n接口\n联调\n部署\n性能\n报错\n日志\n编译\n命令\n脚本',
  'shared.config.kw.chitchat': '你好\n谢谢\n怎么样\n随便\n聊聊\n天气',
  'shared.config.kw.review': '审查\nreview\n评审\n挑毛病\n复检\n检查\naudit\n意见\n打分',
  'shared.config.kw.writing': '写作\n文案\n润色\n改写\n扩写\n标题\n推文\n周报\n演讲稿\n总结',
  'shared.config.kw.translate': '翻译\n译成\n中译英\n英译中\ntranslate\n本地化',
  'shared.config.kw.longdoc': '长文档\n通读\n逐段\n全文\n上万字\n大文档',
  'shared.config.kw.math': '数学\n证明\n推导\n求解\n公式\n数论\n概率\n逻辑题',
} as const
