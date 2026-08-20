# kimi-tide 路由 v3（能力评分路由，0.3.0 → 0.4.x）

本文以 `src/` 现行实现为准，描述 0.3.0 起的能力评分路由架构。0.4.x 起 provider 改名
`kimi-tide` → `kimi-coding`（`SCORES_VERSION` 升 3），自研接入层退役切换为 pi-ai 原生
路由 + API key（见根 README 快速开始）。0.2.x 的规则表 `decide()` 已被
「classify → 评分选择」取代；v1 配置形状仍被接受并桥接到 v3（见下文「兼容性」）。

## 总览

```
agent/pre-step ──► classify(messages) ──► weights + vision + estTokens
                          │
        explicit @provider（最高优先级，scoreDelta: null）
                          │
        scoreCandidate × 候选池 ──► selectCandidate ──► route / keep
                          │
agent/request ──► applyTo(callConfig) ──► guardImage（模态护栏）
```

事件流（DSH 官方机制，`router.ts: installRouter`）：

- `agent/pre-step`：每轮只在**首个模型步**（`payload.step === 1`）判定一次，
  决策存入 per-agent WeakMap 槽位；工具循环步骤（step > 1）不切模型。
- `agent/request`：消费槽位，`applyTo` 替换 callConfig 的 provider/model
  （同时剥离继承的 `reasoningEffort`）。
- `agent/image-admission`：宿主在图像入队前的准入探针（serial bail 语义）。
  当前选择是 text-only 时宿主本会直接拒图；路由器在「激活且 premium 多模态」
  时认领（返回 true），让 per-step 护栏得到执行机会。

## 候选池（CandidateMeta）

```ts
interface CandidateMeta extends RouteTarget {
  modalities: string[]            // 来自 llm.resolveModelInfo().inputModalities
  costTier: 'cheap'|'mid'|'expensive'
  available: boolean              // 目录中不存在 → false（面板标灰、评分排除）
}
```

- **Provider 无关枚举**（`index.ts: enumerateCandidates`）：`allowedProviders`
  白名单内每个注册 provider 贡献其目录；逐模型 resolve `inputModalities`；
  cost tier 查 `config.costTiers[provider/model]`（目录不带价格，缺省 `mid`）。
  单个 provider/model 枚举失败只告警不中断。
- 路由器**立即挂载**：首个枚举完成前用 `fallbackCandidateMetas`（配置目标
  + text-only + 配置 tier）做种子池；`llm/adapters-updated` 事件触发重新枚举。
- **枚举窗口**：配置变更（含面板 onSaved）后立即重挂载、枚举异步 settle——
  首个枚举 settle 前种子池按 text-only 处理，带图步骤可能短暂 keep
  （概率低、下个枚举 settle 后自愈）。
- 配置目标不在实时目录中时保留为 `available: false`（不进评分池，面板可见）。

## classify（`src/classify.ts`）

对全部用户消息扫描：

- **维度权重**：内置关键词表（code/reasoning/writing/tooluse）+ 用户
  `classify.patterns` 覆盖/扩展，命中一个维度 +2。
- **vision**：任一消息含 image 块 → `weights.vision = 3`，`vision = true`。
- **longctx**：`estTokens > 60000` → +1（`estTokens = ceil(chars / charsPerToken)`，
  默认 charsPerToken=2，中英混合保守估算）。
- **显式指令**：`/@([\w-]{2,20})\b/`；`@kimi`（及 `@kimi-tide`）归一化为 provider `kimi-coding`（`KIMI_PROVIDER`）。

## 评分与选择（`src/scoring.ts`）

```
score(candidate) = Σ(dim) weight[dim] × scores[provider/model][dim]
                 − λ × costValue(costTier)        // cheap 0 / mid 0.5 / expensive 1
```

- **评分表**（`src/scores.ts`）：`scoreFor(cfg, target)` = 用户覆盖
  （`cfg.scores['provider/model'][dim]`）→ 内置基线（`BASELINE`，`SCORES_VERSION = 3`，
  键为 `kimi-coding/*`：code/reasoning 为权威基准溯源值（SWE-bench/GPQA），
  其余维度中性，vision 0）→ 缺省 2.5。
- **selectCandidate**：
  - eligible = `available && (!hasImage || modalities 含 'image')`；空 → keep。
  - 最优即默认目标 → keep。
  - **cost 模式**：`budgetExhausted` 或 `delta < routeThreshold`（默认 0.75）→ keep。
  - capability 模式无阈值/预算门，只要最优非默认即路由。
  - 返回 `scoreDelta`（相对默认目标的评分差，保留两位小数）；显式 @provider
    选择是用户强制而非评分比较，`scoreDelta: null`。

## 显式 @provider

`decide` 最先检查：在该 provider 的候选里过滤「available 且带图时模态匹配」，
池空 → keep；否则按同一评分公式取该 provider 最优候选。v1 构造的路由器保持
旧语义（优先配置里的 premium/premiumLong）。

## 预算语义（cost 模式）

- 滑动窗口：`budgetWindow`（默认 20）次决策内，premium 占比 ≥ `premiumBudget`
  （默认 0.2）→ `budgetExhausted`，premium 升级被抑制（keep）。
- 门控要求窗口**已满**（`history.length ≥ window`）才判定。
- 只有 cost 模式的 keep 记 'primary' 样本；capability 的 keep 不进窗口。
- 图像护栏触发的改道**不进**预算窗口（正确性护栏，非预算决策）。

## 模态护栏（图像）

- `textOnlyProviders(config, metas)`：v1 的 `textOnlyProviders` 覆盖优先；
  否则从候选 modalities 推导（不含 image 的 provider 视为 text-only）。
- `applyImageGuard`：带图步骤解析到 text-only 路由时改道多模态 premium；
  premium 本身 text-only 时不改道（避免乒乓），留给宿主报错。
- 宿主准入层（`canClaimImageAdmission`）：mode ≠ off 且 premium 多模态才认领图像。

## 带图会话锁存（fcbf421，2026-08-19）

**为何锁存**：`agent/pre-step` 的 payload 只含本轮消息；文本-only 适配器（deepseek）
序列化**全量**历史时对任一 image 块抛 `UNSUPPORTED_CONTENT` → 图片一旦进入历史，
后续文本轮选文本-only 候选必崩。

**机制**：`installRouter` 持 per-agent `imageSeen` WeakMap——任一 pre-step 含图即永久
锁存；`decide` 第三参 `hasImageOverride` 强制 `hasImage = true` → 强制 vision 维评分
（生产配置 k3.vision=5 多模态候选必胜出）+ request 钩子 `applyImageGuard` 兜底改道。
子代理（独立上下文）不受锁存影响。

**⚠️ 已知限制（2026-08-19 实测）**：锁存后会话锁死多模态模型；该模型额度/Key
失效（AUTH 报错）时会话无法切文本模型（`model-unavailable`：历史含图片）
→ **死锁**，存量会话无法救回（历史图片不可逆）。锁存判定不可作为终态方案。

**根解（0.3.x 规划）**：图片不进主会话历史——

- **图像转述模式**（模型级）：pre-step 调多模态模型把图片转述为文本块注入，
  后续请求全为纯文本；
- **子代理图片外包**（子代理级）：独立上下文子代理读图回传文字
  （前置=kimi 子代理后端落地）。

## 配置源与持久化（settings 命名空间 + sidecar 兜底）

0.4.0 起持久化迁至 DSH 设置命名空间 `kimi-tide-router`（base 层 = 部署基座 /
user 层 = 用户编辑，revision 冲突检测）；面板以 `configSource:
'settings'|'sidecar'|'patch'|'default'` 投影来源。

- **有 settings 服务（rc.7+）**：settings 命名空间为唯一写目标——面板保存、命令
  变更、外部文档编辑都经 settings 服务提交（`configSource: 'settings'`）。
- **无 settings 服务（rc.6）**：回退 sidecar 文件
  `$DSH_HOME/profiles/web/kimi-tide-router.yml`（`RouterSidecarStore`，
  `src/sidecar.ts`），优先级 sidecar > patch 静态块 > `DEFAULT_CONFIG_V3()`。
  - `save`：先存 `.bak`，tmp+rename 原子写。
  - `load`：YAML 解析失败 → 原文件改名 `.corrupt` 保留、告警、回退 patch/default。
  - 旧形状走 `coerceRouterConfig` 迁移（v1/v2 → v3，premiumLong 丢弃并告警）；
    命名迁移（`kimi-tide/*` → `kimi-coding/*`）前留档 `.pre-v3`。
- **patch**：`RouterSettingsStore`（`src/settings.ts`）只读 legacy 静态种子
  （v1 形状，行锚定读写保护用户注释）；0.3.0 起面板保存**不再**回写 patch 文件。
- **sidecar → settings 迁移**：settings 服务附着时 sidecar 内容一次性导入命名空间
  并留档 `.legacy-imported`。

## 命令面 v3（`/kimi-tide`）

| 子命令 | 行为 |
|--------|------|
| `mode off\|cost\|capability` | 切换模式并写 settings 命名空间（无则 sidecar） |
| `set <key> <value>` | v3 键表：`lambda` / `routeThreshold` / `premiumBudget` / `budgetWindow` / `charsPerToken` / `default.model` |
| `export-config` | 打印 resolved 配置 YAML（settings 命名空间优先，无则 sidecar） |
| `import-config <path\|inline YAML>` | 双形态（见下） |
| `refresh` | 立即轮询配额 |

**import-config 双形态**（Task 10 修复轮）：

- 参数是已存在文件路径 → 整表替换（validate 后落盘）。
- 参数是内联 YAML 文本（`{`/`-` 开头、含换行，或可解析为 mapping）→
  **合并补丁**：深合并进当前配置（scores 逐候选合并、candidates 整表替换），
  未出现的字段（lambda/routeThreshold/既有 scores 等）保留。这是面板 v3
  「保存评分/候选管理」的落盘通道——面板各组件只持有各自区块数据，整表
  替换会丢未投影字段。
- `parseKimiTideCommand` 对 import-config 取子命令后的**完整剩余参数**
  （保留换行/缩进），多行 YAML 原样送达。

所有变更类子命令写 settings 命名空间（无则 sidecar），成功后回调 `onSaved`：
重建路由器、清掉旧决策摘要、重枚举候选、推送面板快照。

## 面板 v3 与投影（projection v3）

`kimi-tide/panel` 投影（stateVersion 3）携带：`quota` / `router`（v1 视图）/
**`kimi` 二态接入指示**（`{ route, key }`——kimi-coding 路由已注册 + API key 可解析）/
`models` 下拉选项 / **`configSource`** / **`candidates`**（provider/model/available
摘要，完整 metas 留在 host）/ **`decision`**。（0.4.x 删本地 token 统计 `local`，
其数据源随自研接入层退役。）

- **决策可观测**（`buildDecisionSummary`）：仅 capability 模式的 route 决策
  上浮（chosen/reason≤120 字符/scoreDelta）；off/keep/cost 一律 null，
  配置变更即清空（旧决策不泄漏）。
- **组件**（`src/client/`）：
  - `TideDock`（`conversation.composer.dock` 只读仪表）：主行 chips（mode 徽标、
    路由 chip、kimi 接入指引 chip、配额 chip、决策 chip）+ 「🔄 刷新配额」按钮 +
    ReasonPanel + 推理状态行 + 「路由设置已迁至 设置 → 月汐」指引；写控件
    （mode 按钮 / 设置折叠区）已整体移除。
  - `SettingsCard`（`settings.section`，id `kimi-tide-router`）：官方设置页
    「月汐」卡片——mode 三选、候选 + 每候选评分滑杆、数值区、高级折叠
    （classify.patterns / costTiers / allowedProviders）。写通道经 card-store 的
    `scope.set` 或 `connection.api.settings.mutate`（多段 path），不经过 dock 的
    import-config 通道。
  - `ReasonPanel`：configSource 标签 + 本步决策摘要 + 实际路由显示（只读）。
- 写通道：设置卡片直接写 settings 命名空间；dock 的命令通道（`/kimi-tide …`）
  经 remote 执行、多行文本换行保真，写 settings 命名空间（无则 sidecar）。

## 兼容性（v1 桥接）

`new KimiRouter(v1Config, log)` 仍被接受：`legacyConfigToV3` 桥接配置
（candidates = [premium, premiumLong]，classify.patterns 由 escalateWhen.patterns
映射到 reasoning），`legacyMetasFromConfig` 按真实能力矩阵推导候选元数据
（deepseek-v4-* text-only/cheap，Kimi k3 系 multimodal/mid）。v1 构造时评分
权重收缩到 escalateWhen 实际开启的维度（patterns→reasoning、
estimatedTokensGt→longctx），`routeThreshold` 置 0，保持 0.2.x 行为。
`index.ts` 另导出 `routerConfigToV3` / `candidateMetasFromConfig` / `buildRouter`
供测试与外部调用方做同样的桥接；v1/v2 → v3 的统一迁移入口为
`coerceRouterConfig`（`migrate.ts`）。

## 逃生

`/kimi-tide mode off`（或面板切 off）：`decide` 立即返回 keep，
`installRouter` 不再挂载（mode off 时宿主侧不注册 pre-step/request 监听），
行为回到 0.1.x 直通。
