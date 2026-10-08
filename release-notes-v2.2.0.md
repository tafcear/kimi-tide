dsh-kimi-tide v2.2.0 —— 派发护栏：命中角色领域的裸子代理派发被拒绝 · Dispatch guard: bare subagent dispatches into a role's domain get refused

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **新增 · 派发护栏（`dispatchGuard`，默认关）**：分工表认的是**队友身份**——`resolveRoleDecision()` 只在 `membership.role === 'teammate'` 时命中，所以派给裸 `subagent` / `subagent_fork` 的活**在结构上不可能被改道**：它会在调用方点名的模型或预设默认模型上跑完，那个角色一次都不参与。开启 `dispatchGuard: 'enforce'` 后，这类派发被**拒绝**，拒绝理由写明三件事：任务命中了哪个角色、应当 `spawn_teammate(name="<角色 id>")` 派给该角色的队友、这条活不该归它时去掉领域词后重派。护栏是宿主工具闸上的**单调最终拒绝**——**只能拒绝、不能自动改派**（改派仍要另一次 `spawn_teammate` 调用）；关闭态与队友自己派活**零判定**。
- **新增 · 角色领域词（`roles.<id>.keywords`）**：角色除目标模型外可声明本领域的任务词。护栏**填了就优先按 `keywords` 判领域**（大小写不敏感子串，半角/全角逗号都认）；角色没填时回退到**显示名 + 别名 + id**（id 按词边界比对，`qa` 不会误中 `qatar`）。判定按分工表键序、只报第一个命中。
- **交付面**：说明页「路由」区新增「派发护栏（dispatchGuard）」条目（默认关 / 判定依据 / 拒绝后怎么做 / 只能拒绝不能改派四个要点）；包 README（随 tarball 分发的那份）新增「派发护栏」一节；判据、配置字段、匹配规则与回退、拒绝理由样例、**八条已知限制**与自查方法见 [`packages/dsh-kimi-tide/docs/dispatch-guard.md`](packages/dsh-kimi-tide/docs/dispatch-guard.md)。
- **文档面换代（同批）**：README 双语首屏从「省钱」轴重写为**「按模型强项编排工作流与各路代理」**轴（含「它给你三件事」与三个场景）；hero 素材换**品牌紫**（取自客户端 `--kt-accent` 与月亮图标，替掉模板默认的天蓝）并重渲染 GIF；**架构图重制**为 v2.1.x 形态（五档决策链 · 统一路由表 · 分工表与派发护栏，含可平移缩放的交互版）；徽章行挂上 **npm 包徽章**。
- **兼容性与迁移**：两个新字段都是**可选、不带默认值**（保持配置「默认往返相等」）——护栏默认关，**不开启时行为与本版之前逐字节一致，无需改配置**；两字段在 v6 `roles` 与 v7 `routes` 的 dispatch 行之间**双向按字段搬运**，存量文档升级不丢字段；开关只认字段本身（`=== 'enforce'`），不以版本号门控。
- **已知限制（如实标注）**：护栏只拒绝、不自动改派；匹配是**子串级**（误命中会让一次合法派发被挡，出路写在拒绝理由里）；只读任务的 `description` / `prompt`，不读会话上下文；`workflow` 的 `agent()` 带显式目标，**不在拦截范围**（设计上的出口）。

### 安装与升级

```bash
# 方式一（推荐）：直接从 npm 装
dsh plugin --profile web add dsh-kimi-tide

# 方式二：从 Release 资产装（离线或固定版本）
dsh plugin --profile web add ./dsh-kimi-tide-2.2.0.tgz

# 装完重启 dsh web / 桌面端生效
```

兼容：DSH ≥ `0.1.7-rc.1`（本版与 v2.1.0～v2.1.4 实机验证于 `0.2.0-rc.2` 桌面端）。以 `link:` 方式安装的用户：本版**有产品代码改动**（护栏与领域词），装后需 `npm run build` 重建产物。升级**不需要改配置**——护栏默认关。

### 验证与验收

- 测试：**1158/1158 通过**（62 个测试文件，含护栏的 214 行单元测试与设置页 DOM 测试）；`typecheck` 0 报错；`build` 双端通过；仓库门禁 `npm run check` **五闸全绿**；Release 正文双语四段门禁本地通过。
- **护栏的实机验收未做（如实声明）**：它是宿主侧接入（工具闸），拒绝行为要在**重启宿主后的真实会话**里判读；本版完成的是静态面（单元测试 + 设置页 DOM 测试）与配置面（v6/v7 双向搬运、往返相等），运行期拒绝路径列入下一轮。详见 README「版本与路线」的规划中条。
- 顺带闭环：**路由信息架构验收清单 §4 整表清零**——A-1 摘要行、A-3 五档三态与两条真实 `request/header`（主驱动恒定 / 规则仍赢）、A-5 driver 标注、B-1 作用域徽标、B-3 测试场两条、B-5 按钮、明暗双主题，全部有实机证据（[docs/routing-ia-acceptance.md](packages/dsh-kimi-tide/docs/routing-ia-acceptance.md)）。
- 发布后核验（资产 sha256 与 API `digest` 逐字一致、包内版本号、文件数）回填 [docs/release-evidence.md](docs/release-evidence.md)。

---

## English

### What's new

- **New — dispatch guard (`dispatchGuard`, off by default)**: the role table keys on **teammate identity** — `resolveRoleDecision()` only fires when `membership.role === 'teammate'`, so work handed to a bare `subagent` / `subagent_fork` call **structurally cannot be rerouted**: it runs to completion on whatever model the caller named or the preset default, and the role never takes part. With `dispatchGuard: 'enforce'`, such a dispatch is **refused**, and the refusal names three things: which role the task hit, that it should go to that role's teammate via `spawn_teammate(name="<role id>")`, and that a task which does not belong to that domain should be re-sent without the domain words. The guard is a **monotonic final refusal** on the host tool gate — **it can only refuse, never re-dispatch** (rerouting still costs a `spawn_teammate` call); while it is off, and for teammate-to-teammate dispatches, there is **zero evaluation**.
- **New — role domain words (`roles.<id>.keywords`)**: a role may declare the task words of its domain alongside its target model. When present, the guard judges the domain **by `keywords` first** (case-insensitive substring; half- and full-width commas both accepted); when a role has none, it falls back to **display name + aliases + id** (id compared on word boundaries, so `qa` does not match `qatar`). Roles are scanned in table order and only the first hit is reported.
- **Delivery surface**: the Help tab's routing section gains a "dispatch guard (`dispatchGuard`)" entry (off by default / what it keys on / what to do after a refusal / refuse-only), the package README (the one shipped inside the tarball) gains a "Dispatch guard" section, and the predicates, config fields, matching rules and fallbacks, refusal samples, **eight documented limitations** plus self-check steps live in [`packages/dsh-kimi-tide/docs/dispatch-guard.md`](packages/dsh-kimi-tide/docs/dispatch-guard.md).
- **Docs refresh (same batch)**: the bilingual READMEs' opening was rewritten from the "save money" axis to **"orchestrate your workflow and agents by model strength"** (with "three things it gives you" and three scenarios); the hero assets moved to the **brand violet** (taken from the client's `--kt-accent` and the moon icon, replacing the template's default sky blue) and the GIFs were re-rendered; the **architecture diagram was rebuilt** for the v2.1.x shape (five-tier decision chain · unified route table · role table & dispatch guard, with an interactive pan/zoom HTML version); and the badge row now carries an **npm badge**.
- **Compatibility & migration**: both new fields are **optional and carry no defaults** (config round-trips stay equal) — the guard is off by default, so **with it off the behaviour is byte-identical to the previous release and no config edit is needed**; the two fields are **carried both ways** between v6 `roles` and v7 `routes` dispatch rows, so existing documents do not lose them on upgrade; the switch reads the field itself only (`=== 'enforce'`), never a version number.
- **Known limitations (stated as they are)**: the guard refuses but does not re-dispatch; matching is **substring-level** (a false hit blocks one legitimate dispatch — the way out is written into the refusal); it reads only the task's `description` / `prompt`, not session context; `workflow`'s `agent()` carries an explicit target and is **out of scope** (a deliberate escape hatch).

### Install & upgrade

```bash
# Option 1 (recommended): install straight from npm
dsh plugin --profile web add dsh-kimi-tide

# Option 2: install from the Release asset (offline or pinned)
dsh plugin --profile web add ./dsh-kimi-tide-2.2.0.tgz

# restart dsh web / the desktop app afterwards
```

Compatibility: DSH ≥ `0.1.7-rc.1` (this release, like v2.1.0–v2.1.4, was verified live on the `0.2.0-rc.2` desktop app). Users installed via `link:` should run `npm run build` afterwards — this release **does change product code** (guard and domain words). **No config edits are needed** to upgrade: the guard is off by default.

### Verification & acceptance

- Tests: **1158/1158 passing** (62 test files, including the guard's 214 lines of unit tests and the settings-page DOM tests); `typecheck` 0 errors; `build` passes on both halves; repo gate `npm run check` **all five gates green**; the bilingual four-section release-note gate passes locally.
- **Live acceptance of the guard is not done (stated plainly)**: it is a host-side hook (tool gate), so the refusal path has to be read in a **real session after the host restarts**; what this release verifies is the static half (unit tests plus settings-page DOM tests) and the config half (v6/v7 carry-over both ways, round-trip equality). The runtime refusal path is on the next round — see the roadmap line in the README.
- Also closed out: the **routing information-architecture acceptance checklist (§4) is now empty** — A-1 summary line, A-3 five tiers plus two real `request/header` captures (driver constant / rule still wins), A-5 driver annotation, B-1 scope badges, B-3 test-bed pairs, B-5 button, and both themes, all backed by live evidence ([docs/routing-ia-acceptance.md](packages/dsh-kimi-tide/docs/routing-ia-acceptance.md)).
- Post-release verification (asset sha256 against the API `digest`, in-package version, file count) is recorded in [docs/release-evidence.md](docs/release-evidence.md).
