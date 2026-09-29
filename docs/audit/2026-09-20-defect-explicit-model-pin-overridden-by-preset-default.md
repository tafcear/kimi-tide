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

---

## 七、处置（2026-09-20 维护者裁定并实施）

> 本节写于 §五「处置建议」之后：**§五 是裁定前的建议，实际处置以本节为准。**

### A 部分：删规则（已执行）

- **裁定**（维护者原话）：「删掉，自动评审不这样做，先删」；同类死规则「一并删掉」；评审流「连评审流一起关」。
- **执行**（`~\.dsh\settings.yaml`）：
  1. 删 `capability` 预设的 `review-k3` 规则块；
  2. 删 `saving` 预设的 `rule-2`（同类：`review` 组 ⇒ `deepseek-flash`，同样被认领抑制）；
  3. `flows.review.trigger`：`keywords` → **`manual`**（取值域 `manual|keywords`，见 `src/config.ts` 的 `ReviewFlow` 定义；出厂默认即 `manual`，见同文件 `DEFAULT_FLOWS()`）。
- **改前备份**：`vibe-coding\kimi-tide\_k3-handoff-verify\settings.yaml.bak-20260920`（5,603 B，三处原样可回滚）。
- **复核（非口说）**：删后 `python -c "yaml.safe_load(...)"` 解析通过；实测 `capability.rules=['rule-3']`、`saving.rules=['code-kfc']`、`flows.review.trigger='manual'`。
- **即时性边界**：宿主把配置持在内存中，**本次未实测文件改动能否热加载** ⇒ 标记「机制上应生效，未实测」。

### ★ 一条必须知道的后果（本批最容易被忽略的一点）

**「删规则」与「关评审流」各自都足以让 `review-k3` 复活，而这次两件一起做了。**

`review-k3` 出厂就在 `capability` 预设里（`src/config.ts` L152），它之所以是死规则，**唯一原因是评审流的 `trigger:keywords` 认领了同一个组**。把 trigger 改回 `manual`（或只改 trigger、保留规则），该规则**立刻恢复生效：审查词 ⇒ `kimi-coding/k3`**。

- 现行组合（规则已删 ＋ trigger=manual）⇒ **审查词轮不再改道，落预设默认 `deepseek-flash`**。
- 若本意是「审查类工作要跑 K3」，正确形态是**保留规则 ＋ trigger=manual**；恢复＝把那段规则粘回（backup 有原文）。

### B 部分：B-1a ＋ 覆盖时留痕（已实施）

- **裁定**：「B-1a ＋ 覆盖时强制留痕」。
- **实施**（`packages/dsh-kimi-tide/src/router.ts`）：
  - 新增 `delegationDepthOf(agent)`（读子会话 header 的 `delegationDepth`，防御性读取——根 agent 与旧测试夹具恒 0）与 `shouldKeepExternalTarget(decision, incoming, agent)`（纯函数判据）。
  - `agent/request` 钩子：**打底**（`via:'default'`）∧ **委派子代理**（`delegationDepth > 0`）∧ 传入目标 ≠ 打底目标 ⇒ **保持传入目标不改道**，并经既有 `withConfirmNote` 把「打底让位：外部显式目标 X（≠预设默认 Y）」写进**决策摘要**（面板可见）与 `ctx.logger.info`。
  - 覆盖侧留痕：打底确实换掉了一个不同的传入目标时，日志行追加「（覆盖外部目标 X）」——过去这件事在决策串里是隐去的（打底按既有语义不上报面板）。
  - **图像护栏位置不变**：让位后仍过护栏（带图步不得落到纯文本目标）。
- **测试（RED → GREEN 双证）**：`test/router-wiring.test.ts` 新增 4 例。修复前第一例**实测红**：`expected {provider:'deepseek-official',model:'deepseek-v4-flash'} to deeply equal {provider:'kimi-coding',model:'k3'}`——**与实机症状逐字对应**；实施后 4/4 绿。
- **保护边界（刻意写死）**：**主会话行为逐字节不变**——会话级模型选择本来就是预设要覆盖的对象（spec §5.1 未命中⇒预设默认）；把主会话一并保护会把打底整体废掉（该冲突已在实施前呈报，维护者选 B-1a）。

### 回归钉住（交接单待办 7，已实施）

- **★ 本轮新发现（比本单原判断更重）**：`review-k3` **不是用户手写的规则，而是出厂默认**（`src/config.ts` L152，`capability` 预设第 2 条）；出厂默认的评审流是 `trigger:'manual'`（`src/config.ts` L177），两者本来相安无事。**把这个 trigger 改成 `keywords`（一个看起来纯粹的"自动化增强"开关）就足以把出厂规则打成死规则** ⇒ **出厂默认的两件产物互斥，且互斥后果静默**。这已经不是"配置写错"，而是**产品级缺陷**；只靠规则列表里的 `kt-claimed-hint` 小字提示不足以兜住（用户不翻到那一页就永远看不见）。
- **实施**：`src/rules.ts` 新增 `claimedGroupRuleConflicts(config)`（有认领 ⇒ 逐条列出会被抑制的预设规则＋**所属预设名**）；`src/client/SettingsCard.tsx` 在**改 trigger 的那一行**当场列出「本流认领该组后，下列预设规则将不再参与路由：review-k3（能力）」。
- **测试**：`test/rules.test.ts` 3 例（出厂默认零冲突／改 keywords 后逐条点名／v4 与"认领无人用的组"不误报）＋ `test/SettingsCard.dom.test.tsx` 1 例。**变异探针已跑**：把注记 JSX 关掉（`false &&`）⇒ 该例**实测红**；还原后绿（证明用例有守护力，非空绿）。

### 验证证据（2026-09-20 现场实测）

- `npx vitest run` ⇒ **40 files / 699 tests 全绿**（本轮 +8：B-1a 4 ＋ 冲突 3 ＋ DOM 1）。
- `npx tsc -p tsconfig.build.json --noEmit` ⇒ **exit 0**。
- `npm run build`（host + client）⇒ **exit 0**；产物核对：`lib/router.js` 含让位逻辑、`lib/rules.js` 含新函数、`lib/client.js` 已重出（172,210 B）。
- ⚠ **生效条件**：插件经符号链接 `~\.dsh\profiles\web\node_modules\dsh-kimi-tide` → 本仓 `packages/dsh-kimi-tide`，宿主加载 `lib/` ⇒ **改动要生效须重启 `dsh web`**（本次未重启：重启会终止发起它的会话）。

### 未办（如实登记）

- ✅ **GitHub issue 已建（2026-09-28 补记，本条闭环）**：[tafcear/kimi-tide#6](https://github.com/tafcear/kimi-tide/issues/6)「缺陷：派发时显式指定的 provider/model 被预设「打底」静默改写（含 review-k3 死规则）」，label `bug`；正文含对照探针表、源码级根因、A/B 处置与验证证据，并显式登记「`review-k3` 之死只因为评审流认领同组 ⇒ 若本意是审查跑 K3 就保留规则 + trigger=manual」这条后果。（原阻碍 `gh` 认证已于 09-22 修复；本单待办 6 就此办结。）
- **可观测面只补了"让位/覆盖"两处**：本单待办 4 设想的"派发时记录请求模型 vs 实际落点"的**可查面**（可查询、不靠手工解码）未做——B-1a 后"请求 ≠ 实际"已只发生在主会话（设计使然），优先级下降，留待维护者定（已在 issue #6 「后续待定」节登记）。
- ✅ **已随 v1.3.1 发布（2026-09-28 补记）**：本修复原为"未发布"（无版本号变更、未打 tag）。现已随 **v1.3.1** 发布（[Release](https://github.com/tafcear/kimi-tide/releases/tag/v1.3.1)，含 700/700 测试数与 B-1a 行为变更的用户视角说明）；tag 消息即 Release 正文，双语四段式门禁通过。

