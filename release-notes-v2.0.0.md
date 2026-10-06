dsh-kimi-tide v2.0.0 —— 分工层执行面 · A dispatch layer for your team

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **分工表**：给每个专项配一个角色（id + 标签 + 目标模型，如「前端 → `kimi-coding/k3`」）。**队友名就是认领键**——用角色 id 或它的别名建队友，月汐就把它的每一步请求改道到目标模型；不认识的队友名一律不动（保持创建时继承的模型），子代理轮也不会被任务描述里的关键词二次改道。
- **分工表进模型视野**：路由开启且分工表非空时，月汐把这张表注册成一张运行时技能卡（`kimi-tide-team`）——主模型派活前照着它办，按「一次性任务（`workflow` 点名）/ 常驻队友（`spawn_teammate`）」两种配方派活，不必在提示词里手抄模型名。改表后存活会话的卡片下一轮自动换新，表清空整张卡退出。
- **主驱动恒定**：打开后主会话的**打底**永远是「主驱动」目标，预设默认不再接管没命中的轮次——关键词规则与 `@kimi` 指定照样优先；主驱动留空＝跟随宿主默认模型。
- **派发台账（看得见的派发）**：每次派发记一条——依据（`role` / `unclaimed` / `explicit` / `keep`）、队友、角色标签、**最终生效**的模型与时间，每父会话最近 20 条。角色目标不可用时**不静默换人**：保持继承值，面板逐字写明「「〈角色名〉」目标不可用 → 保持继承（〈实际生效目标〉）」。
- **设置页新增分工表编辑器与主驱动卡**：增删改角色、认领冲突保存时当场拦下、守卫式写通道；主驱动开关 / 目标 / 子代理是否也走关键词规则。
- **配置 v6 与迁移**：新增 `roles` / `driver` / `driverSticky` / `rulesApplyToChildren` 四个**可选**字段——不写即维持旧行为；v5 → v6 只加字段并留档 `.pre-v6`。**存量配置不写 `driverSticky` ＝ 打底仍归预设默认**；新装默认「主驱动恒定开、主驱动＝宿主默认」。运行期一律按字段判据，配置里显式写 `version: 5` 也不会让分工表失效。
- **实机验收修掉两个真缺陷（单测全绿但实机失效的接线层）**：① 宿主可选服务的探测此前用「属性访问 + try/catch」，而宿主框架对**未声明的服务是直接抛错**——分工表技能与队友查表**双双静默失效**；改为框架的「不带依赖声明读取」通道。② 派发台账原按**子代理 id** 收口，而子代理一轮干完即被销毁——刚写进父会话面板的那一行立刻被删；改为按**父会话**收口。

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.0.0.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web / 桌面端生效
```

兼容：DSH ≥ `0.1.7-rc.1`（本版实机验证于 `0.2.0-rc.2` 桌面端）。**配置无需手工迁移**：v5 → v6 由插件自动完成（只加字段，旧配置留档 `.pre-v6`）；四个新字段都是可选的，不写就维持你现在的行为。桌面端以 link 方式安装的用户：更新代码后重跑 `npm run build` 并重启应用（插件只在启动时加载构建产物）。

### 验证与验收

- 测试：**925/925 通过**（50 个测试文件）；typecheck 0 报错；build 双端通过；仓库门禁 `npm run check` 三脚本 exit 0；Release 正文双语四段门禁本地通过。
- **实机验收（2026-10-06，桌面端 desktop profile ＋ Agent Teams 组合包）A1a–A8 全绿**：主驱动恒定三变体 / 队友按分工表改道＋面板出现派发行 / 一次性派发不被关键词劫持（含可鉴别变体）/ 分工表进技能目录且可加载、改表后整段替换 / 未认领队友不改道且关键词规则不点火 / **角色目标不可用时不改道、面板逐字提示** / 存量兼容＝预设打底 / 两队友并发各中各自目标。逐条证据（会话目录 + 请求头序号）见 [实机验收 runbook 结果节](packages/dsh-kimi-tide/docs/team-dispatch-acceptance.md)。
- **未覆盖（如实写明）**：**P1「角色 × 带图」组合未执行**——它要求在**队友会话**里发图，而当前宿主 GUI 的队友会话输入框没有附件通道（粘贴与 `+` 均不可用，属宿主 GUI 限制、非本插件缺陷）；该组合暂时只能由代码侧单测兜底，**不视为通过**，待 GUI 开放后补验。

---

## English

### What's new

- **Roster**: give each speciality a role (id + label + target model, e.g. "frontend → `kimi-coding/k3`"). **The teammate name is the claim** — create a teammate named after the role id or its alias and every request from it is re-routed to the target model; unknown names are left untouched (they keep the model they were created with), and child-agent turns are never re-routed by keywords in the task text.
- **The model can read the roster**: while routing is on and the roster is non-empty, the plugin registers it as a runtime skill card (`kimi-tide-team`) — the main model follows it when delegating, using one of two recipes (a one-shot `workflow` naming the model, or a persistent `spawn_teammate` teammate), so you never hand-copy model names into a prompt. Edit the roster and live sessions pick up the new card on their next turn; empty it and the card disappears.
- **Pinned baseline**: when enabled, the main session's **baseline** is always the driver target instead of the preset default — keyword rules and explicit `@kimi` still win; leave the driver empty to follow the host's default model.
- **Dispatch ledger (dispatch you can see)**: every dispatch is recorded with its basis (`role` / `unclaimed` / `explicit` / `keep`), the teammate, the role label, the **effective** model and the time — latest 20 per parent session. When a role target is unavailable nothing is swapped silently: the inherited model stays and the panel states, word for word, "「<role>」target unavailable → keeping the inherited model (<effective target>)".
- **New settings surfaces**: a roster editor (add/edit/remove roles, conflicting claims rejected at save time, guarded write path) and a driver card (on/off, target, whether child agents also run keyword rules).
- **Config v6 and migration**: four **optional** fields (`roles` / `driver` / `driverSticky` / `rulesApplyToChildren`) — absent means the old behaviour; v5 → v6 only adds fields and archives the old document as `.pre-v6`. **Existing configs that never wrote `driverSticky` keep the preset default as their baseline**; new installs default to "baseline pinned to the host default model". Every runtime check is a field predicate, so even a config that explicitly says `version: 5` still gets the roster.
- **Two real defects found and fixed by live acceptance (unit tests were green; both were wiring-level)**: ① probing optional host services used "property access + try/catch", but the host framework **throws on undeclared services** — so the roster skill and the teammate lookup were **both silently dead**; it now uses the framework's read-without-declaring-dependency channel. ② the dispatch ledger used to be pruned by **child-agent id**, and a child agent is destroyed as soon as its turn ends — the row just written to the parent's panel was deleted immediately; it is now keyed by **parent session**.

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.0.0.tgz
# or install the same tgz from the Release assets; restart dsh web / the desktop app afterwards
```

Compatible with DSH ≥ `0.1.7-rc.1` (verified live on `0.2.0-rc.2` desktop). **No manual config migration**: v5 → v6 is done by the plugin (fields are only added, the old document is archived as `.pre-v6`), and all four new fields are optional — leaving them out keeps your current behaviour. Desktop users who installed the plugin as a link: re-run `npm run build` after updating and restart the app (plugins load the build only at startup).

### Verification & acceptance

- Tests: **925/925 passing** (50 test files); typecheck clean; build passing (host + client); repo gates `npm run check` exit 0; the bilingual four-section release-notes gate passes locally.
- **Live acceptance (2026-10-06, desktop profile + Agent Teams bundle) A1a–A8 all green**: three baseline-pinning variants / teammate re-routed by the roster with the dispatch row showing up in the panel / one-shot dispatch not hijacked by keywords (including a discriminating variant) / roster present in the skill catalog and loadable, replaced wholesale after an edit / unclaimed teammate untouched and keyword rules not firing / **unavailable role target left alone with the panel stating the exact reason** / legacy compatibility = preset baseline / two teammates concurrently hitting their own targets. Per-item evidence (session directory + request-header seq) is in the [acceptance runbook results section](packages/dsh-kimi-tide/docs/team-dispatch-acceptance.md).
- **Not covered (stated plainly)**: the **P1 "role × image" combination was not executed** — it requires sending an image inside a **teammate session**, and the current host GUI offers no attachment channel there (paste and the `+` button are both unavailable; a host GUI limitation, not a defect of this plugin). That combination is covered by unit tests only and is **not considered passed**; it will be re-verified once the GUI allows it.
