# 评审档案（抢救）：第一轮 k3 独立评审因 Kimi 月配额中断（2026-09-15）

> **评审人（未完成）**：**kimi-coding/k3**，经三个子代理并行派发（提示词首行 `@kimi`，沿仓库 09-11 惯例用月汐显式 @ 路径路由）
> **状态**：**三个子代理全部失败**，无最终报告产出——本文件抢救其死前推理轨迹中的可用结论，并记录失败原因与方法论教训
> **后续**：同批三份 spec 已改派独立模型评审完成（见本目录另三份档案）——**署名复核更正（2026-09-15）**：三份中**仅用量/余额一份**实由 `qwen3.8-max` 完成，语义闸与说明页签两份实由 `glm-5.3` 完成（见该两份档案头部「更正记录」；机制见 `docs/superpowers/backlog.md` Q6）

---

## 1. 失败事实与死因（会话日志实证）

| 项 | 内容 |
|---|---|
| 派发 | 3 个子代理，各带完整评审提示词，首行 `@kimi` |
| 路由验证 | 子会话 `request/header` = `{"provider":"kimi-coding","model":"k3","reasoningEffort":"max","maxTokens":131072}`；`request/context` = `kimi-coding/k3`，`ctxWindow` 1048576 ⇒ **显式 @ 路由生效** |
| 终止原因 | `turn/end` 事件 `reason.kind = "error"`：`403 {"error":{"type":"permission_error","message":"You've reached your monthly usage limit for this billing cycle. Your quota will be refreshed in the next cycle. To continue now, purchase extra usage…"}}` |
| 时间线 | 12:32 派发 → 各自跑到第 7 步（已读完 spec 与多个源文件）→ 第 8 步同时 403 |
| 影响 | kimi-coding 在本计费周期内不可用；`capability` 预设的 `review-k3` 规则与一切指向 kimi 的路由同期失效 |

## 2. 方法论教训（本文件的主要价值）

**教训 A · 「@kimi」是路由指令，不是模型身份；模型自称不能作为独立性证据。**

同一子会话内三处记录各说各话且**都真**：

| 事件 | 内容 | 层级 |
|---|---|---|
| `system/message` seq 8 | "You are a coding agent powered by the **deepseek-flash** model" | 人设（会话基座模型 `agent-default-model` 在创建时写死） |
| `request/header` seq 12 | `provider: kimi-coding, model: k3` | 实际发出的请求 |
| `request/context` seq 13 | `kimi-coding/k3`，`ctxWindow` 1048576 | 适配器解析结果（deepseek-flash 为 1000000，可作旁证） |

⇒ 月汐的显式 @ 只替换**每次请求的 callConfig（provider/model）**，**不重写系统提示词**。因此子代理会自称 deepseek-flash 却实际跑在 k3 上。
⇒ **判「是否独立模型」只能看会话日志 `request/header`**；09-11 那次同款现象未被点破，本条自此写入评审惯例。

**教训 B · 403 错误本身即是路由生效的反证**：请求若未真正打到 Kimi，不可能收到 Kimi 服务端返回的配额错误。

**教训 C · 抢救是可行的**：会话日志保留完整推理轨迹与工具调用。本次用 `_extract-reasoning.mjs`（从 zstd 多帧日志提取 `reasoning` 块）在零成本下救回实质结论（见 §3）。

**教训 D · 配额头口径待核**：403 说的是「**monthly / billing cycle**」，而 dock 显示的是「**周 / 5h**」两窗——两个口径未必对得上。已作为洞察转给「用量/余额源全覆盖」设计稿（见下 §3②）。

## 3. 抢救出的结论（逐条已由控制器回源码复核）

### ① 语义命中确认闸 spec —— 新发现（作者自评漏项）

> k3 原文（推理轨迹）：「Note on settings-schema: the design §6 says "对象型字段缺失即注 {} 的既有行为 → 语义上等同关闭，无副作用"。But wait — the design proposes `hitConfirm: Schema.object({...})` inside presetSchema. Per the compat annotation (line 66): object/dict/array fields missing → injected as {}. So every preset round-trip would get hitConfirm:{} injected — meaning "DEFAULT 不注入" is violated… The design claims this is "语义上等同关闭，无副作用" — but the repo's own precedent for imageFallback (a scalar) was "入 schema 但不带 default——缺省省略不注入" precisely to preserve round-trip equality; for object-typed fields, the schema injects {} which BREAKS "往返相等"」
> 「Confirmed: `settings-schema.test.ts:8` asserts `routerConfigSchema(DEFAULT_CONFIG_V5())` toEqual DEFAULT_CONFIG_V5() — if hitConfirm is added to presetSchema as Schema.object, the injection of `hitConfirm: {}` into each preset would break this existing test」

**控制器复核：成立。** 证据：`settings-schema.ts:63-71`（自述「对象/字典/数组型字段：缺失即注入 {}/[]，与是否带 default 无关」；并记载 v3 `default` 正因此**不入 schema**）；`test/settings-schema.test.ts:7-9`（往返相等断言）。
**后续**：该发现在第二轮 glm-5.3 评审中被**独立复现并升级为严重项 S1**（见 `2026-09-15-review-semantic-hit-gate-spec-glm-review.md` §1 S1）——两轮不同模型独立命中同一条，可信度高。

### ② 用量/余额源全覆盖 spec —— 两条独立确认 + 一条新增

- 独立确认作者自评的 **M1/契约边界**：实时快照走 HTTP 路由，**无运行期校验**（`index.ts:689-708` `JSON.stringify`）。
- 独立确认作者自评的 **M2/baseURL**：`baseURL` 真实链含 `DEEPSEEK_BASE_URL` 环境层（「The spec OMITS the `DEEPSEEK_BASE_URL` environment layer」），且该名 honored only from trusted layers。
- **新增**：余额源快照为 `null` 时，客户端无法判断该源本该是「余额」形态，会退化成灰色**用量双槽**——这是 S1（三态无通路）的第二维度：不只是少一个原因，连**形态**都错。
  **控制器复核：成立**（`TideDock.tsx:287-296` 只有 `Object.hasOwn` + `?? null`；`types.ts:81` 无形态元数据）。

### ③ 说明页签 spec

该子代理（`0fd47cc5`）在失败前仍在读源文件阶段，未产出可抢救的结论。

## 4. 未产出的部分

- 三份正式评审报告（无最终结论）；
- 说明页签 spec 的第一轮独立意见。

**上述缺口已由第二轮独立评审全部补齐**（署名复核后：语义闸与说明页签两份为 glm-5.3、用量余额一份为 qwen3.8-max；见同目录三份档案头部）。
