# Kimi 审查任务书：kimi-tide 0.3.0 能力评分路由开发计划（Round 1）

你是独立审查者。审查对象是 kimi-tide（DeepSeek Harness 的 LLM provider 插件「月汐」）0.3.0 的开发计划。
请按下列顺序**先读后审**，不要凭印象下结论。

## 必读文件（根目录 E:\BaiduSyncdisk\Data\vibe-coding\kimi-tide\kimi-tide\）

1. 计划本体：`docs/superpowers/plans/2026-08-17-capability-scored-routing.md`
2. 现行实现（核对落地性）：`packages/dsh-kimi-tide/src/router.ts`、`src/index.ts`、`src/settings.ts`、`src/types.ts`、`src/client/TideDock.tsx`、`src/client/index.ts`
3. 上游 0.2.0 设计：`docs/superpowers/specs/2026-08-17-usage-panel-router-settings-design.md`
4. 现有测试（核对测试策略可行性）：`packages/dsh-kimi-tide/test/` 全目录

## 审查维度

1. **落地性**：计划每条设计（配置 v2、六维评分、分类器、评分选路、候选池枚举、面板 v3、决策可观测）在现行代码里有没有落点（agent/pre-step / agent/request 钩子、projection、commands、slot）？哪些是想当然？
2. **设计缺陷**：配置迁移漏项、评分基线主观性、分类器误分类代价与兜底、候选池枚举的性能/失败模式、projection payload 膨胀、与 DSH 模型选择器的冲突面。
3. **遗漏**：测试策略盲区、回滚路径、持久化兼容（patch 文件行锚定写入器对新配置形状是否还成立）、provider 未知价格的 costNorm 三档是否够用。
4. **先例借鉴校准**：计划第 4 节引用 RouteLLM / vllm semantic-router / LLMRouter / brick-SR1 / ypollak2-llm-router / FrugalGPT+pi-smart-router；判断「不学只借」的取舍是否成立，有无借错或漏借。
5. **范围纪律**：0.3.0 是否塞了过多东西？里程碑 M4.1–M4.5 的切分是否可独立交付？

## 输出格式

- 意见逐条列出，分级：**严重 / 中等 / 轻微**；每条含「位置（文件+章节或行号）/ 问题 / 建议」。
- **不得虚构文件路径、行号、代码段**；没读到的内容明确说「未核实」。
- 结尾：总评一句话（同意开工 / 修订后开工 / 需重设计），并列出你认为最该先做的 3 件事。
