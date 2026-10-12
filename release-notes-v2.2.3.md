dsh-kimi-tide v2.2.3 —— 分工表队友身份改用权威面优先 · Teammate identity resolved via the authoritative roster surface first

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **修复 · 分工表「队友角色改道」静默失效**：设置页显示第 3 档已就绪（8 个角色参与派发改道），但按认领名派出去的队友全部跑在默认目标上（实测 `backend`／`data`／`qa` 三个认领队友全落 `deepseek-flash`）；现在身份解析改为**权威面优先、失败回落、绝不抛**，认领队友照分工表改道。
- **修复 · 同一条路顺带可观测**：改道生效时派发台账记 `basis='role'` 与队友名，「认领队友跑在哪个模型上」在面板上直接看得见。
- **兼容**：普通子代理、未认领队友、以及不提供权威面的旧宿主，行为与 v2.2.2 逐字节一致。

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.2.3.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web 生效
```

兼容：DSH 0.2.0-rc.2 及以上的 0.2.x；**无需改动 `settings.yaml`**——本版没有新增配置项，也没有配置结构变更。改路由身份判据要重启宿主后生效。

### 验证与验收

- 测试：**1217/1217 通过**（64 个测试文件，v2.2.2 为 1209）；`tsc --noEmit` 0 错；`npm run check` **六闸全过**。
- 实机验收（**已通过**）：修复后在**连续两次重启**里各派一个认领名队友，回读子会话首条 `request/header` —— `frontend` → `kimi-coding/k3`、`security` → `zai-coding-cn/glm-5.3`，**两次都命中分工表目标**（修复前同日 4/4 落默认目标）。判断依据取宿主持久真源。
- **如实标注已知边界**：身份的挂载是**快照式**，而宿主的团队服务可能晚于本插件挂载并触发重挂；实测两次启动的最后一次挂载都在服务就位之后、派发均成功，但**若最后一次配置落点早于服务出现**，仍会静默退化为旧行为（面板照旧显示「已就绪」）。该竞态留待下一版根治。

---

## English

### What's new

- **Fixed — the roster's "teammate role rerouting" failed silently**: the settings page showed the third tier as ready (8 roles participate in dispatch rerouting), yet teammates spawned under a claimed name all ran on the default target (measured: `backend` / `data` / `qa` all landed on `deepseek-flash`); identity resolution is now **authoritative surface first, fall back on failure, never throw**, so claimed teammates are rerouted as configured.
- **Fixed — the same path is now observable**: when rerouting does apply, the dispatch ledger records `basis='role'` plus the teammate name, so "which model is that claimed teammate actually running on" is visible in the panel.
- **Compatibility**: ordinary subagents, unclaimed teammates, and older hosts that expose no authoritative surface behave byte-for-byte as in v2.2.2.

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.2.3.tgz
# or install the same tgz from the Release assets; restart dsh web afterwards
```

Compatibility: DSH 0.2.0-rc.2 and later 0.2.x; **`settings.yaml` needs no edits** — no new options and no config-shape changes. The routing identity change takes effect after the host restarts.

### Verification & acceptance

- Tests: **1217/1217 passing** (64 test files; v2.2.2 was 1209); `tsc --noEmit` clean; `npm run check` **all six gates green**.
- Live acceptance (**passed**): after the fix, a claimed-name teammate was spawned in each of **two consecutive host restarts**, and the child session's first `request/header` was read back — `frontend` → `kimi-coding/k3`, `security` → `zai-coding-cn/glm-5.3`, **both hit the roster target** (before the fix, 4/4 on the same day fell to the default target). The criterion is the host's durable truth.
- **Known boundary, stated honestly**: teammate identity is captured as a **mount-time snapshot**, and the host's team service can arrive after this plugin mounts, which triggers a remount; in both measured starts the last mount happened after the service was present and dispatches rerouted correctly, but **if the last config landing precedes the service's arrival** the plugin still degrades silently to the old behaviour (the settings page keeps showing "ready"). That race is left for the next release.
