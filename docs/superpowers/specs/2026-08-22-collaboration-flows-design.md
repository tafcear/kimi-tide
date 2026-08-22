# 0.6.0 协作编排设计（Collaboration Flows）

> 状态：设计定稿待评审（2026-08-22 脑暴 + k3 独立评审 + 用户三裁定 + 架构批准）
> 前置：v0.5.0 规则驱动路由（`2026-08-20-rule-driven-routing-design.md`）、宿主 0.1.1-rc.2 升级（`2026-08-22-host-rc2-upgrade.md`）

## 1. 背景与目标

**问题史**（全部实锤，锚点见 §3）：

1. rc.8 时代：图片进会话历史后文本模型物理无法承接（deepseek 适配器全量序列化逐条 `assertTextOnly`）→ 修复=会话级布尔锁存（沾图整会话锁多模态）。
2. 2026-08-19 实测死锁：k3 额度/Key 失效后会话无法切回文本模型 → 锁存判不可用；当时结论「根解=图片不进主历史」。
3. 2026-08-20 裁定：deepseek 无 vision 端点 + token-plan 网关不透图 → 「图像转述唯一可行」，排 0.5.x 第二迭代。
4. **rc.2 前提重塑（2026-08-22）**：`deepseek-v4-flash-vision-exp` 发布且本机实透图；rc.2 引入 text-only 路由占位投影（不崩但盲答）→ 「转述唯一可行」与「锁存必需」两个旧前提同时失效。

**目标**：把 kimi-tide 从「每步模型路由器」升维为「**用户可编程的双模型协作编排器**」——规则目标从「模型」泛化为「模型 | 协作流（Flow）」，全部经设置页由用户定义；首批发两个内建流：图像转述（transcribe）与评审回路（review）。

**非目标（本迭代不做）**：GUI 缩略图点击回看原图（YAGNI，命令式回看即可）；review 流的自动修订默认关；子代理转述机制（P3，待 S2 spike）；通用 N 模型流水线（超过双模型协作的编排不立项）。

## 2. 用户裁决记录（2026-08-22 本会话定稿）

| # | 裁决 | 内容 |
|---|---|---|
| 1 | 先实测再定姿态 | T1/T2/T3 三探针先行（§3.2），结果落锤后才谈方案 |
| 2 | k3 独立评审 | 派发 k3 子代理评审 A/B/C 三方案；其「转述=post-decide 拦截而非规则 target」等修正已吸收演进为 Flow 抽象 |
| 3 | 省钱预设姿态 | 带图 → 多模态转述 → 文字回主（文本）模型作答（eager 转述） |
| 4 | 能力预设姿态 | 带图 → 直切多模态模型（原生视觉，现状语义） |
| 5 | 规则全部进设置页 | 流注册表 + 规则目标选择，用户可增改，含评审回路 |
| 6 | 评审回路产品化 | 一模型产出、另一模型评审的协作回路成为内建流（非仅关键词路由） |
| 7 | 范围 | 直接做通用编排器；图像处理是第一个流类型 |
| 8 | 转述机制 | 两阶段：直调转述 MVP（P1）+ 子代理形态 spike（S2）可行则二期替换（P3） |
| 9 | 架构批准 | 2026-08-22 用户「可以」批准：Flow 抽象 / 按图三态替代布尔锁存 / 分期 P0–P3 / T4 验收门 |

（裁决 3/4/9 隐含采纳：按图锁存姿态 C、盲态指示全模式显示、原图可达 MVP=命令式、T4 作为 eager 转述的验收门。）

## 3. 调研事实（设计依据，全部带锚点）

### 3.1 宿主契约（rc.2 本机安装实读）

- **占位投影**：`dsh-llm/lib/index.js:685` `projectImagesForTextModel`——对 text-only 目标把请求内图块替换为占位文本（返回浅拷贝，**持久历史不动**）；占位原文（:592-594）= `[image omitted because this model accepts text only; attachment sha256:<8位>]`，**零内容**。
- **附件句柄**：`requestImageHandleText`（:600-602）证明宿主为请求图生成「attachmentId + 尺寸」的模型面向句柄；附件按 ID 持久化，`attachments` 服务 / `read_image` 工具可按引用读回字节（kimi-tide b66ee0d 适配器路径已用 `ctx.get('attachments')`）。**原图天然可达，无需自建图床。**
- **vision-exp 目录**：`dsh-llm-deepseek/lib/index.js:1604-1610`——`deepseek-v4-flash-vision-exp`，`inputModalities:["text","image"]`，`imagePixelBudget`/`imageMaxBytes` 齐备；Config 含 `maxRequestFilesBytes`/`maxInlineRequestImageBytes`（:1638-1639，Files API 管道 + inline 兜底）。
- **图像准入探针**：`dsh-host-apiproxy/lib/index.js:2765`（本地补丁，官方从无）——`agent/image-admission` serial bail 认领放行；无认领维持原拒绝（上游逐字节行为）。
- **现有护栏**：kimi-tide `src/router.ts` `applyImageGuard`（84773e2 起模型级判定：目标模型自身 modalities 为准，目录读不到的目标保持宽容不改道）。
- **现有锁存**：`src/router.ts:220` `imageSeen WeakMap<Agent, boolean>`；`rules.ts:41-49` `matchingRules` 的 `kind: image` 以 `hasImage`（本轮消息含图 || 锁存）触发。

### 3.2 本机实测（2026-08-22，用户配合）

| 探针 | 内容 | 结果 |
|---|---|---|
| T1 | GUI 选 `deepseek-official/deepseek-v4-flash-vision-exp` 附架构图提问 | ✅ 透图成功，模型正确描述图内容——「网关不透图」旧结论失效 |
| T2 | k3 以「逐字保留文字+结构关系+关键视觉细节」提示词转述 1440×900 架构图 | ✅ 文字近乎逐字、链路完整；丢失颜色/像素级位置——架构讨论够用，UI 像素级不够 |
| T3 | 占位符原文实读 | ✅ 仅 sha256 句柄，文本模型对历史图必然盲答 |

### 3.3 计费路径事实

- 本机 `settings.yaml` 无 `llm-deepseek` 配置节 → `deepseek-official` 走适配器默认端点（官方 API，非 token-plan 网关）；T1 成功即官方账户凭据存在的旁证。**vision-exp 调用计入官方 DeepSeek 账户，不占 token-plan 额度**（用户升级时已知晓，验收时复核账单口径）。
- Kimi 订阅为时间窗口额度（五小时/周）：图像轮从 k3 改挂 vision-exp 是**结构性省钱**（释放 Kimi 额度窗口），非单纯 token 比价。

### 3.4 k3 独立评审结论（2026-08-22 子代理，已逐条对照源码验证）

- 采纳：转述与路由分维（流≠规则目标的模型字段）；转述开关默认保守；T4 实测缺口（截图报错转述未验证）；vision-exp 计费未验证（§3.3 已补通路事实）。
- 纠偏：其「原图可达需自建 imageRef 图床（复杂度爆炸）」不成立——§3.1 附件存储实锤宿主已持久化，命令式回看零新建设施。
- 架构深化（超越评审 C'）：转述不动持久历史，做**投影层替换**（沿用 rc.2 `projectImagesForTextModel` 同款姿势：请求浅拷贝替换，持久历史保原图）。

## 4. 配置形状 v5

```yaml
kimi-tide-router:
  version: 5
  activePreset: capability
  presets:
    saving:
      name: 省钱
      default: { provider: deepseek-official, model: deepseek-v4-flash }
      rules:
        - id: image-transcribe
          when: { kind: image }
          target: { flow: transcribe }            # ← Flow 引用
        - id: code-pro
          when: { kind: keywords, group: code }
          target: { provider: deepseek-official, model: deepseek-v4-pro }
    capability:
      name: 能力
      default: { provider: kimi-coding, model: k3 }
      imageFallback: latch                        # ← 新增：native 图像后文本轮姿态
      imageFallbackFlow: transcribe               # ← imageFallback=transcribe-lazy 时指定用哪个流（默认预置 transcribe）
      rules:
        - id: image-k3
          when: { kind: image }
          target: { provider: kimi-coding, model: k3 }
  flows:                                          # ← 新增：协作流注册表
    transcribe:
      type: transcribe
      visionModel: { provider: deepseek-official, model: deepseek-v4-flash-vision-exp }
      failurePolicy: latch-image                  # latch-image | blind
    review:
      type: review
      reviewer: { provider: kimi-coding, model: k3 }
      trigger: manual                             # manual | keywords
      keywordGroup: null                          # trigger=keywords 时引用 keywordGroups 键
      rounds: 1
      autoRevise: false
  keywordGroups: { ... }                          # v4 沿用
```

**Schema 要点**：

- `rules[].target` 并集：`{ provider, model }`（v4 原样）| `{ flow: string }`（引用 `flows` 键，必须存在否则该规则视为不可用目标按 §5.3 语义跳过）。
- `presets[].imageFallback`：`'latch' | 'blind' | 'transcribe-lazy'`，**默认 `latch`**（=0.5.0 现状语义，迁移行为保持）。
- `presets[].imageFallbackFlow`：`imageFallback: transcribe-lazy` 时指定转述流引用（flows 键），默认指向预置 `transcribe` 流。
- `TranscribeFlow`：`{ type, visionModel: {provider,model}, failurePolicy: 'latch-image'|'blind' }`。
- `ReviewFlow`：`{ type, reviewer, trigger, keywordGroup?, rounds: 1..3, autoRevise }`。
- 预置：新装默认注册 `transcribe`（vision-exp）与 `review`（k3, manual）两个流；**存量迁移不改动任何既有规则目标**（见 §6）。

## 5. 编排引擎设计

### 5.1 决策流程（`decide` 扩展，不重写）

v4 决策序不变：显式@ → 规则链首命中 → 预设默认。扩展点：

1. 规则目标解析为 `{ flow }` 时，决策结果携带 `flowId`；执行层按流类型分派。
2. `hasImage` 语义改：**本轮消息含「未转述」图**（attachmentId 不在转述缓存）——布尔锁存 `imageSeen` 退役，替换为按 agent 的**按图状态表** `Map<attachmentId, 'native'|'transcribed'|'blind'>`。
3. `imageFallback` 介入点：decide 命中预设默认（无规则命中）且目标为 text-only 且历史存在 `native` 态图时——
   - `latch`：改道到该图 native 化时的视觉目标（规则命中的模型目标，或转述流的 `visionModel`；多图取最近 native 图的生效目标；=0.5.0 语义的精细化）；
   - `blind`：放行文本目标，投影层占位（用户显式选择便宜+盲）；
   - `transcribe-lazy`：先经 `imageFallbackFlow` 指定的流触发 §5.2 转述（lazy），成功后放行文本目标（投影层供转述文字），失败按该流的 `failurePolicy`。

### 5.2 transcribe 流（eager = 规则目标；lazy = imageFallback）

**eager（省钱姿态，裁决 3）**：pre-step 检出本轮新图 → 直调 `visionModel` 一次性转述（提示词策略=§5.5）→ 写缓存（attachmentId→文字）→ 以「图已转述」状态重跑 decide：image 规则不再命中（图已文字化）→ 落预设默认文本模型作答，模型面向请求中图块被转述文字替换（§5.4 投影缝）。

**lazy（能力预设可选切回助手）**：带图轮原生视觉作答不动；仅当后续文本轮将面对 native 态历史图时补转述。一次转述费买「不盲的切回」。

**不变量**：
- 一图一转述（attachmentId 缓存，图不可变故无失效问题）；重试只在无缓存或缓存标记失败时发生。
- 转述失败：`failurePolicy: latch-image` → 该图保持 native，后续文本轮按 latch 继续走视觉（按图锁存，不拖累其他图）；`blind` → 该图标 blind，后续占位盲答。
- 原图永不删：持久历史保原图，用户说「看原图/重新看图」→ 该轮强制 native（重挂原图走视觉目标）。

### 5.3 review 流（评审回路，裁决 6）

- **触发**：`manual`=`/kimi-tide review` 命令（MVP 唯一）；`keywords`=用户消息命中指定关键词组（P2）。
- **执行**（依赖 S3 缝）：主模型 turn 完成 → 编排器向 `reviewer` 发起评审调用（输入=本轮产出+评审指令模板）→ 评审意见作为**可见后续消息**进会话（标注来源流与评审模型）。
- **防环路**：`rounds` 上限（默认 1）；评审消息自身永不触发 review；`autoRevise: false` 时流程止于意见呈现。
- **降级**：S3 缝若 spike 不通过，MVP 退化为命令派发子代理评审（报告回主会话）——机制现成但可观测形态不同，spec 内注明。

### 5.4 智能投影缝（S4；S1/S4 源码取证已落锤 2026-08-22）

目标语义：text-only 目标的请求中，已转述图块 → 转述文字；未转述图块 → rc.2 原生占位（行为不变）。

- **S4a（原首选，已证伪）**：`agent/request` waterfall 载荷仅 `{ turn, step, signal }`，链终值为 `{provider, model, reasoningEffort?, maxTokens?}` 配置对象（dsh-agent-loop lib/index.js:708-714，返回配置直接进 `llm.prepareCall`）——**消息不经过该瀑布，不可改写**。
- **S4c（新首选）**：`llm/stream` 瀑布拦截——`LlmRuntime.streamWithRegistration` 以 `ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared))` 包裹**完整请求（含 messages）**（dsh-llm lib/index.js:1636-1641），且原生 text-only 投影在瀑布之后的 `adapterStream` 内执行（:1585-1591）→ 拦截器把已转述图块替换为文本块后放行，原生投影对剩余 native 图照旧兜底。待 spike 验证：cordis waterfall 的 `next(修改后载荷)` 语义；不支持则带重入守卫自调 `ctx.llm.stream`。
- **S4b（兜底）**：持久追加——经 session 服务把转述作为「上下文注记」消息 append 进历史（原图仍在）。代价：转述成为持久历史（进导出/压缩）。

缝裁决：S4c spike 通过则用 S4c；否则 S4b；皆不可行则 transcribe 流降级为「命令式手动转述」。

### 5.5 转述提示词策略（内建默认，flows.transcribe 可覆盖）

T2 实证基线：「逐字保留图中全部文字 + 结构关系 + 关键视觉细节；供看不到图的文本模型接力；不确定处标注」。对报错截图追加：堆栈帧逐字、行号、高亮/颜色语义。T4 验收门实测此策略对报错截图的可用性。

### 5.6 护栏优先级（与 84773e2 的交互，必须写死）

- 规则目标=模型：护栏行为与 0.5.0 完全一致（text-only 目标+带图 → 改道多模态意图序）。
- 规则目标=`flow:transcribe`：护栏**放行**（流接管图像处理，不再改道）。
- `imageFallback=transcribe-lazy` 触发中：护栏对「将被转述的图」放行。
- 目录读不到 modalities 的目标保持宽容（84773e2 既有条款，不变）。

### 5.7 显式 @指令

显式 @provider/model 永远最高优先，跳过一切流与 fallback（与 v4 语义一致）；显式带图 @text-only 模型仍按护栏改道（安全轨不随流关闭）。

## 6. 迁移设计（v4 → v5）

- **语义映射**：`version: 4→5`；既有预设/规则/关键词组**逐字保留**（含 image→k3 等既有目标，不自动改挂流）；新增 `imageFallback: 'latch'`（默认=现状）；注册两个预置流（transcribe/review）为**可用但未绑定**。
- **行为保持**：迁移后路由行为与 0.5.0 逐字节一致；用户经设置页把 image 规则改挂 `flow:transcribe` 才启用新姿态。
- **链路与留档**：沿用 v3→v4 链路——settings 命名空间写前 `settings.yaml.pre-v5` 留档 + sidecar 写回；迁移事件上面板。
- **schema 兼容**：schemastery 注入/透传三行为（2026-08-21 避坑在案）——`flows`/`imageFallback` 用「无 default 的 union」存在即校验、缺失即省略；行为探测测试先行。

## 7. 设置 UI（SettingsCard 扩展）

- 规则编辑器 target 选择器：模型下拉（现状）+ 「协作流」分组（列出 flows 注册表，标类型徽标）。
- 新增「协作流」手风琴区：流列表（类型/目标模型/timing/触发），每流可编辑参数；预置流可改不可删（防规则悬空）；自建流可删（删前检查规则引用）。
- 每预设 `imageFallback` 三态选择（锁存/盲答/懒转述），带一句话后果提示。
- 全部写路径过宿主 validate-on-write（每条写后中间态必须合法——2026-08-21 避坑：删流先清引用）。

## 8. 决策可观测（dock / projection）

- 面板新增「图像上下文」行：`N 张图（native a / transcribed b / blind c）`；**blind>0 为警示态，全模式显示**（不受「cost 不显示决策」条款约束——那是安全指示不是决策 trace）。
- 流执行事件进投影：转述（attachmentId 短哈希、visionModel、成败）、review 派发（reviewer、轮次）。
- dock chip 维持逐步路由显示（capability 模式现状）。

## 9. 命令族

- `/kimi-tide review`——对上一轮产出触发 review 流（随 review 流 P2 交付；触发形态以 S3 spike 结果为准：命令或面板按钮）。
- `/kimi-tide show` 输出补 flows 注册表与图像上下文状态。
- 现有 set/import-config 等命令族兼容 v5 字段。

## 10. 测试设计

- **单测**：v5 schema（探测测试先行）/ migrateV4 行为保持 / 规则 target 并集解析（flow 引用存在性）/ 按图状态表三态迁移 / 转述缓存（一图一次、失败标记）/ 护栏优先级四条款 / imageFallback 三态 / review 防环路（rounds 上限、评审消息不触发）。
- **集成**：pre-step+request 双钩子接线（mock llm 服务断言转述调用与消息替换）；TDD 红绿纪律不变。
- **夹具纪律**：转述器 mock 夹具按 T2 真实输出形态写；报错截图夹具待 T4 实机抓取（禁假设形状——2026-08-20 避坑）。
- **T4 验收门（eager 转述可用性）**：真实报错截图 → vision-exp 转述 → 文本模型仅凭转述文字诊断 → 诊断结论可用（用户目检）方算过；不过则省钱预设 image 规则退回 latch 默认，eager 转述标 experimental。

## 11. 实机验收（实施后，用户重启 dsh web）

1. v4→v5 迁移留档（`.pre-v5`）+ 行为保持（迁移前后同输入同路由）。
2. 设置页流注册表可见可编；image 规则改挂 transcribe 流并保存生效。
3. eager：带图消息 → 转述事件上面板 → 文本模型作答含图信息（非盲答）。
4. 切回：转述完成后下一轮文本消息 → 路由回文本模型且面板图像上下文行 transcribed=1。
5. `imageFallback=latch`：native 图后文本轮仍走视觉（按图锁存实锤）。
6. `blind`：文本轮占位盲答 + 警示态显示。
7. 「看原图」：该轮重挂原图走视觉（会话日志 request/header 实锤）。
8. T4 门（§10）。
9. review 命令：评审意见可见进会话、rounds 上限生效。（P2 落地后）
10. 计费复核：vision-exp 调用出现在官方 DeepSeek 账户账单（用户自查）。

## 12. 发布范围与版本

- **P0**：S1–S4 spike（只验证契约，不交付功能；结果回写本 spec §16）。
- **P1 = 0.6.0**：config v5 + transcribe 流（直调 eager/lazy）+ 按图状态表退役布尔锁存 + 设置 UI + 面板行 + T4 门。
- **P2 = 0.6.x**：review 流（manual 先行）、`/kimi-tide review`。
- **P3 = 0.6.x**：子代理转述机制（S2 通过则做，替换/并存由用户配置）。

## 13. 风险与边界

| 风险 | 缓解 |
|---|---|
| review 自动触发额度失控 | 默认 manual + rounds=1 + 评审消息不触发评审 |
| eager 首答质量=转述质量 | T4 验收门；不过则退回 latch 默认 |
| S4 双缝皆不可行 | 降级为命令式手动转述（§5.4） |
| v5 迁移破坏存量 | 行为保持映射 + `.pre-v5` 留档 + schema 探测测试 |
| vision-exp 计费口径（官方账户非 token-plan） | §3.3 已披露；验收项 10 用户复核 |
| 转述缓存与压缩交互 | 缓存按 attachmentId 存插件侧（非历史内），宿主压缩走原生路径不受影响 |
| tool-result 嵌套图 | 转述/投影递归走 `contentHasImage` 同款遍历（dsh-llm:611-613 先例）；覆盖不到则该图按 native 处理 |

## 14. 待核实项（spike 清单，P0 先行验证）

| # | 契约 | 验证方法 |
|---|---|---|
| S1 | 插件经 ctx.llm 发起一次性带图调用 | **✅ PASS（2026-08-22 活体 spike，`../spikes/2026-08-22-collab-flows-s1-s4c.md`）**：attachments.saveImage → ImageAttachmentRef → `ctx.llm.stream` 带图调 vision-exp 答「red」；text-delta 形态 `{index,text}`；vision-exp 默认开推理（生产调用需显式 reasoningEffort） |
| S2 | 插件代码编程式派发子代理并同步取结果 | **✅ GO（2026-08-22 Inspect 契约，`../spikes/2026-08-22-collab-flows-s2-s3.md`）**：`ctx.subagents.start(name, request)` 一次性派发（parent 由 pre-step payload.agent 供给）+ `subagent/end` 事件回收；P3 可行 |
| S3 | turn 结束事件 + 编程式追加可见消息 | **✅ GO（同上）**：`agent/turn-stopping`（serial）为轮末挂点；注入双通路=A 面板卡（session.append+投影，零模型成本，kimi-tide 既有机制）/B inbox 注入（新轮=autoRevise 语义，Agent inbox API 形态留 P2 设计时实读） |
| S4 | 智能投影缝 | **✅ PASS（S4c，同上报告）**：S4a 证伪（agent/request 瀑布无消息）；S4c=llm/stream 短路自派实证（标记改写到达适配器，重入守卫恰好一次）；约束=loop 请求深冻结只读 + cordis next() 回放原参（cordis lib:317-325） |
| S5 | vision-exp 图像定价/token 计耗 | 用户 DeepSeek 官方控制台查 T1 调用账单（人工项）；spike 流含 `usage` chunk 可程序取数 |
