# kimi-tide 路由 v3（能力评分路由，0.3.0）

本文以 `src/` 现行实现为准，描述 0.3.0 的评分路由架构。0.2.x 的规则表 `decide()`
已被「classify → 评分选择」取代；v1 配置形状仍被接受并桥接到 v2（见下文「兼容性」）。

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
- 配置目标不在实时目录中时保留为 `available: false`（不进评分池，面板可见）。

## classify（`src/classify.ts`）

对全部用户消息扫描：

- **维度权重**：内置关键词表（code/reasoning/writing/tooluse）+ 用户
  `classify.patterns` 覆盖/扩展，命中一个维度 +2。
- **vision**：任一消息含 image 块 → `weights.vision = 3`，`vision = true`。
- **longctx**：`estTokens > 60000` → +1（`estTokens = ceil(chars / charsPerToken)`，
  默认 charsPerToken=2，中英混合保守估算）。
- **显式指令**：`/@([\w-]{2,20})\b/`；`@kimi` 归一化为 provider `kimi-tide`。

## 评分与选择（`src/scoring.ts`）

```
score(candidate) = Σ(dim) weight[dim] × scores[provider/model][dim]
                 − λ × costValue(costTier)        // cheap 0 / mid 0.5 / expensive 1
```

- **评分表**（`src/scores.ts`）：`scoreFor(cfg, target)` = 用户覆盖
  （`cfg.scores['provider/model'][dim]`）→ 内置基线（`BASELINE`，SCORES_VERSION 1）→
  缺省 2.5（vision 缺省 0）。
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

## 配置源与持久化（sidecar）

优先级：**sidecar 文件 > patch 静态块 > 内置默认**，面板以
`configSource: 'sidecar'|'patch'|'default'` 投影来源。

- **sidecar**：`$DSH_HOME/profiles/web/kimi-tide-router.yml`（`defaultSidecarFile()`，
  与 patch 文件互邻）。`RouterSidecarStore`（`src/sidecar.ts`）：
  - `save`：先存 `.bak`，tmp+rename 原子写。
  - `load`：YAML 解析失败 → 原文件改名 `.corrupt` 保留、告警、回退 patch/default。
  - `version !== 2` 的旧形状走 `migrateV1` 迁移（premiumLong 丢弃并告警）。
- **patch**：`RouterSettingsStore`（`src/settings.ts`）只读 legacy 静态种子
  （v1 形状，行锚定读写保护用户注释）；0.3.0 起面板保存**不再**回写 patch
  文件——保存不再触发 loader 重挂载（修复 57c7ef8 失配类问题）。

## 命令面 v2（`/kimi-tide`）

| 子命令 | 行为 |
|--------|------|
| `mode off\|cost\|capability` | 切换模式并写 sidecar |
| `set <key> <value>` | v2 键表：`lambda` / `routeThreshold` / `premiumBudget` / `budgetWindow` / `charsPerToken` / `default.model` |
| `export-config` | 打印 sidecar YAML 文本 |
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

所有变更类子命令只写 sidecar，成功后回调 `onSaved`：重建路由器、清掉
旧决策摘要、重枚举候选、推送面板快照。

## 面板 v3 与投影（projection v2）

`kimi-tide/panel` 投影（stateVersion 2）携带：`quota` / `local` / `router`
（v1 视图）/ `models` 下拉选项 / **`configSource`** / **`candidates`**
（provider/model/available 摘要，完整 metas 留在 host）/ **`decision`**。

- **决策可观测**（`buildDecisionSummary`）：仅 capability 模式的 route 决策
  上浮（chosen/reason≤120 字符/scoreDelta）；off/keep/cost 一律 null，
  配置变更即清空（旧决策不泄漏）。
- **组件**（`src/client/`）：
  - `TideDock`：主行（模式切换、路由 chip、配额 chip、本地 token、决策 chip）
    + 折叠区（会员/重置倒计时、v2 设置、ReasonPanel、推理状态）。
  - `CandidateList`：候选池增删改 → 翻译成 sidecar YAML 经 import-config 落盘。
  - `ScoreEditor`：六维滑杆（0–5 步长 0.5，基线 vs 覆盖分）→ 「保存评分」
    序列化整份 draft 为 sidecar 文本经 import-config 落盘。
  - `ReasonPanel`：configSource 标签 + 本步决策摘要 + 实际路由显示。
- 写通道：面板经 remote 通道执行 `/kimi-tide …` 命令（多行文本换行保真）。

## 兼容性（v1 桥接）

`new KimiRouter(v1Config, log)` 仍被接受：`legacyConfigToV2` 桥接配置
（candidates = [premium, premiumLong]，classify.patterns 由 escalateWhen.patterns
映射到 reasoning），`legacyMetasFromConfig` 按真实能力矩阵推导候选元数据
（deepseek-v4-* text-only/cheap，Kimi k3 系 multimodal/mid）。v1 构造时评分
权重收缩到 escalateWhen 实际开启的维度（patterns→reasoning、
estimatedTokensGt→longctx），`routeThreshold` 置 0，保持 0.2.x 行为。
`index.ts` 另导出 `routerConfigToV2` / `candidateMetasFromConfig` / `buildRouter`
供测试与外部调用方做同样的桥接。

## 逃生

`/kimi-tide mode off`（或面板切 off）：`decide` 立即返回 keep，
`installRouter` 不再挂载（mode off 时宿主侧不注册 pre-step/request 监听），
行为回到 0.1.x 直通。
