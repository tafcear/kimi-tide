# 文档零基础化改造实施计划（README / 包级 / CHANGELOG / docs 梳理）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（spec §七已裁定**单作者 inline 执行**，Kimi 评审轮除外——按 Task 10 派发）。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让零基础访客 3 秒知道月汐是什么、10 秒知道对自己有什么用、5 分钟能装上跑通；版本史进 CHANGELOG 单一事实源 + CI 守护。

**Architecture:** 纯文档面改造，零代码语义变化。执行顺序按依赖调整——先建承接落点（CHANGELOG / release-evidence / router.md 补差），后重写 README 面（保证链接落点先于引用存在）；CI 守护与机器验收收口；最后一轮 Kimi 独立评审闭环。与 spec §七的 commit 顺序建议不同之处（CHANGELOG/evidence 先行）是依赖倒置的正确解，spec 意图不变。

**Tech Stack:** Markdown + 两个 Node 检查脚本（零依赖，`node:fs`/`node:path`）+ GitHub Actions 一行步骤。

**Spec:** `docs/superpowers/specs/2026-08-31-zero-basis-docs-design.md`（本计划从 spec 论证，两者一并阅读；用户四裁定见 spec §〇）

## Global Constraints

- **默认读者=普通人零专业知识**（《面向人的文档写法规范》顶级规则）：术语第一次出现必须用下表白话注释；先场景后功能；每句一个意思。
- **术语白话注释表（首现必注，表述照抄）**：
  - DSH（DeepSeek Harness）＝ DeepSeek 官方的 AI 编程智能体框架（**唯一新增事实断言，Task 4 第 1 步核实后定稿**）
  - 挂载/接入＝ 在 DSH「设置 → Models」里接通一个模型服务
  - provider ＝ 模型服务的来源名（如 `kimi-coding`、`deepseek-official`）
  - 多模态 ＝ 能看懂截图/图片的模型；文本-only ＝ 只能处理文字的模型
  - 预设 ＝ 一套「默认模型 + 规则」方案，可一键全局切换
  - 规则 ＝ 「什么消息交给哪个模型」的条件（带图/关键词）
  - 打底 ＝ 没有任何规则命中时使用的默认模型
  - effort ＝ 推理力度档位（想得越深越慢越贵）
  - dock 面板 ＝ 会话输入框下方的「🌙 月汐」面板
  - 协作流 ＝ 一条「先 A 后 B」的自动流程（如：图先转成文字，再交给便宜模型作答）
- **事实零漂移清单**（改写中逐条对照，不得变化）：v1.0.0（2026-08-29）；497/497 测试 + 31 个测试文件；DSH 依赖窗 `@deepseek-ai/dsh@0.1.1-rc.2` 及以上；Node ≥ 22；peer 范围 `^0.1.1-rc.2 || >=0.1.2-0 <0.2.0-0`；关键词组 7 组；effort 三入口；配置键与默认值（`activePreset` null=关闭、`imageFallback` 缺省 latch、`imageFallbackFlow` 缺省 transcribe、`usagePollMs` 60000 等）；安装四步命令原文。
- **新增事实断言白名单**：仅 DSH 一句话介绍（Task 4 核实）；其余一律沿用存量事实。
- **不动清单**：任何 `src/`/`test/` 代码；`docs/assets/readme/` 全部视觉资产；`docs/superpowers/` specs/plans 历史档案；`packages/dsh-kimi-tide/docs/router.md` 的语义表述（Task 3 仅补字段事实）；中英以外不新增语言。
- **格式锁**：README「版本与路线」节首行必须是 `> 当前版本：**vX.Y.Z（YYYY-MM-DD）**` 字面格式；CHANGELOG 版本标题必须是 `## vX.Y.Z（YYYY-MM-DD）`——两者被 `scripts/check-changelog.mjs` 正则依赖（Task 8）。
- **体量锁**：`README.md` ≤ 20KB；`README.en.md` ≤ 14KB。
- **维护者语言禁区**：commit hash、验收清单编号（A1-A10/B1-B8/C1-C6）、测试数、分支名、池⑩⑪等内部编号**不得出现**在 README/CHANGELOG 正文（release-evidence.md 与 docs/ 内部文档不受限）。
- 分支 `docs/1.0.1-zero-basis`；一文件一 commit；**绝不跑 `pnpm install`**；全量验证命令在 `packages/dsh-kimi-tide` 下：`npx vitest run --pool=threads` + `npm run typecheck` + `npm run build`。
- Kimi 评审额度窗口规则：若在 08-31 15:13 UTC 前派发失败（429/配额），评审**挂起待窗口**，不换评审人、不跳过。

---

### Task 1: 新建 `CHANGELOG.md`（用户视角单一事实源）

**Files:**
- Create: `CHANGELOG.md`（仓库根）

**Interfaces:**
- Consumes: 现 README「项目思路」节（演进史素材）、路线图版本 bullets（中文区 L276-286，用户视角素材）
- Produces: `## vX.Y.Z（YYYY-MM-DD）` 标题格式（Task 8 脚本依赖）；Task 4 README §版本与路线 的链接目标

- [ ] **Step 1: 写前言**——一段话项目是什么（电梯陈述同款）+ 三段演进史（自研接入→路由与评分→收敛聚焦，承接现 README「项目思路」三段，各 2-3 句）+ 边界声明行：「本文件是版本历史的唯一事实源（用户视角）；维护者证据链（commit 锚点/验收记录）见 `docs/release-evidence.md`。」
- [ ] **Step 2: 逐版本条目（倒序）**——`## v1.0.0（2026-08-29）` / `## v0.6.1（2026-08-23）` / `## v0.6.0（2026-08-23）` / `## v0.5.0（2026-08-21）` / `## v0.4.0（2026-08-20）` / `## v0.1.3`；0.2.x/0.3.0 并入 v0.4.0 条目一句话（「此前 0.2-0.3 的路由与评分能力随本版首次发版」）。每条：2-5 行「用户得到了什么」（业务语言，从现路线图 bullets 改写），末行附 `[Release vX.Y.Z](https://github.com/tafcear/kimi-tide/releases/tag/vX.Y.Z)`。v1.0.0 条目为最详（合流了什么、新用户视角六大点：关键词匹配更准/规则覆盖 7 组/effort 档位/试一句/多 plan 配额/月汐主题）。
- [ ] **Step 3: 自查**——无 commit hash、无验收编号、无测试数混入；`git tag -l` 对照版本清单无遗漏。
- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): 新建 CHANGELOG.md——版本历史单一事实源（用户视角回填 v0.1.3→v1.0.0，结构方案C）"
```

### Task 2: 新建 `docs/release-evidence.md`（维护者证据链迁移）

**Files:**
- Create: `docs/release-evidence.md`

**Interfaces:**
- Consumes: 现 README 路线图大表（中文区表格 L263-274 + bullets 中维护者证据句）
- Produces: Task 4 README「版本与路线」与「开发与测试」节的证据锚点指向

- [ ] **Step 1: 迁移**——文首头注：「维护者证据链（发布门禁 convention：执行记录回写本文件锚点）。用户视角版本史见仓库根 CHANGELOG.md。」随后**原样迁移**路线图大表（版本线/状态/证据锚点三列，含全部 hash 与验收记录）+ 路线图 bullets 中含 hash/验收编号/分支名的证据句。不删改任何条目。
- [ ] **Step 2: 对账**——与迁移前 README 原文 diff 对账：表行数一致、锚点无缺。
- [ ] **Step 3: Commit**

```bash
git add docs/release-evidence.md
git commit -m "docs(evidence): 路线图维护者证据链原样迁移 docs/release-evidence.md（发布门禁锚点保活）"
```

### Task 3: `packages/dsh-kimi-tide/docs/router.md` 补差（承接 README 下沉内容）

**Files:**
- Modify: `packages/dsh-kimi-tide/docs/router.md`

**Interfaces:**
- Consumes: 现 README「配置→路由配置表」（中文区 L203-215，v5 全字段）、「候选池与示例模型表」（L185-195）
- Produces: router.md 成为路由配置与候选池的单一落点；Task 4/Task 6 的 README 面指向本文件

- [ ] **Step 1: 通读 router.md 全文**，逐键核对「配置参考（v4 全字段）」+「0.6.0 协作编排扩展→配置 v5」两节是否已覆盖 README 配置表全部键：`activePreset` / `presets.*`（default/rules/minHits/effort/imageFallback/imageFallbackFlow）/ `flows` / `keywordGroups` / `auxTargets`。
- [ ] **Step 2: 缺哪补哪**——缺失键按 router.md 现有行文风格补入对应节（预期缺口：`auxTargets` 与 `imageFallbackFlow` 的说明行）；**只补字段事实，不改既有语义表述**。持久化迁移注（`.pre-v3/v4/v5` 链）确认 §迁移链 已覆盖，缺则补一句。
- [ ] **Step 3: 候选池**——核对 §候选池（全量枚举）节；将 README 示例模型表（7 行：kimi 4 + deepseek 3，含模态/上下文/角色列）并入该节末尾，标题「开箱示例（非路由边界）」，保留原表注（模态实读自 pi-ai/dsh-llm-deepseek 目录）。
- [ ] **Step 4: Commit**

```bash
git add packages/dsh-kimi-tide/docs/router.md
git commit -m "docs(router): 承接 README 下沉内容——v5 配置键补差（auxTargets/imageFallbackFlow）+ 开箱示例模型表并入候选池节"
```

### Task 4: 重写 `README.md`（中文主文档）

**Files:**
- Modify: `README.md`（整文件重写）

**Interfaces:**
- Consumes: Task 1 CHANGELOG（版本节链接）、Task 2 release-evidence（证据锚点指向）、Task 3 router.md（配置/候选池/匹配语义链接目标）、`docs/assets/readme/` hero 与架构图资产
- Produces: `> 当前版本：**v1.0.0（2026-08-29）**` 字面行（Task 8 脚本依赖）；Task 5 英文版的结构母本

- [ ] **Step 1: 核实 DSH 一句话**——`npm view @deepseek-ai/dsh description homepage`（或 web 官方 README），以官方表述为基准定稿首屏 DSH 注释句； Global Constraints 注释表措辞随之校正。把核实到的官方原文记入本计划本步骤下方（实施时回填）。
  - **回填（2026-08-31 实施时核实）**：GitHub 仓库官方 tagline = **"DeepSeek Harness: Everything is a Plugin."**（`github.com/deepseek-ai/deepseek-harness` 页面标题原文）；npm `@deepseek-ai/dsh` 为 MIT 许可、readmeFilename=`README.zh.md`（包内 README 仅述 CLI 启动器，不承载产品定位）。定稿措辞：「DSH（DeepSeek Harness）是 DeepSeek 官方开源的 AI 编程智能体框架——在网页里跟 AI 助手对话干活，模型、工具、界面都以插件形式装卸（官方口号：Everything is a Plugin）。」
- [ ] **Step 2: 按新骨架重写**（spec §4.1 八节 + 首屏；每节的硬性内容要求）：
  1. **顶部**：hero.gif + 徽章（原样保留）+ 语言行「简体中文 ｜ `README.en.md` 链接（English）」。
  2. **首屏电梯陈述**（4-6 行，spec S1 草样为基）：一句「是什么」→ 两句 DSH 白话注释 + 「DSH 默认一会话一模型」的痛点 → 一句「装后得到什么」（三个自动切）→ 一句「决策可见、规则你写」→ 一行**适合谁/不适合谁**。
  3. **三个真实场景**：贴图切模型 / 切完忘切回 / 额度焦虑——每场景两行「以前 vs 装上月汐后」。
  4. **30 秒看懂路由逻辑**：4 行白话决策链（显式@ → 规则链首条命中 → 预设打底 → 带图护栏）+ 现决策流 mermaid 原样保留 + 架构图缩为两行（图 + 交互版链接一句）。
  5. **快速开始**：现四步内容白话化保留（前置/接模型/安装/30 秒验收；命令原文不动；术语按注释表加注）；「发布规范（dsh.bundle.patch）」注**移出**访客动线，挪至「开发与测试」节。
  6. **预设与规则**：现内置预设表 + 7 关键词组表迁移保留；`minHits`/`effort` 各一句白话 + 深入链接 router.md；一句「候选池=Models 页全量，见 router.md」。
  7. **常见问题**：现 5 问保留白话化；迁移史答（Q5）缩为两句 + router.md §迁移链链接。
  8. **版本与路线**（≤5 行）：`> 当前版本：**v1.0.0（2026-08-29）**` + `CHANGELOG.md` 链接 + 证据链 `docs/release-evidence.md` + 规划中三条一句话（评审流自动触发 / 子代理转述 / 0.8.5 强化与包装）。
  9. **文档索引**（按读者分层）：我想用（快速开始/FAQ）/ 我想深挖（router.md、架构图交互版、host-platform-map、协作闭环方法论、kimi-tide-research）/ 我想参与（Discussions、贡献者）；节首一行引语「三原则：官方优先 · 规则透明 · 决策可观测」。
  10. **开发与测试**：现内容压缩（三命令 + 质量基线一句 + 发布门禁一段，门禁措辞「执行记录回写**docs/release-evidence.md** 锚点」）+ 自 README 快速开始移入的 dsh.bundle.patch 注。
  11. **贡献者 / 许可证与合规**：原文保留，微调措辞。
  12. **删除清单（工作清单，非 README 章节，不得写进正文）**：删除并确认去向——特性一览 12 条（3 条核心能力→首屏与场景段；图像护栏/协作流/多 plan 配额/Kimi 增强→场景与快速开始提及+链接；品牌视觉一句；命令族→包级 README）、配置大表（→router.md）、候选池表（→router.md）、路由器详解（预设/关键词组表留下，其余→router.md）、路线图大表与版本 bullets（→CHANGELOG/release-evidence）、项目思路整节（演进史→CHANGELOG 前言；三原则→文档索引引语）。
- [ ] **Step 3: 首读自查**——模拟零基础读者通读：每个术语首现有注吗？3 秒能答「是什么」吗？10 秒能答「对我有什么用」吗？《面向人的文档写法规范》§三自查清单全过。
- [ ] **Step 4: 体量与格式自查**——`README.md` ≤ 20KB；「当前版本」行符合 Global Constraints 格式锁；全文无 commit hash/验收编号。
- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): 零基础化重写中文主文档——电梯陈述+场景先行+快速开始白话化，深度内容下沉 CHANGELOG/router.md/release-evidence"
```

### Task 5: 新建 `README.en.md`（独立英文文档）

**Files:**
- Create: `README.en.md`
- Modify: `README.md`（仅顶部语言行若需微调互链）

**Interfaces:**
- Consumes: Task 4 中文版（结构母本与全部事实）
- Produces: 英文独立入口；Task 9 双语对齐检查对象

- [ ] **Step 1: 全文翻译重写**——与中文版同结构同深度（十二节一一对应）；顶部语言行「`README.md` 链接（简体中文） ｜ English」；现 README 英文区的成熟表述优先沿用（痛点段/决策链等），零基础化改写同步 applying。
- [ ] **Step 2: 数字与事实逐条对齐**——对照中文版过一遍：v1.0.0、497/497、31、`0.1.1-rc.2`、Node 22、7 组、effort 三入口、安装命令、模型表数值（沿 08-30 双语评审 D1-D12 检查法）。
- [ ] **Step 3: 体量自查**——≤ 14KB；无维护者语言混入。
- [ ] **Step 4: Commit**

```bash
git add README.en.md README.md
git commit -m "docs(readme): 新建独立英文版 README.en.md——与中文版同构互链，替换单文件双语 details 嵌套"
```

### Task 6: 重写 `packages/dsh-kimi-tide/README.md`（包级）

**Files:**
- Modify: `packages/dsh-kimi-tide/README.md`

**Interfaces:**
- Consumes: Task 3 router.md（配置落点）、Task 1 CHANGELOG、Task 4 根 README（电梯陈述同款口径）
- Produces: npm 页/收录条目看到的插件面文档

- [ ] **Step 1: 按骨架重写**——①首段：插件视角电梯陈述（同款口径，点到「装上即用的路由+护栏+面板」）+ 状态两行（v1.0.0 已发布 + 497/497）；②前置条件/安装四步/模型表（kimi 4 模型）原样保留；③dock 面板速览 + 命令族保留白话化；④插件级配置表（cordis.patch.yml 四键）保留；⑤带图行为与已知限制表保留；⑥删版本史状态长块（0.6.0/0.8.0 段），替换一行「版本历史见仓库根 `CHANGELOG`」；⑦路由配置不再展开，一句「见 `docs/router.md` 配置参考」。
- [ ] **Step 2: 自查**——与根 README 事实同口径无冲突；链接（`../../CHANGELOG.md`、`docs/router.md`）可达。
- [ ] **Step 3: Commit**

```bash
git add packages/dsh-kimi-tide/README.md
git commit -m "docs(package-readme): 包级 README 重写——电梯陈述+状态两行，版本史与路由配置外指 CHANGELOG/router.md"
```

### Task 7: `docs/positioning.md` 刷新 + 四文档读者横幅

**Files:**
- Modify: `docs/positioning.md`
- Modify: `docs/legacy-setup.md`、`docs/host-platform-map.md`、`docs/development-plan-router.md`、`docs/agent-collaboration-loop.md`（各加一行横幅）

- [ ] **Step 1: positioning 头部状态块**——引言区补一行现状：「**2026-08-31 更新**：v1.0.0 大版本已发布（关键词匹配 + 规则体系/effort + 品牌主题 + 多 plan 配额）；本文档 §3 层次框架与 §5 退役计划继续有效；竞争地图 v2 待 0.8.5-T5。」（不改 §1-§6 正文结论。）
- [ ] **Step 2: positioning §1 前加白话句**——「白话版：月汐给 DSH 装上『每一步自动选对模型』的能力——装的、选的、为什么选，全是你说了算，全看得见。」
- [ ] **Step 3: 四文档横幅**——四个文件均位于 `docs/` 内同级，各在标题后的引用区加**同一句**：`> 📌 这是内部/存档文档，面向维护者与研究者。新读者请从仓库根 [README](../README.md) 开始。`
- [ ] **Step 4: Commit**

```bash
git add docs/positioning.md docs/legacy-setup.md docs/host-platform-map.md docs/development-plan-router.md docs/agent-collaboration-loop.md
git commit -m "docs(guides): positioning 状态块刷新至 v1.0.0 + 白话定位句；四个内部文档加读者横幅"
```

### Task 8: 版本一致性守护（脚本 + CI 步骤）

**Files:**
- Create: `scripts/check-changelog.mjs`
- Create: `scripts/check-doc-links.mjs`
- Modify: `.github/workflows/ci.yml`（checkout 后加一步）

**Interfaces:**
- Consumes: Task 1 CHANGELOG `## vX.Y.Z` 标题格式、Task 4 README「当前版本」行格式、`packages/dsh-kimi-tide/package.json` version（现 `1.0.0`）
- Produces: 本地与 CI 共用的两个门禁脚本（0.8.5 C1-C6 验收可复用）

- [ ] **Step 1: 写 `scripts/check-changelog.mjs`**

```js
#!/usr/bin/env node
// 三处版本一致性校验：CHANGELOG 最新版本 == 包版本 == README 当前版本行
// 用法：node scripts/check-changelog.mjs（CI 与发版前手工均可）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const changelog = read('CHANGELOG.md');
const pkg = JSON.parse(read('packages/dsh-kimi-tide/package.json'));
const readme = read('README.md');

// CHANGELOG 倒序，第一个版本标题即最新；README「版本与路线」首行「当前版本：**v1.0.0（…）**」
const head = changelog.match(/^##\s+v([\w.\-+]+)/m);
const cur = readme.match(/当前版本：\*\*(v[\w.\-+]+)/);

const problems = [];
if (!head) problems.push('CHANGELOG.md 未找到版本标题（## vX.Y.Z 形态）');
if (!cur) problems.push('README.md 未找到「当前版本：**v…」行');
if (head && cur && 'v' + head[1] !== cur[1])
  problems.push(`CHANGELOG 最新 v${head[1]} != README ${cur[1]}`);
if (head && 'v' + head[1] !== 'v' + pkg.version)
  problems.push(`CHANGELOG 最新 v${head[1]} != package.json v${pkg.version}`);
if (cur && cur[1] !== 'v' + pkg.version)
  problems.push(`README ${cur[1]} != package.json v${pkg.version}`);

if (problems.length) {
  console.error('[check-changelog] FAIL\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log(`[check-changelog] OK — CHANGELOG / README / package.json 均为 v${pkg.version}`);
```

- [ ] **Step 2: 写 `scripts/check-doc-links.mjs`**

```js
#!/usr/bin/env node
// 仓库文档相对链接检查（发布门禁「文档链接全绿」的机器化）
// 覆盖 [text](target) 与 ![](src)；http(s)/mailto/#锚点/obsidian: 跳过；不支持 ](<..>) 尖括号形态（本仓库未使用）
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git']);
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(join(dir, e.name));
    } else if (e.name.endsWith('.md')) {
      files.push(join(dir, e.name));
    }
  }
})(root);

let broken = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#|obsidian:)/.test(target)) continue;
    const path = target.split('#')[0];
    if (!path) continue; // 纯页内锚点
    if (!existsSync(resolve(dirname(f), path))) {
      console.error(`断链: ${f} -> ${target}`);
      broken++;
    }
  }
}
if (broken) {
  console.error(`[check-doc-links] FAIL — ${broken} 处断链（${files.length} 个 md 已扫）`);
  process.exit(1);
}
console.log(`[check-doc-links] OK — ${files.length} 个 md 文件 0 断链`);
```

- [ ] **Step 3: ci.yml 加步骤**——`steps:` 的 checkout 之后、`npm ci` 之前插入：

```yaml
      - name: Docs consistency (changelog/README/package version)
        run: node scripts/check-changelog.mjs
```

- [ ] **Step 4: 本地双验**——`node scripts/check-changelog.mjs` 期望 `[check-changelog] OK — … v1.0.0`；`node scripts/check-doc-links.mjs` 期望 `OK — … 0 断链`（Task 1-7 已提交后应全绿；若有断链先修再继续）。
- [ ] **Step 5: Commit**

```bash
git add scripts/check-changelog.mjs scripts/check-doc-links.mjs .github/workflows/ci.yml
git commit -m "ci(gate): 版本一致性守护（CHANGELOG/README/package.json 三方校验）+ 文档链接检查脚本入库"
```

### Task 9: 机器验收波（spec §6.1 五项）

**Files:**
- 无新文件（若验收发现文档问题，修复落回对应文件并随 Task 11 修复波 commit）

- [ ] **Step 1: 链接全绿**——`node scripts/check-doc-links.mjs` → 0 断链。
- [ ] **Step 2: 双语对齐**——中英逐节对照清单（固定核对项）：版本号/日期、497/497+31、DSH 版本窗、Node 22、7 关键词组表行数、预设表 3 行、effort 三入口表述、安装四步命令、模型表 7 行数值、FAQ 5 问对应。
- [ ] **Step 3: 事实对账**——对 Global Constraints 事实零漂移清单逐条在两版 README + CHANGELOG 中 grep 复核（如 `497/497`、`0.1.1-rc.2`、`imageFallback`）；DSH 一句话与 Task 4 Step 1 核实记录一致。
- [ ] **Step 4: 规范自查**——《面向人的文档写法规范》§三七项清单（读者/术语注解/短句/必填可选/数字口径/示例场景/可填格式——本轮无可填表项，标注 N/A）逐项过。
- [ ] **Step 5: 三绿确认**——`packages/dsh-kimi-tide` 下 `npx vitest run --pool=threads`（期望 497/497）+ `npm run typecheck`（0 错误）+ `npm run build`（成功）——确认文档轮未误伤代码面。
- [ ] **Step 6: 版本守护**——`node scripts/check-changelog.mjs` → OK v1.0.0。

### Task 10: Kimi 独立评审轮（spec §6.2，用户裁定）

**Files:**
- Create: `docs/audit/2026-08-31-zero-basis-docs-review-round1.md`（评审结论存档）

**Interfaces:**
- Consumes: Task 1-9 全部产出（评审对象）
- Produces: 分级问题清单 → 修复波（commit 进 Task 11）→ 复检结论

- [ ] **Step 1: 派发评审**——DSH 子代理派发，提示词**首行 `@kimi`**（避路由劫持），`mode` 按现行子代理惯例；任务书按 `docs/templates/review-task.md` 改编为文档审查版，自包含背景 + 评审对象七个文件（README.md / README.en.md / CHANGELOG.md / docs/release-evidence.md / packages/dsh-kimi-tide/README.md / docs/positioning.md diff / 横幅四文件 diff）+ 维度：①零基础首读可懂性（三秒/十秒/一分钟测试）②事实准确性（对照 git 上一版 README 与源码抽查）③链接与结构完整性④双语一致⑤术语注释齐备⑥维护者语言泄漏检查。输出：严重/中等/轻微分级清单 + 待执行验证清单 + 成熟度三级评价；只读不改。评审结论全文存档至 `docs/audit/2026-08-31-zero-basis-docs-review-round1.md`。
- [ ] **Step 2: 额度窗口守门**——若派发失败且时间在 08-31 15:13 UTC 前：挂起（本任务标记 waiting），到窗后重派；**不换评审人、不跳过**（用户点名 kimi 评审）。
- [ ] **Step 3: triage 与修复波**——发现逐条 triage（修 / 已知不修+理由 / 驳回+理由）；「修」项落入修复波 commit。
- [ ] **Step 4: 复检**——按 `docs/templates/recheck-task.md` 第二轮派发（同评审人），确认修复闭环、无新问题；复检结论追加存档同文件。
- [ ] **Step 5: Commit（评审存档）**

```bash
git add docs/audit/2026-08-31-zero-basis-docs-review-round1.md
git commit -m "docs(audit): 零基础化文档改造 Kimi 独立评审 Round1 + 复检结论存档"
```

### Task 11: 收尾（修复波落盘 + 移交用户裁定）

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-zero-basis-docs-design.md`（状态行 →「已实施」）
- Modify: `docs/superpowers/plans/2026-08-31-zero-basis-docs.md`（勾选全部 checkbox + 验收记录回填）

- [ ] **Step 1: 修复波 commit**——Task 10「修」项全部落盘（改动文件按所属归并），commit message 注明评审轮修复。
- [ ] **Step 2: 复跑 Task 9 五项**确认全绿（修复不引入回归）。
- [ ] **Step 3: 状态行与勾选回写**——spec 状态「待用户审定」→「已实施（YYYY-MM-DD，评审 Round1+复检通过）」；本计划 checkbox 全勾 + 末节验收记录（五项结果 + 评审 triage 统计）。
- [ ] **Step 4: 推送 + 移交**

```bash
git push origin docs/1.0.1-zero-basis
```

- [ ] **Step 5: 用户裁定移交**——①合并 main 时点（独立 1.0.1 发版 vs 随 0.8.5）②tag 裁定沿发布门禁（本轮无实机面，门禁=文档五项+评审闭环，无 B/A 清单）③0.8.5-T4 核销注记随合并后回写 0.8.5 计划。收尾落账（协作日志释放+完成条目、台账经发布流程、Daily、调用日志收尾总结）按主库协议执行。

## Risks

- README 整文件重写量大——分两段写（先 §1-7 访客动线，后 §8-12 落点面），每段完成即自查，降低单次写崩风险。
- 双语同构工作量超限 → 降级预案（spec §九）：英文版精简版 + 指向中文详版，需用户现场裁定。
- check-doc-links 对历史档案（specs/plans 大量相对链接）可能挖出存量断链——只修**本轮改动引入**的断链；存量断链列清单另行裁定，不阻塞本轮（脚本无 `--changed` 模式，验收时人工区分归属）。
- kimi 评审额度窗口（08-31 15:13 UTC 前耗尽期）→ 挂起规则见 Task 10 Step 2。

## Non-goals

- 不改任何代码/路由语义/schema；不做 positioning 竞争地图 v2（0.8.5-T5）；不动 hero 资产与 superpowers 档案；不建文档站。
