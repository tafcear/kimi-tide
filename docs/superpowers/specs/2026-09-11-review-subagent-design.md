# Review Subagent 设计（评审子代理：带工具的独立评审者 + 宿主级熔断）

> 状态：**v2（2026-09-11 独立评审 k3「有条件同意」+ 控制器逐项复核后回改）** → 待用户复审 → 未实施
> 评审档案：[`docs/audit/2026-09-11-review-subagent-spec-kimi-review.md`](../../audit/2026-09-11-review-subagent-spec-kimi-review.md)（评审报告全文 + 控制器逐项复核与处置；S1/S2 两条严重项已实读复现并封堵）
> 前置：Review Flow 1.1.0（[`2026-09-02-review-flow-design.md`](2026-09-02-review-flow-design.md)——本设计把它列为「不做（留下迭代）」的**评审子代理形态（P3）**做掉）、协作编排 0.6.0（[`2026-08-22-collaboration-flows-design.md`](2026-08-22-collaboration-flows-design.md)）、子代理派发契约 spike S2（[`../spikes/2026-08-22-collab-flows-s2-s3.md`](../spikes/2026-08-22-collab-flows-s2-s3.md)：**GO**）
> 问题起源：用户实机（cg-tool 会话）——「让 KIMI 评审」时主 agent **绕过 DSH/月汐**，直接抓 `C:\Users\tafce\.kimi\code\bin\kimi.exe -p` 跑外部 CLI 做「spec 文档 + 代码库」评审。绕道的代价：不经路由、无决策留痕、dock 面板不显示、配额面板不统计（Kimi Code 订阅额度与 Console API 额度是两套账）、不进 DSH 会话日志
> 事故依据（本项目实证，非泛论）：主库 `AI记忆/避坑记录.md` 2026-08-26（k3 评审子代理被技能劫持 + `job_output` 幻觉 id 轮询约 160 步、整轮 220 步被掐断、越权写坏 Obsidian 主库；结论原文「**提示词级防线拦不住，正解是宿主级拦截或避开 k3**」）、2026-08-27（k3 终审读 331KB diff 发散：30 步不收敛、违反只读跑 git、重复定位；同日派发提示词被路由规则改道到额度耗尽模型致 429 连杀）、2026-08-30（子代理「发射塌缩」成 pwsh 空命令死循环、产出归零）、2026-08-20（k3 多轮工具 400 → 子代理空消息终止）

## 1. 背景与根因

### 1.1 现象

用户在一个**非 kimi-tide 仓库**的会话里要求「让 KIMI 评审」设计稿。该会话的主 agent 探查后选择外部 Kimi Code CLI（`kimi.exe`，支持 `-p` 非交互）完成「读文档 + 读代码」的并联评审。

### 1.2 根因（三条，逐条实读源码/配置确认）

1. **月汐的评审能力无工具**。1.1.0 评审流 = `ctx.llm.stream` 直调 reviewer（`src/review.ts`）：输入仅「本轮用户需求 + 主模型本轮产出」两段文本（各 ≤`REVIEW_INPUT_LIMIT`=12000 字符），无工具、不读任何文件、`AbortSignal.timeout(60_000)` 有界。**它评的是文本，不是对象**——无法承担「读 spec + 读代码库」的评审。
2. **本机实际配置下，那句「评审」其实触发了月汐，只是形态不对味**。`~/.dsh/settings.yaml` → `kimi-tide-router`：`activePreset: saving`、`flows.review = { trigger: keywords, keywordGroup: review, reviewer: kimi-coding/k3 }` ⇒ `review` 组被认领 ⇒ 该组路由规则（`rule-5` → k3）静态抑制、本轮不切模型，改为**轮末**把两段文本发给 k3 异步评一次。评审发生了，但评的不是 spec 与代码 → 用户观感即「没走 tide」。
3. **月汐体系里唯一能承担「带工具的独立评审」的形态没被用上**。`docs/agent-collaboration-loop.md` §3.1 早已写明：dsh-kimi-bridge 退役后，「审查角色由 **@kimi 子代理经 kimi-tide 路由**承接」；`docs/audit/*` 的历次归档级评审全部是该形态。但它**靠主 agent 自觉调用**，且派发本身脆弱（见 §11）。

### 1.3 用户裁定（2026-09-11 本会话）

| # | 裁定 | 内容 |
|---|---|---|
| 1 | 形态 | **方案 C：同一执行器 + 两个入口**——模型可调用的工具入口 + 轮末自动入口，共用一套子代理执行器（手动命令是不改形态的第三入口，见 §6.3） |
| 2 | 权限 | **硬只读**：`toolFilter` 摘掉写类/命令类工具（宿主级强制，不靠提示词自觉） |
| 3 | 轮末入口 | **立场 1：保留时机、收紧门槛、换形态**——轮末加「产物门槛」，发起时走子代理执行器、评本轮改动的文件。**注（v2 措辞修正）**：`direct` 并非"只留给手动快评"，而是**存量配置的既有行为**——不写 `executor` 时轮末逐字节维持 1.1.0 现状；`subagent` 是显式升级路径，手动命令与 direct 形态都保留 |
| 4 | 熔断 | **动作 A：只终止**（dispose + 报错 + 留痕 + 给出子会话 id），**不自动换模型重派**——要不要重派由主 agent/用户决定 |
| 5 | 配置 | **opt-in**：不写新字段 = 现行 1.1.0 行为逐字节一致（沿用本项目「新字段全可选」惯例，省掉整条迁移链与 `.pre-vN` 留档） |

## 2. 宿主契约（2026-09-11 活体实读 + 包内类型锚点；v2 按评审 A 表修正行号与措辞）

| 契约 | 锚点 | 用途 |
|---|---|---|
| `SubagentRun = { id, localAgent: Agent \| undefined, result: Promise<SubagentResult>, dispose() }` | `dsh-subagent/lib/types/types.d.ts:292-318`（**`localAgent` :304、`dispose` :317**） | 派发与回收；**`localAgent` 是熔断监视器的挂点** |
| `ctx.subagents.start(name, request)` / `ctx.subagents.list()` | **活体 Inspect `Service.listService('subagents')`**（包内 `types.d.ts` 只有 provider 侧 `SubagentProvider.start(request)` :359，**无服务侧签名**——v2 更正 v1 的锚点归属） | 派发；provider 名单 |
| `SubagentStartRequest = { label?, prompt, parent, signal, agentOptions?, outputSchema?, maxDepth?, toolFilter?, persona? }` | `types.d.ts:136-192`（逐字段：label:138 / prompt:140 / parent:146 / signal:154 / agentOptions:162 / outputSchema:168 / maxDepth:175 / toolFilter:183 / persona:191） | 执行器入参形态 |
| `AgentOptions = { provider?, model?, reasoningEffort?, maxTokens? }` | **活体 Inspect 引用类型**（形状 import 自 `dsh-agent`，包内无定义）；in-process「merge over 父 Agent options」语义成立（`types.d.ts:157-160`） | 钉 reviewer 模型——**但需配合 §4 步骤 2.5 的路由豁免，否则被自家路由层覆盖（S1）** |
| `ToolRestriction = { allow?, deny? }`；`ctx.tools.restrict` 语义「Restrictions intersect」「空过滤/未知名/scope-local 名/reserved 名失败」 | `dsh-tools/lib/types/index.d.ts:475-480`、`:603-609` | 硬只读主机制 |
| **⚠ 保留通道不受限制**：restrictions「do not affect scoped registrations or the reserved PTC mode transport」；`run_code` 在可过滤层之外、按 scope mode 追加；PTC 下模型直调**只能**是 `run_code`，嵌套子派发才可调可见工具 | `index.d.ts:472-473`、`:554-562`、`:625-627`、`:657-663` | **PTC 部署下 toolFilter 约束不到 `run_code`（S2）→ §4 步骤 0 fail-closed 拒派发** |
| `ctx.tools.guard(guard): () => void`（monotonic，`agent.ctx` 上注册只作用于该 agent，返回字符串即拒绝） | `index.d.ts:610-620`、`:481-489` | 二级防线（拒 `run_code`） |
| in-process 驱动器：在**未发布作用域**安装 persona / toolFilter / 结构化输出（`lib/index.js:171-178`）；子代理继承 cwd 与谱系（`types.d.ts:142-145`）；**工具限制不导入**（全新扁平作用域，过滤作用于整个继承面——`dsh-tools:630-635`）；**但父级显式沙箱覆盖与 `'never'` 审批 pin 会随 run 带入子会话**（driver `:169/172` `captureDelegatedPolicyOverrides` + `appendDelegatedPolicyOverrides`） | driver `lib/index.js:169-186`；driver README「A run carries the parent's explicit sandbox override and `'never'` approval pin into the child」 | v2 更正 v1 措辞：只读**只能**靠 toolFilter，**不能**指望权限链变弱 |
| `SubagentResult = { output: ContentBlock[], structured?, diagnostic?, stopReason }`；五态 | `types.d.ts:239-282`（枚举 :239-250） | 结果映射；**`output` 可为 `[]`（:258-263）→ 空报告必须判失败** |
| `ctx.tools.register(definition: ToolDefinition): () => void` | `index.d.ts:601`；`ToolDefinition` :106-172（execute 第二参 `ToolRunContext` :119） | 工具行注册 |
| `ToolExecutionInput.agent?: Agent`（**可选**） | `index.d.ts:197-208` | 工具入口取 parent；缺失需显式报错 |
| `SessionEventMap`：`tool/call{turn,step,callId,name,arguments}`、`tool/result{…,error?{name,code}}`、`step/start`、`assistant/message` | **活体 Inspect 引用类型**（`assistant/message` 与 `user/message` 另经 `router.ts:884-930` 交叉证实；工具事件形状无包内类型 ⇒ 实施期**首事件存在性校验**） | 产物门槛与熔断判据的唯一数据源 |
| `session/event` 按 agent 作用域注册（`agent.ctx.on`） | `src/router.ts:877-931` | 两个入口共用观测缝；子代理侧挂 `run.localAgent.ctx` |
| `session.append` + `KNOWN_SESSION_EVENT_TYPES` + v1.2.0 `reviewEventWritable` fail-closed | `src/router.ts:851`、`:347-355`；`src/index.ts`（`registerPanelEventType`） | 事件可见化；目录不可写时的降级语义 |
| `ctx.llm.stream` 直调 + 有界信号 | `src/review.ts:71-100`（60s :17/:85；12000 :15） | 手动快评保持现状 |
| **kimi-tide 自身路由监听器对所有 agent 生效** | `src/router.ts:579`（pre-step）、`:730`（request，`{prepend:true}` 恒最外层）、`:724`（槽位）、`:735`（`applyTo` 无条件替换 provider/model） | **S1 的根因缝 → §4 步骤 2.5 必须做路由豁免** |

## 3. 配置与迁移语义

**不升版本（保持 v5）、新字段全部可选、存量行为逐字节一致。**

```ts
export interface ReviewFlow {
  type: 'review'
  reviewer: RouteTarget
  trigger: 'manual' | 'keywords'
  rounds: number
  autoRevise: boolean
  keywordGroup?: string
  /** 新增（可选）：评审执行形态。'subagent' = 启用评审子代理（工具行 + 轮末子代理路径）；缺省 'direct' = 现行行为 */
  executor?: 'direct' | 'subagent'
  /** 新增（可选）：subagent 形态的墙钟上限（毫秒，≥60000），缺省 600000；direct 恒 60s 不受影响 */
  reviewTimeoutMs?: number
}
```

| 键 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `flows.<id>.executor` | `'direct' \| 'subagent'` | `direct` | **总开关**：`subagent` 时注册工具行 + 轮末走子代理 + 产物门槛生效；`direct` 时无工具行、轮末维持 1.1.0 现状 |
| `flows.<id>.reviewTimeoutMs` | `number` | `600000` | 仅 `subagent` 生效；校验 ≥60000 |

- **校验**：`executor` 限枚举；`reviewTimeoutMs` 为正整数且 ≥60000；不新增其他必填。与 schemastery「缺省省略不注入」既有模式一致（`settings-schema.ts:64-79`）。
- **组合语义**：`executor: 'subagent'` + `trigger: 'manual'` = **只留工具入口、关掉轮末自动**（不必新增开关）。
- **不迁移**：`version: 5` 不变；无 `.pre-v6` 留档；`migrate.ts` 不触碰。

## 4. 执行器（新模块 `src/review-subagent.ts`）

```ts
interface DispatchRequest {
  parent: Agent                     // 工具入口：exec.agent；轮末入口：turn-stopping payload.agent
  flow: ReviewFlow
  taskBook: string                  // 任务书正文（§6.1 构造），首行为路由哨兵
  label?: string
  signal?: AbortSignal
}
type DispatchOutcome =
  | { ok: true;  childId: string; report: string; durationMs: number }
  | { ok: false; childId?: string; trip?: { rule: string; evidence: string }; error: string; durationMs: number }
```

**执行序**：

**步骤 0 · 呈现模式探测（v2 新增，封堵 S2）**：`ctx.tools.schemas(parent)` 求父 agent 的**可见**工具名；若含保留通道 `run_code`（PTC 模式下可见面必然含它，`:625-627`）⇒ **fail-closed 拒派发**，文案：「宿主当前为 PTC 呈现模式：`run_code` 不受工具过滤约束，评审子代理的只读无法保证 → 已拒绝派发」。理由：PTC 下模型直调只能是 `run_code`（`:657-663`），而代码运行时可直接落盘，工具过滤挡不住 ⇒ 只读不可能保证。**PTC 支持列为显式非目标（§10）**；二级防线见步骤 2。

**步骤 1 · provider 解析（v2 加强）**：`ctx.subagents.list()` 中挑「支持 `agentOptions` + `toolFilter` + `persona`」者，优先 `spawn`；无可选 ⇒ `ok:false`（文案对齐既有失败可见语义），**不硬编码 provider 名**。派发后若 `run.localAgent === undefined`（remote provider）⇒ **fail-closed**：`dispose()` + `ok:false`（文案：「该 provider 不提供 localAgent，熔断监视不可用 → 已终止」）——**不静默降级为"仅墙钟"**（封堵 M1）。

**步骤 2 · 只读白名单解析（fail-closed）**：`allow = READONLY_WHITELIST ∩ schemas(parent)`（默认 `['read','glob','grep','read_image']`，纯本地读；**未知工具一律不放行**）；`deny` 双保险钉已知高危名（写类 + 命令类 + 委派类 `subagent`/`subagent_fork`/`workflow`/`ralph`）。`allow` 是主机制；**`allow` 从父 agent 作用域解析**（v1 写的是全局视图，v2 更正：过滤作用于继承面，作用域视图才是真实可见面）。二级防线：若能从 `run.localAgent.ctx` 拿到子作用域，注册 `ctx.tools.guard(e => e.name === 'run_code' ? 'PTC 通道在评审子代理中禁用' : undefined)` 并随 run dispose（覆盖探测窗口的竞态）。

**步骤 2.5 · 路由豁免（v2 新增，封堵 S1）**：kimi-tide 自己的 `agent/pre-step`（`router.ts:579`）与 `agent/request`（`:730`）对**所有 agent** 生效，会把子代理任务书当"本轮用户输入"重算路由 ⇒ `agentOptions` 钉的 reviewer 模型被静默覆盖（08-27② 正是这条路径）。机制：

1. 任务书首行固定哨兵常量 `REVIEW_SUBAGENT_SENTINEL = '[kimi-tide:review-subagent]'`；
2. `rules.ts` 增 `isReviewSubagentText(text): boolean`；`router.decide()` **首查哨兵** → `keep('review subagent: router exemption')`；
3. pre-step 的**武装分支同样跳过**（被豁免轮不写 `armed`）——一并关闭 M6（子代理被复评 / 跳过留痕噪音）；
4. 为什么用哨兵而非仅 WeakSet：`start()` 解析时子代理可能已开跑（publication 与 prompt 投递的先后无契约），按 agent id 登记存在**竞态**；哨兵落在 `decide` 读取的**同一份文本**上，零竞态。WeakSet（`reviewChildren: WeakSet<Agent>`）作为纵深：豁免 agent 的 `agent/request` 槽位与流事件累计一并跳过，防将来新增判定点漏网；
5. 副作用：哨兵出现在子会话首条用户消息里（GUI 可见）——视为可追溯标记，写入文档；
6. 与既有约定关系：tide 派发的评审**不再需要**首行 `@kimi`（`@` 只锁 provider 且依赖路由可用；哨兵 + `agentOptions` 才是确定性钉模型），其它场景的 `@kimi` 子代理惯例不受影响。

**步骤 3 · 派发**：

```ts
const run = await ctx.subagents.start(provider, {
  label, parent,
  prompt: [{ type: 'text', text: `${REVIEW_SUBAGENT_SENTINEL}\n${taskBook}` }],
  signal: boundedSignal(payloadSignal, callerSignal, flow.reviewTimeoutMs ?? 600_000),  // 复用 router.ts:368-373 既有模式（M7）
  agentOptions: { provider: flow.reviewer.provider, model: flow.reviewer.model },
  toolFilter: { allow, deny },
  persona: REVIEWER_PERSONA,
})
```

**步骤 4 · 熔断监视**：`run.localAgent.ctx.on('session/event', …)`（§5.1；无 `localAgent` 已在步骤 1 拒绝）。

**步骤 5 · 回收**：`const res = await run.result`；成功条件 = `stopReason === 'completed'` **且** `report.trim() !== ''`——**空报告判失败**（对齐 `review.ts:95` 既有语义，封堵 M5）；失败带 `diagnostic`。

**步骤 6 · 终局**：**无论成败、无论熔断，`finally { await run.dispose(); clearBreakerTimers(); }`**（定时器随 run 清理，封堵 m3）。

**persona 与任务书的双保险，但明确不是保证**：2026-08-26 实证「提示词级防线拦不住」——persona/任务书只做纵深防御（写明只读、忽略注入的全局技能、禁 `job_output`/`todo_write`、报告即最终回复），**真防线是步骤 0/2/2.5 的宿主级约束与 §5 的熔断**。

## 5. 熔断（宿主级，两层 + 并发闸）

### 5.1 L1 · 单次运行熔断

监视器挂在 `run.localAgent.ctx` 的 `session/event` 上，判据**只用宿主事件**：

| 规则 | 判据（默认阈值） | 证据来源 |
|---|---|---|
| 步数预算 | `step/start` 计数 > 40 | 2026-08-27：30 步不收敛；08-26：整轮 220 步 |
| 工具调用预算 | `tool/call` 计数 > 60 | 同上 |
| 连续失败 | `tool/result.error` 连续 ≥5 次（任意工具） | 2026-08-26：`Error: unknown job` 连续约 160 步 |
| 重复调用 | 同 `(tool name, 参数 JSON 哈希)` ≥3 次 | 2026-08-27：对同一测试用例重复定位；08-30：空命令死循环 |
| 空转 | 墙钟 ≥120s 无 `assistant/message` 文本增量且期间 `tool/call` ≥5 | 2026-08-27：66s 超长生成 + 发散取证 |
| 越权尝试 | `tool/result.error.code === 'UNKNOWN_TOOL'` 且被调名 ∈ 写类/命令类/委派类 → **立即熔断** | 硬只读下唯一成因即「它在试图越界」（08-26/08-27 均有越权实证） |
| 墙钟上限 | `reviewTimeoutMs`（默认 600000） | 既有 60s 有界语义的 subagent 版 |

**动作（裁定 4 = 只终止）**：`run.dispose()` → `ok:false` + `trip: { rule, evidence }` → 上屏/回传**触发规则 + 证据 + 子会话 id**（可点进去看"尸体"）；**不自动换模型重派**。

**健壮性条款（v2 新增）**：①**事件形状存在性校验**——首个 `tool/call` 到达时校验字段形状，不符则进入「仅墙钟 + 上屏降级文案」模式（`SessionEventMap` 工具事件形状为活体锚点，无包内类型，防宿主版本差异静默失效，封堵 C⑨）；②**定时器生命周期**——L1 所有墙钟/空转定时器随 run 终局 `dispose()` 清理；③阈值内置不开放配置（v1 非目标；上表数值即默认值，来源见证据列）。

### 5.2 L2 · 流级熔断（跨运行）

同一 flow 在 **30 分钟窗口内累计 3 次** `ok:false`（含熔断与 `stopReason` 失败；**in-flight 被拒不计入**）⇒ 该流**自动转入手动**：轮末不再自动派发，面板给告警行（失败计数 + 最近一次 trip 规则 + 恢复指引）；`/kimi-tide review` 与工具入口仍可手动重试，**手动成功一次即复位**。状态为进程内滚动（不落配置、不写会话事件），随插件重挂载清零。

### 5.3 并发闸（v2 新增，封堵 M3）

**per-flow in-flight 互斥**：执行器持 `Map<flowId, SessionId>`（进行中的子会话 id）。

- 工具入口遇该流已有进行中 ⇒ **不派发**，返回 `isError: true` + 文案「该流已有评审进行中（子会话 `<id>`），本次未派发；可等其结束后再发起，或直接查看该子会话」；
- 轮末入口遇进行中 ⇒ **跳过** + 面板留痕「已有评审进行中，本轮跳过」；
- 终局（含失败/熔断）释放该槽位；**被拒与跳过都不计入 L2 失败计数**；
- 已知限制（文档一句）：L2/in-flight 以 flow id 为键，**流改名或重建后状态悬挂**（进程内可接受，封堵 m6）。

## 6. 两个入口接线

### 6.1 工具入口（新 `src/tool-review.ts`）

- **注册条件**：插件已挂载 ∧ 存在 `executor: 'subagent'` 的 review 流 ∧ 该流 reviewer 可用 ⇒ `ctx.tools.register(...)`；条件不满足即调用 disposer 卸载（随 settings 热重载重算；effect 作用域监听 + `{prepend:true}` 惯例已有热重载防线 `router.ts:569-578`）。**与 `activePreset` 解耦**（逃生舱关的是路由，不该没收「派评审」的能力）。
- **工具名**：`kimi_review`（备选 `tide_review`；不与既有工具重名，`run_code` 为宿主保留名）。
- **schema**：`{ "target": ["绝对路径或 glob，≥1 项"], "question": "可选：本次评审要回答的问题" }`。
- **执行**：`exec.agent` 为 `parent`；**`exec.agent === undefined` ⇒ `isError` + 明确文案**（封堵 M4）；`taskBook = buildTaskBook({ target, question, cwd })`（**首行哨兵**）；前台等待 `DispatchOutcome`；`render` 输出 = 报告正文 + 尾行 `子会话：<childId>`；失败/熔断 → `isError` + 规则与证据；无可用流 → 文案对齐手动命令既有文案（「没有可用的评审流（reviewer 不可用）」）。
- **不声明 `timeoutMs`**：实读 `dsh-tools` / `dsh-agent-loop`（2026-09-11）——未声明 `timeoutMs` 的工具**无全局默认上限**（仅声明时校验正有限数）。前台阻塞时长由执行器 `reviewTimeoutMs`（缺省 600s）与 §5 熔断共同约束，避免两套超时互相打架。

### 6.2 轮末入口（改 `src/router.ts`）

沿用 1.1.0 的武装链（`agent/pre-step` step 1 命中认领组 → `armed` 槽 → `agent/turn-stopping` 消费），**消费侧加产物门槛**：

```
turn-stopping(turn) →
  armed 命中 ∧ executor==='subagent' ?
    该流已有 in-flight ?        → 跳过 + 留痕「已有评审进行中，本轮跳过」（§5.3）
  : 本轮写类工具痕迹非空 ?      → dispatch（子代理）→ 落事件卡（含 childId）
                              : → 跳过 + 面板留痕「本轮无可评审产物，已跳过」
  executor==='direct' ?        → 现行 finishReview（逐字节保持）
```

- **痕迹累计**：扩展既有 `wireSessionFeed`（`src/router.ts:877`）：新增 `tool/call` 分支（按 `turn` 记 `{ name, args }`）与 `tool/result` 分支（`error` 存在则标记该 call 失败）；**只统计成功的写类调用**，从参数 JSON 解析路径字段（`file_path` / `path` / 数组形态）；**相对路径按父 agent 的 cwd 归一为绝对路径**（封堵 m5）；未解析出路径时以「本轮有文件改动」兜底表述，不阻断评审。
- **评审对象**：改动文件绝对路径清单（唯一） + 本轮结论摘要（`outputs` 累计文本，≤4000 字符截断标注） + 本轮人类需求原文（≤`REVIEW_INPUT_LIMIT`，沿用常量）。
- **防环**：①子代理无写类工具 ⇒ 门槛永不通过；②哨兵豁免（§4 步骤 2.5）⇒ 评审子代理的轮不武装；③无委派工具 ⇒ 无孙子代理。

### 6.3 手动入口（不变）

`/kimi-tide review` 保持 `direct` 快评（60s、便宜、随时可用）——**形态由入口决定，不由流配置决定**。裁定 1 的「同一执行器 + 两个入口」指**工具入口与轮末自动入口共用子代理执行器**；手动命令是不改形态的第三入口（显式保留 `direct`），三者各司其职。

## 7. 可观测

- `kimi-tide/review` 事件卡载荷**新增可选字段**：`childId?`、`executor`、`trip?: { rule, evidence }`、`skipped?: { reason }`、`refused?: { reason }`（PTC/无 localAgent 拒派发）。
- **旧载荷容忍（强制）**：新字段一律 `optional` + 默认值；**必须配旧格式 fixture 回归**——2026-09-04 实证「插件自定义投影 schema 不容忍旧载荷 = 老会话整卷拒载」（主库 `避坑记录.md`）。
- **与 `reviewEventWritable` fail-closed 的交互（v2 补充，封堵 m4）**：事件目录不可写（`router.ts:347-355` 语义）时，**不构造新字段事件**，降级为插件日志 + dock 面板行，并把降级原因写进决策摘要。
- dock 面板：新增一行「评审：子代理（含熔断/并发状态）」，流级熔断打开时该行显示告警。
- 试一句（`previewRoute`）：命中认领组时，outcome 文案由「轮末触发评审流 `<id>`」补为「轮末触发评审流 `<id>`（子代理/直调）」；`executor: subagent` 且宿主为 PTC 时追加「当前宿主模式下将被拒派发」。

## 8. 设置页与命令面

- SettingsCard review 流编辑器：新增**执行器下拉**（直调/子代理）+ **超时输入**（仅子代理可编辑，≥60000）；切到「关闭路由」时这些控件维持可编辑（工具入口与路由无关）。
- `/kimi-tide show` 的 flows 段：每行补 `executor`；认领组行补「子代理形态」标注；宿主为 PTC 时补一行拒派发提示。
- 无新增命令（手动快评沿用 `review`）。

## 9. 测试设计

**单测**（vitest，`packages/dsh-kimi-tide/test/`）

| 文件 | 用例要点 |
|---|---|
| `test/review-subagent.test.ts` | provider 解析（有/无 capability → 文案）；**PTC 探测（`schemas(parent)` 含 `run_code` → 拒派发）**；**`localAgent === undefined` → 拒派发**；allow = 白名单 ∩ **父作用域可见工具**；`agentOptions` 钉模型；`dispose` 无论成败必调（含 result reject）；**空 `output` → `ok:false`**；`stopReason` 非 completed → `ok:false` + diagnostic；定时器随终局清理（fake timers） |
| `test/review-breaker.test.ts` | 七条规则各一例（含边界：正好等于阈值不熔断）；越权 `UNKNOWN_TOOL` 立即熔断；熔断后 `dispose` 被调且带 `trip.evidence`；**首个 `tool/call` 形状不符 → 降级模式 + 上屏文案**；L2 三次失败转手动 + 手动成功复位 |
| `test/review-concurrency.test.ts` | per-flow in-flight：第二次工具调用 → `isError` + 文案；轮末遇 in-flight → 跳过留痕；被拒/跳过不计入 L2；终局释放槽位 |
| `test/tool-review.test.ts` | 注册条件（无 subagent 流 → 不注册；配置热重载 → 注册/卸载）；schema 校验；**`exec.agent === undefined` → isError**；render 含子会话 id；失败路径 `isError` |
| `test/router-turn-gate.test.ts` | `tool/call`+`tool/result` 累计（成功/失败/参数形态差异/多路径/**相对路径按 cwd 归一**）；门槛通过/跳过两路；跳过留痕；`executor:'direct'` 时行为与 1.1.0 逐字节一致 |
| `test/rules.test.ts`（扩） | **哨兵豁免**：`isReviewSubagentText` 命中 → `decide` 返回 `keep`、**不武装**；非哨兵文本行为不变 |
| `test/settings-schema.test.ts`（扩） | `executor` 枚举拒绝；`reviewTimeoutMs` 下限；缺省不写入 |

**回载荷回归**：`kimi-tide/review` 旧 fixture（无 `childId`/`executor`）parse 不炸；`reviewEventWritable` 不可写路径不构造新字段事件。

**既有测试必须保持绿（不得为通过而改断言）**：`test/review-flow.test.ts`、`test/review-orchestration.test.ts`、`test/router-wiring.test.ts`、`test/router.test.ts`、`test/projection.test.ts`、`test/settings-schema.test.ts`。

**实机验收（真实宿主，打 tag 前必须全绿）**

| # | 验收项 | 证据 |
|---|---|---|
| A1 | 工具入口：主 agent 调 `kimi_review` 评一份 spec → 返回报告 + 子会话 id，GUI 可见子代理轨迹 | 工具结果 + 会话列表 |
| A2 | 硬只读：子代理里写类/命令类工具**不在提示词中**且调用被拒；**同时断言运行模式 = native**（PTC 部署下应见拒派发而非派发） | 子会话 `tool/call` + UNKNOWN_TOOL + 模式声明 |
| **A2b** | **钉模型未被路由击穿（S1 回归）**：子会话 `request/header` 实读 `provider/model == flow.reviewer`，且面板无该子会话的路由决策 chip | 会话帧解码 `request/header` |
| A3 | 轮末门槛：有改动的轮 → 发起并落卡（含 childId）；纯问答轮 → 跳过 + 留痕 | 会话帧解码 |
| A4 | 防环：评审子代理自己的轮末**不**发起评审（哨兵豁免） | 子会话无 review 事件 |
| A5 | 熔断：构造连续工具失败 → 熔断 + `trip` + dispose，进程内无残留 run、无残留定时器 | 事件卡 + 日志 |
| A6 | L2：三次失败后该流转手动，轮末不再派发；手动成功复位 | 面板告警行 |
| **A7** | **并发闸**：同流两个并发调用 → 第二个被拒并给进行中文案；轮末与工具入口叠加时轮末跳过 | 工具结果 + 面板留痕 |
| **A8** | **存量兼容**：`executor` 缺省配置下，1.1.0 行为与升级前逐字节一致（含空产出、相对路径、旧载荷） | 回归 + 新旧配置对拍 |

## 10. 范围与非目标

**非目标（v1 明确不做）**：`outputSchema` 结构化报告（先文本分级清单）· 任务书模板自定义 · continuable 子代理（先 one-shot）· 工具入口后台化 · 多评审者 / `rounds>1` / `autoRevise` · 只读白名单与熔断阈值用户可配置 · web 类工具放行 · L2/in-flight 状态持久化 · **PTC 呈现模式支持（该模式下只读不可保证 ⇒ fail-closed 拒派发，见 §4 步骤 0）**。

## 11. 风险与实证依据

1. **k3 长链退化**（2026-08-27 结论①：长审/大 diff 任务 k3 易发散；glm 系在本项目 30+ 步评审零幻觉）。本设计**不偷偷换默认模型**（产品前提是「让 Kimi 评审」，模型由用户显式决定），但必须在文档/设置页给出提示：**长链或大 diff 评审建议把该流 `reviewer` 配成非 k3 候选**；熔断是兜底而非替代。
2. **派发提示词被路由劫持**（2026-08-27 结论②）：`agentOptions` + **§4 步骤 2.5 的哨兵豁免**共同关闭该路径。**v2 更正 v1 的过度断言**：单靠 `agentOptions` **不能**"结构性关闭"（S1 已实证会被 `prepend` 的路由监听器覆盖），必须两者齐备；A2b 验收即其回归证据。
3. **提示词防线无效**（2026-08-26 结论）：本设计不把任何安全性寄托在 persona/任务书上——只读由 `toolFilter` 强制（PTC 下改为拒派发），失控由熔断终止。
4. **子代理看不到父级会话**：评审任务书必须自包含（背景 + 绝对路径 + 输出格式），与既有 `docs/templates/review-task.md` 同款要求。
5. **成本可见性**：子代理走 `kimi-coding`（Console API 额度）⇒ dock 配额面板可见。这是相对外部 CLI 的**主要收益之一**（CLI 消耗订阅额度，账外）。
6. **插件定位扩张**：从「纯路由器」扩到「路由器 + 委派入口」⇒ `README.md` / `README.en.md`（同一次提交）、`packages/dsh-kimi-tide/docs/router.md`、`CHANGELOG.md` 必须同步；定位文档（`docs/positioning.md`）需补一节「与外部 CLI 的分工」。

## 12. 待评审问题（v2 更新：前五问已由 2026-09-11 独立评审作答，新增第六问）

1. **（评审已答）** `executor` 作总开关 + `trigger: manual` 表达"只要工具"：评审认为划分清晰、与 schemastery 缺省省略模式一致 → 保留。
2. **（评审已答，v2 部分采纳）** 写类工具名表：v1 硬编码 + 未知名兜底表述被接受为可接受；**但白名单解析面从全局视图改为父作用域视图**（§4 步骤 2）。
3. **（评审已答）** L2 窗口/阈值与复位语义：评审认可；v2 补「被拒/跳过不计入失败」与「流改名悬挂」文档条款。
4. **（评审已答）** 热重载时序竞态：评审指出**现行代码已有效果级防线**（effect 作用域监听 + `prepend` 惯例，`router.ts:569-578`）→ 保留，无需额外机制。
5. **（评审已答）** 前台阻塞是否需要 `run_in_background`：评审未反对前台；v2 保留前台并把「后台化」列为非目标。
6. **（新增，评审要求）** 「评审子代理如何对 kimi-tide 自身路由不可见」：v2 以 §4 步骤 2.5 哨兵豁免回答——**请复审者确认**该机制是否足够（尤其"哨兵出现在子会话首条消息"是否可接受，以及是否需要在 `decide` 之外再加谱系判定）。

## 13. 修订记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-09-11 | 首版（方案 C + 硬只读 + 轮末立场 1 + 两层熔断） |
| **v2** | 2026-09-11 | 依独立评审（k3，有条件同意）+ 控制器逐项复核回改：**新增 §4 步骤 0（PTC 探测 → 拒派发，封堵 S2）与步骤 2.5（哨兵路由豁免，封堵 S1）**；§4 步骤 1 加 `localAgent` 必需（M1）、步骤 5 空报告判失败（M5）、步骤 6 定时器清理（m3）；新增 §5.3 并发闸（M3）与 §5.1 三条健壮性条款（C⑨/m3）；§2 修正行号与「父级限制不导入」措辞（m1/m2）、新增 PTC 与 guard 两行；§6.1 加 `exec.agent` 缺失处理（M4）、§6.2 加相对路径归一（m5）；§7 加 `reviewEventWritable` 交互（m4）；§9 补 6 类用例 + A2b/A7/A8 验收；§10 把 PTC 支持列为非目标；§11.2 降级过度断言；§12 补第六问。**评审 14 条意见全部核实成立/部分成立，零幻觉发现**（详见评审档案） |
