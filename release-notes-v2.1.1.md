dsh-kimi-tide v2.1.1 —— 文档与验收回填（无功能变更） · Docs & acceptance backfill (no functional change)

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **实机验收闭环**：v2.1.0 的四处新增面——设置卡「界面语言」行、英文界面、分工表示例两个按钮、Plugin Manager 与设置页插件行的标题与描述——经用户重启宿主后**逐项目检通过**；结论与机器侧旁证已回填 `docs/release-evidence.md` 与验收 runbook（新增 §4.1）。
- **B-4 写通道判据复跑仍通过**：用户把示例角色加进真实配置之后，`scripts/acceptance/check-routes-dualwrite.mjs` 仍 `exit=0`——`routes` 9 行（session 1 / dispatch 8）与镜像旧字段逐行语义一致、配置校验通过。
- **新增待办 Q11「按角色配 skills」**：让分工角色除目标模型外还能声明该用哪些 skill；含两条硬取证（Agent Teams 的成员快照与 `spawn_teammate` 都没有 skills 入参；技能注册表是 host + per-scope 分层）与三条候选路线，见 `docs/superpowers/backlog.md`。
- **协作手册补「派活机制选型判据」**：一次性子代理 / fork / workflow 扇出 / Agent Teams 四档机制各自适用的活形状与代价，附三种团队范式（orchestrator–worker / peer·blackboard / pipeline）对比，见 `docs/agent-collaboration-loop.md` §5.1。
- **产品行为无变更**：`src/**` 与 `test/**` 与 v2.1.0 **逐字节相同**；本版只改文档与验收记录。

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.1.1.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web / 桌面端生效
```

兼容：DSH ≥ `0.1.7-rc.1`（本版与 v2.1.0 实机验证于 `0.2.0-rc.2` 桌面端）。**无需迁移、无需改配置**；已在 v2.1.0 的用户升级后行为完全一致。桌面端以 link 方式安装的用户：更新代码后重跑 `npm run build`（产物先于重启）。

### 验证与验收

- 测试：**1084/1084 通过**（60 个测试文件）；typecheck 0 报错；build 双端通过；仓库门禁 `npm run check` **五闸全绿**（changelog / doc-links / readme-sync / terminology / client-i18n）；Release 正文双语四段门禁本地通过。
- **实机验收（2026-10-08，桌面端 0.2.0-rc.2）**：v2.1.0 四处新增面**用户目检通过**；B-4 判据复跑 `exit=0`。
- **与 v2.1.0 的差异仅为文档**：`git diff v2.1.0..v2.1.1 -- packages/dsh-kimi-tide/src packages/dsh-kimi-tide/test` **为空**。

---

## English

### What's new

- **Live acceptance closed**: the four surfaces added in v2.1.0 — the settings-card interface-language row, the English UI, the two roster-example buttons, and the Plugin Manager / Settings plugin-row title and description — were all eyeballed by the user after restarting the host; results and machine-side corroboration are recorded in `docs/release-evidence.md` and the acceptance runbook (new §4.1).
- **The B-4 write-path criterion still passes on a re-run**: after the user added example roles to the real config, `scripts/acceptance/check-routes-dualwrite.mjs` still exits 0 — `routes`, 9 rows (1 session / 8 dispatch), semantically identical row by row to the mirrored legacy fields, with validation passing.
- **New backlog item Q11 — per-role skills**: letting a roster role declare which skills it should use, on top of its target model; it records two hard findings (the Agent Teams member snapshot and `spawn_teammate` carry no skills parameter; the skill registry is host + per-scope layered) and three candidate routes, in `docs/superpowers/backlog.md`.
- **The collaboration playbook gains a delegation-mechanism table**: which shape of work suits one-shot subagents, forks, workflow fan-out, or Agent Teams — with the cost of each, plus a comparison of three team paradigms (orchestrator–worker / peer·blackboard / pipeline), in `docs/agent-collaboration-loop.md` §5.1.
- **No product behaviour change**: `src/**` and `test/**` are **byte-identical** to v2.1.0; this release only touches documentation and acceptance records.

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.1.1.tgz
# or install the same tgz from the Release assets; restart dsh web / the desktop app afterwards
```

Compatibility: DSH ≥ `0.1.7-rc.1` (this release, like v2.1.0, was verified live on the `0.2.0-rc.2` desktop app). **No migration and no config edits**; behaviour is identical for anyone already on v2.1.0. Desktop users installed via `link:`: re-run `npm run build` after updating the code (build before restart).

### Verification & acceptance

- Tests: **1084/1084 passing** (60 test files); typecheck 0 errors; both build halves pass; repo gate `npm run check` **all five gates green** (changelog / doc-links / readme-sync / terminology / client-i18n); the bilingual four-section release-note gate passes locally.
- **Live acceptance (2026-10-08, desktop 0.2.0-rc.2)**: the four v2.1.0 additions were eyeballed by the user; the B-4 criterion re-run exits 0.
- **The only difference from v2.1.0 is documentation**: `git diff v2.1.0..v2.1.1 -- packages/dsh-kimi-tide/src packages/dsh-kimi-tide/test` **is empty**.
