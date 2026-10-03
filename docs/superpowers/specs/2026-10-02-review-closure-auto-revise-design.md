# 评审闭环：自动修订与一键退回 — 设计稿（v1.4.0 候选）

> 状态：**已实施（2026-10-03，代码面）——实机验收待跑**（真宿主 web profile：干一件活 → 判「不通过」→ 点「让它重做」→ 主模型按意见重做 → 面板留痕且会话日志可读；再验自动模式）。实施记录见文末 §8。
> 版本归属：**v1.4.0**（新特性面 ＋ 一处"UI 承诺了不存在的行为"的真 bug 级修复）
> 口径绑定：~~**实现前 README 不得写「自动退回重做」**——当前双语 README 已如实标注"仍在规划中"；**实现落地后须同批更新双语 README ＋ CHANGELOG「未发布」节**~~ → **已履行（2026-10-03）**：双语 README 的「自动修订＝尚未实现」已改写为真实行为，CHANGELOG 增「未发布（v1.4.0 候选）」节。
> 派发口径（2026-10-02 全局规则）：本设计由 DSH 主会话出稿；**编码实现一律派子代理**，DSH 只做规格／派活／验收／落库
> **用户裁定（2026-10-02 20:2x，两项）**：①**「有条件通过」也触发**自动修订（**确认**本稿默认）②`flows.review.recheck` **默认开**（**改**本稿原定的 `false`）——见 §3.5／§4／§6
> **⚠ 口径变更（同日稍后，用户口述）**：实现口径改为「**优先由 VS Code 内的 DSH 会话直接改代码**（人可实时看 diff／审批），**派子代理降为兜底**」——本稿 §7 的"派发"字样按新口径理解；规则本体 §四.3 的改写待用户确认

## 1. 背景与现状（取证：2026-10-02 实读，非推断）

**病根：`autoRevise` 是死开关——设置页有复选框、说明页写着「自动修订」，但全代码没有一处运行时消费者。**

- 全仓引用 8 处，逐处实读：
  - `config.ts:77`（类型字段）／`config.ts:179`（默认 `false`）
  - `settings-schema.ts:59`（`Schema.boolean()`，可存可校验）
  - `client/SettingsCard.tsx:398-400`（**可勾可存的复选框**）
  - `client/help-content.ts:62`（说明页字段清单）
  - `commands.ts:271`（`/kimi-tide show` 会显示「自动修订」）
- **评审编排只有"单发一条路"**：`router.ts:1075 finishReview` → `review.ts:71 createReviewRunner`（`AbortSignal.timeout(60s)`、单段 `REVIEW_INPUT_LIMIT = 12_000` 截断）→ 评审事件卡。
  **无任何分支读 `autoRevise`、无 steer 回主模型、无复检。**
- 客户端除设置页那个复选框外，**没有"让它重做"入口**。
- 宿主接口已核实可用：`agent.steer(message: UserMessage): void`（`@deepseek-ai/dsh-agent` 的 `runtime-types.d.ts:200`）。

## 2. 目标 / 非目标

**目标**
1. 评审判「**不通过 / 有条件通过**」⇒ **按意见让主模型修订**（**默认关闭**，须显式开启）
2. 提供**手动一键退回**（不依赖开关，任何评审卡上都能点）
3. 可选**复检**：修订完成后再评一轮
4. 四条护栏齐备：**防环**、**配额**、**终止**、**可回滚**

**非目标**
- 不做 **Q10** 转移效率对照实验（另立项；本项落地后可作为其"产品自身跑"的载体）
- 不改路由语义／候选池／图像转述流
- 不做跨会话评审、不做评审意见的自动执行（只退给主模型）

## 3. 设计

### 3.1 两个入口
| 入口 | 条件 | 通道 |
|---|---|---|
| **自动修订** | `flows.review.autoRevise === true` 且评审 `ok:true` 且结论判为「不通过／有条件通过」 | 编排侧分支（§3.2） |
| **手动退回** | 用户在评审卡上点「让它重做」 | 客户端 → 宿主命令（沿用 1.1.0 手动评审钩子 `deps.onManualReview` 同款通道；实现时按实际形状接线） |

### 3.2 修订怎么起（**唯一采用**：`agent.steer`）
- 注入一条 **user 消息**：`〔评审意见（摘要，含严重度）〕＋〔修订指令：只改被指出的问题，不要重写无关部分〕`，随后由宿主轮循环正常起新一轮。
- **不采用**插件侧自建 `ctx.llm.stream` 的"伪修订轮"：那会脱离宿主轮语义（无 `user/message` 记录、投影与用量归属都对不上）。
- **时序**：评审发生在 `agent/turn-stopping`（轮已关闭）⇒ steer 起的是**下一轮**，需在投影与卡片上标明"上一轮产出的修订"。

### 3.3 结论解析（**保守优先**）
- 判据：取评审文本**最后一行**的结论词；命中 `不通过`／`未通过`／`有条件通过`／`需要修改`（含常见英文变体 `fail` / `reject` / `conditional`）→ 触发；
- **解析不出＝不触发**（不猜）；解析结果写入事件载荷，便于事后对账。

### 3.4 防环 / 终止 / 幂等
- **上限**：复用 `flows.review.rounds`（1–3）作为修订轮上限；每会话记 `reviseCount`，**达上限即停**，事件卡标「已停（达上限）」，并把最后一轮评审结论一并呈现。
- **幂等**：以 `turn` 号为键——同一轮只允许一次自动修订（手动退回不受此限，但同样计上限）。
- **不停机保护**：评审自身 `ok:false`（超时/空输出）时**绝不触发修订**。

### 3.5 配额护栏
- `autoRevise` **默认 `false`**（保持现值）；开启时设置页在该项旁显示"每轮最多 N 次修订，会额外消耗评审与主模型配额"。
- **`recheck` 默认开**（用户 2026-10-02 裁定）⇒ **每次修订会多一次评审调用**（评审 + 主模型各一轮）；该追加开销**同样受 `flows.review.rounds` 上限**约束，不会无限增长。设置页需同时明示这一项的影响。

### 3.6 留档与可回滚
- 修订前的主模型产出**已由宿主会话日志留档**，插件**不删改任何既有产物**；
- 新增事件 `kimi-tide/review-revise`（字段：`turn` / `reason: 'auto' | 'manual'` / `verdict` / `reviseIndex` / `at`），与会话日志同批落盘，供回看与对账。

### 3.7 事件与投影
- `projection.ts` 增加该事件类型的投影载荷；客户端卡片渲染一行「↩︎ 已按评审意见退回重做（第 k 次）」＋该次评审结论摘要。

## 4. 配置与 schema

| 键 | 现状 | 本次 |
|---|---|---|
| `flows.review.autoRevise` | 已存在（`boolean`，默认 `false`） | **语义落地**（形状不变） |
| `flows.review.recheck` | 无 | **新增** `boolean`，**默认 `true`**（用户 2026-10-02 裁定）——修订后再评一轮；同样受 `rounds` 上限约束（**每次修订多一次评审调用**，见 §3.5） |

**无 schema 迁移**（未新增必填项；旧配置原样可用）。

## 5. 验收判据

**单测（新增，TDD：先红后绿）**
1. 结论解析表：通过／有条件通过／不通过／无结论／英文变体／结论出现在正文而非末行
2. `autoRevise=false` ⇒ **零 steer**
3. `autoRevise=true` ＋ 不通过 ⇒ **恰一次** steer，且注入文本含评审意见摘要
4. 达 `rounds` 上限 ⇒ 停，且后续不通过不再 steer
5. 评审 `ok:false` ⇒ 不 steer
6. 幂等：同一 turn 重复投递只修一次
7. 手动退回路径：命令可达、无开关也生效、同样计上限

**门禁**：`npm run typecheck` 0 错 · `npm test`（现 700+）全绿 · `npm run check`（三脚本）exit 0 · `npm run build` 双端过

**实机验收（真宿主，web profile）**：干一件活 → 评审判「不通过」→ 点「让它重做」→ 主模型按意见重做 → 面板留痕且会话日志可读；再验一次自动模式（开启 `autoRevise`）。

**文档**：双语 README 同 commit 去掉"规划中"表述；CHANGELOG 增「未发布」节。

## 6. 风险与未决

| # | 风险 | 处置 |
|---|---|---|
| R1 | 结论解析靠自然语言，可能误判 | 保守：解析不出不触发；判据可单测穷举；误触发只多花一轮 |
| R2 | steer 发生在轮关闭后，可能与宿主下一次 `pre-step` 抢时序 | **实机先跑最小回路**，必要时在 `pre-step` 加"本次轮由修订发起"的标记位 |
| R3 | 修订消耗配额（评审＋主模型各一轮） | 默认关 ＋ 上限 `rounds` ＋ 设置页明示 |
| R4 | 手动退回入口跨"客户端→宿主命令"两层 | 复用 1.1.0 手动评审钩子通道，避免新造 RPC |

**已裁定（用户 2026-10-02 20:2x）**：①「有条件通过」**也触发**自动修订 ②`flows.review.recheck` **默认 `true`**（修订后复检一轮；开销见 §3.5）。

**仍未决**：③「修订触发的 §3.2 时序」需实机验证（R2）——设计不改，验收时先跑最小回路。

## 7. 施工切分（派发用，写入范围互不重叠）

| 任务 | 落点 | 产出 |
|---|---|---|
| **T1** | `src/review.ts` ＋ 新增 `src/review-verdict.ts`（＋ 单测） | 结论解析纯函数 + 单测 |
| **T2** | `src/router.ts`（编排分支、计数、上限、手动钩子接线） | 自动/手动两条路径打通 |
| **T3** | `src/projection.ts`、`src/client/**`（卡片 + 按钮 + help-content） | UI 入口与留痕 |
| **T4** | `README.md`、`README.en.md`、`CHANGELOG.md` | 文档同批（双语 + 未发布节） |

**写入范围红线**：仅 `packages/dsh-kimi-tide/**` 与本 spec；**不碰** `docs/agents/**`、`.github/workflows/**`、`scripts/check-*.mjs`。

## 8. 实施记录（2026-10-03，本会话直改代码）

**口径**：用户 2026-10-03 确认「就是当前这个 DSH 会话直接改代码」——未派子代理。

**四任务落点（写入范围与 §7 一致）**

| 任务 | 落地 |
|---|---|
| **T1** | 新增 `src/review-verdict.ts`（`parseReviewVerdict` / `isRevisableVerdict` / `verdictLabel` / `verdictOf`）；`src/review.ts` 加修订注入面（`buildReviseInput` / `createReviseMessage` / `isReviseMessage` / `REVISE_SOURCE_KIND`）＋ `ReviewEventPayload.verdict` ＋ `ReviewRevisePayload` |
| **T2** | `src/router.ts`：`consumeReview`（自动分支）／`issueRevise`（唯一退回通道：幂等·上限·留痕·终止）／复检队列（`agent/turn-stopping` 消费）／`onManualRevise` 登记；`src/rules.ts` 加 `latestUserMessage`（修订轮跳过评审武装的判据）；`src/commands.ts` 加 `/kimi-tide revise` |
| **T3** | `src/projection.ts` 加 `kimi-tide/review-revise` 投影 unit（含 `SessionEventMap` 增强）；`src/types.ts` 加记录/投影类型；`src/client/ReviewCard.tsx` 加**结论标签** +「**让它重做**」按钮 + `reviseNodeDefinition`/`ReviewReviseCard` + `reviewReviseBridge`；`src/client/index.ts` 注册两个 Definition 与两个 keyed 渲染器、接线命令通道；`src/client/styles.ts` 加退回卡与按钮样式；`src/client/SettingsCard.tsx` 加「修订后复检」复选框 + 配额提示；`src/client/help-content.ts` 加字段/FAQ/命令条目；`src/index.ts` 注册第三类会话事件、接线 `onManualRevise`/`onReviewRevise`、注册退回投影 unit |
| **T4** | `README.md` / `README.en.md`（「自动修订＝尚未实现」→ 真实行为 + 退回语义 + 成本 + 四道护栏）、`CHANGELOG.md`（「未发布（v1.4.0 候选）」节） |

**相对本稿的实现增补（三处，均为把设计落到实处所必需）**

1. **`ReviewEventPayload.verdict`（§3.3「解析结果写入事件载荷」的字面落地）**：在 review runner 推送侧解析一次并落库；旧日志无该字段 ⇒ 读侧（投影 schema / 卡片）容忍缺席。
2. **`ReviewRevisePayload.stopped: 'limit'`（§3.4「达上限即停，事件卡标已停」的载体）**：超限时**不 steer**、只落一条 stopped 留痕，卡片渲染「已停（达上限）」。
3. **手动退回不做结论闸**：自动分支严格按 §3.3 判据（含「有条件通过」），而**人工**「让它重做」是用户显式命令——判「通过」也允许返工（注入文本如实带结论标签），只受上限约束。理由：人工入口的价值就在「评审没看出来的问题我也要退」。

**验收（代码面，2026-10-03 全部通过）**

- `npm run typecheck` 0 错；`npm test` **752/752 绿**（新增 46 例：`review-verdict` 20 · `review-revise-message` 5 · `review-revise` 14 · `ReviewCard.dom` 7）
- `npm run check` 三脚本 exit 0；`npm run build` 双端过
- 判据对照：§5 单测 1–7 各有对应用例（幂等/上限/失败不退回/手动路径/复检开关/修订轮不重复武装）

**未完成**：§5 的**实机验收**（真宿主 web profile 跑最小回路，R2 时序）——需在装了本插件的 web profile 里跑，设计稿判据不变。

### 8.1 独立只读复核与处置（2026-10-03，子代理静态复核）

复核输入 = 本工作树未提交快照（`src/router.ts` SHA256 `CEC456…1977`）；结论 6 确证缺陷 + 8 疑点 + 6 测试盲区。**逐条处置如下**（修完重跑：**770/770 绿**，typecheck 0；新增用例全部做过变异检验——把修复点改坏，对应用例必须红，3/3 命中后已回退）：

| # | 复核结论 | 处置 |
|---|---|---|
| F1 | 复检归属只看「轮号更大」⇒ 用户插话那一轮会吃掉标记、误评无关产出 | **已修**：身份闸收紧为「feed 确实见过本源注入且落在这一轮」（`reviseTurns`／`reviseInjected`），不匹配即丢弃不评；用例「复核 F1：用户插话那一轮不吃复检标记」 |
| F2 | 幂等键单槽、手动不写、跨流不区分 | **已修**：账本改 `Map<flowId, {turn,count}>`（分账）；`state.turn` 无论 reason 都写（手动仍不受幂等限制，但能挡住同轮迟到的自动评审）；用例「幂等跨 reason」+「按流分账」 |
| F3 | 「复检不受 autoRevise 约束 ⇒ 手动一次触发自动链」 | **驳回**：`consumeReview` 的 `req.flow.autoRevise !== true` 闸对复检评审同样生效（`router.ts` 自动分支唯一入口）。补反证用例「F3 反证：autoRevise=false 时复检判不通过也不再自动退」。**保留的代价说明**：手动退回同样会入复检（多一次评审调用）——这是 §3.5「recheck 默认开 + 每次修订多一次评审」的既定口径，设置页提示已写明 |
| F4 | 文案把会话级上限写成「每轮会话」；`stopped` 事件重复落同 `reviseIndex` 易误读 | **已修（文案面）**：设置页改「本会话该流最多修订 N 次（= 轮次上限，手动退回同计）」；`stopped` 卡明写「不再自动重做；结论全文见上一张评审卡」。`reviseIndex` 语义按注释 = 已用次数（含 `stopped` 标记即可辨读），不加字段 |
| F5 | 投影 schema 缺 `verdict`（zod strip）⇒ 结论字段在投影面丢失 | **已修**：`reviewRecordSchema` 补 `verdict: z.enum([...]).optional()`（旧记录缺席可容忍）；用例「verdict 随载荷留档——复核 F5」。同时删掉零生产的 `verdictOf`（死代码） |
| F6 | `buildReviseInput` 注释的「≤ REVIEW_INPUT_LIMIT」不成立 | **已修（注释）**：改为「上限只约束评审正文那一段，指令头另计」 |
| 偏离·解析 | 英文变体面窄、末行「无法通过」被判 pass | **已修**：补 `not approved`/`needs work`/`request(s) changes`/`changes requested` 与否定包裹（无法/不能/未能/没能/难以/尚未/暂不/不予/没有）通过；用例「否定包裹与英文变体补全」+「正文一种判词、末行另一种 ⇒ 只认末行」 |
| 偏离·终止呈现 | §3.4「把最后一轮评审结论一并呈现」未落地正文 | **部分采纳**：`stopped` 卡补「结论全文见上一张评审卡」指引（结论正文在同一会话流的评审卡上，不重复搬运） |
| 偏离·复检不计上限 | 「复检本身无计数闸」 | **确认无害**：复检次数 = 修订次数（每次修订至多一次复检），已被 `rounds` 上界夹住；§3.5 的「受 rounds 上限约束」按此理解成立 |
| 疑点 5 | `reviewEventWritable=false` 时的告警文案夸大 | **已修**：文案改为「无回读留痕，仅当次面板行」 |
| 疑点 6 | `onReviewRevise` 接线零测试 | **已修**：index-wiring 新增端到端用例（手动评审 → 手动退回 → `/kimi-tide panel` 的 `lastFlowEvent` 出现 `revise:review … 第 1 次`） |
| 疑点 8 | `recheck` 无 default 的往返性质无用例 | **已修**：settings-schema 新增「无该键往返不注入 / 显式 false 存活 / 非布尔拒绝」 |
| 疑点 1/2/3/4/7 | `agent.steer` idle 语义、`pre-step.messages` 组成、两处 turn 同源、slot props 是否带 `sessionId`、桌面线 arity 措辞 | **未修（不可静态证实）**：已升级为 §5 实机验收的**必录项**（见 `plans/2026-10-03-review-closure-acceptance.md` §A0） |
| 判据 4/6/7 测试盲区 | 上限账目、"假绿"幂等、手动边界 | **已补**：rounds=2 手动连点第三次被拒（`reviseIndex` 序列 [1,2]）、幂等跨 reason、判「通过」也允许手动退、手动评审（turn:-1）后复检落在修订轮的基准取值 |
