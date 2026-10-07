dsh-kimi-tide v2.1.0 —— 路由信息架构统一 · One routing table, two scopes

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **一条五档决策链取代「四个并列控件」**：路由页从上到下就是优先级链——**显式 @ > 调用方点名 > 分工表 role > 关键词规则 > 打底**，与运行期逐档对齐。每档三行（什么时候轮到它 / 当前生效值 / 关掉它会怎样），并带状态徽标：**已就绪** / **按需**（写 `@` 或子代理点名才参与，不置灰）/ **未启用**（当前配置下没东西，置灰）。**分工表内联在第 3 档、规则编辑器内联在第 4 档**，不再是两个谁也不挨着谁的折叠块。
- **顶部一句人话摘要**：说清现状——打底是谁、命中什么走哪、派发到哪、**带图走哪种兜底**。一条规则都没配时它也说人话：「未命中任何规则 ⇒ 全部走打底（…）；已备 N 组词表无规则引用，暂不生效」——**空表不是坏了，是没接线**。
- **作用域徽标：规则行「主会话」、角色行「派发时」**：关键词规则只服务主会话、分工表只服务队友，本来就不冲突；冲突感来自界面没说清。两个词一贴，「打架」变成「分工」。
- **重叠解释条（不是报错）**：同一个词既是某条规则的对象、又是某个角色的身份词且两边目标不同时，词表行与角色行**各挂一条解释条**：「设计使然：主会话说『代码』走 A；派给『后端』做走 B」，并给**两个**一键动作——**规则跟随该角色** / **词并入该角色别名**。被协作流认领的规则不参与解释（它已被抑制，解释它等于说假话）。
- **词表接线徽标**：每组词表标出 `被 N 条规则引用` / `被协作流认领` / `⚠ 悬空`（接线是跨**全部预设**扫的，所以别的预设引用了也算接上）。
- **统一路由表 `routes`（配置 v7）**：关键词规则（`scope: session`，带 `preset` 归属）与分工角色（`scope: dispatch`，带 `label`/`teammate`/`aliases`/`note`）合成**一张表**。**`routes` 存在即真源**，旧字段（`presets[*].rules` / `roles`）保留为**镜像**——手工删掉 `routes` 段即回退旧口径，功能不崩。手写 `cordis.patch.yml` 的人从此只面对一张表。
- **保存时双写、冲突即报错**：设置页保存规则或角色时同一笔写同时下发 `routes` 与镜像旧字段（scope 通道上是**三笔序列**：摘掉 `routes` → 写旧字段 → 写回 `routes`——宿主逐笔校验两处一致性，中间态不合法编辑就永远落不了盘，所以这是硬约束）。两处不一致时写入期**拒绝并指出位置**，不一致包括**顺序分叉**（排序即语义）。正常路径下两处永远一致。
- **测试场「派给谁」**：输入或选一个角色 / 队友名，看它会改道到哪个模型、依据是什么（`role` / `unclaimed`），并点明这与「试一句」是**两套作用域**。分工表另有「**从词表生成角色**」：把还没被任何规则引用的词表组批量变成角色行。
- **健壮性 · 独立交叉复核后的修正**（同日，两个不同厂商的模型互审）：手改配置写出畸形行（如 YAML 空项）不再让插件启动崩溃（读路径保守丢弃并警告）；校验与镜像的缺省口径对齐（修掉「插件自己造出冲突再拒写自己」）；`version: 5` 的文档带 `routes` 时不再被迁移链静默抹掉；`activePreset: null`（路由关闭）时第 3 档如实写「不发生任何改道（仅存档）」而不是报生效；第 2 档文案去掉「宿主」（只有子代理会保留调用方点名的模型）；`driverSticky` 关闭时主驱动目标明确标注未启用。
- **兼容性 · 零路由行为变更**：配置里**没有 `routes`** 的文档（v4 / v5 / v6 存量与新装默认）**逐字节不变**；运行期一律按**字段判据**读，不按版本号——显式写 `version: 5/6` 同样正常，设置页写入也不会改你的 `version`。

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.1.0.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web / 桌面端生效
```

兼容：DSH ≥ `0.1.7-rc.1`（本版实机验证于 `0.2.0-rc.2` 桌面端）。**配置无需手工迁移**：v4/v5/v6 存量照读，`routes` 是可选的（不写即维持旧行为）。桌面端以 link 方式安装的用户：更新代码后重跑 `npm run build`（**产物必须先于重启**，插件只在启动时加载构建产物）。

### 验证与验收

- 测试：**1040/1040 通过**（56 个测试文件）；typecheck 0 报错；build 双端通过；仓库门禁 `npm run check` 三脚本 exit 0；Release 正文双语四段门禁本地通过。
- **启动级 E2E 双模式**：正例 PASS（隔离 DSH home 里真启动宿主 ⇒ 带 `kimi-tide/panel` 的 **v4** 会话可读，证明历史兼容的注册链路有效）；负控 PASS（把注册剥掉 ⇒ 同一会话被拒载，证明这条 E2E 真的会失败）。
- **在真实用户配置上离线预验**（用构建产物直跑，不依赖宿主）：迁移前后 `buildRoutingView` **逐字节相同**；`matchingRules` 在 **28 组探针**（词表词 + 混合句 + `@` 指令 × 带图/不带图）上**零差异**；删掉 `routes` 段后视图仍等价；v7 配置过校验，而故意改一行目标**被校验拦截**。
- **实机验收（2026-10-07，桌面端 0.2.0-rc.2）——B-4 写通道双写落盘 ✅ 通过**：在设置页保存一个角色之后，`cordis.patch.yml` 同时出现 `routes`（4 行：`session` 1 / `dispatch` 3）与镜像旧字段，两者**逐行语义一致**且通过校验（`node scripts/acceptance/check-routes-dualwrite.mjs` → `exit=0`）；**C-2 亦成立**（文件里的 `routes` 段已逐行核对：session 行带 `preset`，dispatch 行带 `label`/`teammate`/`aliases`）。**C-1 的运行期半边另有活证据**：改角色后宿主注入的技能描述**当场反映变更**，说明运行期确实按 `routes` 读。判据与本机「应然快照」见 [routing-ia-acceptance.md](packages/dsh-kimi-tide/docs/routing-ia-acceptance.md)。
- **仍未验（如实写明，不视为通过）**：纯目检项（A-1 页面渲染、A-5、B-1/B-3/B-5 的视觉与交互、B-2 需先造重叠样例、明暗双主题截图核对）与 A-2/A-3 的「实发消息 → `request/header`」对照。**B-4 已通过 ⇒ 发版门禁的技术面解除**。

---

## English

### What's new

- **One five-tier decision chain replaces four side-by-side controls**: the Route page now reads top-down as the live priority chain — **explicit @ > caller's pick > roster role > keyword rules > baseline** — tier by tier with the runtime. Each tier shows three lines (when it is reached / its current effective value / what turning it off would do) plus a state badge: **ready** / **on demand** (only when you type `@` or a caller names a model; not dimmed) / **not enabled** (nothing configured; dimmed). The **roster** is inlined in tier 3 and the **rule editor** in tier 4 — no longer two collapsed blocks that never touched each other.
- **A one-line summary in plain language**: what the baseline is, what a hit routes to, where dispatch goes, and **which image fallback applies**. With no rules at all it still speaks: "no rule matches ⇒ everything goes to the baseline (…); several keyword groups are defined but referenced by no rule, so none takes effect" — **an empty table is not broken, it is unwired**.
- **Scope badges: rule rows read "main session", roster rows read "on dispatch"**: keyword rules serve the main session only, the roster serves teammates only — they never conflicted; the interface simply did not say so. Two words turn "fighting" into "division of labour".
- **Overlap notes (not errors)**: when one word is both a rule's subject and a role's identity word with different targets, both sides get a note — "by design: saying 'code' in the main session goes to A; delegating 'code' work to 'backend' goes to B" — plus **two** one-click actions: **make the rule follow that role** / **merge the word into that role's aliases**. Rules claimed by a collaboration flow are left out (they are suppressed; explaining them would be a lie).
- **Wiring badges for keyword groups**: each group shows `referenced by N rules` / `claimed by a collaboration flow` / `⚠ orphan` (wiring is scanned across **all** presets, so a rule in another preset counts).
- **Unified routing table `routes` (config v7)**: keyword rules (`scope: session`, carrying their `preset`) and roster roles (`scope: dispatch`, with `label`/`teammate`/`aliases`/`note`) become **one table**. **`routes` present means it is the source of truth**; the legacy fields (`presets[*].rules` / `roles`) stay as a **mirror** — delete the `routes` block by hand and behaviour falls back, nothing breaks. Anyone hand-editing `cordis.patch.yml` now faces a single table.
- **Write-once, mirror-both, refuse-on-conflict**: saving a rule or a role writes `routes` and the mirrored legacy fields in the same edit (on the scope channel this is a **three-write sequence**: drop `routes` → write legacy → write `routes` back — the host validates both sides on every write, so an illegal intermediate state would make edits impossible to land; the order is a hard constraint, not a style). When the two sides disagree the write is **rejected with the location named**, and disagreement includes **ordering divergence** (order is semantics). On the normal path the two sides are always identical.
- **"Who would it dispatch to?" in the Playground**: type or pick a role / teammate name and see which model it would be rerouted to and on what basis (`role` / `unclaimed`), with an explicit note that this is a **different scope** from "try a sentence". The roster also gains **"generate roles from keyword groups"**, turning groups no rule references into role rows in bulk.
- **Robustness — fixes from an independent cross-review** (same day, two models from different vendors reviewing each other): a malformed row in a hand-edited config (e.g. an empty YAML item) no longer crashes plugin startup (the read path drops it and warns); the validator and the mirror now agree on defaults (fixing "the plugin invents a conflict and then refuses its own write"); a `version: 5` document carrying `routes` no longer loses it silently in the migration chain; with `activePreset: null` (routing off) tier 3 now says "no rerouting happens (archive only)" instead of claiming it is in effect; tier 2 no longer says "host" (only subagents keep a caller-named model); with `driverSticky` off the driver target is explicitly marked as not enabled.
- **Compatibility — zero change to routing behaviour**: documents **without `routes`** (v4 / v5 / v6 legacy and fresh installs) behave **byte-for-byte** as before; the runtime reads by **field predicates**, never by version — an explicit `version: 5/6` works fine and the settings page never rewrites your `version`.

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.1.0.tgz
# or install the same tgz from the Release assets; restart dsh web / the desktop app afterwards
```

Compatibility: DSH ≥ `0.1.7-rc.1` (this version was verified live on the `0.2.0-rc.2` desktop app). **No manual config migration**: v4/v5/v6 documents are read as-is, and `routes` is optional (omitting it keeps your current behaviour). Desktop users installed via `link:`: re-run `npm run build` after updating the code (**build before restart** — the plugin only loads build artefacts at startup).

### Verification & acceptance

- Tests: **1040/1040 passing** (56 test files); typecheck 0 errors; both build halves pass; repo gate `npm run check` exits 0 on all three scripts; the bilingual four-section release-note gate passes locally.
- **Boot-level E2E, both modes**: positive PASS (the real host boots in an isolated DSH home ⇒ a **v4** session carrying `kimi-tide/panel` stays readable, proving the history-compat registration path works); negative control PASS (strip the registration ⇒ the same session is refused, proving this E2E can actually fail).
- **Offline pre-verification on the real user config** (run against build artefacts, no host needed): `buildRoutingView` is **byte-identical** before and after migration; `matchingRules` shows **zero difference across 28 probes** (keyword words + mixed sentences + `@` directives × with/without image); deleting the `routes` block keeps the view equivalent; a v7 config validates, and deliberately changing one row's target is **rejected by validation**.
- **Live acceptance (2026-10-07, desktop 0.2.0-rc.2) — B-4 dual-write landing ✅ PASSES**: after saving one role on the settings page, `cordis.patch.yml` gained `routes` (4 rows: 1 `session` / 3 `dispatch`) **alongside** the mirrored legacy fields, the two are **semantically identical row by row**, and validation passes (`node scripts/acceptance/check-routes-dualwrite.mjs` → `exit=0`); **C-2 also holds** (the `routes` block in the file was read line by line: session rows carry `preset`, dispatch rows carry `label`/`teammate`/`aliases`). **C-1's runtime half has live evidence too**: changing a role made the host-injected skill description change on the spot, proving the runtime really reads `routes`. Criteria and the machine-local "expected" snapshot: [routing-ia-acceptance.md](packages/dsh-kimi-tide/docs/routing-ia-acceptance.md).
- **Still unverified (stated plainly, not treated as passing)**: the purely visual items (A-1 rendered page, A-5, the look and interaction of B-1/B-3/B-5, an overlap example for B-2, light/dark screenshot check) and the "send a real message → `request/header`" comparison for A-2/A-3. **B-4 passing clears the technical side of the release gate**.
