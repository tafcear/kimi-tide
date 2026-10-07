# Style samples — 语体金标（效力高于对语气的文字描述）

> Agent-facing rule, same family as [`terminology.md`](./terminology.md) and [`readme-pair.md`](./readme-pair.md).
>
> **效力条款**：新写文案（`src/locales/{zh,en}/*.ts` 表、设置页、面板、说明页、README）以本文件的样例为准；
> 当样例与任何「对语气的文字描述」（含 [`terminology.md`](./terminology.md) §2）冲突时，**以样例为准**。
> 样例的效力高于描述——这是上游 DSH 的既定机制（`docs/i18n/style-samples.md`）。
>
> **维护规则**：样例只能由**人工评审校准后追加**（评审时逐句对照当时界面真实渲染的原文）；
> agent 不许随手新增或改写样例。每条样例必须是本插件**真实会说出口的话**——
> 取自现网界面 / README / locale 表的真句，不是编造的功能。

下面每段 = 一个真实界面场景：✅ 这样写（真句）、❌ 不这样写（说明为什么）、一行「这条示范的规则」。
中英各一套；英文术语用 [`terminology.md`](./terminology.md) §1 的镜像词
（default target / trigger / current value / when disabled / wired / main session / on dispatch）。

---

## 场景：空状态（未配置任何规则时）

**中文（真句：路由页顶部摘要）**

✅ 这样写：
> 主会话没有可命中的规则，全部使用默认目标（deepseek-official/deepseek-flash）；另有 3 组关键词组未接入任何规则，暂不生效。

❌ 不这样写：
> 空表不是坏了，是没接线；反正全部走打底。
>
> 为什么不行：比喻（"坏了"）、房内口语（"没接线""打底"）、没写默认目标的具体值——用户无从核对当前到底会用哪个模型。

**English**

✅ Write it like this:
> The main session has no matchable rules; everything uses the default target (deepseek-official/deepseek-flash); another 3 keyword group(s) are not wired into any rule and stay inactive.

❌ Not like this:
> The empty table isn't broken, nothing is hooked up — everything just falls to baseline.
>
> Why not: metaphor plus the banned "baseline" reading of "default target", and no concrete value to verify against.

**这条示范的规则**：空状态 = 陈述现状 + 给出默认目标的具体值 + 说明未生效的配置项；不用比喻、不用房内词。

## 场景：有规则时（命中条件的说明句）

**中文（真句：路由摘要 / 规则链实时行）**

✅ 这样写：
> 命中「代码」时改用 kimi-coding/kimi
> 当前：3 条规则，首条条件「带图」

❌ 不这样写：
> 说到代码的事就换模型，什么时候轮到它看它排第几。
>
> 为什么不行：口语短句当标签（应为名词短语「触发条件」），"什么时候轮到它"是禁用词，且没写命中后改用的目标。

**English**

✅ Write it like this:
> "code" switches to kimi-coding/kimi
> Current: 3 rule(s), first trigger "with image"

❌ Not like this:
> Chat about code and it swaps the model; whenever it's that one's turn depends on the queue.
>
> Why not: colloquial narration instead of a noun-phrase label, banned queue metaphor for priority, and the target is missing.

**这条示范的规则**：规则说明 = 命中条件（名词短语）→ 目标模型（具体值）；优先级只叫「优先级」。

## 场景：派发 / 分工（队友与角色）

**中文（真句：dock 派发槽 / 分工表实时行）**

✅ 这样写：
> 派发：后端→zai-coding-cn/glm-4.7
> 当前：分工表为空（专项活不会被派发改道）
> 3 个角色参与派发改道

❌ 不这样写：
> 专项活会甩给对应的子代理小弟，没人认领就保持原样，等等。
>
> 为什么不行：拟人（"小弟"）、界面用了"子代理"（应为「队友」）、"等等"吞掉了可核对的依据（role / explicit / unclaimed）。

**English**

✅ Write it like this:
> Dispatch: backend→zai-coding-cn/glm-4.7
> Current: the assignment table is empty (specialized work is not rerouted on dispatch)
> 3 role(s) participate in dispatch rerouting

❌ Not like this:
> Specialized jobs get tossed to the right sub-agent buddy; unclaimed stuff just stays, etc.
>
> Why not: anthropomorphism, "sub-agent" in UI copy (use "teammate"), and "etc." hides the verifiable basis (role / explicit / unclaimed).

**这条示范的规则**：派发说明 = 角色 → 目标 + 依据词（role=分工表角色 / explicit=显式点名 / keep=保持原样 / unclaimed=未在分工表）；界面用「队友」不用「子代理」。

## 场景：关闭路由（关闭后的影响）

**中文（真句：路由页摘要 / 分工档说明）**

✅ 这样写：
> 路由已关闭：所有请求保持宿主当前模型。
> 路由已关闭：分工表 2 个角色不发生任何改道（仅存档）

❌ 不这样写：
> 路由关掉了就躺平了，啥都不管；分工表那两行也就看看，不干活。
>
> 为什么不行：拟人口语（"躺平""不干活"）替代「关闭后的影响」的陈述句，丢掉了"保持宿主当前模型""仅存档"这两个可核对的事实。

**English**

✅ Write it like this:
> Routing is off: all requests keep the host's current model.
> Routing is off: the assignment table's 2 role(s) cause no rerouting (archived only)

❌ Not like this:
> With routing off everything just idles; those two assignment rows are decoration.
>
> Why not: anthropomorphic filler replaces the declarative "when disabled" sentence and drops the two verifiable facts (host's current model / archived only).

**这条示范的规则**：「关闭后的影响」= 一句陈述：改道不再发生 + 保持什么 / 剩什么状态（仅存档）。

## 场景：错误提示（可核对优先）

**中文（真句：面板取数失败原因 / 用量总览空数据行）**

✅ 这样写：
> 网络请求失败：HTTP 502
> 路由返回 ok!=true
> 响应体不是合法 JSON
> 取数时间标「(过期)」= 上一次刷新失败，此时显示的是更早的快照。

❌ 不这样写：
> 取数出了点问题，可能是网络之类的原因，等会儿再试试看吧。
>
> 为什么不行：「之类」吞掉了三种可区分的原因（不适用／无凭据／取数失败），没给状态码/JSON/快照等具体值与来源，用户无法核对也无法自查。

**English**

✅ Write it like this:
> Network request failed: HTTP 502
> Routing returned ok!=true
> Response body is not valid JSON
> A "(stale)" fetch time means the last refresh failed; what is shown is an earlier snapshot.

❌ Not like this:
> Fetching hit a snag — maybe the network or something; try again in a bit.
>
> Why not: "or something" collapses three distinguishable causes (not applicable / no credentials / fetch failed), gives no concrete value or source to verify, and the trailing plea is not product copy.

**这条示范的规则**：错误提示 = 具体值（状态码、字段、时刻）+ 原因词；禁「等等/之类」，禁安慰性口语。

---

## 与机器闸的关系

- 词表违禁（打底、接线、轮到它……）由 [`scripts/check-terminology.mjs`](../../scripts/check-terminology.mjs) 拦截；
- 硬编码文案回流由 [`scripts/check-client-i18n.mjs`](../../scripts/check-client-i18n.mjs) 拦截（文案必须进 `src/locales/{zh,en}/*.ts`）；
- 「像不像上面的样例」没有机器闸——那半是人工评审的事：评审任务书须引用本文件并逐句对照。
