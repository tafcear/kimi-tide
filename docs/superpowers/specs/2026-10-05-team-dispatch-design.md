# 团队派发（分工层执行面）设计稿 v2（Round-1 评审处置后）

> 状态：**待用户审定**。v1 于 2026-10-05 提交（`03c9c81`）；**Round-1 独立评审（kimi-coding/k3）＝「有条件通过」**——2 项阻塞、8 条建议、6 条可选、8 项缺失决策**已逐条处置**（全表见 §10）。
> 评审档案：`docs/superpowers/reviews/2026-10-05-team-dispatch-kimi-review-round1.md`
> 前序：v1.4.1（2026-10-03）已发布；两项**行为变更**（D1/D6）列在 §8 待裁定。
> 宿主能力依据：`@deepseek-ai/dsh@0.1.7-rc.2` 实读（agent-team / tool-agent-team / agent-team-profile / tool-subagent / subagent / workflow-ptc）。

## 1. 背景与动机

### 1.1 用户愿景（2026-10-05，语音转写）

用一个**快速主模型**（DeepSeek V4 Flash）**全程驱动 agent**；它判断下一步做什么，凡是专项活就**派发给专家模型的子代理**——例如前端给 Kimi T3、后端给 GLM 5.3、写作给千问 3.8-Max。**哪个模型负责哪部分，由用户自己配置**，插件不内置"谁擅长什么"的判断（延续 v0.5.0 退役评分引擎时"能力判断交给用户"的裁定）。两种派发形态**都要**：一次性任务派发（做完即回收）与常驻队友（可多次差遣）。

### 1.2 现状：愿景的第一步还没发生（本轮实测）

线上生效预设＝**能力**（用户层覆盖了 profile 基线里的 `saving`），其中能力预设的**打底目标 = `qwen-token-plan-cn/qwen3.8-max`（effort xhigh）**。于是主会话**每一轮**都被"打底"从 flash 拉走，只有命中 code 关键词的轮次才到 `zai-coding-cn/glm-5.3`（max）。本次会话请求头实测：`glm-5.3` ×4、`qwen3.8-max` ×1，另 2 条 `deepseek-flash` 是会话标题等辅助请求。

即：**"快速主模型全程驱动"目前被月汐自己的打底语义（v0.5.0 核心语义「未命中 ⇒ 预设默认」）挡着**。这是本设计的直接动机。

### 1.3 三项 spike（2026-10-05，全绿）

| # | 问题 | 结论 | 证据 |
|---|---|---|---|
| S1 | 插件能否把自己的知识以最低 token 成本送进模型上下文 | **能**：`ctx.skills.register(...)` 注册内存 skill，宿主 `dsh-tool-skill` 在 pre-step 用 snapshot＋digest 注入 `<available_skills>` 目录、正文按需加载 | `dsh-skill/README.zh.md:52`；`dsh-tool-skill/lib/index.js:207-226,301` |
| S2 | 月汐能否改道**队友子会话**的模型 | **能**：队友提示词含 `@kimi` ⇒ 其请求落到 `kimi-coding/k3`（max）；提示词仅含「代码」⇒ 落到继承值 `deepseek-flash`（该轮是打底决策，被 B-1a 让位保护） | 子会话日志 `request/header`（`scripts/acceptance/session-dump.mjs --grep`） |
| S3 | Team 组合包下 `workflow` 的单次派发是否可用 | **可用**（无策略门控；本日 12:5x 已实跑双模型评审） | `dsh-workflow-ptc/lib/index.js:328-338`；当日协作日志 |

**S2 的副产物（影响 D7）**：`TeamMemberView.model` 读的是子代理创建时继承的 agent options，**与实际路由后的请求模型无关**（roster 显示 flash、实际跑 k3）⇒ 观测面必须由插件自己记账。

**S2 的适用边界（Round-1 评审 S4，v1 曾误述）**：两个探针走的都是**既有机制**（显式 `@` 与打底让位），**`via:'role'` 这条新路径从未被预演** ⇒ A2 是本设计最高优先级的验收项，不能拿 S2 当"已预演"。

**探针命名（评审 E2，v1 未定义导致引用歧义）**：S2 行的两次探针，下文分别称 **探针 A**（提示词仅含「代码」⇒ 落继承值 `deepseek-flash`）与 **探针 B**（提示词含 `@kimi` ⇒ 落 `kimi-coding/k3`）。

## 2. 设计决策

### D1 主驱动恒定（**行为变更，待裁定**）

- 新配置 `driver?: RouteTarget | null`：`null` = 跟随宿主 `agent-default-model`（推荐留 null，即 flash）。
- 新开关 `driverSticky: boolean`（缺省 `false`＝行为保持）：
  - `true` ⇒ **主会话（`delegationDepth === 0`）的打底目标 = `driver`**，不再等于 `preset.default`；关键词规则**仍可**改道（规则是用户显式写下的意图，保留）。
  - `false` ⇒ 完全维持 v1.4.1 语义（打底＝预设默认）。
- 边界（评审 O4 补）：`driverSticky=true` 且 `driver=null` ⇒ 打底 = 宿主默认，面板照常显示「跟随宿主默认」；**`activePreset=null`（路由关闭＝逃生舱）时 driver 不生效**（关闭优先于一切）。
- 理由：愿景第一步；且"打底无条件覆盖"正是 2026-09-20 钉指定模型缺陷的同一根因（当时只对子代理开了 B-1a 让位）。

### D2 分工表（`roles`，配置面 v6）

```ts
export interface RoleEntry {
  id: string                 // 稳定 id（配置键）
  label: string              // 显示名，如「前端」
  target: RouteTarget        // { provider, model, effort? }（复用现有形状与降级语义）
  teammate?: string[]        // 额外认领的队友名（精确匹配；Team 名字永不复用）
  aliases?: string[]         // 供模型识别的别名（如「frontend」「前端」），进分工表正文
  note?: string              // 给模型的补充说明（如「优先处理组件与样式」）
}
export interface RouterConfigV6 {
  version: 6
  driver?: RouteTarget | null
  driverSticky?: boolean
  rulesApplyToChildren?: boolean      // 见 D6；缺省由 §8 第 3 项裁定
  roles: Record<string, RoleEntry>
  // presets / flows / keywordGroups / auxTargets 沿用 v5 不动
}
```

- **认领集合 = `teammate[] ∪ {id}`**（评审阻塞 1 的修法）：`role.id` 自动成为一个认领名，杜绝"正文教模型同名起名、匹配却只认 `teammate[]`"的静默失败。
- 校验（沿用形状校验＋运行期降级口径）：`target` 完整；`id` 非空唯一；**任一认领名（含 `role.id`）不得被他 role 认领** ⇒ 写入期拒绝（认领歧义 = 静默换人）。
- 内置 `DEFAULT_ROLES()`：**空表**（不预置任何模型判断）；设置卡片提供"新建角色"＋三条示例文案（前端/后端/写作）供一键填入。
- 不可用目标：保留、标灰、运行期按 §8 第 6 项裁定处理。

### D3 知识注入：分工表 → 模型可读（`ctx.skills.register`）

- 注册 runtime skill `kimi-tide-team`：
  - `description`：一行索引，形如「派活前读我：前端→kimi-coding/k3、后端→zai-coding-cn/glm-5.3、写作→qwen-token-plan-cn/qwen3.8-max」（按当前 roles 生成；**无 roles 时不注册**）。**自检长度 ≤500 字符**（宿主目录 description 上限 `DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500`，`dsh-tool-skill/lib/index.js:40`），超长则退化为"角色数 + 前 N 条"摘要并在面板提示。
  - 正文：完整分工表（角色/别名/目标/备注）＋**派发配方**——①一次性：`workflow` 的 `agent(task, {provider, model})`；②常驻：`spawn_teammate`，**队友名必须取自该 role 的认领集合**，且须满足宿主命名规则（lower-kebab-case、≤64 字符、不可叫 `lead`；`dsh-experimental-agent-team/lib/types/roster.js:420`）；③何时不该派（琐碎任务/无对应角色）。
- 生命周期：配置变更 → 释放旧注册、注册新的（`ctx.skills.register` 返回 disposer）。**目录刷新的实际机制**（评审 M3/E4 更正）：`dsh-tool-skill` 在每个 pre-step 做 `snapshot` ＋ digest 比对，惰性替换目录消息（`dsh-tool-skill/lib/index.js:203-235`）；`skills/change` 只是 dsh-skill 侧的 emit（`dsh-skill/lib/index.js:404`）。结果与"变更后下一轮生效"一致，措辞以 tool-skill 机制为准。
- **成本声明**（评审 O2）：目录内容变化会对**全活会话**做整段替换（`dsh-tool-skill/lib/index.js:231-235`）⇒ 该次变更使 KV 前缀失效一次；建议同批合并 roles/flows 变更，避免连续多次。
- 降级：`ctx.skills` 不可用（未挂 dsh-skill 或服务缺席）⇒ **不注册** ＋ 面板提示，**不改任何路由行为**。
- 位置：新增 `src/team-skill.ts`（纯函数 `renderTeamSkill(roles)` + 注册/释放生命周期），便于单测。

### D4 一次性派发：不造工具，只保证"不劫持 + 看得见"

- **不注册**与官方 `workflow` 重叠的派发工具（C 档核心取舍）。
- 月汐职责：①D6 保证子代理不被关键词规则劫持；②观测——宿主 `subagent/start`／`subagent/end` 事件（**按 delegating parent scoped 发射**，`dsh-subagent/lib/types/types.d.ts:84-98`）⇒ 必须在 **agent 作用域**订阅或按 parent 过滤，否则漏记。

### D5 常驻队友绑定：请求层改道（S2 已实证"路由器看得见队友"，但 role 路径尚待 A2 验收）

- 识别：`agent/pre-step`（`step === 1`）时若 `delegationDepthOf(agent) > 0` 且 `ctx.agentTeams` 可用 ⇒ **`tryMembership(agent)`**（评审 S1：`membership()` 对非成员**抛** `TEAM_NOT_MEMBER`，`roster.js:53-55`；`tryMembership` 不抛、非成员/过期身份返回 undefined，`lib/types/index.d.ts:100-105`），再加纵深防御 `role === 'teammate'`；取到的名字即队友名。
- 命中：队友名 ∈ 某 role 的**认领集合**（`teammate[] ∪ {id}`）⇒ 决策目标 = 该 role 的 `target`，`via: 'role'`（新），原因串 `分工表「前端」→ kimi-coding/k3（队友 frontend）`。
- 配置变更对存量队友**动态生效**（每轮重算，不锁定创建时配置；见 §8 第 7 项）。
- 优先级链（**逐档写死，供逐条验收**）：
  1. 显式 `@provider[/model]`（既有，最高）
  2. **调用方显式点名的模型**：非队友委派沿用 B-1a 让位（`agent.options` 与打底不同 ⇒ keep）
  3. **分工表 role 命中**（仅队友，新）——优先于打底
  4. 预设关键词规则（主会话保留；子代理按 D6）
  5. 打底：主会话 = `driverSticky ? driver : preset.default`；子代理 = 继承目标（B-1a keep）
- **第 2、3 档在实践中互斥**：队友由 `spawn_teammate` 创建（schema 无模型字段 ⇒ 其"传入目标"只是继承值，不是调用方的点名）；`workflow` 委派的子代理可点名模型，但不是 Team 成员、不会被分工表认领。
- **更正 v1（评审 S3）**：**不需要 B-1a 例外**。`shouldKeepExternalTarget` 首行守卫即 `decision.kind !== 'route' || decision.via !== 'default'` ⇒ 返回 false（`src/router.ts:523-527`），`via:'role'` 天然不被让位吞掉。实现侧改为补一条单测「`via:'role'` ⇒ 不被拦为 keep」。
- **step 门控已足够**（评审 O6）：队友每轮从 `step 1` 起、工具循环步本来就不切模型（`src/router.ts:765-771`），无需额外处理非首步。
- **实现位置约束**（评审 S6）：`decide()` 现签名无 agent/depth 入参（`src/router.ts:839`）且是纯函数 —— **role 分支与 depth 判定长在 pre-step 闭包里**，`decide` 只新增"子代理跳规则"的入参开关，保持可单测的纯函数形态。

### D6 子代理与关键词规则（**行为变更，待裁定**）

- 现状：子代理只在"打底"决策上让位（B-1a），关键词规则仍可能劫持子会话——而子会话的"最新用户文本"是**调用方写的任务描述**，用它做关键词路由等于按任务描述二次改道，与"派发意图优先"直接冲突。
- 建议：**关键词规则只服务主会话**（`delegationDepth === 0`）；子代理不参与关键词匹配。配置 `rulesApplyToChildren: boolean`（`true` 恢复旧语义，供回退）。
- 连带效果：**语义确认闸（hitConfirm）对子会话应零调用**（不参与关键词匹配 ⇒ 不触发闸门；`src/router.ts:805-816`）——列入单测（评审 S7）。

### D7 留痕（可观测）

- 面板新增「派发」区，每次派发一行：`角色/领域 → target（effort）· 依据 · 时间`；保留最近 20 条。
- **依据枚举**（评审 O3）：`role | explicit | keep | unclaimed`（`unclaimed` = 队友未在分工表）。
- **ledger 层级与寿命**（评审 S5；v1 把它写在 router 闭包里，配置变更重挂载即清空，`src/router.ts:756-762`）：ledger 放**插件级**、键为 **`Agent`**（`WeakMap<Agent, …>`，不是 agentId），**不随路由器配置重挂载清空**；是否跨宿主重启/落盘见 §8 第 8 项。
- **不读 `TeamMemberView.model`**（S2 副产物）：由插件 per-agent 记账，经 projection 推送；`stateVersion` 升级。
- 决策原因串 ≤120 字符约定沿用（如 `分工表「前端」→ kimi-coding/k3（队友 frontend）`）。

### D8 护栏

- 目标不可用 ⇒ **不改道** + 面板提示（不静默换人）；队友侧的落点按 §8 第 6 项裁定。
- 额度 ⇒ 派发行旁显示该目标的源状态（复用 `quotaSources` 三态）。
- 档位 ⇒ 沿用支持集判定（`role.target.effort` 不支持即剥离）。

## 3. 非目标（明确不做）

- **不做插件内置的固定串联流水线**（"A→B→C 由配置写死"）——编排权在模型手里，插件只提供分工表与护栏。与 2026-08-31 裁撤项「N 模型流水线」的关系：**口径挂账中**（§8 第 4 项），本稿不擅自定性。
- 不注册与官方 `workflow` 重叠的派发工具。
- 不做 LLM 任务分类器 / 自动能力评分（v0.5.0 退役结论延续）。
- 不做跨进程或远程成员、不做 worktree 隔离（宿主 Team 的既有硬限制）。
- 不做角色的自动升级/降级、不做按额度自动换模型。

## 4. 兼容与迁移

- v5 → v6：**只新增字段**——`driver = null`、`driverSticky = false`、`roles = {}`；**迁移不写 `rulesApplyToChildren`**（评审阻塞 2 的修法：该值取决于 §8 第 3 项裁定，写死会与"待裁定"自相矛盾）。`version` 升 6，走既有迁移链 `coerceRouterConfigV4` 家族；settings 命名空间与 sidecar 两条落点沿用（含 `.pre-v6` 留档）。
- **兼容口径（诚实声明）**：迁移不改动任何既有字段 ⇒ **主会话路由行为逐字节不变**；唯一的行为差异来自 D6 的新语义（子代理不再参与关键词规则）。若 §8 第 3 项裁定"保持旧语义"，则该开关运行期缺省 = `true`，**连这一处差异也不存在**（完全等价 v1.4.1）。
- **服务缺席的探测方式**（评审 S2）：cordis 服务代理在服务未提供时**访问即抛**（`cordis/lib/index.js:671-695`）⇒ 装配期必须 `try/catch` 探测 `ctx.agentTeams`／`ctx.skills` 并**缓存布尔**，不得在热路径上反复探。
- 宿主无 `ctx.agentTeams` ⇒ D5/D7 的队友面自动跳过；无 `ctx.skills` ⇒ D3 跳过；两者都不影响 D1/D2/D4/D6/D8。
- 投影 `stateVersion` 升级 ⇒ 旧会话缓存按既有惯例重建；**旧会话的派发区初始为空**（评审 M7：属预期，不是缺陷，先告知）。

## 5. 验收（判据）

**单测**：roles 解析与校验（含"认领名被两个 role 认领须拒绝"）、优先级链 5 档逐档用例、**「`via:'role'` ⇒ 不被 `shouldKeepExternalTarget` 拦」**、**「`depth > 0` 时 hitConfirm 判官调用数 = 0」**、`renderTeamSkill` 正文与 description 长度自检快照、决策原因串、迁移 v5→v6 行为不变。

**实机（桌面端，发版门禁）**：

| # | 判据 | 方法 |
|---|---|---|
| A1 | 主会话打底＝driver（**三变体**） | A1a `driverSticky: true` + `driver`=flash ⇒ 非关键词轮请求头 = `deepseek-official/deepseek-flash`；A1b `driver=null` ⇒ 打底 = 宿主默认；A1c 关键词轮 ⇒ **规则仍赢**（打底被规则覆盖） |
| **A2** | **队友按分工表改道（最高优先级——`role` 路径从未预演）** | 建队友，名字取自某 role 的认领集合 ⇒ 其子会话请求头 = 该 role 的 target（与 A5 的"未认领"反例成对） |
| A3 | 一次性派发不被劫持 | `workflow agent(...,{provider,model})`，**任务描述须含关键词组词**（否则 v1.4.1 也能过、判据失效）⇒ 子会话请求头 = 指定模型 |
| A4 | 分工表进目录且可加载 | roles 非空时新会话 `<available_skills>` 含 `kimi-tide-team`，其 description ≤500 字符；`skill` 调用返回正文；**反向**：roles 空 ⇒ 目录中无 `kimi-tide-team`；roles 变更 ⇒ 下一 pre-step 出现目录替换消息 |
| A5 | 未认领的队友（对照 A2） | 队友名不在任何 role 认领集合 ⇒ 不改道 + 面板标 `unclaimed` |
| A6 | role 目标不可用 | 按 §8 第 6 项的裁定执行 + 面板提示（无静默换人） |
| A7 | 存量兼容 | v5 配置迁移后**主会话**路由行为与 v1.4.1 逐字节一致；子代理侧按 §8 第 3 项的裁定核验（前置＝§8 第 3 项裁定落地 ＋ 迁移不写死该字段） |
| A8 | **多队友并发**（评审新增） | 两个队友分属不同 role 同时跑 ⇒ 两路请求头各自命中各自 role 的目标（per-agent 槽位天然隔离，`src/router.ts:713` WeakMap） |

## 6. 涉及文件（草案）

- `src/config.ts`（v6 形状、`DEFAULT_ROLES()`、`driver`/`driverSticky`/`rulesApplyToChildren`）
- `src/migrate.ts`（v5 → v6，只加字段）
- `src/settings-schema.ts`（role 校验：id/认领名唯一性、target 形状）
- `src/roles.ts`（**新**：分工表解析、认领集合反查、`renderTeamSkill` 正文与 description 生成＋长度自检）
- `src/team-skill.ts`（**新**：`ctx.skills.register` 生命周期与降级）
- `src/router.ts`（`via: 'role'` 决策、优先级链（**在 pre-step 闭包内**）、子代理跳规则开关、`decide` 保持纯函数）
- `src/index.ts`（装配、`ctx.agentTeams`/`ctx.skills` 的 try/catch 探测与缓存、`subagent/start|end` 的 agent 作用域订阅、插件级 ledger）
- `src/projection.ts` + `src/client/{SettingsCard,card-store,TideDock}`（角色编辑器、派发行、来源状态、`unclaimed` 呈现）
- 测试：`test/roles.test.ts`、`test/team-skill.test.ts`、`test/router.test.ts`（优先级链与新单测）扩展
- 文档：`docs/router.md`、`packages/dsh-kimi-tide/docs/`（如需新增 `team-dispatch.md`）、README 中英双语（同一提交）

## 7. 版本定位

v2.0.0（major：新增分工层语义 + 两项行为变更——**D1 需用户显式开启**（缺省保持 v1.4.1 语义）、**D6 是否默认生效取决于 §8 第 3 项裁定**；发版前过实机验收门禁 A1–A7 全绿 + 用户裁定 tag）。

## 8. 待用户裁定

| # | 事项 | 建议 |
|---|---|---|
| 1 | D1 主驱动恒定（`driverSticky`）是否开 | 开（这是愿景第一步） |
| 2 | D1 主会话关键词规则是否保留 | 保留（规则是用户显式意图） |
| 3 | D6 子代理是否退出关键词规则（决定 `rulesApplyToChildren` 运行期缺省） | 退出（缺省 `false`＝新语义） |
| 4 | 旧裁定「裁撤 N 模型流水线」与本文关系 | 挂账中（用户 2026-10-05 裁定"先看方案再定"） |
| 5 | `DEFAULT_ROLES()` 是否预置示例角色 | 空表 + 设置页三条可一键填入的示例 |
| 6 | **role 目标不可用时，队友的降级落点** | 保持继承值（B-1a keep），不静默换人 |
| 7 | **roles 变更对存量队友**：动态生效 vs 创建时锁定 | 动态（每轮重算） |
| 8 | **派发 ledger 的寿命**：是否活过配置重挂载／宿主重启／要不要落盘 | 活过重挂载（插件级），不落盘（会话内） |
| 9 | `role.id` 自动成为认领名 | 是（写入期防冲突） |
| 10 | 同一 role 认领**多个**队友名是否支持 | 支持（`teammate[]` 为数组） |
| 11 | `driver=null`+`driverSticky=true` 的面板呈现；`activePreset=null` 时 driver 不生效 | 照 D1 边界写明（请确认） |
| 12 | 演进预案：上游若给 `spawn_teammate` 加模型字段，D5 是否退役 | 挂账，届时评估 |
| 13 | skill 正文是否教队友名合法性（kebab-case/≤64/非 `lead`） | 教（否则模型起名即 spawn 失败） |

> 第 1–5 项为骨架期已列；**第 6–13 项为 Round-1 评审新增**。若你对第 9–13 项无异议，可一句"细节按建议"通过。

## 9. 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-10-05 | v1 | 初稿：骨架经用户确认（C 档）；三项 spike（S1/S2/S3）全绿并写入 §1.3；两项行为变更（D1/D6）列 §8 待裁定 |
| 2026-10-05 | v2 | Round-1（kimi-coding/k3）「有条件通过」处置：2 项阻塞全修（D3/D5 认领集合断裂；§4 迁移写死未裁定值）、8 条建议全采纳、6 条可选全并入、8 项缺失决策并入 §8（第 6–13 项）。全表见 §10 |
| 2026-10-05 | v2（补漏） | 并入评审档案 §5/§7 中未进结构化返回值的项：探针 A/B 命名（E2）、目录刷新机制措辞（M3/E4）、A1 三变体与 A4 反向、新增 A8 并发探针、stateVersion 旧会话预期（M7） |

## 10. Round-1 评审处置全表

| # | 类别 | 评审意见（摘要） | 处置 |
|---|---|---|---|
| B1 | 阻塞 | D3 教"与角色同名"、D5 只认 `teammate[]` ⇒ 静默不命中 | **采纳**：认领集合写死为 `teammate[] ∪ {id}`；写入期禁跨 role 冲突（D2/D5） |
| B2 | 阻塞 | §4 迁移写死 `rulesApplyToChildren=false`，而该值是 §8 未裁定项 | **采纳**：迁移不写该字段，缺省由运行期给（§4/§7） |
| S1 | 建议 | `membership()` 对非成员抛 `TEAM_NOT_MEMBER` ⇒ 改用 `tryMembership` | **采纳**（D5；已核实 `roster.js:53-55`、`index.d.ts:100-105`） |
| S2 | 建议 | `ctx.agentTeams`/`ctx.skills` 缺席时访问即抛（cordis 代理）⇒ 装配期 try/catch 探测并缓存 | **采纳**（§4） |
| S3 | 建议 | B-1a 例外是死条件（`via !== 'default'` 首行守卫） | **采纳**：删例外段，改单测（D5） |
| S4 | 建议 | A2 的"S2 已预演"论据错误（role 路径从未预演） | **采纳**：删注记、A2 提为最高优先级、反例对照挪 A5（§1.3/§5） |
| S5 | 建议 | 配置重挂载会清空 router 闭包 WeakMap；键应为 Agent | **采纳**：ledger 移插件级、键为 Agent（D7），寿命并入 §8-8 |
| S6 | 建议 | `decide()` 无 agent/depth 入参 ⇒ role 分支长在 pre-step 闭包，保持纯函数 | **采纳**（D5 实现位置约束） |
| S7 | 建议 | hitConfirm 对子会话应零调用 | **采纳**：D6 连带效果 + 单测 |
| S8 | 建议 | A3 方法须写明任务描述含关键词组词，否则判据失效 | **采纳**（§5 A3） |
| O1 | 可选 | 目录 description 500 字符截断 | **采纳**：D3 自检（已核实常量 `dsh-tool-skill/lib/index.js:40`） |
| O2 | 可选 | roles 变更触发全活会话目录整替换 ⇒ KV 前缀失效 | **采纳**：D3 成本声明 + 建议同批合并变更 |
| O3 | 可选 | 「未在分工表」不在依据枚举内 | **采纳**：补第四值 `unclaimed`（D7） |
| O4 | 可选 | `driver=null` 面板呈现；`activePreset=null` 时 driver 不生效未写明 | **采纳**（D1 边界） |
| O5 | 可选 | `subagent/start|end` 按 delegating parent scoped ⇒ 作用域选错会漏记 | **采纳**（D4） |
| O6 | 可选 | `step===1` 门控已足够 ⇒ 补一行推理 | **采纳**（D5） |
| M1-M8 | 缺失决策 | role.id 是否自动认领／降级落点／动态 vs 锁定／ledger 寿命／driver 面板／多队友名／上游演进／命名合法性教学 | **采纳**：并入 §8 第 6–13 项 |
| E1–E4 | 事实偏差 | 探针 A/B 未定义、A2「已预演」论据不成立、B-1a 例外系误判、`skills/change` 机制措辞不准 | **采纳**：§1.3 定义探针 A/B；A2 去论据；删例外改单测；D3 按 tool-skill 机制改措辞 |
| A-变体 | 判据补全 | A1 缺 `driver=null`／关键词轮变体、A4 缺反向、缺并发探针 | **采纳**：A1 拆三变体、A4 补反向、新增 A8 |
