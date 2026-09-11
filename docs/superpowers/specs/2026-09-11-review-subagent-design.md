# Review Subagent 设计（评审子代理：带工具的独立评审者 + 宿主级熔断）

> 状态：v1（2026-09-11 主会话设计）→ **待独立评审** → 未实施
> 前置：Review Flow 1.1.0（[`2026-09-02-review-flow-design.md`](2026-09-02-review-flow-design.md)——本设计把它列为「不做（留下迭代）」的**评审子代理形态（P3）**做掉）、协作编排 0.6.0（[`2026-08-22-collaboration-flows-design.md`](2026-08-22-collaboration-flows-design.md)）、子代理派发契约 spike S2（[`../spikes/2026-08-22-collab-flows-s2-s3.md`](../spikes/2026-08-22-collab-flows-s2-s3.md)：**GO**）
> 问题起源：用户实机（cg-tool 会话）——「让 KIMI 评审」时主 agent **绕过 DSH/月汐**，直接抓 `C:\Users\tafce\.kimi\code\bin\kimi.exe -p` 跑外部 CLI 做「spec 文档 + 代码库」评审。绕道的代价：不经路由、无决策留痕、dock 面板不显示、配额面板不统计（Kimi Code 订阅额度与 Console API 额度是两套账）、不进 DSH 会话日志
> 事故依据（本项目实证，非泛论）：主库 `AI记忆/避坑记录.md` 2026-08-26（k3 评审子代理被技能劫持 + `job_output` 幻觉 id 轮询约 160 步、整轮 220 步被掐断、越权写坏 Obsidian 主库，结论原文「**提示词级防线拦不住，正解是宿主级拦截或避开 k3**」）、2026-08-27（k3 终审读 331KB diff 发散：30 步不收敛、违反只读跑 git、重复定位；同日派发提示词被路由规则改道到额度耗尽模型致 429 连杀）、2026-08-30（子代理「发射塌缩」成 pwsh 空命令死循环、产出归零）、2026-08-20（k3 多轮工具 400 → 子代理空消息终止）

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
| 1 | 形态 | **方案 C：同一执行器 + 两个入口**——模型可调用的工具入口 + 轮末自动入口，共用一套子代理执行器 |
| 2 | 权限 | **硬只读**：`toolFilter` 摘掉写类/命令类工具（宿主级强制，不靠提示词自觉） |
| 3 | 轮末入口 | **立场 1：保留时机、收紧门槛、换形态**——轮末加「产物门槛」，发起时走子代理执行器、评本轮改动的文件；`direct` 形态只留给手动快评 |
| 4 | 熔断 | **动作 A：只终止**（dispose + 报错 + 留痕 + 给出子会话 id），**不自动换模型重派**——要不要重派由主 agent/用户决定 |
| 5 | 配置 | **opt-in**：不写新字段 = 现行 1.1.0 行为逐字节一致（沿用本项目「新字段全可选」惯例，省掉整条迁移链与 `.pre-vN` 留档） |

## 2. 宿主契约（2026-09-11 活体实读 + 包内类型锚点）

| 契约 | 锚点 | 用途 |
|---|---|---|
| `ctx.subagents.start(name, request): Promise<SubagentRun>`；`SubagentRun = { id, localAgent, result, dispose() }` | 活体 Inspect `Service.listService('subagents')`；`dsh-subagent/lib/types/types.d.ts:292-299`（`localAgent: Agent \| undefined`、`result: Promise<SubagentResult>`） | 派发与回收；**`localAgent` 是熔断监视器的挂点**（in-process 子代理的活体 Agent） |
| `SubagentStartRequest = { label?, prompt: ContentBlock[], parent: Agent, signal, agentOptions?, outputSchema?, maxDepth?, toolFilter?, persona? }` | `dsh-subagent/lib/types/types.d.ts:136-192` | 执行器入参形态 |
| `AgentOptions = { provider?, model?, reasoningEffort?, maxTokens? }` | `types.d.ts` 引用类型（活体 Inspect 同款） | **把 reviewer 模型钉死**，不再让派发提示词被关键词路由劫持（修 2026-08-27 事故②） |
| `ToolRestriction = { allow?: string[]; deny?: string[] }`；`ctx.tools.restrict` 语义「Restrictions intersect」、**空过滤/未知名/scope-local 名/reserved 名会失败** | `dsh-tools/lib/types/index.d.ts:475`；活体 Inspect `Service.listService('tools').restrict` | 硬只读；**白名单必须运行时从可见工具取交集**（否则未知名会让 `start` 直接报错） |
| in-process 驱动器在**子 agent 未发布作用域**内安装 persona / 工具限制 / 结构化输出；子 agent 继承父级工作目录与谱系，**父级工具限制与权限不导入**（全新扁平作用域） | `dsh-subagent-in-process-driver/lib/index.js:174-186`；同包 README §"The shared driver" | 硬只读是宿主级；同时说明**只读必须显式声明**（默认子代理能看到父级同一套工具） |
| `SubagentResult = { output: ContentBlock[], structured?, diagnostic?, stopReason }`；`stopReason ∈ completed/aborted/error/max-tokens/refusal` | `types.d.ts:239-282` | 结果映射与失败可见 |
| `ctx.tools.register(definition: ToolDefinition): () => void`；`ToolDefinition extends ToolSchema { name, description, parameters } + { output: { schema, render }, execute(args, exec), timeoutMs?, presentCall?, presentResult? }` | 活体 Inspect `Service.listService('tools').register`；`ToolDefinition`/`ToolOutputDefinition` 引用类型 | 工具行注册；返回 disposer（热重载即卸载） |
| `ToolExecutionInput.agent?: Agent`（`exec` 上） | 活体 Inspect 引用类型 `ToolExecutionInput` | 工具入口取 `parent`（`subagents.start` 要求活体 Agent） |
| `SessionEventMap`：`'tool/call': { turn, step, callId, name, arguments }`、`'tool/result': { turn, step, message, error?: { name, code }, meta? }`、`'step/start'`、`'assistant/message'` | 活体 Inspect 引用类型 `SessionEventMap` | **产物门槛与熔断判据的唯一数据源**（宿主可观测事实，不读子代理自述） |
| `session/event` 按 agent 作用域注册（`agent.ctx.on`），路由器已有同款用法 | `src/router.ts:877-931`（`wireSessionFeed`） | 两个入口共用同一观测缝；子代理侧挂 `run.localAgent.ctx` |
| `session.append(自定义类型, payload)` + `KNOWN_SESSION_EVENT_TYPES` 注册 | `src/index.ts`（`registerPanelEventType`；既有 `kimi-tide/review` 卡） | 评审事件可见化 |
| `ctx.llm.stream` 直调 + 有界信号（既有 `direct` 执行器） | `src/review.ts:71-100` | 手动快评保持现状 |

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

- **校验**（`settings-schema.ts` / `validateRouterConfig`）：`executor` 限枚举；`reviewTimeoutMs` 为正整数且 ≥60000；不新增其他必填。
- **组合语义**：`executor: 'subagent'` + `trigger: 'manual'` = **只留工具入口、关掉轮末自动**（不必新增开关）。
- **不迁移**：`version: 5` 不变；无 `.pre-v6` 留档；存量配置读取路径零改动（`migrate.ts` 不触碰）。

## 4. 执行器（新模块 `src/review-subagent.ts`）

```ts
interface DispatchRequest {
  parent: Agent                     // 工具入口：exec.agent；轮末入口：turn-stopping payload.agent
  flow: ReviewFlow                  // reviewer / reviewTimeoutMs 来源
  taskBook: string                  // 任务书正文（§6.1 构造）
  label?: string                    // 子会话显示名，如「评审：<对象摘要>」
  signal?: AbortSignal              // 调用方取消（工具入口 exec.signal）
}
type DispatchOutcome =
  | { ok: true;  childId: string; report: string; durationMs: number }
  | { ok: false; childId?: string; trip?: { rule: string; evidence: string }; error: string; durationMs: number }
```

**执行序**：

1. **provider 运行时解析**：`ctx.subagents.list()` 中挑「支持 `agentOptions` 且支持 `toolFilter` 且支持 `persona`」者，优先 `spawn`；无可选 → `ok:false`（文案对齐既有失败可见语义），**不硬编码 provider 名**（部署差异不得让插件起不来）。
2. **只读白名单解析（fail-closed）**：`ctx.tools.schemas()`（全局视图）取得当前可见工具名集合 `V`；`allow = READONLY_WHITELIST ∩ V`（`READONLY_WHITELIST` 默认 `['read','glob','grep','read_image']`，纯本地读；**未知工具一律不放行**）；`deny` 双保险钉已知高危名（写类 + 命令类 + 委派类 `subagent`/`subagent_fork`/`workflow`/`ralph`）。`allow` 是主机制、`deny` 是纵深——**allow-list 天然排除任何名字的委派工具**（含孙子代理风险）。
3. **派发**：

```ts
const run = await ctx.subagents.start(provider, {
  label, parent,
  prompt: [{ type: 'text', text: taskBook }],
  signal: AbortSignal.any([AbortSignal.timeout(flow.reviewTimeoutMs ?? 600_000), callerSignal].filter(Boolean)),
  agentOptions: { provider: flow.reviewer.provider, model: flow.reviewer.model },   // 钉模型
  toolFilter: { allow, deny },
  persona: REVIEWER_PERSONA,          // 只读评审者身份，遮蔽部署 persona
})
```

4. **熔断监视**：`run.localAgent?.ctx.on('session/event', …)`（§5）。
5. **回收**：`const res = await run.result` → `output` 文本拼接为 `report`；`stopReason !== 'completed'` → `ok:false` + `diagnostic`；**无论成败、无论熔断，终局一律 `await run.dispose()`**（`finally`）。

**persona 与任务书的双保险，但明确不是保证**：2026-08-26 实证「提示词级防线拦不住」——persona/任务书只做纵深防御（写明只读、忽略注入的全局技能、禁 `job_output`/`todo_write`、报告即最终回复），**真防线是 §4 步骤 3 的 `toolFilter` 与 §5 的熔断**。

## 5. 熔断（宿主级，两层）

### 5.1 L1 · 单次运行熔断

监视器挂在 `run.localAgent.ctx` 的 `session/event` 上，判据**只用宿主事件**：

| 规则 | 判据（默认阈值） | 证据来源 |
|---|---|---|
| 步数预算 | `step/start` 计数 > 40 | 2026-08-27：30 步不收敛；08-26：整轮 220 步 |
| 工具调用预算 | `tool/call` 计数 > 60 | 同上 |
| 连续失败 | `tool/result.error` 连续 ≥5 次（任意工具） | 2026-08-26：`Error: unknown job` 连续约 160 步 |
| 重复调用 | 同 `(tool name, 参数 JSON 哈希)` ≥3 次 | 2026-08-27：对同一测试用例重复定位 |
| 空转 | 墙钟 ≥120s 无 `assistant/message` 文本增量且期间 `tool/call` ≥5 | 2026-08-27：66s 超长生成 + 发散取证 |
| 越权尝试 | `tool/result.error.code === 'UNKNOWN_TOOL'` 且被调名 ∈ 写类/命令类/委派类 → **立即熔断** | 硬只读下唯一成因即「它在试图越界」（08-26/08-27 均有越权实证） |
| 墙钟上限 | `reviewTimeoutMs` | 既有 60s 有界语义的 subagent 版 |

**动作（裁定 4 = 只终止）**：`run.dispose()` → `DispatchOutcome.ok:false` + `trip: { rule, evidence }`（如 `{ rule:'consecutive-tool-errors', evidence:'tool/result error ×5: unknown job …' }`）→ 上屏/回传**触发规则 + 证据 + 子会话 id**（可点进去看"尸体"）；**不自动换模型重派**。判据阈值内置，不开放配置（v1 非目标；上表数值即默认值，来源已在证据列）。

### 5.2 L2 · 流级熔断（跨运行）

同一 flow 在 **30 分钟窗口内累计 3 次** `ok:false`（含熔断与 `stopReason` 失败）⇒ 该流**自动转入手动**：轮末不再自动派发，面板给告警行（失败计数 + 最近一次 trip 规则 + 恢复指引）；`/kimi-tide review` 与工具入口仍可手动重试，**手动成功一次即复位**。状态为进程内滚动（不落配置、不写会话事件），随插件重挂载清零。

## 6. 两个入口接线

### 6.1 工具入口（新 `src/tool-review.ts`）

- **注册条件**：插件已挂载 ∧ 存在 `executor: 'subagent'` 的 review 流 ∧ 该流 reviewer 可用 ⇒ `ctx.tools.register(...)`；条件不满足即调用 disposer 卸载（随 settings 热重载重算）。**与 `activePreset` 解耦**（逃生舱关的是路由，不该没收「派评审」的能力）。
- **工具名**：`kimi_review`（备选 `tide_review`；不与既有工具重名，`run_code` 为宿主保留名）。
- **schema**：

```jsonc
{ "target": ["绝对路径或 glob，≥1 项"], "question": "可选：本次评审要回答的问题" }
```

- **执行**：`exec.agent` 为 `parent`；`taskBook = buildTaskBook({ target, question, cwd })`；前台等待 `DispatchOutcome`；`render` 输出 = 报告正文 + 尾行 `子会话：<childId>`（GUI 可点进轨迹）；失败/熔断 → `isError` + 规则与证据。无可用流时文案对齐手动命令既有文案（「没有可用的评审流（reviewer 不可用）」）。
- **不声明 `timeoutMs`**：实读 `dsh-tools` / `dsh-agent-loop`（2026-09-11）——未声明 `timeoutMs` 的工具**无全局默认上限**（仅声明时校验正有限数）。前台阻塞时长由执行器的 `reviewTimeoutMs`（缺省 600s）与 §5 熔断共同约束；宿主侧不额外截断，避免两套超时互相打架。

### 6.2 轮末入口（改 `src/router.ts`）

沿用 1.1.0 的武装链（`agent/pre-step` step 1 命中认领组 → `armed` 槽 → `agent/turn-stopping` 消费），**消费侧加产物门槛**：

```
turn-stopping(turn) →
  armed 命中 ∧ executor==='subagent' ?
    本轮写类工具痕迹非空 ?  → dispatch（子代理）/ 落事件卡
                          :  → 跳过 + 面板留痕「本轮无可评审产物，已跳过」
  executor==='direct' ? → 现行 finishReview（逐字节保持）
```

- **痕迹累计**：扩展既有 `wireSessionFeed`（`src/router.ts:877`）：新增 `tool/call` 分支（按 `turn` 记 `{ name, args }`）与 `tool/result` 分支（`error` 存在则标记该 call 失败）；**只统计成功的写类调用**，从参数 JSON 解析路径字段（`file_path` / `path` / 数组形态；未解析出路径时以「本轮有文件改动」兜底表述，不阻断评审）。
- **评审对象**：改动文件绝对路径清单（唯一） + 本轮结论摘要（`outputs` 累计文本，≤4000 字符截断标注） + 本轮人类需求原文（≤`REVIEW_INPUT_LIMIT`，沿用常量）。
- **防环零机制**：子代理无写类工具 ⇒ 门槛永不通过 ⇒ 评审者不会被自己再评；无委派工具 ⇒ 无孙子代理。

### 6.3 手动入口（不变）

`/kimi-tide review` 保持 `direct` 快评（60s、便宜、随时可用）——**形态由入口决定，不由流配置决定**。裁定 1 的「同一执行器 + 两个入口」指**工具入口与轮末自动入口共用子代理执行器**；手动命令是不改形态的第三入口（显式保留 `direct`），三者各司其职。

## 7. 可观测

- `kimi-tide/review` 事件卡载荷**新增可选字段**：`childId?`、`executor: 'direct' | 'subagent'`、`trip?: { rule, evidence }`、`skipped?: { reason }`（门槛跳过）。
- **旧载荷容忍（强制）**：新字段一律 `optional` + 默认值；**必须配旧格式 fixture 回归**——2026-09-04 实证「插件自定义投影 schema 不容忍旧载荷 = 老会话整卷拒载」（主库 `避坑记录.md`）。
- dock 面板：新增一行「评审：子代理（含熔断状态）」，流级熔断打开时该行显示告警。
- 试一句（`previewRoute`）：命中认领组时，outcome 文案由「轮末触发评审流 `<id>`」补为「轮末触发评审流 `<id>`（子代理/直调）」。

## 8. 设置页与命令面

- SettingsCard review 流编辑器：新增**执行器下拉**（直调/子代理）+ **超时输入**（仅子代理可编辑，≥60000）；切到「关闭路由」时这些控件维持可编辑（工具入口与路由无关）。
- `/kimi-tide show` 的 flows 段：每行补 `executor`；认领组行补「子代理形态」标注。
- 无新增命令（手动快评沿用 `review`）。

## 9. 测试设计

**单测**（vitest，`npm test`）

| 文件 | 用例要点 |
|---|---|
| `test/review-subagent.test.ts` | provider 解析（有/无 capability → 报错文案）；allow = 白名单 ∩ 可见工具（含未知名不出现在 allow）；`agentOptions` 钉模型；`dispose` 无论成败必调（含 result reject）；`stopReason` 非 completed → `ok:false` + diagnostic |
| `test/review-breaker.test.ts` | 七条规则各一例（含边界：正好等于阈值不熔断）；越权 `UNKNOWN_TOOL` 立即熔断；熔断后 `dispose` 被调且结果带 `trip.evidence`；L2 三次失败转手动 + 手动成功复位 |
| `test/tool-review.test.ts` | 注册条件（无 subagent 流 → 不注册；配置热重载 → 注册/卸载）；schema 校验；`exec.agent` 传为 parent；render 含子会话 id；失败路径 `isError` |
| `test/router-turn-gate.test.ts` | `tool/call`+`tool/result` 累计（成功/失败/参数形态差异/多路径）；门槛通过/跳过两路；跳过留痕；`executor:'direct'` 时行为与 1.1.0 逐字节一致（既有测试不改红） |
| `test/settings-schema.test.ts`（扩） | `executor` 枚举拒绝；`reviewTimeoutMs` 下限；缺省不写入 |

**回载荷回归**：`kimi-tide/review` 旧 fixture（无 `childId`/`executor`）parse 不炸。

**既有测试必须保持绿（不得为通过而改断言）**：`test/review-flow.test.ts`、`test/review-orchestration.test.ts`（1.1.0 armed/turn-stopping/防环语义）、`test/router-wiring.test.ts`、`test/router.test.ts`、`test/projection.test.ts`（投影 payload 兼容）、`test/settings-schema.test.ts`。

**实机验收（真实宿主，打 tag 前必须全绿）**

| # | 验收项 | 证据 |
|---|---|---|
| A1 | 工具入口：主 agent 调 `kimi_review` 评一份 spec → 返回报告 + 子会话 id，GUI 可见子代理轨迹 | 工具结果 + 会话列表 |
| A2 | 硬只读：子代理里写类/命令类工具**不在提示词中**且调用被拒 | 子会话 `tool/call` 记录 + UNKNOWN_TOOL |
| A3 | 轮末门槛：有改动的轮 → 发起并落卡（含 childId）；纯问答轮 → 跳过 + 留痕 | 会话帧解码 |
| A4 | 防环：评审子代理自己的轮末**不**发起评审 | 子会话无 review 事件 |
| A5 | 熔断：构造连续工具失败 → 熔断 + `trip` + dispose，无泄漏（进程内无残留 run） | 事件卡 + 日志 |
| A6 | L2：三次失败后该流转手动，轮末不再派发；手动成功复位 | 面板告警行 |
| A7 | 存量兼容：`executor` 缺省配置下，1.1.0 行为与升级前逐字节一致 | 回归 + 新旧配置对拍 |

## 10. 范围与非目标

**非目标（v1 明确不做）**：`outputSchema` 结构化报告（先文本分级清单）· 任务书模板自定义 · continuable 子代理（先 one-shot）· 工具入口后台化 · 多评审者 / `rounds>1` / `autoRevise` · 只读白名单与熔断阈值用户可配置 · web 类工具放行 · L2 状态持久化。

## 11. 风险与实证依据

1. **k3 长链退化**（2026-08-27 结论①：长审/大 diff 任务 k3 易发散；glm 系在本项目 30+ 步评审零幻觉）。本设计**不偷偷换默认模型**（产品前提是「让 Kimi 评审」，模型由用户显式决定），但必须在文档/设置页给出提示：**长链或大 diff 评审建议把该流 `reviewer` 配成非 k3 候选**；熔断是兜底而非替代。
2. **派发提示词被路由劫持**（2026-08-27 结论②）：本设计用 `agentOptions` 钉死 reviewer 模型 ⇒ 该事故路径**结构性关闭**（不再依赖首行 `@kimi` 这类提示词约定）。
3. **提示词防线无效**（2026-08-26 结论）：本设计不把任何安全性寄托在 persona/任务书上——只读由 `toolFilter` 强制，失控由熔断终止。
4. **子代理看不到父级会话**：评审任务书必须自包含（背景 + 绝对路径 + 输出格式），与既有 `docs/templates/review-task.md` 同款要求。
5. **成本可见性**：子代理走 `kimi-coding`（Console API 额度）⇒ dock 配额面板可见。这是相对外部 CLI 的**主要收益之一**（CLI 消耗订阅额度，账外）。
6. **插件定位扩张**：从「纯路由器」扩到「路由器 + 委派入口」⇒ `README.md` / `README.en.md`（同一次提交）、`packages/dsh-kimi-tide/docs/router.md`、`CHANGELOG.md` 必须同步；定位文档（`docs/positioning.md`）需补一节「与外部 CLI 的分工」。

## 12. 待评审问题（交独立评审回答）

1. `executor` 作为**总开关**（工具行 + 轮末路径）是否比分设两个开关更清晰？`trigger: manual` 复用为「只留工具」是否够直觉？
2. 产物门槛的**写类工具名表**是否应可配（不同宿主/插件集下写工具名不同）？v1 硬编码 + 未知名兜底表述是否可接受？
3. L2 流级熔断的窗口/阈值（3 次 / 30 分钟）与「手动成功即复位」是否恰当？是否存在自动派发永久关闭而用户无感的盲区？
4. 工具行随配置注册/卸载（one visibility）与「工具常在但报错」相比，热重载时序上是否有宿主竞态风险？（参考 2026-08-17「保存配置后 apply 重执行、新实例花名册为空」事故）
5. 工具入口前台阻塞（分钟级、宿主无全局工具超时）是否需要 `run_in_background` 形态？v1 只做前台是否会在「整库评审」场景让主 agent 空等——还是说前台正是「并联评审」想要的效果（同一 step 并发多个调用）？
