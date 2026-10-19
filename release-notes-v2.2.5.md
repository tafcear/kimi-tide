dsh-kimi-tide v2.2.5 —— DSH 0.2.1 上「档位又不可选了」：空池不再被当成终局 · "Effort tiers disabled again" on DSH 0.2.1: an empty pool is no longer final

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **修复 · DSH 0.2.1 上档位下拉再次全部禁用**：设置页分工表的档位「又不可选」，没有存量值的行显示「跟随默认（档位表未取到）」。真身不是模型没能力，而是**宿主模型目录/凭据解析异步就绪**：插件挂载时路由已在、`listModels` 却还回空（实测约 3 秒后才回模型），这段空池被发布成 `efforts: {}` + `mounted: []` 并持久化，且当时的重试判据认为「挂载表为空 = 等宿主事件」而不重试 ⇒ 档位表永久为空。
- **修复 · 插件重载不再把好表覆盖成空**：以前每次插件重载都按空目录发布首帧，叠加上述空池就会出现「凭据一更新，原本可用的档位表被永久清空」。现在重载时先读回已达盘的 `efforts`/`mounted` 再发布，空池只按**瞬态**处理（保留上一轮目录、不发布空表）。
- **新增 · 空池有界自动重试**：空池或空表时按 5s / 20s 各再枚举一次（用尽即停），枚举到可用模型才发布；`credentials/reference-updated` 事件也会立即重枚举并重置重试预算，因此宿主的异步就绪窗口过去后设置页会自愈，不必手工改配置。
- **可归因的日志**：空池留一条「本轮候选枚举为空……保留上一轮档位表并自动重试」的警告；「有模型但无档位」仍用 v2.2.4 的两态文案与来源说明。
- **兼容**：档位表正常的主机（含 DSH 0.2.0 及更早、`listModels` 即时可用的版本）行为与 v2.2.4 一致——新路径只在空池/空表时生效。客户端零改动（volatile 字段形状不变）；**无需改动 `settings.yaml` 或 profile patch**；已被写成空表的旧现场，重启后自动回填。

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.2.5.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web / 桌面端生效
```

兼容：DSH 0.2.0-rc.2 及以上的 0.2.x；无需改动 `settings.yaml`。本次改的是宿主侧枚举与发布逻辑，**重启宿主后生效**；重启后若首轮枚举仍落在异步窗口里，最多 5s 后会自行回填。

### 验证与验收

- 测试：**1236/1236 通过**（65 个测试文件，v2.2.4 为 1227；新增 3 条空池回归用例，**把源码回退到 v2.2.4 后 3 条全红**）；`tsc --noEmit` 0 错；build（host + 客户端 bundle）通过；`npm run check` 六闸全过。
- 实机端到端（DSH 0.2.1-rc.2，隔离 profile 真启动）：起点为实机同款 `efforts: {}` + `mounted: []`，修复后的插件在同一 profile 里自动重试并回填 **8 个模型的档位表**（`deepseek-official`／`deepseek-account` 各 2 个模型、`zai-coding-cn` 3 个、`kimi-coding/k3`），无需手工改文件。
- 桌面端目检：**重启桌面端后**设置页「月汐 → 路由」各角色行的档位下拉应可选、空表提示消失（用户实机回执待补；这是本版发布的最后一道人工判据）。

---

## English

### What's new

- **Fixed — every effort-tier dropdown disabled again on DSH 0.2.1**: the dispatch table's tiers were unselectable and rows without a stored value showed "Follow default (no effort table)". The cause was not model capability but the **host's asynchronously-ready model catalog/credentials**: at plugin mount the routes already existed while `listModels` still returned nothing (measured: models arrive ~3s later). That empty pool was published as `efforts: {}` + `mounted: []` and persisted; the retry predicate then read "empty mounted table = wait for a host event" and never retried — so the table stayed empty for good.
- **Fixed — a plugin reload no longer overwrites a good table with an empty one**: every reload used to publish an empty first frame; combined with the empty pool, one reload (e.g. a credentials refresh) could permanently wipe a working effort table. A reload now reads back the persisted `efforts`/`mounted` and publishes that first, and an empty pool is treated as **transient** (keep the previous table, never publish an empty one).
- **Added — bounded automatic retry for an empty pool**: when the pool or the table is empty, the plugin re-enumerates after 5s and 20s (then stops) and publishes only once usable models are enumerated. A `credentials/reference-updated` event also re-enumerates immediately and resets the retry budget, so the settings page heals itself once the host's asynchronous window passes — no manual config edits.
- **Attributable logging**: an empty pool leaves one "candidate enumeration came back empty … keeping the previously published effort table and retrying" warning; "models exist but declare no tier" keeps the v2.2.4 two-state copy and source note.
- **Compatibility**: on hosts with a healthy effort table (DSH 0.2.0 and earlier, where `listModels` answers immediately) behaviour is identical to v2.2.4 — the new path only runs on an empty pool/table. No client changes (the volatile section shape is unchanged); **`settings.yaml` and profile patches need no edits**; profiles already stuck with an empty table recover automatically after a restart.

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.2.5.tgz
# or install the same tgz from the Release assets; restart dsh web / the desktop app afterwards
```

Compatibility: DSH ≥ 0.2.0-rc.2 (0.2.x); no `settings.yaml` edits needed. The change is host-side enumeration/publishing, so it takes effect **after a host restart**; if the first enumeration still lands inside the asynchronous window, it recovers within 5s.

### Verification & acceptance

- Tests: **1236/1236 passing** (65 test files, up from 1227 in v2.2.4; 3 new empty-pool regression tests — **all 3 fail when the sources are reverted to v2.2.4**); `tsc --noEmit` clean; build (host + client bundle) passing; `npm run check` six gates green.
- Live end-to-end (DSH 0.2.1-rc.2, isolated profile, real boot): starting from the same `efforts: {}` + `mounted: []` as the reported case, the fixed plugin retried by itself and republished an **8-model effort table** (`deepseek-official` / `deepseek-account` with 2 models each, 3 for `zai-coding-cn`, plus `kimi-coding/k3`) — no manual file edits.
- Desktop eye-check: after **restarting the desktop app**, each role row's effort dropdown in Settings → 月汐 → Routing should be selectable and the empty-table notice gone (the user's live confirmation is the final human gate for this release).
