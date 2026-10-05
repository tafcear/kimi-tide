# 团队派发（分工层执行面）设计稿 v1

> 状态：**待用户审定**（骨架已于 2026-10-05 经用户确认「C 档：官方优先＋月汐补缺」；三项 spike 已全绿，见 §1.3）。审定通过 → writing-plans 出实施计划，**不在此稿内改任何代码**。
> 前序：v1.4.1（2026-10-03）已发布；本稿提出的两项**行为变更**（D1/D6）逐项列在 §8 待裁定。
> 上游能力依据：宿主 `@deepseek-ai/dsh@0.1.7-rc.2` 实读（六个包：agent-team / tool-agent-team / agent-team-profile / tool-subagent / subagent / workflow-ptc）。

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

## 2. 设计决策

### D1 主驱动恒定（**行为变更，待裁定**）

- 新配置 `driver?: RouteTarget | null`：`null` = 跟随宿主 `agent-default-model`（推荐留 null，即 flash）。
- 新开关 `driverSticky: boolean`（缺省 `false`＝行为保持）：
  - `true` ⇒ **主会话（`delegationDepth === 0`）的打底目标 = `driver`**，不再等于 `preset.default`；关键词规则**仍可**改道（规则是用户显式写下的意图，保留）。
  - `false` ⇒ 完全维持 v1.4.1 语义（打底＝预设默认）。
- 理由：愿景第一步；且"打底无条件覆盖"正是 2026-09-20 钉指定模型缺陷的同一根因（当时只对子代理开了 B-1a 让位）。
- 边界：`driverSticky` **只影响打底**，不改变规则、显式 `@`、图像护栏任何既有语义。

### D2 分工表（`roles`，配置面 v6）

```ts
export interface RoleEntry {
  id: string                 // 稳定 id（配置键）
  label: string              // 显示名，如「前端」
  target: RouteTarget        // { provider, model, effort? }（复用现有形状与降级语义）
  teammate?: string[]        // 认领的队友名（精确匹配；Team 名字永不复用）
  aliases?: string[]         // 供模型识别的别名（如「frontend」「前端」），进分工表正文
  note?: string              // 给模型的补充说明（如「优先处理组件与样式」）
}
export interface RouterConfigV6 {
  version: 6
  driver?: RouteTarget | null
  driverSticky?: boolean
  roles: Record<string, RoleEntry>
  // presets / flows / keywordGroups / auxTargets 沿用 v5 不动
}
```

- 校验（沿用形状校验＋运行期降级口径）：`target` 完整；`id` 非空唯一；`teammate` 名非空且**不得被两个 role 同时认领**（写入期拒绝，理由：认领歧义会导致静默换人）。
- 内置 `DEFAULT_ROLES()`：**空表**（不预置任何模型判断，避免替用户做能力决策）；设置卡片提供"新建角色"按钮＋三条示例文案（前端/后端/写作）供一键填入。
- 不可用目标：保留、标灰、运行期不改道（沿用现有"标灰＋跳过"语义）。

### D3 知识注入：分工表 → 模型可读（`ctx.skills.register`）

- 注册 runtime skill `kimi-tide-team`：
  - `description`：一行索引，形如「派活前读我：前端→kimi-coding/k3、后端→zai-coding-cn/glm-5.3、写作→qwen-token-plan-cn/qwen3.8-max」（按当前 roles 生成，无 roles 时不注册）。
  - 正文：完整分工表（角色/别名/目标/备注）＋**派发配方**——①一次性：`workflow` 的 `agent(task, {provider, model})`；②常驻：`spawn_teammate` 且**队友名取 role 的 `teammate` 名单或与角色同名**（这一步是 D5 生效的前提，必须写在正文里）；③何时不该派（琐碎/无对应角色）。
- 生命周期：配置变更 → 释放旧注册、注册新的（`ctx.skills.register` 返回 disposer）；宿主 `skills/change` 驱动目录刷新。
- 降级：`ctx.skills` 不可用（未挂 dsh-skill）→ 不注册、面板提示，**不改任何路由行为**。
- 位置：新增 `src/team-skill.ts`（纯函数 `renderTeamSkill(roles)` + 注册/释放生命周期），便于单测。

### D4 一次性派发：不造工具，只保证"不劫持 + 看得见"

- **不注册**与官方 `workflow` 重叠的派发工具（C 档核心取舍）。
- 月汐职责：①D6 保证子代理不被关键词规则劫持；②观测——宿主 `subagent/start`／`subagent/end` 事件（scoped emit，携带 provider/runId/parent）→ 记一条派发行（D7）。

### D5 常驻队友绑定：请求层改道（S2 已实证）

- 识别：`agent/pre-step`（`step === 1`）时若 `delegationDepthOf(agent) > 0` 且 `ctx.agentTeams` 可用 ⇒ `ctx.agentTeams.membership(agent)` 取**队友名**（失败/非成员则跳过，不报错）。
- 命中：队友名 ∈ 某 role 的 `teammate[]` ⇒ 本轮决策目标 = 该 role 的 `target`，`via: 'role'`（新），原因串 `分工表「前端」→ kimi-coding/k3（队友 frontend）`。
- 优先级链（**逐档写死，供逐条验收**）：
  1. 显式 `@provider[/model]`（既有，最高）
  2. **调用方显式点名的模型**：非队友委派沿用 B-1a 让位（`agent.options` 与打底不同 ⇒ keep）
  3. **分工表 role 命中**（仅队友，新）——**优先于打底，且不受 B-1a 让位吞掉**
  4. 预设关键词规则（主会话保留；子代理按 D6）
  5. 打底：主会话 = `driverSticky ? driver : preset.default`；子代理 = 继承目标（B-1a keep）
- **第 2、3 档在实践中互斥**，不构成冲突：队友由 `spawn_teammate` 创建（schema 无模型字段 ⇒ 其"传入目标"只是继承值，不是调用方的点名）；`workflow` 委派的子代理可点名模型，但不是 Team 成员、不会被分工表认领。
- **B-1a 例外（必须实现）**：`shouldKeepExternalTarget` 的让位条件追加"且该 agent **未**命中分工表"；否则队友会停在继承模型上（S2 探针 A 即该形态）。
- 类型：`RouteDecision.via` 增 `'role'`；面板/投影/试一句同步（试一句保持纯文本语义，不模拟队友身份，卡片声明这一点）。

### D6 子代理与关键词规则（**行为变更，待裁定**）

- 现状：子代理只在"打底"决策上让位（B-1a），关键词规则仍可能劫持子会话——而子会话的"最新用户文本"是**调用方写的任务描述**，用它做关键词路由等于按任务描述二次改道，与"派发意图优先"直接冲突。
- 建议：**关键词规则只服务主会话**（`delegationDepth === 0`）；子代理不参与关键词匹配。配置 `rulesApplyToChildren: boolean`（缺省 `false`＝新语义；`true` 恢复旧语义，供回退）。

### D7 留痕（可观测）

- 面板新增「派发」区，每次派发一行：`角色/领域 → target（effort）· 依据（role/explicit/keep）· 时间`；保留最近 20 条（沿用面板只读、可展开的现有形态）。
- **不读 `TeamMemberView.model`**（S2 副产物）：由插件 per-agent 记账（WeakMap：agentId → 本轮决策 + 队友名 + 依据），经 projection 推送；`stateVersion` 升级。
- 决策原因串 ≤120 字符约定沿用（如 `分工表「前端」→ kimi-coding/k3（队友 frontend）`）。

### D8 护栏（复用为主）

- 目标不可用 ⇒ 不改道 + 面板提示（**不静默换人**）。
- 额度 ⇒ 派发行旁显示该目标的源状态（复用 `quotaSources` 三态）。
- 档位 ⇒ 沿用支持集判定（`role.target.effort` 不支持即剥离）。

## 3. 非目标（明确不做）

- **不做插件内置的固定串联流水线**（"A→B→C 由配置写死"）——编排权在模型手里，插件只提供分工表与护栏。与 2026-08-31 裁撤项「N 模型流水线」的关系：**口径挂账中**（§8 第 4 条），本稿不擅自定性。
- 不注册与官方 `workflow` 重叠的派发工具（若 S1/S2 之外的场景证明必要，另起设计）。
- 不做 LLM 任务分类器 / 自动能力评分（v0.5.0 退役结论延续）。
- 不做跨进程或远程成员、不做 worktree 隔离（宿主 Team 的既有硬限制）。
- 不做角色的自动升级/降级、不做按额度自动换模型（用户配置优先）。

## 4. 兼容与迁移

- v5 → v6：`driver = null`、`driverSticky = false`、`roles = {}`、`rulesApplyToChildren = false`（`version` 升 6，走既有迁移链 `coerceRouterConfigV4` 家族；settings 命名空间与 sidecar 两条落点沿用，含 `.pre-v6` 留档）。
- **兼容口径（诚实声明）**：迁移本身不改动任何既有字段 ⇒ **主会话路由行为逐字节不变**；唯一的行为差异来自 D6 的新默认（子代理不再参与关键词规则）。若 §8 第 3 项裁定不采纳，则该开关缺省 `true`，**连这一处差异也不存在**（完全等价 v1.4.1）。
- 宿主无 `ctx.agentTeams`（未启用 Team 组合包）⇒ D5 自动跳过、D7 只记一次性派发；D3/D4/D6/D8 行为不变。
- 宿主无 `ctx.skills` ⇒ D3 跳过（面板提示），其余不变。
- 投影 `stateVersion` 升级 ⇒ 旧会话缓存按既有惯例重建。

## 5. 验收（判据）

**单测**：roles 解析与校验（含"同一队友被两个 role 认领"须拒绝）、优先级链 5 档逐档用例、B-1a 例外、`renderTeamSkill` 正文快照、决策原因串、迁移 v5→v6 行为不变。

**实机（桌面端，发版门禁）**：

| # | 判据 | 方法 |
|---|---|---|
| A1 | 主会话打底＝driver | `driverSticky: true` + driver=flash ⇒ 非关键词轮请求头 = `deepseek-official/deepseek-flash` |
| A2 | 队友按分工表改道 | 建队友 `frontend` ⇒ 其子会话请求头 = role 目标（对照 S2 探针 B 已预演） |
| A3 | 一次性派发不被劫持 | `workflow agent(...,{provider,model})` ⇒ 子会话请求头 = 指定模型 |
| A4 | 分工表进目录且可加载 | roles 非空时，新会话 `<available_skills>` 含 `kimi-tide-team`；`skill` 调用返回正文 |
| A5 | 未在分工表的队友 | 不改道 + 面板标「未在分工表」 |
| A6 | role 目标不可用 | 不改道 + 面板提示（无静默换人） |
| A7 | 存量兼容 | v5 配置迁移后**主会话**路由行为与 v1.4.1 逐字节一致；子代理侧按 §8 第 3 项的裁定核验 |

## 6. 涉及文件（草案）

- `src/config.ts`（v6 形状、`DEFAULT_ROLES()`、`driver`/`driverSticky`/`rulesApplyToChildren`）
- `src/migrate.ts`（v5 → v6）
- `src/settings-schema.ts`（role 校验：id/teammate 唯一性、target 形状）
- `src/roles.ts`（**新**：分工表解析、队友认领反查、`renderTeamSkill` 正文生成）
- `src/team-skill.ts`（**新**：`ctx.skills.register` 生命周期与降级）
- `src/router.ts`（`via: 'role'` 分支、优先级链、B-1a 例外、子代理规则策略）
- `src/index.ts`（装配、`ctx.agentTeams`/`ctx.skills` 可用性探测、`subagent/start|end` 订阅）
- `src/projection.ts` + `src/client/{SettingsCard,card-store,TideDock}`（角色编辑器、派发行、来源状态）
- 测试：`test/roles.test.ts`、`test/team-skill.test.ts`、`test/router.test.ts` 扩展
- 文档：`docs/router.md`、`packages/dsh-kimi-tide/docs/`（如需新增 `team-dispatch.md`）、README 中英双语（同一提交）

## 7. 版本定位

v2.0.0（major：新增分工层语义 + 两项行为变更——**D1 需用户显式开启**（缺省保持 v1.4.1 语义）、**D6 缺省生效**（可回退到旧语义）；发版前过实机验收门禁 A1–A7 全绿 + 用户裁定 tag）。

## 8. 待用户裁定（逐项勾）

| # | 事项 | 建议 |
|---|---|---|
| 1 | D1 主驱动恒定（`driverSticky`）是否开 | 开（这是愿景第一步） |
| 2 | D1 主会话关键词规则是否保留 | 保留（规则是用户显式意图） |
| 3 | D6 子代理退出关键词规则 | 是 |
| 4 | 旧裁定「裁撤 N 模型流水线」与本文关系 | 挂账中（用户 2026-10-05 裁定"先看方案再定"） |
| 5 | `DEFAULT_ROLES()` 是否预置示例角色 | 空表 + 设置页三条可一键填入的示例 |

## 9. 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-10-05 | v1 | 初稿：骨架经用户确认（C 档）；三项 spike（S1/S2/S3）已全绿并写入 §1.3；两项行为变更（D1/D6）列 §8 待裁定 |
