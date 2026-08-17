# 开发计划：kimi-tide 0.2.0 — 双模型自动分工 + 能力缺口补偿

> 状态：**计划阶段**（M1 草稿已存在；2026-08-17 扩展：用量显示/路由设置面板/推理状态，设计稿见 [`superpowers/specs/2026-08-17-usage-panel-router-settings-design.md`](superpowers/specs/2026-08-17-usage-panel-router-settings-design.md)）
> 定位：月汐项目的核心愿景功能——让 DeepSeek 与 Kimi 按策略自动互补，而非手动切换。
> 已有起点：[`packages/dsh-kimi-tide/src/router.ts`](../packages/dsh-kimi-tide/src/router.ts)（M1 草稿，机制研究已全部完成）

---

## 1. 背景与动机

### 1.1 双模型的实测差异（本项目已验证）

| 维度 | DeepSeek V4（flash/pro） | Kimi（kimi-for-coding / k3） |
|------|--------------------------|------------------------------|
| 成本 | 低 | **高（贵，需省着用）** |
| 速度 | flash 秒级 | K2.7 Code 1.3~1.8s；K3 4~5.4s |
| 工具循环 | 原生全工具面，执行强 | 强（工具调用闭环已验证） |
| 上下文 | 128K | **K3 1M**（长文档分析优势） |
| 多模态 | **❌ V4 不支持图片输入** | ✅ image_in 已验证（红色 PNG 识别） |
| 深度思考 | 高 | K3 思考链更长（122 字符 vs 0） |
| 已验证角色 | 实施/修复/发布全流程 | 独立审查（23+12 项）、写 README |

### 1.2 要解决的两个问题

1. **成本失衡**：Kimi 贵，全量使用不经济；全用 DeepSeek 又浪费 Kimi 的能力长板。
2. **能力缺口**：主力模型 DeepSeek V4 的硬缺口（多模态、超长上下文）需要自动补偿，而不是等用户手动切模型或直接报错。

---

## 2. 需求规格

### 2.1 模式 A：cost（性价比）——"省着用"

- 默认路由：`deepseek-official/deepseek-v4-flash`（便宜主力）
- **升级条件**（任一命中 → Kimi）：
  - 用户显式指令（`@kimi` 前缀）
  - 上下文估算超阈值（默认 60K tokens，可配）
  - 命中关键词规则（审查/长文档类，默认规则集）
  - **能力缺口强制升级**（见 2.3，不受预算约束——主力干不了，必须用 Kimi）
- **预算上限**：滑动窗口（默认 20 次决策）内 Kimi 占比 ≤ `premiumBudget`（默认 0.2）；超预算 → 强制主力 + 日志记录
- 语义：**默认省钱，必要时才花**

### 2.2 模式 B：capability（能力最优）——"谁厉害谁上"

- 规则表顺序匹配（首个命中生效）：

| # | 匹配条件 | 路由 |
|---|---------|------|
| 1 | 显式 `@kimi` | kimi-tide/kimi-for-coding |
| 2 | 消息含图片块（能力缺口） | kimi-tide/kimi-for-coding |
| 3 | 审查类关键词（审查/review/复检/挑毛病/audit…） | kimi-tide/kimi-for-coding |
| 4 | 估算上下文 > 90K | kimi-tide/k3（1M 窗） |
| 5 | 默认 | deepseek-official/deepseek-v4-flash |

- 语义：**每类任务用最擅长的模型**

### 2.3 能力缺口补偿（两种模式共有，最高优先级）

| 缺口 | 检测方式 | 补偿路由 | 说明 |
|------|---------|---------|------|
| 多模态 | pre-step 消息批次中含 `type: 'image'` 块 | `kimi-tide/kimi-for-coding` | DeepSeek V4 会在适配器层报 `UNSUPPORTED_CONTENT`——必须在路由层**提前**拦截，比报错后重试好 |
| 超长上下文 | 估算 token > 阈值 | `kimi-tide/k3` | 128K → 1M 的硬补偿 |
| （预留）深度推理 | 关键词"深度思考/推理"（可选） | kimi 高 effort | 视 K3 实际表现再定 |

补偿路由**高于预算约束**（cost 模式下也不降级）——因为主力模型根本没有该能力，降级等于任务失败。

### 2.4 非目标（v1 明确不做）

- ❌ LLM 分类器（成本 + 延迟，关键词启发式先行，作为 M7 增强项）
- ❌ 工具循环中途切换（仅 step 0 决策，保持单轮上下文一致性）
- ❌ 按 token 单价做精确成本结算（预算用调用次数占比近似，M7 可换 token 计量）
- ❌ 多主模型（v1 只支持 DeepSeek×Kimi 一对）

---

## 3. 技术方案（研究已完成 ✅）

### 3.1 DSH 官方路由机制

已从源码确认（`dsh-agent` / `dsh-agent-loop` / `dsh-llm`）：

```
agent/pre-step   (waterfall, 携带本步 UserMessage[])
      │  分类：显式指令 / 图片块 / 关键词 / token 估算
      │  决策存入 WeakMap<Agent, RouteDecision>
      ▼
agent/request    (waterfall, 携带该步 callConfig)
      │  await next() 拿默认配置 → 消费决策 → 返回替换 {provider, model}
      ▼
ctx.llm.prepareCall() → 校验 + 适配器默认值 → 分发
```

关键约束（源码确认）：
- `agent/request` 的 payload **不含消息**——决策必须由 `agent/pre-step` 提供（跨事件槽位传递）
- 返回的 `LlmCallConfig` 只需替换 `provider/model`，其余字段保留 resolved 值
- 切换安全：官方支持 per-step 路由变化（"switching models mid-reply takes effect on the next step"）
- 官方参考实现：`dsh-agent/model-selection.js`（同款双监听器模式）

### 3.2 分类器输入

| 信号 | 来源 | 用途 |
|------|------|------|
| 最新用户文本 | `latestUserText(messages)` | 显式指令、关键词 |
| 图片块检测 | 遍历消息 `content` 块 | 能力缺口补偿 |
| token 估算 | `ceil(chars / ratio)`，ratio 默认 2（中英混合保守值） | 长上下文检测 |
| step 编号 | payload.step | 仅 step 0 决策 |

### 3.3 模块划分

```
packages/dsh-kimi-tide/src/
├── router.ts          # 已有草稿：KimiRouter（decide/applyTo/budget）+ installRouter
│                      # 需补：图片块检测（2.3 能力缺口）
├── index.ts           # 集成：Config 扩展 { router?: RouterConfig }（默认 mode: 'off'）
└── cordis.patch.yml   # 配置示例（注释形式，默认关闭向后兼容）
```

### 3.4 配置 Schema（v1）

```yaml
dsh-kimi-tide:
  router:
    mode: off            # off | cost | capability（默认 off，不影响 0.1.1 用户）
    primary: { provider: deepseek-official, model: deepseek-v4-flash }
    premium:  { provider: kimi-tide, model: kimi-for-coding }
    premiumLong: { provider: kimi-tide, model: k3 }
    escalateWhen:
      explicit: true
      estimatedTokensGt: 60000
      patterns: [审查, review, 复检, 挑毛病, audit]
    premiumBudget: 0.2
    budgetWindow: 20
    charsPerToken: 2
    rules:               # capability 模式
      - match: { patterns: [审查, review, 复检] }
        route: { provider: kimi-tide, model: kimi-for-coding }
      - match: { estimatedTokensGt: 90000 }
        route: { provider: kimi-tide, model: k3 }
```

---

## 4. 里程碑分解

| 里程碑 | 内容 | 验收标准 | 状态 |
|--------|------|---------|------|
| **M1** 路由器核心 | router.ts（决策器 + 预算窗口 + 生命周期挂载） | 单元测试：决策逻辑/预算/显式指令 | ✅ 草稿已有 |
| **M2** 能力缺口补偿 | 图片块检测 → 强制 kimi（高于预算） | 含 image 块的消息必路由 kimi | ⬜ |
| **M3** index 集成 + Config | Config 扩展、默认 off、cordis.patch.yml 示例 | 旧配置零影响；开 mode 后生效 | ⬜ |
| **M3.5** 双端化 | client bundle（build-client.mjs + `dsh.client` 声明）+ `kimi-tide/panel` projection + `/kimi-tide` 命令族 | composer dock 出现「月汐」面板骨架（机制对齐 dsh-model-router） | 📋 已计划（2026-08-17） |
| **M3.6** 用量显示 | usage.ts（官方 `/coding/v1/usages` 轮询 + 本地 token 累计）+ dock 用量行 | 周配额/5h窗口/会员/本地token 四区展示，80%/90% 变色 | 📋 已计划（2026-08-17） |
| **M3.7** 设置面板 | settings.ts（行级回写 patch yml）+ dock 展开区表单 + 命令保存 | 保存后重启保持；当前会话即时生效 | 📋 已计划（2026-08-17） |
| **M4** 单元测试 | 分类器/预算/缺口补偿/applyTo + 用量解析/设置读写 | 覆盖率 >80% 关键路径 | ⬜ |
| **M5** 实机集成验证 | 装 profile 重启，验证：普通任务走 deepseek、@kimi 走 kimi、图片走 kimi；dock 渲染/命令往返/持久化 | 会话日志 request/header 观察路由 | ⬜ |
| **M6** 文档发布 | README 路由章节 + docs/router 使用手册 + 0.2.0 Release | 文档与配置一致 | ⬜ |
| **M7**（可选）增强 | LLM 分类器、token 精确计费、多主模型、settings UI | 视使用反馈 | ⬜ |

---

## 5. 风险与决策点

| 风险/决策 | 分析 | 决定 |
|-----------|------|------|
| 切换时机 | 工具循环中切换会改变上下文"口音"，且 tool 结果与模型绑定更稳 | 仅 step 0 决策 ✅ |
| 关键词误判 | "审查"一词出现在普通对话会误升 Kimi（白花钱） | patterns 可配 + 默认集保守 + 预算兜底 |
| token 估算误差 | chars/2 对中文偏保守（实际中文 ~1.5 字/token） | 可配 charsPerToken；M7 换 tokenMeter |
| reasoningEffort 跨模型 | 替换路由后 effort 语义不同 | 替换时丢弃继承 effort，让目标模型用自身默认（参考官方 model-selection 做法） |
| 预算窗口在重启后清零 | 会话级窗口 vs 全局窗口 | v1 进程内全局窗口（简单）；M7 可持久化 |
| DeepSeek 多模态未来支持 | 若 V4 后续版本支持图片，补偿路由变成过度设计 | 检测前查 `resolveModel` 的 `inputModalities`，支持则跳过补偿 |

## 6. 验收标准（0.2.0 整体）

1. `mode: off` 下行为与 0.1.1 完全一致（回归）
2. cost 模式：默认 deepseek；@kimi/长文/审查词任一升级；预算 20% 封顶后降级并记录日志
3. capability 模式：规则表按序匹配，路由结果与表一致
4. **图片消息在任何模式下都路由 kimi**（除非 DeepSeek 模型声明支持图片）
5. 所有路由决策可通过会话 `request/header` 日志追溯
6. 单元测试绿 + 实机 5 分钟手工验证通过
7. README/docs 更新，0.2.0 Release 发布
8. 「月汐」dock 面板：用量四区（周配额/5h窗口/会员/本地token）正确渲染并具备 80%/90% 变色；路由设置保存后 patch yml 变化且重启保持；推理状态行显示"已启用"

---

## 7. 与项目其他部分的关系

- **dsh-kimi-bridge**（CLI 桥接）：与路由正交——路由决定"哪个模型"，bridge 提供"独立 Kimi agent 会话"；`call_kimi` 本身不受路由影响
- **协作闭环**：路由器的规则集（审查→kimi）正是本项目实测出的能力矩阵的固化
- **未来路径**：Open Design 已验证 `kimi acp` 官方协议——若 DSH 后续提供 ACP 子代理，capability 模式可扩展为"任务路由给独立 agent"而非仅模型
