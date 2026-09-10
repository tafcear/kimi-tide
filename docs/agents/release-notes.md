# Release 页面规则：双语 × 四段式

**规则**：每一个新版本的 GitHub Release 正文，都必须是**双语的**（中文整块在上、English 整块在下），且每种语言内部都是四段式——① 一句话定位 ② 本次更新 / What's new ③ 安装与升级 / Install & upgrade ④ 验证与验收 / Verification & acceptance。缺语言、缺段、乱序、留模板占位符，发版流水线会在 `gh release create` 之前拦下。

## 版式（为什么是「整块上下」而不是逐段对照）

```
dsh-kimi-tide vX.Y.Z —— <中文主题> · <English theme>

**简体中文** ｜ [English ↓](#english)

## 简体中文
### 本次更新
### 安装与升级
### 验证与验收

---

## English
### What's new
### Install & upgrade
### Verification & acceptance
```

- **中文在上**：与 README 的主文档（`README.md`）同序，中文读者第一眼看到母语版本。
- **整块而非逐段交替**：读者不需要在两种语言之间来回跳；维护者改一版也只动一半内容，不容易串行错位。
- **两份都要写实**：结构由门禁保证，内容等价由人与评审把关——英文块只留小标题凑结构 = 违规（规则同 README 双语对）。

## 先搞清楚正文从哪来

Release 正文**不是**在网页上手填的，而是**附注 tag 的消息**：

```
git tag -a v1.2.0 -m "<双语四段式正文>"
        │
        ▼
push tag → .github/workflows/release.yml
        │  git tag -l "$TAG" --format='%(contents)' > release-notes.md
        │  node ../../scripts/check-release-notes.mjs --file release-notes.md --version <tag 版本>
        ▼
gh release create --notes-file release-notes.md
```

所以写 tag 消息时就要按双语四段式写；事后在网页上改正文等于改了一份会被下次发版覆盖的副本，不算数。Release 的**标题**（`--title "dsh-kimi-tide vX.Y.Z"`）保持语言中立，由流水线设置——双语要求只针对正文。

## 模板（直接复制改）

````markdown
dsh-kimi-tide vX.Y.Z —— <中文主题> · <English theme>

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- <用户视角的要点：新增 / 修复 / 变更 / 兼容，一条一件事>
- <…>

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-X.Y.Z.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web 生效
```

兼容：DSH ≥ <版本>；<配置/数据是否需要迁移，没有就写「无需改动」>。

### 验证与验收

- 测试：<NNN/NNN 通过>；typecheck 0；build 通过
- 实机验收：<验收清单/记录链接>

---

## English

### What's new

- <user-facing points: added / fixed / changed / compatibility, one item each>
- <…>

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-X.Y.Z.tgz
# or install the same tgz from the Release assets; restart dsh web afterwards
```

Compatibility: DSH ≥ <version>; <config/data migration needed, or "settings.yaml needs no edits">.

### Verification & acceptance

- Tests: <NNN/NNN passing>; typecheck clean; build passing
- Live acceptance: <checklist / record link>
````

## 每段要写什么

| 段 | 中文标题 | 英文标题 | 硬要求（门禁判） | 内容口径 |
| --- | --- | --- | --- | --- |
| ① 一句话定位 | 标题行 | 同左（同一行） | 首行 `dsh-kimi-tide vX.Y.Z —— <中文主题> · <English theme>`，版本与包版本一致，两个主题都非空 | 说「这版做了什么」；中英各一句，用 `·` 分隔 |
| ② 本次更新 | `### 本次更新` | `### What's new` | 两侧各 ≥ 1 条 `- ` 列表项 | 用户视角；一条一件事；commit 锚点、文件路径、池号留给 CHANGELOG 与证据链 |
| ③ 安装与升级 | `### 安装与升级` | `### Install & upgrade` | 两侧各 ≥ 1 个围栏代码块，且块内含 `dsh plugin` | 可复制的安装命令；重启要求、DSH 版本要求、配置是否需要迁移 |
| ④ 验证与验收 | `### 验证与验收` | `### Verification & acceptance` | 两侧非空，且各含测试/验收证据 | 测试数 + typecheck/build；实机验收结论或记录链接 |

标题行两条语言块之外的 `##` 二级标题一律不允许（多了会被点名为「计划外标题」）。`---` 分隔线可有可无，纯排版。

## 门禁用法

```bash
# 草稿文件（推荐：先把正文写成文件，校验通过再贴进 tag 消息）
node scripts/check-release-notes.mjs --file docs/release-notes-v1.2.0.md

# 已存在的附注 tag（顺便校验 tag 版本 == package.json 版本）
node scripts/check-release-notes.mjs --tag v1.2.0

# 管道
git tag -l v1.2.0 --format='%(contents)' | node scripts/check-release-notes.mjs --stdin

# 期望版本号默认取 package.json，可用 --version 覆盖
node scripts/check-release-notes.mjs --file draft.md --version 1.2.0
```

会拒绝：只有一种语言 / 语言块顺序颠倒 / 每块的三段缺一或乱序 / 出现计划外的 `##` 标题 / 「本次更新」没有列表项 / 「安装与升级」没有命令块或没有 `dsh plugin` / 「验证与验收」空着或没有证据 / 标题行缺英文主题 / 还留着 `<中文主题>` 这类占位符 / tag 版本与 `package.json` 对不上。

## 发版顺序（维护者）

```bash
# 1. 版本号与文档面先对齐：CHANGELOG 最新版 == README 两版版本行 == package.json
npm run check
# 2. 写双语正文并本地校验
node scripts/check-release-notes.mjs --file <草稿>
# 3. 打附注 tag（正文粘进去；务必 -a，轻量 tag 没有正文）
git tag -a v1.2.0 -m "<双语四段式正文>"
# 4. 推 tag；release.yml 会再校验一次，不合规就停在 gh release create 之前
git push origin v1.2.0
```

## 覆盖范围与历史

- 本规则自 2026-09-10 起对**新版本**生效，由 `release.yml` 的 `Release notes bilingual four-section gate` 步骤强制执行。
- **双语要求同日起生效**：v1.2.0 是第一个必须双语四段的版本。
- **手工发版同受约束**：不经 Actions、直接 `gh release create` 也必须在发布前跑 `npm run check:release-notes -- --tag vX.Y.Z`（或 `--file <正文>`），把输出记进发布记录。
- v1.1.0 及更早的 Release 是中文单语的三段式，属历史记录，**不回改**；`node scripts/check-release-notes.mjs --tag v1.1.0` 会 FAIL，是预期的。
- 与 README 双语对规则（`docs/agents/readme-pair.md`）同源：机器判结构，人判内容；两边都遵循「中文为主、英文为镜像」。
- 发版前的人工验收门禁（实机验收清单全绿 + 维护者裁定 tag）见 README「开发与测试」段与 `docs/release-evidence.md`，与本规则并行、不互相替代。
