# Review Flow 1.1.0 Spec · Kimi 独立评审存档（单轮 + 实施者逐项复核）

> **评审对象**：`docs/superpowers/specs/2026-09-02-review-flow-design.md` v1（143 行，基线 `ee6d9cc`）
> **评审人**：Kimi（真身，子代理派发，首行 `@kimi`，只读，防偏护栏提示词）｜ **实施者**：DSH 主 agent（GLM）
> **评审轮**：Round 1 单轮（2026-09-04）｜ **修复波**：spec v2 同日
> **结论**：**需修改后实施**——4 中 8 轻 4 待核实；实施者逐项复核后全部成立或部分成立，修复波全清（见文末处置表）

---

## Round 1 报告（Kimi 原文，2026-09-04）

评审证据已收集到足够深度（宿主契约、路由/schema/projection/index 锚点均已实读）。说明：后续工具调用发生故障（重复派发同一 git 调用无法纠偏），`SettingsCard.tsx` 与两份前身 spec 未能实读，相关发现已按规则标「待核实」并给出验证方法。以下为评审结论。

### 已实读核实无误的部分（先行确认）

- **宿主契约语义全部吻合**：`agent/turn-stopping` 为 serial 且被 loop await（dsh-agent-loop lib/index.js:570），payload `{agent, turn, signal}` 经 dsh-agent/lib/types/dispatch.js:37-42 `fused()` 注入 agent、runtime-types.d.ts:305-310 声明证实；`session/event` 为 post-commit fire-and-forget 馈送，作用域过滤语与 spec 引用逐字一致（dsh-tool-cordis lib/index.js:5079-5083）；`assistant/message` 载荷 `{turn, step, message, usage?, interrupted?: true}` 逐字段吻合（dsh-session lib/types/types.d.ts:291-297）。
- **配置/schema 锚点全部吻合**：`config.ts:50` ReviewFlow、`:145-161` DEFAULT_FLOWS（review 流 `trigger:'manual'`）；settings-schema.ts:42-57 判别联合、:18 reviewerTargetSchema 无 effort（M7）、:165 rounds 1..3、:168 keywords 必填 keywordGroup；`review-k3` 规则在 config.ts:131。
- **防环/派生事实 1 成立**：评审调用不设 purpose → `auxRewriteTarget` 返 null（router.ts:782-783）；纯文本无图 → 投影拦截器不改写（router.ts:747-750）；`AbortSignal.timeout` 单独使用与 boundedSignal 缺省退化路径一致（router.ts:344-348）。

### 中度

- **M1**｜previewRoute 新 outcome 形状不自洽，TDD 直接卡点——spec §4「`previewRoute` 新增 outcome `{ kind: 'review-flow', flowId, label, score }`……显示『本轮路由到 X + 轮末触发评审流』」；rules.ts:166-170（`RoutePreview.outcome` 为单字段判别联合）。outcome 二选一——返回 `review-flow` 就丢掉了 X 的类型化载体。建议：outcome 扩展携带 routed 摘要或明确 UI 推导口径。
- **M2**｜session/event 监听器的「agent 作用域」注册机制未写明——spec §5.2「常驻，agent 作用域」；插件级 `ctx.on('session/event')` 收全量会话且 Session 无 agent 反查，armed 槽 `WeakMap<Agent,…>` 无从键入。建议：明确注册在 `agent.ctx`（每 agent 一次、随 dispose 卸载）+ 重挂载生命周期。
- **M3**｜agent/pre-step 载荷是否含 `turn` 未锚定——armed 槽对齐机制的根基「待核实」（间接证据 agent-loop:539-542 preStep 传入 turn）。实施前必须复核；若缺席升级为阻塞。
- **M4**｜§9 测试清单未覆盖 §10 已列风险「异步评审时 agent disposed」（append 目标 session 已销毁 catch 落日志无用例）。

### 轻度

- **L1**｜§2 锚点行号漂移：spec 引 :565/:567；实读 :569 门控 + :570 派发，throwIfAborted :568/:574。
- **L2**｜宿主存在 spec 未列的「轮末不派发 turn-stopping」路径：agent-loop:547 延续排空 break、:543-546 pre-step reject——armed 轮经此关闭时评审静默丢弃。建议 §10 补行或 §5.3 声明容忍。
- **L3**｜lastTurn.userText 不过滤 user/message 的 source（types.d.ts:267-274 synthetic 注入与 goal 续轮）——`/kimi-tide review` 可能把注入上下文当需求评审。
- **L4**｜评审投影载体未决策：并入 panel unit 污染签名/膨胀事件流 vs 新 unit 需补 key/stateSchema/stateVersion/客户端桥；且 `KNOWN_SESSION_EVENT_TYPES` 目前只注册 panel 一类型（index.ts:270）。
- **L5**｜产出累计缓冲无界（12000 截断仅发生在输入构造时）。
- **L6**｜未知显式 @ 同样抑制评审武装，spec 未点明（rules.ts:20 `explicitProvider` 对未知 @ 返回 `m[1]`）。
- **L7**｜reviewer.effort 的 type/schema 缝（既有问题非本 spec 引入）：config.ts:50-57 类型含可选 effort、settings-schema 非严格透传、validateRouterConfig :164-170 不查——建议 validate 补拒绝。
- **L8**｜§9 其余小缺口：interrupted 不计无用例；turn 不匹配无用例；设置页认领提示仅 A4 实机覆盖。

### 待核实（未能溯源，附验证方法）

- **V1**｜SettingsCard.tsx:318 流编辑器——子代理按 `packages/dsh-kimi-tide/client/SettingsCard.tsx` 路径实查不存在。验证：glob 定位真实路径读 :318 区域。
- **V2**｜0.6.0 spec §5.3/§5.7/§14 原文口径未读。
- **V3**｜0.8.x spec 文档锚点未读（代码侧已实读核实）。
- **V4**｜客户端会话事件卡渲染机制无锚点（§7 只给 host 侧 append）——建议升级为实施前必核（直接关系 A6 可达性）。

---

## 实施者逐项复核（DSH 主 agent，2026-09-04，实读非转抄）

| 项 | 判定 | 证据 |
|---|---|---|
| M3 | ✅ **有 turn，不阻塞** | dsh-agent lib/types/runtime-types.d.ts:239-245：`'agent/pre-step'(this: Scoped<Agent>, payload: { agent, messages, turn: number, step, signal })` |
| M1 | ✅ 真缺口 | rules.ts:164-171：outcome 为 off/explicit/rule/default 判别联合，review-flow 新枝无处携带 X |
| M2 | ✅ 真缺口，机制成立 | Agent 接口 `readonly ctx`（runtime-types.d.ts:75）+ dsh-scope 作用域过滤语义（Kimi 实读 dsh-tool-cordis:5079-5083）→ `agent.ctx.on('session/event')` 可行 |
| M4/L8 | ✅ 测试缺口属实 | spec v2 §9 已补 |
| L1 | ✅ 属实 | 实读 agent-loop：:569 门控、:570 dispatch.serial、:568/:574 throwIfAborted |
| L2 | ✅ 属实 | pre-step reject（payload 契约允许拒绝）与延续排空路径无 turn-stopping |
| L3 | ✅ 属实 | 采纳意图 + source 字段值实施时锚定 |
| L4 | ✅ 真决策缺口 | index.ts:255-272 registerPanelEventType 仅 add panel 一类型；裁定**新 unit** |
| L5/L6 | ✅ 属实 | L6 锚点 rules.ts:20 实读确认（未知 @ 返 m[1]） |
| L7 | ✅ 属实（既有缝） | 用户批准随本迭代收编（validate + 单测） |
| V1 | ✅ **spec 没错**（子代理找错路径） | 真实路径 `packages/dsh-kimi-tide/src/client/SettingsCard.tsx`，:316-340 trigger/keywordGroup 编辑器 + validate-on-write 注释逐字吻合 |
| V4 | ✅ **缝存在，优于预期** | `ctx.uiConversation.events.register(ConversationNodeDefinition)`（dsh-client-ui-chat lib/client.js:4545；契约 conversation.d.ts:157-208）+ `conversation.chat.node` 槽（:3582 起）+ unknown 兜底（:5639/6929）——未注册专用卡事件也不隐身，A6 可达 |
| V2/V3 | ⚪ 未复读文档 | 代码侧锚点已闭合（V3）；前身 spec 口径实施时按需核对 |

**实施者另报两项（Kimi 未发现，并入修复波）**：
1. 认领抑制（无条件）≠ 武装条件（reviewer 可用）→ 组认领 + reviewer 不可用 = 命中词静默无事发生且旧路由不回退。处置：抑制维持无条件 + previewRoute 盲区显式标注（新 A8）。
2. A5 只测 reviewer 可用路径，盲区显示行为 v1 未定义。

---

## 处置表（spec v2 修复波落点）

| 评审项 | 落点 |
|---|---|
| M1 | §4 outcome 扩展 `{…, routed}` 决策 + §9 previewRoute 测试刷新 |
| M2 | §5.2 注册机制（agent.ctx / WeakSet 去重 / 重挂载生命周期）+ §10 风险行 |
| M3 | §2 契约表补 agent/pre-step 行（runtime-types.d.ts:239-245 + Agent.ctx:75） |
| M4 | §9 集成补 append 抛错用例 |
| L1 | §2 行号修正（:569-570 / :568/:574） |
| L2 | §10 风险表补行 + §9 集成容忍语义锁定用例 |
| L3 | §5.2 lastTurn 仅收人类输入（source 实施时锚定） |
| L4 | §7 裁定新投影 unit `kimi-tide/review` + 注册清单两类型 |
| L5 | §5.2 累计侧 12000 上限 + §9 单测 |
| L6 | §5 钉未知 @ 亦抑制 + §9 单测 |
| L7 | §10 本迭代收编（validateRouterConfig 拒绝 reviewer.effort）+ §9 集成用例 |
| L8 | §9 单测/集成补齐（interrupted / turn 不匹配 / 认领提示纯函数） |
| V1 | 无需改（spec 正确）；§3 路径顺手写实 |
| V4 | §7 补客户端渲染缝锚点三件套 |
| 实施者项 1+2 | §5 盲区处置节 + §4 label 标注 + §9 测试 + §9 A8 |
| 头部 | 状态行 v2 + 评审档案指针 + 四裁定→五裁定勘误 |
