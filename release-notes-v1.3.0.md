dsh-kimi-tide v1.3.0 —— 用量余额全覆盖与自解释界面 · usage & balance coverage, self-explaining UI

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **用量/余额全覆盖**：额度槽跟随当前命中的目标自动换形态——订阅类（code plan）显示用量窗，API 计费类（如 DeepSeek）显示**余额**（赠送/充值进悬浮提示，余额不足时明确标注）。新增 `balancePollMs`（默认 5 分钟，余额接口是计费端点，60 秒轮询过于激进）。
- **新增「用量总览」**：dock 第二行的总览按钮一屏列出全部已注册的源，并把「没数据」的三种原因分开说清——**该套餐无公开 API** / **key 未配置** / **取数失败**，不再混为一谈。
- **新增「说明」页签**（设置 → 月汐 → 说明）：八个分区讲清面板每个元素与设置里每个字段，关键条目带**当前值**（如「触发方式：当前＝手动 ⇒ 关键词命中不会触发评审」），另有一张**症状 → 原因**表；页签同时补齐 `tabpanel` / `aria-controls` 与 `←` `→` `Home` `End` 键盘操作。
- **新增语义命中确认闸**（默认关闭，需在配置里开启）：关键词命中不再立刻改道——先让**本预设的打底模型**确认「这是本轮真意图吗」，判否则跳过该条规则、继续匹配后续规则。判官超时 / 模型不可用 / 输出解析失败一律**按原关键词结果走**；显式 `@` 轮与「带图规则已排首位」的轮**不发判官调用**。
- **显式 `@` 精确寻址**：新增 `@provider/model` 写法，直接把请求钉到某个模型；`@provider` 简写的池内选择改为**确定化**——优先「你预设里已配置过的目标」，并在决策原因里写明实际模型与依据（不再受候选池枚举顺序摆布）。
- **修复：配额条语义反了**。原来条画「已用比例」而旁边数字是「剩余量」，结果剩得多时条几乎空着（看着像快没了）、快耗尽时条反而最满。现在条与数字同源于**剩余**：剩得多条就长，快耗尽时是**短红条**；数字改用百分比，绝对量进悬浮提示。
- **修复：某个窗口没数据时不再谎报满额**（`limit=0` 曾会被算成「剩余 100%」）。
- **修复：设置页的错误横幅与「已保存」提示不再被页签藏住**——被 `display:none` 的 `role="status"` 不在无障碍树里，此前在测试场/协作流页签保存是**静默无确认**的。
- **`@` 误判面收窄**：`@` 后面不是本插件认识的 provider 时**不再当指令**——`@README.md`（工作区路径引用）、`node_modules/@deepseek-ai/…`（scoped 包名）、路径片段里的 `@xxx` 此前会被当成显式指令，而显式指令在候选池为空时会**整条跳过关键词规则链**（连语义确认闸与评审流武装也一起失效，且界面上看不出规则被跳过）。现在这类文本照常走规则链，决策原因里写明「`@x` 非本路由器已知 provider（已忽略）」。真指令语义不变；已知 provider 但当前无可用候选仍保持 `keep`。
- **一处有意的行为变更**：`@一个本机没有的 provider`（如 `@anthropic`）以前返回 `keep`（保持上一轮的模型，不可预测），现在落预设打底并在原因里说明被忽略——词法上它与 `@README` 不可区分，必须在两种降级里选一边。
- **文档纠偏**：README 双语把「首条命中生效」改成真实语义——规则按**特异度**排序（命中词多者优先、带图恒第一、平手按列表序），排序后首条**目标可用**者生效。
- **修复：设置页页签的 id 不再撞车**——页签与面板原来用写死的 id，同一页面出现两张设置卡时 `aria-controls` 会指向**另一张卡**的面板（读屏定位到错的面板）。现在按实例生成，方向键切换也不再从 id 字符串反推键名。

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-1.3.0.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web 生效
```

兼容：DSH ≥ `0.1.2-rc.1`（本版实机验证于 `0.1.5-rc.1`）。**`settings.yaml` 无需改动**：新增配置项全部可选且缺省关闭（存量行为零突变）。若要开启语义确认闸，在预设下加 `hitConfirm: { enabled: true }`。

### 验证与验收

- 测试：**688/688 通过**；typecheck 0 报错；build 通过（host + client）
- 实机验收：**路由面 A1/A6/A7/A9 已实机通过**（`@` 精确寻址、`@` 误判面、打底/改道、语义闸双向生效与判词缓存），清单与记录见 `docs/release-evidence.md` 的 v1.3.0 一节；另有两个不依赖宿主的离线验收工具可直接复跑：`scripts/acceptance/q6-gating-check.mjs`（`@` 门控 14 例）、`scripts/acceptance/panel-legacy-scan.mjs`（旧面板载荷容忍）

---

## English

### What's new

- **Usage & balance coverage**: the quota slots now follow the routed target and adapt their shape — subscription plans show usage windows, API-billed providers (e.g. DeepSeek) show a **balance** (granted/topped-up details in the tooltip, an explicit note when the balance is insufficient). New `balancePollMs` (default 5 minutes; a billing endpoint does not deserve a 60-second poll).
- **New "Overview" panel**: one button lists every registered source on one screen and separates the three reasons a source can have no data — **no public API for this plan** / **key not configured** / **fetch failed**.
- **New "Help" tab** (Settings → 月汐 → 说明): eight sections explaining every panel element and settings field, with key entries showing the **current value** (e.g. "trigger: manual ⇒ a keyword hit will not fire a review") plus a **symptom → cause** table; the tab row also gains `tabpanel` / `aria-controls` and `←` `→` `Home` `End` keyboard support.
- **New semantic hit confirmation** (off by default, config-only): a keyword hit no longer reroutes immediately — the **preset's own default model** first confirms "is this really this turn's intent?"; an omit verdict skips that rule and keeps matching the rest. Judge timeout / unavailable model / unparseable output all **fall back to the plain keyword result**; explicit `@` turns and turns where an image rule already leads make **no judge call at all**.
- **Explicit `@` can now pin a model**: `@provider/model` routes straight to that model; the `@provider` shorthand picks **the target you configured in the preset** (not whatever the catalog lists first) and says so in the decision reason.
- **Fixed: the quota bar was inverted.** The bar drew *used* while the number next to it showed *remaining* — so plenty-of-quota looked almost empty and near-exhaustion looked full. Bar and number now both encode **remaining**: more left, longer bar; nearly out, a short red bar. Numbers became percentages, absolute amounts moved into the tooltip.
- **Fixed: an empty window no longer claims to be full** (`limit=0` used to be computed as "100% remaining").
- **Fixed: error banners and the "saved" confirmation are no longer hidden by tab switching** — a `display:none`'d `role="status"` leaves the accessibility tree, which made saving on the flows/trial tabs silent.
- **`@` false positives narrowed**: a token after `@` that is not a provider this plugin knows is **no longer treated as a directive** — a workspace path reference like `@README.md`, a scoped package name like `node_modules/@deepseek-ai/...`, or an `@xxx` inside a path used to be parsed as an explicit directive, and an explicit directive with an empty candidate pool **skipped the entire keyword rule chain** (taking the semantic gate and the review-flow arming down with it, invisibly). Such text now goes through the rules as usual, with the decision reason saying "`@x` is not a known provider (ignored)". Real directives are unchanged; a **known** provider with no available candidate still yields `keep`.
- **One deliberate behavior change**: `@a-provider-this-machine-does-not-have` (e.g. `@anthropic`) used to return `keep` (stay on whatever the previous turn used — unpredictable); it now falls to the preset default with the ignore note in the reason, because lexically it is indistinguishable from `@README`.
- **Docs fix**: the bilingual READMEs now describe rule selection correctly — rules are ranked by **specificity** (more matched words first, image always first, ties keep list order), and the first rule with an **available** target wins.
- **Fixed: settings-card tab ids no longer collide** — tabs and panels used hard-coded ids, so with two cards on one page `aria-controls` could point at **the other card's** panel (a screen reader would land on the wrong panel). Ids are now per-instance, and arrow-key switching no longer derives the key name from the id string.

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-1.3.0.tgz
# or install the same tgz from the Release assets; restart dsh web afterwards
```

Compatibility: DSH ≥ `0.1.2-rc.1` (verified live on `0.1.5-rc.1`). **No `settings.yaml` edits required**: every new knob is optional and off by default (byte-for-byte unchanged behavior for existing configs). To enable the semantic gate, add `hitConfirm: { enabled: true }` under a preset.

### Verification & acceptance

- Tests: **688/688 passing**; typecheck clean; build passing (host + client)
- Live acceptance: the routing surface **A1/A6/A7/A9 passed on the real host** (exact `@provider/model` addressing, `@` false-positive surface, default vs rule routing, and the semantic gate working in both directions with verdict caching); checklist and record in the v1.3.0 section of `docs/release-evidence.md`. Two host-independent checks can be re-run anytime: `scripts/acceptance/q6-gating-check.mjs` (`@` gating, 14 cases) and `scripts/acceptance/panel-legacy-scan.mjs` (legacy panel payload tolerance).
- Live acceptance: checklist and record in the v1.3.0 section of `docs/release-evidence.md` (the A-series probes require restarting the host — the host half does not hot-reload)
