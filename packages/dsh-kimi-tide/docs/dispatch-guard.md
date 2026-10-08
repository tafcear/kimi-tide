# 派发护栏（dispatch guard）——设计说明

> **状态（2026-10-08）**：已按落地代码逐条校核（`src/guard.ts` / `src/config.ts` /
> `src/settings-schema.ts` / `src/migrate.ts` / `src/roles.ts` / `src/index.ts` 的接入点），
> 文中行号截至该日；**核对按内容定位**，行号仅作参考。
> 文案面已按 `src/locales/{zh,en}/**` 的冻结值核对（`shared.roles.guard.*`），§3 的占位符
> 口径（`fixHint` 的 `{0}` = 显示名）已与 `src/guard.ts` 的实现一致。
> **静态门禁已过，实机待验收**——护栏是宿主侧 `ctx.tools.guard` 的接入，拒绝行为与
> 调用方身份（队友 / 主会话）的读回只能在重启宿主后的真实会话里判读。
> 产品取舍由用户 2026-10-08 裁定（与 `docs/superpowers/backlog.md` 的 Q11「按角色配 skills」合流）。
> 相关：分工表与派发语义见 [`router.md`](./router.md)；派发口径用户可见说明见说明页「路由」节。

## 1. 为什么需要它

分工表（`roles`）的既有机制是**被动改道**：调用方先发起一次派发，宿主的 `pre-step` 钩子
再把这次请求改到角色目标上。这套机制认的是**成员关系**——`src/roles.ts` 里
`resolveRoleDecision()` 的判据是 `membership.role !== 'teammate' ⇒ 不命中`（`src/roles.ts:54`，
行号截至 2026-10-08，下同），只有身份为「队友」的被派发方才会进改道路径。

因此**一次性子代理派发在结构上不可能被改道**，无论角色表怎么配：

| 调用形态 | 宿主侧身份 | 分工表能否改道 |
|---|---|---|
| `spawn_teammate(name='frontend')` 之后给该队友派活 | 队友 | 能（`role` / `unclaimed` / `explicit` / `keep` 四口径） |
| `subagent` / `subagent_fork`，或 `workflow` 的 `agent()` | 一次性子代理 | **不能**（不落 `membership.role === 'teammate'` 判据） |

第二种形态里，调用方显式点名的 `provider` / `model` 会被尊重（默认目标给委派子代理让位——
`src/router.ts:1113` 的既有判据），于是「把前端活派给裸 `subagent`」的实际结果 = **在调用方指定的
模型（或继承的预设默认模型）上跑完，分工表的该角色一次都没参与**——角色配置了却不生效，
且没有任何提示。

**这个缺口不是猜出来的，是插件自己说过的话引出来的**：分工表注入给模型的技能正文
曾写「派发给对应模型的子代理」，照做的模型必然落进上表第二行。护栏的作用就是把这条
没有出口的路堵上：**任务领域命中某个角色时，拒绝把它派给裸 `subagent` / `subagent_fork`，
并在拒绝理由里写清正确的下一步**。

## 2. 护栏语义

- **载体**：宿主 `ctx.tools.guard(fn)`。类型面：
  `type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined`；
  `ToolExecutionInput = { callId, rootCallId?, name, schema?, arguments, agent?, parent?, signal }`。
  注册与卸载在 `src/index.ts`（guard 的 disposer 由注册方持有，路由重挂时先 dispose 再重装）。
- **判据**：纯函数 `dispatchGuardRejection(input)` 返回**字符串 = 拒绝该次调用**，
  返回 `undefined` = 放行。输入形状见 §4。
- **不可改派**：`guard` 只能拒绝，**不能**替调用方改成另一次 `spawn_teammate`。
  拒绝理由因此必须自带「下一步怎么做」，否则模型只会重试同一次调用。
- **单调最终拒绝**：护栏是一票否决——其他插件无法让被拒的调用通过（宿主原文口径）。
  这条性质决定了配置语义必须保守：宁可漏拦，不可错拦（见 §6 已知限制 1/2/6）。
- **默认关闭**：`dispatchGuard` 缺失 = `off`，行为与今天逐字节一致（§5）。
- **作用域**：只拦 `subagent` 与 `subagent_fork` 两个工具名。`workflow`、`spawn_teammate`、
  `send_message` 一律不拦——前两者本就是分工表技能推荐的派发形态，后者是队友协作面。
- **调用方身份**：`callerIsTeammate === true` 时不拦。队友自己再派活不进护栏，
  免得队友无法为自己不擅长的专项活起一个子代理。调用方身份由宿主 `agentTeams.tryMembership`
  判定；该服务缺席时身份未知 ⇒ 一律放行（不误拦）。

## 3. 拒绝理由样例

拒绝理由是宿主注入、进模型上下文的**模型面向文本**，经 locale 表渲染（zh 是唯一真源；
键在 `src/locales/{zh,en}/shared.ts` 的 `shared.roles.guard.*` 一组，已按冻结值核对）。

主键 `shared.roles.guard.rejectSubagent`，三个占位符：`{0}` = 命中角色的 `id`、
`{1}` = 角色显示名（`label`；该字段缺失或为空时回落到 `id`）、`{2}` = 指路串。
整串为四段：

| 段 | 内容 | 位点 |
|---|---|---|
| 命中了谁 | 角色显示名 | `{1}` |
| 该怎么做 | `spawn_teammate(name="{0}", …)`，`{0}` = 角色 `id` | `{0}` |
| 这条活不该归它 | 去掉该角色的领域词后重派 | 主键固定句式 |
| 想改判据 | 指路串 | `{2}` |

**`{2}` 指路串**恒为 `shared.roles.guard.fixHint`（由 `src/guard.ts` 的 `rejectionText()`
渲染主键时填充），其自身的 `{0}` = **命中角色的显示名**（与理由里「角色「…」」同一称呼）：

> 给角色「{0}」填 keywords（逗号分隔）：填了就优先按它判领域，留空则回退到显示名与别名。

（en 侧同键：`give role "{0}" a keywords list (comma-separated): once set it takes
precedence over the domain match, and an empty list falls back to the label and aliases.`）

以角色 `frontend` / 显示名「前端」为例，渲染出来的整串形态是：

> 本任务命中角色「前端」：请派给它的队友 `frontend`。普通子代理不参与分工表改道，会跑在
> 默认模型上。做法：`spawn_teammate(name="frontend", …)` 建起该队友（已存在就直接派给它），
> 任务照原样派过去；若不归它，去掉「前端」这类领域词后重派。备选：给角色「前端」填
> keywords（逗号分隔）：填了就优先按它判领域，留空则回退到显示名与别名。

`shared.roles.guard.roleKeywordsFallback` 是**另一条独立提示**（占位符 `{0}` = 角色显示名）：
「该角色未配置 `keywords`，本次命中来自显示名与别名」。它**不拼进拒绝理由**——
`fixHint` 已含「留空则回退」这层意思，再拼一次即重复；该键经 `missingKeywordsText(role)`
单独导出，供拒绝对话面与设置卡复用，**消费者不在护栏判据里**。

> 占位符口径（定稿，2026-10-08 用户侧裁定）：主键的 `{0}` = 角色 `id`（要模型拿去
> `spawn_teammate(name=…)` 的**可执行值**）、`{1}` = 显示名；`{2}` 内部的 `{0}` = 显示名。
> 同一条理由里的称呼因此一致（「角色「前端」…」与「给角色「前端」填 keywords」），
> 而可执行的队友名只在 `spawn_teammate(name="frontend")` 处以 `id` 出现。
> （`formatCopy` 单遍替换、不递归，故这层嵌套不存在二次展开。）

## 4. 判据（`src/guard.ts`）

```ts
export const DISPATCH_GUARD_TOOLS = ['subagent', 'subagent_fork'] as const

export interface DispatchGuardInput {
  toolName: string
  args: unknown
  roles: Record<string, RoleEntry>
  guarded?: boolean
  callerIsTeammate?: boolean
}

export function dispatchGuardRejection(input: DispatchGuardInput): string | undefined
```

放行（返回 `undefined`）的情形，逐条独立成立（实现按此顺序早退）：

1. `guarded !== true` —— 护栏关闭；
2. `callerIsTeammate === true` —— 队友自己派活；
3. `toolName` 不是字符串，或不在 `DISPATCH_GUARD_TOOLS` —— 不是这两条派发通道；
4. 任务文本取不到 —— `args` 不是普通对象，或 `description` 与 `prompt` 都不是字符串
   （两者都存在但都是空串时文本是空串，判定继续）；
5. `roles` 不是普通对象；
6. 没有角色的领域命中任务文本（角色表为空、角色条目非对象、以及全部未命中都落这里）。

**任务文本抽取**：只看 `args.description` 与 `args.prompt` 两处字符串，按换行拼接；
这两处之外的实参一律不读。角色的 `label` / `aliases` / `id` **不**参与任务文本的构建——
「派给前端」这句话能不能触发护栏，只取决于这活本身说了什么。

**绝不抛异常**：`args` 为 `null`、数字、数组，或角色条目缺字段时，判据一律按「取不到」处理
并返回 `undefined`。护栏不因实参形状异常而拒绝任何调用。

## 5. 配置字段与匹配规则

### 5.1 字段

| 位置 | 字段 | 取值 | 缺省行为 |
|---|---|---|---|
| 顶层 | `dispatchGuard` | `'off'` \| `'enforce'` | **缺失 = `off`**（护栏关闭，逐字节等于今天） |
| 角色条目 | `keywords` | `string[]` | **缺失 / 空数组 = 走回退匹配**（`label` + `aliases` + `id`） |

`keywords` 是**领域词表**（该角色认哪些活），与角色的 `id` / `label` / `aliases` / `teammate`
是两回事：后三者是**身份名与别名**（谁来认领），`keywords` 是**任务领域词**（什么活归它）。
即便 `keywords` 已配置，`label` / `aliases` / `id` 仍照常参与分工表的认领与队友名解析，
只是不再参与护栏的领域判定。设置页的输入形态是逗号分隔串，解析规则：半角或全角逗号切分、
去首尾空白、丢空串、去重保序。

`keywords` 的**搬运口径**：缺失即缺失（不注入默认值）；v6 的 `roles.<id>.keywords` 与
v7 的 `routes` 里 dispatch 行的 `keywords` **双向按字段搬运**——写通道双写、读通道投影，
所以护栏读到的是投影结果，两种配置形状下判定一致。

> `keywords` 的两态读法：**非空 = 只按它判**（`label` / `aliases` / `id` 不再参与命中）；
> **留空 = 回退**到 `label` + `aliases` + `id`（§5.2）。拒绝理由的指路串键
> `shared.roles.guard.fixHint` 就是把这两态讲给用户听（逐字稿见 §3）。

`dispatchGuard` **不写默认值**：新增可选字段一律不带 `.default()`——`settings-schema.ts`
的「默认往返相等」是既有红线（该文件注释），注入默认值会让往返不再逐字相等。
开关**只认字段本身**（`=== 'enforce'` 才算开启），不以版本号门控；`'off'` 与键缺失同义。
存量 v6 文档经迁移链搬运该键（同样不注入默认值）。
配置经 `/kimi-tide export-config` 可见，写入走设置页或 `/kimi-tide import-config`。

### 5.2 匹配规则

按 `roles` 的**键序**（配置里的出现顺序）逐个角色判定，**只取第一个命中的角色**，
串行短路：

| 角色侧 | 判据 | 命中形态 |
|---|---|---|
| `keywords` 非空 | 大小写不敏感**子串**匹配 | 词表里的词出现在任务文本任意位置即命中；词表内的非字符串项、空串项一律丢弃 |
| `keywords` 为空/缺失（回退） | `label` 子串 → `aliases[]` 逐项子串 → `id` **词边界** | 三步依次判定，任一命中即算；`id` 命中处两侧都不是 `[a-z0-9-]` 才成立 |

回退路径里 `id` 之所以要词边界：`id` 是短标识（如 `qa`），子串匹配会在无关文本里误命中
（`qatar`）——而护栏是最终拒绝，误命中会直接挡住一次合法派发。词边界判据的边界见 §6 已知限制 5。

命中后取该角色的 `id` 与显示名渲染拒绝理由（显示名缺失或为空时回落 `id`）。

### 5.3 一句话语义

> `dispatchGuard: 'enforce'` + 某角色的 `keywords`（未配置时是它的显示名 / 别名 / `id`）
> 出现在 `subagent` 或 `subagent_fork` 的 `description` / `prompt` 里 ⇒ 该次调用被拒绝，
> 理由指向「改用 `spawn_teammate(name='<角色 id>')` 派给该角色」。

## 6. 已知限制

1. **不能改派**：函数只能拒绝，调用方必须自己再发一次 `spawn_teammate`。
2. **子串匹配本就宽**：回退路径的显示名与别名按子串命中、`keywords` 全部按子串命中，
   都没有词边界；而护栏是最终拒绝——误命中的代价是「合法派发被挡一次」。出路写在拒绝理由里
   （换一种说法重派，去掉该角色的领域词）。
3. **只看任务文本**：护栏不读会话上下文。「这次派发属于哪个角色」只能从
   `description` / `prompt` 的字面判断——正文里提到某领域词、但这活本身不属于该领域的
   形态无法区分（同上，靠理由末句的出路）。
4. **单选且顺序敏感**：命中结果是**第一个**匹配角色，`roles` 键序决定命中谁。
   顺序（而非「最具体者优先」）是刻意的简化：结论可复现、可解释。
5. **词边界只覆盖 ASCII 队友名**：回退路径的 `id` 词边界按 `[a-z0-9-]` 判定，因此
   `qa` 不在 `qatar` 里命中，但会在 `qa/lead` 这种形态里命中。
6. **默认关 + 角色表为空 = 不注册护栏**：开关关闭时宿主侧不注册 guard 回调（零开销）；
   角色表为空时护栏没有可判定的对象，不产生任何拒绝。开启护栏需要同时满足两件事：
   `dispatchGuard: 'enforce'`，且角色表非空（`keywords` 建议显式配置）。
7. **两条通道之外不拦**：`workflow` 的 `agent()` 带显式 `provider` / `model`，是调用方对
   具体任务的点名，护栏不介入——用 `workflow` 绕开护栏是**设计上的出口**，不是漏洞。
8. **实机验收需重启宿主**：护栏是宿主侧接入，插件代码更新后要重启宿主才能判读真实拒绝
   行为。**本设计说明落地时只跑了静态门禁，实机未验收**（见 §7）。

## 7. 自查方法

### 7.1 静态门禁（仓库根 / 包目录）

```bash
node scripts/check-client-i18n.mjs     # zh/en 键集与占位符一致；硬编码文案扫描
node scripts/check-terminology.mjs     # 术语与语域禁用词
node scripts/check-doc-links.mjs       # 文档相对链接
cd packages/dsh-kimi-tide && npm run typecheck
```

判据本身的单元测试在 `test/guard.test.ts`（覆盖关闭态 / 队友调用 / 两个工具名 / keywords 命中 /
回退路径 / `id` 词边界 / 畸形实参 / 拒绝理由内容）。拒绝对话面复用
`missingKeywordsText()` 的文案时，注意它**不在**拒绝理由里（§3）。

### 7.2 配置面自查

- `/kimi-tide export-config`：确认 `dispatchGuard` 与角色的 `keywords` 实际落盘值。
- 设置页「月汐 → 路由」：角色行的 `keywords` 输入串；开关本身见主驱动卡。
- 说明页「路由」区的「派发护栏（dispatchGuard）」条目：用户可见口径与本文一致的对照面。

### 7.3 行为面自查（需重启宿主）

1. 前置：至少一个角色（记住它的 `id`）与 `dispatchGuard: 'enforce'`。
2. 正向：让一个队友（`callerIsTeammate === true`）调用 `subagent`，`description` 含该角色的
   领域词 → **预期：不拒绝**。
3. 反向：主会话直接调用 `subagent`，`description` 含同一个领域词 → **预期：拒绝**，
   理由里出现该角色的显示名、`spawn_teammate(name="<id>")`，以及指路串。
4. 对照：把 `dispatchGuard` 改回 `'off'`（或删掉该键）→ **预期：同一次调用放行**。
5. 对照：任务的 `description` / `prompt` 与任何角色领域无关 → **预期：放行**。

以上 1–5 属实机判据，须重启宿主后在真实会话里逐条留证；本设计说明落地时未执行。

## 8. 与术语规则的关系

- **界面用「队友」，不用「子代理」**（`docs/agents/terminology.md` §1）——设置页与面板文案
  一律「队友」；本文件是技术文档，允许用「子代理」指一次性派发的被派发方。
- 拒绝理由是**模型面向的文本**（宿主注入、进模型上下文），按产品文本的语域写：
  陈述句、具体值（角色名 / 命令 / 参数）、不写房内口语。
- zh/en 成对同批改：`scripts/check-client-i18n.mjs` 会验 zh/en 键集与占位符集合一致。
