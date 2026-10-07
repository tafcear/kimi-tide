# Terminology & copy register — one concept, one word, product-grade tone

> Agent-facing rule, same family as [`readme-pair.md`](./readme-pair.md) and [`release-notes.md`](./release-notes.md).
> **为什么有这份文档**：2026-10-07 发现了本仓一类真实缺陷——**agent 在一个地方临时想出的口语措辞，会沿着「设计稿 → 派发实施 → 独立复核 → 测试断言 → 四处文档面」这条链路变成"协议"**，
> 而这条链路上**没有任何一环审"这句话像不像产品文案"**：复核审的是"落地没落地"，测试锁的是"字面"，文档面同步要求的是"复制到两边"。
> 结果：「打底」「什么时候轮到它」「关掉它会怎样」「接线/悬空」这类**房内口语**出现在用户交付面上。
> 这份文档把"术语 + 语域"变成**单一来源**，并由 [`scripts/check-terminology.mjs`](../../scripts/check-terminology.mjs) 机器检查、接进 `npm run check`。

## 1. 术语表（**一个概念只用一个词**）

| 概念 | 唯一用户可见写法 | 禁用（历史/口语/近义混用） |
|---|---|---|
| 未命中任何规则时使用的目标 | **默认目标** | 打底、兜底、默认模型（**作档位名时**）、baseline |
| 预设里"未命中时的目标"这个**配置字段** | **默认模型** | 预设默认（作为 UI 标签时） |
| 主驱动恒定开启时主会话的常驻目标 | **主驱动目标** | driver、主驱动（单独作名词时加"目标"） |
| 档位的适用条件 | **触发条件** | 什么时候轮到它、何时轮到、启用时机 |
| 档位的当前取值 | **当前取值** | 当前生效值、生效目标 |
| 档位停用后的结果 | **关闭后的影响** | 关掉它会怎样、关掉后 |
| 关键词组被规则/协作流引用 | **已接入 / 未接入** | 接线、接上、悬空、挂空 |
| 规则服务会话、角色服务派发 | **主会话 / 派发时** | 会话内、派发面（作标签时） |
| 五档的先后关系 | **优先级** | 链、轮到、谁赢、决胜顺序 |
| 并发/上下文隔离的队友 | **队友** | 子代理（**技术文档**可；用户界面用"队友"）、teammate |

> 英文侧镜像（供 `README.en.md` 与英文界面）：默认目标 = **default target**；触发条件 = **trigger**；
> 当前取值 = **current value**；关闭后的影响 = **when disabled**；已接入 = **wired / not wired**；
> 主会话 / 派发时 = **main session / on dispatch**。**不要**再用 `baseline` 指代"默认目标"（它同时被用来指"打底档位"和"基线"，歧义）。

## 2. 语域规则（用户可见文案）

**面向用户的每一个字符串**（设置页卡片、面板/dock、说明页、README、CHANGELOG、发布说明）遵守：

1. **标签用名词短语**，不用疑问句或口语短句。
   - ✅ 触发条件 / 当前取值 / 关闭后的影响
   - ❌ 什么时候轮到它 / 关掉它会怎样
2. **说明用陈述句**，不用拟人、比喻、感叹。
   - ✅ 未配置任何规则时，主会话使用默认目标 `deepseek-official/deepseek-flash`。
   - ❌ 全部走打底；空表不是坏了，是没接线；两个词一贴，「打架」变成「分工」。
3. **一个概念一个词**（见 §1）；同一屏里不得出现同义异形（如"打底"与"默认目标"并存）。
4. **首次出现处给定义**：术语表（说明页 §术语表）是用户查词的地方，正文首次出现可加一行括号解释。
5. **不写"评审/复核/实施"等 agent 内部语汇**（"说人话""按字段判据""双写"等只属于 `docs/` 内部文档，不进 UI）。
6. **可核对优先**：能给出具体值/来源的，写出来（如"来源：主驱动恒定"），不要写"等等/之类"。

## 3. 变更流程（术语要改时）

1. **先改本文件**（§1 表）——术语是单一来源，代码与文档都是它的下游；
2. 再改下游：`src/client/**` 与 `src/routing-view.ts` 的文案常量 → 说明页术语表 → 双语 README → `docs/router.md` → `CHANGELOG` → 当前版本的 `release-notes-v*.md`；
3. **测试断言要跟着改，不许删**——它们防的是"文案回退"这个真问题（例：`SettingsCard.test.tsx` 曾钉住"第 2 档不得出现『宿主』"）；
4. 跑 `npm run check`（含 `check-terminology`）+ 包内 `npm test`；
5. **历史档案不改**：`docs/superpowers/**`（已归档的 specs/plans）、`docs/audit/**`、**已发布版本的** `release-notes-v*.md` 记述的是当时的事实，改了就是篡改记录。

## 4. 机器检查的边界（`check-terminology` + `check-client-i18n`）

### 4.1 [`scripts/check-terminology.mjs`](../../scripts/check-terminology.mjs) — 禁用词

- **扫**：`packages/dsh-kimi-tide/src/**`（用户可见字符串与文案常量，含 `src/locales/**` 分表）、`packages/dsh-kimi-tide/locale/zh.json` / `locale/en.json`（Plugin Manager 展示元数据）、根 `README.md` / `README.en.md`、`packages/dsh-kimi-tide/README.md`、`packages/dsh-kimi-tide/docs/router.md`、`CHANGELOG.md`、**当前版本**的 `release-notes-v*.md`。
- **豁免**：`docs/superpowers/**`、`docs/audit/**`、已发布版本的发布说明、`test/**`（测试里出现旧词是在断言"它不该出现"）。
- **判据**：禁用词命中即红，并打印 `文件:行号` 与命中的词；命中落在 locale 表 / 展示元数据里时，提示语会额外指向「改词表 §1 与 `src/locales/**`」；**负控**：故意在受扫文件里写一个禁用词，检查器必须 exit 1（回归时自检）。
- 说明：检查器管的是**词表**，管不了"像不像产品"——那一半靠 [`style-samples.md`](./style-samples.md) 的金标语体样例 + 复核任务书里加一条：*用户可见文案须逐句过一遍语域（§2），并在报告里给出改后原文*。

### 4.2 [`scripts/check-client-i18n.mjs`](../../scripts/check-client-i18n.mjs) — 硬编码文案（locale-owned）

- **为什么**：上游 DSH 明文规则「Client UI copy is locale-owned」（deepseek-harness 仓 `AGENTS.md:154`），`verify-client-ui-i18n` 拒绝硬编码文案。只要文案还是散落的字面量，就没有任何一处能整表审阅。
- **扫**（AST 级，TypeScript `createSourceFile` 递归遍历——注释天然不进 AST）：`packages/dsh-kimi-tide/src/client/**/*.{ts,tsx}` 与 `src/routing-view.ts`；字符串字面量 / 模板字面量（head/middle/tail）/ JSX 文本节点里出现汉字（`\u3400-\u4DBF`、`\u4E00-\u9FFF`、`\uF900-\uFAFF`）、中文标点（U+3000–U+303F）、全角形式（U+FF00–U+FFEF）、`——`、`…` 即红（**拼接用标点也是文案**：`（${x}）`、`join('、')`、`join(' ｜ ')` 都会被拦）。例外：`src/client/styles.ts` 的 `CLIENT_CSS` 先剥掉 `/* … */` 注释再判（CSS `content:` 里的真实中文仍红）。
- **表结构校验**（esbuild 把表打成临时 ESM 取真值）：五张 surface 表 zh/en 键集完全相等（差集打印）；跨 surface 无重复键（两两求交）；值为非空字符串；同一键 zh/en 占位符（`{0}`/`{name}`）集合一致；`locale/{zh,en}.json` 的 `meta.title`/`meta.description` 存在且非空。
- **用法**：`node scripts/check-client-i18n.mjs [--json] [--roots <dir…>] [--fixture <dir>]`；`--roots` / `--fixture` 供负控只扫指定目录/假包根。退出码 0/1。已接进 `npm run check`。
- **边界**：本闸只判"硬编码 / 表结构"，**不判语体**（那是 §2 + 样例的事），也不扫 `src/locales/**` 里的中文（表本来就是中文真源，禁用词由 §4.1 管）。

## 5. 这次的决策记录（2026-10-07）

| 决定 | 内容 | 依据 |
|---|---|---|
| 术语改名 | **打底 → 默认目标**（档位名）；沿用"默认模型"作**配置字段**名 | 用户裁定「C」；「打底」是 0.5.0 时代用户确认过的房内术语（`positioning.md:47`、`2026-08-20-rule-driven-routing-design.md:25`），但它是化妆/衣着语境的词，不宜出现在交付面 |
| 档位三行标签 | 什么时候轮到它 → **触发条件**；当前生效值 → **当前取值**；关掉它会怎样 → **关闭后的影响** | 与规则表既有「条件」列表头同词，全页一致 |
| 档位 5 的触发条件句式 | **以上各档都没接住时** | 用户提出，读起来自然且无歧义 |
| 保留 | 「主会话 / 派发时」作用域徽标、「队友」、「预设」、「规则」 | 已是产品级且无歧义 |

## 6. 根治路径：locale-owned copy（**执行中**）

上游 DSH 对"文案语域/术语"这件事有成套机制，本项目此前只做了其中一半；本轮（2026-10-07 W 系列）把另一半落地：

| 上游机制 | 上游位置 | 本项目现状 |
|---|---|---|
| **明文规则：Client UI copy is locale-owned** —— 产品文案必须走 typed dictionaries + `t` 或本地化 primitive props，**`verify-client-ui-i18n` 拒绝硬编码文案** | `deepseek-harness` 仓 `AGENTS.md:154` | ✅ 基础设施已落地（阶段 P）：`src/locales/{zh,en}/{shared,settings,panel,help,view}.ts` 分表 + `src/client/locale.ts`（`useCopy()`/`copy()`）接线；本仓对应闸为 `scripts/check-client-i18n.mjs`（见 §4.2，已接进 `npm run check`） |
| 术语表（列 `English \| 中文 \| 首次出现 \|`**`不要译作`**`\| 备注`；「不要译作」＝严格禁止的译法） | `docs/i18n/terminology.md` | ✅ 本文件（形态对齐；机器扫描见 §4） |
| **语体样例**（金标段落，效力**高于**对语气的文字描述，人工评审校准后追加） | `docs/i18n/style-samples.md` | ✅ [`docs/agents/style-samples.md`](./style-samples.md)：5 段金标（空状态 / 有规则 / 派发分工 / 关闭路由 / 错误提示），中英各一套 |
| 双语配对三件套（`foo.md` / `foo.zh.md` / `foo.i18n.yaml` + `verify-translation-pairing`，按标题分节存两侧 hash） | `docs/i18n/README.md` | ⚠️ 部分：`scripts/check-readme-sync.mjs` 只管骨架/版本/链接，**不管逐节内容**（仍挂账） |

**为什么必须做**：只要文案还是**散落的字面量**，就没有任何一处能整表审阅——§1 的表能**定义**词，却挡不住"新写一句口语"。搬进 `src/locales/{zh,en}/*.ts` 分表之后，文案变成**一张可整表审阅的表**，新闸（§4.2）同时拦"硬编码回流"与表结构缺陷。

**顺带解决的既有挂账**：① 无 locale ⇒ 英文界面下卡片仍是中文（分表 + `useCopy()`/`copy()` 回落已解决）；② Plugin Manager 缺 `meta.title` / `meta.description` 展示元数据（`locale/{zh,en}.json` 已写，新闸校验非空）。

**执行顺序**：定词（已完成）→ 搬进 locale 分表 + `t()` 接线（阶段 P 已落地基础设施；W1 设置页 / W2 面板 / W4 说明页搬迁进行中）→ 新闸 `check-client-i18n` 接进 `npm run check`（已接）→ 金标语体样例（已建 [`style-samples.md`](./style-samples.md)，从此"新写文案"以样例为准）。

## 7. locale 表的键命名约定（`src/locales/**`）

- 形状：`<surface>.<area>.<name>`，全小写 camelCase 段（键字符串含点号，表内用引号包键）。
- surface 前缀：`shared.`（跨界面 chrome）、`view.`（routing-view）、`settings.`（设置页）、`panel.`（dock/面板）、`help.`（说明页）。
- zh 是唯一真源；en 键集必须完全相等（surface 文件里 `Record<keyof typeof zh, string>` 钉住，`npm run typecheck` 兜底；`check-client-i18n` 再验一遍）。
- 占位符统一 `{0}` / `{1}` / `{name}` 形式，由 `formatCopy` 替换；同一键 zh/en 的占位符集合必须一致（新闸判据）。
- 跨 surface 同名键 = 红（合并期 `throw duplicate copy key`，新闸两两求交再验）。
