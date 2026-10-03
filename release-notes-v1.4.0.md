dsh-kimi-tide v1.4.0 —— 评审闭环：干不好就退回重做 · Review closure: send it back for rework

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **「自动修订」不再是死开关**：设置页那个复选框以前勾了没有任何行为。现在评审判「**不通过 / 有条件通过**」时，它真的会按意见把活**退回给主模型重做**；判「通过」或结论读不出来时**不动手**（不猜）。默认**关**。
- **手动一键退回**：每张评审卡上多了「**让它重做**」按钮（也可敲 `/kimi-tide revise`）——**不勾自动修订也能用**，评审判「通过」时你想返工照样能退。
- **修订后复检（新开关，默认开）**：重做完成后再评一轮，确认问题真的修掉了。代价写明白：每次退回多一轮主模型调用，复检再多一次评审调用。
- **不会失控**：每会话最多退回「轮数」次（1–3），到顶后事件卡直接写「**已停（达上限）**」；评审本身失败（超时/空输出）绝不触发退回；每次退回都在会话流里留一张退回卡，会话日志里也有一条可回读的记录。
- **退回不是替你改代码**：它往那一轮注入一条「按意见修订」的消息，让主模型**只改被指出的问题**；原产出仍在会话日志里，随时可回看。
- **桌面端能装了（DSH 0.2.0-rc.2）**：此前插件声明的宿主版本上界是 `<0.2.0-0`，桌面端升级后会被判「不兼容」而拒绝安装/激活——上界已放宽到 `<0.3.0-0`，依赖整体对齐 0.2.0-rc.2。
- **月汐状态行挪到输入框工具行右端**：原先它在输入框**下方**独占一整行；现在缩成工具行里两个小按钮（`省钱 → deepseek-flash` 点开决策面板、`¥3.94` / `周剩NN%` 点开用量总览），与权限 / 模型 / 语音并排，不再多占一行。

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-1.4.0.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web / 桌面端生效
```

兼容：DSH ≥ `0.1.7-rc.1`（本版实机验证于 `0.2.0-rc.2`，桌面端与 web 端同源）。**配置无需迁移**：旧的预设/规则/协作流配置原样可用；新增的 `flows.review.recheck` 不写也按**开**处理（默认开），想关就在设置页取消勾选。

### 验证与验收

- 测试：**779/779 通过**（本版新增 46 例：结论解析 20 / 修订注入 5 / 编排 14 / 卡片 7）；typecheck 0 报错；build 通过（host + client）；仓库门禁 `npm run check` 三脚本 exit 0
- **独立只读复核**：对未提交快照做静态复核，6 条确证缺陷 + 8 条疑点逐条处置（修 5、驳回 1 附反证用例、5 条升级为实机必录项），处置表见设计稿 §8.1；修复点做 3 次**变异检验**（改坏 → 对应用例必须红，全部命中后回退）
- **桌面端装载（活体证据）**：宿主自报条目 `active`；dock / 设置页 / 评审卡 / 退回卡四个注册点全部就位；会话槽契约确认带 `sessionId`（按钮可点的依据）。证据链 `docs/audit/2026-10-03-host-0.2.0-rc.2-desktop-port.md`
- **实机验收（真宿主 desktop profile，2026-10-03）通过**：手动评审（`turn:-1`）判「有条件通过」⇒ 点评审卡「让它重做」⇒ 退回留痕 `reason:manual / reviseIndex:1` ⇒ **复检自动落到修订轮**（第二条带 `verdict` 的评审记录，`turn=6`，只评一次）。会话 `session-dce497aa…`；两条记录的 reviewer 均为 `kimi-coding/k3`，顺带验证了新接入的 Kimi Code 通道。**未覆盖**：自动模式（该会话 `autoRevise:false`）与「达上限即停」（未触达上限）——留待后续实机。

---

## English

### What's new

- **"Auto-revise" is no longer a dead switch**: the checkbox in settings used to do nothing at all. Now, when the review verdict is "**fail / conditional pass**", it really does **send the work back to the main model for rework**; a "pass" verdict — or one that cannot be parsed — never triggers it (no guessing). Off by default.
- **One-click manual send-back**: every review card now carries a "**let it redo**" button (or type `/kimi-tide revise`) — it works **without auto-revise**, so you can ask for rework even when the verdict was "pass".
- **Re-check after revise (new switch, on by default)**: the rework is reviewed once more to confirm the issues are really gone. The cost is stated plainly: each send-back costs one extra main-model turn, and re-check adds one extra review call.
- **It cannot run away**: at most `rounds` (1–3) sends per session; after that the card reads "**stopped (cap reached)**"; a failed review (timeout / empty output) never triggers a send-back; every send leaves a send-back card in the conversation and a readable record in the session log.
- **Sending it back does not edit your code for you**: it injects one "revise per this feedback" message into that turn so the main model **fixes only what was flagged**; the original output stays in the session log, always reviewable.
- **Desktop installs again (DSH 0.2.0-rc.2)**: the plugin used to declare a host upper bound of `<0.2.0-0`, so an upgraded desktop host rejected installation/activation as incompatible — the bound is now `<0.3.0-0`, with dependencies aligned to 0.2.0-rc.2.
- **The 月汐 status row moved to the composer tool row**: it used to occupy its own line under the input box; it is now two small buttons in the tool row (`省钱 → deepseek-flash` opens the decision panel, `¥3.94` / `周剩NN%` opens the usage overview) beside permission / model / voice, so it no longer costs a line.

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-1.4.0.tgz
# or install the same tgz from the Release assets; restart dsh web / the desktop app afterwards
```

Compatible with DSH ≥ `0.1.7-rc.1` (verified on `0.2.0-rc.2`, desktop and web share the same core). **No config migration needed**: existing presets / rules / collaboration flows keep working, and the new `flows.review.recheck` behaves as **on** when absent (the default); untick it in settings to turn it off.

### Verification & acceptance

- Tests: **779/779 passing** (46 added by this release: verdict parsing 20 / revise message 5 / orchestration 14 / cards 7); typecheck clean; build passing (host + client); repo gates `npm run check` exit 0
- **Independent read-only review**: a static review of the uncommitted snapshot produced 6 confirmed defects + 8 open questions, each dispositioned (5 fixed, 1 rejected with a counter-test, 5 promoted to mandatory live checks) — see the design doc §8.1; the fixes were falsified with 3 mutation checks (break the fix → the matching test must go red; all three caught, then reverted)
- **Desktop load (live evidence)**: the host reports the entry as `active`; dock / settings page / review card / send-back card all registered; the session slot contract confirms it receives `sessionId` (what makes the button clickable). Evidence: `docs/audit/2026-10-03-host-0.2.0-rc.2-desktop-port.md`
- **On-device acceptance (real host, desktop profile, 2026-10-03): passed** — a manual review (`turn:-1`) returned "conditional pass" ⇒ clicking "let it redo" on the review card left a send-back record (`reason:manual / reviseIndex:1`) ⇒ **the re-check landed on the reworked turn** (a second review record carrying `verdict`, `turn=6`, reviewed exactly once). Session `session-dce497aa…`; both records name `kimi-coding/k3` as the reviewer, which also verifies the newly wired Kimi Code route. **Not covered**: auto mode (that session ran `autoRevise:false`) and the cap-reached stop (the cap was never hit) — left for a later on-device pass.
