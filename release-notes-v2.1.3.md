dsh-kimi-tide v2.1.3 —— 显示名密钥守卫 · A secret-shaped display name is refused, not persisted

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **修复 · 预设与角色的「显示名」不再把剪贴板里的密钥存下来**：这两处输入都是「用户输入 → 逐字落盘」的通道。把 API key 当名字粘进去，它会明文进配置，并随 `/kimi-tide export-config`、截图或 issue 附件外泄。现在两条通道共用一处判据：命中常见密钥前缀（`sk-`／`sk_`／`ghp_`／`gho_`／`ghs_`／`github_pat_`／`AKIA`／`ASIA`／`xoxb-`／`xoxp-`／`AIza`／`Bearer `）或「≥32 字符、无空白、令牌字符占比 ≥90%」⇒ **拒绝写入**，字段下给出说明并置 `aria-invalid`；显示名另加 40 字符上限，顺带挡住「整条剪贴板」。
- **已知取舍（有意保留，注释与测试都写明）**：`AKIA`／`ASIA` 前缀要求长度 ≥ 20——真实 AWS 访问密钥 id 是前缀 4 位加 16 位，所以叫「Asia 团队」的预设不会被误杀；≥32 字符无空格的机器名仍会命中长随机串判据，这是该启发式的代价，改判据只需动一个文件。
- **新增 · 反馈入口**：README 首屏与 issue 模板补齐。Bug 表单只要最小复现信息：kimi-tide 版本、DSH 版本、桌面端或网页端、复现步骤、`/kimi-tide show` 的输出。另设置顶讨论与 Q&A 两个落点。
- **兼容性**：只影响设置页两个输入框的校验；配置、路由、命令行为未改。**无需迁移、无需改配置。**

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.1.3.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web / 桌面端生效
```

兼容：DSH ≥ `0.1.7-rc.1`（本版与 v2.1.0～v2.1.2 实机验证于 `0.2.0-rc.2` 桌面端）。桌面端以 link 方式安装的用户：更新代码后重跑 `npm run build`（产物先于重启）。

### 验证与验收

- 测试：**1129/1129 通过**（61 个测试文件，比 v2.1.2 多 40 条）；`typecheck` 0 报错；仓库门禁 `npm run check` **五闸全绿**；Release 正文双语四段门禁本地通过。
- **负控有牙（双向）**：放松显示名长度上限 ⇒ 2 条长度用例变红；把 `AKIA`／`ASIA` 的下限调过头 ⇒ 2 条 AWS 命中用例变红。两轮都只红相关用例，还原后全绿。
- **来源**：外部用户 dracpet 在 2026-08-21 的实测回访里提出（预设名输入框会把剪贴板里的 API key 当作名字）；本版修掉，并在该贴下回复。

---

## English

### What's new

- **Fix — a display name can no longer persist a pasted API key**: the preset-name and role-label inputs both wrote user input verbatim into the config. Pasting an API key as a name put it in plaintext into the config, where it leaks through `/kimi-tide export-config`, screenshots and issue attachments. Both inputs now share one predicate: a known key prefix (`sk-`, `sk_`, `ghp_`, `gho_`, `ghs_`, `github_pat_`, `AKIA`, `ASIA`, `xoxb-`, `xoxp-`, `AIza`, `Bearer `) or a ≥32-character, whitespace-free token-shaped string is **refused** — inline explanation, `aria-invalid`, nothing persisted. Display names are also capped at 40 characters.
- **Deliberate trade-offs (documented in code and pinned by tests)**: `AKIA`/`ASIA` require a length of ≥20 — real AWS access key ids are the 4-character prefix plus 16 — so a preset literally named 「Asia 团队」 is not rejected. A ≥32-character whitespace-free machine-ish name still trips the long-random-string rule; that is the cost of the heuristic, and changing it means touching one file.
- **New — feedback entry points**: the README first screen and issue templates. The bug form asks only for the minimum: kimi-tide version, DSH version, desktop or web, reproduction steps, and the output of `/kimi-tide show`. A pinned discussion and Q&A are linked as well.
- **Compatibility**: only the validation of two settings-card inputs changes; config, routing and commands are untouched. **No migration, no config edits.**

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.1.3.tgz
# or install the same tgz from the Release assets; restart dsh web / the desktop app afterwards
```

Compatibility: DSH ≥ `0.1.7-rc.1` (this release, like v2.1.0–v2.1.2, was verified live on the `0.2.0-rc.2` desktop app). Desktop users installed via `link:`: re-run `npm run build` after updating the code (build before restart).

### Verification & acceptance

- Tests: **1129/1129 passing** (61 test files, forty more than v2.1.2); `typecheck` 0 errors; repo gate `npm run check` **all five gates green**; the bilingual four-section release-note gate passes locally.
- **Negative controls with teeth, in both directions**: relaxing the display-name length cap turns 2 length cases red; pushing the `AKIA`/`ASIA` floor too high turns 2 AWS-key cases red. Only the relevant cases fail, and everything is green again after restore.
- **Origin**: raised by the external user `dracpet` in their 2026-08-21 field report-back (the preset-name field persisting a pasted API key); fixed here and answered in that thread.
