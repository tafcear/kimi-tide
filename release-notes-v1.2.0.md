dsh-kimi-tide v1.2.0 —— 会话事件退场，历史日志不再整卷拒载 · Session events step aside; legacy logs load again

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- 面板数据不再写会话日志：dock 快照改经内置只读路由按需现算直读（轮询零持久化），彻底停止日志膨胀——旧方案全库累计 12 万条 / 200+ MB，对话时间线也不再被面板刷新刷屏
- 历史会话照常可读：修复「停止写入面板事件时连事件类型注册一起摘掉」导致的旧会话整卷拒载——带着 `kimi-tide/panel` 的会话重启后重新可读
- dock 取数换安静通道并修正回包解析：不再永久卡「面板数据加载中」；取不到数据时明确显示「暂无面板数据」降级文案，而非假加载态
- dock 动作失败可见：刷新配额 / 切预设 / 手动评审失败时上浮原因，不再静默吞掉
- 评审事件保留：`kimi-tide/review` 仍写入会话日志（评审卡片唯一锚点），手动操作在时间线留可审计记录
- 新增启动级 E2E：隔离启动真 dsh web，自动验证「带自定义事件的会话重启后可读」，正例 + 自动反例双跑

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-1.2.0.tgz
# 或从本 Release 资产安装同名 tgz；装完重启 dsh web 生效（web profile 的 HMR 被官方禁用）
```

兼容：DSH ≥ 0.1.2-rc.1（0.1.5-rc.1 实测）；路由配置格式未变，`settings.yaml` 无需改动，历史会话数据零迁移。

### 验证与验收

- 测试：582/582 通过；typecheck 0；build 通过；CI Node 22/24 双矩阵绿
- 启动级 E2E：`npm run test:e2e` 正例全绿、`--falsify` 反例复现原故障（脚本见 `scripts/e2e/`）
- 实机验收：受影响会话在运行中宿主进程内经 `sessionQuery.observeSession` 逐一打开成功；dock 取数在当前会话实测回包 `kind=success` 且 JSON 可解析

---

## English

### What's new

- Panel data no longer writes to session logs: the dock's snapshot is computed on demand through a built-in read-only route (polling persists nothing) — log bloat stops for good (the old scheme accumulated 120k events / 200+ MB repo-wide), and the conversation timeline is no longer spammed by panel refreshes
- Legacy sessions load again: fixed the regression where dropping the panel event-type registration while stopping the writes made stored logs unreadable — sessions carrying `kimi-tide/panel` are readable after a restart
- The dock fetch moved to a quiet channel with fixed reply parsing: no more being stuck forever at "loading"; when data is unavailable it says so plainly instead of faking a loading state
- Dock action failures are visible: quota refresh / preset switch / manual review failures now surface their reason instead of being silently swallowed
- Review events stay: `kimi-tide/review` is still written to session logs (the only anchor for review cards), and manual actions keep an auditable trail on the timeline
- New boot-level E2E: boots a real isolated dsh web and automatically verifies "sessions carrying custom events are readable after a restart", with a self-falsifying negative case

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-1.2.0.tgz
# or install the same tgz from this Release's assets; restart dsh web afterwards (HMR is disabled for the web profile)
```

Compatibility: DSH ≥ 0.1.2-rc.1 (verified on 0.1.5-rc.1); the routing config format is unchanged, `settings.yaml` needs no edits, and legacy session data migrates nowhere.

### Verification & acceptance

- Tests: 582/582 passing; typecheck clean; build passing; CI green on Node 22/24
- Boot-level E2E: `npm run test:e2e` green; `--falsify` reproduces the original failure (scripts under `scripts/e2e/`)
- Live acceptance: every affected session was opened through `sessionQuery.observeSession` inside the running host process; the dock fetch was probed live on the current session — `kind=success` with parseable JSON
