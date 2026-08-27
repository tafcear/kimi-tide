# kimi-tide 路由（规则驱动 0.5.0 → 协作编排 0.6.0 → 匹配语义升级 0.7.0 → 覆盖面补全 + effort 0.8.0）

本文以 `src/` 现行实现为准：0.5.0 起**规则驱动路由**架构（预设 = 默认模型 +
有序规则集；规则条件 = 带图 / 命名关键词组；命中即路由，未命中路由到预设
默认模型打底）；**0.6.0 起规则目标泛化为「模型 | 协作流」**（配置升 v5，见文末
「0.6.0 协作编排扩展」节）；**0.7.0 起关键词匹配语义升级**（ASCII 词边界 +
命中特异度排序 + 可选 minHits 阈值，见文末「0.7.0 匹配语义升级」节）；
**0.8.0 起规则体系补全 + 可解释性 + 推理程度配置**（内置关键词组 2→7 组、
`effort` 可选字段、条件摘要/试一句/决策原因词数，见文末「0.8.0」节）。
0.3.x/0.4.x 的能力评分引擎（classify → 六维评分 →
selectCandidate，配 lambda/routeThreshold/预算窗口）已整体退役；v1/v2/v3 存量
配置经迁移链自动桥接到 v4（见下文「迁移链」）。设计定稿见
`docs/superpowers/specs/2026-08-20-rule-driven-routing-design.md` 与
`docs/superpowers/specs/2026-08-22-collaboration-flows-design.md`。

## 总览

```
agent/pre-step ──► decide(messages, step, hasImageOverride?)
                          │
        1. 显式 @provider（最高优先级，via: 'explicit'）
        2. 预设规则链（列表顺序，首条目标可用者生效，via: 'rule'）
        3. 打底：预设默认模型（未命中 ≠ keep，via: 'default'）
                          │
agent/request ──► applyTo(callConfig) ──► guardImage（模态护栏）
```

事件流（DSH 官方机制，`router.ts: installRouter`）：

- `agent/pre-step`：每轮只在**首个模型步**（`payload.step === 1`）判定一次，
  决策存入 per-agent WeakMap 槽位；工具循环步骤（step > 1）不切模型。
- `agent/request`：消费槽位，`applyTo` 替换 callConfig 的 provider/model
  （同时剥离继承的 `reasoningEffort`）。
- `agent/image-admission`：宿主在图像入队前的准入探针（serial bail 语义）。
  当前选择是 text-only 时宿主本会直接拒图；路由器在「激活预设非 null 且池内
  有多模态可用候选」时认领（返回 true），让 per-step 护栏得到执行机会。

## 预设与规则（`src/config.ts`）

```ts
export type RuleCondition =
  | { kind: 'image' }                    // 带图（本轮或历史含图，锁存后恒真）
  | { kind: 'keywords'; group: string; minHits?: number }  // 命中关键词种数 ≥ minHits（缺省 1；0.7.0）

export interface RouterRule {
  id: string                  // 稳定 id（排序/编辑/测试锚点）
  when: RuleCondition
  target: RouteTarget         // { provider, model, effort? }（effort 可选，0.8.0）
}

export interface RouterPreset {
  name: string                // 显示名
  default: RouteTarget        // 打底模型（未命中规则时的路由目标）
  rules: RouterRule[]         // 有序；首条命中生效
}

export interface RouterConfigV4 {
  version: 4
  /** null = 关闭（逃生舱）；否则为 presets 的键（内置: saving / capability） */
  activePreset: string | null
  presets: Record<string, RouterPreset>
  /** 组名 → 词表；全局共享，内置 7 组（0.8.0），用户可增删改 */
  keywordGroups: Record<string, string[]>
}
```

`DEFAULT_CONFIG_V4()`（内置真相源）：

```yaml
version: 4
activePreset: null            # 默认关闭：装插件不改路由（保守默认）
presets:
  saving:                     # 省钱：默认 flash，带图升 k3，代码升 kimi-for-coding，翻译显式落 flash（0.8.0）
    name: 省钱
    default: { provider: deepseek-official, model: deepseek-v4-flash }
    rules:
      - { id: image-k3,      when: { kind: image },                 target: { kimi-coding, k3 } }
      - { id: code-kfc,      when: { kind: keywords, group: code },     target: { kimi-coding, kimi-for-coding } }
      - { id: translate-v4f, when: { kind: keywords, group: translate }, target: { deepseek-official, deepseek-v4-flash } }
  capability:                 # 能力：默认 k3；0.8.0 序 image→review→code→math→longdoc→writing→translate→chitchat（review 先于 code：审查意图优先，平手落 review）
    name: 能力
    default: { provider: kimi-coding, model: k3 }
    rules:
      - { id: image-k3,       when: { kind: image },                 target: { kimi-coding, k3 } }
      - { id: review-k3,      when: { kind: keywords, group: review },    target: { kimi-coding, k3 } }
      - { id: code-kfc,       when: { kind: keywords, group: code },      target: { kimi-coding, kimi-for-coding } }
      - { id: math-v4p,       when: { kind: keywords, group: math },      target: { deepseek-official, deepseek-v4-pro } }
      - { id: longdoc-k3,     when: { kind: keywords, group: longdoc },   target: { kimi-coding, k3 } }
      - { id: writing-v4p,    when: { kind: keywords, group: writing },   target: { deepseek-official, deepseek-v4-pro } }
      - { id: translate-v4f,  when: { kind: keywords, group: translate }, target: { deepseek-official, deepseek-v4-flash } }
      - { id: chitchat-flash, when: { kind: keywords, group: chitchat },  target: { deepseek-official, deepseek-v4-flash } }
keywordGroups:               # 0.8.0 起内置 7 组（词表全文见文末「0.8.0」节）
  code:     [代码, code, bug, 重构, refactor, 实现, 函数, 测试, 接口, 联调, 部署, 性能, 报错, 日志, 编译, 命令, 脚本]
  chitchat: [你好, 谢谢, 怎么样, 随便, 聊聊, 天气]
  review:   [审查, review, 评审, 挑毛病, 复检, 检查, audit, 意见, 打分]
  writing:  [写作, 文案, 润色, 改写, 扩写, 标题, 推文, 周报, 演讲稿, 总结]
  translate: [翻译, 译成, 中译英, 英译中, translate, 本地化]
  longdoc:  [长文档, 通读, 逐段, 全文, 上万字, 大文档]
  math:     [数学, 证明, 推导, 求解, 公式, 数论, 概率, 逻辑题]
```

要点：

- **内置预设即数据**：与自定义预设同构，无特例；可编辑、可删除。预设 id 为
  `presets` 的 Record 键；新建预设时 UI 输入显示名，id 由名称派生 slug。
- **全局切换**：`activePreset` 单选全局生效（设置卡片主写、dock 只读）；删除
  当前激活预设时**先写 `activePreset: null`、再写删除后的 `presets` 整段**
  （两次顺序写入——宿主 dsh-settings 对每笔写入跑 validate-on-write，
  两个中间态各自合法；反序会产生「activePreset 指向已删预设」的非法中间态
  被拒）。
- **打底语义**：预设激活时未命中规则即路由到预设默认模型，覆盖会话手动选
  模型；需手动控制时把预设切到「关闭」（`activePreset: null`）。

## 决策流程（`src/router.ts: KimiRouter.decide`）

```
decide(messages, step, hasImageOverride?):
  if activePreset === null → keep('router off')                       // 逃生舱
  text = latestUserText(messages)
  hasImage = hasImageOverride ?? messagesContainImage(messages)       // 锁存并入
  1. 显式 @指令（最高优先级）：
     explicit = explicitProvider(text)                                // @kimi/@kimi-tide → kimi-coding
     if explicit:
       pool = metas.filter(provider === explicit && available && (!hasImage || 模态含 image))
       pool 空 → keep('explicit @x: no available candidate')
       否则 route(pool 首个候选, '显式 @x 指令', via: 'explicit')      // 只锁 provider 层；模型=枚举序首个可用
  2. 预设规则链（首条目标可用者生效）：
     preset = presets[activePreset]；缺失 → keep('active preset not found') + warn
     for rule of matchingRules(config, text, hasImage):               // 按序返回全部命中
       if 目标不在枚举池或 available:false → 跳过该规则（降级，继续）    // 见「降级语义」
       else → route(rule.target, `规则「<条件名>」命中 <n> 词[（特异度最高）]`, via: 'rule')   // 0.8.0 起带词数；image 规则无词数
  3. 打底：route(preset.default, `预设「<name>」默认`, via: 'default')
```

- `RouteDecision`：`{ kind: 'route'; target; reason; via: 'explicit'|'rule'|'default' } | { kind: 'keep'; reason }`；0.3.x 的 `scoreDelta` 已退役。
- 规则匹配（`src/rules.ts: matchingRules`，0.7.0 语义）：命中规则按
  （特异度 desc，列表序 asc）稳定排序返回，路由层取首条目标可用者——
  特异度 = 命中关键词种数（image 规则 = ∞ 恒优先，平手按列表序）；
  纯 ASCII 关键词带词边界邻接守卫（`decode`/`unicode`/`barcode` 不误中
  `code`，CJK 邻接放行），中文/混合/短语关键词保持大小写不敏感子串匹配；
  `minHits` 命中种数不足不触发（缺省 1）；引用不存在的关键词组 → 不命中。
- **显式 @指令的模型选择**：`@provider` 只锁 provider 层，目标 = 该 provider
  枚举序首个可用候选（带图时限定多模态），不再按评分挑最优。

## 降级语义（规则目标不可用）

「不可用」= 目标 id 不在全量枚举池（或枚举标记 `available: false`）。命中规则
但目标不可用 → **跳过该规则**（继续匹配后续规则，最终可能落到打底）。图像场景
的最后正确性轨仍是护栏：全池无多模态可用候选时 keep（宿主友好拒绝接管）。
UI 对不可用目标标灰（规则编辑器与默认模型下拉均标灰）。

## 候选池（全量枚举）

```ts
interface CandidateMeta extends RouteTarget {
  modalities: string[]            // 来自 llm.resolveModelInfo().inputModalities
  available: boolean              // 不在实时目录 → false（面板标灰、路由跳过）
}
```

- **Provider 无关全量枚举**（`index.ts: enumerateCandidates`）：`listProviders()`
  全量 → 逐个 `listModels(id)` → `resolveModelInfo` 取模态；0.3.x 的
  `allowedProviders` 白名单已删除。单 provider/model 枚举失败只告警不中断
  （模态解析失败降级 text-only 可用，不丢弃）。
- 路由器**立即挂载**：首个枚举完成前用 `fallbackCandidateMetas`（全部预设
  default + 规则 target 的并集，text-only 种子池）；`llm/adapters-updated`
  事件触发重新枚举。
- 配置目标不在实时目录中时保留为 `available: false`（路由跳过、面板标灰）。

## 不变量（保留的正确性轨）

- **图像护栏**（`applyImageGuard`）：决策/改道后目标仍 text-only 且带图 →
  改道首个可用多模态候选；全池无多模态可用 → 不改道（留给宿主报错），防乒乓。
- **带图会话锁存**：见下节。
- **准入 bail**（`canClaimImageAdmission`）：`activePreset !== null` 且池内有
  多模态可用候选才认领图像。
- **applyTo**：剥 `reasoningEffort`、替换 provider/model——语义不变。

## 带图会话锁存（0.5.0；**0.6.0 起由按图三态 + imageFallback 替代**，本节为历史语义）

**为何锁存**：`agent/pre-step` 的 payload 只含本轮 claimed 消息；文本-only
适配器（deepseek）序列化**全量**历史时对任一 image 块抛 `UNSUPPORTED_CONTENT`
→ 图片一旦进入历史，后续文本轮选文本-only 候选必崩。

**0.5.0 机制**：`installRouter` 持 per-agent `imageSeen` WeakMap——任一 pre-step 含图
即永久锁存；锁存值作为 `decide` 第三参 `hasImageOverride` 强制 `hasImage = true`
→ 带图规则（如内置 saving 预设的 `image-k3`）必然命中，且 request 钩子
`applyImageGuard` 兜底改道。子代理（独立上下文）不受锁存影响。

**⚠️ 已知限制（2026-08-19 实测）**：锁存后会话锁死多模态模型；该模型额度/Key
失效（AUTH 报错）时会话无法切文本模型（`model-unavailable`：历史含图片）
→ **死锁**，存量会话无法救回（历史图片不可逆）。锁存判定不可作为终态方案。

**0.6.0 退役**：布尔锁存 `imageSeen` 退役，由按 agent 的**按图三态状态表**
（`src/image-state.ts`：`native` / `transcribed` / `blind`）+ 预设级
`imageFallback`（`latch` 改道 / `blind` 放行 / `transcribe-lazy` 先补转述）接管——
根解（图片不进主历史的图像转述流）已落地，见「0.6.0 协作编排扩展」节。

## 迁移链（v1 → v3 → v4）

统一入口 `coerceRouterConfigV4`（`src/migrate.ts`），按 `version` 分派：

- **v1（0.2.x，patch 静态块形状）**：`migrateV1` 产出 v2 形 → `migrateV2`；
  `premiumLong` 丢弃并告警；`primary/premium` 映射为 default/candidates。
- **v2**：`migrateV2` 做 provider 改名 `kimi-tide/*` → `kimi-coding/*`
  （scores/costTiers 键前缀同步），version 置 3。**这是纯迁移输入契约**——
  v3 的评分字段只在迁移期被读取，运行面不消费。
- **v3 → v4**：`migrateV3` 语义映射——`mode: off` → `activePreset: null`；
  `cost` → `saving` 预设、`capability` → `capability` 预设；v3 `default` 与
  内置预设默认不同时写入该预设的 `default`（规则保留内置）。**scores /
  candidates / classify / costTiers / routeThreshold / lambda / 预算参数一律
  不迁移**（评分引擎已退役，无从映射）。
- **链路落点**：
  - **settings 命名空间**（主存储，rc.7+）：schema 接受 `version: 2|3|4`
    存量（v3 遗留字段靠 schemastery 非 strict 透传保活）；attach 时
    `hasKimiTideResidue`（version≠4 或含 `kimi-tide` 残留）→ 迁移链 →
    设置文档 `copyFileSync` 留档 `.pre-v4` → `scope.replace` 持久化 →
    迁移值同步直喂首个 `applyConfig`。
  - **sidecar**（无 settings 服务的宿主）：读旧形状 → 同一迁移链 → 写回
    v4，原文件改名 `.pre-v4`；sidecar → 命名空间一次性导入机制保留
    （导入后留档 `.legacy-imported`）。
  - **patch 静态块**（v1 词汇）：`coerceRouterConfigV4` 链整体桥接，仅作
    部署基座（settings base 层）。

## 配置参考（v4 全字段）

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `version` | `4` | `4` | 配置形状版本（schema 兼容接受 2/3/4 存量） |
| `activePreset` | `string \| null` | `null` | 激活预设 id；`null` = 关闭（逃生舱） |
| `presets` | `Record<string, RouterPreset>` | 内置 saving/capability | 预设表；键即预设 id |
| `presets.<id>.name` | `string` | — | 显示名（非空，校验拒绝空名） |
| `presets.<id>.default` | `{provider, model, effort?}` | — | 打底模型（未命中规则时的路由目标；effort 可选，0.8.0） |
| `presets.<id>.rules` | `RouterRule[]` | — | 有序规则表；首条目标可用者生效 |
| `rules[].id` | `string` | — | 稳定 id（排序/编辑/测试锚点） |
| `rules[].when` | `{kind:'image'} \| {kind:'keywords', group, minHits?}` | — | 规则条件：带图 / 命名关键词组 |
| `rules[].when.minHits` | `number \| undefined` | `undefined` | 命中关键词种数下限（≥1 整数；缺省 1；0.7.0） |
| `rules[].target` | `{provider, model, effort?}` \| `{flow}` | — | 命中后的路由目标（provider/model 非空字符串；effort 可选非空串，0.8.0——档位合法性运行期降级） |
| `keywordGroups` | `Record<string, string[]>` | 内置 7 组（0.8.0） | 组名 → 词表；全局共享，用户可增删改 |

**校验**（`settings-schema.ts: validateRouterConfig`，仅对 v4 生效）：
`activePreset` 必须存在于 `presets`；预设名非空；每条规则 `target` 完整；
`when.kind === 'keywords'` 时 `group` 必须存在于 `keywordGroups`（删除被规则
引用的组会被拒绝——先把规则改掉）。legacy version（≠4）直通不校验（迁移兜底）。

**退役字段**（不再出现在 v4）：`mode`、`scores`、`classify`、`allowedProviders`、
`costTiers`、`routeThreshold`、`lambda`、`premiumBudget`、`budgetWindow`、
`charsPerToken`、`candidates`（被 presets 取代）。

## 命令面（`/kimi-tide`）

| 子命令 | 行为 |
|--------|------|
| `preset <id\|off>` | 全局切换激活预设（写 `activePreset`；id 须存在于 presets） |
| `show` | 打印 v4 摘要：当前预设 / 默认目标 / 规则数 / 关键词组数 |
| `set activePreset <id\|off>` | 同 `preset`（`set` 键白名单仅此一键；细粒度编辑由设置卡片承担） |
| `export-config` | 打印当前配置 YAML（settings 命名空间优先，无则 sidecar） |
| `import-config <path\|inline YAML>` | 双形态（见下） |
| `refresh` | 立即轮询配额 |
| `mode …` | **已退役**：报错并提示改用 `preset` |

**import-config 双形态**（沿用 0.3.0 裁定）：

- 参数是已存在文件路径 → 整表替换（validate 后落盘；v2/v3 文件走迁移链）。
- 参数是内联 YAML 文本（`{`/`-` 开头、含换行，或可解析为 mapping）→
  **合并补丁**：深合并进当前配置（对象按字段合并、数组/标量整体替换），
  未出现的字段保留。
- `parseKimiTideCommand` 对 import-config 取子命令后的**完整剩余参数**
  （保留换行/缩进），多行 YAML 原样送达。

所有变更类子命令写 settings 命名空间（无则 sidecar），成功后回调 `onSaved`：
重建路由器、清掉旧决策摘要、重枚举候选、推送面板快照。

## 面板与投影（projection v4）

`kimi-tide/panel` 投影（stateVersion 4）携带：`quota` / **`router`（v4 视图：
`{ activePreset, presetName, defaultTarget, ruleCount }`）**/ **`kimi` 二态接入
指示**（`{ route, key }`）/ `models` 下拉选项 / `configSource` / `candidates`
（provider/model/available 摘要，完整 metas 留在 host）/ `reasoning` /
**`decision`**。

- **决策可观测**（`buildDecisionSummary`）：`DecisionSummary = { chosen, reason }`
  （reason 截断 120 字符，`scoreDelta` 字段已删除）。**上屏规则**：仅
  `via: explicit | rule` 的路由决策上浮；`via: default`（打底，每轮都发生，
  太吵）/ keep / 关闭一律返回 null。配置变更即清空（旧决策不泄漏）。
  示例：`规则「code」命中 2 词（特异度最高） → kimi-coding/kimi-for-coding`
  （0.8.0 起原因带命中词数；image 规则 = `规则「带图」命中`）、
  `显式 @kimi 指令 → kimi-coding/k3`。
- **组件**（`src/client/`）：
  - `TideDock`（`conversation.composer.dock` 只读仪表）：主行 chips（📡 预设名
    或「关闭」、⚡ 预设默认模型、路由 chip、kimi 接入指引 chip、配额 chip、
    决策 chip）+ 「🔄 刷新配额」按钮 + ReasonPanel（configSource 标签 + 决策
    摘要）+ 推理状态行；写控件已整体移除（0.4.0 起）。
  - `SettingsCard`（`settings.section`，id `kimi-tide-router`）：官方设置页
    「月汐」卡片，0.5.0 重做为**预设管理器**——预设选择行（关闭/省钱/能力/
    自定义预设单选）、当前预设编辑器（默认模型下拉 + 规则表：条件下拉/目标
    下拉/上移下移删除/新增）、预设操作（新建/复制/删除）、关键词组管理区
    （折叠；组词表编辑 + 新建/删除组）。0.8.0 增：规则区真语义标题
    （「命中词数多者优先，平手按列表序，带图恒第一」）、规则行 minHits
    可见标签与自动条件摘要、目标 effort 档位下拉（模型未声明档位则禁用
    「跟随默认」）、「试一句」测试器折叠区。写通道经 card-store 的
    `saveActivePreset` / `savePreset` / `createPreset` / `deletePreset` /
    `saveKeywordGroups` / `resetField`（规则表/词表的细粒度编辑由组件组装
    下一个完整字段值后整段提交），全部经 `scope.set`（或 connection 的
    `settings.mutate`）顶层字段整段写（settings 数组全替换语义）。
- 写通道：设置卡片直接写 settings 命名空间；dock 的命令通道（`/kimi-tide …`）
  经 remote 执行、多行文本换行保真，写 settings 命名空间（无则 sidecar）。

## 退役面（0.5.0 删除清单）

- `src/scoring.ts`、`src/scores.ts`（SCORES_VERSION/六维基线/证据分级注释）
- `src/client/ScoreEditor.tsx`、`src/client/CandidateList.tsx`
- classify 的维度权重分类与 `DEFAULT_PATTERNS`（词表迁入
  `DEFAULT_KEYWORD_GROUPS`；`explicitProvider` 与消息工具保留为 `src/rules.ts`）
- 预算窗全部：`premiumBudget`/`budgetWindow`/`routeThreshold`/`lambda`/
  `charsPerToken`、`estimateTokens`、budgetHistory/record/budgetUsage
- `KimiRouter` v1 构造重载、`legacyConfigToV3`/`legacyMetasFromConfig` 等
  v1 桥接导出；`CandidateMeta.costTier` 字段
- 对应测试（scoring/scores/classify 权重断言/评分 UI 测试）

## 逃生

设置卡片切「关闭」或 `/kimi-tide preset off`：`decide` 立即返回 keep，
`installRouter` 不再挂载（`activePreset === null` 时宿主侧不注册
pre-step/request/admission 监听），行为回到原生直通。

## 0.6.0 协作编排扩展（v5，2026-08-23 发布）

### 配置 v5（`src/config.ts`）

```ts
export type RuleTarget = RouteTarget | { flow: string }        // 规则目标泛化
export type ImageFallback = 'latch' | 'blind' | 'transcribe-lazy'
export interface TranscribeFlow { type: 'transcribe'; visionModel: RouteTarget; failurePolicy: 'latch-image' | 'blind'; prompt?: string }
export interface ReviewFlow { type: 'review'; reviewer: RouteTarget; trigger: 'manual' | 'keywords'; rounds: number; autoRevise: boolean; keywordGroup?: string }
export interface CollaborationFlow = TranscribeFlow | ReviewFlow
export interface RouterConfigV5 {
  version: 5
  activePreset: string | null
  presets: Record<string, RouterPreset & { imageFallback?: ImageFallback; imageFallbackFlow?: string }>
  keywordGroups: Record<string, string[]>
  flows: Record<string, CollaborationFlow>   // 预置 transcribe/review，注册但不绑定
}
```

- **行为保持**：v4 → v5 迁移（`migrateV4`）只挂 `flows = DEFAULT_FLOWS()`，不注入
  `imageFallback`（缺省 = latch = 0.5.0 锁存语义），无任何规则引用 flows 键——
  存量配置迁移前后路由行为逐字节一致，设置文档留档 `.pre-v5`。
- **流决策降级**：规则目标为 `{flow}` 时，flow 存在 + transcribe 型 +
  visionModel 在候选池可用，任一不满足按规则降级语义跳过该规则。

### 按图三态状态表（`src/image-state.ts`）

- per-agent `Map<attachmentId, { state: 'native'|'transcribed'|'blind', latchTarget? }>`；
  `latchTarget` = 该图 native 化时的有效视觉目标（护栏调整后的结果）。
- `hasImage` 语义 = 本轮含「未转述」图（attachmentId 不在转述缓存）——替代布尔锁存；
  带图轮之后的关键词命中轮走关键词规则，不再被 image 规则 hijack（0.5.0 锁存副作用不复活）。

### transcribe 流（`src/transcribe.ts` + `router.ts` 编排执行层）

- **eager**（规则目标 = 流）：pre-step 检出本轮未转述图 → `VisionCaller`
  （ctx.llm.stream 直调 flow.visionModel，不传 reasoningEffort）一次性转述 →
  成功标 `transcribed`（LRU 缓存 64，命中不重打）→ 以 `hasImage=false` 重跑
  decide → 文本默认模型作答。
- **lazy**（`imageFallback: transcribe-lazy`）：带图轮原生视觉作答不动；后续
  文本轮面对 native 历史图时先补转述再放行文本目标（一次转述费买「不盲的切回」）。
- **失败策略**：`failurePolicy: latch-image` → 败图保持 native、本轮落 visionModel
  原生作答；`blind` → 败图标 blind 继续。失败入失败集同图不重打；转述调用带
  有界信号（turn 中止 ⊕ 30s 超时，I-2）。
- **智能投影**（`llm/stream` 拦截器，S4c 缝）：text-only 目标请求中命中转述缓存的
  图块被替换为转述文字；无缓存图块保留（rc.2 原生占位投影兜底）；tool-result 嵌套
  图块递归同款处理；WeakSet 重入守卫 + 短路自派恰好一次。

### imageFallback 三态（`resolveImageFallback`）

终决策为 route + 目标 text-only + 历史存在 native 图时介入：

| 姿态 | 行为 |
|------|------|
| `latch`（缺省） | 改道到最近 native 图的 `latchTarget`（决策原因「带图锁存改道」） |
| `blind` | 放行文本目标，rc.2 原生占位投影（用户显式选择便宜+盲） |
| `transcribe-lazy` | 先按 `imageFallbackFlow ?? 'transcribe'` 补转述再放行；失败按流 failurePolicy |

### 监听器 prepend 恒外层（rc.2 宿主契约，`e2d3c68`）

rc.2 `dsh-host-apiproxy` 在 agent 创建时安装 `installModelSelection`——agent 作用域
`agent/request` 覆盖监听器把 provider/model 覆盖回会话选定模型；cordis waterfall
结果 = 最外层监听器返回值，而 kimi-tide 配置变更重挂载会把监听器 push 到链尾（内层）
→ 路由被覆盖（实机：面板决策正确、实际请求恒 session 模型）。修复：
`installRouter` 四监听器（pre-step/request/stream/admission）一律
`ctx.on(name, handler, { prepend: true })`——重挂载任意次数恒为链首（外层）。
详见 host-platform-map §4.7。

### 命令面 v5 与投影 v6

- `show` 补 flows 注册表段（id/类型/关键参数）与每预设 `imageFallback` 行；
  `import-config` 文件 v5 直通（命名空间收敛 v5；sidecar 拒 v5 防静默损毁）。
- 投影 stateVersion 6：`imageContext: { native, transcribed, blind }`（无图会话
  缺席 ≠ 三零计数）+ `lastFlowEvent`（流执行摘要，≤120 截断）——**数据已推送；
  客户端 dock 渲染行降级 0.6.x 跟进**。

## 0.7.0 匹配语义升级（2026-08-26）

三类误路由的对症修复——chitchat 首序劫持 / 子串误中 / 词表过薄：

1. **ASCII 词边界**：关键词为纯 ASCII 词（`^[a-z0-9_]+$`，大小写不敏感）时
   匹配带邻接守卫正则 `(?<![a-z0-9_])词(?![a-z0-9_])`——`decode`/`unicode`/
   `barcode` 不再误中 `code`；CJK 邻接放行（「3d」仍命中「3d打印」类词）。
   中文/混合/多词短语关键词保持 0.5.x 子串语义，逐字节兼容。
2. **命中特异度排序**：规则命中分 = 命中关键词**种数**（同一词多次出现计一次），
   image 规则分 = `+∞` 恒优先；`matchingRules` 按（分 desc，列表序 asc）稳定
   排序，路由层「首条目标可用者生效」循环不变。平手 = 列表序（保留规则顺序的
   心智模型）。内置 capability 预设随之调序 code → chitchat（闲聊首序会劫持
   「你好，帮我写个测试」类混合消息），内置 code 词表 8 → 17 词。
3. **`minHits` 可选阈值**：`when.kind === 'keywords'` 增 `minHits?: number`
   （≥1 整数，缺省 1）；命中种数不足不触发。设置卡片规则行关键词条件带
   「最少命中词数」数字输入（1..n 整数才写）。

**向后兼容**：v5 配置形状不变，新字段全部可选；存量配置导入不迁移、不写回，
未声明 `minHits` 的行为与旧版一致（仅排序与词边界语义按 0.7.0 生效）。

## 0.8.0 规则体系补全 + 可解释性 + 推理程度配置（2026-08-27）

### 关键词组 2 → 7 组（覆盖面补全）

内置关键词组扩到 7 组——新增 review / writing / translate / longdoc / math
五组，chitchat 瘦身为纯寒暄 6 词（「翻译」「总结」分别迁入 translate / writing
组，消除「翻译任务被闲聊规则劫持到 flash」与「总结类写作无处安放」两类缺口）：

| 组 | 词表 |
|---|---|
| `code` | 代码, code, bug, 重构, refactor, 实现, 函数, 测试, 接口, 联调, 部署, 性能, 报错, 日志, 编译, 命令, 脚本（0.7.0 已扩） |
| `chitchat` | 你好, 谢谢, 怎么样, 随便, 聊聊, 天气（瘦身后纯寒暄） |
| `review` | 审查, review, 评审, 挑毛病, 复检, 检查, audit, 意见, 打分 |
| `writing` | 写作, 文案, 润色, 改写, 扩写, 标题, 推文, 周报, 演讲稿, 总结 |
| `translate` | 翻译, 译成, 中译英, 英译中, translate, 本地化 |
| `longdoc` | 长文档, 通读, 逐段, 全文, 上万字, 大文档 |
| `math` | 数学, 证明, 推导, 求解, 公式, 数论, 概率, 逻辑题 |

内置预设随之接组（组表仍全局共享、用户可增删改）：

- **capability 序**：image → review → code → math → longdoc → writing →
  translate → chitchat。review 排在 code 前（用户裁定 2026-08-27：审查意图
  优先于泛 code 词——「帮我审查这段代码」review 1 词 + code 1 词平手时落
  review 目标，平手按列表序）。
- **saving 只加 translate**（image → code → translate；省钱姿态下翻译类消息
  显式落 flash 打底位）。

### `effort` 推理程度配置（可选字段）

`RouteTarget` 增可选 `effort?: string`，共三个配置入口：规则 `target.effort`、
预设 `default.effort`、转述流 `flows.<id>.visionModel.effort`。**review 流的
`reviewer` 不接收 effort**（内联 schema 无该字段，评审执行层不消费——用户圈定
范围，M7）。

优先级与运行期语义（`router.ts: effortForTarget`）：

1. **显式 `target.effort` 覆盖继承值**后再过支持集判定：模型档位表
   （候选枚举时从 `llm.resolveModelInfo().reasoning.efforts` 打成
   `reasoningEfforts: string[]` 挂 CandidateMeta；无 reasoning 的模型不带该
   字段 = 能力未知）支持该档 → 原样写入 callConfig；**不支持 / 能力未知 /
   仅 off → 剥离**（不钳制——用户显式指定的语义；dsh-llm-pi-ai 对不支持
   显式档位抛 `UNSUPPORTED_REASONING_EFFORT` 是第二保险）。降级写日志：
   `kimi-router: reasoning effort <x> → <y|∅> on <provider>/<model>`。
2. **未指定 → 继承语义**（`reasoningEffortFor`，与 0.6.1 逐字节一致）：会话级
   effort 从主力模型继承——支持保留 / 越级向下钳制 / 能力未知或仅 off 剥离。
3. **护栏二次改道不带规则 effort**：图像护栏的改道目标是路由器内部构造的
   多模态候选（无 effort 字段），走继承语义——规则 effort 不泄漏给视觉模型
   （M5 用户裁定）。
4. **显式 `@provider` 指令不指定 effort**：`@` 只锁 provider 层、模型取枚举
   序首个可用，effort 走继承。
5. **转述流 `visionModel.effort`**（`createStreamVisionCaller`）：经同一支持集
   判定后显式下发——支持 → `options.reasoningEffort` 携带；不支持 / 未配置 →
   不携带（视觉模型自身默认）。

**档位合法性 = 运行期降级，非写入期拒绝（M4 口径）**：schema 与
`validateRouterConfig` 只查形状（非空 string），任意档位串（含未知档如
`xhigh`、自定义档）均可写入；运行期按模型支持集判定，不支持即剥离。模型
目录的档位演进因此不需要迁移用户配置。

设置卡片 effort 下拉与上述判定共用同一张档位表（`effort-catalog.ts` 经
Typert remote src-json 通道下发 `provider/model → reasoningEfforts`）；模型
未声明档位时下拉只剩禁用的「跟随默认」。

### 可解释性：条件摘要 + 试一句 + 决策原因词数

- **规则行条件摘要**（`rules.ts: ruleConditionSummary`）：设置卡片每条规则行
  显示自动摘要——image 规则 =「带图」；keywords 规则 =「命中 code 组 ≥1 词」
  （`minHits` 缺省 1，配置 ≥2 时如实显示）。
- **「试一句」测试器**（`rules.ts: previewRoute` 纯函数 + 设置卡片折叠区）：
  输入一句话，实时显示命中规则（含词数）与按当前激活预设的最终路由目标。
  浏览器侧复刻 `decide` 的**文本语义**（显式 @ → 规则链首个目标可用者 →
  打底；目标不可用即跳过），不模拟图像护栏与 flow 降级路径（浏览器侧无
  modalities）——带图输入只展示规则命中，卡片固定声明不承诺最终改道。
- **决策原因词数**：路由决策原因升级为 `规则「code」命中 2 词（特异度最高）`
  （多命中时标注特异度最高；单命中 = `规则「code」命中 1 词`；image 规则 =
  `规则「带图」命中`，∞ 无词数语义）。chip 数据经投影透传，
  `DecisionSummary.reason` ≤120 截断契约不变；`via: default` 打底与 keep
  仍不上 chip（既有语义）。

### 非目标（0.8.0 明确不做）

正则关键词、AND 组合条件、消息长度阈值、LLM 语义分类、`@effort` 行内指令
语法、reviewer effort——均为非目标，不在本版交付面内。
