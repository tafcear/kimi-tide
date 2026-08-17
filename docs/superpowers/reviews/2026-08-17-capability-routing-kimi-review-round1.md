# Kimi Round 1 审查报告：kimi-tide 0.3.0 能力评分路由开发计划

> 审查者：Kimi CLI（kimi -p，session_46ec504a-5a0c-47c8-b09c-5e91eba0afec，复检用 `kimi -r` 续接）
> 依据：计划本体 + 上游 0.2.0 设计 + 现行 src/test 全读 + 实跑测试 56 passed
> 裁决：DSH 逐条裁决见计划 v2 修订（同目录计划文件状态行标注 v2）

## 一、严重

1. **配置 v2 与行锚定持久化不兼容**（settings.ts:15-35, 234-280）：parseSimpleYamlBlock/renderRouterBlock 是极简 YAML 子集，candidates[]/scores{}/classify 会写坏读错。建议注释保留 YAML AST 或重写解析渲染。
2. **候选池枚举缺 provider 过滤与可用性校验**（index.ts:166-194）：listProviders×listModels 无白名单，ollama 等会被拉入。建议 allowedProviders + resolveModel 校验 + 面板不可用标记。
3. **图片护栏在 provider 无关池下失效**（router.ts:73-94, adapter.ts:66-69）：textOnlyProviders 硬编码 Kimi 路线；v2 需每候选 modality 元数据，listModelIds 不返回 inputModalities。建议候选元数据带 vision，带图步骤排除 vision=0。

## 二、中等

4. **迁移缺代码落点**：DEFAULT_ROUTER_CONFIG 仍含 premiumLong，无 migrateRouterConfig()。建议 load 入口版本嗅探 + 一次性 warn + 测试。
5. **cost 模式语义未澄清**：route-threshold / costNorm 三档 / premiumBudget 窗口三者协同顺序与 λ 默认值未定义。
6. **projection payload 膨胀未受控**：每候选六维分+reason 进每条事件可达数 KB。建议 keep/off 不下发详细分、reason 截断或独立事件。
7. **与模型选择器冲突面未细化**：agent/request 无条件替换 callConfig，「我选 A 却发到 B」。建议检测显式选择并给 reason「user explicit, skipped routing」。
8. **分类器/选路引擎落点空想**：无独立 classify()/score() 接口。建议 M4.2 先纯函数+表驱动测试，M4.3 再替换 decide()。

## 三、轻微

9. @kimi 泛化 @<provider> 未同步到正则/SETTABLE_KEYS/面板 → M4.1 同步。
10. 面板 v3 单文件 262 行再塞功能成瓶颈 → 拆 CandidateList/ScoreEditor/ReasonPanel + 快照测试。
11. M4.5 离线回放缺日志来源与最小数据格式 → 先写 replay.ts 原型。
12. 评分基线表缺版本化 → scoresVersion + 合并顺序（用户覆盖 > 当前基线 > 旧基线）。
13. 里程碑串行依赖强 → M4.5 后移为 M4.6/0.4.0，0.3.0 只到 M4.4。

## 四、先例校准

引用基本准确，「不学只借」合理。补充：再核对本地先例 dsh-model-router 是否已有 provider-agnostic 候选池/costNorm 实践，避免漏借。

## 五、总评

设计方向正确且先例引用得当，但 v2 配置持久化、候选池元数据、图片护栏、cost 语义四个落地细节必须编码前修订，否则 M4.1/M4.3 大规模返工。**修订后开工。**

最该先做：①持久化层升级+迁移函数+测试；②候选池枚举与 modality/costNorm 元数据原型验证；③cost 模式与可观测性规格细化。
