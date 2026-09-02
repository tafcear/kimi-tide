# Review Flow 1.1.0 设计（评审回路落地 + 关键词组流认领）

> 状态：设计定稿（2026-09-02 脑暴 + 用户四裁定）→ 待 spec 审阅
> 前置：v0.6.0 协作编排（`2026-08-22-collaboration-flows-design.md` §5.3 review 流 + §14 S3 spike GO）、v0.8.x 规则体系（`2026-08-27-routing-coverage-effort-design.md`）
> 问题起源：用户实机反馈——「这个做完做交叉评审」这类**延后语境**的评审意图被关键词路由规则整轮劫持到评审模型，本轮的执行工作被错误路由

## 1. 背景与根因

**现象**：用户消息「这个做完做交叉评审」→ `review` 关键词组（`评审` 命中）→ 路由规则 `review-k3` 整轮生效 → 本轮（实为执行任务）被切到评审模型。

**根因**（实读 `src/router.ts` / `src/rules.ts` 确认）：

1. `decide()` 每轮只在首个模型步对最新用户文本做**纯词法子串匹配**——引擎无时序/阶段语义，读不出「做完…再…」是延后语境；
2. 一轮只路由一次（工具循环步骤不切模型，router.ts 既有契约）——同一轮内「执行段用执行模型、评审段用评审模型」在路由层物理不可达；
3. `ReviewFlow` 类型与 schema 自 0.6.0 起已存在（config.ts:50、settings-schema.ts 判别联合），但编排层只实现了 transcribe 流——评审回路是「图纸已画、楼未盖」。

**结论**：正解不是给关键词匹配打补丁，而是把 review 流盖起来——「评审」关键词的语义从「整轮切模型」改为「本轮照常执行 + 轮末评审模型自动出评审意见」（0.6.0 spec §5.3 + 裁决 6 的既定产品化方向）。

**用户裁定（2026-09-02 本会话）**：

| # | 裁定 | 内容 |
|---|---|---|
| 1 | 方向 | 直接做 C：实现 review 流（不做 B 延后守卫、不做 D LLM 意图分类） |
| 2 | 关键词归属 | **流认领**：`trigger:keywords` 的 review 流认领其 keywordGroup——命中=本轮按执行意图路由 + 轮末触发评审；被认领组的路由规则自动失效（无需用户手删） |
| 3 | 评审输入 | 本轮用户需求 + 本轮产出（评审模型可评「答非所问」） |
| 4 | autoRevise | 本迭代**只做意见呈现**（通路 A）；autoRevise 字段保留，通路 B 留下迭代 |
| 5 | 执行形态 | 方案一：流认领 + turn-stopping **异步**评审 + 会话事件卡（双端交付），附 `/kimi-tide review` 手动命令 |

## 2. 宿主契约（2026-09-02 活体实读，全部带锚点）

| 契约 | 锚点 | 用途 |
|---|---|---|
| `agent/turn-stopping`（**serial**，agent 作用域），payload `{agent, turn, signal}` | dsh-agent-loop lib/index.js:565（`this.dispatch.serial`，轮末 `inbox.nextStep` 为空时派发；错误/中止路径不派发） | 评审挂点；listener 立即返回、异步执行，轮零阻塞 |
| `session/event`（emit，post-commit 追加馈送），`(session, event)` | dsh-tool-cordis 事件目录（「Scope-filtered dispatch: agent-scoped listeners receive only events from sessions entered through that agent''s context」） | 按轮次累计 `assistant/message` 产出 |
| `assistant/message` 载荷 `{turn, step, message, usage?, interrupted?}` | dsh-session lib/types/types.d.ts SessionEventMap | 轮次号对齐 armed 槽，无需读历史 API |
| `session.append(自定义类型, payload)` + `KNOWN_SESSION_EVENT_TYPES` 注册 | kimi-tide index.ts:255（registerPanelEventType）/ :585（面板卡同款机制） | `kimi-tide/review` 事件可见化 |
| `ctx.llm.stream` 插件直调 + 有界信号（boundedSignal 模式） | kimi-tide router.ts createStreamVisionCaller / transcribe I-2 | 评审调用（纯文本，无图块） |
| 显式 @ 跳过一切流（spec §5.7） | 0.6.0 spec；router.ts decide 显式分支先于规则链 | 显式 @ 轮**不**触发评审武装 |

**派生事实**：
- 评审调用不设 `purpose` → `auxRewriteTarget`（0.8.x⑧）不触及；纯文本无图 → llm/stream 投影拦截器不改写；评审调用**不经 decide**，天然不参与路由。
- turn-stopping 后 `signal.throwIfAborted()`（agent-loop :567）——串行阻塞式（方案二）会把评审暴露给轮末中止，**方案一异步形态因此成立**（listener 不 await 评审）。
- turn/end 的 `interrupted` 与错误/中止轮不派发 turn-stopping → 这些轮**自然不评审**（无需插件侧判断）。

## 3. 配置与迁移语义

- **零迁移**：v5 schema 已含 ReviewFlow 全字段（settings-schema.ts：rounds 1..3、trigger=keywords 必填 keywordGroup、reviewer 不带 effort——M7 既定）。
- **存量行为零突变**：预置 review 流（DEFAULT_FLOWS，config.ts:145）保持 `trigger: manual`；用户经设置页切到 `keywords` 才启用认领语义。既有路由规则（含内置 capability 预设的 `review-k3`）不删不改——认领成立时由路由层**静态抑制**（§4）。
- **设置页**：流编辑器已有 trigger/keywordGroup 编辑（SettingsCard.tsx:318 起，validate-on-write 已保证 trigger=keywords 必填存在的 keywordGroup）。本迭代新增**认领提示**：路由规则行的 `when.group` 被认领时标灰 + 文案「该组已被评审流认领，不再参与路由」；共存允许保存（抑制是自然结果，非非法态）。

## 4. 路由层（纯函数，rules.ts / router.ts）

- 新增 `claimedReviewGroups(config: RouterConfigAny): Set<string>`：收集所有 `type==='review' && trigger==='keywords' && keywordGroup 非空` 的组名（v4 无 flows → 空集，行为逐字节保持）。
- `matchingScored` 不变；`decide` 与 `previewRoute` 在取得 hits 后**统一过滤** `when.kind==='keywords' && claimed.has(when.group)` 的规则——**静态抑制**（与本轮是否命中无关），语义可预测、可解释。
- `previewRoute` 新增 outcome `{ kind: 'review-flow', flowId, label, score }`：文本命中被认领组（≥1 词，与触发判定同语义）时显示「本轮路由到 X + 轮末触发评审流 `<flowId>`」——X 为过滤后的实际路由结果。
- 显式 @ 分支不变（最高优先，先于一切抑制与武装）。

## 5. 编排层（installRouter 扩展）

新增纯函数 `reviewTriggerHit(config, text): { flowId, flow } | null`：claimed 组中首个（flows 注册表序）被文本命中（≥1 词）且 reviewer 在候选目录可用的 review 流；显式 @ 命中时返回 null（§2 契约）。

执行序（均 agent 作用域）：

1. **pre-step（step===1）**：`reviewTriggerHit` 命中 → armed 槽 `WeakMap<Agent, {turn, flowId, flow, userText}>`（每轮重置/覆盖）；`userText` = `latestUserText(payload.messages)`。
2. **session/event 监听**（常驻，agent 作用域）：
   - `event.type==='assistant/message' && event.turn === armed?.turn` → 累计该轮文本块（多步工具循环全收；`interrupted` 消息不计）；
   - 同 feed 滚动维护 `lastTurn = {userText, output}`（每 agent 最近一轮，供手动命令，不依赖 armed）。`user/message` 事件刷新 `lastTurn.userText`（取其 text 块拼接）。
3. **turn-stopping**：armed 且 `payload.turn === armed.turn` 且累计产出非空 → **异步**发起评审（listener 构造后立即返回，轮零阻塞）；完成/失败经 `agent.session.append('kimi-tide/review', payload)` 上屏。armed 随即清除（每轮至多一次）。
4. **评审调用**：`ctx.llm.stream` 直调 reviewer，messages = 单条 user 消息（§6 模板）；不设 purpose、不带 effort（M7）；有界信号 = `AbortSignal.timeout(60s)`（评审发生于轮关闭后，轮 signal 已不可用——不复用 turn signal，与 transcribe 的 pre-step 场景不同）。

**防环路**：`kimi-tide/review` 事件非 `user/message` → 永不进 `latestUserText`；评审调用不经 decide；armed 每轮重置；`autoRevise:false` 时 rounds 恒 1（字段留通路 B 迭代）。

## 6. 评审输入构造

单条 user 消息，三段式：

```
[内建评审指令]
你是资深技术评审。请对「主模型回答」做交叉评审：先列问题（含严重度：阻塞/建议/可选），
再给改进建议，最后一行结论（通过/有条件通过/不通过）。只评内容质量与需求贴合度，
不重述需求；无实质问题时直说「未发现实质问题」。

[本轮用户需求]
<userText，≤12000 字符，超出截断并标注「…（已截断）」>

[主模型本轮产出]
<output，≤12000 字符，同截断语义>
```

模板内建固定（prompt 可覆盖留下迭代，YAGNI）。截断上限 12000 字符/段（常量，测试锚点）。

## 7. 可观测（Host/Client 双端同迭代交付——0.6.x「投影 schema 已出、客户端零消费」降级教训）

- **事件**：`kimi-tide/review`，payload `{flowId, reviewer: {provider, model}, turn, userText, reviewText, ok, error?, durationMs, at}`（`userText` ≤200 字符摘要；`at` = ISO 时间）。`KNOWN_SESSION_EVENT_TYPES` 注册沿用 registerPanelEventType 同款机制（index.ts:255 模式，安装级 catalog 扩展）。
- **投影**：projection.ts 新增 fold——每会话保留最近 20 条评审记录（新到旧）。
- **客户端**：会话流渲染评审卡（徽标 = 评审模型 + flowId；`ok:false` 失败卡标灰并显 error）。**TideDock/ReasonPanel 消费随本迭代交付**，验收含目检项（§9 A6）。
- **dock**：评审执行完成记一条流事件（lastFlowEvent 同款通道，`review:<flowId> ok/失败 · <reviewer.model>`）。

## 8. 手动命令

- `/kimi-tide review`：取该 agent `lastTurn` 缓存 → 同款异步评审（armed 语义外唯一入口）；无缓存返回「无可评审的上一轮」。命令幂等：连发两次各产生一条评审事件（用户显式行为，不去重）。
- `/kimi-tide show` 输出补一行：认领中的关键词组（`claimedReviewGroups` 非空时）。

## 9. 测试设计

**单测（纯函数）**：
- `claimedReviewGroups`：v4 空集 / v5 收集 / trigger=manual 不收 / keywordGroup 缺省不收；
- decide 抑制：被认领组规则跳过且命中词不再计入 / 他组规则照常 / 显式 @ 优先且 `reviewTriggerHit` 返 null / flow 目标规则不受认领影响；
- `reviewTriggerHit`：命中取注册表序首个 / reviewer 不可用返 null / 未命中返 null；
- 输入构造：双段截断（12000+1 字符断言截断标注）/ 模板三段齐备。

**集成（mock ctx，沿用现有 installRouter 测试夹具）**：
- armed→累计→turn-stopping：断言 `ctx.llm.stream` 被调（载荷含需求+产出）且 listener 未阻塞（先返回后 append）；
- 完成 → `session.append('kimi-tide/review', {ok:true, …})`；mock 流失败 → `ok:false` 卡 + 不抛出；
- 产出为空（武装轮无 assistant/message）→ 不发起评审；
- 评审事件回灌 session/event → 不武装、不评审（防环断言）；
- 显式 @ 轮 → 不 armed；
- 多轮连续：第二轮 armed 覆盖第一轮槽，各轮评审独立；
- `/kimi-tide review`：有缓存执行 / 无缓存报错文案。

**previewRoute**：被认领组规则不出现于 outcome；命中显示 `review-flow` outcome。

**实机验收（用户重启 dsh web 后，A 系全绿方发布）**：
- A1 「这个做完做交叉评审」→ 面板决策原因**不**含 review 组命中（本轮落默认/执行模型）；
- A2 轮末数秒内评审卡上屏，徽标=评审模型，内容含「问题/建议/结论」结构；
- A3 评审卡之后的普通消息不触发评审（防环实机证）；
- A4 设置页：review 流 trigger=manual 时无认领提示；切 keywords 后 `review-k3` 规则行标灰 + 提示文案；
- A5 「试一句」输入「帮我评审这段代码」→ outcome 显示「轮末触发评审流 review」；
- A6 评审卡 Host/Client 双端目检（投影帧 + 会话流卡片渲染）；
- A7 `/kimi-tide review` 手动触发 → 评审卡上屏；无缓存会话报错文案正确。

## 10. 范围与分期

- **本迭代（1.1.0）**：§3–§9 全量（路由认领 + 编排 + 事件卡双端 + 手动命令 + 设置页提示 + A 系验收）。
- **不做（留下迭代）**：autoRevise / 通路 B（inbox 注入修订轮，agent.steer 语义）；评审子代理形态（P3）；评审模板自定义；rounds>1（autoRevise=false 时恒 1）；多 review 流并行（每轮取首个命中）。
- **风险与缓解**：
  | 风险 | 缓解 |
  |---|---|
  | 评审调用额度失控 | 默认 manual；keywords 触发需用户显式切换；每轮至多一次；60s 有界超时 |
  | 评审质量依赖输入完整性 | 需求+产出双段输入（裁定 3）；截断标注可见 |
  | 异步评审时 agent disposed | WeakMap 槽随回收；进行中调用 60s 超时兜底，append 目标 session 已销毁时 catch 落日志 |
  | 存量行为突变 | trigger 默认 manual 零迁移；认领仅随用户切换生效 |
  | 双端交付遗漏（0.6.x 教训） | 客户端渲染列为本迭代交付项 + A6 验收门禁 |
