# 开发计划：kimi-tide 0.2.x — 双模型自动分工 + 能力缺口补偿

> 状态：**计划主体已落地（main 分支，v0.1.3 之后提交，未发布），架构已由 0.3.0 能力评分路由承接（2026-08-18 实施完成，见 [`superpowers/plans/2026-08-17-capability-routing-implementation.md`](superpowers/plans/2026-08-17-capability-routing-implementation.md) 与 [`../packages/dsh-kimi-tide/docs/router.md`](../packages/dsh-kimi-tide/docs/router.md)；v1 配置形状仍被接受并桥接 v2）**——M1-M3 路由器核心/能力缺口补偿/index 集成已接线（64c22cd 起）；**路由器失效已修复（2026-08-18 commit 71b1d18：step 门控改 `payload.step === 1` + 图像护栏方向修正 + `textOnlyProviders` 可配置，全量 66/66 测试绿）**；M3.5-M3.7 面板三件套代码完成（实机验证待人工）；M4 单元测试收尾、M6 文档发布为待办；**M5 实机集成验证已通过 ✅（2026-08-18 双探针 + 2026-08-19 带图实机闭环，见 §4 M5 行）**；**⚠️ 带图会话锁存已知限制（fcbf421，2026-08-19 实测死锁），见 §2.3.1**；**0.4.x（2026-08-20）已实施（分支 `feat/0.4.0-api-key-direct`，v0.4.0 已发布）：provider 改名 `kimi-tide` → `kimi-coding`、自研 OAuth 接入层退役切换为 pi-ai 原生 `kimi-coding` 路由 + API key（本文 0.2.x 表格中的 `kimi-tide/*` 为历史 provider 名，0.4.x 起现行名 `kimi-coding/*`）。**；**0.5.0 规则驱动路由已实施（2026-08-21，分支 `feat/0.5.0-rule-driven-routing`，未发布）：0.3.0 能力评分引擎整体退役，由「命名预设 + 有序规则（带图/关键词组）+ 打底语义」承接——架构实况见 [`../packages/dsh-kimi-tide/docs/router.md`](../packages/dsh-kimi-tide/docs/router.md)，设计稿见 [`superpowers/specs/2026-08-20-rule-driven-routing-design.md`](superpowers/specs/2026-08-20-rule-driven-routing-design.md)；v1→v3→v4 存量配置自动迁移（设置文档留档 `.pre-v4`）。**；**0.6.0 协作编排已实施并发布（2026-08-22 实施 / 2026-08-23 tag `v0.6.0`，[Release](https://github.com/tafcear/kimi-tide/releases/tag/v0.6.0)）：配置升 v5（flows 注册表 + 预设级 `imageFallback` 三态），规则目标泛化为「模型 | 协作流」，预置转述流（vision-exp eager/lazy）与评审流（P2 触发）注册但不绑定，按图三态状态表退役布尔锁存，面板 v6 图像上下文行 + 流事件，v4 存量迁移留档 `.pre-v5`——设计稿见 [`superpowers/specs/2026-08-22-collaboration-flows-design.md`](superpowers/specs/2026-08-22-collaboration-flows-design.md)，实施计划见 [`superpowers/plans/2026-08-22-collaboration-flows.md`](superpowers/plans/2026-08-22-collaboration-flows.md)；**发布版 337/337 绿 + typecheck 0 + build 过，实机验收 10 项全过（含 T4 门）；验收修复 `e2d3c68`：rc.2 宿主 `installModelSelection` 覆盖监听器把路由结果覆盖回会话选定模型 → 四监听器 `{prepend:true}` 恒外层（详见 host-platform-map §4.7）。**
> 2026-08-17 扩展：用量显示/路由设置面板/推理状态，设计稿见 [`superpowers/specs/2026-08-17-usage-panel-router-settings-design.md`](superpowers/specs/2026-08-17-usage-panel-router-settings-design.md)
> 定位：月汐项目的核心愿景功能——让 DeepSeek 与 Kimi 按策略自动互补，而非手动切换。
> 现有实现：[`packages/dsh-kimi-tide/src/router.ts`](../packages/dsh-kimi-tide/src/router.ts)（已实现并接线：`KimiRouter` 决策 + `installRouter` 挂 `agent/pre-step` + `agent/request`）

---

## 1. 背景与动机

### 1.1 双模型的实测差异（本项目已验证）

| 维度 | DeepSeek V4（flash/pro） | Kimi（kimi-for-coding / k3） |
|------|--------------------------|------------------------------|
| 成本 | 低 | **高（贵，需省着用）** |
| 速度 | flash 秒级 | K2.7 Code 1.3~1.8s；K3 4~5.4s |
| 工具循环 | 原生全工具面，执行强 | 强（工具调用闭环已验证） |
| 上下文 | 1M（pi-ai 目录实读，2026-08-18：`@earendil-works/pi-ai/dist/providers/data/deepseek.json` 中 `deepseek-v4-flash/pro` 均 `contextWindow: 1000000`；早期文档记为 128K 的前提不成立，已按目录落实） | **K3 1M**（长文档分析优势，`kimi-coding.json` 中 `k3` 为 `contextWindow: 1048576`）；kimi-for-coding 256K |
| 多模态 | **❌ V4 不支持图片输入**（适配器对 image 块抛 `UNSUPPORTED_CONTENT`） | ✅ image_in 已验证（红色 PNG 识别，`kimi-for-coding` 脚本实测）；`k3` 等全部 4 个模型 pi-ai 目录均声明 `input: ["text", "image"]`（kimi-coding.json 实读，2026-08-18） |
| 深度思考 | 高 | K3 思考链更长（122 字符 vs 0） |
| 已验证角色 | 实施/修复/发布全流程 | 独立审查（23 项，含 12 轻微）、写 README |

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

> **当前 profile 实况（2026-08-18）**：`~/.dsh/profiles/web/cordis.patch.yml` 已配 `router.mode: cost`、primary=`deepseek-v4-flash`、premium/premiumLong=`k3`、`premiumBudget: 0.2`；**`escalateWhen.patterns: [看图, 图像, 截图, 审查, review]` 已配置（2026-08-18 合并进路由器修复实施）**。配置前（Round 1 时）未配 `escalateWhen`，除显式 `@kimi` 外恒走 primary。**实机验证（2026-08-18，DSH 会话日志解码实锤）**：后端真正重启后（新进程 PID 37576，替换了此前 14:57 启动的旧进程），`@kimi` 显式探针与 escalateWhen 关键词探针的会话日志 request/header 均为 `kimi-tide/k3`（ctxWindow=1048576）——cost 模式关键词升级与显式指令升级已实机生效。此前首轮复测（旧进程未重启、修复未加载）结论作废。

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
| 多模态 | pre-step 消息批次中含 `type: 'image'` 块 | `kimi-tide/k3`（或任意多模态 Kimi 模型） | DeepSeek V4 会在适配器层报 `UNSUPPORTED_CONTENT`——必须在路由层**提前**拦截，比报错后重试好。**方向已于 2026-08-18 修正（commit 71b1d18）**：`applyImageGuard` 现在把带图步骤从文本-only 路由（默认=primary `deepseek-official`）改道多模态 premium（`kimi-tide/k3`）；`textOnlyProviders` 默认=primary 的 provider，可经 `RouterConfig.textOnlyProviders` 配置覆盖；premium 自身亦文本-only 时安全退出防乒乓；护栏属正确性兜底、不记入 premium 预算窗口。见 §4 M2 状态注 |
| 超长上下文 | 估算 token > 阈值 | `kimi-tide/k3` | 按 pi-ai 目录实读（2026-08-18）：DeepSeek V4 亦为 1M 窗（`contextWindow: 1000000`），与 K3（`1048576`）同级——目录声明层面不再是硬缺口；是否构成实际差异待 M5 实机核实（原设计前提 V4 128K 不成立，已落实） |
| （预留）深度推理 | 关键词"深度思考/推理"（可选） | kimi 高 effort | 视 K3 实际表现再定 |

补偿路由**高于预算约束**（cost 模式下也不降级）——因为主力模型根本没有该能力，降级等于任务失败。

### 2.3.1 带图会话锁存与已知限制（fcbf421，2026-08-19）

**为何锁存**：`agent/pre-step` payload 只含本轮消息；文本-only 适配器（deepseek）序列化**全量**历史时对任一 image 块抛 `UNSUPPORTED_CONTENT` → 图片一旦进入历史，后续文本轮选文本-only 候选必崩。

**机制**：`installRouter` 持 per-agent `imageSeen` WeakMap——任一 pre-step 含图即永久锁存 → `decide` 强制 vision 维评分（生产配置 k3.vision=5 多模态候选必胜出）+ request 钩子 `applyImageGuard` 兜底改道。子代理（独立上下文）不受锁存影响。

**⚠️ 已知限制（2026-08-19 实测）**：锁存后会话锁死在多模态模型——k3 额度/Key 失效（AUTH 报错）时会话无法切文本模型继续（`model-unavailable`：历史含图片）→ **整会话死锁**，存量会话无法救回（历史图片不可逆）。锁存只是把崩溃延后，**判定不可作为终态方案**。

**根解（0.3.x 规划）**：图片不进主会话历史——

- **图像转述模式**（模型级）：pre-step 调多模态模型把图片转述为文本块注入，后续请求全为纯文本；
- **子代理图片外包**（子代理级）：独立上下文子代理读图回传文字（前置=kimi 子代理后端落地，扩展点为 subagents 命名注册表 + host plane opt-in 挂载，见 §7）。

**现状**：现行路由（0.5.0 规则驱动）中锁存以 `hasImageOverride` 强制按带图处理等价实现——带图规则必命中 + 图像护栏兜底（见 router.md「带图会话锁存」节），根解同样适用。

### 2.4 非目标（v1 明确不做）

- ❌ LLM 分类器（成本 + 延迟，关键词启发式先行，作为 M7 增强项）
- ❌ 工具循环中途切换（仅每轮首个模型步决策——`payload.step === 1`（dsh-agent-loop 契约实读：首步恒为 1），保持单轮上下文一致性；71b1d18 起生效）
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
| step 编号 | payload.step | 仅每轮首个模型步决策（`=== 1`，71b1d18 修正；原 `=== 0` 永不成立导致路由器空转） |

### 3.3 模块划分

```
packages/dsh-kimi-tide/src/
├── router.ts          # 已实现：KimiRouter（decide/applyTo/budgetUsage）+ installRouter
│                      # 图片检测 messagesContainImage + 图片护栏 applyImageGuard（71b1d18 方向已修正：文本-only → 多模态 premium）
├── index.ts           # 集成：Config 扩展 { router?: RouterConfig }（默认 mode: 'off'）→ 装配（64c22cd）
├── usage.ts           # 用量显示（M3.6，官方 usages 轮询 + 本地 token 桶）
├── settings.ts        # patch 文件读写（legacy 静态种子 / 无 settings 服务回退）
├── commands.ts        # /kimi-tide 命令族（M3.5）
├── projection.ts      # kimi-tide/panel projection（M3.5）
├── client/            # 月汐 TideDock 面板（browser half）
└── cordis.patch.yml   # 配置示例（注释形式，默认关闭向后兼容）
```

### 3.4 配置 Schema（v1）

```yaml
dsh-kimi-tide:
  router:
    mode: off            # off | cost | capability（默认 off，不影响 0.1.x 用户）
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
    textOnlyProviders:  # 可选（71b1d18 新增）：图像护栏声明文本-only provider；缺省 = [primary.provider]（deepseek-official）
    rules:               # capability 模式
      - match: { patterns: [审查, review, 复检] }
        route: { provider: kimi-tide, model: kimi-for-coding }
      - match: { estimatedTokensGt: 90000 }
        route: { provider: kimi-tide, model: k3 }
```

> **0.4.0 迁移注**：路由配置持久化已从 sidecar 文件（`kimi-tide-router.yml`）迁至 DSH 设置命名空间 `kimi-tide-router`（base/user 分层 + revision 冲突检测）；sidecar 一次性迁移为 `.legacy-imported` 留档；patch.yml `router` 静态块降级为部署基座（base 层），用户编辑落 user 层。v1 schema 仍被接受并桥接 v2（`migrateV1`）。设计稿见 [`superpowers/specs/2026-08-19-settings-migration-design.md`](superpowers/specs/2026-08-19-settings-migration-design.md)。

---

## 4. 里程碑分解

| 里程碑 | 内容 | 验收标准 | 状态 |
|--------|------|---------|------|
| **M1** 路由器核心 | router.ts（决策器 + 预算窗口 + 生命周期挂载） | 单元测试：决策逻辑/预算/显式指令 | ✅ 已实现并接线（64c22cd 起：`KimiRouter.decide/applyTo/budgetUsage` + `installRouter` 挂 `agent/pre-step`+`agent/request`） |
| **M2** 能力缺口补偿 | 图片块检测 → 强制 kimi（高于预算） | 含 image 块的消息必路由 kimi | ✅ 已实现并修正（71b1d18）：`messagesContainImage` + `applyImageGuard` 把带图步骤从文本-only primary 改道多模态 premium（`textOnlyProviders` 默认=primary、可配置覆盖；premium 亦文本-only 时安全退出防乒乓；护栏不记预算窗口）。此前（ca43445 起）护栏方向与设计相反（带图改道文本-only primary），于 71b1d18 反转，router.test.ts 重写反向假设断言 + 新增 router-wiring.test.ts 接线测试，全量 66/66 绿 |
| **M3** index 集成 + Config | Config 扩展、默认 off、cordis.patch.yml 示例 | 旧配置零影响；开 mode 后生效 | ✅ 代码完成（index.ts 装配 `config.router ?? loadPersisted(store) ?? DEFAULT`，mode≠off 才 install，64c22cd） |
| **M3.5** 双端化 | client bundle（build-client.mjs + `dsh.client` 声明）+ `kimi-tide/panel` projection + `/kimi-tide` 命令族 | composer dock 出现「月汐」面板骨架（机制对齐 dsh-model-router） | ✅ 代码完成（实机验证待人工） |
| **M3.6** 用量显示 | usage.ts（官方 `/coding/v1/usages` 轮询 + 本地 token 累计）+ dock 用量行 | 周配额/5h窗口/会员/本地token 四区展示，80%/90% 变色 | ✅ 代码完成（实机验证待人工） |
| **M3.7** 设置面板 | settings.ts（行级回写 patch yml）+ dock 展开区表单 + 命令保存 | 保存后重启保持；当前会话即时生效 | ✅ 代码完成（0.4.0 起表单迁至官方设置面板「月汐」卡片，DSH 设置命名空间 `kimi-tide-router` 持久化；dock 退化为只读仪表） |
| **M4** 单元测试 | 分类器/预算/缺口补偿/applyTo + 用量解析/设置读写 | 覆盖率 >80% 关键路径 | 🟡 进行中：router/usage/settings/commands/projection/types/adapter-usage/index-wiring/index-apply 等测试已就位（11 个测试文件，2026-08-18 实跑 **66/66 绿**）；覆盖率核算与缺口项待收尾 |
| **M5** 实机集成验证 | 装 profile 重启，验证：普通任务走 deepseek、@kimi 走 kimi、图片走 kimi；dock 渲染/命令往返/持久化 | 会话日志 request/header 观察路由 | ✅ 通过（2026-08-18 双探针 + 2026-08-19 带图实机闭环，DSH 会话日志解码实锤）：`@kimi` 显式探针、escalateWhen 关键词探针与图片消息的 request/header 均为 `kimi-tide/k3`（ctxWindow=1048576），带图轮正常推进无 UNSUPPORTED_CONTENT——**显式指令升级 ✅、关键词升级 ✅、带图改道 ✅**（锁存已知限制见 §2.3.1）。**余项**：dock 渲染/命令往返/持久化（人工验收） |
| **M6** 文档发布 | README 路由章节 + docs/router 使用手册 + 0.2.x Release | 文档与配置一致 | ⬜ 待办（本 README 与本文档已先行同步代码事实） |
| **M7**（可选）增强 | LLM 分类器、token 精确计费、多主模型、settings UI | 视使用反馈 | ⬜ |

---

## 5. 风险与决策点

| 风险/决策 | 分析 | 决定 |
|-----------|------|------|
| 切换时机 | 工具循环中切换会改变上下文"口音"，且 tool 结果与模型绑定更稳 | 仅每轮首个模型步决策（`payload.step === 1`，71b1d18 修正；工具循环内 step>1 保持已落库配置） ✅ |
| 关键词误判 | "审查"一词出现在普通对话会误升 Kimi（白花钱） | patterns 可配 + 默认集保守 + 预算兜底 |
| token 估算误差 | chars/2 对中文偏保守（实际中文 ~1.5 字/token） | 可配 charsPerToken；M7 换 tokenMeter |
| reasoningEffort 跨模型 | 替换路由后 effort 语义不同 | 替换时丢弃继承 effort，让目标模型用自身默认（参考官方 model-selection 做法） |
| 预算窗口在重启后清零 | 会话级窗口 vs 全局窗口 | v1 进程内全局窗口（简单）；M7 可持久化 |
| DeepSeek 多模态未来支持 | 若 V4 后续版本支持图片，补偿路由变成过度设计 | 检测前查 `resolveModel` 的 `inputModalities`，支持则跳过补偿 |
| 带图会话锁存死锁 | 锁存后会话锁死多模态；k3 额度/Key 失效即无法切文本模型，整会话死锁（2026-08-19 实测，见 §2.3.1） | 锁存非终态方案；根解=图片不进主历史（图像转述 / 子代理图片外包，0.3.x） |

## 6. 验收标准（0.2.x 整体）

1. `mode: off` 下行为与 0.1.x（v0.1.3）完全一致（回归）
2. cost 模式：默认 deepseek；@kimi/长文/审查词任一升级；预算 20% 封顶后降级并记录日志
3. capability 模式：规则表按序匹配，路由结果与表一致
4. **图片消息在任何模式下都路由 kimi**（除非 DeepSeek 模型声明支持图片）
5. 所有路由决策可通过会话 `request/header` 日志追溯
6. 单元测试绿 + 实机 5 分钟手工验证通过
7. README/docs 更新，0.2.x Release 发布
8. 「月汐」dock 面板：用量四区（周配额/5h窗口/会员/本地token）正确渲染并具备 80%/90% 变色；路由设置保存后持久化且重启保持（0.4.0 起为设置命名空间 `kimi-tide-router`，此前为 patch yml/sidecar）；推理状态行显示"已启用"

---

## 7. 与项目其他部分的关系

- **dsh-kimi-bridge**（CLI 桥接，**历史——2026-08-23 归档退役**）：与路由正交——路由决定"哪个模型"，bridge 提供"独立 Kimi agent 会话"；`call_kimi` 本身不受路由影响。其「独立 Kimi 会话/审查」角色已由 @kimi 子代理经 kimi-tide 路由承接，vendored fork 已移出仓库（git 历史保留）
- **协作闭环**：路由器的规则集（审查→kimi）正是本项目实测出的能力矩阵的固化
- **未来路径**（2026-08-19 更新）：
  - **图像转述模式 / 子代理图片外包**：带图会话成本与锁存死锁的根解（见 §2.3.1）
  - **子代理级委托**：DSH 子代理后端的实际扩展点是 **subagents 命名注册表 + host plane opt-in 挂载**（先例：codex/claude-code 后端；此前「等 ACP 子代理机制」的表述不准确）——kimi 子代理后端落地后，capability 路由可扩展为"任务路由给独立 agent"而非仅模型（Open Design 已验证 `kimi acp` 官方协议）
