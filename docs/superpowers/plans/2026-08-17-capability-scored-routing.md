# kimi-tide 0.3.0 开发计划：能力评分路由（capability-scored routing）

> 状态：v2.1（Kimi Round 2 复检修订回填：7 条新意见全接受）· 2026-08-17
> 上游设计：`specs/2026-08-17-usage-panel-router-settings-design.md` · 审查：`reviews/2026-08-17-capability-routing-kimi-review-{round1,round2}.md`
> 待用户审阅后转 writing-plans 出实施计划

## 0. 背景与目标

0.2.0 的路由是「固定槽位 + 关键词/阈值升级」：primary / premium / premiumLong。
用户决策：砍掉 premiumLong、回归双模型协作、内部能力评分选路（code 等维度选最强）、
候选不局限于 kimi/DeepSeek（agent 里配置好的模型都可选）。

目标：把「人拍模式」升级为「路由器按能力画像自动选模型」，人只设候选池与预算。

## 1. 范围

- 配置形状 v2 + **持久化层迁移到 sidecar 文件**（v2 修订，见 2.1）+ 旧配置迁移。
- 能力维度与评分表（内置基线 + 版本化 + 用户覆盖）。
- 任务分类器 v1（启发式，纯函数）。
- 评分选路引擎（classify/score 纯函数先行，替换 `decide()`）。
- 候选池 provider 无关（白名单 + 可用性/modality 校验）。
- 面板 v3（组件拆分 + 候选池管理 + 评分覆盖 + 决策可观测）。
- 保留：cost 预算机制（语义细化见 2.4）、@显式指令泛化 `@<provider>`、图片护栏（元数据化）、
  patch 文件仅留静态种子。

不在范围：小模型自分类、在线学习、跨会话评分统计、离线回放评估（拆为 M4.6/0.4.0）。

## 2. 设计

### 2.1 配置形状 v2 与持久化（v2 修订：sidecar）

```yaml
# sidecar: $DSH_HOME/profiles/web/kimi-tide-router.yml（机器管理，整文件 YAML）
version: 2
mode: off | cost | capability
default: { provider, model }
candidates:
  - { provider: kimi-tide, model: k3 }
  - { provider: deepseek-official, model: deepseek-v4-flash }
scoresVersion: <与内置基线表同版本>
scores: {}            # 用户覆盖
classify: {}          # 分类器用户覆盖（可选）
allowedProviders: [kimi-tide, deepseek-official]   # 默认白名单，可扩
routeThreshold / premiumBudget / budgetWindow / charsPerToken / lambda
```

**持久化决策（对 Kimi 严重 1 的换解）**：不重写行锚定解析器，而是把 router 配置整体迁出
被 loader 监视的 `cordis.patch.yml`，落到 sidecar 文件（整文件标准 YAML 序列化，可用 `yaml`
依赖——仅持久化用，不违反「零智能依赖」）。附带收益：**保存不再触发 loader 重 apply 插件**，
本会话实证的「保存→插件重启→面板 push 静默」一类问题从根上消失。
patch 文件 `config.router` 保留为可选静态种子；优先级：sidecar > patch 静态 > 默认。
迁移：首启无 sidecar 时读 patch v1 块 → `migrateRouterConfig()`（primary→default、
premium→candidates[0]、premiumLong 丢弃+一次性 warn）→ 写 sidecar + .bak；补迁移测试。

**sidecar guardrails（Round 2 中等 1-4 落实）**：
- 损坏回退链：sidecar 解析失败 → warn（含路径与原因）→ 尝试 patch 静态 → 默认；保留 `.corrupt` 副本；启动永不崩。
- 生效来源可观测：projection 带 `configSource: 'sidecar' | 'patch' | 'default'`，面板 meta 行显示来源 + sidecar 绝对路径（避免手动改 patch 被静默忽略的困惑）。
- 可移植性：M4.1 提供 `/kimi-tide export-config`（sidecar → stdout/文件）便于备份迁移；README 明示 sidecar 路径。

### 2.2 能力维度与评分（v2 修订：版本化）

六维 0–5：`code / reasoning / writing / tooluse / vision / longctx`。
来源优先级：用户覆盖 > 当前版本内置基线 > 旧版本基线（`scoresVersion` 绑定，避免跨版本错并）。
基线只存相对分，不冒充精确测量。

### 2.3 任务分类器 v1

纯函数 `classify(messages) → { weights, vision, estTokens }`。关键词族 + 图片块 + 工具密集历史 +
超长上下文；显式 `@<provider>` 强制该 provider 最优候选（M4.1 同步改正则/命令/面板，轻微 9）。
M4.2 先表驱动测试，再进引擎（中等 8）。

### 2.4 评分选路（v2 修订：cost 语义与显式选择）

`score(c) = Σ w·score(c,dim) − λ·costNorm(c)`；costNorm 三档 cheap/mid/expensive → 0/0.5/1，λ 默认 0.5（面板可调）。
**价格→三档映射（Round 2 轻微 5）**：M4.2 给映射表（<$0.5/M→cheap，$0.5–$2/M→mid，>$2/M→expensive），
catalog 无价格者默认 mid，用户可覆盖。
- capability：最高分者胜；平局回 default。
- cost：判定顺序**先** score 差 > routeThreshold，**再** premiumBudget 窗口未耗尽；窗口耗尽直接 keep。
- 图片护栏（对 Kimi 严重 3 的落实）：候选元数据带 `inputModalities`（枚举期 resolveModel 解析并缓存），
  带图步骤先排除 vision=0 候选再评分；`applyImageGuard` 消费元数据而非硬编码 provider 集合。
- **显式选择政策（中等 7 裁决）**：M4.3 **首个任务**调研 dsh 是否暴露「选择来源」（UI 手动 vs 预设，Round 2 轻微 7 前置）；
  有则尊重并记 reason「user explicit, skipped routing」；无则维持 router-wins，靠面板实时显示
  实际路由（可观测）+ mode off 作为逃生门，文档明示；面板 chip 渲染「实际路由：xxx（router 决策）」。

### 2.5 候选池（v2 修订：白名单 + 校验）

枚举 `ctx.llm.listProviders() × listModels()` 后：①过 `allowedProviders` 白名单——**默认值动态生成**：
`[实际注册的 providerName, 'deepseek-official']` 再并用户配置（Round 2 中等 2：不硬编码 'kimi-tide'，
兼容用户自定义 providerName）；②`resolveModel` 校验存在性并取 `inputModalities`；未通过者面板标灰。
M4.1 先写枚举原型验证真实输出与性能（Kimi 顶号建议 2）。

### 2.6 面板 v3（v2 修订：组件拆分）

拆 `CandidateList / ScoreEditor / ReasonPanel` 子组件 + 快照测试（轻微 10）。
候选行：provider/model 双下拉 + default 单选 + 不可用标灰；评分覆盖紧凑滑杆组；
主行 chip 显示本步实际路由 + 命中维度。

### 2.7 可观测（v2 修订：payload 受控）

projection 只带结构化摘要：`{ chosen, reason: 'capability:code', scoreDelta }`；
**仅 capability 且非 keep 时**下发详细分数对比，reason 截断 120 字符；完整对照不进 session log（中等 6）。

## 3. 里程碑（v2 修订：M4.5 后移）

- **M4.1** sidecar 持久化（含损坏回退链、configSource、export-config 命令）+ migrateRouterConfig +
  premiumLong 移除 + 候选枚举原型（动态白名单）+ @<provider> 同步。
- **M4.2** 评分表（含 scoresVersion）+ classify/score 纯函数 + 表驱动测试。
- **M4.3** 选路引擎替换 decide()（含 modality 护栏、cost 判定顺序、显式选择调研结论落地）。
- **M4.4** 面板 v3（组件拆分 + 决策可观测摘要）。
- **M4.6（0.4.0 候选）** 离线回放评估：输入 = 本地 `session.jsonl.zstd`（node:zlib zstd 解码，本会话已验证）
  的 user/message 文本块 + request/header 实际 config；先 replay.ts 最小原型（轻微 11）。

## 4. 先例检索（GitHub / 2026-08-17 实测）

| 先例 | 借鉴 |
|---|---|
| [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM) | routeThreshold 语义；不采用学习式路由器 |
| [vllm semantic-router](https://vllm-semantic-router.com/zh-hans/docs/v0.2/tutorials/intelligent-route/model-selection/hybrid/) | 领域分类 + hybrid 质量成本公式 ≈ 2.4 评分式 |
| [ulab-uiuc/LLMRouter](https://github.com/ulab-uiuc/LLMRouter) | 评估先行 → M4.6 回放 |
| [regolo-ai/brick-SR1](https://github.com/regolo-ai/brick-SR1) | v2 分类器候选，v1 不采用 |
| [ypollak2/llm-router](https://github.com/ypollak2/llm-router) | 同用例先例；差异点=能力评分 |
| [FrugalGPT](https://ar5iv.labs.arxiv.org/html/2305.05176) / [pi-smart-router](https://github.com/beettlle/pi-smart-router/blob/HEAD/docs/deep-research.md) | 级联+预算谱系；同栈最近先例 |

空白点：无「DSH 插件形态 + 活会话替换 + 面板评分覆盖 + 决策可观测」组合。
**待补核对（Kimi 补充意见）**：M4.1 开工前核对本地先例 dsh-model-router 是否已有 provider-agnostic
候选池/costNorm 实践（本轮未核实其源码）。

## 4.5 检索后设计校准（v2 增补）

1. routeThreshold 对齐 RouteLLM 质量差阈值。
2. 维度词表向 semantic-router 领域词表靠拢。
3. M4.6 离线回放评估（评估先行）。
4. 不学只借：零智能依赖；**例外**：持久化允许 `yaml` 依赖（sidecar 方案，2.1）——固定 `yaml: ^2.x`，
   sidecar 格式限 JSON-compatible 子集（无 anchor/tag/自定义类型，Round 2 轻微 6）。
5. sidecar 持久化同时消除「保存触发 loader 重 apply」根因（本会话 57c7ef8 实证的 desync 类问题）。

## 5. 风险与开放点

- 启发式分类上限 → routeThreshold 安全阀 + mode off 逃生门。
- 基线主观性 → 面板覆盖 + scoresVersion + 决策可观测。
- provider 价格未知 → 三档 costNorm。
- 模型选择器冲突 → 2.4 显式选择政策（调研兜底）。
- sidecar 引入双配置源 → 优先级规则明示 + 迁移 .bak。
