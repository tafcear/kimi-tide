# 用量归属账本与路由生效判据 — 设计稿（v1.4.0 候选）

> 状态：**挂账 / 待评审**（2026-09-15 用户裁定「这个设计挂账吧」——设计稿保留、暂不实施；恢复入口见 `docs/superpowers/backlog.md` 的 **Q7**）
> 三问已裁定：**只报 token 不算钱** / **时间窗只本会话** / **一次做完、判据优先**（见 §6）
> 动因：用户提出「每次对话都有这个用量统计，可以用这个信息」→ 追问后裁定 **A（按模型/规则/预设的真实用量与成本账）+ C（用量/成本接回路由决策）**，并追加一条更关键的用途：**用「用量归属」当路由是否真的生效的判据**。

## 0. 一句话

把会话日志里**每条 assistant 消息自带的真实用量与真实服务方**折成一本「谁烧了多少」的账，并把它与**路由器的决策**对照——不一致就报出来。这既是一本账，也是**第一个不依赖离线解码的路由生效哨兵**。

## 1. 动因与现状

### 1.1 用户看到的面（宿主自带）

宿主挂载了 `@deepseek-ai/dsh-token-meter` 与 `@deepseek-ai/dsh-session-stats`（`dsh --profile web --dump-config` 实证），对话下的「本轮用量」卡显示：提供方/模型、缓存命中率、未缓存输入、缓存读取、输出（含推理）。**这是聚合数**。

### 1.2 真实可用的数据（2026-09-15 实机取证，本节每条都实测过）

从任一已完成会话解码 `session.v3.jsonl.zstd`，`assistant/message` 事件同时带**两份**我们要的东西：

```jsonc
{
  "type": "assistant/message",
  "data": {
    "turn": 1, "step": 3,
    "message": {
      "source": { "kind": "model", "provider": "zai-coding-cn", "model": "glm-5.3", "replayState": {…} }
    },
    "usage": {
      "inputTokens": 4012,        // 未缓存输入（**不含**缓存部分，语义见下）
      "outputTokens": 1300,
      "cacheReadTokens": 15488,
      "cacheWriteTokens": 0,
      "totalTokens": 20800
    }
  }
}
```

- **归属是硬事实**：`data.message.source.{provider,model}` 是**真正答这条消息的模型**（不是我们请求的、也不是模型自称的）。这正是本轮 A7 复验花了一堆探针才拿到的那个判据，这里是它的**在线版本**。
- **量是提供方上报的**：`usage` 的桶语义由 `dsh-llm` 契约背书（`lib/types/types.d.ts:131-150`）——`inputTokens` 是**未缓存输入**、缓存另计 `cacheReadTokens`/`cacheWriteTokens`，三者相加才是计费输入；`reasoningTokens` 是输出子集、适配器不报则缺席。
- **一次实测的账**（19:13 那发阳性对照探针会话，15 条 assistant 消息）：唯一归属 `zai-coding-cn/glm-5.3`，未缓存输入 60,504、缓存读 692,544、输出 18,202、合计 771,250，**缓存命中率 92.0%**。
- **无单价**：`LlmModelInfo` 只有 `provider/id/name/description/inputModalities`，`LlmResolvedModelInfo` 追加 `context/defaultMaxTokens/reasoning/systemPromptUpdate`（`dsh-llm/lib/types/types.d.ts:277-330`），**没有任何 token 单价字段**；全库唯一的价是**图片请求计价** `imageRequestPricing`。⇒ **要算钱只能靠用户自填单价表**，这是本稿最重要的约束。

### 1.3 为什么这件事有意义

1. **路由生效判据（用户点名要的那条）**：现有判据是离线解码 `request/header`（今天验 A7 就是这么做的，成本高、要写脚本）。而「**路由决策里的目标 ≠ 实际答话的模型**」这个信号，可以在线、零成本、对每一轮自动拿到。今天已知**至少一类真实错配**：宿主 `dsh-host-apiproxy` 的 `installModelSelection` 覆盖过路由返回值（0.6.0 验收实锤，已由 `prepend: true` 修复）——这类回归一旦复现，本判据立刻报出来。
2. **成本账**：宿主那张卡是**总量**；「哪个模型/哪条规则在烧钱」它答不了。而路由的价值主张（省钱预设）恰恰需要这个答案。
3. **缓存命中率才是真省钱杠杆**：实测 92% 的输入来自缓存读，命中率对账单的影响远大于切模型。这条只有按模型拆开看才成立。

## 2. 非目标

- **不做价格库**：不内置任何单价、不抓上游价格页（会烂、会有法律与准确性问题）。要算钱 = 用户填单价表，缺单价就只报 token。
- **不改宿主那张卡**：那是 `dsh-token-meter` 的面，本稿只在月汐自己的面里加归属维度。
- **不推理「应该用谁」的评分**：C 组的落点是「把真实用量与成本摆到决策旁边、并允许用价格做排序偏好」，不是再造一套评分引擎（0.5.0 已把评分引擎整体退役）。
- **不写会话日志**：v1.2.0 已经把面板数据从会话日志里搬走（历史 12 万条 / 200+ MB 的教训），本稿的账本**同样不进会话日志**。

## 3. 数据契约与不变量

### 3.1 输入（会话事件，实读锚点）

`assistant/message` 的 `data`：

| 字段 | 类型 | 用途 | 缺省语义 |
| --- | --- | --- | --- |
| `turn` | `number \| undefined` | 归属到轮 | 缺席 ⇒ 记入「未归属」桶，不参与判据 |
| `step` | `number \| undefined` | 观测 | 不参与聚合 |
| `message.source` | `{ kind:'model', provider, model }` | **归属** | 非 `kind:'model'`（注入/合成）⇒ 跳过 |
| `usage` | `TokenUsage`（见上） | 计量 | 缺席 ⇒ 只记归属、不记量（宿主对空内容消息也写 `assistant/message`，可能无 usage） |
| `interrupted` | `boolean` | 中断前缀 | `true` ⇒ **不计入**（与 router 侧 output 累计的既有取舍一致） |

### 3.2 聚合输出（纯函数，可单测）

```ts
interface UsageBucket {
  provider: string; model: string
  attempts: number                 // assistant/message 条数（一条 = 一次计费尝试的产出）
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number          // 缺席按 0 累加，另有 hasReasoning 标记
  totalTokens: number
}
interface UsageLedger {
  buckets: UsageBucket[]           // 按 totalTokens 降序（稳定：并列按 provider/model）
  totals: UsageBucket              // provider/model = '(合计)'
  turns: number
  mismatch: MismatchRecord[]       // 见 §4
}
```

**不变量（逐条落测试）**：

1. **只累加提供方上报的数**：不估算、不外推；`totalTokens` 缺席时用三桶相加补齐（并在桶上标 `totalDerived: true`），**绝不**把估算值混进上报值。
2. **中断不计**：`interrupted === true` 的条目整条跳过（连归属也不记）。
3. **非模型消息不记**：`source.kind !== 'model'` 跳过。
4. **纯函数、无时钟**：fold 只吃事件数组，时间戳由调用方注入（可测性）。
5. **有界**：`mismatch` 环形 ≤ 32 条；`buckets` 上限 = 注册的 provider/model 数（实际 ≤ 十几个）。

## 4. 路由生效判据（本稿的核心）

### 4.1 对照什么

- **决策侧**：`KimiRouter` 在 pre-step 算出 `decision.target`（route 决策），已由 `onDecision` 按 agent 存在 `latestDecisions`。
- **真实侧**：`assistant/message.source.{provider,model}`。
- **配对**：**按 `(turn, step)` 配对，不是按 `turn`**。
  - **实读形状**（2026-09-15 校正）：`turn/start` 带 `turn`、`step/start` 带 `{turn, step}`、`assistant/message` 带 `{turn, step}`，而 **`request/header` 两个都不带**（`data = {header, reason}`）⇒ 必须按**事件序游标**把它归到当前 `(turn, step)`。
  - **为什么这条是硬要求**：一个 turn 里可以有几十个 step，而**每个 step 都可能路由到不同目标**（工具轮尤其如此）。按 turn 配对会把「同一轮里模型换了」误报成「路由没生效」——**离线验证的第一版就是这么误报 6 次的**（见下）。
  - 同一步内若出现多个不同目标/来源（aux 调用、判官调用等），单独归类为「多目标步」，不直接判失败。

### 4.1b 离线预验结果（2026-09-15，只读扫描，**支撑本判据成立**）

在**现网会话日志**上把这条判据跑了一遍（最近 48 小时、116 个会话、1921 个已解码事件）：

| 口径 | 结果 |
| --- | --- |
| 按 **step** 配对（本稿口径） | 可判定 **212** 个 step：**目标一致 212 · 不一致 0** · 无归属 6（无 assistant 产出的步） |
| 同步内多目标 | **0** |
| 按 **turn** 配对（错误口径，仅作对照） | 可判定 186 轮：一致 180 · **不一致 6**——6 条全部是「同轮多步换了目标」的假阳性 |

**两条结论**：

1. **判据在现网不响 ⇒ 它的正确角色是「回归哨兵」而不是「找活 bug 的工具」**：当前 `agent/request` 的替换（`prepend: true`）确实让请求头与真实服务方一致。它的价值在于**任何一层重新开始改写模型选择时立刻现形**——历史先例正是 `dsh-host-apiproxy` 的 `installModelSelection` 覆盖过路由返回值（0.6.0 验收实锤）。
2. **它测的到底是什么（必须诚实写清）**：请求头与 `assistant/message.source` **都源自同一次请求**，所以「二者一致」并不等于「路由按用户的规则选对了模型」，而是等于「**在请求头写成之后到适配器作答之前，没有第三方把模型换掉**」。这正是本判据承认的边界——它验的是「决策落地没被打断」，不是「决策本身合不合你意」（后者由 dock 决策原因串负责）。

### 4.2 判定与措辞

| 情形 | 判定 | 展示 |
| --- | --- | --- |
| 该步请求目标 == 实际 source（集合相等） | ✅ 一致 | 不产生记录（零噪声） |
| 不等且决策 `via:'rule'/'explicit'` | ❌ **路由未落地** | 决策串追加注记「实际由 `p/m` 作答（与决策不符）」；账本 `mismatch` +1 |
| 不等且决策 `via:'default'` | ⚠️ 打底被改（可能是宿主模型选择覆盖、也可能是用户手动换模型） | 同上，但措辞标「打底被覆盖」 |
| 该步无决策（router 未挂载 / keep） | 不判 | 只记账 |
| 该步无 assistant/message（中止/失败） | 不判 | 只记账（离线预验里 6/218 属此类） |

### 4.3 与既有可观测性的关系

决策原因串（`DecisionSummary.reason`，≤120 字）是**既有**的显形面；本判据**追加**在它后面，复用 `withConfirmNote` 的同款前置/截断纪律（注记必须短）。**不新增会话事件类型**（§2 非目标）。

## 5. 落点与改动面（预估）

| 文件 | 改动 |
| --- | --- |
| `src/usage-ledger.ts`（新） | 纯函数 fold + `MismatchRecord` + 归并/排序 + 单价换算（可选） |
| `src/router.ts` | `session/event` 监听里把 `assistant/message` 的 `usage`/`source` 喂给账本（**注意**：现有类型标注把这两个字段裁掉了，需扩宽）；`onDecision` 侧记录「本轮决策 target」供配对 |
| `src/index.ts` | 面板快照新增 `usageLedger`（走既有命令通道，零持久化） |
| `src/types.ts` / `src/projection.ts` | 面板快照类型扩展（若走投影则加 zod 单元；v1 倾向**只走命令通道**） |
| `src/client/TideDock.tsx` | 本轮用量行（跟随命中目标 + 归属一致/不符标记）；总览层加「本轮账」一行 |
| `src/client/SettingsCard.tsx` + `help-content.ts` | 新增「用量」区（第八/九分区），并把「归属 = 判据」讲清 |
| `docs/…` | README 双语对、CHANGELOG、router.md、说明页内容源 |

**配置面（拟定：只留一个总开关，缺省开）**：本稿**不引入价格**（用户 2026-09-15 裁定「只报 token，不算钱」）⇒ 无字典型配置、无 schema 往返风险。

```yaml
kimi-tide-router:
  usageLedger:
    enabled: false   # 缺省 true；置 false 关闭账本与归属判据（逃生阀）
```

**为什么默认开**：账本是**纯内存 fold + 只读展示**，不写会话日志、不改路由决策、不产生调用 ⇒ 与「新特性缺省关闭」那条纪律（`hitConfirm`/`flows` 都缺省关）不冲突，因为那条纪律防的是**行为突变**；本项对路由行为零影响。`enabled: false` 作为逃生阀保留。

**时间窗（裁定）**：**只本会话**，跟 agent 生命周期；不做跨会话累积（跨会话要选落盘点，属 v1.5 另议）。

## 6. 未决（实施前需裁定）

1. ~~要不要钱~~ ⇒ **已裁定：只报 token，不算钱**（2026-09-15）。价格分支与单价表**从本稿移除**；若日后要钱，另立规格（届时要先解决「价从哪来」）。
2. ~~账的时间窗~~ ⇒ **已裁定：只本会话**。
3. **每条规则的账**：把 `turn → 当时生效的 ruleId` 也记下来，才能答「哪条规则在烧钱」。**本稿按「记」设计**（决策侧本来就有 ruleId，边际成本为零），但 UI 先只按模型聚合。
4. **C 组怎么落**：用户裁定的 C 是「用量/成本接回路由决策」。**只报 token 的形态下，C 的自然落点是「拿真实 cacheRead 占比当决策信号」**——缓存命中率高的目标是真便宜，而这一点此前完全没有数据。本稿**只做数据采集与展示**（够 C 用），**不做**依据它自动改道（那需要明确的策略与阈值，另议）。
5. **实施顺序** ⇒ **已裁定：一次做完，判据优先**（见 §5 顺序）。

## 7. 验收面（实施后）

- **A1 一致不报**：正常一轮（决策 = 实际）⇒ 决策串无注记、mismatch 为 0。
- **A2 不符即报**：构造一轮「决策说 A、实际是 B」（单测注入 + 实机用 `@` 覆盖或手动换模型）⇒ 决策串出现注记、账本计数 +1。
- **A3 中断不计**：`interrupted: true` 的消息不进账。
- **A4 零持久化**：反复取面板不产生会话日志写入（沿用既有「取数零副作用」用例）。
- **A5 存量零突变**：未配 `usageLedger` 时与 v1.3.0 行为逐字节一致。
- **A6 实机归属**：真机跑一轮 `@` 指定目标，账本归属显示该目标；再手动切模型跑一轮，账本报不符。
- **A7 价格（若采纳）**：填入单价后金额与手算一致；清空单价后回落到只报 token。

## 8. 风险与已知坑

- **配对口径错了会大面积误报（已实测）**：按 `turn` 配对会把「同轮多步换模型」全判成不一致——离线验证第一版在 186 轮里误报 6 次（3.2%），按 step 配对后 212 个 step 全部一致。**实施时这条要落成测试**（构造一个「同轮两步不同目标」的夹具，断言不产生 mismatch）。
- **「一致」不等于「选对了」**（§4.1b 结论 2）：本判据验的是「请求头写成之后没人换模型」，不是「规则选得合你意」。别把它当路由质量的唯一判据。
- **`assistant/message` 与「计费尝试」不是一对一**：宿主对空内容消息也写该事件（`dsh-session` 源码注释：`empty-content assistant/message (which exists only to host usage)`）⇒ 聚合按「有 usage 就算一次尝试」，不做「一步一次」的假设。
- **重试**：`llm/retry-started` 会另计一次（token-meter 文档明示）⇒ 本稿按事件条数计，不做去重。
- **长期开销**：长会话事件多，fold 必须 O(n) 且只保留桶（不保留明细）。若日后要「按轮查看」，需另立有界环形。
- **与 projection 的关系**：宿主已有 `tokenUsage` 投影；本稿不重复注册同名键（会撞），只在自己的命名空间里记「归属维度」。若最终改为投影路线，必须先实读 `sessionProjections.register` 的键冲突语义。

## 9. 文档与发布面（实施后同批）

README 双语对（同提交硬规则）／CHANGELOG v1.4.0 节／说明页新增分区／`router.md` 新节（归属判据的语义与局限）／`docs/release-evidence.md` 验收清单／`scripts/check-*` 四门禁。
