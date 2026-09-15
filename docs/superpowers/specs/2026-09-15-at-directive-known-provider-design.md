# 显式 @指令误判面收窄设计（已知 provider 门控）v1.3.0

> 状态：**v1.1（2026-09-15，随 v1.3.0 并入）**——用户裁定「Q6 并入这一版，完成后再发」；**独立模型评审已完成**（glm-5.3，只读；落点经子会话 `request/header` 核实），**0 严重 + 2 中等 + 4 轻微，控制器逐条回源码复核全部属实、0 误报**，处置见 §8
> 版本归属：**v1.3.0**（与用量余额/说明页/语义闸同版；本项为行为修正，不新开特性面）
> 来源：`docs/superpowers/backlog.md` Q6；触发事件见 §1
> 前置：Q3（`5452713`）显式 @ 精确寻址三项、0.5.x 前导锚定词法（2026-08-23 评审修复）

## 1. 背景与现状（取证）

**触发事件**：用户提问「coding 的时候是谁在 coding，评审的时候为什么又变成了 glm」→ 核查发现 workflow 三个评审 agent 同传 `provider:'qwen-token-plan-cn', model:'qwen3.8-max'`，实际**只有一份**落在 qwen3.8-max，另两份落在 `zai-coding-cn/glm-5.3`。

**根因链（两步，均已实证）**：

1. **词法误判**：`explicitDirective`（`rules.ts:28-35`）的正则 `/(?:^|[^\w@])@([\w-]{2,20})(?:\/([\w.-]{1,64}))?/` 只做前导锚定，不看 `@` 后面是不是一个 provider。构建产物 `lib/rules.js` 实跑（2026-09-15）：

   | 输入 | 解析结果 | 判定 |
   |---|---|---|
   | `@kimi 帮我看这段代码` | `{provider:'kimi-coding'}` | ✅ 真指令 |
   | `@qwen-token-plan-cn/qwen3.8-max 你好` | `{provider:'qwen-token-plan-cn', model:'qwen3.8-max'}` | ✅ 真指令 |
   | `请读 node_modules/@deepseek-ai/dsh-session 的导出` | `{provider:'deepseek-ai', model:'dsh-session'}` | ❌ scoped 包名 |
   | `见 @README.md 的说明` | `{provider:'README'}` | ❌ 文件引用 |
   | `npm i @scope/pkg@1.2.3` | `{provider:'scope', model:'pkg'}` | ❌ scoped 包名 |
   | `文件在 E:\…\node_modules\@deepseek-ai\dsh\lib\index.js` | `{provider:'deepseek-ai'}` | ❌ 路径片段 |
   | `联系 user@example.com` | `null` | ✅ 邮箱已排除 |

2. **静默短路**：`router.ts:243-247` —— 解析出的 provider 在候选池里找不到任何模型时返回 `{ kind: 'keep' }`：

   ```ts
   if (pool.length === 0) return { kind: 'keep', reason: `explicit @${explicit.provider}: no available candidate` }
   ```

   `keep` = **不改写路由**，且……**整条规则链被跳过**（规则链在该分支之后才求值）。于是 `@deepseek-ai` 这种误判反而让"派发时请求的 qwen3.8-max"原样生效；而无 `@` 的两份正常命中 `code` 关键词组 → glm-5.3。**同一个 workflow、同一批参数，结果分裂成两种**——这正是本次事件看起来"随机"的原因。

**连带面**：同一判定还被另外三处复用，误判会一并扩散：

| 位置 | 现状 | 误判后果 |
|---|---|---|
| `router.ts:681` | `if (explicitProvider(turnText) === null)` 才跑语义确认闸 | 误判 ⇒ **跳过语义闸**（该问判官的一轮不问） |
| `rules.ts:214` | `reviewTriggerHit` 首句「未知 @ 一律返 null」 | 误判 ⇒ **评审流不武装**（该评审的一轮不评） |
| `rules.ts:286` | `previewRoute` 的 explicit 分支 | 误判 ⇒ 「试一句」显示与实际不符（且该分支**没有** keep，unknow provider 显示为 `target: null`） |

**为什么这是"面"而不是"点"**：本 Harness 的系统提示即把 `@` 前缀定义为**工作区路径引用**（`@文件`、`@"带空格 路径"`），与 kimi-tide 的路由指令**共用同一个符号**；本仓提示词里又大量出现 `@deepseek-ai/…`、`@earendil-works/pi-ai` 等 scoped 包名。⇒ **任何提到包名或 `@文件` 的轮次都会静默失去规则路由。**

## 2. 目标与非目标

**目标**：

1. **误判不再短路规则链**：`@` 后面不是本路由器认识的 provider 时，视同普通文本，规则链照常求值。
2. **判定单一实现**：四处调用点（`decide` / 语义闸 / `reviewTriggerHit` / `previewRoute`）共用同一判定函数，不各自复制（沿用 1.1.0 `routableHits`「单一过滤实现」的先例）。
3. **不静默**：被忽略的 `@x` 写进决策原因串，用户能在决策面板看到「这次为什么没按 @ 走」。
4. **真指令行为不变**：`@kimi`、`@deepseek-official`、`@qwen-token-plan-cn/qwen3.8-max` 等一切**已知 provider** 的显式指令，语义与 Q3 完全一致（含「已知但无可用候选 → keep」）。
5. **预演 = decide**：`previewRoute` 与 `decide` 的文本语义保持一致（仓库既有不变量）。

**非目标**：

- **不改 `explicitDirective` 的纯词法**（12 条既有回归测试守着邮箱/句中引用/中文前导等边界，词法本身没问题；问题是"谁有权判定这是指令"）。
- **不改 Q3 的精确寻址与池内确定化**（`pickExplicitTarget` 不动）。
- **不做「别名可配化」**（Q3 选项 B 的另一半，独立议题）。
- **不做请求期 403 兜底**（Q3 选项 D，独立议题）。

## 3. 机制设计

### 3.1 判定函数（`rules.ts`，新增）

```ts
/**
 * 显式 @指令的**有效形式**（v1.3.0 Q6）：只有 @ 后面的名字确实是本路由器认识的
 * provider（或别名）时才算指令。
 *
 * 为什么需要：词法层无法区分 `@zai-coding-cn`（真指令）与 `@deepseek-ai`（scoped
 * 包名）/`@README`（文件引用）——两者都是 `@[\w-]+`。**只有 provider 知识能判**。
 *
 * `known === null` 退化为纯词法结果（旧行为）——调用方拿不到 catalog 时不误伤，
 * 保证「取不到目录」这一降级路径不会把真指令判死。
 */
export function effectiveExplicitDirective(
  text: string,
  known: ReadonlySet<string> | null,
): { provider: string; model?: string } | null
```

**取「首个*已知*匹配」（实施期补充的裁定）**：遍历文本里全部 `@` 候选，返回**第一个 provider 已知**的那个，而不是只取词法首个。否则「见 `@deepseek-ai/x`，另 `@kimi` 帮我看」这类文本会被前面的包名吞掉真指令。`explicitDirective` 仍是「词法首个」的纯解析器（12 条回归测试不动），两者共用同一段尾段归一（`directiveOf`）与同一条正则常量（`DIRECTIVE_RE`），不复制。

并新增「预设已配置目标」的共享取值（`decide` 与 `previewRoute` 都要，避免两处各写一遍）：

```ts
/** 预设里被点名的 provider（default + 非流转规则目标）——「认识」的口径之一。 */
export function configuredProviders(preset: RouterPreset): string[]
```

### 3.2 「已知」集合的构造

`KimiRouter.knownProviders()`（新公开方法）：

```
known = { metas 全部 provider（含 available:false）}
      ∪ configuredProviders(激活预设的 default + 规则目标)     // 配置指向但目录暂缺也算"认识"
      ∪ { KIMI_PROVIDER }                                      // 插件内置别名 @kimi/@kimi-tide 恒定有效
```

**为什么含不可用者**：`metas` 里 `available:false` 的 provider 仍是"认识的"——`@zai-coding-cn` 在 key 缺失时应保持 Q3 的 `keep`（用户点了名，不静默改道），而不是被当成误判丢进规则链。

**为什么加 `KIMI_PROVIDER`**：`@kimi`/`@kimi-tide` 是插件定义的常量别名（`rules.ts:32`），不是 catalog 事实；若目录枚举失败导致 `metas` 为空，别名仍应可用。

`previewRoute` 侧：`known = catalog 的 provider 集 ∪ configuredProviders(preset) ∪ {KIMI_PROVIDER}`；`deps.catalog === null` ⇒ `known = null`（退化为旧行为，浏览器侧取不到目录时不误伤）。

### 3.3 四处调用点

| # | 位置 | 改动 |
|---|---|---|
| 1 | `router.ts:242` `decide` | `explicitDirective(text)` → `effectiveExplicitDirective(text, this.knownProviders())` |
| 2 | `router.ts:681` 语义闸 | `explicitProvider(turnText)` → `effectiveExplicitDirective(turnText, router.knownProviders())` |
| 3 | `rules.ts:214` `reviewTriggerHit` | 加第 4 个可选参 `known: ReadonlySet<string> \| null = null`；判据换 `effectiveExplicitDirective`；调用方 `router.ts:799` 传 `router.knownProviders()`、`rules.ts:350` 传 catalog 侧 known |
| 4 | `rules.ts:286` `previewRoute` | 同上判定；未识别 ⇒ 不返回 explicit 分支，继续走规则链 |

### 3.4 可解释性（方向 C）

`decide` 在「词法命中但被判为非指令」时记下 `ignored`，前缀进规则链各返回路径的原因串：

```
@README 非本路由器已知 provider（已忽略）· 规则「code-kfc」命中 2 词
```

被忽略的**只有 provider 名**（不回显原句），无注入面。

**`keep` 分支的原因串同步改中文**（原 `explicit @x: no available candidate` 中英混杂且不含"为什么 keep"）：

```
显式 @zai-coding-cn 无可用候选（provider 已知但当前无可路由模型）
```

## 4. 方向取舍（为什么不选另外两条）

| 方向 | 结论 | 理由 |
|---|---|---|
| **A′ 纯词法收紧**（要求 `@` 为独立 token / 约束 `/` 后段） | **否决** | 能挡 `@README.md`（后接 `.`）与 Windows 路径（后接 `\`），但**挡不住** `@deepseek-ai/dsh-session` 与 `@scope/pkg`——它们与 `@kimi/k3` 词法完全同形。本次事件的主因恰好是前者。 |
| **B 未知 provider 不短路**（`pool.length === 0` 时继续走规则链） | **被 A 吸收** | 加门控后，`pool.length === 0` **只可能**发生在"已知 provider 但无可用候选"——那正是 Q3 要保的 `keep`（不静默改道）。B 单独实施会把 `@zai-coding-cn`（key 缺失）也丢进规则链，**回归 Q3**。门控让 B 的意图（未知不短路）在更早、更准的位置成立。 |
| **A + C（本设计）** | **采用** | 用 provider 知识把"未知"挡在规则链之外，用原因串交代"为什么没按 @ 走"。 |

### 4.1 一处**有意的行为改变**（必须备案）

`test/router.test.ts:118-121` 现断言：

```ts
it('显式 @provider 无可用候选 → keep', () => {
  expect(r.decide([textMsg('@anthropic 你好')], 1)).toMatchObject({ kind: 'keep' })
})
```

`anthropic` 既不在 `METAS` 也不在预设配置里 ⇒ 新语义下判为**未识别**，走规则链（无关键词命中 → 预设默认 `deepseek-official/deepseek-v4-flash`，`via:'default'`）。

**这是有意的**：词法上 `@anthropic` 与 `@README` 完全同形，二者不可区分 ⇒ 必须在"误判时静默短路"与"真指令但 provider 未知时落打底"之间选一边。选后者，因为：

- `keep` 的语义是"保持会话当前模型"——对用户**不可预测**（取决于上一轮是谁），而打底是**可预测**的；
- 落打底的同时原因串写明「`@anthropic` 非已知 provider（已忽略）」，**不是静默**；
- 前者已在实机造成真实损失（本次三份评审两份错模型 + 署名错档），后者只是把"点了个不存在的 provider"降级为常规路由。

**配置指向的 provider 仍走 keep**（`configuredProviders` 入 known）——用户自己配过的目标不会因目录暂缺而失去显式语义。

## 5. 测试面

`test/rules.test.ts`：

- `effectiveExplicitDirective`：known 含该 provider ⇒ 返回指令（含 model 段）；known 不含 ⇒ `null`；`known === null` ⇒ 返回词法结果（降级不误伤）；非 `@` 文本 ⇒ `null`。
- `configuredProviders`：取 default + 非流转规则目标，流转目标不计入。
- `previewRoute`（`@` 误判面）：`见 @README.md 的说明，帮我重构这个函数` + catalog 无 README ⇒ `outcome.kind === 'rule'`（**不再**是 `'explicit'`）。
- `previewRoute`（真指令不变）：`@kimi 帮我看代码` + catalog 含 kimi-coding ⇒ 仍 `'explicit'`。
- `reviewTriggerHit`：`@README.md 帮我评审一下` + known 无 README ⇒ **返回评审流**（不再被抑制）；`known === null` ⇒ 保持旧抑制行为。

`test/router.test.ts`（decide 层）：

- `请读 node_modules/@deepseek-ai/dsh-session 的导出，帮我重构这段周报` ⇒ `via:'rule'`（**不是** `keep`），且 reason 含忽略说明。
- `见 @README.md 的说明，帮我重构这段周报` ⇒ `via:'rule'`。
- `@anthropic 你好` ⇒ `via:'default'`（§4.1 的有意变更，测试名与注释同步改）。
- `@kimi 随便聊聊` ⇒ 仍 `via:'explicit'`、仍 `k3`、原因串不变（守 Q3）。
- `@zai-coding-cn 你好`（METAS 无 zai、但配置指向）⇒ 仍 `keep`，原因串为新中文文案。
- 语义闸短路（**交付于评审修复波**，`router-wiring.test.ts` 新增 describe「语义闸前置短路 × Q6 已知 provider 门控」）：
  `@README.md` + `hitConfirm.enabled` ⇒ 闸**运行**（判官被调用一次、输入含 `code-kfc`）；`@kimi` 轮 ⇒ 判官**零调用**。
  判别力已用变异测试实证：把短路退回词法判定 ⇒ 该用例变红。
- 带图轮 × 未知 @（`router.test.ts`）：`[imageMsg, textMsg('见 @README.md 的说明')]` ⇒ image 规则仍 ∞ 优先，且原因串带忽略说明。
- 判否集 × 未知 @（`router.test.ts`）：`omittedRuleIds = {code-kfc}` + 未知 @ ⇒ 落打底，`noteHead` 不因走打底分支而丢失。

`test/router-wiring.test.ts`：pre-step 层同款断言（若既有夹具覆盖该路径）。

## 6. 验收（并入 v1.3.0 清单）

- **A9 显式 @ 误判面**：向会话发含 scoped 包名或 `@文件` 的消息（如「帮我看看 `@README.md`，顺便重构这个函数」）⇒ 解码 `request/header` 应为规则目标（省钱预设 = `zai-coding-cn/glm-5.3`），**不是**打底也不是 `keep`；决策面板原因串应出现「非本路由器已知 provider（已忽略）」。反向对照：发 `@kimi 你好` ⇒ 仍 `kimi-coding/k3`。
- **A6 复跑**（回归）：`@qwen-token-plan-cn/qwen3.8-max` ⇒ `qwen3.8-max`。
- 门禁：`npm test` / `typecheck` / `build` / `check-readme-sync` / `check-release-notes` 全过。

## 7. 风险与未覆盖

| # | 风险 | 处置 |
|---|---|---|
| R1 | **目录未就绪时误杀真指令**：`metas` 为空（枚举未完成/失败）⇒ 已知集合只剩配置指向 + `KIMI_PROVIDER`，`@某目录 provider` 会被判未识别 | 保守组合已降低概率（配置目标恒在集合内）；**未覆盖**：无法在本机构造"枚举失败"实机态，留验收观察 |
| R2 | 用户真要点一个本机没有的 provider 时，不再 `keep` 而是落打底 | §4.1 已定性为有意变更；原因串可见，非静默 |
| R3 | `reviewTriggerHit` 新增可选参的默认值（`null`）保持旧行为 ⇒ 忘记传参的调用点行为不变 | 两处调用点均已显式传参；`rules.ts:350` 传 catalog 侧 known |
| R4 | 原因串文案变更可能撞既有断言 | §5 已列受影响测试；全量 `npm test` 兜底 |
| R5 | 本项为**行为修正**，未做独立模型评审（v1.3.0 同批的另三项各有独立评审档案） | **已闭环**：用户裁定「补」⇒ glm-5.3 独立评审（0 严重 + 2 中等 + 4 轻微全属实），处置见 §8 |
| R6 | `previewRoute` 与 `decide` 的 known 集来自**两次独立拉取**（宿主 `enumerateCandidates` / 浏览器 `llm.models({})`），公式同构但刷新时序可瞬时分叉 | 评审轻#5；已在 `router.md` Q6 节声明该瞬态，A9 验收时对照「试一句」与实际决策；两侧降级不对称（客户端 `catalog == null` 退化词法）亦已声明。**未修**：需宿主活体才能核实两次拉取的过滤口径差异，本机无法构造 |
| R7 | `noteHead` 只交代**词法首个**未知 `@`，多未知时不逐一罗列 | 评审轻#4；**按设计保留**——成串 scoped 包名会让原因串变噪声；已写入 `router.md` Q6 节。显式指令命中时其余未知 `@` 不提示（真指令已生效） |

## 8. 独立模型评审处置（2026-09-15，glm-5.3）

评审方式：只读、结论以正文返回；落点经子会话 `request/header` 核实为 `zai-coding-cn/glm-5.3`（**派发参数不算数**——同日刚因署名错档吃过一次教训）。控制器逐条回源码复核：**6 条全部属实，0 误报**。

| # | 级别 | 问题（评审原话摘要） | 复核证据 | 处置 |
|---|---|---|---|---|
| 1 | 中等 | 语义闸调用点（`router.ts:709`）**零测试覆盖**，spec §5 承诺未兑现；回退成词法判定不会红 | 全 test 目录 grep `hitConfirm` 仅命中 schema/UI 两处，无 installRouter 层驱动 | **已修**：`router-wiring.test.ts` 新增 2 条 pre-step 用例 + **变异测试实证判别力**（退回词法判定即红） |
| 2 | 中等 | `router.md:124/127` 决策伪代码仍是改前语义，与同文件 Q6 新节自相矛盾，且复述的恰是被修复的事故行为 | 实读 `router.md:119-134`——不止 124/127，128 行的「模型=枚举序首个可用」也是 Q3 前的旧语义 | **已修**：整块伪代码同步为 Q3 + Q6 后的真实流程（含 `noteHead` 前缀）；`explicitProvider` 补 JSDoc 声明它只是词法层、**不得当路由判据** |
| 3 | 轻微 | `known === undefined` 会在 `known.has` 抛 TypeError 而非降级 | `rules.ts` 严格判 `=== null` | **已修**：改 `known == null`（宽松判空是有意的——该路径的全部意义就是"拿不到数据时别出事"）+ 两处 JSDoc 同步 |
| 4 | 轻微 | `noteHead` 只交代词法首个未知 `@` | `router.ts` 取词法首匹配 | **按设计保留**并写入 `router.md`（见 R7）——多未知时逐一罗列会把原因串变成噪声 |
| 5 | 轻微 | preview/decide 的 known 集来自两次独立拉取，可瞬时分叉 | 宿主 `index.ts` `enumerateCandidates` vs 客户端 `card-store.ts` `llm.models` | **已声明**为 R6 并写入 `router.md`；**未修**（需宿主活体核实两次拉取口径差异） |
| 6 | 轻微 | A9/§6 把「省钱预设 = `zai-coding-cn/glm-5.3`」当仓库事实，实际那是实机定制值 | `config.ts:139` 仓库默认该规则目标是 `kimi-coding/kimi-for-coding` | **已修**：A9 注明「以实机当前预设为准」并列出仓库默认值 |

**未覆盖的失败模式**（评审提出）：带图轮 × 未知 @、`omittedRuleIds` × 未知 @ —— **均已补用例**（见 §5）；枚举失败实机态维持 R1 的「未覆盖」备案。

**评审确认的优点（改稿时勿丢）**：known 三源组合 + `enumerateCandidates` 给「配置指向但目录缺失」补 `available:false` metas，使「已知但无候选 → keep」在目录缺失时仍成立——设计闭环的关键；四处调用点单一实现；`matchAll` 每次新建 RegExp 无 `lastIndex` 泄漏；`reviewTriggerHit` 默认参下与旧行为逐字节等价；原因串无注入面。

**评审未能核实项**（如实记录）：测试/类型/构建/门禁的通过数为提交声称，评审只读未运行。
