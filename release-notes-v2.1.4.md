dsh-kimi-tide v2.1.4 —— 包 README 补齐与版本门禁扩面 · Package README catch-up and a wider version gate

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **包 README 补齐三处正文**：这份 README 随插件包 tarball 一起分发——装机用户与第三方插件目录页看到的就是它。此前 v2.1.2 / v2.1.3 两轮只升了它的首屏状态行，正文停在 v2.1.1 的内容面。本版补上：①v2.1.2 的**面板滚动修复**（拖动决策面板／用量总览的滚动条不再关掉面板，并写明「内容不足一屏时滚轮仍会滚到页面并收起面板」这条已知限制）②v2.1.3 的**显示名守卫**（密钥形态或超 40 字符的显示名不保存；`AKIA`／`ASIA` 前缀另设 20 字符下限）③新增**「反馈与提问」一节**——此前这份 README 没有任何反馈入口，而它的状态行却写着「把反馈入口补进 README」。
- **门禁扩面 · 包 README 状态行纳入版本一致性闸**：`npm run check` 里的版本一致性检查由「CHANGELOG / 包版本 / 根 README 版本行」三方扩为**四方**——包 README 首屏状态行的版本号与日期从此必须与 `package.json`、CHANGELOG 标题一致，同类漂移不会再悄悄过关。**门禁仍是五条**（判据是扩的，不是新加一条）。
- **订正 · 分发通道措辞**：文档里「发布到 npm」的说法已订正——本插件**未发布到 npm registry**，分发走 **GitHub Release 资产**（`dsh-kimi-tide-2.1.4.tgz` ＋ 稳定名 `dsh-kimi-tide.tgz`）；第三方插件目录页展示的正是这份包 README，其快照由对方自行重抓。
- **兼容性**：产品面零改动（`src/**` 与 `test/**` 与 v2.1.3 逐字节相同）。**无需迁移、无需改配置。**

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.1.4.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web / 桌面端生效
```

兼容：DSH ≥ `0.1.7-rc.1`（本版与 v2.1.0～v2.1.3 实机验证于 `0.2.0-rc.2` 桌面端）。桌面端以 link 方式安装的用户：本版无产品代码改动，**无需重建产物**。

### 验证与验收

- 测试：**1129/1129 通过**（61 个测试文件，与 v2.1.3 相同——本版无产品代码改动）；`typecheck` 0 报错；`build` 双端通过；仓库门禁 `npm run check` **五闸全绿**；Release 正文双语四段门禁本地通过。
- **新判据负控（双向，实测有牙）**：把包 README 状态行退回 `v2.1.2` ⇒ 门禁红并点名「包 README 随插件包 tarball 分发」；把日期写成 `2026-10-07` ⇒ 门禁红报日期差；还原后文件 SHA256 逐字节一致。
- 发布后核验（资产 sha256 与 API `digest` 逐字一致、包内版本号、文件数）回填 [docs/release-evidence.md](docs/release-evidence.md)。

---

## English

### What's new

- **The package README catches up in three places**: that README ships inside the packed plugin tarball — it is what installers and third-party catalog pages show. v2.1.2 and v2.1.3 bumped only its status line, leaving the body at the v2.1.1 content level. This release fills in (1) the v2.1.2 **panel-scroll fix** (dragging the decision panel's or usage overview's scrollbar no longer closes the panel, plus the documented limitation that a non-scrollable panel still forwards the wheel to the page), (2) the v2.1.3 **display-name guard** (secret-shaped or over-40-character display names are not saved; `AKIA`/`ASIA` keep a 20-character floor), and (3) a new **Feedback & questions** section — that README previously had no feedback entry at all, while its own status line claimed one had been added.
- **Gate coverage extended — the package README status line now joins the version-consistency gate**: `npm run check` used to compare CHANGELOG / package version / root README version line; it now also requires the package README status line's version and date to agree with them, so this drift cannot pass silently again. **Still five gates** — the check was widened, not added.
- **Correction — distribution wording**: a "published to npm" claim in the docs is fixed — this plugin is **not on the npm registry**; it ships as **GitHub Release assets** (`dsh-kimi-tide-<version>.tgz` plus a stable name). Third-party catalog pages show this very README, re-crawled on their own schedule.
- **Compatibility**: zero product changes (`src/**` and `test/**` are byte-identical to v2.1.3). **No migration, no config edits.**

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.1.4.tgz
# or install the same tgz from the Release assets; restart dsh web / the desktop app afterwards
```

Compatibility: DSH ≥ `0.1.7-rc.1` (this release, like v2.1.0–v2.1.3, was verified live on the `0.2.0-rc.2` desktop app). Desktop users installed via `link:`: no product code changed here, so **no rebuild is needed**.

### Verification & acceptance

- Tests: **1129/1129 passing** (61 test files, unchanged from v2.1.3 — no product code changed); `typecheck` 0 errors; `build` passes on both halves; repo gate `npm run check` **all five gates green**; the bilingual four-section release-note gate passes locally.
- **Negative controls for the new predicate (both directions, with teeth)**: rolling the package README status line back to `v2.1.2` turns the gate red and names the reason; setting the date to `2026-10-07` turns it red on the date comparison; the file is byte-identical after restore.
- Post-release verification (asset sha256 against the API `digest`, in-package version, file count) is recorded in [docs/release-evidence.md](docs/release-evidence.md).
