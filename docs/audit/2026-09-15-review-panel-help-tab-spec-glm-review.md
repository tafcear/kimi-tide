# 评审档案：面板「说明」页签设计稿（2026-09-15，独立模型评审）

> **评审人**：**glm-5.3**（provider `zai-coding-cn`）
> **更正记录（2026-09-15 复核）**：本档案原标「评审人 qwen3.8-max」、文件名原为 `…-spec-qwen-review.md`，**经实测证伪**。该轮 workflow 脚本确对三个 agent 同传 `provider: 'qwen-token-plan-cn', model: 'qwen3.8-max'`，但本份评审所在子会话 `0132a1ee-36bb-4ce8-9913-75935ab5bbfa` 的 `request/header` 与 `request/context` 均记录为 `zai-coding-cn/glm-5.3` ⇒ **本份评审实际由 glm-5.3 完成**（触发机制见 `docs/superpowers/backlog.md` Q6）。
> **更正影响面**：仅署名——**结论与控制器复核结果不变**；独立性仍成立（与作者 deepseek-flash 不同族）。
> **评审对象**：`docs/superpowers/specs/2026-09-15-panel-help-tab-design.md`（181 行，commit `1f68b20`）
> **评审结论**：**有条件同意**——成熟度高（v1 接近可实施，锚点纪律出色，仅 2 处偏差）；无严重项；条件 = M1–M5 落实
> **独立性**：与作者（deepseek-flash）不同族（评审者 glm-5.3）
> **证据基础**：spec + `SettingsCard.tsx`/`styles.ts`/`TideDock.tsx`/`ReasonPanel.tsx`/`icons.tsx`/`client/index.ts`/`card-store.ts` + `test/SettingsCard.dom.test.tsx` + 仓库上一级目录的 UI 评审原文

---

## 1. 评审报告全文（评审模型产出，未删改结论）

**结论：有条件同意。** 成熟度高：v1 稿接近可实施，锚点纪律出色（全部带行号论断逐条回源码核对，仅 2 处偏差，见文末）；核心承诺（说明页读 snapshot 渲染当前值）对 §4 点名的 9 项中 8 项成立。条件：下述 M1–M5 必须落实后再进实施稿。

### 严重（核心承诺不成立）

无。未发现推翻设计核心（状态感知自解释层 + 四页签）的缺陷。

### 中等（会导致错误行为或返工）

**M1 · §6 的 tabpanel 前提不成立：route 页签没有单一面板节点** · 路由页内容散布为 4+ 个卡片直接子节点（`.kt-preset-row`/`.kt-editor`/`.kt-preset-ops`/`.kt-groups`，其中 `.kt-editor` 还是 `active!==null` 条件渲染），只有 flows/trial 各自是一个 `<details>`；「每个面板加 role=tabpanel+id+hidden」必须先引入包装节点，而 styles.ts:161-164 的可见性规则全部是 `>` 直接子选择器＋`:not()` 链，包装后要整体重写，稿子只字未提 · 证据：SettingsCard.tsx:738-767/770/1008/1088/1121 结构；styles.ts:161-164 · 建议：§5/§6 明确「每页签引入一个包装容器 div」，`:not()` 链改为藏三个兄弟容器（`.kt-error`/`.kt-saved`/`.kt-tabs` 留在外面），并评估 `.kt-editor` 条件缺席时空面板的语义。

**M2 · 「hidden 与 display:none 视觉等价」论断不准确** · `hidden` 的 UA 层 `display:none` 会被作者级 display 覆盖——`.kt-flows{display:flex}`（styles.ts:143）、`.kt-trial`（:151）、未来的 `.kt-help` 都是作者规则；等价只在「保留 CSS 规则」前提下成立，日后任何人按「双保险冗余」清理 CSS 就藏不住面板 · 证据：styles.ts:143/151 vs UA 规则层叠顺序；稿 §6-2 · 建议：补一条作者级 `.kimi-tide-settings > [hidden] { display: none !important }`，让 `hidden` 自洽，CSS 可见性规则才真是可删的保险。

**M3 · 新增 `data-tab='help'` 规则若「:163-164 同款」照抄会把错误横幅一起藏掉** · trial 页签今天就藏着 `.kt-error`（styles.ts:164 无 `:not(.kt-error)`，flows 行 :163 有——这是 UI 评审 P2-5 修复不彻底的既有 bug）；help 规则必须写 `> :not(.kt-help):not(.kt-tabs):not(.kt-error)`，`.kt-saved` 同理 · 证据：styles.ts:163-164 对照；SettingsCard.tsx:735/736 · 建议：§5 给出新选择器全文，顺手补 trial 行的 `:not(.kt-error)`。

**M4 · ⑦ 第 4 行病因教错误心智模型** · 实际选择是「特异度（命中词数，带图=∞）降序、平手按列表序」（rules.ts:104-123 稳定排序），router.ts:244 的「首条目标可用者生效」是对**排序列表**的遍历；不是「首条命中生效——可能有更靠前的规则先命中」——更常见的反例是**位置靠后但词数更多**的规则赢。§3② 把「首条命中生效」与「特异度排序」并排也自相矛盾 · 证据：rules.ts:119-123；router.ts:244-270 · 建议：② 删「首条命中生效」或限定为「同分平手时」；⑦ 第 4 行改为「可能有特异度更高（命中词更多/带图）的规则胜出，或同分时更靠前者胜出」。

**M5 · 「各用量源可用性」live 条目必然拿不到数据** · CardSnapshot（card-store.ts:30-74）没有任何用量/配额/余额/stale 字段；用量数据在宿主 usage.ts → 面板投影，消费方是 TideDock，SettingsCard 全程接触不到。§4 的「不必另开数据通道」与该条目直接矛盾；「若无宿主数据则降级」不是可能分支而是 v1.2.1 及同版 quota-balance（其数据也只喂 dock）下的确定结局 · 证据：card-store.ts:30-74；TideDock.tsx:141-187 · 建议：从 §4 首版清单删除该项，或显式把「说明页接入用量数据通道」写进范围与文件清单。

**M6 · 防腐烂闸判据不够硬，四处缝** ·（a）只验「路径首段」→ `flows.review.triggerr` 也绿；（b）可选字段（`imageFallback`/`imageFallbackFlow`/`minHits`/`auxTargets` 条目/review 流 `keywordGroup`）不在 DEFAULT_CONFIG_V5 里（config.ts:163-173），全路径走不动；（c）单向闸——新增配置字段无对应 FEATURE_KEYS 条目时不红；（d）「routerConfigSchema 的键集」需摸 schemastery 内部结构，脆 · 证据：settings-schema.ts:81-97；config.ts:146-173 · 建议：键集用 `Object.keys(routerConfigSchema({}))` 解析输出（不碰内部）；FEATURE_KEYS 全路径在 `routerConfigSchema(DEFAULT_CONFIG_V5())` 输出上走通；可选字段在测试内构造一张过 validateRouterConfig 的含全部可选字段样例配置走路径；顶层键集反向 ⊆ FEATURE_KEYS 首段集合（堵 c）。

**M7 · DOCK_ELEMENTS/SETTINGS_SECTIONS 是自证常量** · 闸只对照同一作者手写的清单，TideDock 新增元素不会红，唯一真锚是 H2 目检 · 证据：§7 用例设计；TideDock.tsx 实际渲染项 vs §3① · 建议：dock 每个槽位挂 `data-kt-el` id，在 TideDock DOM 测试断言「渲染 id 集 == DOCK_ELEMENTS」，闸锚到真实 UI。

**M8 · v4 配置用户看到 v5 语义** · flows 页签本身 `isV5` 条件渲染（SettingsCard.tsx:726-730），说明页 ④/⑤ 的静态内容却无条件描述 flows/余额；「live 缺字段不渲染」只盖住动态行 · 证据：SettingsCard.tsx:726；card-store.ts:27 · 建议：§3/§4 补版本门控规则（v4 时折叠 ④/⑤ 或条目级隐藏）。

### 轻微（措辞与完备性）

- **m1 锚点偏差 2 处**：§4「:455 附近」的 useSyncExternalStore 实际在 **SettingsCard.tsx:441**（:455 是 activeTab）；「docs/router.md」实际在 **packages/dsh-kimi-tide/docs/router.md**（598 行数对，相对仓库根路径不对）。
- **m2 转述不确**：§1「首句即 `if (flow.trigger !== 'keywords' …)`」——rules.ts:194 实为 `flow.type !== 'review' || flow.trigger !== 'keywords' || !flow.keywordGroup`，且 :191-192 的 explicitProvider/version 判定在前；结论（manual 永不武装）无误。
- **m3 测试面漏列两处既有钉**：SettingsCard.dom.test.tsx:889 `toHaveLength(3)` 须改 4；ClientStyles.test.ts:44 先例应补 `data-tab='help'` 选择器结构钉。既有 querySelector 断言不受 `hidden` 影响（jsdom 不应用 CSS），仅此两处需动。
- **m4 断言措辞冲突**：「无交互元素（只读断言）」与 `<details>/<summary>` 折叠交互矛盾，应写「无表单控件与按钮（summary 除外）」。
- **m5 覆盖清单缺口**：① 漏 dock 可见元素——命令失败 notice 行（TideDock.tsx:479-481）、dock 整体三态（加载中/暂无面板数据×2，:264-274）；「看不到**原因条**」措辞不准（不渲染的是**决策目标 chip**，buildDecisionSummary 对 keep/default 返 null，index.ts:95）。设置页侧漏：试一句（含「带图不承诺」提示 :1081）、「（未挂载）」灰字（:165-167）、重复条件警示（:805-819）。export/import 是命令非页面控件，§3⑧ 处理正确（commands.ts:395 逐字吻合）。
- **m6 多流歧义**：flows 是注册表、可建多条 review/transcribe 流（SettingsCard.tsx:1142-1173），§4 的「评审流触发方式+组+评审模型」按单数写——须明确「逐流」还是「首个 keywords 流」。
- **m7 措辞过头**：§10-6「两者读同一内容源」只对 FALLBACK_HINTS 成立（§5），其余 tooltip 明确不共享（§10-4）。

### 未覆盖的失败模式

- **F1（§3/§4）**：v4 存量配置打开说明页——④⑤ 描述其配置面不存在的能力（同 M8）。
- **F2（§5）**：`data-tab='help'` 选择器抄错 `:not()` 链 → 错误横幅/保存闪烁在 help 页签隐形（同 M3）。
- **F3（§7）**：新增配置字段无说明条目 → 闸不红（单向闸，同 M6c）。
- **F4（§8）**：同版时 ⑤ 的三态/`—` 语义文案与 quota-balance spec §6.2 三态文案成为两份真理——单一内容源只约束本插件内部，跨稿无机制；§8 应加「⑤ 三态文案与该 spec 的展示文案同源或互相引用」。
- **F5（§8/§9）**：版本裁定若最终「分版」，§3① 的「余额槽/总览入口（若发）」两行须从 DOCK_ELEMENTS 与表格同步剔除——发布检查项应列「条件行随裁定二选一」的执行动作，现在只有原则。

### 对九项核实论断的直接回答（摘要）

1. **CSS 可见性切换**：属实（styles.ts:161-164，`data-tab` 属性 + `>` 子选择器；「保持挂载」由 SettingsCard.tsx:453-454 注释与测试 ：895-901 证实）。`hidden` 改法在保留 CSS 时行为等价、不卸载、测试基本无感，但等价性论证有错且新选择器有 M3 陷阱。
2. **C11/N5**：与 `_ui-review-2026-08-29.md:43` 原文逐字一致；同行的 E-8（刷新按钮可访问名含 slash 命令）、E-11（▸/▾）、E-14 未被也不声称被本次覆盖，范围诚实——但 §3⑧ 恰好复述 `/kimi-tide refresh` 命令，E-8 可顺手处理。
3. **当前值可得性**：8/9 成立（activePreset/打底/规则条数/首条条件/review 三字段/failurePolicy/组与词数均在 `snapshot.config`）；「用量源可用性」必拿不到（M5）。
4. **FALLBACK_HINTS 提升**：安全。单一消费点（SettingsCard.tsx:980），零测试引用，`ImageFallback` 类型自 config.ts:39 可导入；「杜绝双维护」收益小但无害。
5. **八分区对应**：无幽灵内容（① 的余额/总览已条件标注且与 quota-balance spec 吻合）；漏项见 m5；④ 触发二态表与 rules.ts 逐点吻合（trigger/keywordGroup/认领抑制/显式 @/盲区标注 :325 全对上）。
6. **防腐烂闸**：可行但需按 M6 加固；语义漂移（行为改而字段不改）闸不住，稿子已如实限定为「改名/删除/字段易位」，主要防线仍是发布检查项——应在 §10-1 明说。
7. **版本纪律**：自洽。§5⑤/§8 的「同版则写新行为、分版则按 v1.2.1 写」正是「只描述本版 ship 行为」的正确应用；缺口仅在 F5 的执行动作。
8. **测试面**：内容完整性/live/键盘/aria 三块基本够；缺 M7 的 UI 锚、m3 的两处既有钉更新、v4 形态（isV5=false 时 3 个页签）的键盘用例。H1–H5 可执行可判伪，H3（复现起因事故）是亮点，H2 目检最弱（M7 可补硬）。
9. **长度与组织**：默认只展开①仍解决不了起因场景——带着症状来的人要翻到第 4/7 个折叠区。建议：⑦ 提至第 2 位或与①并列默认展开（症状优先）；把④的触发方式 live 行复制一行到页签顶部常驻；从认领提示行（SettingsCard.tsx:948）、试一句 review-flow outcome、dock 降级文案加锚链深跳对应分区（锚点导航不是写控件，不违反 H5）；① 只列常态元素，条件行挪⑤。

### 应保留的优点（改稿时勿丢）

- 状态感知 live 行是本设计的真差异点，H3 端到端复现起因事故的验收设计；
- help-content.ts 纯数据＋纯函数、与渲染器分离、可脱离 DOM 单测的结构；
- ④ 触发二态表内容与源码语义逐点核实吻合——这是全稿最高价值的一节；
- 「只描述本版 ship 行为」纪律、§8 版本裁定显式化、与 semantic-hit-gate 的边界声明；
- 锚点纪律：:455 / :720-733 / :114-115 / :1087-1089 / styles:161-164 区段 / rules:186-204 与 :169-178 / settings-schema:81 / C11-N5 原文 / 11 处与 6 处 title 统计 / 命令清单——全部核实无误。

### 无法核实项

宿主活体行为（读屏遍历 tabpanel、方向键实机体验）；quota-balance spec 的外部端点结论（qwen 无 API 面、deepseek `/user/balance` 契约）——本仓库内无法独立证实，稿子已正确以「若同版」条件化，维持该措辞即可。

---

## 2. 控制器逐项复核（DSH 主 agent，2026-09-15）

| # | 评审意见 | 复核结论 | 本次实读证据 | 处置 |
|---|---|---|---|---|
| M1 | route 页签无单一面板节点，tabpanel 需包装容器 + `:not()` 链重写 | **成立** | `SettingsCard.tsx` 路由区为多个并列子节点；`styles.ts:161-164` 全是 `>` 直接子选择器 | **必改** |
| M2 | `hidden` 会被作者级 `display` 覆盖，「等价」论证不成立 | **成立** | `styles.ts:143`（`.kt-flows{display:flex}`）、`:151`（`.kt-trial`） | **必改**：补 `[hidden]{display:none!important}` |
| M3 | 照抄 `:not()` 链会藏掉错误横幅；**trial 行今天就有此 bug** | **成立（并发现既有 bug）** | `styles.ts:163` 有 `:not(.kt-error)`，`:164`（trial）**没有** | **必改**：help 规则写全，并顺手修 trial 行 |
| M4 | ⑦「首条命中生效」教错心智模型（真实=特异度降序） | **成立** | `rules.ts:119-123` 稳定排序；`router.ts:244` 遍历的是**排序后**列表 | **必改**（同时暴露 README 同款措辞问题） |
| M5 | 「用量源可用性」live 条目拿不到数据 | **成立** | `card-store.ts` 全文无 `quota/usage/balance` 任何字段（grep 零命中） | **必改**：删该条目或显式扩范围 |
| M6 | 防腐烂闸四处缝 | **成立（设计判断类，采纳建议）** | `settings-schema.ts:81-97`；`config.ts:146-173` 可选字段确不在默认配置里 | 采纳加固方案 |
| M7 | `DOCK_ELEMENTS` 自证 | **成立** | 常量由作者手写，无 UI 锚 | 采纳（`data-kt-el`） |
| M8 | v4 用户看到 v5 语义 | **成立** | `SettingsCard.tsx:580-581` `isV5`；flows 页签 `:726-730` 条件渲染 | **必改** |
| m1 | 锚点偏差 2 处（`:441` 非 `:455`；`router.md` 在包内） | **成立** | `SettingsCard.tsx:441` 确为 `useSyncExternalStore`；`:455` 是 `activeTab` | **必改**（措辞） |
| m3 | 既有测试钉 `toHaveLength(3)` 须改 4 | **成立** | `test/SettingsCard.dom.test.tsx:889` 原文 | **必改**（写进测试面） |

**结论**：评审意见 **9 项必改全部成立、0 条误报**，并额外发现一条**既有 bug**（trial 页签隐藏 `.kt-error`）；无严重项，设计骨架完整。本稿出 **v2**，重点：tabpanel 结构前提、`hidden` 语义自洽、⑦/② 的心智模型措辞、live 清单裁剪、防腐烂闸加固。
