# 缺陷记录：派发时显式 provider/model 被预设「打底」覆盖 —— 兼 `review-k3` 死规则

> **日期**：2026-09-20 ｜ **来源**：交接单《2026-09-18-DSH-DSH-kimi-tide钉模型失效与review-k3死规则》接手执行
> **判定方法**：源码行号（一级）＋ 对照探针实测（一级）＋ 会话日志 `request/header` 解码（一级）。**不含模型自述、面板 chip、派发参数**（本仓库既有纪律：身份唯一判据＝`request/header`）。
> **两条结论各自独立**：缺陷 A 是**配置错误**（一行规则永不生效），缺陷 B 是**设计缺口**（外部显式指定的模型被覆盖）。**修 A 不修 B，用户当初报告的「钉 K3 不生效」仍会复现。**

---

## 一、结论

### 缺陷 A（配置错误 · 静默死规则）：`review-k3` 规则与评审流争用同一关键词组

`capability` 预设里有一条规则 `review-k3`：命中 `review` 词组 ⇒ 路由到 `kimi-coding/k3`。
而同一份配置的 `flows.review` 也以 `keywordGroup: review` 触发。按 1.1.0 §4 的**认领语义**（有意设计），被流认领的关键词组会**静态抑制**掉命中该组的规则：

- `rules.ts` L241-252 `claimedReviewGroups()`：`flows.*` 中 `type:'review'` ＋ `trigger:'keywords'` ＋ `keywordGroup` 非空 ⇒ 该组进认领集。
- `rules.ts` L199-203 `routableHits()`：命中认领组的规则**被过滤出路由链**。
- `router.ts` L346-393 `decide()`：规则链＝认领过滤后的列表。

⇒ **`review-k3` 永远进不了规则链。** 它仍留在预设规则表里（面板可见、可编辑、可试一句预测），但**从不生效**——配置界面与文档显示的"命中审查词升级到 k3"是一句空话。这是**配置错误**（把规则挂到了被流认领的组上），不是认领机制的问题。

### 缺陷 B（设计缺口）：`decide()` 的「打底」会覆盖任何**外部显式指定**的目标

`router.ts` L391-393 原文注释：

```
// 3. 打底：未命中 ≠ keep——路由到预设默认模型（0.5.0 语义，spec §5.1）。
```

即：**文本没命中任何规则 ⇒ 一律改写为「预设默认」**（本机 `capability` 预设默认 ＝ `deepseek-official/deepseek-flash`）。
而 `applyTo()`（L416-419）对**任何** `kind === 'route'` 的决策都执行 `replaceRoute()`（L427-439）——**包括 `via: 'default'` 的打底**，它无条件覆写 `provider`/`model`。

叠加两点，缺陷即成事实：

1. **这个钩子对每个 agent 的每一步都生效**：`installRouter` 在插件根 ctx 注册 `agent/pre-step` 与 `agent/request`（L705 / L899），**源码中不存在任何子代理豁免**（`src/` 全目录 grep `subagent` ＝ 0 命中）。
2. **它是瀑布最外层**：两个监听器都带 `{prepend: true}`（L898 / L923），且 L694-704 的注释明确记载这是为压过宿主 `installModelSelection` 而刻意为之 ⇒ **最终 provider/model 由 kimi-tide 决定**。

⇒ **workflow／subagent 派发时显式指定的 `provider`/`model`，只要该轮文本没命中 kimi-tide 的规则，就会被「预设默认」吃掉。** kimi-tide 的设计里，路由决策只由**消息文本**驱动（`decide(messages, step, hasImage)`），**它根本看不到"调用方已经点名了模型"这件事**。

---

## 二、对照探针（一级证据，2026-09-20 19:55 / 19:57 实测）

设计：**同一条派发路径、同一个显式 pin（`kimi-coding/k3`），只改提示词文本**，看落点是否随文本变化。

| # | 会话 id | 提示词 | 显式 pin | 实测 `request/header` | 结论 |
|---|---|---|---|---|---|
| 1 | `e1e2d348-e797-4b70-a02f-12fd3858f573` | 「请只回复四个字符：OK-1…」**零关键词组命中词** | `kimi-coding/k3` | **`deepseek-official/deepseek-flash`**（＝预设默认） | pin 被**打底**覆盖 |
| 2 | `e3c59ddd-ee12-4358-a504-f577ec3b4db4` | 「**@kimi** 请只回复四个字符：OK-2…」 | `kimi-coding/k3` | **`kimi-coding/k3`**（子代理回 `OK-2`） | 显式分支生效 ⇒ 落 k3 |

两次探针的子代理均由 `workflow` 的 `agent(prompt, {provider:'kimi-coding', model:'k3'})` 创建，会话日志中 `subagent/descriptor` 均为 `mode:'one-shot'` / `provider:'spawn'`。

**由探针 2 得到的三条硬结论**：
1. **显式 pin 确实到达了子代理**（否则不可能落 k3）——因为 spawn provider 声明并在创建窗口合并 `agentOptions`（`dsh-subagent-spawn-in-process/lib/index.js` L17-24，`capabilities.agentOptions: true`，注释「merged over the parent route」）。
2. **`kimi-coding/k3` 当前完全可用**（真实发出请求并正常返回 `OK-2`）。
3. **唯一变量是文本** ⇒ 覆盖行为的来源就是 kimi-tide 的 `decide()` 打底分支，不是宿主、不是 provider 不可用。

**探针 1 vs 探针 2 的最小差异**：探针 1 的文本让 `decide()` 走到 L391-393 的打底；探针 2 的 `@kimi` 让 `decide()` 走 L305-338 的显式分支（`via:'explicit'`，同样被 `applyTo` 应用）。**同一个 pin，两个结局——这就是缺陷 B 的直接实证。**

解码命令（可复跑；`zstandard` 必须 `read_across_frames=True`，否则只解首帧）：

```powershell
python "E:\BaiduSyncdisk\Data\vibe-coding\kimi-tide\_k3-handoff-verify\decode-probe.py" 3 `
  "C:\Users\tafce\.dsh\sessions\--E-BaiduSyncdisk-Data-vibe-coding-kimi-tide--"
```

### 附：交接单原始三次派发的独立复解（2026-09-20 由独立子代理重解，非同源复述）

| 会话前 8 位 | `request/header` 实测 |
|---|---|
| `31d4fccb` | `zai-coding-cn/glm-5.3`（＝`rule-3`／code 组，与观测一致） |
| `417a93c2` | `deepseek-official/deepseek-flash`（＝预设默认：review 词命中但规则被认领抑制 ⇒ 打底） |
| `33d71bab` | `deepseek-official/deepseek-flash`（＝预设默认：**显式 pin k3 被吃**） |

三者 `request/header` 各只 1 帧，另以「解压全文子串计数」第二口径复核，排除"只解首帧"假绿。

---

## 三、被排除的两条候选根因（交接单 §三 的 (A) / (B)）

- **(B) `kimi-coding` 本计费周期不可用 ⇒ 降级**：**排除**。探针 2 实测 k3 真实可用并正常返回；且「打底」这一支**根本不查询 kimi-coding 是否可用**（`decide()` L391-393 直接返回 `preset.default`）。`docs/release-evidence.md` L17 那句是**历史时点**记录，不能解释 09-18 的观测。
- **(A) 宿主 `installModelSelection` 在 agent 创建时覆盖 provider/model**：**机制存在，但不是有效根因**。该监听器（`@deepseek-ai/dsh-agent/lib/index.js` L133-177，L148 起）**不带 `prepend`**、且**先 `await next()` 再覆写** ⇒ 位于瀑布**内层**；kimi-tide 两个监听器均 `{prepend:true}` ＝ **最外层**，cordis 瀑布取**最外层监听器的返回值** ⇒ 宿主的内层覆写会被 kimi-tide 的返回值再覆盖一次。探针 2 即为证：宿主侧会话模型是 `deepseek-flash`，而实际落 `kimi-coding/k3`——**说明 kimi-tide 的决策才是最终值**。

> 交接单把 (A)/(B) 列为「尚未区分」的两条候选；本次实测表明 **两者都不需要**——漏掉的是第三条：(C) **kimi-tide 自己的打底分支就是覆盖者**。

---

## 四、影响面

1. **任何"派发时点名模型"的用法都会静默失效**：`workflow` 的 `agent(prompt,{provider,model})`、`subagent` 的 `agentOptions`、以及宿主会话级模型选择（`session.selectModel` / GUI 选择）——只要该轮文本没命中 kimi-tide 规则。
2. **失效是静默的**：面板决策摘要对「打底」**默认不上报**（`index.ts` L103-110：`via === 'default'` 且无 `confirmNote` ⇒ 返回 `null`）⇒ **用户看到的面板与真实落点不一致，且没有任何提示**。这与 v1.3.0 为语义闸补链的理由同源（注释 L98-101 自己写过：「判否这个最需要被看见的结果反而完全不可见」）。
3. **子代理身份记录会与实际不符**：continuable 子代理的 `subagent/descriptor.agentModel` 记录的是**路由前**的解析结果，`request/header` 记录的是**路由后**的实发值。本次交叉扫描 118 个会话：48 个带 `agentModel` 的 descriptor 中 **27 个与之自身 header 冲突，方向完全单一**（descriptor 一律 `deepseek-flash` → header 一律 `glm-5.3`）。⇒ **descriptor 不是身份证据**，本仓库"用 header 认身份"的纪律再次被印证（并给 R-NET-03 添一条实例）。
4. **`review-k3` 死规则会让用户与文档持续误判**：规则在设置页可见、可预测，`@kimi` 又能真的落 k3 ⇒ 极易得出"配置没问题"的结论。

---

## 五、处置建议（**待维护者裁定**；本记录不擅自改配置、不改行为语义）

**A 部分（配置错误，二选一；属宿主配置改动，须维护者点头）**

- **A-1** 删掉 `capability` 预设里的 `review-k3` 规则，承认评审词组由 `flows.review` 全权承接（评审流仍会在轮末以 k3 跑，只是**不改道本轮**）。
- **A-2** 保留"审查词 ⇒ k3"的路由升级：新建一个**不被流认领**的词组（如 `review-rule`），把 `review-k3` 改挂该组，并把词组内容与 `review` 对齐。代价＝多一份词表要维护。

**B 部分（设计缺口，方向待定；**建议单独立项走 spec**，因为它改的是 v0.5.0 以来的核心语义）**

- **B-1（最小、推荐先评估）**：打底只在「该 agent 没有外部显式目标」时生效——即 `agent/request` 里若发现 `resolved` 的目标 ≠ 预设默认（说明宿主/调用方已指定过），则降级为 `keep`。**保留规则命中仍可改道**（与 Q3「点了名就不静默改道」同源）。
- **B-2**：对**子代理**不打底（主会话行为不变）——需在插件内识别子代理（宿主已提供 `delegationDepth` / `origin:'subagent'` / `parentSession`）。
- **B-3**：加配置开关（如 `preset.defaultOnMiss: boolean`，默认保持现状），把选择权交给用户。
- 无论选哪条，**都应同时补一条可观测面**：打底若覆盖了外部显式目标，决策摘要与日志必须可见（沿用 v1.3.0 的 `confirmNote` 模式）。

**回归钉住（交接单待办 7，独立于 A/B 的选择）**：被 `flows.*` 认领的关键词组**不得**同时出现在预设规则里——建议在配置校验期报错或至少在设置页给出与 `duplicateRuleIds` 同款的警示。

---

## 六、证据边界（**未证事项，不许当结论用**）

- 会话日志**没有** `response/header`／served-model 字段（本次扫描 118/118 会话均无）⇒ **"远程 provider 实际由哪个模型生成"在日志层面不可证**。本记录主张的始终是**"请求侧配置"**。
- 缺陷 B 的**影响面**（第 4 节第 1 条）由「打底对任意 agent 生效 + 无条件覆写」推出，其中**子代理场景有两次探针实测**，**主会话 GUI 选择被覆盖的场景本次未单独实测**——标为**推断**。
- 探针 1 的子代理 descriptor **不含** `agentModel`，这是**结构性的**（`dsh-subagent/lib/index.js` L1393-1412：`mode:'one-shot'` 的 descriptor 只记 `version/mode/provider/label`），**不能**用它推断"pin 没到达"。本次之所以能定论，靠的是探针 2 的对照。
- 未做：未改任何宿主配置、未改 kimi-tide 源码、未跑测试套件、未建 issue（`gh` 认证失效）。
