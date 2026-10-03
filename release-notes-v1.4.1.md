dsh-kimi-tide v1.4.1 —— 档位真的能设了 · Effort tiers you can actually set

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **「档位」终于能设了**：设置页里所有档位下拉此前永远是灰的、只剩「跟随默认」，看着像「模型能力没法设置」。真因是插件客户端还在读一条 **0.1.7 起就已移除**的旧通道，读不到时把**空表**当成结果，顺手覆盖了主通道刚拿到的真表。现在按现行通道取值，读不到就明确降级，不再伪造空表。
- **改设置不再抹掉档位表**：宿主侧每次保存路由设置都是**整份覆盖**配置文件，此前漏带「档位表 / 挂载表」两个运行面字段——只要你在设置页动过任何一项，档位表就从配置里消失且不会自动补写。现在每次写回都带着它。
- **没声明档位的模型，说清为什么**：唯一选项文案改为「**跟随默认（该模型未声明档位）**」，不用再对着一个灰框猜原因。
- **评审模型也能配档位**：协作流「评审」行新增档位下拉，与转述行同款；评审调用会按目标支持集判定后**真的下发**（此前刻意不带推理档位，本版撤销该限制）。
- **界面不再上下跳**：「已保存」提示与写入失败横幅收进卡片右上的状态位、脱离文档流——此前它每闪现一次就把下面整块内容顶下去再弹回。
- **可访问性**：模型下拉与档位下拉不再共用同一个无障碍名称（读屏与自动化此前分不出这是两个控件）。
- **配置无需迁移**：`router` 段形状一字未改；评审档位是可选字段，不写就维持现状（不带推理档位）。

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-1.4.1.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web / 桌面端生效
```

兼容：DSH ≥ `0.1.7-rc.1`（本版实机验证于 `0.2.0-rc.2` 桌面端）。**配置无需迁移**：新增的评审档位是可选字段 `flows.<流id>.reviewer.effort`，不写即维持旧行为。桌面端以 link 方式安装的用户：更新代码后重跑 `npm run build` 并重启应用（插件只在启动时加载构建产物）。**升级后请重启一次**——档位表在插件激活时重新发布，重启前你看到的灰下拉属于旧状态。

### 验证与验收

- 测试：**802/802 通过**（本版新增 17 条回归）；typecheck 0 报错；build 双端通过；仓库门禁 `npm run check` 三脚本 exit 0
- **证伪（红验证）**：把 `src` 回退到修复前（`git stash push -- src`）再跑，这 17 条新回归**实测全红** ⇒ 用例确实抓得住缺陷，不是摆设
- **根因取证**：按 asar 头格式解包宿主，核对 `dsh-llm-pi-ai` 的 `resolveModelReasoning` / `reasoningInfo` 与 pi-ai 内置目录 ⇒ `zai-coding-cn/glm-5.3`、`kimi-coding/k3` = `low/high/max`，`qwen-token-plan-cn/qwen3.8-flash|max` = `low/medium/xhigh`，即宿主**早已声明**档位、症状是「表没送到」。据此本版**不提供**「未声明时的兜底档位清单」——那只会给出一批运行期必被剥离的假选项
- **实机验收（真宿主 desktop profile，2026-10-03）通过**：切换「能力」预设后默认模型档位可选 `xhigh`；协作流评审行出现档位下拉；「已保存」闪现不再顶动界面 ⇒ 维护者裁定「通过」并据此打 tag。**未覆盖**：web profile 跨端复测；「评审档位被适配器真正接受」的端到端账单核对（需一次真评审）

---

## English

### What's new

- **Effort tiers can actually be set now**: every tier dropdown in the settings page used to be permanently greyed out with only "follow the default" — which looked like "the model's capability can't be configured". The real cause: the plugin's client still read a channel **removed in host 0.1.7**, and when it found nothing it returned an **empty table** as if it were the truth, clobbering the real table the primary channel had just fetched. It now reads the current channel and degrades loudly instead of fabricating an empty table.
- **Saving settings no longer wipes the tier table**: every host-side write of the router config **replaces the whole document**, and it used to drop the two runtime fields (tier table / mounted table) — so touching anything in the settings page erased them, with no republish. They are now carried on every write.
- **Models without declared tiers say why**: the single option now reads "**follow default (this model declares no tiers)**" instead of leaving you to guess at a grey box.
- **The reviewer gets a tier too**: the collaboration flow's review row gained a tier dropdown, matching the transcribe row, and the review call really sends it after checking the target's supported set (the earlier deliberate "reviews never carry a reasoning tier" restriction is lifted in this release).
- **No more layout jumping**: the "saved" toast and the write-failure banner moved into a status slot pinned to the card's top-right, out of the document flow — previously each flash pushed the whole panel down and snapped it back.
- **Accessibility**: the model dropdown and the tier dropdown no longer share one accessible name (screen readers and automation could not tell the two controls apart).
- **No config migration**: the `router` shape is unchanged; the reviewer tier is optional and absent means exactly the old behaviour.

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-1.4.1.tgz
# or install the same tgz from the Release assets; restart dsh web / the desktop app afterwards
```

Compatible with DSH ≥ `0.1.7-rc.1` (verified live on `0.2.0-rc.2` desktop). **No config migration**: the reviewer tier is the optional field `flows.<flow-id>.reviewer.effort`, and leaving it out keeps the previous behaviour. Desktop users who installed the plugin as a link: re-run `npm run build` after updating and restart the app (plugins load the build only at startup). **Please restart once after upgrading** — the tier table is republished when the plugin activates, so a grey dropdown before the restart is just stale state.

### Verification & acceptance

- Tests: **802/802 passing** (17 regressions added by this release); typecheck clean; build passing (host + client); repo gates `npm run check` exit 0
- **Falsification check**: reverting `src` to the pre-fix state (`git stash push -- src`) turns all 17 new regressions **red** — the tests genuinely pin the defects rather than the status quo
- **Root-cause evidence**: the host archive was unpacked by asar header format and `dsh-llm-pi-ai`'s `resolveModelReasoning` / `reasoningInfo` plus pi-ai's built-in catalog were inspected ⇒ `zai-coding-cn/glm-5.3` and `kimi-coding/k3` declare `low/high/max`, `qwen-token-plan-cn/qwen3.8-flash|max` declare `low/medium/xhigh` — the host always knew the tiers, they simply never reached the UI. For that reason this release deliberately ships **no** fallback tier list for undeclared models: it would only offer tiers the runtime strips anyway
- **On-device acceptance (real host, desktop profile, 2026-10-03): passed** — after switching to the capability preset the default model's tier selects `xhigh`; the review row shows a tier dropdown; the "saved" flash no longer moves the page ⇒ the maintainer approved the tag. **Not covered**: a cross-check on the web profile, and an end-to-end bill check that the reviewer tier is accepted by the adapter (needs one real review run)
