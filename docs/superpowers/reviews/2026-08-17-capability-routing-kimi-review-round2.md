# Kimi Round 2 复检报告：kimi-tide 0.3.0 计划 v2

> 审查者：Kimi CLI（kimi -r 续接 session_46ec504a-5a0c-47c8-b09c-5e91eba0afec）
> 裁决：DSH 全接受 7 条新意见（2 条带微调），回填计划 v2.1

## 一、13 条 Round 1 意见落实确认

11 条已修、2 条换解（严重 1 sidecar、中等 7 部分接受），逐条核对无遗漏。

## 二、裁决项评估

- **严重 1 sidecar 换解**：成立，整体优于重写解析器（绕开极简 YAML 子集限制 + 根除保存触发重 apply）；新坑=配置源管理/迁移运维复杂性，可控，需 guardrail（见新意见 1-4）。
- **中等 7 部分接受**：对 0.3.0 v1 够用，属「条件接受」；调研须前置到 M4.3 早期；不暴露时面板 chip 渲染「实际路由：xxx（router 决策）」。

## 三、v2 引入的新问题（7 条，无严重）

中等：
1. 双配置源静默覆盖，面板缺生效来源提示 → projection 加 configSource + 面板显示 sidecar 路径。
2. allowedProviders 默认硬编码 'kimi-tide'，与可配置 providerName 错位 → 默认白名单动态生成。
3. sidecar 不在 bundle patch，profile 迁移易丢 → export-config 命令 + README 路径明示。
4. sidecar 损坏回退未定义 → warn→patch 静态→默认，留 .corrupt 副本，启动不崩。

轻微：
5. costNorm 价格映射模糊 → M4.2 映射表（<$0.5/M cheap、$0.5–2 mid、>$2 expensive），无价格默认 mid。
6. yaml 依赖需版本约束 → 固定 ^2.x + JSON-compatible 子集。
7. M4.3 选择来源调研应前置 → 列为 M4.3 首个任务。

## 四、总评

Round 1 的 13 条 11 修 2 换解，v2 在持久化/候选校验/护栏/cost 语义/可观测上已闭环；
sidecar 双配置源管理细节与默认白名单再补一刀后，同意进入 writing-plans。
