# README 双语对规则

**规则**：`README.md`（中文主文档）与 `README.en.md`（英文）是**同一份文档的两种语言**，不是两份文档。任何用户可见的改动，必须在同一次提交里两份都改。

## 必须同步的四项（CI 机器判）

`scripts/check-readme-sync.mjs` 每次 push / PR 都会跑，判这四件事：

| # | 判什么 | 口径 |
| --- | --- | --- |
| 1 | 版本行一致 | 中文 `当前版本：**vX.Y.Z（YYYY-MM-DD）**` 与英文 `Current version: **vX.Y.Z (YYYY-MM-DD)**`——版本号与日期都要相同（全半角括号、空格差异不算） |
| 2 | 章节骨架一致 | `##` / `###` 的层级序列一一对应；标题文字按语言不同，但**数量、顺序、层级**必须相同。加一节只加一边 → 拦 |
| 3 | 徽章一致 | 文中远程 `<img src="https://…">`（shields.io / actions badge）集合相同 |
| 4 | 本地文档链接集合一致 | `](…)` 指向仓库内文件的集合必须相同（「文档索引 / Documentation Index」两侧引同一批文件） |

```bash
node scripts/check-readme-sync.mjs
# [check-readme-sync] OK — 版本行 v1.1.0（2026-09-04）、章节骨架 15 节、徽章与本地链接集合两侧一致
```

CI 位置：`.github/workflows/ci.yml` 的 `Docs consistency` 步骤（与 `check-changelog.mjs`、`check-doc-links.mjs` 同批）。

## 允许不同

- **叙述文字**：翻译体量、句式、行数本来就不一样，不做逐行比对。
- **语言资产**：`docs/assets/readme/hero.gif`（中文）与 `hero-en.gif`（英文）是各自的头图，本地图片不在第 3 项比对范围内。
- **语言切换链接**：中文版指向 `README.en.md`、英文版指向 `README.md`，两侧互为镜像，第 4 项按集合比对不受影响。

## 与其它门禁的分工

- `check-changelog.mjs`：CHANGELOG 最新版 == `packages/dsh-kimi-tide/package.json` 版本 == **中文 README 的版本行**（三方一致性）。
- `check-readme-sync.mjs`（本规则）：**中文 README ↔ 英文 README** 的四项一致性。
- `check-doc-links.mjs`：两者引用的本地文件确实存在（不断链）。

三条一起跑：`npm run check`。

## 人工要判的那一半

机器只保证「结构对得上」。以下必须由人和 agent 判断，门禁替代不了：

- 英文版是否**真的表达了**中文版新增的那句话（不是留了个空章节凑数）。
- 新增章节是否**两侧都写实**（骨架一致但英文只有一句「TODO」= 违规）。
- 版本行日期是否是**实际发版日**（改版本号时最容易漏的一处）。

## 失败时怎么办

门禁的报错会点名第几项、第几节、以及哪一侧多/少了什么，例如：

```
[check-readme-sync] FAIL
 - 章节骨架不一致（第 13 个 ## / ### 起分叉）：README.md 共 15 节、README.en.md 共 14 节——新增/删除章节必须两份同步
 - README.en.md 引用了中文版没有的本地文件：docs/new-doc.md
```

按提示补齐另一侧即可；补完后 `node scripts/check-readme-sync.mjs` 应为 OK。
