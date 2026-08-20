# 0.5.0 规则驱动路由设计（Rule-Driven Routing）

> 日期：2026-08-20 ｜ 状态：设计定稿（待用户审阅）｜ 承接：0.4.x「API key 直连」（v0.4.0 已发布）
> 关联文档：`docs/development-plan-router.md`（路线图）、`docs/host-platform-map.md`（宿主契约基线）、`docs/superpowers/specs/2026-08-20-api-key-direct-design.md`（0.4.x 设计）

## 1. 背景与目标

0.4.x 完成「接入层换 pi-ai 原生 kimi-coding 路由」后，路由器本体仍是 0.3.0 的六维评分引擎（classify→权重→scoreCandidate→selectCandidate，配 lambda/routeThreshold/预算窗口）。2026-08-20 晚路线图重议（用户驱动）裁定：**废弃评分引擎，改规则驱动路由**。

**目标形态**：预设（Preset）= 默认模型 + N 条规则；规则条件 = 带图 / 命名关键词组（内置「代码」「闲聊」两组）；命中 → 路由到规则指定模型；未命中 → 路由到预设默认模型（打底语义）。内置「省钱」「能力」两预设，用户可自建/复制/删除命名预设、自配规则与关键词组。候选池 = 接入的全部模型（模型无关）。

**非目标（本迭代不做）**：图像转述模式（0.5.x 第二迭代，改设计）、子代理图片外包（已砍）、kimi 子代理后端（已关闭）、模式预设（agent preset 形态，不立项）、预算窗口/成本追踪（随评分退役）。

## 2. 用户裁决记录（2026-08-20 本会话六问定稿）

| # | 问题 | 裁决 |
|---|---|---|
| 1 | 「闲聊」规则触发方式 | **关键词清单触发**（内置词表可自配；不用兜底——兜底会让能力预设的 k3 打底失效） |
| 2 | 预设切换方式 | **全局切换**（设置面板「月汐」卡片选预设，dock 只读；不做会话级切换） |
| 3 | 自定义预设形态 | **可新建多条命名预设**（内置省钱/能力 + 新建/复制/删除自定义预设） |
| 4 | 规则冲突优先级 | **规则列表顺序、首条命中生效**（UI 可排序）；显式 @指令始终优先于所有规则 |
| 5 | 旧配置迁移 | **语义映射 + 留档**（mode→预设、default→预设默认模型；scores 等评分参数不迁移；.pre-v4 留档） |
| 6 | 规则条件种类 | **带图 + 命名关键词组**（代码/闲聊为内置组，用户可新建组） |

另：用户确认「打底语义」——预设激活时未命中规则即路由到预设默认模型，覆盖会话手动选模型；需手动控制时切「关闭」。

## 3. 调研事实（2026-08-20 双子代理实读，设计依据）

### 3.1 rc.8 宿主契约（8/8 健在，锚点实读）

| 契约 | 结论 | 锚点 |
|---|---|---|
| `agent/pre-step` | 每 turn 首步 `step === 1`；`payload.messages` 只含本轮 claimed 消息（不含历史） | `dsh-agent-loop/lib/index.js:533/552/603`、`:496/501-505` |
| `agent/request` | waterfall：`await next()` 后返回替换的 `{provider, model}` 即改道 | `dsh-agent-loop/lib/index.js:708-718`、`cordis/lib/index.js:307-325` |
| `agent/image-admission` | **仍在** `dsh-host-apiproxy/lib/index.js:2758-2805`（serial、payload `{provider,model}`、`claimed===undefined`→拒；rc.8 hotfix 已重打）。台账「重构到 dsh-attachment/admission.ts」系误记（后者是图片上传准入 `admitEncodedImages`）。0.5.0 必须保留其 bail 应答 | 同上 |
| llm 服务 | `listProviders()` 同步 → `{id,name}`；`listModels(provider)` 异步 → `{provider,id,name,description?,inputModalities?}`；`resolveModelInfo()` → +`context{contextWindow}`/`defaultMaxTokens`/`reasoning`。**无「一次枚举全部模型」接口，无 available 字段** | `dsh-llm/lib/index.js:1141/1273/1298`、`types/types.d.ts:131-258` |
| settings 服务 | `register(ns, schema, {base, validate})`；scope 有 `get/watch/update/replace`；**update 深层 merge 但数组整体替换**（数组逐路径增删需 `ctx.settings.mutate`，scope 无此方法）；schema 可用 `Schema.union` 接受多版本；存量校验失败 → register 硬抛 | `dsh-settings/lib/index.js:311-457`、`schemastery:45/79` |
| agent-presets | 4 内置预设（standard/code/minimal/cordis）的 preset.yml 只有 name/description/order，**无 model/effort 字段**；官方无规则选模型机制 | `$DSH/config/agent-presets/` |
| 消息块 | `UserMessage.content = ContentBlock[]`；text 块 `{type:'text',text}`、image 块 `{type:'image',attachment}`；官方助手 `contentHasImage` | `dsh-llm/lib/types/types.d.ts:39-89`、`message.d.ts:120-133`、`content.d.ts:14` |
| rc.8 新特性 | 无新增路由/选模型事件；`installModelSelection` 是单一选择→agent/request 改道，非规则 hook | — |

### 3.2 生态先例（撞车预警 + 差异化定位）

- **撞车**：社区 `superboy911/dsh-model-router` 已实现「默认模型 + 有序关键词规则、first-match、未命中不动、不调 LLM 猜模型」，与本设计规则核心逐条重合。同类还有 dsh-auto-gearbox（复杂度双路由，需宿主补丁）、dsh-omni-router（整层预设路由）等，关键词/规则路由在 DSH 社区已是红海。
- **差异化（0.5.0 的卖点）**：**命名预设（省钱/能力）+ 预设内规则集 + 一键全局切换 + 用户自建命名预设 + 全量候选池枚举**——此组合无先例。spec 层面明确：我们做的是预设层，不做「又一个关键词规则表」。
- **官方预设桥接 = 死路**：官方架构笔记（[2026-08-03-per-session-agent-presets.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.md)）原文 *"Model routing stays out of presets. `installAgentLlmTarget` is already the per-agent seam for provider, model, and reasoning effort"*。0.5.0 不桥官方预设文件；路由改道继续走 `agent/request`（与 `installAgentLlmTarget` 同族机制）。

### 3.3 本机模型目录（内置预设引用的校准依据）

- pi-ai catalog（`@earendil-works/pi-ai/dist/providers/data/`）：kimi-coding 4 模型均 text+image——`k3`(1048576)、`k3-256k`(262144)、`kimi-for-coding`(262144)、`kimi-for-coding-highspeed`(262144)；deepseek-official（`dsh-llm-deepseek` 拥有）：`deepseek-v4-flash`、`deepseek-v4-pro`（各 1000000，**纯文本**）。
- 本机 `settings.yaml` 的 `llm-pi-ai.providers.kimi-coding.models` **只声明 `k3` + `kimi-for-coding-highspeed`**（models 列表是替换而非扩充 catalog）→ `kimi-for-coding`、`k3-256k` 本机未挂载；旧 v3 配置引用它们是陈旧引用。
- **设计原则**：内置预设按官方 catalog id 书写（`kimi-for-coding`），不可用目标由降级语义（§5.3）兜住 + UI 标灰；本机补挂 `kimi-for-coding` 是实施期用户侧操作项（settings.yaml 一行）。

## 4. 配置形状 v4

```typescript
// src/config.ts（v4 重写）
export type RuleCondition =
  | { kind: 'image' }                    // 带图（本轮或历史含图，锁存后恒真）
  | { kind: 'keywords'; group: string }  // 命名关键词组命中（大小写不敏感子串）

export interface RouterRule {
  id: string                  // 稳定 id（排序/编辑/测试锚点）
  when: RuleCondition
  target: RouteTarget         // { provider, model }
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
  /** 组名 → 词表；全局共享，内置 code / chitchat，用户可增删改 */
  keywordGroups: Record<string, string[]>
}
```

`DEFAULT_CONFIG_V4()`（内置真相源）：

```yaml
version: 4
activePreset: null            # 默认关闭：装插件不改路由（沿用 0.4.x 保守默认）
presets:
  saving:                     # 省钱
    name: 省钱
    default: { provider: deepseek-official, model: deepseek-v4-flash }
    rules:
      - { id: image-k3,   when: { kind: image },                    target: { kimi-coding, k3 } }
      - { id: code-kfc,   when: { kind: keywords, group: code },    target: { kimi-coding, kimi-for-coding } }
  capability:                 # 能力
    name: 能力
    default: { provider: kimi-coding, model: k3 }
    rules:
      - { id: chitchat-flash, when: { kind: keywords, group: chitchat }, target: { deepseek-official, deepseek-v4-flash } }
      - { id: code-kfc,       when: { kind: keywords, group: code },     target: { kimi-coding, kimi-for-coding } }
keywordGroups:
  code:     [代码, code, bug, 重构, refactor, 实现, 函数, 测试]      # 沿用 0.3.0 classify code 组
  chitchat: [你好, 谢谢, 怎么样, 随便, 聊聊, 翻译, 总结, 天气]       # 初始保守词表，用户可改
```

要点：
- **内置预设即数据**：与自定义预设同构，无特例；可编辑、可删除（删除后想恢复可手动重建，不做恢复机制）。
- 预设 id 为 Record 键；新建预设时 UI 输入显示名，id 由名称派生 slug（冲突加后缀）。
- 删除当前激活预设时，同一次写入把 `activePreset` 置 null（关闭）。
- 退役字段（不再出现在 v4）：`mode`、`scores`、`classify`、`allowedProviders`、`costTiers`、`routeThreshold`、`lambda`、`premiumBudget`、`budgetWindow`、`charsPerToken`、`candidates`（被 presets 取代）。

## 5. 规则引擎设计

### 5.1 决策流程（`KimiRouter.decide` 换核）

```
decide(messages, step, hasImageOverride?):
  if activePreset === null → keep('router off')                       // 逃生舱
  text = latestUserText(messages)
  hasImage = hasImageOverride ?? messagesContainImage(messages)       // 锁存并入
  1. 显式 @指令（最高优先级）：
     explicit = explicitProvider(text)                                // 沿用 classify.ts 语义（@kimi→kimi-coding）
     if explicit:
       pool = metas.filter(provider === explicit && available && (!hasImage || 模态含 image))
       pool 空 → keep('explicit @x: no available candidate')
       否则 route(pool 首个候选, '显式 @x 指令', via: 'explicit')      // 只锁 provider 层；模型=枚举序首个可用
  2. 预设规则链（首条命中）：
     preset = presets[activePreset]；缺失 → keep('active preset not found') + warn
     for rule of preset.rules:
       hit = rule.when.kind === 'image' ? hasImage
           : keywordGroups[rule.when.group]?.some(k => text.toLowerCase().includes(k.toLowerCase())) ?? false
       if hit:
         if 目标在枚举池中不可用 → 跳过该规则（降级，视为未命中，继续）   // §5.3
         else → route(rule.target, `规则「<条件名>」命中`, via: 'rule')
  3. 打底：route(preset.default, `预设「<name>」默认`, via: 'default')   // 未命中≠keep：路由到默认模型
```

- `RouteDecision` 改为：`{ kind: 'route'; target; reason; via: 'explicit'|'rule'|'default' } | { kind: 'keep'; reason }`；**`scoreDelta` 退役**。
- 决策摘要上屏规则（见 §9）：仅 `via: explicit | rule` 的决策上屏；`via: default` 不上屏（每轮都发生，太吵）；keep 不上屏。
- 预算史（budgetHistory/record/budgetUsage）整体删除；`charsPerToken`/`estimateTokens` 退役。

### 5.2 不变量（保留的正确性轨，全部沿用 0.4.x 语义）

- **图片锁存**：per-agent `imageSeen` WeakMap——任一轮带图后本会话后续轮 `hasImage` 恒真（pre-step 只见本轮消息，deepseek 适配器序列化全量历史遇图必抛）。
- **图像护栏**：决策/改道后目标仍文本-only 且带图 → 换多模态候选（`applyImageGuard` 语义不变；配置词汇从 v1 改 v4：premium → 首个可用多模态候选）。
- **准入 bail**：`agent/image-admission` 的 serial bail 应答保留（`activePreset !== null` 且池内有多模态可用候选才 claim）。
- **applyTo**：剥 reasoningEffort、替换 provider/model——不变。

### 5.3 降级语义（新增，规则目标不可用）

- 「不可用」= 目标 id 不在全量枚举池（或枚举标记 available:false）。命中规则但目标不可用 → **跳过该规则**（继续匹配后续规则/落到默认）。图像场景的最后正确性轨仍是护栏：若全池无多模态可用候选 → keep（宿主友好拒绝接管）。
- UI 对不可用目标标灰（规则编辑器与默认模型下拉均标灰，沿用 0.4.x `connection.api.llm.models` 通道）。

### 5.4 显式 @指令的模型选择

显式 `@provider` 只锁 provider 层：目标 = 该 provider 枚举序首个可用候选（带图时限定多模态）。不再按评分挑最优（评分已退役）。词表：`@kimi`/`@kimi-tide` → kimi-coding，其余按字面 provider id。

## 6. 迁移设计（v3 → v4）

### 6.1 语义映射（migrate.ts 新增 `migrateV3`）

```typescript
migrateV3(v3: RouterConfigV3): RouterConfigV4 {
  const v4 = DEFAULT_CONFIG_V4()
  if (v3.mode === 'off') { v4.activePreset = null }
  else {
    const presetId = v3.mode === 'cost' ? 'saving' : 'capability'
    v4.activePreset = presetId
    // 用户 v3 default 与内置预设默认不同 → 写入该预设的 default（规则保留内置）
    if (!sameTarget(v3.default, v4.presets[presetId].default)) {
      v4.presets[presetId] = { ...v4.presets[presetId], default: v3.default }
    }
  }
  return v4   // scores / candidates / classify.patterns / 预算参数一律不迁移
}
```

### 6.2 链路与留档

- **settings 命名空间**（主存储）：注册 schema 接受 version 2/3/4 存量（见 §6.3）；attach 时 `hasKimiTideResidue`/`version<4` → `migrateV2`/`migrateV3` 链 → `copyFileSync(documentPath, documentPath + '.pre-v4')` 留档 → `scope.replace` 持久化 → 直喂首个 applyConfig（同步算出迁移值，沿用 0.4.x Ruling D 形态）。
- **sidecar**（无 settings 服务的宿主 / 回退链）：读 v3 sidecar → 同一 `migrateV3` → 写回 v4，原文件改名 `.pre-v4`；sidecar→命名空间一次性导入机制（settings-migration.ts）保留，形状改 v4。
- **patch 静态块**（v1 `RouterConfig`）：`coerceRouterConfig`（v1/v2→v3，沿用）→ `migrateV3` → v4。

### 6.3 schema 兼容层（settings-schema.ts）

- `version: Schema.union([const(2), const(3), const(4)])`。
- v3 遗留字段（mode/scores/candidates/classify/allowedProviders/costTiers/routeThreshold/lambda/premiumBudget/budgetWindow/charsPerToken）在 schema 中保留**宽松默认值**（仅为让存量节过注册校验；迁移后即被替换）。
- v4 新字段（activePreset/presets/keywordGroups）带默认。
- `validateRouterConfig` 按 version 分派：v4 校验 = activePreset 为 null 或存在于 presets；每条规则 target 形状合法；`when.kind==='keywords'` 时 group 必须存在于 keywordGroups；预设 default 形状合法。数组整体写入（scope.update 数组全替换语义，§3.1）天然契合「规则表整体保存」。

**待核实 1**：schemastery 对 schema 外未知键的行为（剥离 or 拒绝）——决定 v3 遗留字段是否必须显式列入 schema。实施 T1 以 RED 测试先行验证。

## 7. 候选池（全量枚举）

- `enumerateCandidates` 去掉 `allowedProviders` 白名单过滤：listProviders 全量 → 逐个 `listModels(id)` → `resolveModelInfo` 取模态（失败降级 text-only 可用，沿用现状注释语义）。
- 可用性：枚举到 = available:true；预设 default/规则目标引用了枚举池外的 id → available:false（UI 标灰 + §5.3 降级）。
- `llm/adapters-updated` 重枚举、首挂载前 fallback 池（从预设 default+规则目标推导）等现状机制保留。

## 8. 设置 UI 重做（SettingsCard）

官方设置页「月汐」卡片（`settings.section`，id `kimi-tide-router`）全量重做为预设管理器：

1. **预设选择行**：单选按钮组——`关闭` / `省钱` / `能力` / 各自定义预设（按 presets 键枚举）；点击即 `activePreset` 全局生效（沿用卡片主写、dock 只读分工）。
2. **当前预设编辑器**（选中非「关闭」时显示）：
   - 默认模型下拉（= 全量候选池，不可用标灰）；
   - 规则表：每行 = 条件下拉（`带图` / 各关键词组名）+ 目标下拉（全量池）+ 上移/下移/删除；底部「新增规则」；
   - 预设操作：新建（输入显示名）/ 复制当前 / 删除当前（删激活预设时 activePreset 同写置 null）。
3. **关键词组管理区**（折叠 details）：组列表 + 每组词表编辑（textarea，逗号/换行分隔）+ 新建/删除组；删除被规则引用的组 → validate 拒绝并提示（先把规则改掉）。
4. **card-store 新方法**：`setActivePreset` / `savePresetField` / `addRule` / `updateRule` / `moveRule` / `removeRule` / `createPreset` / `duplicatePreset` / `deletePreset` / `saveKeywordGroup` / `deleteKeywordGroup`——全部经 `scope.update` 整段写（数组全替换语义）。
5. **退役**：评分滑杆区、数值区（阈值/λ/预算）、高级 JSON 区（classify.patterns/costTiers/allowedProviders）、ScoreEditor.tsx / CandidateList.tsx / ReasonPanel.tsx 删除（TideDock 引用面以实施时扫描为准，见待核实 3）。

## 9. 决策可观测（dock / projection）

- `DecisionSummary`：`{ chosen: {provider, model}, reason }`（scoreDelta 字段删除）。
- 上屏规则：`via: explicit | rule` 且 activePreset 非 null 才显示；`via: default` / keep / 关闭 清空。reason 示例：`规则「代码」命中 → kimi-coding/kimi-for-coding`、`显式 @kimi 指令 → kimi-coding/k3`。
- TideDock 只读紧凑行（沿用 a45d722 形态）：当前预设名（或「关闭」）+ 决策摘要（默认折叠）+ 配额 + kimi 二态指示不变。
- 投影 `router` 字段改 v4 视图：`{ activePreset, presetName, defaultTarget, ruleCount }`；`CandidateSummary.scores` 字段删除。

## 10. 命令族

- `/kimi-tide preset <id|off>`：全局切换（写 activePreset）。
- `/kimi-tide show`：v4 摘要（当前预设/默认/规则数/组数）。
- `/kimi-tide import-config <path|YAML>`：整表导入 v4（路径整表替换 / 内联合并补丁，沿用 0.3.0 双形态）。
- `/kimi-tide set <path> <value>`：v4 键白名单收敛为 `activePreset` 与预设/规则/组的整段写（细粒度编辑由设置卡片承担）。
- 配额/状态类命令不变。

## 11. 评分退役面（删除/改造清单）

**删除**：
- `src/scoring.ts`、`src/scores.ts`（含 SCORES_VERSION/基线/证据分级注释）
- `src/client/ScoreEditor.tsx`、`src/client/CandidateList.tsx`、`src/client/ReasonPanel.tsx`（引用面以实施扫描为准）
- classify.ts 的权重分类与 `DEFAULT_PATTERNS`（词表迁入 `DEFAULT_KEYWORD_GROUPS`）；保留 `explicitProvider` + 消息工具（或并入 router/rules）
- 预算窗全部：`premiumBudget`/`budgetWindow`/`routeThreshold`/`lambda`/`charsPerToken`、`estimateTokens`/`estimateContextTokens`、budgetHistory/record/budgetUsage
- `KimiRouter` v1 构造重载、`legacyConfigToV3`/`legacyMetasFromConfig`/`legacyWeights`、`legacyConfig` getter；index.ts 的 `routerConfigToV3`/`candidateMetasFromConfig`/`v3ToV1View`
- 对应测试：`scoring.test.ts`、`scores.test.ts`、classify 权重断言、SettingsCard 评分 UI 测试、panel v3 ScoreEditor 相关

**改造**：
- `router.ts`：KimiRouter v4 化（§5）；installRouter/护栏/锁存/admission 保留
- `config.ts`：v4 形状 + 内置预设 + `DEFAULT_KEYWORD_GROUPS`
- `classify.ts` → 瘦身为 `explicitProvider`/消息工具（可改名 rules.ts 或直接并入）
- `migrate.ts`：+`migrateV3`；`settings-schema.ts`：§6.3；`index.ts`：枚举去白名单、mountRouter 门控改 `activePreset !== null`、决策摘要语义、投影 v4
- `types.ts`：投影字段（§9）；`commands.ts`：§10；`card-store.ts` / `SettingsCard.tsx` / `TideDock.tsx`：§8/§9

**文档**：
- `docs/router-v3.md` 重写为规则驱动架构（长期偏好「文件名不承载版本号」：git mv 为 `docs/router.md` 并更新全库引用）
- README 路线图 0.5.0 行 + 配置表（中英镜像）；`docs/positioning.md` 状态；`docs/development-plan-router.md` 状态行
- 本 spec 提交归档

## 12. 测试设计

**新增**：
- `rules.test.ts`（引擎全语义）：off → keep；规则顺序首命中；image 规则只看图不看词；关键词组大小写不敏感子串；引用不存在组 → 不命中；目标不可用 → 跳过规则落默认；未命中 → via:'default' 路由到打底；显式 @ 优先于规则；显式 provider 无可用候选 → keep；预设缺失 → keep+warn
- `migrate-v3.test.ts`：off→null；cost→saving（default 相同/不同两例）；capability→capability；scores 不迁移；链式 v1→v3→v4
- `settings-schema` v4：version 2/3/4 存量均可注册；validate 拒绝坏 activePreset/坏规则目标/引用缺失组
- SettingsCard 预设 UI：预设切换写 activePreset；规则增删改排序整段落盘；新建/复制/删除预设（删激活→null）；关键词组增删改；不可用目标标灰
- integration 更新：显式@/规则命中/打底/护栏 端到端

**保留适配**（语义不变、配置词汇改 v4）：router-wiring（step=1 门控）、图像护栏/锁存/admission 测试、settings/sidecar/commands 测试、projection 测试、SettingsCard.dom（hooks 顺序回归钉）。

## 13. 实机验收（实施后，用户重启 dsh web）

1. **迁移**：settings 命名空间 v4（activePreset=capability 由现 mode 映射、default 映射 k3）+ `settings.yaml.pre-v4` 留档 + 卡片显示正常
2. **省钱预设**：闲聊文本→deepseek-v4-flash（request/header）；代码关键词→kimi-for-coding（本机补挂后；未挂时降级 flash 并 UI 标灰）；带图→k3（准入放行 + 护栏，零 UNSUPPORTED_CONTENT）
3. **能力预设**：闲聊关键词→flash；其余→k3（打底）
4. **预设切换**：卡片切预设 → dock 热更新 → 新会话/新轮次路由变化
5. **自建预设全流程**：新建预设 + 新增关键词组 + 规则引用 + 排序 + 删除
6. **显式 @kimi** 仍生效（request/header=kimi-coding/*）
7. **off 逃生舱**：切「关闭」→ 全部 keep
8. **候选池**：全量枚举出数；引用未挂载 id 的规则目标标灰

## 14. 发布范围与版本

- 版本 `0.5.0`（package.json 同步），发布走既有 Actions 流水线（tag 触发，v0.4.0 已验证）。
- 伴随用户侧操作项：本机 settings.yaml 的 kimi-coding models 补挂 `kimi-for-coding`（或把省钱/能力预设的代码规则目标改为 `kimi-for-coding-highspeed`）——卡片标灰会提示。

## 15. 风险与边界

| 风险 | 缓解 |
|---|---|
| 打底语义覆盖会话手动选模型 | 用户已确认该语义（裁决表外补充）；逃生舱 = 关闭 |
| 关键词误命中（子串匹配天然噪音） | 词表用户可自配；规则顺序可控；决策摘要可见 |
| 内置预设引用未挂载模型 | §5.3 降级 + UI 标灰 + 验收 2 覆盖 |
| v3 存量节过不了 v4 schema 导致注册失败 | §6.3 兼容层 + 待核实 1（schemastery 未知键行为 RED 先行） |
| 与社区关键词路由器撞车 | 差异化在预设层（§3.2）；README 定位段同步更新 |

## 16. 待核实项

1. **schemastery 未知键行为**（剥离/拒绝）→ 决定 v3 遗留字段是否必须显式列入 schema；实施首个任务以 RED 测试落锤。
2. **本机 kimi-coding 补挂 kimi-for-coding**（用户侧操作项；台账待核实 3 的收口）。
3. **TideDock 对 ScoreEditor/CandidateList/ReasonPanel 的实际引用面** → 实施时引用扫描后定删除/改造清单。
