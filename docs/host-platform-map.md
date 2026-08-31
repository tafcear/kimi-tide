> ✅ 本调研文档实际执行者 = **Kimi k3**（父代解码会话日志：`request/header → kimi-tide/k3`，ctxWindow=1048576）。注：子代理 system prompt 的 `{{model}}` 显示为基础默认模型 deepseek-v4-flash，与实际路由后模型不一致——**模型自述身份不可靠，真身以会话日志 request/header 为准**。文中结论均以实读源码为准。

# DSH 宿主平台契约调研（host-platform-map）

> 📌 这是内部/存档文档，面向维护者与研究者。新读者请从仓库根 [README](../README.md) 开始。

- 调研日期：2026-08-20
- 复核日期：2026-08-22（rc.2 事实锚点更新）
- 调研对象：本地 DSH 安装 `C:\Users\tafce\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`（下称 `$DSH`，各包根为 `$DSH/node_modules/@deepseek-ai/<pkg>`，只有 `lib/` 编译产物 .js/.d.ts）；GitHub 仓库 `deepseek-ai/deepseek-harness`（master）用于补查本地没有源码的内容。
- 锚点约定：`包名/lib/文件:行号` 指 `$DSH/node_modules/@deepseek-ai/包名/lib/文件` 的绝对行号（实读验证）；`README` 锚点指包根 README.md 行号。

---

## 一、契约（事件与接口语义）

### 1.1 `agent/pre-step`（waterfall）

- 签名：`'agent/pre-step'(this: Scoped<Agent>, payload: { agent, messages: UserMessage[], turn, step, signal }, next): Promise<PreStepDecision>`；决策 `kind: "enter" | "reject"`，enter 可替换进入该步的 messages。锚点：dsh-tool-cordis/lib/index.js:3448-3458。
- 触发位置：agent-loop `preStep()` 内，先 `inbox.claim(target, position.turn)` 再 dispatch；payload.messages 即 **claimed**（仅本轮新入箱的消息，不含会话历史）。锚点：dsh-agent-loop/lib/index.js:496（claim）、501-508（waterfall + 默认决策）。
- **step 语义**：`turn()` 中 `const step = phase.step + 1`（dsh-agent-loop/lib/index.js:533），每进入一个新 turn 的 finally 段 `phase.step = 0`（L603）→ **每 turn 首步恒 step=1**。首步分支（target="next-turn"）与续步（"next-step"）走同一 preStep。锚点：dsh-agent-loop/lib/index.js:516-604。
- **坑（实锤）**：pre-step 的 messages=claimed 只含本轮，监听者**看不到历史消息**——路由器若用本轮消息判断「会话是否含图」必然漏判（这正是 kimi-tide 锁存方案的存在理由）。锚点同上 L496/L502；历史出处：协作日志 2026-08-19「带图会话锁存修复」条目。

### 1.2 `agent/request`（waterfall）

- 签名：`'agent/request'(this: Scoped<Agent>, payload: { agent, turn, step, signal }, next): Promise<LlmCallConfig>`；`await next()` 产出宿主本来要用的 config（首次请求取 agent options，之后取日志 request/header），返回替换值即改道；**payload 不含消息**。锚点：dsh-tool-cordis/lib/index.js:3459-3468；调用点 dsh-agent-loop/lib/index.js:685-691。
- 约束：返回的 config 必须带 provider+model，否则抛错（L691）；随后经 `ctx.llm.prepareCall(proposedConfig)` 绑定适配器并实例化默认值（L695-699）；**只能换 provider/model/reasoningEffort/maxTokens 等 LlmCallConfig 字段，不能改消息**（消息须走 logged channels，dsh-tool-cordis L3464 描述）。

### 1.3 `agent/image-admission`（serial，本地补丁探针）

- **官方包从未包含该探针**：rc.8 官方 tarball（npm pack）grep `image-admission` 零命中，rc.2 亦然——本机探针 = **2026-08-18 HOTFIX 本地补丁**，08-20 重打 rc.8，**08-22 已重打 rc.2**。
- rc.2 上游代码 = 直接拒绝（无探针）：`dsh-host-apiproxy/lib/index.js:2755-2759`（`inputModalities` 不含 image 即 `attachment-error / MODEL_DOES_NOT_SUPPORT_IMAGES`）。
- rc.2 补丁后：探针在 `dsh-host-apiproxy/lib/index.js:2765`（`ctx.serial(agentCarrier(agent), "agent/image-admission", …)`，bail 语义不变：无认领才拒绝）；补丁导入 `agentCarrier` 自 `@deepseek-ai/dsh-agent`（rc.2 仍导出：`dsh-agent/lib/index.js:323` 定义、`L794` 导出表）。
- 准入串行化 `serializeImageAdmission` 仍在：`dsh-host-apiproxy/lib/index.js:1675`、调用点 L2600/L2797（补丁后行号）。
- 备份与哈希：`.dsh-rc2-upgrade\`（rc8-patched / rc2-orig / patched-live 三份 SHA256，MANIFEST.txt）。
- 语义冒烟：node --check PASS、探针 ×1、与原版 diff 恰 +21/-6 两 hunk。
- **时序坑**：该探针（补丁后）在**消息入 agent 循环之前**、按**当前选中模型**（非路由器的 per-step 决策）执行——默认模型为 text-only 的新会话附图会被先拦，必须由 image-admission 监听者先 bail 才能进入循环让路由器改道。带图 prompt 还经 `serializeImageAdmission`（per-agent WeakMap 链）串行化。锚点：L2765（探针调用，补丁后）、L1675（串行链定义）、L2600/L2797（调用点，补丁后）。

### 1.4 生命周期与通知事件

- `agent/created`：payload `{ agent }`，agent 注册进注册表后恰好发一次；scoped 分发（agent-scoped listener 只收到该 agent）。锚点：dsh-agent/lib/index.js:668；签名 dsh-agent/lib/types/runtime-types.d.ts:146。
- `agent/disposed`：payload `{ agent }`，确切 agent 离开注册表时发；AgentLoop 在驱动器停稳后发。锚点：dsh-agent/lib/index.js:641；README.md:51。
- `agent/session-start`：emit，`{ agent, source }`，首个受支持的启动注入点（不可 veto）。锚点：dsh-tool-cordis/lib/index.js:3482-3491。
- `agent/turn-stopping`（serial）：turn 即将关闭、模型无未决义务时发，监听者可 steer 阻止关轮。锚点：dsh-tool-cordis/lib/index.js:3504-3512；调用点 dsh-agent-loop/lib/index.js:565。
- `agent/request-error`（waterfall）：一次模型请求失败后、重试或关步之前；返回 `{kind:'retry'}` 接管恢复。锚点：dsh-tool-cordis/lib/index.js:3470-3479。
- `llm/adapters-updated`：emit、无 payload；适配器路由注册/dispose/replace、可配置目录变更后发，消费方应重读 `listProviders()/listModels()` 而非轮询。锚点：dsh-llm/lib/index.js:958、1035-1046（commitRoutes 内发）；README.md:33。
- `settings/updated`：`(ns, next, prev, source)`；仅在 resolved 值实际变化时发（deep-equal 门控，invariant 强制）。锚点：dsh-settings/lib/index.js:562；dsh-settings/lib/invariant.js:164-170。
- `settings/document-updated`：`(ns, revision)`；RAW user 分节变化即发（即使 resolved 不变），供配置 UI 识别「从继承变为覆盖」且 revision 过期。锚点：dsh-settings/lib/index.js:522-531；dsh-tool-cordis/lib/index.js:3759-3763。
- `connection/reset`：client 侧事件，连接重连时发出，UI 组件普遍据此重拉。锚点：dsh-client-runtime/lib/client.js:10490；消费例 dsh-client-ui-model-selection/lib/client.js:172。
- `subagent/start` / `subagent/end`：scoped emit，分别携带 `SubagentRunInfo` / `SubagentRunEndInfo`（含 provider/runId/id/parent 等）；invariant 强制成对且身份一致。锚点：dsh-tool-cordis/lib/index.js:3806-3843；dsh-subagent/lib/invariant.js:34-44。
- `skills/change`：emit 无 payload；skill 目录失效时发（注册/注销、provider invalidate）。锚点：dsh-skill/lib/index.js:403-412。
- `agent-preset/selected`：非 scoped 宿主事件 `(sessionId, agentPreset)`，blank 会话 preset 切换提交后由服务重发。锚点：dsh-agent-presets/lib/index.js:869-870；README.md:45。
- **`credentials/reference-updated`**（rc.2 新增，拆分自 `credentials/updated`）：provider-managed source 变更后发射，供配置 UI 刷新「已配置」标识。原 `credentials/updated` 退役。锚点：dsh-credentials/README.md:49；转发表 dsh-api-remotes/lib/types/remote-events.d.ts:16（`API_REMOTE_FORWARDED_EVENTS` 含 `credentials/reference-updated`，不含原 `credentials/updated`）。

### 1.5 LLM 适配器接口（`ctx.llm`）

- `ctx.llm.registerAdapter(providers: string[], adapter: LlmAdapter)`：注册即生效；路由冲突抛 `DUPLICATE_ADAPTER`；返回 handle（同时是 disposer），`handle.replace(nextProviders)` 原子换路由。锚点：dsh-llm/lib/index.js:985-1004、1010-1030。
- LlmAdapter 基类方法：`providerInfo(provider)`、`providerRetryPolicy(provider)`、`listModels(provider)`（默认返回 []）、`resolveModel(provider, model, signal)`。锚点：dsh-llm/lib/index.js:899-926；类型 dsh-llm/lib/types/index.d.ts:109-152。
- **`listModelIds` 不存在**：宿主只有 `listModels(provider)`（返回 `LlmModelInfo[]`：provider/id/name/description?/inputModalities?）。kimi-tide 若有按 id 列举的逻辑须自建映射。锚点：dsh-llm/lib/index.js:1183-1198（全库 grep 无 listModelIds）。
- `resolveModelInfo(provider, model, signal?)` → `LlmResolvedModelInfo`：**含 `inputModalities?: readonly ModelModality[]`、`context?: { contextWindow }`、`defaultMaxTokens?`、`reasoning?: { efforts, defaultEffort? }`**；context 非正整数抛 `INVALID_MODEL_CONTEXT`。锚点：dsh-llm/lib/index.js:1208-1250；类型 dsh-llm/lib/types/types.d.ts:214-258。
- `prepareCall(config, signal?)` → `{ config, retryPolicy, adapterDefaults, context?, stream }`；一次性（二次 dispatch 抛 `INVALID_PREPARED_CALL`），绑定当时的注册（HMR 不会跨适配器拼状态）。锚点：dsh-llm/lib/index.js:1298-1323。agent-loop buildRequest 正是用它冻结每步请求（dsh-agent-loop/lib/index.js:695-707）。
- **rc.2 增量——`prepareCall` 捕获 modalities 元数据并绑定适配器 dispatch generation**：HMR/动态设置不能跨代拼图像能力与端点（dsh-llm README.md:28-41）。
- **rc.2 增量——`offloadRequestImagesWithPolicy()`**：确定性最老先出图像卸载（raw/base64 计量，count/byte 配额）。锚点：dsh-llm/lib/index.js:722。
- **rc.2 增量——ContentBlockMap 核心块集新增 `image`**（ImageBlock 只带 durable ImageAttachmentRef）；text-only 路由收**确定性附件占位文本**（含嵌套 tool-result 图），append-only 历史不变。锚点：dsh-llm README.md:58-60。
- 其他注册表：`registerConfigurableProviders(entries)`（声明可被设置页配置的 provider 目录，settingsNs+settingsPath）、`registerModelDiscovery(settingsNs, discover)`（端点探活列模型）。锚点：dsh-llm/lib/index.js:1062-1136。

### 1.6 已知坑汇总（kimi-tide 历史踩坑 ↔ 宿主事实）

| 坑 | 宿主事实 | 锚点 |
|---|---|---|
| step 门控误读：以为 step 全局递增 | 每 turn 首步恒 `step=1`（turn 结束 `phase.step=0`，preStep 前 `step=phase.step+1`） | dsh-agent-loop/lib/index.js:533、603 |
| pre-step 看不到历史 | payload.messages = 本轮 claimed，不含历史 | dsh-agent-loop/lib/index.js:496、502 |
| ~~「带图轮走 k3、后续文本轮回 deepseek」物理不可行~~ | **前提已于 rc.2 失效**——运行时对 text-only 路由预投影占位符，适配器不再收到 image block（dsh-llm/pi-ai README 互证）；deepseek 适配器 `assertTextOnly` 仍在（dsh-llm-deepseek/lib/index.js:46-47、51、136）但仅作兜底安全网。**锁存暂留（本次升级为行为保持），退役列入后续迭代** | dsh-llm/lib/index.js:685（`projectImagesForTextModel`） |
| image-admission 时序 | 探针系**本地补丁（官方从无）**，rc.2 已重移植；时序语义不变：在消息入 agent 循环**之前**，按当前选中模型判定；路由器必须先 bail 再改道 | dsh-host-apiproxy/lib/index.js:2755-2759（上游拒绝）、L2765（补丁后探针） |
| per-agent 锁存（imageSeen WeakMap）合理性 | 正确性优先的唯一可行解：图片一旦入历史，该会话任何文本轮都不能回 text-only 模型（历史回放必炸）；与官方 pi-ai README 的同一判断互证（over-claim 模态 → 消息 durable 后不可回收） | dsh-llm-pi-ai/README.md:199（Known Limitations） |
| ~~插件改 `agent/request` 返回即可路由~~ | **rc.2 失效**：宿主 `installModelSelection`（agent 创建时注册的 agent/request 覆盖监听器）把 provider/model 覆盖回会话选定模型；插件监听器须 `{prepend:true}` 恒为瀑布最外层，否则路由返回值被外层覆盖丢弃（0.6.0 验收实锤，详见 §4.7） | dsh-host-apiproxy/lib/index.js:1692-1715、cordis lib/index.js:317-325 |
| 动态插件注册带函数字段的工具 | ToolDefinition 的函数字段泄漏进 tools 数组 → `request/header` 会话事件带非 JSON 数据 → 整轮失败「carries non-JSON-serializable data」（诊断优先 console.log，勿用工具探针） | dsh-session types/index.js:492 |

---

## 二、机制（服务与注册表）

> **rc.2 实测标注**：以下各节 rc.8→rc.2 仅 package.json+README 变化（逐文件哈希 diff 实证），既有锚点全部有效，不再重复行号。

### 2.1 `ctx.skills`（dsh-skill）——分层注册表

- 结构：`ScopedLayers`——global 层 + per-scope 层（scope 即 ScopeKey，agent 是一种 scope）；scoped ctx（如 preset standing mount）注册进自己那层，unscoped 注册进 global。锚点：dsh-skill/lib/index.js:122-124（layers）、137-146（registerProvider 注释）。
- API：`registerProvider(create)`（provider 工厂，含 invalidate 控制；同名/保留名抛错；fiber dispose 自动注销）、`register(skill)`（runtime skill；同层同名 **first-wins**，重复者 warn + 返回 no-op disposer）、`list(options)`、`snapshot(options)`（`{skills, complete}`）、`get(name, options)`。锚点：dsh-skill/lib/index.js:147-215、224-264。
- 跨层胜出规则：`collectFresh` 按 `[global, ...chainLayers(scope)]` 顺序合并，**后写覆盖**（`merged.set`），即离 agent 最近的层胜出；同层内 provider 按注册序 + localOrder 排序，同名先者胜（warn 跳过后者）。锚点：dsh-skill/lib/index.js:298-325、331-370。
- invocation 策略：`invocation.modelInvocable` / `invocation.userInvocable`，register 缺省均为 true。锚点：dsh-skill/lib/index.js:38-46、203-206；类型 dsh-skill/lib/types/index.d.ts:39-41。
- `customSkillDirs`：属 **dsh-skill-filesystem**（文件系统 skill provider）的配置项，`Config.customSkillDirs: string[]`（默认 `[]`），扫描顺序 = 项目根 → customSkillDirs → 用户根；`includeDefaultRoots`（默认 true）可关默认根。锚点：dsh-skill-filesystem/lib/index.js:36、79、166；README.md:18-21。
- tool-skill 的 pre-step 注入：dsh-tool-skill 挂 `agent/pre-step`，用 sha256 digest（`digestCatalogEntries`，覆盖 name+description 对）比对历史中最后一条 `skill-catalog` 消息，digest 变化才把完整 `<available_skills>` 目录作为持久 user 消息注入；snapshot 不完整时不发、保留下次重试。锚点：dsh-tool-skill/lib/index.js:146、181、197-204、279-281、315-321；README.md:13、39。

### 2.2 `ctx.settings`（dsh-settings）

- `register(ns, schema, options?)`：`options.base` 为组合基底层，`options.validate` 为额外校验；返回注册作用域（含 get/watch/update/replace——宿主面），resolved 值 = schema 默认值 → base → user 层三层合并。锚点：dsh-settings/lib/index.js:311-326、504-510；类型 dsh-settings/lib/types/index.d.ts:222-228。
- 持久化：dsh-settings-file 提供文件后端，默认 `<dshHome>/settings.yaml`（可配 path/.json）。锚点：dsh-settings-file/lib/index.js:26-31、68。
- 并发控制：写操作（update/replace/mutate）可带 `expectedRevision`，不匹配抛 `SettingsConflictError`（携带 expected/actual 两个 revision）。锚点：dsh-settings/lib/index.js:120-130、456。
- 浏览器侧不写宿主 ctx.settings，而是 **dsh-client-ui-settings 的 `ctx.settingsScope.bind({namespace, ...})`**：经 remote 走 `settings.describe/update/mutate` RPC（apiproxy settings 域），监听转发的 `settings/document-updated` + `connection/reset` 重读。锚点：dsh-client-ui-settings/README.md:5-7；settingsScope 服务注册 dsh-client-ui-settings/lib/client.js:195。
- apiproxy 写入语义：`settings.update/replace` 写 user 层；`settings.mutate` 对已有分节做路径 op（set/unset），是持有脱敏视图客户端的删除路径；secret 字段（`role('secret')`）永不出现在任何响应层。锚点：dsh-host-apiproxy/README.md:61。

### 2.3 `ctx.agentPresets`（dsh-agent-presets）

- preset = 一个目录，内含 `agent.cordis.yml`（组合文件，常量 COMPOSITION_FILE）+ 可选 `preset.yml`（METADATA_FILE，只含展示 name/description）；id = 目录名，须匹配 `[a-z0-9][a-z0-9-]*`。锚点：dsh-agent-presets/lib/index.js:32、146；README.md:5、73-82。
- 发现根：`config.roots`（有序，先者胜重名）+ `includeUserRoot`（默认 true）追加 `<dshHome>/.agent-presets`（USER_PRESET_DIR）。锚点：README.md:86-100；dsh-agent-presets/lib/index.js:160。
- API：`defaultId`、`list()`（含 broken 行）、`resolve(id?)`、`mount(agentCtx, id?)`、`composeFrom(agentCtx, parentCtx)`（子代理绑定父 preset，同步）、`composedPreset(agentCtx)`、`recompose(agentCtx, id)`（仅 blank agent）、`standingKeyFor(id?)`、`roots`、`authorable`、`read(id)`、`copy(from, id, name?)`（唯一创作写入）、`remove(id)`、`serviceFor(agent, name)`（跨 isolate 读 preset 服务）。锚点：README.md:13-25；dsh-agent-presets/lib/index.js:1045-1082。
- **select 不在宿主服务上**：切换默认 preset = 写 `agent-presets` settings 命名空间的 `default` 字段（`settings.register(SETTINGS_NAMESPACE, AgentPresetSettingsSchema, {base:{default: config.default}})`，锚点 dsh-agent-presets/lib/index.js:794、856）；会话级切换经 apiproxy RPC（blank 会话可切，非 blank 应答 `agent-preset-locked`），提交后追加 `agent-preset/selected` 会话事件并重发为宿主事件。锚点：README.md:104-113、45-51；dsh-agent-presets/lib/index.js:869-870；dsh-client-ui-agent-preset/README.md:15-17。
- **preset 无 model/effort 原生字段**：preset.yml 只有 name/description；模型默认走 `agent-default-model` 命名空间（见 2.5）。kimi-tide 若要做「模式预设绑定模型」须桥接（桥接行改 agent-default-model 或在 preset 组合里加行）。锚点：README.md:73-82（display-only 明示）。

### 2.4 `ctx.web`（dsh-web）——能力接缝

- 同一 seam 管 search 与 fetch：`registerSearchProvider` / `registerFetchProvider`（重名抛 `WEB_DUPLICATE_PROVIDER`）；`searchProvider`/`fetchProvider` 配置（或 `DSH_WEB_SEARCH_PROVIDER` 环境变量）在**多个可用 provider 时**指定选择——不是隐藏优先级链：0 个可用抛 `WEB_PROVIDER_UNAVAILABLE`，多个可用且未配置抛 `WEB_PROVIDER_AMBIGUOUS`。锚点：dsh-web/lib/index.js:48-57、61-81、118-130。
- 错误类型 `WebError`（HarnessError 子类），错误码含 WEB_PROVIDER_*、WEB_ABORTED 等。锚点：dsh-web/lib/index.js:19；dsh-web/lib/types/types.d.ts:123。
- provider 实例：dsh-web-search-deepseek（内置，config `apiKeyEnv: DEEPSEEK_API_KEY` 默认值、baseURL `https://api.deepseek.com/anthropic/v1`、model `deepseek-v4-flash`、maxTokens 4096、maxUses 5；走 Messages API + `web_search_20250305` server tool）。锚点：dsh-web-search-deepseek/README.md:17-28。
- dsh-web-fetch-http：**不在 dsh 嵌套 node_modules**，需独立装到部署 profile node_modules（本机已装在 `$NPM/@deepseek-ai/dsh-web-fetch-http`，cordis.patch.yml 以 `- insert:` 追加）；config maxUrlLength 2048 / maxResponseBytes 5MB / maxBodyChars 100K / timeoutMs 30000 / maxRedirects 5。锚点：dsh-web-fetch-http/README.md:26-36；本地安装事实 `C:\Users\tafce\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh-web-fetch-http\package.json`。

### 2.5 `ctx.llm` / `ctx.tools` / `ctx.subagents`

- ctx.llm：见 1.5（registerAdapter / listModels / resolveModelInfo / prepareCall / registerConfigurableProviders / registerModelDiscovery）。
- ctx.tools（dsh-tools）：`register(definition: ToolDefinition): () => void`——scoped 注册遮蔽 global，同层重名与保留名 `run_code` 抛错；另有 `restrict(filter)`（allow/deny 遮罩继承面）与 `guard(guard)`（pre-execute 之后的单调拒绝闸）。锚点：dsh-tools/lib/types/index.d.ts:598-622。
- ctx.subagents（dsh-subagent）：命名 provider 注册表 `registerProvider(provider)`（重名抛 DUPLICATE_PROVIDER）、`list()`、`start(name, request)`（capability 校验 + 深度校验后委托 provider.start，随后发 subagent/start）；in-process 子代经 `ctx.agentPresets.composeFrom(childCtx, parent.ctx)` **绑定父 preset**（非重新 mount）——保证子代与父代同一代组合。锚点：dsh-subagent/lib/index.js:2467-2492、2504-2518、571。

### 2.6 模型路由机制三处

1. **`agent-default-model` 命名空间**（dsh-agent-default-model）：`ctx.agentDefaultModel.currentSelection()` → `{provider, model, reasoningEffort?}`；`saveSelection()` 存为部署默认（settings 命名空间 `agent-default-model`，config 为 base 层）。锚点：dsh-agent-default-model/README.md:5-12。
2. **per-session requestHeader + `session.selectModel` RPC**：apiproxy 的 selectionFor 三级解析——本会话进程内选择 > 会话日志最新 request/header > agent 默认；selectModel 校验 effort 后存为下次组装用，且**同时写回部署默认**；选择仅在被一次实际请求消费后才持久。锚点：dsh-host-apiproxy/lib/index.js:1721-1739；README.md:13、37。
3. **`agent/request` waterfall**：每步请求组装时改道的最终接缝（见 1.2）。kimi-tide 路由器正挂在这里（外加 agent/pre-step + image-admission 探针）。

---

## 三、生态（官方已有什么）

> **rc.2 实测标注**：以下各节 rc.8→rc.2 仅 package.json+README 变化（逐文件哈希 diff 实证），既有锚点全部有效，不再重复行号。

| 能力 | 官方包 | 关键事实 | 锚点 |
|---|---|---|---|
| web_search / web_fetch 工具 | dsh-tool-web | **内置但 dsh-base 默认 disabled**；fetch 独立开关；search 默认 true、fetch 默认 true（代码默认）、searchMaxResults 8、**searchTimeoutMs/fetchTimeoutMs 默认 30000**（3e4，非常见误传的 60000——本机 cordis.patch.yml 显式覆盖成 60000）、fetchMaxOutputChars 200000；「注册即稳定」——provider 缺失时执行期抛 WebError 而非隐藏工具 | dsh-tool-web/lib/index.js:739-752；README.md:20-31、38-42；本机 `C:\Users\tafce\.dsh\profiles\web\cordis.patch.yml` tool-web 行（disabled:false + fetch:true + searchTimeoutMs:60000） |
| DeepSeek 搜索 provider | dsh-web-search-deepseek | 内置；`apiKeyEnv` 默认 `DEEPSEEK_API_KEY`；Anthropic-compatible 端点（与 LLM chat 端点不同） | dsh-web-search-deepseek/README.md:15-28 |
| HTTP fetch provider | dsh-web-fetch-http | 独立 npm 包，装到 profile node_modules 后 `- insert:` 挂载 | 见 2.4 |
| skill slash 菜单 + 工具行 | dsh-client-ui-skill | `/name` 菜单（host 侧 pre-step 手势边界统一裁判，菜单只是文本快捷）；`SkillRow` 注册进 keyed `tool.call.toolview` 槽位渲染 skill 工具调用卡片 | dsh-client-ui-skill/README.md:7、15；lib/client.js:227-231 |
| Model/Effort 两级菜单 | dsh-client-ui-model-selection | `/model` popupSelect + composer `conversation.input.model` 槽位共用一份 per-session 目录（`ctx.modelDirectories`）；提交走 `session.selectModel` | dsh-client-ui-model-selection/README.md:5、19 |
| Agent preset 全套 UI | dsh-client-ui-agent-preset | 四面：**AgentPresetRow**（General 设置行，选默认 preset）、**AgentPresetSeat**（新会话屏 chip）、会话头只读标签、**AgentPresetSection**（settings.section id=`agent-presets`，管理 roster：copy/delete/default/查看）；host 拒绝非 blank 切换（`agent-preset-locked`） | dsh-client-ui-agent-preset/README.md:5、15-21、33-37；类型 lib/types/client/*.d.ts |
| 设置域槽位 | dsh-client-ui-settings / ui-settings-general | `settings.trigger/header/close/action/section/plugins.tab/onboarding` + `settings.general.item`（单行偏好位）；client 侧写设置一律 `ctx.settingsScope.bind` | dsh-client-ui-settings/README.md:5；dsh-cordis-client-runner/lib/client.js:3049-3077、3213 |
| 会话/composer 槽位 | dsh-cordis-client-runner（槽位类型注册处） | `conversation.composer.dock`（卡片下环境读数行）、`conversation.input.model/.left/.right`、上方整行位、`tool.call.toolview`（keyed，按工具 wire 名分发） | dsh-cordis-client-runner/lib/client.js:2375、2509、2601、3427 |
| pi-ai 多 provider 适配器 | dsh-llm-pi-ai | 通用适配器（`@earendil-works/pi-ai` 后端）；**原生内置 `kimi-coding` provider（4 模型 + OAuth + anthropic 协议 + kimi 工具兼容）与 `moonshotai`/`moonshotai-cn`（开放平台 key）**；hand-declared route 支持任意 OpenAI-compatible 网关；settings 命名空间 `llm-pi-ai` 用户层可按 provider 合并覆盖；`inputModalities` 声明即准入依据 | dsh-llm-pi-ai/README.md:9-14、94-98、199；pi-ai `dist/providers/data/kimi-coding.json`、`dist/auth/oauth/kimi-coding.d.ts` |
| Kimi 模型目录（pi-ai 内置 catalog 是否含 kimi-for-coding/k3） | — | **已核实：pi-ai 原生内置 kimi-coding provider**——catalog `dist/providers/data/kimi-coding.json` 含 `k3`/`k3-256k`/`kimi-for-coding`/`kimi-for-coding-highspeed` 四模型（anthropic-messages 协议 + baseUrl `https://api.kimi.com/coding` + `input:["text","image"]` + k3 `thinkingLevelMap` low/high/max）；另有 `auth/oauth/kimi-coding`（RFC 8628 设备授权 OAuth，auth.kimi.com）+ `deferredToolsMode:"kimi"` 工具兼容 + `moonshotai`/`moonshotai-cn`（开放平台 API key 路径）。**结论：dsh-kimi-tide 自研 KimiAdapter 疑似重复造轮，0.4.x 应优先复用 pi-ai 原生 kimi 路径**（kimi-coding=订阅 OAuth / moonshotai=开放平台 key）。 | 反证锚点：grep 无命中（dsh-llm-pi-ai/lib） |
| 动态 Cordis 插件机制 | dsh-tool-cordis 等 | define/run/stop/undefine + Inspect Provider 目录（事件签名目录 dsh-tool-cordis/lib/index.js:3383+ 即其一） | 本调研多处引用 |

### 结论：官方已提供 vs kimi-tide 独占价值

- **官方已提供（勿重复造）**：LLM 适配器 seam（registerAdapter/resolveModelInfo/prepareCall）、模型选择与部署默认（agent-default-model + session.selectModel + ui-model-selection）、agent preset 机制与全套 UI、设置命名空间与设置页槽位、web 工具链、skill 注册表与 slash UI、子代理注册表（含 composeFrom 父 preset 绑定）、image-admission 准入探针（本地补丁，半内部）。
- **kimi-tide 独占价值**：双模型**路由器**（per-step agent/request 改道 + 评分/能力决策）、**图像护栏**（锁存 + image-admission bail 联动）、**决策观测**（面板/sidecar 留痕）。这些在官方包中无对应物（grep 与目录阅读均无）。

---

## 四、2026-08-22 rc.2 复核

### 4.1 三破与迁移（kimi-tide 0.5.0 → rc.2 跟进，commits a2de84d..429a5fe）

1. **ProjectionDefinition 变形**：新契约 `{key, stateSchema, init, apply, wire?:{viewSchema, view}, stateVersion}`（rc.2 类型锚点 `dsh-session-projection/lib/types/index.d.ts:37-74`；官方范例 dsh-tool-todo rc.2 lib/index.js:80-96）。省略 `wire` = host-only 单元；新增 `stateOf(session, key)` 与 `SessionProjectionStateMap`；register 双 overload（index.d.ts:143-152）。
2. **`credentials/updated` 拆分**：`credentials/reference-updated` + `credentials/record-updated`（dsh-credentials rc.2 README.md:49；转发表 dsh-api-remotes/lib/types/remote-events.d.ts:16 已更新为 `credentials/reference-updated`）。
3. **image-admission 探针补丁重移植**：官方 tarball 从无该探针，本机补丁 08-22 已重打 rc.2（见 1.3）。

### 4.2 新能力

- **`deepseek-v4-flash-vision-exp` 视觉模型**：dsh-llm-deepseek 目录新增（lib/index.js:1604），另含 v4-flash（L1594）、v4-pro（L1599）。图片经 Files API 引用 + inline base64 兜底。
- **附件规范化编码**：准入 32MiB/100MP/16384px，EXIF 定向烘焙、元数据剥离、长边 2048px、JPEG 85/75/60/45 阶梯、1MiB 字节目标、GIF 恒转首帧 PNG；dsh-attachment-local 新增类型 compression-limiter/encoding/normalization/request-image。
- **`read_image` 结果增强**：+`originalDimensions?` + 坐标映射（dsh-commands/lib/typert.host.js:337-342 `ImageAttachmentRef` 声明）。
- **image-region 工具退役**：dsh-tool-fs rc.2 README「No attachment-region tool」。
- **会话头新增 `conversation.session.header.lineage` 槽**：面包屑标题与谱系控制（dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:77-84）。
- **pi-ai 凭据 store + OAuth 登录缝**：新包 dsh-authorization；事件 `authorization/settled`；`UNSTORABLE_PROVIDER_ID`；**kimi-coding 订阅 OAuth 首次可用**；新配置 `requestImagePixelBudget`/`requestImageMaxBytes`（dsh-llm-pi-ai/README.md:23-24）。
- **api-remotes 转发表改名**：`credentials/reference-updated`（dsh-api-remotes/lib/types/remote-events.d.ts:16）。
- **ask-user 待答问题不跨宿主重启**：`events.mux` 仅覆盖浏览器重连，宿主重启后待答 turn 丢失（dsh-host-apiproxy/README.md:79）。

### 4.3 peer 范围陷阱

- `^0.1.0-rc.8` 按 semver 不含 `0.1.1-rc.2`（prerelease 元组规则，npx semver@7 实证）——kimi-tide peerDeps 已抬 `^0.1.1-rc.2`。

### 4.4 升级作业留档

- 备份 `.dsh-rc2-upgrade\`（rc8-patched / rc2-orig / patched-live 三份 SHA256，MANIFEST.txt）。
- 实机验收清单 = 计划 Task 7（重启后执行）。

### 4.5 验收期实机回归：图像护栏粒度失效（已修复）

- **现象**（Task 7 第 4 项）：新会话带图发送，消息不再拒收（探针认领链完整），但图片轮停在文本模型 deepseek-v4-flash 上，宿主 `projectImagesForTextModel` 把图片投影为 hash 占位，模型盲答「看不到图」。
- **根因**：rc.2 的 deepseek-official 目录新增 `deepseek-v4-flash-vision-exp`（`inputModalities:[text,image]`），kimi-tide 图像护栏的 `textOnlyProviders()` 是 **provider 级**判定——同 provider 任一模型有图能力即整体豁免，文本模型目标由此漏判。rc.8 目录无 vision 模型，该缺陷不可见。
- **定位方法备查**：动态诊断插件（被动 `agent/image-admission` 监听器 + 模型工具直读活体 `llm` 服务/面板投影）+ zstd 多帧会话日志离线解码（帧扫描器移植自 dsh-session-persistence-jsonl `scanZstdFrames`，lib/index.js:503-566）。
- **修复**（main 直提）：护栏改**模型级**判定（目标模型自身 modalities 为准；目录读不到的目标保持宽容不改道）；改道目标按用户意图序（预设默认 → 规则目标序 → 目录序首个多模态可用候选），不主动改道到用户未声明的模型。测试 217→220。
- **旁证**：`agent/image-admission` 探针重移植在 rc.2 工作正常——认领成功才会放行入会话，本次回归恰证明认领链完好。

### 4.6 社区贡献并入（2026-08-22，PR #2/#3 @dracpet，来自 DSH Desktop 4.0.1 实机事故）

- **桌面线 gateway 契约分叉**：`commands/execute` 在 rc.8/rc.2 web = 3 业务参 `(agent, line, images)`；desktop 4.0.1+ = 2 业务参 + 可选尾置 caller AbortSignal（`descriptor.cancellation`，dsh-api-gateway/lib/client.js:214-241——多出的第三参会按 signal 解析，`AbortSignal.any` 抛 "Failed to convert value to 'AbortSignal'"）。web 端 2 参调用的 arity 报错原文为 `expected 3 business argument(s) plus an optional AbortSignal, got 2`。kimi-tide 客户端已改 2 参优先 + 该报错正则回退 3 参（commit 5066aed），两端兼容且无需版本嗅探。
- **YAML null config 坑**：patch 层 `config:` 下全注释 → 合成 `config: null` → 加载器入口读属性即抛、整棵插件树启动崩溃。host apply 已加 `config ?? {}` 归一（commit d7a2306），shipped `cordis.patch.yml` 亦改为显式 `config: {}` 双保险。

### 4.7 rc.2 会话级模型选择机制（installModelSelection）——插件路由必须 prepend 恒外层（2026-08-23 验收实锤）

- **机制**（rc.2 新增，0.5.0 升级验收「⑤回归」漏项的根因）：`dsh-host-apiproxy` 在**每个 agent 创建时**（setup 回调，lib/index.js:1712 `selectionFor` → `installModelSelection`）于 agent 作用域注册 `agent/request` 监听器，把 provider/model **覆盖**为会话选定模型。`selection.current` 回退链（lib/index.js:1692-1715）：GUI 显式选择（`picked`）→ 会话最新 `request/header` 日志 → 默认。`selection.assembled` 在 `system-prompt/assemble` 时快照，请求时按快照覆盖。
- **与插件路由的冲突**：cordis waterfall 结果 = **最外层监听器的返回值**（EventsService.waterfall，cordis lib/index.js:317-325）。kimi-tide 的 `agent/request` 监听器在**每次配置变更重挂载**（applyConfig → mountRouter → 注销+重注册）时被 push 到共享钩子链尾（内层）→ 宿主覆盖监听器（注册一次、位置靠前=外层）胜出 → 面板决策正确但实际请求恒 session 模型（0.6.0 验收 turn 10 实锤：决策 vision-exp / `assistant/message.source` 恒 deepseek-v4-pro）。
- **修复范式**（kimi-tide `e2d3c68`）：插件对 `agent/pre-step`、`agent/request`、`llm/stream`、`agent/image-admission` 四类监听器一律 `ctx.on(name, handler, {prepend: true})`——重挂载任意次数恒为链首（外层），路由返回值必生效；宿主 selection 回退链读会话 request/header，会跟随路由结果自愈（下一轮 selection 即上一轮路由目标）。
- **诊断方法学备查**：面板决策帧只是**决策证据**；路由类问题必须以**实际请求证据**为准（`assistant/message.source`、`request/header` 会话事件）。注意 request/header 仅在头变化时追加（headerEquals 去重），同模型连续轮不会出现新事件。
- **关联坑**：动态插件注册带运行时函数字段（ToolDefinition.render/execute 泄漏进 tools 数组）的工具会令 `request/header` 事件带非 JSON 数据 → 会话整轮失败 `session event "request/header" carries non-JSON-serializable data`（dsh-session types/index.js:492）——诊断业务问题优先 console.log，勿用工具注册探针。

---

## 结尾：结论与对 kimi-tide 的启示

### 0.4.x「API key 直连」应基于

- **首选**：dsh-llm-pi-ai 的 hand-declared route——`providers: { kimi-tide: { api: openai-completions, baseURL: 'https://api.kimi.com/coding/v1', apiKeyEnv: KIMI_API_KEY, models: [...] } }`，配合 `inputModalities: [text, image]`（声明须与端点实况一致，over-claim 后果见 dsh-llm-pi-ai/README.md:199）。接入后即自动获得：settings Models 页配置面（`llm-pi-ai` 命名空间）、模型目录、selectModel、reasoning efforts 全套。
- **前提待核实**：pi-ai 的 `openai-completions` 协议实现对 Kimi Code 端点的兼容性（流式形状、tool-call 字段）；kimi-for-coding/k3 是否已在 pi-ai catalog（见三章待核实项）。
- 替代：自研 LlmAdapter（实现 providerInfo/listModels/resolveModel/stream + attributionHeaders 契约，dsh-llm/lib/index.js:893-926），仅在 pi-ai 协议不适配时值得。

### 0.5.0「模式预设」应基于

- 官方 `dsh-agent-presets`：在 `<dshHome>/.agent-presets/<id>/` 落地 `agent.cordis.yml`（preset 行：preset 内声明桥接插件行，读写 kimi-tide 路由配置）；默认绑定写 `agent-presets.default` settings 字段（dsh-agent-presets/lib/index.js:856 已注册的命名空间）。
- 因 preset.yml 无 model/effort 字段，**模型绑定需桥接**：preset 组合内加一行桥接插件，于 `agent/created` 或 mount 时经 `ctx.agentDefaultModel` / 会话选择写入 kimi 模型路由（注意 agent-default-model 是进程级默认，per-session 需走 selectModel 语义或 request waterfall 改道）。
- UI 不必自研：AgentPresetRow/Seat/Section 已覆盖选择与管理；kimi-tide 特有配置放 `settings.section` 自有页面或 `settings.general.item` 行。

### 应退役/改用官方的历史做法

- **自研「凭据门控/评分 UI」若与官方 agent preset + model selection 重叠**（评分引擎的模型挑选职能）→ 退役评分做模型选择的职能，保留评分做**路由决策观测**。
- **自研设置卡片已迁官方设置页**（0.3.0 已完成，settings.section + settingsScope）——维持，不回退。
- **自研会话锁存**：机制上仍必需（1.6 表），但应写成「对官方 image-admission 探针的 bail 应答 + per-agent imageSeen」而非另立门控；rc.2 后 text-only 路由已支持占位投影，锁存退役条件趋于成熟。
- **web 工具/API 直连**：已全部官方化（tool-web + 两个 provider），无任何自研必要。

### 主要待核实项

1. ~~pi-ai catalog 是否内置 kimi-for-coding/k3~~ **已核实：pi-ai 原生内置 kimi-coding provider**——catalog `dist/providers/data/kimi-coding.json` 含 `k3`/`k3-256k`/`kimi-for-coding`/`kimi-for-coding-highspeed` 四模型（anthropic-messages 协议 + baseUrl `https://api.kimi.com/coding` + `input:["text","image"]` + k3 `thinkingLevelMap` low/high/max）；另有 `auth/oauth/kimi-coding`（RFC 8628 设备授权 OAuth，auth.kimi.com）+ `deferredToolsMode:"kimi"` 工具兼容 + `moonshotai`/`moonshotai-cn`（开放平台 API key 路径）。**结论：dsh-kimi-tide 自研 KimiAdapter 疑似重复造轮，0.4.x 应优先复用 pi-ai 原生 kimi 路径**（kimi-coding=订阅 OAuth / moonshotai=开放平台 key）。
2. `agent/image-admission` 是否有官方文档/类型导出（当前仅 apiproxy 源码与 HOTFIX 注释，属半内部接缝；rc.2 官方仍无）。
3. `session.selectModel` 的「同时写回部署默认」在 0.4.x 设计中的取舍（per-session 选择被写成部署默认可能非 kimi-tide 预期行为，锚点 dsh-host-apiproxy/README.md:13）。
4. ~~settings 域 apiproxy 命名空间 allowlist~~ **已核实（无 allowlist）**：apiproxy settings 写入对任何已注册命名空间开放——未知/未注册/校验失败统一折叠为 `settings-rejected`（dsh-host-apiproxy/lib/index.js:2377-2395）；README 亦明说「没有任何注册应答的名字会折叠为 seam 自己的 settings-rejected……插件只要注册自己的分节即可浏览器配置」（dsh-host-apiproxy/README.md:61）。dsh-client-ui-agent-preset README.md:51 提到的 allowlist 是指**宿主事件转发** allowlist（dsh-api-remotes/lib/types/remote-events.d.ts:16 的 `API_REMOTE_FORWARDED_EVENTS`），与 settings 命名空间无关。
