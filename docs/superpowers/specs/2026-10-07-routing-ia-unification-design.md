# 路由信息架构统一（关键词规则 × 分工表）设计稿 v1

> **状态**：待用户评审（2026-10-07 起草）。用户当日裁定：「全做」（A+B+C）→「C 做」→「开工」。
> **依据**：实机配置 `C:\Users\tafce\.dsh\profiles\desktop\cordis.patch.yml:101-248`；客户端源码 `SettingsCard.tsx` / `card-store.ts` / `client/index.ts`；宿主官方文档逐字副本（`dsh-plugin-guide`，381 篇，2026-10-07 装置于 `~\.dsh\skills\dsh-plugin-guide`）。
> **前序**：`2026-10-05-team-dispatch-design.md`（D1–D8 团队派发：主驱动恒定 / 分工表 / `via:'role'` / 子代理退出关键词规则）。

---

## 1. 问题（全部实测，非推测）

### 1.1 三个界面症状

1. **规则表空不是渲染 bug，是配置真相**：`activePreset: capability` 且 `rules: []`（配置原文），而 `keywordGroups` 有 **7 组词表**（code / chitchat / review / writing / translate / longdoc / math）⇒ **7 组词表全部悬空**，界面上没有任何地方说明这件事（词表还藏在一个默认折叠的 `<details>` 里）。词表是名词，规则才是动词。
2. **同一个词，三处三个答案**：主会话说「代码」→ `saving` 走 k3（规则命中）/ `capability` 走 flash（打底）；派给 `backend` 队友 → glm-5.3；派给 `frontend` 队友 → k3。用户的感受就是"打架"。
3. **四处在设「用哪个模型」而关系零表达**：默认模型（预设打底）· 主驱动（主会话打底）· 规则表 · 分工表；其中前两者当前**同值**（都是 `deepseek-flash`），用户无法从界面推断差别（差别只在 `driverSticky=true` 时显现）。

### 1.2 两条结构性事实（代码证据）

- **优先级链只活在代码与文档里**：`显式 @ > 调用方点名 > 分工表 role > 关键词规则 > 打底`（`src/router.ts` 优先级链）。客户端目录 grep `优先级|决策顺序|作用域` —— **零命中**。五档决胜顺序对用户完全不可见。
- **预览只算一层**：`previewRoute`（`src/rules.ts:377`）只算主会话；`RoutePreviewDeps` 无队友/角色上下文 ⇒「测试场」的"试一句"**答不出**"派给后端会走谁"。

### 1.3 机制事实（不是缺陷）

运行时两者**并不冲突**：关键词规则只服务主会话（`delegationDepth === 0`），分工表只服务队友（D5/D6）。**冲突发生在信息架构层，不在路由逻辑层。**

**因此本设计的不变量：A / B / C1 零路由行为变更。**

---

## 2. 目标与非目标

**目标**：① 一屏看懂"谁在什么时候决定用哪个模型"；② 两套配置**显式**协调（作用域可见、重叠可解释）；③ 一份真源（界面/技能/命令/台账同源）。

**非目标**：不改路由决策语义；不做 LLM 任务分类器（0.3.x 评分引擎退役结论延续）；不做 N 模型流水线；不动协作流（transcribe / review）语义；不做跨进程成员或 worktree 隔离。

---

## 3. C1：统一视图模型（纯函数，A/B 的基础设施）

新增 `src/routing-view.ts`（host 与 client 共用，零宿主依赖，可快照单测）：

```ts
export type RouteScope = 'session' | 'dispatch'
export type WiringState = 'referenced' | 'claimed-by-flow' | 'orphan'

export interface RoutingRow {
  id: string
  scope: RouteScope
  order: number                     // 同作用域内的相对序
  condition:
    | { kind: 'image' }
    | { kind: 'keywords'; group: string; minHits?: number }
    | { kind: 'role' }              // 认领集合 = teammate[] ∪ {id}（D2 裁定）
  target: RouteTarget               // 复用既有形状（provider/model/effort 或 flow）
  presetId?: string                 // scope === 'session' 时必填
  roleId?: string                   // scope === 'dispatch' 时必填
  wiring: WiringState
  unavailable: boolean              // 复用 availability 三态
}

export interface RoutingView {
  fallback: { target: RouteTarget; reason: string }   // 打底行（可见！）
  session: RoutingRow[]                               // 当前激活预设的 session 行
  dispatch: RoutingRow[]                              // 全部 dispatch 行
  groups: Array<{ name: string; words: number; wiring: WiringState; referencedBy: string[] }>
  overlaps: Array<{ group: string; word: string; roleId: string; sessionTarget: string; dispatchTarget: string }>
  summary: string                                     // 人话摘要（见 §4）
  precedence: Array<{ tier: number; title: string; active: boolean; detail: string }>  // §4 决策链数据
}

export function buildRoutingView(config: RouterConfigAny, deps: ViewDeps): RoutingView
export function describeRouting(config: RouterConfigAny, deps: ViewDeps): string  // = view.summary
```

**单源约定**：`describeRouting` 同时供 ① 设置页顶部摘要 ② `renderTeamSkill` 的 description ③ `/kimi-tide show` 使用——**三处不得各自拼文案**（防漂移，沿用"四处调用点同源"的既有纪律）。

**预览扩展**：`previewDispatch(view, roleId | teammate)` 建在同一 view 之上，不重复实现匹配逻辑。

---

## 4. A：决策链一屏 + 人话摘要 + 空状态

1. **顶部一行摘要**（`describeRouting`）：
   > 主会话：flash 打底 → 命中『代码』走 k3 ｜ 派发：前端→k3、后端→glm-5.3 ｜ 带图：锁存转述
2. **竖直决策链**：五档与 `router.ts` 优先级链**逐档对齐**（档位文案写死并加实现锚点注释）；第 3 档挂**分工表**、第 4 档挂**规则表**——两者不再并列折叠。每档三行式：什么时候轮到它 / 当前生效值 / 关掉它会怎样。
3. **打底可见**：打底作为链的最后一档**显式渲染**（含来源：`driverSticky ? driver : 预设默认`），空规则时不再是一张空表。
4. **空状态说人话**（按 1.1 症状 1 定制）：
   > 未命中任何规则 ⇒ 全部走打底（deepseek-flash）。你已备 7 组词表，但没有任何规则引用它们 ⇒ 现在都不生效。
5. **词表接线徽标**：`被 N 条规则引用` / `被协作流认领（review）` / `⚠ 悬空`。
6. **driver 消歧**：`driverSticky` 开启时，预设默认模型标注「仅主驱动关闭时生效」，否则置灰或折叠。

---

## 5. B：作用域标签 + 重叠解释 + 派发预览 + 接线

1. **作用域徽标**：规则行「主会话」、分工表行「派发时」。两个词一贴，"冲突"即变"分工"。
2. **重叠解释器**（`view.overlaps`）：词表的词与某角色别名/领域词重叠且目标不同 ⇒ 两侧各挂一条**解释条（不是报错）**：
   > 设计使然：主会话说『代码』走 k3；派给『后端』做走 glm-5.3。
   附两个一键动作：让规则目标跟随角色 / 把词并入该角色别名。
3. **测试场加派发层**：选角色（或输入队友名）→ 显示该队友的改道目标与依据，依据枚举复用派发台账口径 `role | explicit | keep | unclaimed`。
4. **词表→角色接线**：给"从词表生成角色"的动作（`writing → qwen-token-plan-cn/qwen3.8-max` 等），让 7 组词不再悬空；生成前走写入期校验（认领名跨角色唯一）。

---

## 6. C2：配置面 v7（统一路由表）

### 6.1 形状

```ts
export interface RouteRowV7 {
  id: string
  scope: 'session' | 'dispatch'
  when: { kind: 'image' } | { kind: 'keywords'; group: string; minHits?: number } | { kind: 'role' }
  target: RouteTarget
  preset?: string        // session 行必填：归属预设 id
  // dispatch 行专用（= v6 RoleEntry 元数据）：
  label?: string; teammate?: string[]; aliases?: string[]; note?: string
}

export interface RouterConfigV7 {
  version: 7
  driver?: RouteTarget | null
  driverSticky?: boolean
  rulesApplyToChildren?: boolean
  routes: RouteRowV7[]                 // 唯一真源
  presets: …                           // 保留：default / hitConfirm / imageFallback（**rules 迁出**）
  keywordGroups: …; flows: …; auxTargets: …
}
```

- **认领集合**沿用 D2 裁定：`teammate[] ∪ {id}`，写入期禁跨角色重复。
- **排序语义**（迁移必须逐字节等价）：session 行 = 先取 `preset === 当前激活预设` 的行，**按它们在本数组中的相对顺序**；打分规则不变（命中词数 desc，平手列表序，image 恒 `+∞`）。
- dispatch 行按数组相对序（= v6 `roles` 插入序）。

### 6.2 迁移与兼容

| 项 | 口径 |
|---|---|
| `migrateV6toV7` | 投影：每个 preset 的 `rules` → session 行（保序，填 `preset`）；`roles` → dispatch 行（保序）。旧字段 `presets[*].rules` / `roles` **保留原值不删**（可回退、可 diff） |
| 运行期读 | **字段判据**：`config.routes ?? deriveFromLegacy(config)`——**禁止版本号门控**（沿用 R2 裁定） |
| 运行期写 | 只写 `routes`；旧字段不再作为真源 |
| 一致性校验 | `routes` 与旧字段**同时存在且冲突** ⇒ `validateRouterConfig` **报错**，不静默择一 |
| 导入导出 | `import-config` / `export-config` 必须携带 `routes` 全字段；10-06「`migrateV5` 逐字段重建丢分工表」的回归钉**扩到 v7** |
| 默认配置 | `DEFAULT_CONFIG_V7()`：routes = 内置预设的 session 行；roles 空表（不预置模型判断，D2 裁定） |

### 6.3 备选 C2-lite（若评审选它）

不动存储：新增 `toRoutingRows(config)` / `applyRoutingRows(config, rows)` 双向投影，UI 编辑走统一模型、存储仍是 v6 两处结构。
**取舍**：零迁移风险；但**手改配置的用户（本用户正是）在文件里仍看到两处结构**，"单表"只存在于界面。**本稿推荐 C2**——理由是用户直接手写 `cordis.patch.yml`，配置面的单表收益是实的；风险由"迁移不丢字段 + 往返测试 + 冲突即报错"三条锁住。

### 6.4 集成口径（C2b，2026-10-07 C2 落地后补记）

**C2 落地暴露的缺口**：`routes` 目前只有形状与校验，**运行期仍只读旧字段**（`RouterConfigAny = V4|V5|V6`，`index.ts:621` 内存形态恒 v6）。若不补这一步，UI 写 `routes` 不会生效，v7 是一层死结构。

**口径：一个纯函数、两个调用边界**——`projectRoutesToLegacy(config)`：

```ts
/** routes 存在时按其重建 presets[*].rules 与 roles（浅拷贝，不改原对象）；routes 缺失原引用返回。 */
export function projectRoutesToLegacy<T extends { routes?: RouteRowV7[]; presets?: …; roles?: … }>(config: T): T
```

| 边界 | 调用点 | 效果 |
|---|---|---|
| **读**（运行期） | `index.ts` attach / `applyConfig` 路径、`commands.ts` import / persist 路径，**在 coercion 之后** | 下游 `matchingRules` / `roleClaimSet` / `renderTeamSkill` / 台账全部不改一行即按 `routes` 走 |
| **写**（客户端，B 项） | `card-store` 的写操作改为一笔 mutate 同时下发 `routes` 与镜像后的旧字段 | 文件里两处永远一致 ⇒ 冲突检测永不误报、旧版插件可回退 |

**零行为变更保证**：`routes ≡ 旧字段`（迁移产物 + 校验强制）时，投影前后 `matchingRules` 全矩阵 / `previewRoute` / `buildRoutingView` **逐字节相等**——这是本步的验收判据。

### 6.5 文档面（同一提交，四处）

`docs/router.md`（新增「统一路由表」节 + v7 配置参考）· 仓库根 `README.md` **与** `README.en.md`（配置示例 + 路由决策说明，双语同提交）· `packages/dsh-kimi-tide/README.md` · `CHANGELOG.md` + 版本号（发版由用户裁定）。

---

## 7. 宿主契约与写通道（含待核实项）

- **注册**：`ctx.slots.inject('settings.section', () => ctx.slots.register({ name:'settings.section', id: CARD_NAMESPACE, order:100, label, inject }, SettingsCard))`（`client/index.ts:264-290`）。**`settings.section` 是现行槽**——官方 slot 树 `references/official-docs/docs/subsystems/slots.md:132` 与 `settings.general.item` / `settings.models.provider-card` / `settings.plugins.tab` 并列。
- **写通道**：`saveTop()`（`card-store.ts:418-449`）双路——`scope.set(field, value)`（`settingsScope` 可用时）否则 `connection.api.settings.mutate({ ns, ops:[{op:'set', path:['router', field], value}], expectedRevision })`；写后按"意图值 vs 实读值"比对判定是否被宿主校验拒绝。
- **⚠ 待核实（实施第一步）**：本机实际走哪条路。官方 0.2 迁移指南写 `ctx.settingsScope` **已删除**，而全库 grep `settingsScope` 在官方文档中**零命中**（只有 `settings.section`）⇒ 卡片很可能已落在 `connection.api.settings.mutate` 兜底路径上。需实机确认：① 哪条通道生效 ② 写落点是否 `profiles\desktop\cordis.patch.yml` ③ 该通道对 v7 新字段的透传是否保真。
- **UI 硬规则**：`docs/ui-radius.md`（圆角按组件角色/尺寸取值）+ `references/official-plugin-dev-skill.md` 的 UI 与性能规则 —— k3 调研回填至 §9。

---

## 8. 验收判据

**单测（新增）**：`buildRoutingView` 快照（空规则 / 缺组 / 无 roles / 目标不可用 / 重叠）；`describeRouting` 与 `renderTeamSkill` description **同源断言**；`previewDispatch` 依据枚举；v6→v7 迁移等价；`routes` × 旧字段冲突 ⇒ 校验报错；import/export 往返不丢字段。

**零行为变更判据**：A/B/C1 落地后全量测试全绿，且 `previewRoute` 既有断言**逐字节不变**。

**实机验收（发版门禁，宿主重启后）**：
- **A-1 摘要**：设置页顶部摘要与本机配置逐项吻合（含"7 组词表悬空"）。
- **A-2 空状态**：`capability` 下明写"全部走打底"，且与实际请求头一致（实发一句话 → `request/header` 解码 = flash）。
- **A-3 打底档**：`driverSticky` 开关切换后，链上打底档与请求头一致（其三变体沿用 A1a/A1b/A1c 口径）。
- **B-1 作用域**：规则行/分工表行徽标齐备。
- **B-2 重叠解释**：制造一条与角色目标不同的规则（如 code→k3 而 backend→glm）⇒ 两侧出现解释条。
- **B-3 派发预览**：测试场选 `backend` ⇒ 显示 glm-5.3 + 依据 `role`；未认领队友 ⇒ `unclaimed`。
- **C-1 迁移**：v6 配置升级后**主会话与派发行为逐字节不变**（对照迁移前的探针结果）；旧字段仍在文件里。
- **C-2 单表**：`cordis.patch.yml` 出现 `routes`，且 UI 编辑只改它。

---

## 9. 官方约束清单（2026-10-07 k3 只读调研回填，逐条带证据）

> 证据路径均相对 `~\.dsh\skills\dsh-plugin-guide\references\`（官方文档逐字副本）。凡官方无原文者，本稿一律标注。

### 9.1 槽与生命周期

- `settings.section` 是**现行槽**，与 `settings.general.item` / `settings.models.provider-card` / `settings.plugins.tab` 同列（`official-docs/docs/subsystems/slots.md:132-136`）；子槽只在具名父条目挂载期间存在，父条目卸载递归折叠（`slots.md:17,21,113`）。
- 注册形状 `register({name, id, order}, Component)`；list 基数 = **id 必填、按 order 排序、再按注册序**（`slots.md:40-44,55`）。
- 跨包贡献用 `ctx.slots.inject(ownerKey, () => ctx.slots.register(...))`，回调随属主每次生命周期重装（`slots.md:21,199`；`official-plugin-dev-skill.md:106`）。
- **`settings.section` 的逐字段契约（label / owner props / cardinality / scope）官方文档未载**，权威是生成的 Client inspect catalog（`slots.md:194`）⇒ 我们的注册项照现状保留，**不新增字段**。
- **0.2 世代未见改名或废弃**：`upgrade-guide/**` 全 6 篇 grep 无任何 settings 槽或 slot 改名条目。

### 9.2 圆角与材质（硬规则）

| 档 | 角色 | R | token |
|---|---|---|---|
| R4 | 细节（H<20） | 4 | `--dsw-radius-xs` |
| R8 | 紧凑控件（H20–28） | 8 | `--dsw-radius-sm` |
| R12 | 标准控件/单行单元格（H32–40：按钮、输入、选择、导航行） | 12 | `--dsw-radius-md` |
| R16 | 大控件/分组内容（嵌套表单组、代码块、diff、文件预览） | 16 | `--dsw-radius-lg` |
| **R20** | **独立内容卡 ＝ 设置卡片** | **20** | `--dsw-radius-xl` |
| R28 | 主容器（输入区、对话框、主/浮动面板） | 28 | `--dsw-radius-panel` |

（`official-docs/docs/ui-radius.md:30-37,41,43`）

- 设置卡片材质写死：`border-radius: var(--dsw-radius-xl)` + `0.5px solid var(--dsw-alias-settings-card-stroke)` + `background: var(--dsw-alias-settings-card-fill)`；嵌套编辑器 R16（`ui-radius.md:97-104`）。
- ⚠ **不得**给普通设置卡加第二道中性边框，**也不得为了区分 tab 给卡片加阴影**（`ui-radius.md:106`）⇒ §4 的决策链**必须靠布局与语义分层**做视觉分组，不能靠加边框/阴影。
- 禁止本地字面量（10px / 14px / 18px / 24px），必须消费具名 token（`ui-radius.md:50`）。
- 间距 / 字号 / 行模式照抄同类宿主页面；**管理类列表的参照是 Plugin Manager 页**（`official-plugin-dev-skill.md:104`）。
- 明暗双主题都要核对实际渲染的外高 / 圆角 / 曲线 / fill / stroke（`ui-radius.md:113`）；fill/stroke 别名须在两套 palette 都被消费（`ui-radius.md:104`）。
- 保留可见的键盘焦点样式，不得把外部 focus ring 裁掉（`ui-radius.md:75`）；抄宿主控件时须保留 `role="switch"` + `aria-checked`、Modal 焦点与 Escape、Tooltip 落位（`official-plugin-dev-skill.md:105`）。

### 9.3 客户端页面的必须 / 不得

**必须**：渲染成 slot 里的 React 组件（`official-plugin-dev-skill.md:103`）；样式用 `--dsw-alias-*` token（`:104`）；**工厂无副作用**——样式 / 定时器 / 监听器在 `apply` 里经 `ctx.effect` / `ctx.on` 注册并返回清理函数（`:69`）；可见文案走 **Client locale 服务**（`:69`）。

**不得**：iframe（`:103`）；**require 任何 Harness Client 包**——`dsh.client.inject` 只做激活排序（`:105`）；**在组件外写 DOM、往 `document.body` 追加**（`:69,106`）；替换 app root；读别的插件的 DOM / 样式表猜位置（`:69`）；组件永远收不到 `ctx`（`slots.md:79`）；别的 feature 包**只能 `import type`**，绝不 import / re-export 其运行值（`slots.md:198`）。

- ⚠ **render 路径抛错会把 slot 条目整块搞白**（`official-plugin-dev-skill.md:105`）⇒ 卡片必须防御性渲染。
- 性能禁忌：不轮询 `agent/status`；不自己 fold 会话事件（在 Host projection 上声明 `wire.view`）；selector 订阅最小切片（`:82,97-100,106,108`；`slots.md:201`）。
- **写操作无 settings.section 专项条款**；通用官方模式 = **Host 服务方法 + Client 经 generated Remote 调用并显示失败**；**不得在 UI 与工具两条路径各维护一份逻辑**（`:112-113`；`web-client.md:20,75`）⇒ 我们的 `saveTop` 双通道符合该模式。

### 9.4 现状差距（本稿顺带记录的合规项，非阻断）

1. **样式注入方式**：`client/index.ts:292-297` 往 `document.head` 追加 `<style>`（有 disposer）。官方推荐"组件局部样式渲染成 React 元素，卸载即移除"（`official-plugin-dev-skill.md:69`）⇒ 列为可选改进。
2. **无 locale**：可见文案硬编码中文，未注册 locale 命名空间（`:69`）⇒ 英文界面下卡片仍为中文。
3. **无展示元数据**：`package.json` 无 `locale/*.json` 的 `meta.title/description`、无导出 `./icon` ⇒ Plugin Manager 行缺标题/图标（另见 0.2「子路径插件展示清单」变更）。
4. **`dsh.client.inject`** 声明了 `@deepseek-ai/dsh-client-ui-conversation` / `@deepseek-ai/dsh-api-remotes`：inject 只做排序，**不得 require**（`:105`）⇒ 实施时确认这两条仅用于排序。

### 9.5 本稿未能核实（诚实标注）

settings.section 的逐字段契约（需 Client inspect catalog）· `__ModuleLoader__.load` 字面工厂形状 · `dsh.client`/`WebBootEntry` 精确类型（在 `subsystems/client-modules.md`，本次未纳入调研范围）· tab/tabpanel 专项可访问性条款（官方文档无此字样）· 逐控件（手写表格 / details / 复选框 / 下拉 / 数字输入）的专章规范（只有通用半径档与行为保留条款）。

---

## 10. 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-10-07 | v1 | 初稿：A/B/C1/C2 四块、v7 形状与迁移口径、宿主写通道待核实项、验收判据 |
