dsh-kimi-tide v2.2.1 —— 护栏真的护住主会话了：修掉一条失效判据，并把拦截范围扩到 workflow · The guard now really guards the main session — a broken predicate fixed, and workflow brought into scope

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **修复 · 派发护栏对主会话完全不生效（v2.2.0 起）**：v2.2.0 的护栏判「调用方是不是队友」时，把宿主给**没有父会话的根会话（＝主会话）**返回的 `{ role: 'lead', name: 'lead' }`（隐式根 Team 的正常返回）误当成队友身份 ⇒ 主会话自己派出的活**从不被拦**（子代理侧倒是拦得住）。本版改为**只认 `role === 'teammate'`**（新导出的纯函数 `isTeammateMembership()`，与分工表改道同一条判据）。**已开启护栏的用户，从本版起才真正受保护**；关闭态行为逐字节不变。
- **变更 · 拦截范围扩到 `workflow`**：脚本里 `agent()` **一次都没点名目标**（全文没有词边界级的 `provider` / `model`）⇒ 这次 `workflow` 派发被**拒绝**，理由写明两条改法（逐次点名，或改用 `spawn_teammate` 派给该角色的队友）。**确实要走默认目标**：把默认目标显式写进 `provider` / `model` 即放行。来源是 2026-10-08 一次实测事故：三个「独立评审」子代理因脚本没点名，全部跑在默认目标上，而派发说明写着「三个不同模型」。
- **新增 · 分工表技能正文的「派完怎么验」一节**：判断改道**只有一个判据**——子会话的**首条 `request/header` 事件**（宿主持久真源）；会话头、`descriptor.agentModel`、`list_agents` 在改道后都会漂移，照它们判会判错。技能同时给出本仓的一条命令与仓库外的通用做法，并写明一句实话：「我以为我传了」不算证据。
- **新增 · 派发路由核验脚本**：`node scripts/acceptance/check-dispatch-routing.mjs <父会话 id> [--last N] [--expect provider/model,...]`——按父会话列出**每个子会话实际跑在哪个模型**，可逐项断言（退出码 `0` 通过 / `1` 不一致 / `2` 用法或读取错误）。
- **新增 · 密钥门禁（仓库门禁由五条扩为六条）**：`cordis*.yml` / `cordis*.yaml` 出现**赋值型密钥字段**（`apiKey:` / `secret:` / `token:` 等）或**密钥字面量**（`sk-…`、`ghp_…`、`AKIA…`、PEM 私钥、JWT）即红；发布面（`src/**`、`locale/**`、两份 `package.json`）再扫一遍高置信形态。命中时**只打印掩码**（前 4 字符 ＋ 总长），绝不打印完整值。判据**刻意收窄**——仓库里有大量在讨论密钥前缀的合法文本，误报的门禁会被关掉。
- **兼容性与迁移**：`dispatchGuard` 仍**默认关闭**，不开启时行为与本版之前逐字节一致，**升级无需改配置**；护栏的 `subagent` / `subagent_fork` 既有判据逐字节未动。以 `link:` 方式安装的用户：本版**有产品代码改动**，装后请 `npm run build` 重建产物。

### 安装与升级

```bash
# 方式一（推荐）：直接从 npm 装
dsh plugin --profile web add dsh-kimi-tide

# 方式二：从 Release 资产装（离线或固定版本）
dsh plugin --profile web add ./dsh-kimi-tide-2.2.1.tgz

# 装完重启 dsh web / 桌面端生效
```

兼容：DSH ≥ `0.1.7-rc.1`（本版实机验证于 `0.2.0-rc.2` 桌面端）。升级**不需要改配置**；已经开启护栏的配置**从本版起才真正生效**。

### 验证与验收

- 测试：**1170/1170 通过**（62 个测试文件，本批新增 12 条，含护栏判据的接入级回归钉）；`typecheck` 0 报错；`build` 双端通过；仓库门禁 `npm run check` **六条全绿**（第六条＝本版新增的密钥门禁）；Release 正文双语四段门禁本地通过。
- **护栏实机验收（本版结清 v2.2.0 的欠账）**：① 对**构建产物**跑判据矩阵 **39/39 通过**；② 配置热重挂（改 profile 文件即重挂，无需重启）；③ 宿主的工具闸通路确实生效（子代理侧领域命中派发被拒、理由逐字返回）；④ **重启宿主后**在主会话实测四项——领域命中 `subagent` ⇒ **拒**（修复生效）、未点名 `workflow` ⇒ **拒**、已点名 `workflow` ⇒ **放行**且子会话 `request/header` 与点名目标**逐字一致**、无领域词 `subagent` ⇒ 放行（不误拦）。记录与证据会话号见 [packages/dsh-kimi-tide/docs/team-dispatch-acceptance.md](packages/dsh-kimi-tide/docs/team-dispatch-acceptance.md) 的「派发护栏实机验收（2026-10-09）」节。
- **如实标注**：护栏的 workflow 判据是**词级启发式**（宁可漏拦不可误拦——脚本里出现 `model` 一词即视为点过名）；「队友自己派活 ⇒ 不拦」一条未现场造队友验证，由接入级单测与 2026-10-06 的队友改道实机证据覆盖。
- 发布后核验（资产 sha256 与 API `digest` 逐字一致、包内版本号、文件数）回填 [docs/release-evidence.md](docs/release-evidence.md)。

---

## English

### What's new

- **Fixed — the dispatch guard never fired for the main session (since v2.2.0)**: to decide "is the caller a teammate", v2.2.0 read the host's `{ role: 'lead', name: 'lead' }` — the normal return for a **root session with no parent (that is, the main session)** — as teammate identity, so anything the main session dispatched was **never** refused (the child side was guarded fine). This release accepts **only `role === 'teammate'`** (new exported pure function `isTeammateMembership()`, the same predicate the role table uses for rerouting). **Users who had the guard on are only actually protected from this version on**; with it off, behaviour is byte-identical.
- **Changed — scope extended to `workflow`**: a `workflow` dispatch whose script calls `agent()` **without naming a target anywhere** (no word-boundary `provider` / `model`) is now **refused**, and the refusal names both fixes (name a target per call, or use `spawn_teammate` to hand the work to that role's teammate). **Deliberately running on the default target?** Write the default target explicitly into `provider` / `model` and the dispatch passes. Origin: a measured incident on 2026-10-08, where three "independent review" subagents all ran on the default target because the script named nothing, while the dispatch description claimed "three different models".
- **New — a "how to verify a dispatch" section in the role-table skill**: there is **exactly one** predicate for rerouting — the child's **first `request/header` event** (the host's durable source of truth). Session headers, `descriptor.agentModel` and `list_agents` all drift after a reroute, so judging by them gets it wrong. The skill also carries the one-liner for this repo, the portable recipe elsewhere, and one honest line: "I thought I passed it" is not evidence.
- **New — a dispatch-routing verification script**: `node scripts/acceptance/check-dispatch-routing.mjs <parent session id> [--last N] [--expect provider/model,...]` lists **which model each child session actually ran on** and can assert it item by item (exit codes `0` pass / `1` mismatch / `2` usage or read error).
- **New — a secrets gate (repo gates go from five to six)**: any **assignment-style key field** (`apiKey:` / `secret:` / `token:` …) or **key literal** (`sk-…`, `ghp_…`, `AKIA…`, PEM private keys, JWTs) in `cordis*.yml` / `cordis*.yaml` turns the gate red, plus a second pass over the published surface (`src/**`, `locale/**`, both `package.json` files) for high-confidence shapes. Hits are reported **masked only** (first four characters plus total length) — never the full value. The predicate is **deliberately narrow**: this repo legitimately discusses key prefixes in several places, and a gate that cries wolf gets turned off.
- **Compatibility & migration**: `dispatchGuard` is still **off by default** — with it off, behaviour is byte-identical to the previous release and **no config edit is needed**; the guard's existing `subagent` / `subagent_fork` predicate is untouched. Installed via `link:`? This release **does change product code**, so run `npm run build` afterwards.

### Install & upgrade

```bash
# Option 1 (recommended): install straight from npm
dsh plugin --profile web add dsh-kimi-tide

# Option 2: install from the Release asset (offline or pinned)
dsh plugin --profile web add ./dsh-kimi-tide-2.2.1.tgz

# restart dsh web / the desktop app afterwards
```

Compatibility: DSH ≥ `0.1.7-rc.1` (this release was verified live on the `0.2.0-rc.2` desktop app). **No config edits are needed** to upgrade; configs that already switch the guard on **only take effect from this version on**.

### Verification & acceptance

- Tests: **1170/1170 passing** (62 test files, 12 new in this batch, including a wiring-level regression nail for the guard predicate); `typecheck` 0 errors; `build` passes on both halves; repo gate `npm run check` **all six gates green** (the sixth is the new secrets gate); the bilingual four-section release-note gate passes locally.
- **Live acceptance of the guard (the debt from v2.2.0, settled here)**: ① a predicate matrix run against the **built artifact** — **39/39 pass**; ② config hot-remount (editing the profile file remounts the guard, no restart needed); ③ the host tool gate really does fire (a role-domain dispatch from a child is refused, with the reason returned verbatim); ④ **after restarting the host**, four judgements in the main session — role-domain `subagent` ⇒ **refused** (the fix at work), unnamed `workflow` ⇒ **refused**, named `workflow` ⇒ **allowed** with the child's `request/header` matching the named target **character for character**, and a domain-free `subagent` ⇒ allowed (no over-blocking). Records and evidence session ids: [packages/dsh-kimi-tide/docs/team-dispatch-acceptance.md](packages/dsh-kimi-tide/docs/team-dispatch-acceptance.md), section "派发护栏实机验收（2026-10-09）".
- **Stated as it is**: the workflow predicate is a **word-level heuristic** (it prefers a miss over a false hit — the word `model` anywhere in the script counts as naming a target); the "teammate dispatches are not blocked" case was not exercised by creating a live teammate, and is covered by the wiring-level unit test plus the 2026-10-06 live teammate-reroute evidence.
- Post-release verification (asset sha256 against the API `digest`, in-package version, file count) is recorded in [docs/release-evidence.md](docs/release-evidence.md).
