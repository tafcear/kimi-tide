# kimi-tide 0.3.0 开发计划：能力评分路由（capability-scored routing）

> 状态：v1（先例检索已回填）· 2026-08-17 · 上游设计：`specs/2026-08-17-usage-panel-router-settings-design.md` · 待用户审阅后转 writing-plans 出实施计划

## 0. 背景与目标

0.2.0 的路由是「固定槽位 + 关键词/阈值升级」：primary（便宜）/ premium（强）/ premiumLong（长上下文）。
实机使用后用户决策：

1. **砍掉 premiumLong**——长上下文不作为独立槽位，回归双模型协作语义。
2. **能力评分**：路由器内部维护模型能力画像；任务涉及某能力维度时，选该维度最强的模型
   （例：code 维度 v4-flash vs k3 → capability 模式选 k3）。
3. **provider 无关**：候选模型不局限于 kimi / DeepSeek，agent（ctx.llm）里已注册的
   任何 provider/model 都可进入候选池。

目标：把「人拍模式」升级为「路由器按能力画像自动选模型」，人只设候选池与预算。

## 1. 范围

- 配置形状 v2（含旧配置迁移、premiumLong 移除）。
- 能力维度与评分表（内置基线 + 用户覆盖）。
- 任务分类器 v1（启发式）。
- 评分选路引擎（替换现 `KimiRouter.decide`）。
- 面板 v3（候选池管理 + 评分覆盖）。
- 保留：cost 模式预算机制、@显式指令（泛化为 `@<provider>`）、图片护栏、patch 文件持久化。

不在范围：小模型自分类（v2 再议）、在线学习评分、跨会话评分持久化统计。

## 2. 设计

### 2.1 配置形状 v2

```yaml
router:
  mode: off | cost | capability
  default: { provider, model }        # 兜底/主力（替代 primary）
  candidates:                          # 候选池（替代 premium/premiumLong）
    - { provider: kimi-tide, model: k3 }
    - { provider: deepseek-official, model: deepseek-v4-flash }
  scores: {}                           # 用户覆盖（缺省用内置基线），见 2.2
  classify: { patterns: {...} }        # 分类器用户覆盖（可选）
  escalateWhen / premiumBudget / budgetWindow / charsPerToken   # cost 模式沿用
```

迁移：`primary→default`；`premium→candidates[0]`；`premiumLong` 丢弃并 warn 一次。

### 2.2 能力维度与评分

维度 v1（六维，0–5 分，允许半分）：
`code` / `reasoning` / `writing`（中英写作）/ `tooluse`（工具调用遵循）/ `vision` / `longctx`

评分来源优先级：用户面板覆盖 > patch `scores:` > 内置基线表。
内置基线：curated——公开基准（SWE-bench / MMLU / IFEval 等）+ 实机观察的相对排序，
**只存相对分，不冒充精确测量**；表在代码里，随版本迭代。

### 2.3 任务分类器 v1（启发式，纯函数可测）

输入：本步消息批次。输出：维度权重向量（如 `{code:2, reasoning:1}`）+ 视觉标志 + token 估算。
规则：关键词族（代码/review/bug/重构→code+reasoning；文档/总结/翻译→writing；
图片块→vision；工具密集历史→tooluse；超长上下文→longctx）+ 显式标注（`@kimi` 泛化 `@<provider>` 强制该 provider 最优候选）。
v2 候选方案（记录不实施）：用便宜模型做一次结构化自分类。

### 2.4 评分选路

`score(candidate) = Σ_dim w(dim)·score(candidate,dim) − λ·costNorm(candidate) − 视觉否决项`
- capability 模式：选 score 最高者；平局回 `default`。
- cost 模式：仅当「升级收益」（最高分 − default 分）> 门槛且预算未耗尽时才离开 default。
- 图片护栏沿用：vision=0 的候选不接带图步骤。
- 候选池只有一个有效候选时退化为 0.2.x 行为。

### 2.5 provider 无关的候选池

枚举：`ctx.llm.listProviders()` × `listModels(provider)`（面板下拉全量化，替代现双目录）。
costNorm：provider 未知价格时按 catalog 声明或默认中位；用户可在面板标 cheap/mid/expensive 三档。

### 2.6 面板 v3

- 候选池：增/删行（provider+model 双下拉），default 单选标记。
- 每个候选：六维评分覆盖（紧凑滑杆组，缺省显示基线分）。
- 模式/预算/阈值区沿用 0.2.x 布局。
- 主行 chip：显示本步实际路由 + 命中维度（router 决策经 projection 下发，可观测）。

### 2.7 可观测与测试

- 决策日志进 projection（reason: 维度权重 + 分数对比），面板可展开看「为什么选它」。
- 测试：分类器纯函数表驱动；选路引擎矩阵（平局/预算/视觉否决/单候选退化）；迁移测试；面板快照测试。

## 3. 里程碑

- **M4.1** 配置 v2 + 迁移 + premiumLong 移除（含面板去掉长上下文槽位）。
- **M4.2** 评分表 + 分类器 v1（纯函数 + 表驱动测试）。
- **M4.3** 选路引擎替换 `decide()`，保留预算/@指令/图片护栏（矩阵测试）。
- **M4.4** 面板 v3（候选池 + 评分覆盖 + 决策可观测）。
- **M4.5** 实机验证 + 文档 + 避坑/台账收尾。

## 4. 先例检索（GitHub / 2026-08-17 实测）

| 先例 | 思路摘要 | 与本计划关系 / 借鉴 |
|---|---|---|
| [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM) | 服务+评估 LLM 路由器的框架；强/弱两模型间按预测质量差设阈值路由；可学习路由器（矩阵分解/BERT/因果 LLM 分类器） | **成本阈值安全阀**的直接先例；不采用可学习路由器（无训练数据），启发式评分是其 v1 替代 |
| [vllm-project/semantic-router](https://vllm-semantic-router.com/zh-hans/docs/v0.2/tutorials/intelligent-route/model-selection/hybrid/) | 语义分类（code 等领域）路由 + Hybrid Selection：Elo 质量分与成本做 tradeoff | **领域分类选最强模型**的工业实现，验证本计划维度分类方向；其 hybrid 公式 ≈ 本计划 2.4 评分式 |
| [ulab-uiuc/LLMRouter](https://github.com/ulab-uiuc/LLMRouter) | 统一库封装 AutoMix 等十余种路由算法做对比评估 | 借鉴其**评估先行**文化：M4.5 用会话日志离线回放对比路由决策 |
| [regolo-ai/brick-SR1](https://github.com/regolo-ai/brick-SR1) | 查询复杂度+能力抽取（空间嵌入）选模型 | 记为 **v2 分类器候选**（嵌入/小模型自分类），v1 不采用 |
| [ypollak2/llm-router](https://github.com/ypollak2/llm-router) | 面向 Claude Code/Cursor 等编码工具的通用路由器，free-first 回退链降成本 70–85% | **同用例**（编码 agent 成本路由）先例；其回退链是规则级，本计划差异点=能力评分 |
| [FrugalGPT](https://ar5iv.labs.arxiv.org/html/2305.05176)（及 [pi-smart-router 调研](https://github.com/beettlle/pi-smart-router/blob/HEAD/docs/deep-research.md)） | 级联（cascade）+ 预算约束的鼻祖；pi-smart-router 是 pi-ai 生态同类路由器 | 本计划 cost 预算窗口的理论谱系；pi-smart-router 为**同栈（pi-ai）最近先例**，差异点=DSH 原生钩子+面板驱动+provider 无关 |
| 本仓本地先例 `dsh-model-router`（0.2.0 设计期检索） | DSH 生态内模型路由插件 | 同 harness 最近先例，钩子用法（agent/pre-step + agent/request）沿用 |

**空白点（本计划的位置）**：上述先例均非「DSH/Cordis 插件形态、对活会话 agent 请求做替换、带用户面板可观测与覆盖」的路由器；能力评分表+面板覆盖+决策可观测三者组合无现成实现。

## 4.5 检索后设计校准

1. cost 模式「升级收益门槛」改名为 **route-threshold**，语义对齐 RouteLLM 的质量差阈值（默认值待 M4.3 实测定）。
2. 分类维度命名向 semantic-router 的领域词表靠拢（code/reasoning/writing/tooluse/vision/longctx 已接近，保留）。
3. M4.5 增加**离线回放评估**：解码历史会话日志 → 分类器+评分引擎重放 → 与实际所选模型对比，产出路由决策报告（借鉴 LLMRouter 评估先行）。
4. 明确不学、只借：不引入嵌入/训练依赖（brick-SR1/RouteLLM 学习式），保持零额外依赖、纯启发式可解释。

## 5. 风险与开放点

- 启发式分类准确率上限；误分类代价（强模型做简单任务=浪费，弱模型做难任务=返工）→ cost 模式「升级收益门槛」是安全阀。
- 评分基线的主观性 → 面板覆盖 + 决策可观测兜底。
- provider 价格未知 → 三档成本标签而非精确计价。
- 与 DSH 模型选择器的关系：路由器只在 agent/request 钩子替换 callConfig，选择器仍是人的最终入口。
