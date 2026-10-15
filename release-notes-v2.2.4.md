dsh-kimi-tide v2.2.4 —— 「档位不可选」不再被说成「模型未声明档位」 · "Effort not selectable" is no longer misread as "the model declares no tier"

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **修复 · 档位下拉的禁用文案分两态**：以前无论是「宿主没发布档位表」还是「这个模型没声明档位」，都显示「跟随默认（该模型未声明档位）」——把**没数据**说成了**模型不支持**（实机：`zai-coding-cn/glm-5.3` 在运行包里明明声明了 `low/high/max`）。现在照实分说：表本身为空 ⇒「跟随默认（档位表未取到）」；表有数据、只缺这一个模型 ⇒ 仍是「跟随默认（该模型未声明档位）」。
- **新增 · 档位表为空时给出可核对的来源说明**：设置页卡片顶部显示一条说明（任何页签可见，表取到后自动消失），用户不必对着灰框猜原因。
- **新增 · 空档位表会自动重试**：插件发现「枚举到了模型，却没有任何一个声明档位」时，按 **5s / 20s** 各再枚举一次（适配器晚于插件注册时自愈，不必重启），两次用尽即停；日志里同时留一条可归因的警告。配置里的目标不在挂载表时同样留痕。
- **兼容**：档位表正常时，行为与 v2.2.3 逐字节一致（新路径只在空表且挂载表非空时生效）；**无需改动 `settings.yaml`**；英文界面文案同步（新增两键 zh/en 同键）。

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.2.4.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web 生效
```

兼容：DSH 0.2.0-rc.2 及以上的 0.2.x；**无需改动 `settings.yaml`**。本次改的是宿主侧发布逻辑与设置页文案，**重启宿主后生效**。

### 验证与验收

- 测试：**1227/1227 通过**（64 个测试文件，v2.2.3 为 1217）；`tsc --noEmit` 0 错；`npm run check` **六闸全过**；build（host + 客户端 bundle）通过。
- 实机验收（**已通过**）：桌面端（desktop profile）重启后，宿主发布的档位表回到 **11 个模型**（含 `zai-coding-cn/glm-5.3` 的 `low/high/max`、`qwen-token-plan-cn/qwen3.8-max` 的 `low/medium/xhigh`）；分工表「后端」那行的档位**可以改选**，卡片顶部**不再**出现空表提示；`roles.backend.target` 落 `effort: max` 后路由目标正确。
- **如实标注边界**：本版**不改变**宿主为什么在某些运行里报不出档位（那是宿主侧的枚举时序问题）。本版保证三件事：没数据不再被误述、空表会自动重试两次、日志留下可归因的警告。实机现场那一轮的空表在重启后自愈，**上游真因仍未证**。

---

## English

### What's new

- **Fixed — the disabled effort dropdown now says which of two states it is**: it used to read "Follow default (this model declares no effort tiers)" whether the host had published no table at all or the single model declared none — reporting **missing data** as **missing capability** (measured: `zai-coding-cn/glm-5.3` ships `low/high/max` in the running build). Now they read apart: an empty table ⇒ "Follow default (no effort table)"; a populated table missing just this model ⇒ the original wording.
- **Added — an empty effort table shows a verifiable source note**: a notice at the top of the settings card (visible on every tab, gone once the table arrives), so nobody has to guess from a greyed-out control.
- **Added — an empty effort table retries by itself**: when the plugin enumerates models but none declares a tier, it re-enumerates once after **5s** and once after **20s** (self-healing when adapters register after the plugin; no restart needed), then stops; a matching warning is left in the log. Configured targets that are missing from the mounted table are logged too.
- **Compatibility**: with a healthy effort table, behaviour is byte-for-byte v2.2.3 (the new path only triggers on an empty table with a non-empty mounted table); **`settings.yaml` needs no edits**; the English UI copy is in sync (two new keys, same keys in zh/en).

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.2.4.tgz
# or install the same tgz from the Release assets; restart dsh web afterwards
```

Compatibility: DSH 0.2.0-rc.2 and later 0.2.x; **`settings.yaml` needs no edits**. This release touches the host-side publishing logic and the settings copy — it takes effect after the host restarts.

### Verification & acceptance

- Tests: **1227/1227 passing** (64 test files; v2.2.3 was 1217); `tsc --noEmit` clean; `npm run check` **all six gates green**; build (host + client bundle) passing.
- Live acceptance (**passed**): after restarting the desktop app (desktop profile), the host-published effort table is back with **11 models** (including `zai-coding-cn/glm-5.3` → `low/high/max` and `qwen-token-plan-cn/qwen3.8-max` → `low/medium/xhigh`); the assignment table's "backend" row effort is **selectable**, the empty-table notice is **gone**, and `roles.backend.target` routes with `effort: max`.
- **Known boundary, stated honestly**: this release does **not** change why the host reports no tiers in some runs (that is a host-side enumeration-timing question). What it guarantees is three things: missing data is no longer misreported, an empty table is retried twice automatically, and the log carries an attributable warning. The empty table observed on 2026-10-15 healed on restart; **the upstream cause remains unproven**.
