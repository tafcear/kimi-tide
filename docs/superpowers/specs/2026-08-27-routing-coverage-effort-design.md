# 0.8.0 规则体系补全 + 可解释性 + 推理程度配置（设计稿）

> 状态：**待独立评审（用户指令「评审」，2026-08-27）**。评审人 = Kimi k3（@kimi 子代理，只读，对照现行源码核实落地性）；评审结论交用户审定，审定通过后才走 writing-plans。
> 前序：0.7.0 关键词匹配准确性已实施且实机验收 A1–A10 全绿（发版 tag 待用户裁定，与本设计无依赖关系）。

## 1. 背景与动机（用户三个不满，2026-08-27 讨论定稿）

0.7.0 发布验收后，用户对规则体系提出三点不满，本设计逐一回应：

1. **覆盖面太少**——现只有 3 个关键词组（code 17 词 / chitchat 8 词 / plan 4 词），审查/写作/翻译/长文档/数学五类常见场景无规则覆盖；
2. **特异度排序在界面无解释**——规则区标题仍是 0.5.0 时代「有序，首条命中生效」（0.7.0 已改语义，标题过时误导）；minHits 数字框无可见标签；
3. **规则命中模型的推理程度不可配**——路由切换时 effort 只能跟随目标模型默认，用户希望按规则指定。

## 2. 设计决策（用户已逐项裁定）

### D1 覆盖面：数据派补 5 组（不动匹配引擎）

- 条件类型维持两种（image / keywords）；LLM 意图分类、正则、排除词、AND 组合明确不做（0.3.x 评分引擎 pre-step 延迟+成本教训；用户确认「条件类型也不够」未勾选）。
- 内置新增 5 组（`DEFAULT_KEYWORD_GROUPS`）：

| 组 | 词表 | 说明 |
|---|---|---|
| `review` | 审查, review, 评审, 挑毛病, 复检, 检查, audit, 意见, 打分 | 独立审查/挑毛病类 |
| `writing` | 写作, 文案, 润色, 改写, 扩写, 标题, 推文, 周报, 演讲稿 | 写作文案类 |
| `translate` | 翻译, 译成, 中译英, 英译中, translate, 本地化 | 从 chitchat 独立 |
| `longdoc` | 长文档, 通读, 逐段, 全文, 上万字, 大文档 | 关键词触发（不做长度阈值——用户裁定） |
| `math` | 数学, 证明, 推导, 求解, 公式, 数论, 概率, 逻辑题 | 数学/推理类 |

- 内置 chitchat 瘦身：迁出「翻译」「总结」→「总结」归入 writing（词表 +总结）。存量用户 keywordGroups 不动（迁移不写回）。
- 内置预设接线（canonical 模型对 = kimi-coding × deepseek-official，不假设 qwen/glm 存在）：
  - capability 规则序：`image → code → review → math → longdoc → writing → translate → chitchat`
    （target：review→`kimi-coding/k3`、math→`deepseek-official/deepseek-v4-pro`、longdoc→`kimi-coding/k3`、writing→`deepseek-v4-pro`、translate→`deepseek-v4-flash`）
  - saving 只加一条：translate → `deepseek-v4-flash`（省钱姿态配便宜活）
- 用户实机配置同步（实施时按用户兵器库）：review→`qwen-token-plan-cn/qwen3.8-max-preview`、math→`zai-coding-cn/glm-5.2`、longdoc→`kimi-coding/k3`、writing→`deepseek-v4-pro`、translate→`deepseek-v4-flash`；capability 新序同上。

### D2 可解释性：静态说明 + 行级摘要 + 试一句测试器 + 决策观测增强

- 规则区标题改为真实语义：「规则（命中词数多者优先，平手按列表序，带图恒第一）」。
- minHits 数字输入加可见标签「最少命中词数」+ 小字提示「≥N 个词同时命中才触发」。
- 每条规则行渲染自动条件摘要（纯函数生成）：「带图」/「命中 code 组 ≥1 词」/「命中 plan 组 ≥2 词」。
- **「试一句」测试器**（设置卡片内）：输入一句话 → 实时显示命中规则（含命中词数与特异度比较）与最终路由目标；复用 `matchingRules` + decide 纯函数面，零网络成本。
- 决策 chip 增强：`buildDecisionSummary` 原因升级为「规则『code』命中 2 词（特异度最高）」类，携带命中词数；投影/面板同数据。

### D3 推理程度：`effort` 可选字段（规则目标 + 预设默认 + 转述流视觉模型）

- 配置形状：`RouteTarget` 模型变体加 `effort?: string`（id 空间 = minimal/low/medium/high/max）。生效点：规则 target、预设 default、`TranscribeFlow.visionModel`。显式 @ 指令路由不指定 effort（维持模型默认）。
- 事实（实读 pi-ai 目录 2026-08-27）：deepseek-v4-pro/flash → high/max；k3 → low/high/max；glm-5.2(zai) → low/medium/high/max（low/medium 适配器映射 high）；qwen3.8-max-preview 未声明。
- 校验双保险：`validateRouterConfig` 校验 effort 在 id 空间内；路由期（applyTo/VisionCaller）对「目标模型不支持该档位」降级为不指定（模型默认）+ 日志。
- UI：目标/默认模型/视觉模型下拉旁加 effort 下拉，选项 = 该模型支持档位（运行时 `reasoningEfforts` 目录）；模型未声明档位 → 只渲染禁用态「跟随默认」；切换模型后当前 effort 不在新模型档位 → 自动清空。
- 档位目录通道：宿主把 per-model `reasoningEfforts`（已由 `resolveModelInfo` 枚举，`CandidateMeta.reasoningEfforts`）送进设置卡片——优先复用 `kimi-tide/panel` 投影 candidates 扩展；实现时若该缝不适配再另选，写入实施计划前以 spike 钉死。
- 兼容：全部可选字段，v5 形状不变（无 version bump、无迁移、存量逐字节合法）。

## 3. 非目标（0.8.x 候选池）

- 条件类型扩展（正则 / 排除词 / AND 组合）
- 长文档按上下文长度阈值触发（`estimatedTokensGt` 回迁）
- LLM 意图分类（含「未命中兜底分类」）
- 显式 @ 指令的 effort 指定

## 4. 兼容与迁移

- 存量 v5 配置零迁移：新字段全可选；内置组/预设只影响新装与「重置为默认」路径。
- 匹配语义不变量保持：中文子串 / ASCII 词边界 / 特异度排序 / 平手列表序 / 带图恒优先 / minHits 缺省 1。

## 5. 验收（发布门禁，沿用 0.7.0 起用户裁定门禁）

- 全量单测 + typecheck 0 + build 绿（基线 359+）。
- 实机验收清单（发版前在真实宿主执行，全绿 + 用户裁定 tag 方可发版）：B1 新组命中阳性（审查/写作/翻译/长文档/数学各一探针，request/header 解码）；B2 特异度与新组交叉（「帮我审查这段代码」→ review 与 code 双中取词数多者）；B3 minHits 摘要与标签渲染；B4「试一句」测试器结果与实机路由一致（同一句话进对话对照 header）；B5 effort 生效（deepseek 目标 effort=max → header 携带 reasoningEffort:max；qwen3.8 目标「跟随默认」禁用态）；B6 转述流 visionModel effort 生效；B7 存量兼容（无迁移留档、旧配置行为不变）；B8 决策 chip 显示命中词数。

## 6. 涉及文件（草案）

- `packages/dsh-kimi-tide/src/config.ts`（新组/预设序/`effort?`）
- `src/settings-schema.ts`（ruleSchema/targetSchema/flowSchema + validate effort）
- `src/router.ts`（applyTo/VisionCaller effort 注入与降级、buildDecisionSummary 原因升级）
- `src/transcribe.ts`（visionModel effort）
- `src/rules.ts`（条件摘要生成函数）
- `src/client/SettingsCard.tsx` + `card-store.ts`（标签/摘要/effort 下拉/试一句测试器/档位目录通道）
- 测试：config/settings-schema/rules/router/SettingsCard 各测试文件
- 文档：`docs/router.md`、根 README 中英镜像、`packages/dsh-kimi-tide/README.md`

## 7. 版本定位

0.8.0（minor：规则体系数据 + 可选配置字段 + UI 可解释性；发版前过实机验收门禁）。
