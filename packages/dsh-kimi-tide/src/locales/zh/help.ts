/**
 * help 表：说明页文案（help-content.ts + HelpTab.tsx）。
 * 中文是唯一真源；键命名 `help.<area>.<name>`，全小写 camelCase 段。
 * 占位符 `{0}` / `{1}` / `{name}` 由 formatCopy 替换。
 */
export const zh = {
  /* ======== HelpTab 自身文案 ======== */
  'help.tab.hint': '这里讲清面板每个元素是什么、设置里每个字段什么意思。最上面一节讲这一版路由页的新读法（五档决策链 / 作用域 / 统一路由表）；想看更深的设计细节，见仓库 packages/dsh-kimi-tide/docs/router.md。',
  'help.tab.whatsNewSummary': '本次新版：路由页怎么读',

  /* ======== FALLBACK_HINTS（跨模块单一内容源，键名冻结） ======== */
  'help.fallback.latch': '带图后锁定视觉模型，后续文本轮继续走视觉',
  'help.fallback.blind': '文本轮当无图处理——看不到历史图，可能盲答',
  'help.fallback.transcribeLazy': '文本轮先把历史图转写为文字再作答（多一次视觉调用）',

  /* ======== WHATS_NEW 导览（v2.1.0） ======== */
  'help.whatsNew.chain.title': '路由页从「四个并列控件」改成一条五档决策链',
  'help.whatsNew.chain.item0': '一条消息会被谁决定用哪个模型，按优先级从上到下排：**显式 @ > 调用方点名 > 分工表 role > 关键词规则 > 默认目标**。',
  'help.whatsNew.chain.item1': '每档三行：触发条件 / 当前取值 / 关闭后的影响。**分工表**内联在第 3 档、**规则编辑器**内联在第 4 档。',
  'help.whatsNew.chain.item2': '每档带一个状态徽标：**已就绪**（此刻真的参与裁决）/ **按需**（写 `@` 或子代理点名时才参与）/ **未启用**（当前配置下没东西，置灰）。',
  'help.whatsNew.chain.item3': '**默认目标档现在显式可见**（并写明来源：主驱动恒定 / 预设默认 / 跟随宿主默认）；没启用的档位只是置灰，不是消失。',
  'help.whatsNew.chain.item4': '页面顶部一句话摘要当前局面；一条规则都没配时也会说明——「主会话没有可命中的规则，全部使用默认目标（…）；另有 N 组关键词组未接入任何规则，暂不生效」。',

  'help.whatsNew.scope.title': '作用域：规则行「主会话」 vs 角色行「派发时」',
  'help.whatsNew.scope.item0': '关键词规则只服务**主会话**，分工表只服务**队友**（子代理默认不参与关键词规则）——两者本来就不冲突，冲突感来自界面上没说清。',
  'help.whatsNew.scope.item1': '所以规则行挂「主会话」徽标、分工角色行挂「派发时」徽标——作用域标清之后，表面上的「冲突」其实是「分工」。',
  'help.whatsNew.scope.item2': '派发台账的依据也是这套口径：`role` = 分工表认领 / `explicit` = 显式点名 / `keep` = 保持原样 / `unclaimed` = 不在分工表。',

  'help.whatsNew.routes.title': '统一路由表 `routes`（配置 v7）',
  'help.whatsNew.routes.item0': '配置里两类行合成一张表：`scope: session` 行 = 主会话规则（带图 / 关键词组，带 `preset` 归属），`scope: dispatch` 行 = 分工角色。',
  'help.whatsNew.routes.item1': '**`routes` 存在即真源**；旧字段（`presets[*].rules` / `roles`）保留为**镜像**——删掉 `routes` 段即回退旧字段口径，功能不崩。',
  'help.whatsNew.routes.item2': '运行期按**字段**判据读，不看版本号：配置里显式写 `version: 5` 或 `6` 同样正常，设置页写入也不改你的 `version`。',
  'help.whatsNew.routes.item3': '手改配置时若两处不一致，写入期校验会**拒绝并指出冲突位置**（不静默择一）。',

  'help.whatsNew.write.title': '保存规则 / 角色时「双写」',
  'help.whatsNew.write.item0': '保存规则或分工角色时，同一笔写会**同时**下发 `routes` 与镜像后的旧字段，文件里两处永远一致。',
  'help.whatsNew.write.item1': '通道上是**三笔序列**：先摘掉 `routes` → 写旧字段 → 写回 `routes`（顺序是硬约束：宿主逐笔校验两处一致性，中间态不合法就会拒写）。',
  'help.whatsNew.write.item2': '写后照旧比对「意图值 vs 实读值」——被拒会明确报「写入被拒绝」，不静默吞掉。',

  'help.whatsNew.dispatchPreview.title': '测试场「派给谁」：派发层预览',
  'help.whatsNew.dispatchPreview.item0': '输入或选一个角色 / 队友名，看它会改道到哪个模型、依据是什么（`role` / `unclaimed`）。',
  'help.whatsNew.dispatchPreview.item1': '它与「试一句」是**两套作用域**：「试一句」算主会话的关键词规则，「派给谁」算派发时的分工表改道。',
  'help.whatsNew.dispatchPreview.item2': '分工表里另有「**从词表生成角色**」：把还没有任何规则引用的词表组批量生成角色行（目标先取当前预设默认模型，可在下拉里改）。',

  'help.whatsNew.wiring.title': '词表接入徽标与重叠解释条',
  'help.whatsNew.wiring.item0': '每组词表都标出接入状态：`被 N 条规则引用` / `被协作流认领` / `⚠ 未接入`——空表不是坏了，是还没接入。',
  'help.whatsNew.wiring.item1': '同一个词既是规则对象、又是某角色的身份词（id / 显示名 / 别名）且两边目标不同时，词表行与角色行各挂一条**解释条（不是报错）**：',
  'help.whatsNew.wiring.item2': '「主会话说『代码』走 A；派给『后端』做走 B」——两套作用域各走各的，本就不冲突；旁边还有一键把规则目标改成该角色目标的动作。',

  /* ======== §1 dock — 面板速览 ======== */
  'help.section.dock.title': '面板速览',
  'help.section.dock.label.title': '月汐',
  'help.section.dock.label.body0': '插件身份标签。鼠标悬停会提示「路由设置见 设置 → 月汐」。',

  'help.section.dock.chain.title': '路由链三枚芯片：预设 → 默认目标 ⟶ 决策目标',
  'help.section.dock.chain.body0': '预设：当前激活的规则集；显示「关闭」= 路由被显式关掉，不是故障。',
  'help.section.dock.chain.body1': '默认目标：所有规则都没命中时用的目标。',
  'help.section.dock.chain.body2': '决策目标：**本步实际路由到谁**——它和默认目标不同，就说明这次是规则或显式 @ 生效了。',
  'help.section.dock.chain.body3': '工具行右端的紧凑态把这三枚合成一枚按钮：`省钱 → deepseek-flash`——右侧有目标时是**决策目标**，没有时是**默认目标**。',
  'help.section.dock.chain.liveClosed': '当前：路由已关闭',
  'help.section.dock.chain.liveActive': '当前：{0} → 默认目标 {1}',

  'help.section.dock.decisionToggle.title': '决策开关（▸ / ▾）',
  'help.section.dock.decisionToggle.body0': '展开决策可观测悬浮层，看本步为什么这么选。',
  'help.section.dock.decisionToggle.body1': '**默认目标与「保持原样」不上屏**——看不到原因条不等于出错。',
  'help.section.dock.decisionToggle.body2': '紧凑态：点那枚「预设 → 目标」按钮就是开关。',

  'help.section.dock.quota.title': '周配额 / 5h 配额槽（用量源）· 余额槽（API 计费源）',
  'help.section.dock.quota.body0': '跟随**当前命中目标**的 provider 自动切换数据源与形态：code plan 显示两个用量窗，API 计费源显示余额。',
  'help.section.dock.quota.body1': '紧凑态只显示一枚摘要（`¥3.94` 或 `周剩NN%`），点它展开**用量总览**看全部源与明细。',
  'help.section.dock.quota.body2': '用量条的条画的是**剩余**比例，与旁边「剩 N%」同向：剩得多条就长、快耗尽时是短红条。',
  'help.section.dock.quota.body3': '余额槽显示总额（多币种取首个，其余进悬浮提示）；余额不足以调用 API 时会标注「余额不足」。',

  'help.section.dock.image.title': '图像上下文槽（原 / 述 / 盲）',
  'help.section.dock.image.body0': '本会话图片的三种去向：原生视觉 / 已转述成文字 / 盲答（有图但文本模型看不到）。',
  'help.section.dock.image.body1': '盲 > 0 时会追加可见警示——**无图会话不渲染这一行**。',

  'help.section.dock.dispatch.title': '派发槽（团队派发摘要）',
  'help.section.dock.dispatch.body0': '最近一次把专项活派给哪个角色的模型，以及依据（role=分工表角色 / explicit=显式点名 / keep=保持原样 / unclaimed=未在分工表）。',
  'help.section.dock.dispatch.body1': '展开决策可观测悬浮层可看最近 20 条派发明细（新在前）。',
  'help.section.dock.dispatch.body2': '本会话还没有派发记录时不渲染这一槽。',

  'help.section.dock.guard.title': '派发护栏在岗槽',
  'help.section.dock.guard.body0': '「护栏：在岗」= 派发护栏已注册，命中角色领域的裸子代理派发会被拒绝。',
  'help.section.dock.guard.body1': '「护栏：未在岗（开关未开 / 无激活预设）」置灰显示——这是你自己关的，行为与无护栏一致，不告警。',
  'help.section.dock.guard.body2': '「护栏：未在岗（tools 服务缺席 / guard 注册面不可用 / 注册失败）」以警示色显示——开关已开但环境给不出护栏，派发不会被拦截；鼠标悬停看具体原因。',

  'help.section.dock.fetch.title': '取数时间与刷新',
  'help.section.dock.fetch.body0': '显示上次成功取配额的时刻；标「(过期)」= 最近一次刷新失败。',
  'help.section.dock.fetch.body1': '刷新按钮等价于执行 `/kimi-tide refresh`。',

  'help.section.dock.kimiWarning.title': '「Kimi 未接入」警示',
  'help.section.dock.kimiWarning.body0': '缺 kimi-coding 路由或 API key 时的配置指引，不是错误告警。',
  'help.section.dock.kimiWarning.body1': '去 设置 → 模型 里确认 provider 与 apiKeyEnv 指向。',

  'help.section.dock.states.title': '命令失败提示与整体空态',
  'help.section.dock.states.body0': '命令失败会在第二行尾部追加一条失败提示。',
  'help.section.dock.states.body1': '整体两种空态：「面板数据加载中…」与「暂无面板数据（路由关闭或取数通道不可用）」。',

  /* ======== §2 faq — 常见疑问 ======== */
  'help.section.faq.title': '常见疑问',
  'help.section.faq.review.title': '我配了评审模型，但没评审',
  'help.section.faq.review.body0': '先看「触发方式」：`手动` 时关键词命中**不会**触发评审（只有 `/kimi-tide review` 会）。',
  'help.section.faq.review.body1': '改成「关键词组」并选组后：命中的那一轮照常执行，**轮末**由评审模型异步评一次。',
  'help.section.faq.review.body2': '其余可能：本轮没有产出、消息里带了显式 @、或评审模型不可用（界面会标注盲区）。',

  'help.section.faq.revise.title': '评审说不通过，但模型没有重做',
  'help.section.faq.revise.body0': '先看设置页「**自动修订**」有没有勾（默认关）：没勾时评审只给意见，不会自动退回。',
  'help.section.faq.revise.body1': '没勾也能手动退：评审卡上点「**让它重做**」，或打 `/kimi-tide revise`。',
  'help.section.faq.revise.body2': '勾了还没退：看结论是不是「通过」；再看是不是**已达上限**（每会话＝「轮次」次，到顶后事件卡标「已停（达上限）」）。',

  'help.section.faq.atIgnored.title': '我写了 @xxx，但路由没按它走',
  'help.section.faq.atIgnored.body0': '**只有真的 provider 才算指令**：`@` 后面若是工作区路径引用（`@README.md`）或 scoped 包名（`node_modules/@deepseek-ai/…`），不会被当成显式指令——该轮照常走关键词规则。',
  'help.section.faq.atIgnored.body1': '决策原因条会写明「`@x` 非本路由器已知 provider（已忽略）」；想点名就用 `@kimi` 或 `@provider/model`。',
  'help.section.faq.atIgnored.body2': '另一种情况：provider 认识、但当前没有可用模型（如 key 未配置）——这时**不会**改道，原因是「provider 已知但当前无可路由模型」。',

  'help.section.faq.noDecision.title': '面板没有决策原因条',
  'help.section.faq.noDecision.body0': '本步是默认目标或「保持原样」——这两类按设计不上屏。',
  'help.section.faq.noDecision.body1': '规则命中或显式 @ 才会有原因条。',

  'help.section.faq.quotaDash.title': '配额槽显示 —',
  'help.section.faq.quotaDash.body0': '三种原因：当前目标 provider 没有配额源（不适用）；该 provider 的 key 未配置；或取数失败。',
  'help.section.faq.quotaDash.body1': '看「取数时间」是否标「(过期)」可区分后两种；某个窗口单独显示 — 表示该窗口没有数据（不是满额）。',

  'help.section.faq.routeUnexpected.title': '路由没按预期切模型',
  'help.section.faq.routeUnexpected.body0': '规则按**特异度**排序（命中词多者优先、带图恒第一、平手按列表序），排序后首条目标可用者生效。',
  'help.section.faq.routeUnexpected.body1': '所以「位置靠后但命中词更多」的规则会赢——展开决策可观测看实际命中理由。',

  'help.section.faq.keywordMiss.title': '关键词没命中',
  'help.section.faq.keywordMiss.body0': '纯 ASCII 词按**词边界**匹配（`decode` 不会命中 `code`），中文/短语按子串匹配，大小写不敏感。',
  'help.section.faq.keywordMiss.body1': '也可能是该组被评审流认领后规则被抑制，或规则的「最少命中词数」设得偏高。',

  /* ======== §3 routing — 路由语义 ======== */
  'help.section.routing.title': '路由语义',
  'help.section.routing.preset.title': '预设与激活',
  'help.section.routing.preset.body0': '预设 = 一套「默认模型 + 有序规则」；同一时刻只有一个激活。',
  'help.section.routing.preset.body1': '「关闭」= 完全不动模型，等于停用路由。',
  'help.section.routing.preset.live': '当前激活：{0}',

  'help.section.routing.rules.title': '规则链与特异度',
  'help.section.routing.rules.body0': '规则条件两种：带图、或命中所选关键词组（可加「最少命中词数」）。',
  'help.section.routing.rules.body1': '命中后按特异度排序（命中词多者优先、带图恒第一、平手按列表序），取**首条目标可用者**。',
  'help.section.routing.rules.body2': '目标在候选目录里不可用 → 跳过该条继续下一条（降级，不是失败）。',
  'help.section.routing.rules.liveImage': '带图',
  'help.section.routing.rules.liveKeywords': '{0} 组 ≥{1} 词',
  'help.section.routing.rules.live': '当前：{0} 条规则，首条条件「{1}」',

  'help.section.routing.hitConfirm.title': '语义命中确认（默认关闭）',
  'help.section.routing.hitConfirm.body0': '开启后关键词命中不会立刻改道——先让**本预设的默认模型**判断「这是本轮的真意图吗」。',
  'help.section.routing.hitConfirm.body1': '判否 ⇒ 跳过该条规则、继续匹配后续规则；**问不到**（超时/模型不可用/输出读不出）⇒ 按原关键词结果走。',
  'help.section.routing.hitConfirm.body2': '显式 @ 轮与「带图规则已排首位」的轮不会调用判官（结果不可能生效，白花一次调用）。',
  'help.section.routing.hitConfirm.liveOn': '当前：已开启（判官 {0}，超时 {1}ms）',
  'help.section.routing.hitConfirm.liveOff': '当前：关闭——关键词命中直接按规则改道',

  'help.section.routing.ops.title': '预设操作（新建 / 复制 / 删除）',
  'help.section.routing.ops.body0': '删除预设前需二次确认（按钮会先变成「确认删除？」）。',
  'help.section.routing.ops.body1': '规则指向的是**模型**、不指向预设，所以删掉一个预设不会牵连别的配置。',

  'help.section.routing.fallback.title': '带图兜底三态（imageFallback）',
  'help.section.routing.fallback.live': '当前：{0} —— {1}',

  'help.section.routing.roles.title': '分工表（角色 = 领域 → 模型）',
  'help.section.routing.roles.body0': '每个角色一行：显示名 + id（lower-kebab-case，即默认认领的队友名）+ 目标模型 + 额外认领的队友名 + 别名。',
  'help.section.routing.roles.body1': '认领名（id 与队友名合起来的集合）不得跨角色重复——重复时保存会被拒绝（守卫式拒写，配置不会落盘）。',
  'help.section.routing.roles.body2': '「填入工程示例」「填入业务示例」分别加入 前端/后端/运维部署/测试/数据/安全 六个工程角色、写作/市场/销售/客服/财务/法务 六个业务角色（目标先取当前预设的默认模型，可在下拉里改）。',
  'help.section.routing.roles.liveEmpty': '当前：分工表为空（专项活不会被派发改道）',
  'help.section.routing.roles.liveCount': '当前：{0} 个角色',

  'help.section.routing.driver.title': '团队派发的几个开关（driver / driverSticky / rulesApplyToChildren）',
  'help.section.routing.driver.body0': 'driver = 主驱动目标（null/缺省 = 跟随宿主默认模型）；driverSticky 开启时主会话默认目标恒用 driver。',
  'help.section.routing.driver.body1': 'rulesApplyToChildren 关闭（默认）时，子代理的请求不参与关键词规则——只有分工表认领的队友会被改道。',
  'help.section.routing.driver.body2': '派发依据见 dock 的派发槽：role=分工表角色 / explicit=显式点名 / unclaimed=未在分工表 / keep=保持原样。',

  'help.section.routing.guard.title': '派发护栏（dispatchGuard）',
  'help.section.routing.guard.body0': '`dispatchGuard` 默认关闭；开启后两类派发会被**拒绝**：任务命中某角色的领域、却派给普通子代理（`subagent` / `subagent_fork`）；或 `workflow` 脚本里的 `agent()` 一次都没点名目标（这种脚本的所有子代理都会跑在默认目标上）。',
  'help.section.routing.guard.body1': '普通子代理这条的判定依据是角色的领域词（`keywords`）；角色没填时，判定回退到它的显示名、别名与 id。',
  'help.section.routing.guard.body2': '被拒绝后，用 `spawn_teammate` 建起该角色的队友并把任务派给它；workflow 脚本则给 `agent()` 点名 `provider` / `model`（确实要走默认目标时，把默认目标显式写进去即放行）。',
  'help.section.routing.guard.body3': '**护栏只能拒绝、不能自动改派**：改派仍要另一次 `spawn_teammate` 调用。',

  /* ======== §4 keywords — 关键词与匹配 ======== */
  'help.section.keywords.title': '关键词与匹配',
  'help.section.keywords.groups.title': '关键词组与词表',
  'help.section.keywords.groups.body0': '内置 7 组（代码 / 审查 / 写作 / 翻译 / 长文 / 数学 / 闲聊），词表可改、可自建新组。',
  'help.section.keywords.groups.body1': '词表用逗号或换行分隔；失焦即保存。',
  'help.section.keywords.groups.live': '当前：{0} 组',

  'help.section.keywords.match.title': '匹配语义',
  'help.section.keywords.match.body0': '纯 ASCII 词按词边界匹配（`decode` 不误中 `code`）；中文、混合、多词短语按子串匹配。',
  'help.section.keywords.match.body1': '大小写不敏感；同一词出现多次只计一次。',

  'help.section.keywords.minhits.title': '最少命中词数（minHits）',
  'help.section.keywords.minhits.body0': '规则级下限：一句话里至少命中该组这么多**不同**词才触发。',
  'help.section.keywords.minhits.body1': '设 2 可避免「做个方案」这类顺带提及误触发。',

  /* ======== §5 flows — 协作流 ======== */
  'help.section.flows.title': '协作流',
  'help.section.flows.transcribe.title': '转述流（transcribe）',
  'help.section.flows.transcribe.body0': '用视觉模型把图片转成文字，再交给文本模型作答。',
  'help.section.flows.transcribe.body1': '失败策略二态：`失败锁存`（保持原生视觉作答）或 `盲答`（当无图处理）。',
  'help.section.flows.transcribe.live': '当前：视觉模型 {0}，失败策略 {1}',

  'help.section.flows.reviewFields.title': '评审流的字段',
  'help.section.flows.reviewFields.body0': '评审模型 = **谁来评**；触发方式 = **什么时候评**（两个字段，别混）。',
  'help.section.flows.reviewFields.body1': '档位 = 评审模型的**推理强度**（与转述流同款：下拉里只列宿主目录声明支持的档位；显示「跟随默认（该模型未声明档位）」= 这个模型没声明，交给适配器默认）。',
  'help.section.flows.reviewFields.body2': '轮次 = 评几轮，**也是每会话「退回重做」的次数上限**。',
  'help.section.flows.reviewFields.body3': '自动修订 = 评审判「不通过/有条件通过」时**自动让主模型按意见改**；复检 = 改完再评一轮。',
  'help.section.flows.reviewFields.body4': '两个开关都会多花调用：退回多一轮主模型，复检再多一轮评审。',

  'help.section.flows.revise.title': '退回重做：自动与手动',
  'help.section.flows.revise.body0': '评审卡上有「**让它重做**」按钮：不勾自动修订也能点，按最近一次评审意见退回。',
  'help.section.flows.revise.body1': '退回 = 注入一条带评审意见的消息，让主模型**只改被指出的问题**；原产出仍在会话日志里（可回看）。',
  'help.section.flows.revise.body2': '每会话最多退回「轮次」次（1–3）；到顶后事件卡会显示「已停（达上限）」，不再自动重做。',
  'help.section.flows.revise.live': '当前：自动修订{0} · 复检{1} · 上限 {2} 次',
  'help.section.flows.revise.liveOn': '开',
  'help.section.flows.revise.liveOff': '关',

  'help.section.flows.trigger.title': '触发方式：手动 vs 关键词组',
  'help.section.flows.trigger.body0': '`手动`：只有 `/kimi-tide review` 会触发——**关键词命中什么都不做**。',
  'help.section.flows.trigger.body1': '`关键词组`：命中所选组 ≥1 词即武装；本轮照常执行，**轮末**异步评审一次。',
  'help.section.flows.trigger.liveKeywords': '当前：关键词组「{0}」——命中即轮末评审',
  'help.section.flows.trigger.liveKeywordsUnselected': '（未选）',
  'help.section.flows.trigger.liveManual': '当前：手动——关键词命中不会触发评审，只有 /kimi-tide review 会',

  'help.section.flows.claim.title': '认领：被评审流选中的组，规则会失效',
  'help.section.flows.claim.body0': '一旦某组被评审流认领，该组绑定**路由规则**被静态抑制（不再整轮切模型）。',
  'help.section.flows.claim.body1': '这是有意设计：命中评审词时，本轮该干活干活，评审放到轮末。',

  'help.section.flows.deleteGuard.title': '删除协作流受引用检查保护',
  'help.section.flows.deleteGuard.body0': '预置流不可删；自建流仍被规则目标或「懒转述流」引用时**拒删并给出原因**（先清引用再删）。',

  /* ======== §6 usage — 用量与余额 ======== */
  'help.section.usage.title': '用量与余额',
  'help.section.usage.sources.title': '数据从哪来',
  'help.section.usage.sources.body0': '按 provider 取数：Kimi Code 显示周 / 5h 窗；Z.ai 编码套餐按积分制显示两个窗。',
  'help.section.usage.sources.body1': '额度槽跟随当前命中目标自动切源；没有套餐的模型不显示数值。',

  'help.section.usage.dash.title': '为什么显示 —',
  'help.section.usage.dash.body0': '不适用（当前目标没有配额源）／无凭据（key 未配置）／取数失败，三种原因。',
  'help.section.usage.dash.body1': '取数时间标「(过期)」= 上一次刷新失败，此时显示的是更早的快照。',

  'help.section.usage.overview.title': '用量总览（第二行的总览按钮）',
  'help.section.usage.overview.body0': '一屏列出**全部已注册的源**：用量窗、余额，以及某个源为什么没有数据。',
  'help.section.usage.overview.body1': '「没数据」分三种且逐行写明：该套餐无公开 API / key 未配置 / 取数失败——不用你猜。',

  'help.section.usage.monthly.title': '为什么面板显示还有额度，却报「已达上限」',
  'help.section.usage.monthly.body0': '面板显示的是服务端返回的**周 / 5h 窗**；账号若另有**月度上限**，它不在这个窗里。',
  'help.section.usage.monthly.body1': 'Kimi 的 403 文案就是 `monthly usage limit for this billing cycle`——周窗没满也可能被月上限挡住。',

  'help.section.usage.refresh.title': '刷新节奏',
  'help.section.usage.refresh.body0': '后台按固定节奏轮询（同一时刻只有一个在途请求）。',
  'help.section.usage.refresh.body1': '想立刻刷新：点刷新按钮或 `/kimi-tide refresh`。',

  /* ======== §7 glossary — 术语表 ======== */
  'help.section.glossary.title': '术语表',
  'help.section.glossary.terms.title': '面板与配置里会看到的词',
  'help.section.glossary.terms.body0': '默认目标：没有任何规则命中时主会话使用的目标（未命中 ≠ 不动）。',
  'help.section.glossary.terms.body1': '默认模型：预设里的配置字段（`presets.<id>.default`）——主驱动恒定关闭时，默认目标就是它。',
  'help.section.glossary.terms.body2': '主驱动目标：「主驱动恒定」开启时主会话的常驻默认目标（留空 = 跟随宿主默认模型）。',
  'help.section.glossary.terms.body3': '命中 / 特异度：命中的关键词**种数**，用于排序。',
  'help.section.glossary.terms.body4': '认领：某关键词组被评审流接管，其路由规则失效。',
  'help.section.glossary.terms.body5': '锁存 / 盲答 / 懒转述：带图会话的三种兜底姿态。',
  'help.section.glossary.terms.body6': '过期（stale）：最近一次取数失败，当前显示的是旧快照。',

  /* ======== §8 commands — 命令清单 ======== */
  'help.section.commands.title': '命令清单',
  'help.section.commands.list.title': '/kimi-tide 子命令',
  'help.section.commands.list.body0': '`show` 现状总览 · `panel [--json]` 面板数据 · `refresh` 立刻重取配额。',
  'help.section.commands.list.body1': '`export-config` / `import-config <path|inline YAML>` 导出与导入预设。',
  'help.section.commands.list.body2': '`review` 手动评审上一轮（有缓存评缓存，无缓存会明说）。',
  'help.section.commands.list.body3': '`revise` 手动退回：按最近一次评审意见让主模型重做（与评审卡按钮同一条路）。',

  'help.section.commands.trial.title': '「试一句」测试器',
  'help.section.commands.trial.body0': '输入一句话，实时预演命中哪条规则、最终路由到哪个模型。',
  'help.section.commands.trial.body1': '**仅文本探针**：带图输入只展示规则命中，最终改道还取决于图像护栏与协作流。',

  /* ======== 通用取值与拼接（缺值占位、行内「标签：值」形态） ======== */
  'help.value.none': '—',
  'help.join.labeled': '{0}：{1}',
} as const
