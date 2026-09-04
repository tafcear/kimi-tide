# Review Flow 1.1.0 设计（评审回路落地 + 关键词组流认领）

> 状态：v2（2026-09-04 Kimi k3 独立评审「需修改后实施」4 中 8 轻 4 待核实 + 修复波全清 + 宿主锚点逐项复核）→ 可进实施
> 评审档案：`docs/audit/2026-09-04-review-flow-spec-kimi-review.md`（评审报告全文 + 实施者逐项复核与处置）
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
| `agent/turn-stopping`（**serial**，agent 作用域），payload `{agent, turn, signal}` | dsh-agent-loop lib/index.js:569-570（:569 轮末门控 `turnEnds && inbox.nextStep` 为空、:570 `this.dispatch.serial`；错误/中止与 pre-step reject 路径不派发） | 评审挂点；listener 立即返回、异步执行，轮零阻塞 |
| `agent/pre-step`（waterfall，agent 作用域），payload `{agent, messages, turn, step, signal}` | dsh-agent lib/types/runtime-types.d.ts:239-245（`turn` 显式在载荷）+ Agent 接口 `readonly ctx`（:75，随 dispose 卸载） | 武装挂点；轮次号与 turn-stopping 同源对齐；`agent.ctx` 供 session/event 作用域注册（§5.2） |
| `session/event`（emit，post-commit 追加馈送），`(session, event)` | dsh-tool-cordis 事件目录（「Scope-filtered dispatch: agent-scoped listeners receive only events from sessions entered through that agent''s context」） | 按轮次累计 `assistant/message` 产出 |
| `assistant/message` 载荷 `{turn, step, message, usage?, interrupted?}` | dsh-session lib/types/types.d.ts SessionEventMap | 轮次号对齐 armed 槽，无需读历史 API |
| `session.append(自定义类型, payload)` + `KNOWN_SESSION_EVENT_TYPES` 注册 | kimi-tide index.ts:255（registerPanelEventType）/ :585（面板卡同款机制） | `kimi-tide/review` 事件可见化 |
| `ctx.llm.stream` 插件直调 + 有界信号（boundedSignal 模式） | kimi-tide router.ts createStreamVisionCaller / transcribe I-2 | 评审调用（纯文本，无图块） |
| 显式 @ 跳过一切流（spec §5.7） | 0.6.0 spec；router.ts decide 显式分支先于规则链 | 显式 @ 轮**不**触发评审武装 |

**派生事实**：
- 评审调用不设 `purpose` → `auxRewriteTarget`（0.8.x⑧）不触及；纯文本无图 → llm/stream 投影拦截器不改写；评审调用**不经 decide**，天然不参与路由。
- turn-stopping 前后各有 `signal.throwIfAborted()`（agent-loop :568 派发前 / :574 派发后）——串行阻塞式（方案二）会把评审暴露给轮末中止，**方案一异步形态因此成立**（listener 不 await 评审）。
- turn/end 的 `interrupted` 与错误/中止轮不派发 turn-stopping → 这些轮**自然不评审**（无需插件侧判断）。

## 3. 配置与迁移语义

- **零迁移**：v5 schema 已含 ReviewFlow 全字段（settings-schema.ts：rounds 1..3、trigger=keywords 必填 keywordGroup、reviewer 不带 effort——M7 既定）。
- **存量行为零突变**：预置 review 流（DEFAULT_FLOWS，config.ts:145）保持 `trigger: manual`；用户经设置页切到 `keywords` 才启用认领语义。既有路由规则（含内置 capability 预设的 `review-k3`）不删不改——认领成立时由路由层**静态抑制**（§4）。
- **设置页**：流编辑器已有 trigger/keywordGroup 编辑（packages/dsh-kimi-tide/src/client/SettingsCard.tsx:316-340，validate-on-write 已保证 trigger=keywords 必填存在的 keywordGroup）。本迭代新增**认领提示**：路由规则行的 `when.group` 被认领时标灰 + 文案「该组已被评审流认领，不再参与路由」；共存允许保存（抑制是自然结果，非非法态）。

## 4. 路由层（纯函数，rules.ts / router.ts）

- 新增 `claimedReviewGroups(config: RouterConfigAny): Set<string>`：收集所有 `type==='review' && trigger==='keywords' && keywordGroup 非空` 的组名（v4 无 flows → 空集，行为逐字节保持）。
- `matchingScored` 不变；`decide` 与 `previewRoute` 在取得 hits 后**统一过滤** `when.kind==='keywords' && claimed.has(when.group)` 的规则——**静态抑制**（与本轮是否命中无关），语义可预测、可解释。
- `previewRoute` 新增 outcome `{ kind: 'review-flow', flowId, label, score, routed }`（评审修复 M1：`routed` 为「本轮路由到 X」的类型化载体，UI 不从 hits 反推）：`routed = { kind: 'rule', ruleId, label } | { kind: 'default', target }`——被认领组命中过滤后的实际路由（规则链首条，无命中即预设默认）。触发判定先于过滤、基于全量 hits 计算（文本命中被认领组 ≥1 词即成立）；返回 `hits` 中被认领组命中剔除（与路由链一致）。组已认领但 reviewer 不可用时 outcome 仍为 `review-flow`，`label` 改为「评审流已认领但评审模型不可用」、`routed` 照常（盲区可见性，见 §5）。
- 显式 @ 分支不变（最高优先，先于一切抑制与武装）。

## 5. 编排层（installRouter 扩展）

新增纯函数 `reviewTriggerHit(config, text): { flowId, flow } | null`：claimed 组中首个（flows 注册表序）被文本命中（≥1 词）且 reviewer 在候选目录可用的 review 流；显式 @ 命中时返回 null（§2 契约）——**未知 provider 的显式 @ 同样抑制**（`explicitProvider` 对未知 @ 也返回非空，rules.ts:20，decide 走 keep 宽容；评审武装对一切显式 @ 保持关闭，评审修复 L6）。

**可用性盲区（评审修复新增，2026-09-04）**：`claimedReviewGroups` 的静态抑制不检查 reviewer 可用性（认领即抑制，语义可预测）；`reviewTriggerHit` 要求 reviewer 可用。组合盲区=组已认领但 reviewer 不可用 → 命中词既不路由到被抑制规则、也不触发评审，旧路由行为不回退。处置：抑制维持无条件；盲区经 `previewRoute` 的 review-flow outcome 显式标注（§4），不做静默。

执行序（均 agent 作用域）：

1. **pre-step（step===1）**：`reviewTriggerHit` 命中 → armed 槽 `WeakMap<Agent, {turn, flowId, flow, userText}>`（每轮重置/覆盖）；`userText` = `latestUserText(payload.messages)`。
2. **session/event 监听**（常驻，agent 作用域；注册机制评审修复 M2）：
   - **注册路径**：插件级 `ctx.on('session/event')` 收全量会话且载荷 `(session, event)` 无 agent 反查、无法键入 armed 槽——监听器注册在 **`agent.ctx`**（Agent 接口 `readonly ctx`，dsh-scope 作用域过滤：agent-scoped 监听器只收该 agent 进入的会话）：首次 pre-step 拿到 `payload.agent` 时登记一次（`WeakSet<Agent>` 去重），闭包捕获 agent 供槽键入；随 agent dispose 自动卸载。installRouter 重挂载（配置热变更）dispose 全部监听，armed/lastTurn/WeakSet 随之重建（丢最近一轮缓存可接受，§10）。
   - `event.type==='assistant/message' && event.turn === armed?.turn` → 累计该轮文本块（多步工具循环全收；`interrupted` 消息不计；**累计侧同设 12000 字符上限**——超限停收并保留「…（已截断）」标注，评审修复 L5；§6 输入构造侧截断保留为兜底）；
   - 同 feed 滚动维护 `lastTurn = {userText, output}`（每 agent 最近一轮，供手动命令，不依赖 armed）。`user/message` 事件刷新 `lastTurn.userText`（取其 text 块拼接；**仅收人类输入**——synthetic 注入上下文与 goal 续轮不计，按 `user/message.source` 区分，评审修复 L3；source 字段值实施时实读锚定）。
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

- **事件**：`kimi-tide/review`，payload `{flowId, reviewer: {provider, model}, turn, userText, reviewText, ok, error?, durationMs, at}`（`userText` ≤200 字符摘要；`at` = ISO 时间）。`KNOWN_SESSION_EVENT_TYPES` 注册沿用 registerPanelEventType 同款机制（index.ts:255-272 模式，安装级 catalog 扩展）——注册清单由单类型扩展为 **panel + review 两类型**（评审修复 L4）。
- **投影**：**新投影 unit `kimi-tide/review`**（评审修复 L4 裁定：不并入 panel——panel 快照签名被 60s 配额轮询驱动、语义去重面向整值快照，评审记录混入会污染签名并膨胀事件流）：独立 stateSchema + stateVersion + 注册清单同步；fold 每会话保留最近 20 条评审记录（新到旧）。
- **客户端**：会话流渲染评审卡（徽标 = 评审模型 + flowId；`ok:false` 失败卡标灰并显 error）。**渲染缝（评审修复 V4，2026-09-04 实读锚定）**：`ctx.uiConversation.events.register(ConversationNodeDefinition)`（dsh-client-ui-chat lib/client.js:4545 全量卡片同款；契约 dsh-client-ui-conversation lib/types/client/contract/conversation.d.ts:157-208——match/start/update/buildViewNode）+ 渲染器 kind 经 `conversation.chat.node` 槽注入与 `ChatNodeDataMap` 声明合并（client.js:3582 起）；`kimi-tide/review` 非 append-surface 事件（SURFACE_EVENT_TYPES 仅 user/assistant/tool，client.js:3907-3934），unknown 兜底（client.js:5618-5624 按该门控）不适用——**注册专用 ConversationNodeDefinition 是评审卡的唯一渲染路径**（已注册；渲染链 match/start/buildViewNode→keyed renderer 端到端核实可达，2026-09-04 T8 评审实读）。**TideDock/ReasonPanel 消费随本迭代交付**，验收含目检项（§9 A6）。
- **dock**：评审执行完成记一条流事件（lastFlowEvent 同款通道，`review:<flowId> ok/失败 · <reviewer.model>`）。

## 8. 手动命令

- `/kimi-tide review`：取该 agent `lastTurn` 缓存 → 同款异步评审（armed 语义外唯一入口）；无缓存返回「无可评审的上一轮」。命令幂等：连发两次各产生一条评审事件（用户显式行为，不去重）。
- `/kimi-tide show` 输出补一行：认领中的关键词组（`claimedReviewGroups` 非空时）。

## 9. 测试设计

**单测（纯函数）**：
- `claimedReviewGroups`：v4 空集 / v5 收集 / trigger=manual 不收 / keywordGroup 缺省不收；
- decide 抑制：被认领组规则跳过且命中词不再计入 / 他组规则照常 / 显式 @ 优先且 `reviewTriggerHit` 返 null / flow 目标规则不受认领影响；
- `reviewTriggerHit`：命中取注册表序首个 / reviewer 不可用返 null / 未命中返 null；
- 输入构造：双段截断（12000+1 字符断言截断标注）/ 模板三段齐备；
- 累计侧上限（12000+1 停收断言，评审修复 L5）；
- 显式 @ 全域抑制：已知 provider 与**未知 @** 均 `reviewTriggerHit` 返 null（评审修复 L6）；
- 设置页认领提示推导纯函数（claimed 组集合 → 规则行标注状态，评审修复 L8）。

**集成（mock ctx，沿用现有 installRouter 测试夹具）**：
- armed→累计→turn-stopping：断言 `ctx.llm.stream` 被调（载荷含需求+产出）且 listener 未阻塞（先返回后 append）；
- 完成 → `session.append('kimi-tide/review', {ok:true, …})`；mock 流失败 → `ok:false` 卡 + 不抛出；
- 产出为空（武装轮无 assistant/message）→ 不发起评审；
- 评审事件回灌 session/event → 不武装、不评审（防环断言）；
- 显式 @ 轮 → 不 armed；
- 多轮连续：第二轮 armed 覆盖第一轮槽，各轮评审独立；
- `/kimi-tide review`：有缓存执行 / 无缓存报错文案；
- 评审完成但 `session.append` 抛错（目标 session 已销毁）→ 流程不抛出、warn 落日志（评审修复 M4/§10 兜底）；
- armed 轮含 `interrupted:true` 的 assistant/message → 不计入产出（评审修复 L8）；
- turn-stopping `payload.turn !== armed.turn`（槽过期/交错）→ 不发起评审（评审修复 L8）；
- 无 turn-stopping 的关闭路径（pre-step reject / 延续排空）→ armed 槽留存至下一轮覆盖、评审静默跳过（评审修复 L2 容忍语义锁定）；
- `validateRouterConfig` review 流分支拒绝 `reviewer.effort`（评审修复 L7）。

**previewRoute**：被认领组规则不出现于 outcome 与 hits；命中显示 `review-flow` outcome（`routed` 携带过滤后路由）；**可用性盲区**：组认领 + reviewer 不可用 → outcome 仍 `review-flow` 且 label 标注不可用、`routed` 照常。

**实机验收（用户重启 dsh web 后，A 系全绿方发布）**：
- A1 「这个做完做交叉评审」→ 面板决策原因**不**含 review 组命中（本轮落默认/执行模型）；
- A2 轮末数秒内评审卡上屏，徽标=评审模型，内容含「问题/建议/结论」结构；
- A3 评审卡之后的普通消息不触发评审（防环实机证）；
- A4 设置页：review 流 trigger=manual 时无认领提示；切 keywords 后 `review-k3` 规则行标灰 + 提示文案；
- A5 「试一句」输入「帮我评审这段代码」→ outcome 显示「轮末触发评审流 review」；
- A6 评审卡 Host/Client 双端目检（投影帧 + 会话流卡片渲染）；
- A7 `/kimi-tide review` 手动触发 → 评审卡上屏；无缓存会话报错文案正确；
- A8 盲区可见性（评审修复新增）：配置「组认领 + 评审模型不可用」→ 试一句 outcome 仍显示 review-flow 并标注「评审模型不可用」（§4/§5 盲区处置实机证）。

## 10. 范围与分期

- **本迭代（1.1.0）**：§3–§9 全量（路由认领 + 编排 + 事件卡双端 + 手动命令 + 设置页提示 + A 系验收）+ 评审修复收编一项：`validateRouterConfig` review 流分支补 `reviewer.effort` 拒绝（评审修复 L7——config 类型含可选 effort 而 validate 不查的既有缝，运行期不消费；一行校验 + 单测随本迭代交付）。
- **不做（留下迭代）**：autoRevise / 通路 B（inbox 注入修订轮，agent.steer 语义）；评审子代理形态（P3）；评审模板自定义；rounds>1（autoRevise=false 时恒 1）；多 review 流并行（每轮取首个命中）。
- **风险与缓解**：
  | 风险 | 缓解 |
  |---|---|
  | 评审调用额度失控 | 默认 manual；keywords 触发需用户显式切换；每轮至多一次；60s 有界超时 |
  | 评审质量依赖输入完整性 | 需求+产出双段输入（裁定 3）；截断标注可见 |
  | 异步评审时 agent disposed | WeakMap 槽随回收；进行中调用 60s 超时兜底，append 目标 session 已销毁时 catch 落日志 |
  | 存量行为突变 | trigger 默认 manual 零迁移；认领仅随用户切换生效 |
  | 双端交付遗漏（0.6.x 教训） | 客户端渲染列为本迭代交付项 + A6 验收门禁 |
  | 轮末无 turn-stopping 的关闭路径（pre-step reject / 延续排空，评审修复 L2） | armed 槽下一轮覆盖、评审静默跳过——容忍语义，§9 集成用例锁定 |
  | installRouter 重挂载丢 armed/lastTurn（评审修复 M2 生命周期） | 配置热变更后缓存重建，丢最近一轮手动评审缓存可接受 |
