# kimi-tide 路由（规则驱动 0.5.0 → 协作编排 0.6.0 → 匹配语义升级 0.7.0 → 覆盖面补全 + effort 0.8.0 → 评审流认领 1.1.0 → 团队派发 2.0.0 → 统一路由表 2.1.0）

本文以 `src/` 现行实现为准：0.5.0 起**规则驱动路由**架构（预设 = 默认模型 +
有序规则集；规则条件 = 带图 / 命名关键词组；命中即路由，未命中以预设
默认模型为默认目标）；**0.6.0 起规则目标泛化为「模型 | 协作流」**（配置升 v5，见文末
「0.6.0 协作编排扩展」节）；**0.7.0 起关键词匹配语义升级**（ASCII 词边界 +
命中特异度排序 + 可选 minHits 阈值，见文末「0.7.0 匹配语义升级」节）；
**0.8.0 起规则体系补全 + 可解释性 + 推理程度配置**（内置关键词组 2→7 组、
`effort` 可选字段、条件摘要/试一句/决策原因词数，见文末「0.8.0」节）；
**1.1.0 起评审流认领关键词组**（`trigger: 'keywords'` 的 review 流认领其
keywordGroup——命中词不再整轮切模型、轮末自动评审，见文末「1.1.0 评审流认领」节）；
**2.0.0 起团队派发**（v6 配置：主驱动恒定 / 分工表 `via:'role'` 改道 / 子代理
退出关键词规则 / 派发台账，见文末「2.0.0 团队派发」节；实机验收 runbook见
`docs/team-dispatch-acceptance.md`）。
**2.1.0 起统一路由表**（v7 配置：关键词规则与分工表合成一张带 `scope` 的
`routes` 表 + 一条五档决策链，路由决策语义零变更，见文末「2.1.0 统一路由表（v7）」节；
实机验收 runbook 见 `docs/routing-ia-acceptance.md`）。
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
        3. 默认目标：预设默认模型（未命中 ≠ keep，via: 'default'）
                          │
agent/request ──► applyTo(callConfig) ──► guardImage（模态护栏）
```

> 上图是 0.5.0 的三档决策链；2.0.0 起扩为**五档**（显式 @ → 调用方点名让位 →
> 分工表 role → 关键词规则 → 默认目标），见文末「2.0.0 团队派发」节的优先级链；
> **2.1.0 起第 3、4 档 = v7 统一路由表 `routes` 的两个 scope**（dispatch / session），
> 见文末「2.1.0 统一路由表（v7）」节与下文「决策流程」节。

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
  default: RouteTarget        // 默认模型（未命中规则时的路由目标）
  rules: RouterRule[]         // 特异度排序匹配（命中词数 desc、平手按列表序、带图恒优先）；逐条尝试目标可用者生效
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
- **默认目标语义**：预设激活时未命中规则即路由到预设默认模型，覆盖会话手动选
  模型；需手动控制时把预设切到「关闭」（`activePreset: null`）。

## 决策流程（`src/router.ts: KimiRouter.decide`，五档）

> **2.1.0 起**：第 3 / 4 档分别是 v7 统一路由表 `routes` 的 `dispatch` / `session` 行
> （见「2.1.0 统一路由表（v7）」节）；配置里没有 `routes` 时，第 4 档读旧字段
> `presets[*].rules`——**行为逐字节等价**（读边界的字段判据，不是版本号门控）。

```
decide(messages, step, hasImageOverride?):
  if activePreset === null → keep('router off')                       // 逃生舱
  text = latestUserText(messages)
  hasImage = hasImageOverride ?? messagesContainImage(messages)       // 锁存并入
  1. 显式 @指令（最高优先级；v1.3.0 Q3 精确寻址 + Q6 已知 provider 门控）：
     explicit = effectiveExplicitDirective(text, knownProviders())     // 只有**已知 provider** 才算指令；取首个「已知」匹配
                                                                       // @README.md / @deepseek-ai/… 不算指令（Q6）
     if explicit:
       pool = metas.filter(provider === explicit && available && (!hasImage || 模态含 image))
       pool 空 → keep('显式 @x 无可用候选（provider 已知但当前无可路由模型）')   // 仅**已知** provider 可达此枝
       explicit.model 命中 pool → route(该模型, '显式 @x/y 指令', via: 'explicit')          // Q3 精确寻址
       explicit.model 未命中 → route(pickExplicitTarget(pool), '显式 @x/y 不可用 → z（依据）')
       否则 → route(pickExplicitTarget(pool), '显式 @x 指令 → z（依据）')  // 确定化：预设已配置目标 → 目录序
     else if 词法命中但 provider 未知 → 记 noteHead，前缀进后续各枝原因串：
                                                                       // '@x 非本路由器已知 provider（已忽略）· '
  2. 调用方点名让位（非队友子代理的既有语义，B-1a）：
     默认目标决策 ∧ 传入目标 ≠ 默认目标 ⇒ keep（保持调用方指定的模型不变）
  3. 分工表 role（v7 = routes 的 dispatch 行；仅队友，via: 'role'）：
     队友身份 ∈ 某角色认领集合（teammate[] ∪ {id}）且目标在候选池可用
       → route(role.target, '分工表「<label>」→ <目标>（队友 <name>）', via: 'role')
     显式 @ 决策与 flow 决策不参与本档（`applyRoleDecision` 首行守卫）
  4. 预设关键词规则（v7 = routes 的 session 行；**仅主会话**，via: 'rule'）：
     preset = presets[activePreset]；缺失 → keep('active preset not found') + warn
     for rule of matchingRules(config, text, hasImage):               // 按序返回全部命中
       if 目标不在枚举池或 available:false → 跳过该规则（降级，继续）    // 见「降级语义」
       else → route(rule.target, `<noteHead>规则「<条件名>」命中 <n> 词[（特异度最高）]`, via: 'rule')   // 0.8.0 起带词数；（特异度最高）仅标注排序后首命中（0.8.x①：降级命中不误标）；image 规则无词数
       // 子代理默认不进本档（rulesApplyToChildren !== true，D6）；图像规则保留
  5. 默认目标：主会话 → route(driverSticky === true && driver ? driver : preset.default, …, via: 'default')
          子代理 → 继承目标（B-1a keep）；driver 为 null / 缺失 ⇒ keep（跟随宿主默认）
```

- `RouteDecision`：`{ kind: 'route'; target; reason; via: 'explicit'|'rule'|'default'|'role' } | { kind: 'flow'; …; via: 'rule' } | { kind: 'keep'; reason }`；0.3.x 的 `scoreDelta` 已退役。（`via: 'role'` 为 2.0.0 起的分工表档。）
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
但目标不可用 → **跳过该规则**（继续匹配后续规则，最终可能落到默认目标）。图像场景
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

### 开箱示例（非路由边界）

下表只列**内置预设与预置流直接引用的模型**（开箱示例）——候选池本身 = 宿主
Models 页全量目录，任何 provider 的任何模型都可作预设默认、规则目标或 `@指令`
对象。

| 来源 | 模型 ID | 模态 | 上下文 | 角色 |
|---|---|---|---|---|
| `kimi-coding` | `k3` | 多模态 | 1M | 能力预设默认目标 / 带图规则目标 |
| `kimi-coding` | `k3-256k` | 多模态 | 256K | 候选 |
| `kimi-coding` | `kimi-for-coding` | 多模态 | 256K | 代码规则目标 |
| `kimi-coding` | `kimi-for-coding-highspeed` | 多模态 | 256K | 候选 |
| `deepseek-official` | `deepseek-v4-flash` | 文本-only | 1M | 省钱预设默认目标 / 闲聊规则目标 |
| `deepseek-official` | `deepseek-v4-pro` | 文本-only | 1M | 候选 |
| `deepseek-official` | `deepseek-v4-flash-vision-exp` | 多模态 | 1M | 预置转述流 vision 目标（0.6.0） |

> 模态与上下文窗均实读自 pi-ai / dsh-llm-deepseek 模型目录（`inputModalities` +
> `contextWindow`）——多模态正是路由器要补偿的核心缺口。

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

> **v5 起的增量迁移**分别在各自版本节：「0.6.0 协作编排扩展」（v4 → v5，挂
> `flows`）、「2.0.0 团队派发」（v5 → v6，`driverSticky` 显式 `false` + `roles: {}`，
> 已存在的分工层字段一律透传）、「2.1.0 统一路由表（v7）」（v6 → v7，投影出
> `routes`，旧字段保留为镜像）。

## 配置参考（v7 全字段）

> **2.1.0 起本节以 v7（`routes` 统一路由表）为主**；v4 / v5 / v6 文档仍被接受——
> 运行期按**字段判据**读取（`routes` 存在即真源，否则旧字段投影），与 `version` 无关。

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `version` | `7`（schema 兼容接受 `2..7`） | schema `.default(6)` | 配置形状版本；**运行期不据此门控**，只服务迁移分派与 schema 兼容（R2 裁定） |
| `activePreset` | `string \| null` | `null` | 激活预设 id；`null` = 关闭（逃生舱） |
| `routes` | `RouteRowV7[]` | 无该键（新装默认仍是 v6 形态 ⇒ `presets[*].rules` 为真源） | **统一路由表（唯一真源）**：session 行 = 主会话关键词/带图规则，dispatch 行 = 分工表派发。`DEFAULT_CONFIG_V7()` 产出「内置预设的 session 行（保序 saving → capability）+ 空 dispatch 行」 |
| `routes[].id` | `string` | — | 稳定 id；**分域唯一**（session 行在预设内唯一、dispatch 行全局唯一——内置预设合法地跨预设复用规则 id） |
| `routes[].scope` | `'session' \| 'dispatch'` | — | 作用域：`session` 只服务主会话、`dispatch` 只服务队友 |
| `routes[].when` | `{kind:'image'} \| {kind:'keywords', group, minHits?} \| {kind:'role'}` | — | 条件；session 行收 image / keywords，dispatch 行只收 role |
| `routes[].when.minHits` | `number \| undefined` | `undefined` | 命中关键词种数下限（≥1 整数；缺省 1；0.7.0） |
| `routes[].target` | `{provider, model, effort?}` \| `{flow}` | — | 路由目标；dispatch 行只收模型目标，`{flow}` 仅限带图 session 行 |
| `routes[].preset` | `string` | — | session 行必填：归属预设 id（须存在于 `presets`） |
| `routes[].label` / `teammate` / `aliases` / `note` | `string` / `string[]` / `string[]` / `string` | — | dispatch 行专用（= v6 `RoleEntry` 元数据）；认领集合 = `teammate[] ∪ {id}`，跨行不得重复 |
| `presets` | `Record<string, RouterPreset>` | 内置 saving/capability | 预设表；键即预设 id。**v7 下 `presets[*].rules` 迁出为镜像**（保留原值不删） |
| `presets.<id>.name` / `presets.<id>.default` | `string` / `{provider, model, effort?}` | — | 显示名（非空）/ 默认模型（effort 可选，0.8.0） |
| `presets.<id>.rules` | `RouterRule[]` | — | 旧字段（镜像）：无 `routes` 时的真源；特异度排序匹配（词数 desc / 平手列表序 / 带图优先），目标不可用跳过降级 |
| `roles` | `Record<string, RoleEntry>` | `{}`（不预置模型判断，D2 裁定） | 旧字段（镜像）：无 `routes` 时的分工表真源 |
| `keywordGroups` | `Record<string, string[]>` | 内置 7 组（0.8.0） | 组名 → 词表；全局共享，用户可增删改 |
| `flows` | `Record<string, CollaborationFlow>` | 预置 transcribe / review | 协作流注册表（v5 起；规则目标可引用） |
| `driver` / `driverSticky` / `rulesApplyToChildren` | `RouteTarget \| null` / `boolean` / `boolean` | 见「2.0.0 团队派发」节 | 主驱动与子代理开关（v6 起） |
| `auxTargets` | `Record<string, RouteTarget>` | `{}` | 辅助请求改道表（envelope `purpose` → 模型目标，如 `session-title`）；空表/无该键 = 不改道，目标不可用保守放行（0.8.x⑧） |

**校验**（`settings-schema.ts: validateRouterConfig`，一律**字段判据**，不以版本号门控）：

- **v5+ 语义主体**（`version` ∈ 5/6/7 时）：`activePreset` 必须存在于 `presets`；
  预设名非空；每条规则 `target` 完整、`when.group` 存在、`minHits` ≥1 整数；
  流目标须为存在的 transcribe 流且仅限带图条件；review 流 `rounds` 1..3；
  `auxTargets` 形状与目标完整。
- **分工层**（存在 `roles` / `driver` 即校验）：认领名跨角色冲突、`label` 非空、
  `target` 完整、`driver` 目标完整。
- **`routes` 块**（存在 `routes` 即校验）：行形状 / 界 / 认领唯一 + **与旧字段的冲突检测**
  ——同一规则或角色在两处不一致 ⇒ **报错拒绝**（不静默择一）。逐项见文末
  「2.1.0 统一路由表（v7）」节的迁移与兼容口径表。

**退役字段**（不再出现在 v4 及更高版本）：`mode`、`scores`、`classify`、`allowedProviders`、
`costTiers`、`routeThreshold`、`lambda`、`premiumBudget`、`budgetWindow`、
`charsPerToken`、`candidates`（被 presets 取代）。

## 命令面（`/kimi-tide`）

| 子命令 | 行为 |
|--------|------|
| `preset <id\|off>` | 全局切换激活预设（写 `activePreset`；id 须存在于 presets） |
| `show` | 打印 v4 摘要：当前预设 / 默认目标 / 规则数 / 关键词组数（v5 另输出 flows 注册表与每预设 `imageFallback` 行；**1.1.0：认领组非空时追加「评审流认领组」行**） |
| `set activePreset <id\|off>` | 同 `preset`（`set` 键白名单仅此一键；细粒度编辑由设置卡片承担） |
| `export-config` | 打印当前配置 YAML（settings 命名空间优先，无则 sidecar） |
| `import-config <path\|inline YAML>` | 双形态（见下） |
| `refresh` | 立即轮询配额 |
| `review` | **1.1.0 §8 手动评审**：取该 agent `lastTurn` 缓存 → 同款异步评审（armed 语义外唯一入口）；无缓存 →「无可评审的上一轮」；路由关闭（评审流未挂载）→ 未挂载文案。命令幂等：连发两次各产生一条评审事件 |
| `mode …` | **已退役**：报错并提示改用 `preset` |

**import-config 双形态**（沿用 0.3.0 裁定）：

- 参数是已存在文件路径 → 整表替换（结构校验 + `validateRouterConfig` 语义
  **拒写校验**后落盘：分工表认领冲突 / role 目标不完整 ⇒ 明确报错且不落盘，
  终审 I3/F5，内联路径同判据；v2/v3 文件走迁移链，v5 文件收敛 v6 且**透传
  文档上已存在的分工层字段**——终审 I3：export→import 往返不再丢分工表）。
- 参数是内联 YAML 文本（`{`/`-` 开头、含换行，或可解析为 mapping）→
  **合并补丁**：深合并进当前配置（对象按字段合并、数组/标量整体替换），
  未出现的字段保留。
- `parseKimiTideCommand` 对 import-config 取子命令后的**完整剩余参数**
  （保留换行/缩进），多行 YAML 原样送达。

所有变更类子命令写 settings 命名空间（无则 sidecar），成功后回调 `onSaved`：
重建路由器、清掉旧决策摘要、重枚举候选、推送面板快照。

## 面板与投影（projection v4）

> 投影 stateVersion 演进：4（本节，0.5.0）→ 6（0.6.0，`imageContext`/`lastFlowEvent`）
> → **7（2.0.0，`dispatch` 派发台账）**；v1.2.0 起面板数据不再写会话日志，由
> `/kimi-tide panel --json` 按 agent 现算供给（dock 取数通道）。

`kimi-tide/panel` 投影（stateVersion 4）携带：`quota` / **`router`（v4 视图：
`{ activePreset, presetName, defaultTarget, ruleCount }`）**/ **`kimi` 二态接入
指示**（`{ route, key }`）/ `models` 下拉选项 / `configSource` / `candidates`
（provider/model/available 摘要，完整 metas 留在 host）/ `reasoning` /
**`decision`**。

- **决策可观测**（`buildDecisionSummary`）：`DecisionSummary = { chosen, reason }`
  （reason 截断 120 字符，`scoreDelta` 字段已删除）。**上屏规则**：仅
  `via: explicit | rule` 的路由决策上浮；`via: default`（默认目标，每轮都发生，
  太吵）/ keep / 关闭一律返回 null。配置变更即清空（旧决策不泄漏）。
  示例：`规则「code」命中 2 词（特异度最高） → kimi-coding/kimi-for-coding`
  （0.8.0 起原因带命中词数；image 规则 = `规则「带图」命中`）、
  `显式 @kimi 指令 → kimi-coding/k3`。
- **组件**（`src/client/`）：
  - `TideDock`（v1.5.0 起挂 `conversation.input.right`——输入工具行右端、提交按钮
    左侧，紧凑态两个小按钮：`预设 → 目标`（点开 ReasonPanel 决策面板）与
    `配额/余额`（点开用量总览）；`variant:'full'` 保留原 `conversation.composer.dock`
    两行完整仪表形态，宿主换位即可复用）：主行 chips（📡 预设名
    或「关闭」、⚡ 预设默认模型、路由 chip、kimi 接入指引 chip、配额 chip、
    决策 chip）+ 「🔄 刷新配额」按钮（仅完整态）+ ReasonPanel（configSource 标签 + 决策
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

v5 相对 v4 的新增配置键速览（行为详见下文各节）：

| 键 | 默认 | 说明 |
|---|---|---|
| `presets.<id>.imageFallback` | `latch` | 预设级带图兜底三态：`latch` 锁存 / `blind` 当无图 / `transcribe-lazy` 懒转述（见「imageFallback 三态」节） |
| `presets.<id>.imageFallbackFlow` | `transcribe` | 懒转述兜底引用的协作流 id（`imageFallback=transcribe-lazy` 时生效，随 `flows` 注册表） |
| `flows` | 预置 transcribe/review | 协作流注册表（规则目标可引用）；预置流注册但不绑定 |

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
- **辅助请求改道**（`llm/stream` 拦截器，0.8.x⑧）：信封带 `purpose` 的非
  agent-loop 辅助调用（宿主会话标题等）按 `auxTargets[purpose]` 覆写
  provider/model，effort 经同一条支持集判定写路径（不支持即剥离——标题请求
  不得携带思考等级）；缺省空表 = 不改道，目标目录不可用保守放行；WeakSet
  重入守卫同款，短路自派恰好一次。动机：标题请求跟随主路由打思考模型撞
  60s 截止（池⑦主根因），本特性为插件侧根治（宿主 profile 覆盖补丁仅解本机）。

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
- 投影 stateVersion 6（**2.0.0 起递升为 7**——panel 新增 `dispatch` 派发台账
  字段，见文末「2.0.0 团队派发」节）：`imageContext: { native, transcribed, blind }`（无图会话
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
  显式落 flash 默认目标位）。

### `effort` 推理程度配置（可选字段）

`RouteTarget` 增可选 `effort?: string`，共四个配置入口：规则 `target.effort`、
预设 `default.effort`、转述流 `flows.<id>.visionModel.effort`、评审流
`flows.<id>.reviewer.effort`（1.4.1 起——撤销 0.8.0 的 M7：评审执行层现在
**消费**该档位，见 `review.ts: createReviewRunner`）。

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
6. **评审流 `reviewer.effort`**（1.4.1，`review.ts: createReviewRunner`）：同一
   口径——支持集里就下发，不支持 / 未声明 / 无 resolver（旧调用点）一律不携带。
   runner 的 resolver 由 `installRouter` 从 `router.metas` 注入，与 VisionCaller
   同源同表。

**档位合法性 = 运行期降级，非写入期拒绝（M4 口径）**：schema 与
`validateRouterConfig` 只查形状（非空 string），任意档位串（含未知档如
`xhigh`、自定义档）均可写入；运行期按模型支持集判定，不支持即剥离。模型
目录的档位演进因此不需要迁移用户配置。

设置卡片 effort 下拉与上述判定共用同一张档位表（宿主候选枚举 →
`effort-catalog.ts: buildEffortCatalog` → 写进**本条目 Config 的 volatile 字段**
`efforts`/`mounted` → 客户端经 `settings.describe` 读回，见
`client/effort-remote.ts` 与 `client/card-store.ts` 的 `asCatalogMeta`）；模型
未声明档位时下拉只剩禁用的「跟随默认（该模型未声明档位）」。

> **1.4.1 实机缺陷（2026-10-03）**：这条通道曾被两处半截改动打断，症状都是
> 「档位下拉全灰、没法设置」：① 客户端 `fetchCatalogMetaViaRemoteDescribe` 仍只查
> 0.1.7 已移除的 `kimi-tide-catalog` 命名空间，查不到时返回**空表**（而非「没数据」），
> 把 `describe` 主通道刚读到的真表覆盖掉；② 宿主侧任何一次 router 写（设置页保存、
> 命令层 persist、sidecar 迁移）经 `configEditor.edit` 整份覆盖时漏掉
> `efforts`/`mounted`，而 `syncCatalog` 的内容脏检查恰好命中、不再补写。两处均已在
> `test/effort-remote.test.ts` 与 `test/settings-port.test.ts` 钉住。

### 可解释性：条件摘要 + 试一句 + 决策原因词数

- **规则行条件摘要**（`rules.ts: ruleConditionSummary`）：设置卡片每条规则行
  显示自动摘要——image 规则 =「带图」；keywords 规则 =「命中 code 组 ≥1 词」
  （`minHits` 缺省 1，配置 ≥2 时如实显示）。
- **「试一句」测试器**（`rules.ts: previewRoute` 纯函数 + 设置卡片折叠区）：
  输入一句话，实时显示命中规则（含词数）与按当前激活预设的最终路由目标。
  浏览器侧复刻 `decide` 的**文本语义**（显式 @ → 规则链首个目标可用者 →
  默认目标；目标不可用即跳过），不模拟图像护栏与 flow 降级路径（浏览器侧无
  modalities）——带图输入只展示规则命中，卡片固定声明不承诺最终改道。
- **决策原因词数**：路由决策原因升级为 `规则「code」命中 2 词（特异度最高）`
  （多命中时仅排序后首命中标注特异度最高——0.8.x① 降级命中不误标；单命中 =
  `规则「code」命中 1 词`；image 规则 =
  `规则「带图」命中`，∞ 无词数语义）。chip 数据经投影透传，
  `DecisionSummary.reason` ≤120 截断契约不变；`via: default` 默认目标与 keep
  仍不上 chip（既有语义）。

### 非目标（0.8.0 明确不做）

正则关键词、AND 组合条件、消息长度阈值、LLM 语义分类、`@effort` 行内指令
语法、reviewer effort——均为非目标，不在本版交付面内。

## 1.1.0 评审流认领（2026-09-04）

**为什么**：「这个做完做交叉评审」这类**延后语境**评审意图，此前会被 `review`
组关键词路由规则整轮劫持——本轮（实为执行任务）被切到评审模型。1.1.0 起语义
改为：keywords 型 review 流**认领**其 keywordGroup，命中词**不再切走整轮模型**，
本轮照常执行，轮末由评审模型自动异步评审（设计稿
`docs/superpowers/specs/2026-09-02-review-flow-design.md`；ReviewFlow 配置形状
见上文「0.6.0 协作编排扩展」节的 v5 配置）。

### 认领语义（`src/rules.ts` / `src/router.ts`）

- **认领 = 配置即事实**：v5 配置 `flows.<id>` 为 review 流且
  `trigger: 'keywords'` + `keywordGroup`（非空）即认领该组；
  `claimedReviewGroups(config)` 收集全部被认领组（v4 无 flows → 空集，
  行为逐字节保持）。预置 review 流默认 `trigger: 'manual'`——**存量行为零突变**，
  用户经设置页把触发方式切到 keywords 并选组后才启用认领。
- **静态抑制**：`decide`（router.ts）与试一句 `previewRoute` 在命中计算后
  统一过滤 `when.kind === 'keywords'` 且组被认领的规则——被认领组的路由规则
  （含内置 capability 预设的 `review-k3`）**无需手删即失效**；抑制无条件
  （与「本轮是否命中」「评审模型是否可用」均无关，语义可预测）。其余规则与
  默认目标照常；显式 @ 指令恒最优先：不被抑制、也不武装评审。
- **轮末自动评审**：每轮首个模型步（step 1）用 `reviewTriggerHit` 判定——
  flows 注册表序首个「文本命中认领组 ≥1 词且 reviewer 在候选池可用」的 review
  流（命中词复用 matchingScored 同款词匹配语义；本轮文本取 latestUserText）。
  命中 → 写 armed 槽（每轮重置）；轮末 turn-stopping 消费：本轮累计产出非空即
  **异步**发起评审（listener 立即返回，不阻塞本轮、不受轮末中止影响），完成/
  失败以 `kimi-tide/review` 事件卡上屏。评审调用 = `ctx.llm.stream` 直调
  reviewer（**60s 有界** AbortSignal.timeout；纯文本无图块、不经 decide、
  不带 effort——M7）；评审输入 = 本轮用户需求 + 本轮产出双段（各 ≤12000
  字符，超出截断并标注）。防环：评审事件非 user/message，永不回流武装，
  armed 每轮至多评审一次。
- **已知限制（关闭路径容忍）**：无 turn-stopping 的轮（pre-step reject /
  延续排空等）不评审，armed 槽留至下一轮覆盖（静默跳过，spec §5 评审修复 L2）。

### 盲区可见性（组认领 + 评审模型不可用）

抑制无条件，但 `reviewTriggerHit` 要求 reviewer 可用才武装——**该轮不自动评审**，
被抑制的旧路由行为也不回退。盲区不静默：试一句 outcome 仍为 review-flow 枝并
显式标注「评审流已认领但评审模型不可用」，routed 照常携带过滤后的实际路由。

### 手动命令与设置页

- **`/kimi-tide review`**（命令表见上）：取该 agent 最近一轮缓存（lastTurn，
  滚动维护不依赖 armed）走同款异步评审——armed 语义外的唯一入口；无缓存 →
  「无可评审的上一轮」；路由关闭（评审流未挂载）→「评审流未挂载（路由关闭
  中）」。命令幂等：每发一次评一次（用户显式行为不去重）。
- **`/kimi-tide show`**：认领组非空时追加一行
  `评审流认领组：<组>…（命中词不再整轮切模型，轮末自动评审）`。
- **设置页**（SettingsCard）：review 流编辑器把触发方式切成 keywords 并选组
  即完成认领；路由规则行的 `when.group` 被认领时该行**置灰**并提示「该组已被
  评审流认领，不再参与路由」——共存允许保存（抑制是自然结果，非非法态）；
  「试一句」命中认领组时 outcome 显示「轮末触发评审流 <flowId>」+ 过滤后路由
  （routed），不再显示切模型。
- **档位（1.4.1）**：评审行与转述行一样有「档位」下拉（`reviewer.effort`）；
  `validateRouterConfig` 只查形状（非空 string），档位合法性由运行期支持集判定
  ——0.8.0/1.1.0 的 M7「评审调用恒不带推理等级」已撤销。

## 1.3.0 用量/余额源 + 说明页 + 语义确认闸 + 显式 @ 精确寻址（2026-09-15）

### 用量/余额源注册表（`src/quota-sources.ts`）

一个源 = 一个 provider 的一份「用量窗」或「余额」数据面；**新源 = 注册表加一项**。
四内置源：`kimi-coding`（`/coding/v1/usages`，周/5h）、`zai-coding-cn`
（`/api/monitor/usage/quota/limit`，CREDIT_LIMIT/TOKENS_LIMIT 双形态）、
`qwen-token-plan-cn`（**无 API 面**：`url/parse` 缺席 + 静态 `unavailableReason`，
诚实呈现「该套餐查不到」而不是伪装成取数失败）、`deepseek-official`（**余额**：
`GET <baseURL>/user/balance`，官方文档契约 `is_available` + `balance_infos[]`，
金额是字符串原样透出）。**baseURL 三段取值链**与宿主 adapter 同源：settings
`llm-deepseek.baseURL` → `process.env.DEEPSEEK_BASE_URL`（bootstrap-only，第三方
插件只能直读 env）→ 官方域。

- **快照类型**：`QuotaLike = QuotaSnapshot | BalanceSnapshot`；`kind: 'balance'`
  是**唯一判别键**（用量快照不带 kind，历史载荷零破坏）。`UsageMonitor` 的
  `parse` / `snapshot()` 已拓宽到 `QuotaLike`，并新增 `timeoutMs`（余额源 15s，
  替代 `0.8 × pollMs`——300s 周期会挂 240s）与 `outcome`（`pending|ok|no-key|error`）。
- **面板元数据**：投影新增 `quotaSources: Array<{provider, kind, state, reason?}>`
  （`state ∈ ok|failed|no-credential|no-api`）——三态的**唯一事实来源**，客户端不再
  从 `null` 猜原因。`quotas` 仍只承载快照。
- **配置**：`balancePollMs`（缺省 300000）。`usagePollOnStart: false` 同时关停
  用量源与余额源（不另设开关）。
- **契约边界**：实时面板走 HTTP 只读路由（`index.ts` 的 `/api/kimi-tide/panel`，
  `JSON.stringify` 直出、**无运行期校验**）；`types.ts` 是唯一契约，projection 的
  zod 自 v1.2.0 起只服务历史会话 fold（其 union 分支为历史诚恳性）。
- **UI**：额度槽按源类型自适应——用量源画两窗（条=**剩余**比例，与「剩 N%」同向）、
  余额源画单槽 `¥金额`；第二行「总览」按钮给出全源一屏（含三态原因）。

### 语义命中确认闸（`src/hit-confirm.ts`，默认关闭）

关键词命中时先让**本预设的 default** 判定真伪：判否 ⇒ 该规则视同不存在（跳过、
继续后续规则）；**问不到**（超时缺省 1200ms / 目标不可用 / 输出解析失败）⇒ 一律
fail-open（按原关键词结果走）。

- **执行序**：`agent/pre-step`（既有 await 点）→ 前置短路（显式 @ 轮；routable
  首位为 image/flow 命中轮——两者零调用）→ 判官 `ctx.llm.stream` 直调（无
  `purpose`、纯文本）→ `omittedRuleIds` 注入 `decide()` 第 4 参。
- **三处调用同带判否集**（首次 + eager/lazy 转述后的两次重跑）——不传则被否规则
  在重跑中复活。
- **标注不变量**：`noteBase`（认领过滤后、判否过滤**前**）与路由链解耦——被否
  规则仍占标注位，故次条不会误标「特异度最高」（0.8.x① 语义保持）。
- **缓存**：LRU 64，键含**判官身份**（换预设不沿用旧判词）；只缓存有结论的结果。
- **配置**：`preset.hitConfirm = { enabled?, timeoutMs?(1..10000), maxTokens?(1..256) }`。
  **不入 settings schema**——对象型字段入 schema 会被 schemastery 注入 `{}`，破坏
  「默认往返相等」；靠未知键透传保活 + `validateRouterConfig` 校验（与 v3 `default`
  同款先例）。
- **验收指标**：判否率与**无结论率**（fail-open 占比）——后者高说明闸门名存实亡。

### 显式 @ 精确寻址与确定化（Q3）

- `@provider/model`：直接钉到该模型（模型段 `[\w.-]`，覆盖 `qwen3.8-max`/`glm-5.3`）；
  目标不可用时**回落并在原因里写明**（`显式 @x/y 不可用 → z（依据）`），不静默改道。
- `@provider` 简写：池内选择**确定化**——优先「本预设已配置过的目标」
  （default → 规则序），其次目录枚举序首个；原因串写出实际模型与依据。
  （实机教训：旧行为下 `@qwen-token-plan-cn` 落到池内首个 MiniMax-M2.5 = 未购买 → 403。）
- `@kimi`/`@kimi-tide` 别名保留；词法边界（邮箱/句中引用不误判）保持不变。
- 「试一句」`previewRoute` 采用同款语义（预演 = decide 的文本语义）。

### 显式 @ 的「已知 provider」门控（Q6）

- **判据**：`effectiveExplicitDirective(text, known)`——词法解析后，只有当 provider 在
  `known` 里才算指令。`known` = 候选目录全部 provider（**含 available:false**）∪
  预设已配置目标（default + 非流转规则目标）∪ 内置 `KIMI_PROVIDER`。含不可用者是有意的：
  `@zai-coding-cn` 在 key 缺失时保持 Q3 的 `keep`，而不是被当成误判丢进规则链。
- **为什么必须用 provider 知识**：`@zai-coding-cn`（真指令）与 `@deepseek-ai`（scoped 包名）、
  `@README`（文件引用）都是 `@[\w-]+`，纯词法不可区分。误判的代价不止"选错模型"——
  `decide` 在候选池为空时返回 `keep`，**整条规则链被跳过**。
- **取首个「已知」匹配**：遍历全部 `@` 候选，返回第一个 provider 已知者——前面的包名不吞掉
  后面的真指令（`见 @deepseek-ai/x，另 @kimi 帮我看` → 认 `@kimi`）。
- **四处调用点同源**（单一实现，防漂移）：`decide` 显式分支、语义确认闸前置短路、
  `reviewTriggerHit`（评审流武装抑制）、`previewRoute`。前两处传 `router.knownProviders()`，
  后两处由调用方传同一集合（`previewRoute` 的 `catalog == null` ⇒ `known = null`）。
- **降级**：`known === null`（调用方拿不到目录）退化为纯词法结果（旧行为）——不误杀真指令。
- **可解释**：词法命中但被判非指令时，原因串前缀 `@x 非本路由器已知 provider（已忽略）· `。
- **有意变更**：未识别的 `@provider`（如 `@anthropic`）由 `keep` 改为落默认目标 + 说明；
  已知 provider 无可用候选仍 `keep`（原因串改为中文并写明"为何 keep"）。
- **noteHead 只交代词法首个未知 @**（Q6 评审轻#4，**按设计保留**）：一句话里出现多个未知 `@` 时不逐一罗列——
  提示词里成串的 scoped 包名会让原因串变成噪声。显式指令命中时其余未知 `@` 不提示（真指令已生效，无需解释）。
- **preview/decide 的 known 集来自两次独立拉取**（Q6 评审轻#5）：宿主走 `enumerateCandidates`、
  浏览器走 `llm.models({})`，公式同构但 adapter 更新与卡片刷新之间可**瞬时分叉**——「试一句 = 决策」
  因此在分类层成立，极端瞬态下可能与实际决策的目标不同（A9 验收时对照试一句与实际决策）。
  两侧降级也不对称：客户端 `catalog == null` 退化纯词法，宿主几乎恒有 metas 恒门控。

## 2.0.0 团队派发（v6 配置 / via:'role' / 主驱动恒定 / 派发台账）

> 状态：**已实现，未发布**（插件版本号仍为 v1.4.1；发版、README/CHANGELOG 与
> 实机门禁另行处理）。设计稿（权威）：
> `docs/superpowers/specs/2026-10-05-team-dispatch-design.md`（v2，§8 十三项
> 已全部按建议值裁定）。实机验收 runbook（发版门禁 A1a–A8 ＋ 两条补验探针）：
> [`team-dispatch-acceptance.md`](./team-dispatch-acceptance.md)。

一句话：**快速主模型全程驱动主会话**（主驱动恒定），专项活按用户配置的
**分工表**派发给专家模型子代理（队友请求在路由层按 `via:'role'` 改道），
派发全程**记账上屏**（派发台账）。插件不内置「谁擅长什么」——分工表默认
空表，能力判断权在用户（v0.5.0 退役评分引擎的裁定延续）。

### v6 四个新字段（`src/config.ts: RouterConfigV6`）

| 键 | 类型 | 默认值口径 | 语义 |
|---|---|---|---|
| `driver` | `RouteTarget \| null`（可缺省） | 缺省 / `null` ＝跟随宿主 `agent-default-model`（`DEFAULT_CONFIG_V6()` 显式写 `null`） | 主驱动目标；仅在 `driverSticky: true` 时参与主会话默认目标（见下） |
| `driverSticky` | `boolean`（可缺省） | **四口径**：新装（`DEFAULT_CONFIG_V6`）＝`true`；存量迁移（`migrateV5`）**显式写 `false`**（保持 v1.4.1 行为，设置页可一键打开）；**缺席解析**（终审 I1/F4：schema 红线无 `.default()`，`readRouterConfig` 与设置卡快照的读取兜底把**缺席**解析为 `true`——卡片单字段写后默认值不再蒸发；显式 `version<6` 未迁移文档除外 ⇒ `false`）；运行期判据 `=== true` | `true` ⇒ 主会话（`delegationDepth === 0`）的默认目标 = `driver`，不再等于 `preset.default`；关键词规则仍可改道（规则是用户显式意图） |
| `rulesApplyToChildren` | `boolean`（可缺省） | 缺省 / `false` ＝**子代理不参与关键词规则**（v2.0.0 行为变更）；`true` 恢复旧语义。**迁移不写该字段**（§8-3 裁定：缺省即新语义） | 见「子代理与关键词规则」 |
| `roles` | `Record<string, RoleEntry>` | 内置 `DEFAULT_ROLES()` ＝**空表**（不替用户做能力判断；设置页提供前端/后端/写作三条可一键填入的示例） | 分工表；键即 `role.id` |

其余字段（`activePreset` / `presets` / `flows` / `keywordGroups` /
`auxTargets`）沿用 v5 不动。schema 的 `version` 判据 union 宽收存量
（2/3/4/5/6）并以 `.default(6)` 供新装。

### RoleEntry 与认领集合（`src/roles.ts`）

```ts
interface RoleEntry {
  id: string          // 稳定 id（配置键），同时是默认认领的队友名（lower-kebab-case）
  label: string       // 显示名，如「前端」
  target: RouteTarget // { provider, model, effort? }（复用既有形状）
  teammate?: string[] // 额外认领的队友名（精确匹配；Team 名字永不复用）
  aliases?: string[]  // 供模型识别的别名，进分工表 skill 正文
  note?: string       // 给模型的补充说明
}
```

- **认领集合 = `teammate[] ∪ { id }`**（`roleClaimSet`）：`role.id` 自动成为
  认领名，杜绝「正文教模型同名起名、匹配却只认 `teammate[]`」的静默失败。
- **跨 role 冲突写入期拒绝**：任一认领名（含 `role.id`）被他 role 认领 ⇒
  `claimConflict(roles)` 返回错误串，`validateRouterConfig` 的分工层块与设置卡片
  `saveRoles` 同判据**守卫式拒写**（先校验、不合法不发写，配置不落盘）。
  分工层块按**字段判据**门控（终审 F5：有 `roles`/`driver` 就校验，不以
  `version === 6` 门控——与运行期读取同款 R2 口径）；`/kimi-tide import-config`
  的文件与内联两条路径落盘前同样跑 `validateRouterConfig`（终审 I3/F5 接上的
  生产校验点：冲突/不完整 ⇒ 明确报错且不落盘——宿主 dsh-settings 的写校验
  不含插件语义，见终审 M2）。
- 校验同块还查：`label` 非空、`target.provider/model` 非空、`driver` 目标完整。

### 决策优先级链（五档，`src/router.ts`）

```
1. 显式 @provider[/model]        via:'explicit'（最高；用户点名最大）
2. 调用方显式点名的模型           非队友委派子代理沿用 B-1a 让位
                                  （默认目标决策 ∧ 传入目标 ≠ 默认目标 ⇒ keep）
3. 分工表 role 命中（新）         仅队友，via:'role'——优先于默认目标与关键词规则
4. 预设关键词规则                 主会话保留；子代理默认跳过（D6，见下）
5. 默认目标                          主会话 = driverSticky ? driver : preset.default
                                  子代理 = 继承目标（B-1a keep）
```

- **role 不覆盖的两档**：显式 `@`（`applyRoleDecision` 首行守卫
  `via === 'explicit'` 直接原样返回——优先级链 1 > 3）与 **flow 决策**
  （`kind === 'flow'`，图像正确性通道，改道会把带图轮送进错误目标）；keep
  决策（router off / 预设缺失）同样不动。
- 第 2、3 档在实践中互斥：队友由 `spawn_teammate` 创建（schema 无模型字段，
  其「传入目标」只是继承值）；`workflow` 委派的子代理可点名模型但不是 Team
  成员、不会被分工表认领。
- `via:'role'` 天然不被 B-1a 让位吞掉（`shouldKeepExternalTarget` 首行守卫
  `via !== 'default'`）。原因串格式：`分工表「前端」→ kimi-coding/k3（队友
  frontend）`（≤120 字符截断惯例；`confirmNote` 判词注记随覆盖保留）。
- **识别与生效**：pre-step（`step === 1`）时 `delegationDepth > 0` 且
  `ctx.agentTeams` 可用 ⇒ `tryMembership(agent)`（非成员/过期身份返回
  undefined 不抛），加 `role === 'teammate'` 纵深防御；取到的名字 ∈ 某 role
  认领集合 ⇒ 命中。配置变更对存量队友**每轮重算动态生效**（不锁定创建时
  配置）。宿主无 agentTeams 服务（装配期 try/catch 探测并缓存布尔）⇒ role
  分支不点火，行为与主会话同形。
- `decide()` 保持纯函数：role 分支与 depth 判定长在 pre-step 闭包里，`decide`
  只新增 `opts.skipKeywordRules` 入参开关。

### 主驱动恒定的两条边界（`applyDriverSticky`）

仅作用于**主会话**且仅作用于**默认目标**决策（`via === 'default'`）——规则/
显式/role/flow/keep 一律原引用返回。两条边界：

1. **`driver` 为 null / 缺失** ⇒ 返回 keep「主驱动跟随宿主默认」（`applyTo`
   对 keep 不改写，请求落宿主 `agent-default-model`；面板照常显示「跟随宿主
   默认」）。
2. **`activePreset === null`（路由关闭＝逃生舱）** ⇒ `installRouter` 整体不
   挂载，driver 不生效——关闭优先于一切。

`driverSticky !== true` ⇒ 原引用返回（存量迁移显式 `false` ⇒ 与 v1.4.1
逐字节一致）。

### 子代理与关键词规则（D6，行为变更）＋判官零调用

- 判据（pre-step 闭包）：`skipKeywordRules = delegationDepth > 0 &&
  rulesApplyToChildren !== true`。命中集在进路由链前按 `when.kind === 'image'`
  过滤——**图像规则保留**（带图轮的改道正确性不依赖关键词），只跳关键词
  规则；显式 `rulesApplyToChildren: true` 恢复旧语义。
- **语义确认闸（hitConfirm）对子会话零调用**：`skipKeywordRules` 时闸块整体
  不点火（关键词规则都不参与，判官无理由点火）——pre-step 闸块首行守卫。

### 派发台账与面板字段（D7，`src/dispatch-ledger.ts`）

- **台账**：插件级（不随路由器配置重挂载清空）、内存态（**不落盘**、不跨
  宿主重启）；条目只存字符串 id，不持 Agent 引用；`agent/disposed` 时按
  agentId 清理。
- **记账点在请求层**（`agent/request`）、图像护栏**之后**——记的是**最终
  生效模型**（护栏可能二次改道）；仅子代理轮记账（槽位 `dispatch` 元信息仅
  `isChild` 写入，主会话轮恒不记）。
- **收口：每个父会话各保留最近 20 条**（他会话的流量不挤占本会话名额），
  读取最新在前。
- **依据枚举** `basis: 'role' | 'explicit' | 'keep' | 'unclaimed'`
  （终审 I2：basis 由**最终生效的决策**决定——最终 `via:'explicit'` ⇒
  `explicit`（带 `teammate`）；最终 `via:'role'` ⇒ `role`；role 命中但终决策
  非 role（flow/keep——图像正确性通道 role 不参与）⇒ `keep`＋`teammate`，
  **不带 `roleLabel`**（keep+roleLabel 是「目标不可用」护栏形态，见下节）；
  队友身份成立但不在任何认领集合 ⇒ `unclaimed`）。
- **面板**：投影 `kimi-tide/panel` **stateVersion 7** 新增 `dispatch` 字段
  （可选——v6 及更早存量载荷无该字段照常通过）；每条含
  `basis / teammate? / roleLabel? / target{provider,model,effort?} / at /
  parentSession?`。快照按 Lead 的 `agent.id`（＝SessionId）取台账——与记账
  键 `parentSession`（子会话 header）同键。dock 派发槽显示最近一次派发（依据
  ＋目标），ReasonPanel 明细最近 20 条；本会话无派发记录时不渲染该槽。

### 分工表进模型上下文（D3，`src/team-skill.ts`）

roles 非空**且路由开启**（`hasActivePreset`）⇒ 注册 runtime skill
`kimi-tide-team`：description ＝角色摘要一行（预算 480 字符，超长退化为
「共 N 个角色＋前 3 条」摘要），正文 ＝角色表（角色/id/目标/认领集合/别名/
备注）＋两种派发配方（①一次性：`workflow` 的 `agent(prompt,{provider,model})`；
②常驻：`spawn_teammate`，**队友名必须取自认领集合**）＋队友名合法性
（lower-kebab-case、≤64 字符、不得为 `lead`）＋何时不派。roles 空 / 路由
关闭 / `ctx.skills` 缺席（try/catch 探测缓存）⇒ 不注册（关闭态先 dispose
旧注册，不留目录残影），不改任何路由行为。配置变更 ⇒ dispose 旧注册、按新
roles 重挂；宿主目录在每个 pre-step 做 snapshot＋digest 比对、惰性替换——
roles 变更会对全活会话做一次目录整段替换（KV 前缀失效一次），建议同批合并
roles/flows 变更。

### 迁移（v5 → v6，`src/migrate.ts: migrateV5`）

- **只新增字段；输入已存在的分工层字段一律透传**（终审 I3）：输入文档**已
  携带** `roles` / `driver` / `rulesApplyToChildren` / `driverSticky` 时原样
  保留——R2 后「version:5 文档带分工层字段」是合法常态（存量升级用户经设置卡
  写分工层后正是此形态，`export-config` 原样产出），逐字段重建曾致
  export→import 往返**静默丢分工表**。**缺席**时才给默认：显式写
  `driverSticky: false` ＋ `roles: {}`；`driver` 与 `rulesApplyToChildren`
  **不写**（前者缺失＝跟随宿主默认；后者缺失＝运行期缺省 `false` 即新语义）。
  既有字段一律原样 ⇒ **主会话路由行为与 v1.4.1 逐字节一致**；唯一行为差来自
  D6（子代理不再参与关键词规则）。
- **为什么存量缺席时显式写 `driverSticky: false`**：新装默认 `true` 由
  `DEFAULT_CONFIG_V6()` 供给，若迁移不写、默认基座又带 `true`，存量用户会被
  `deepMerge` 注入 `true`，违背「存量保持旧行为」（§8-1 落地口径；与设计稿
  §4「迁移不写 `driverSticky`」原文的**显式差异①**，已登记于设计稿「实施
  记录」节）。读取兜底同守此口径（终审 F4）：显式 `version<6` 未迁移文档的
  缺席 `driverSticky` 解析为 `false`，绝不被静默读成 `true`。
- 链路：`coerceRouterConfigV6`（v6 直通幂等，其余经 v1/v2/v3→v4→v5 链收敛）；
  命名空间 attach 时 `hasKimiTideResidueV6` 判残留 → 迁移 → 设置文档留档
  `.pre-v6` → 持久化。

### 实现约束：运行期读取用**字段判据**，不是版本号门控

v6 分工层的运行期读取一律以**字段本身**为判据——`roles ?? {}`（`index.ts:
rolesOf` 与 `router.ts` 的 `teamCfg` 同款）、`driverSticky === true`、
`rulesApplyToChildren !== true`——**绝不以 `config.version === 6` 门控**
（控制器 Ruling R2）：线上 profile patch 与存量配置常显式写 `version: 5`，
而 schema 的 version 默认值只在字段缺失时生效；版本号门控会让用户在设置页
写入的分工表与开关**静默失效**。`version` 字段只服务迁移分派与 schema 兼容。
`validateRouterConfig` 的分工层校验块同按字段判据（终审 F5）：有 `roles` /
`driver` 即校验认领冲突与目标完整性，与运行期读取同一套 R2 口径。

### 设置页（路由页两张新卡）

- **主驱动卡**（`data-kt-section="driver"`）：主驱动目标下拉（含「跟随宿主
  默认」null 档；未挂载目标如实显示不标灰）＋「主驱动恒定」「子代理参与
  关键词规则」两开关，改即保存（`saveDriver` / `saveDriverSticky` /
  `saveRulesApplyToChildren`，saveTop 范式）。
- **分工表卡**（`data-kt-section="roles"`）：角色行编辑（显示名/id/目标/
  额外认领队友/别名/备注，失焦整段保存）、两组示例一键填入（工程 6 个
  前端/后端/运维部署/测试/数据/安全，业务 6 个 写作/市场/销售/客服/
  财务/法务，目标取当前预设默认模型兜底）、认领冲突守卫式拒写（错误经
  状态槽上浮，不写盘）。

### 护栏（§8-6 目标可用性护栏已闭合）

- **档位**：role/driver 目标的 `effort` 沿用 `replaceRoute` 支持集判定
  （支持 → 下发；不支持/能力未知 → 剥离，写降级日志）。
- **role 目标可用性（§8-6 裁定，已落地）**：pre-step 闭包解出 role 命中后、
  套用 role 决策之前，先按**候选池**判定目标可用——目标在 `router.metas`
  中存在且 `available !== false` 才改道；不可用（不在池中 / `available:
  false`）⇒ **不套用 role 决策**，走既有决策路径（子代理通常落默认目标，再由
  B-1a 让位**保持继承值**，不静默换人）。该情形下派发元信息记
  `basis: 'keep'` 并带 `roleLabel` 与 `teammate`（不新增 basis 枚举值），
  面板派发行（dock 摘要槽与决策悬浮层明细共用同一 `formatDispatch`）据此
  逐字显示「**「〈角色名〉」目标不可用 → 保持继承（〈实际生效目标〉）**」
  ——形如「「前端」目标不可用 → 保持继承（kimi-coding/k3）」。**例外**
  （R8）：队友**显式 `@`** 轮（最终决策 `via: 'explicit'`）不记 keep——
  显式点名与 role 目标可用性无关，台账保持 `basis: 'explicit'`（带
  `teammate`、不带 `roleLabel`），面板不误渲染「目标不可用」。可用时行为、
  优先级链、confirmNote 机制一律不变。

## 2.1.0 统一路由表（v7）

> 状态：**已实现，未发布**（版本号升到 2.1.0；tag 与发版由维护者裁定）。
> 设计稿（权威）：`docs/superpowers/specs/2026-10-07-routing-ia-unification-design.md`
> （A 决策链一屏 / B 作用域与重叠解释 / C1 统一视图模型 / C2 配置面 v7 / C2b 运行期投影接入）。
> 实机验收 runbook（发版门禁 A1–A5 / B1–B5 / C1–C4）：[`routing-ia-acceptance.md`](./routing-ia-acceptance.md)。

一句话：**关键词规则（主会话）与分工表（派发）在配置里合成一张带 `scope` 的
`routes` 表**，界面上合成**一条五档决策链**（显式 @ > 调用方点名 > 分工表 role >
关键词规则 > 默认目标）；**路由决策语义零变更**——改的是信息架构，不是行为。

### 为什么要统一（三条实测症状）

1. **规则表空不是渲染 bug，是配置真相**：`activePreset: capability` 且 `rules: []`，
   而 `keywordGroups` 有 7 组 ⇒ 7 组词表全部未接入（词表是名词，规则才是动词）。
2. **同一个词，三处三个答案**：主会话说「代码」走规则目标，派给 `backend` 队友
   走分工表目标——两套作用域各自都合法，但界面上关系零表达（客户端目录
   grep「优先级 / 决策顺序 / 作用域」零命中）。
3. **预览只算一层**：`previewRoute` 只算主会话，答不出「派给后端会走谁」。

机制上两者**本就不冲突**：关键词规则只服务主会话（`delegationDepth === 0`），
分工表只服务队友（D5/D6）。冲突发生在信息架构层，不在路由逻辑层。

### 行形状（`src/config.ts: RouteRowV7`）

```ts
export interface RouteRowV7 {
  id: string
  scope: 'session' | 'dispatch'            // 作用域：主会话规则 / 派发改道
  when:
    | { kind: 'image' }                    // 仅 session 行
    | { kind: 'keywords'; group: string; minHits?: number }   // 仅 session 行
    | { kind: 'role' }                     // 仅 dispatch 行
  target: RuleTarget                       // { provider, model, effort? } 或 { flow }
  preset?: string                          // session 行必填：归属预设 id
  label?: string                           // dispatch 行专用（= v6 RoleEntry 元数据）
  teammate?: string[]; aliases?: string[]; note?: string
}

export interface RouterConfigV7 {
  version: 7
  activePreset: string | null
  presets: Record<string, RouterPreset>    // rules 迁出（旧字段镜像保留）
  flows: Record<string, CollaborationFlow>
  keywordGroups: Record<string, string[]>
  auxTargets?: Record<string, RouteTarget>
  driver?: RouteTarget | null; driverSticky?: boolean; rulesApplyToChildren?: boolean
  roles: Record<string, RoleEntry>         // 旧字段镜像（迁移保留；新装空表）
  routes: RouteRowV7[]                     // **唯一真源**
}
```

YAML 形态（session 行带 `preset`、dispatch 行无 `preset`；旧字段作为镜像同时在场）：

```yaml
version: 7
activePreset: capability
routes:
  - { id: image-k3, scope: session, preset: capability, when: { kind: image }, target: { provider: kimi-coding, model: k3 } }
  - { id: code-kfc, scope: session, preset: capability, when: { kind: keywords, group: code }, target: { provider: kimi-coding, model: kimi-for-coding } }
  - { id: frontend, scope: dispatch, when: { kind: role }, label: 前端, teammate: [k3-ui], target: { provider: kimi-coding, model: k3 } }
presets:                       # 旧字段：镜像（由 routes 的 session 行反投影；迁移产物，不删）
  capability:
    name: 能力
    default: { provider: kimi-coding, model: k3 }
    rules:
      - { id: image-k3, when: { kind: image }, target: { provider: kimi-coding, model: k3 } }
      - { id: code-kfc, when: { kind: keywords, group: code }, target: { provider: kimi-coding, model: kimi-for-coding } }
roles:                         # 旧字段：镜像（由 routes 的 dispatch 行反投影）
  frontend: { id: frontend, label: 前端, target: { provider: kimi-coding, model: k3 }, teammate: [k3-ui] }
```

### scope 语义（对齐运行期，不新增语义）

| scope | 服务对象 | 条件档 | 运行期入口 |
|---|---|---|---|
| `session` | **只有主会话**（`delegationDepth === 0`） | `image` / `keywords` | `matchingRules` → 决策链**第 4 档** |
| `dispatch` | **只有队友**（`delegationDepth > 0` 且被分工表认领） | `role`（认领集合 = `teammate[] ∪ {id}`） | `applyRoleDecision` → 决策链**第 3 档** |

两个作用域**互不改写**：子代理默认不参与关键词规则（`rulesApplyToChildren !== true`，
v2.0.0 D6）；显式 `@` 与 flow 决策不参与 role 档。界面上的「从词表生成角色」只是把
「名词（词表）」接上「动词（角色）」，不改变两侧语义。

### 排序语义（迁移必须逐字节等价）

- **session 行**：先取 `preset === 当前激活预设` 的行（非激活预设的行不生效），
  再按它们**在本数组中的相对顺序**；打分规则不变——**命中词数 desc、平手按列表序、
  `image` 恒最优先（`+∞`）**，取排序后首条目标可用者。
- **dispatch 行**：按数组相对序（= v6 `roles` 的插入序）。
- 因此 `migrateV6` 的**保序投影**是「零行为变更」的前提；行序即 UI 列表序。

### 迁移与兼容口径（`src/config.ts` / `src/migrate.ts` / `src/settings-schema.ts`）

| 项 | 口径 |
|---|---|
| **真源判据** | `routes` **存在即真源**（`rowsFromConfig`；`routes: []` 也算「存在」——视图模型的行集因此为空）；缺失才由旧字段投影（`rowsFromLegacy`）。**字段判据、禁止版本号门控**（R2 裁定）——`version` 只服务迁移分派与 schema 兼容 |
| **迁移** | `migrateV6`（入口 `coerceRouterConfigV7`）：**浅拷贝 + 只改 `version` / `routes`**，`presets[*].rules` 与 `roles` **保留原值不删**（可回退、可 diff）；v7 输入原引用直通（幂等）。`coerceRouterConfigV6` 认 6 与 7 ⇒ 迁移链不再摧毁 v7 字段 |
| **读边界** | `projectRoutesToLegacy(config)`：`routes` 存在且非空 ⇒ 按其重建 `presets[*].rules`（session 行按数组相对序落回所属 preset）与 `roles`（dispatch 行 → v6 `RoleEntry`，`label` 缺省回落 `id`；无效 `preset` 引用的行保守丢弃），下游 `matchingRules` / `roleClaimSet` / `renderTeamSkill` / 台账**不改一行**即按 `routes` 走；`routes` 缺失或空数组 ⇒ **原引用返回**（v6 及更早零行为变更）。调用点：`index.ts` 的 `applyConfig`（attach 与 volatile 变更共用同一口）、`commands.ts` 的 import 与 persist、`card-store` 的读边界投影 |
| **写边界** | 运行期只写 `routes`；设置卡片的 `presets` / `roles` 写操作**同笔双写 `routes` 镜像**（`rowsFromLegacy` 单源，由「将要写入的 presets/roles」推出）。scope 路径是**三笔序列**：`unset routes` → `set 旧字段` → `set routes`（mutate 路径单笔三 ops 同序）——顺序是**硬约束**：宿主 validate-on-write 逐笔跑 `routes` × 旧字段冲突检测，「改既有规则 / 角色」时两笔直写无论先后都会撞上中间态冲突 ⇒ 编辑永不落盘（死锁）；且 ② 落定后即使 ③ 中断，文件也是「无 routes + 新旧字段」的自洽态。写后仍走「意图值 vs 实读值」比对（`routes` 与旧字段任一不一致即上浮 error 通道）。**`version` 字段不动** |
| **一致性校验** | `validateRouterConfig` 的 `routes` 块（`validateRoutes`，字段判据）：行形状 / `scope` 与 `when` 匹配 / session 行必带存在的 `preset` / **分域唯一**（session 在预设内唯一、dispatch 全局唯一）/ `group` 存在且 `minHits` ≥1 整数 / `target` 完整（dispatch 行不收流引用；流目标仅限带图行且须是存在的 transcribe 流）/ dispatch 认领名跨行唯一；**并与旧字段比对**：同一规则或角色两处不一致 ⇒ 返回错误串（不静默择一） |

> **兼容性结论**：配置里**没有 `routes`** 的文档（v4 / v5 / v6 存量与新装默认）
> 行为**逐字节不变**；`routes ≡ 旧字段` 时投影前后 `matchingRules` / `previewRoute` /
> `buildRoutingView` **逐字节相等**（C2b 验收判据）。`DEFAULT_CONFIG_V7()`
> 与 `coerceRouterConfigV7` 目前只由测试与导入路径消费——运行期**不自动**把文档
> 升级到 v7，`routes` 落盘的时机是「迁移 / 导入 / 设置卡片写入」。
>
> ⚠ **`routes: []` 是唯一的不对称角落**（手写配置请注意）：`rowsFromConfig` 认它「存在」
> ⇒ 视图模型渲染成「无规则、全部使用默认目标」，而 `projectRoutesToLegacy` 对**空数组**
> 原引用返回 ⇒ 运行期仍读旧字段。想关掉统一表请**直接删掉 `routes` 键**，不要留空数组。

### 五档决策链（界面与 `src/router.ts` 逐档对齐）

```
1. 显式 @provider[/model]                via:'explicit'（最高；用户点名最大）
2. 调用方点名（非队友子代理）              默认目标决策 ∧ 传入目标 ≠ 默认目标 ⇒ keep（B-1a 让位）
3. 分工表 role ← routes 的 dispatch 行    via:'role'——优先于默认目标与关键词规则
4. 关键词规则 ← routes 的 session 行      仅主会话；子代理默认跳过（D6，图像规则保留）
5. 默认目标                                 主会话 = driverSticky ? driver : preset.default
                                        子代理 = 继承目标（keep）
```

第 3、4 档就是 `routes` 的两个 scope：**同一张表，两个作用域**。完整分支（显式 @ 的
Q3 精确寻址 / Q6 已知 provider 门控、降级语义、图像护栏）见上文「决策流程」节与
「2.0.0 团队派发」节。

### 界面（A / B 两项：一条决策链 + 作用域可见）

- **顶部摘要说明**：`buildRoutingView().summary`（导出包装 `describeRouting`，纯中文、
  不含内部字段名）。**三处同源已真实接入**（2026-10-07 交叉复核后修）：设置卡片顶部、
  `roles.ts: renderTeamSkill` 的技能 description、`/kimi-tide show` 的摘要行都消费
  `describeRouting`，并有**跨模块**测试钉住（任一侧回退自拼即红）；此前注释声称三处共用、
  实际只有设置页消费（复核 M5）。
- **一条五档决策链**取代原先四个并列控件：每档三行式（触发条件 / 当前取值 /
  关闭后的影响）；第 3 档内联分工表、第 4 档内联预设编辑器；**默认目标档显式渲染**
  （含来源：`driverSticky ? driver : 预设默认`；`driver` 为 null 时写「主驱动跟随宿主默认」）；
  空规则时不再是空表，而是一句说明——「主会话没有可命中的规则，全部使用默认目标（…）；
  另有 N 组关键词组未接入任何规则，暂不生效」。
- **档位三态**（`PrecedenceTier.state`，2026-10-07 修正）：`ready` 已就绪 /
  `on-demand` **按需**（写 `@` 或子代理点名才参与，**不置灰**）/ `off` **未启用**（置灰）。
  第 1、2 档恒为 `on-demand`——此前写死 `active: true`，界面出现「五档里四档都亮着」、
  反而看不出谁在决定这一轮（用真实配置预检时发现）。`active` 作为
  `state === 'ready'` 的便捷布尔保留，供既有消费者使用。
  **路由关闭（`activePreset: null`）时第 3 档转 `off`**：此时 `installRouter` 根本不挂载，
  分工表不发生任何改道，detail 写「路由已关闭：分工表 N 个角色不发生任何改道（仅存档）」
  （此前仍按 `dispatch.length > 0` 报 ready，属假生效——复核 #6）。
- **作用域徽标**：规则行「**主会话**」、角色行「**派发时**」——作用域标清之后，「冲突」即变「分工」。
- **词表接入徽标**：`被 N 条规则引用（列 id）` / `被协作流认领（review）` / `⚠ 未接入`。
- **重叠解释条**（`view.overlaps`，**不是报错**）：词表的词 ∈ 某角色身份词
  （id / label / aliases）且两侧目标不同 ⇒ 词表行与角色行**各挂一条**「设计使然：
  主会话说『X』走 A；派给『角色』做走 B」，并给**两个**一键动作——「规则跟随该角色」
  与「词并入该角色别名」（去重、空串不写、走守卫式写、失败上浮）。被协作流认领
  （`wiring === 'claimed-by-flow'`）的 session 行**不参与**重叠解释（与摘要口径一致，
  不替一条已被抑制的规则说话）；`minHits > 1` 时文案带上门槛（「说『X』（≥N 词）」）。
- **测试场「派给谁」**（`previewDispatch`，建在同一 `RoutingView` 上，不重复实现匹配逻辑）：
  选角色 / 队友名 ⇒ 显示改道目标与依据（`role` / `unclaimed` 两态；`explicit` / `keep`
  属请求期上下文，静态视图判不出），并点明与「试一句」是**两套作用域**。
- **分工表「从词表生成角色」**：把没有任何规则引用的词表组批量生成角色行
  （目标先取当前预设默认模型，可在下拉里改；认领名冲突照旧守卫式拒写）。
- **视图模型零行为变更**：`buildRoutingView` / `describeRouting` / `previewDispatch`
  是纯函数、零宿主依赖，不参与 `decide` / `previewRoute`——C1 落地后既有
  `previewRoute` 断言逐字节不变。

### 交叉复核修复（2026-10-07，review round-1）

> 本项目纪律「写代码的人不审查自己的代码」：本轮由两个**不同厂商**的模型交叉复核
> （k3 审 host 侧、glm-5.3 审客户端），抓到 1 严重 + 10 中等并全部修复。以下是落地结果，
> **全部零路由语义变更**（合法配置下的决策结果逐字节不变）。

- **读路径对畸形行容错**：`routes` 里的非对象行 / `scope` 非法行在读路径**保守丢弃并 warn**
  ——手改 YAML 写出一个空项（`-` → `null`）不再抛穿插件 `apply`；干净数组仍**原引用**返回，
  零开销路径不变。（复核 S1）
- **镜像与校验对称**：冲突检测对 `label` 采用与投影同款的回落（`row.label ?? row.id`）——
  此前投影会合成 `label`、校验却严格等，导致「插件自己造出冲突、再拿它拒写自己」。（复核 M1）
- **v5 链保 `routes`**：`migrateV5` 对 `routes` 直通（与 roles/driver 同款），修掉
  「`version: 5` 的文档带 `routes` 时被逐字段重建静默抹掉」——与 2026-10-06 事故同型。（复核 M2）
- **顺序冲突检测**：除按 id 比 `when`/`target`/元数据外，还比**相对序**
  （同预设 session 行序 vs `presets[*].rules` 序；dispatch 行序 vs `roles` 键序）——
  排序即语义，两处顺序分叉不再算合法状态。（复核 M3）
- **客户端表达修正**：第 2 档文案去掉「宿主」（真源仅子代理）；第 3 档「关闭后的影响」
  按 D6 口径改为「落到默认目标」；`driverSticky` 关闭时主驱动目标置灰并写明未启用原因
  （`kt-driver-off`，无边框无阴影）；补**渲染健壮性测试**（`buildRoutingView` 抛错时
  编辑器与分工表仍可用、链与摘要整组跳过——官方明文：render 抛错会把 slot 条目整块搞白）。
- **复核留下的已知限制（有意不改）**：`overlaps` 的目标比较只到 provider/model（不含 `effort`）、
  词匹配大小写敏感——两处均已注释标注；读边界不做冲突检测（只 warn 不阻断），
  冲突拦截仍以**写入期**为准。
