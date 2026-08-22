# Spike 报告：S2 子代理派发 + S3 轮末注入（2026-08-22）

> 执行：主会话 Inspect 契约查询（Service.listService: subagents + Event.listEvents 全目录）。**结论：双 GO——P2（review 流）与 P3（子代理转述）契约齐备，可立项。**

## S2：编程式子代理派发 —— ✅ GO

`ctx.subagents` 服务（「Named provider registry with one-shot runs, durable discovery, and continuable-child operations」）：

| 方法 | 用途 |
|---|---|
| `start(name, request): Promise<SubagentRun>` | **一次性派发**——label/prompt/parent/signal；失败在发布前拒绝（无孤儿 run），发布后故障经 run 对象 settle |
| `startContinuable(spec)` / `followup(parent, childId, content, options)` | 持久可续子代理（冷恢复、FIFO 轮） |
| `registerProvider(provider)` / `getProvider` / `list` | 命名注册表（rc.8 调研已证实） |
| `subagent/end` 事件（emit） | 子代理 settle 通知 |

**要点**：
- `start` 的 `request.parent` 需为**活体 Agent**——插件场景由 `agent/pre-step` 的 `payload.agent` 供给，链路成立。
- 结果回收 = run 对象 promise + `subagent/end` 事件双通道。
- **P3 结论**：子代理转述形态可行；与直调的差异 = 独立会话日志 + GUI 可见（可观测性收益）vs 会话生命周期开销（延迟成本）。按 spec 分期，P3 再做。

## S3：轮末事件 + 消息注入 —— ✅ GO（双通路）

**轮末钩子**：
- `agent/turn-stopping`（**serial 模式**，payload `{agent, turn, signal}`）——「turn 即将关闭」语义，serial 监听者可异步执行后放行——review 调用的天然挂点。
- 辅助：`agent/status`（idle⇄running）、`agent/error`、`session/event`（post-commit 追加馈送）。

**注入通路**（按 review 流 `autoRevise` 分姿态）：

| 通路 | 机制 | 语义 | 成本 |
|---|---|---|---|
| A 面板卡 | session.append 自定义事件 + 投影上屏 | 评审意见进 kimi-tide 面板/ dock，不触发新轮 | 零模型成本 |
| B inbox 注入 | 向 agent inbox 投递新消息 | 评审意见作为新轮输入 → 主模型响应（=autoRevise 语义） | 一轮主模型调用 |

- 通路 A 的全部机制均为 kimi-tide 既有先例：`KNOWN_SESSION_EVENT_TYPES` 注册（index.ts registerPanelEventType）+ 会话投影上屏（projection.ts）。
- 通路 B 的 inbox 写入面有事件佐证（`agent/inbox/inserted/claimed/discarded` + subagents.followup「The Agent inbox is the only queue」）；插件可达性（Agent inbox API 的确切形态）**留作 P2 设计时实读 `@deepseek-ai/dsh-agent` 类型确认**——不门禁 P1。
- **P2 结论**：review 流可行；`autoRevise:false` 走通路 A（默认），`true` 走通路 B。防环路规则（评审消息不触发评审、rounds 上限）在流内实现。

## 顺带复核（本计划相关既有契约）

- `agent/pre-step` 签名终版：`(payload: { agent, messages, turn, step, signal }, next) => Promise<PreStepDecision>`——「Reject a proposed step **or replace the messages that enter it**」。替换面只及本轮 claimed 消息（非全量历史），故智能投影仍走 S4c（llm/stream 覆盖全量请求）。
- `llm/stream`（S4c 已 PASS，见 sister 报告）。
- `settings/updated` / `settings/document-updated` 事件——设置热重载监听用现行机制，无新增需求。

## 对 spec 的回写

§5.3 review 流的注入形态确定为「通路 A 默认 / 通路 B 随 autoRevise」；§14 S2/S3 标记 GO。
