# 0.6.0 协作编排（Collaboration Flows）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec《2026-08-22-collaboration-flows-design.md》P0+P1：规则目标泛化为「模型|协作流」，交付 transcribe 流（直调 eager/lazy）、按图三态退役布尔锁存、设置页流配置、面板图像上下文行，版本 0.6.0。

**Architecture:** 规则链 decide 保持同步纯函数，流执行（异步转述）收敛在 installRouter pre-step；智能投影经 `llm/stream` 瀑布拦截器（重入守卫自调）替换已转述图块；配置 v4→v5 行为保持迁移。review 流（P2）与子代理机制（P3）不在本计划。

**Tech Stack:** TypeScript + vitest（jsdom for UI）、schemastery、cordis 事件/瀑布、DSH 0.1.1-rc.2（dsh-llm `stream`/`contentHasImage`/`BlockAssembler` 导出）。

**Spec:** `docs/superpowers/specs/2026-08-22-collaboration-flows-design.md`（含 §3 实测证据、§5.4 缝裁决、§14 spike 表）

## Global Constraints

- 沙箱内跑测试一律 `npx vitest run --pool=threads`（forks 池在沙箱管道边界起不来，2026-08-22 避坑）
- 设置写路径每条中间态必须过 validate（dsh-settings validate-on-write，2026-08-21 避坑）
- schemastery 三行为（默认注入/对象型必注 {}/未知键透传）——schema 改动先写行为探测测试
- TDD：每任务先 RED 后 GREEN；每任务独立 commit；全量绿 + `npm run typecheck` 0 + `npm run build` 过才算完
- peer 基线 `^0.1.1-rc.2`；本计划**零宿主补丁改动**
- 迁移行为保持：v4 存量路由行为逐字节不变，预置流注册但不绑定
- 图块线形（image block wire shape）以 Task 1 spike 报告为唯一真相（候选锚点 dsh-llm lib:621-623 `block.attachment.bytes`）

---

### Task 1（控制端执行，活体 spike）：S1 直调 + S4c 拦截器端到端

**执行人：主会话（动态 cordis 插件，SDD 子代理无 cordis 工具）。**

**Files:**
- Create（发现报告）: `docs/superpowers/spikes/2026-08-22-collab-flows-s1-s4c.md`

**锚点（已源码证实，本任务活体复核）：**
- `ctx.llm.stream(options)`（dsh-llm lib/index.js:1636）：options=完整请求（provider/model/messages/signal），返回 chunk 异步流；`BlockAssembler` 组装文本
- `llm/stream` 瀑布（:1639-1641）包裹完整 options；cordis waterfall 语义（cordis lib/index.js:317-325）：`next()` 固定回放原始参数（**不支持 next(改后载荷)**），listener 可 veto 并自返替代流；瀑布返回值为最外层 listener 的返回值
- 原生 text-only 投影在瀑布之后执行（dsh-llm:1585-1591）

- [ ] **Step 1**: cordis_define 探针插件（host 半）：①`ctx.on('llm/stream', ...)` 拦截器——对带重入守卫标记的 options 直接 `next()`，否则把 messages 里指定 marker 文本块改写后经 `ctx.llm.stream(改写后 options)` 自调返回；②注册一次性模型 Tool 供主会话触发 `ctx.llm.stream` 带图调用（小红点 PNG 字节内联，图块线形候选 `{type:'image', attachment:{bytes, mimeType}}`，若适配器报错按报错形态修正）
- [ ] **Step 2**: cordis_run 探针；主会话调探针 Tool 发 vision-exp 带图调用，实证：文本正常返回（S1 ✅）；拦截器改写生效且不递归（S4c ✅）
- [ ] **Step 3**: 写发现报告（图块线形终版、拦截器代码范式、失败模式）+ spec §14 表格状态回填；cordis_stop/undefine 探针
- [ ] **Step 4**: Commit：`test(spike): S1 直调 + S4c llm/stream 拦截器活体实证`

**门禁：S1 或 S4c 任一失败 → 停线回报用户，按 spec §5.4 降级路径重议（S4b/命令式转述），不进入 Task 3+。**

### Task 2（控制端执行，源码 spike）：S2 子代理派发 + S3 轮末注入

**Files:**
- Create: `docs/superpowers/spikes/2026-08-22-collab-flows-s2-s3.md`

- [ ] **Step 1**: S2——实读宿主 dsh-subagents lib（注册表/派发 API/同步取结果可能性）+ Inspect `Service.listService` 目录核查
- [ ] **Step 2**: S3——Inspect `Event.listEvents` 查 turn/end、steering 类事件 + dsh-session append API（session.jsonl 追加可见消息的插件通路；参考 index.ts `registerPanelEventType` 的宿主模块锚定先例）
- [ ] **Step 3**: 写报告（P2/P3 可行性结论：GO/NO-GO + 契约锚点）；spec §14 回填
- [ ] **Step 4**: Commit：`test(spike): S2 子代理派发 + S3 轮末注入契约取证`

**本任务不门禁 P1（Task 3-12）；结论只影响 P2/P3 立项。**

### Task 3：config v5 类型 + 预置流

**Files:**
- Modify: `packages/dsh-kimi-tide/src/config.ts`
- Test: `packages/dsh-kimi-tide/test/config.test.ts`

**Interfaces（Produces，后续任务全依赖）：**

```ts
export type ImageFallback = 'latch' | 'blind' | 'transcribe-lazy'
export interface TranscribeFlow {
  type: 'transcribe'
  visionModel: RouteTarget
  failurePolicy: 'latch-image' | 'blind'
  prompt?: string
}
export interface ReviewFlow {
  type: 'review'
  reviewer: RouteTarget
  trigger: 'manual' | 'keywords'
  keywordGroup?: string
  rounds: number            // 1..3
  autoRevise: boolean
}
export type CollaborationFlow = TranscribeFlow | ReviewFlow
export type RuleTarget = RouteTarget | { flow: string }
// RouterRule.target 改 RuleTarget；RouterPreset 增 imageFallback?: ImageFallback、imageFallbackFlow?: string
export interface RouterConfigV5 {
  version: 5
  activePreset: string | null
  presets: Record<string, RouterPreset>
  flows: Record<string, CollaborationFlow>
  keywordGroups: Record<string, string[]>
}
export function DEFAULT_FLOWS(): Record<string, CollaborationFlow>
export function DEFAULT_CONFIG_V5(): RouterConfigV5
export function isFlowTarget(t: RuleTarget): t is { flow: string }
```

- [ ] **Step 1（RED）**: config.test.ts 新增：DEFAULT_CONFIG_V5 version=5、含 transcribe（vision-exp）/review（k3, manual, rounds 1, autoRevise false）两预置流、预设与 V4 逐项相等（行为保持）、`isFlowTarget` 窄化
- [ ] **Step 2**: 跑 `npx vitest run --pool=threads test/config.test.ts` 确认失败
- [ ] **Step 3（GREEN）**: config.ts 加上述类型与工厂；RouterConfigV4 及 DEFAULT_CONFIG_V4 **保留不动**（迁移输入专用，参照 V3 legacy 注释惯例标 @legacy）
- [ ] **Step 4**: 测试绿 + 全量绿
- [ ] **Step 5**: Commit：`feat(config): v5 类型与预置协作流——RuleTarget 并集 + ImageFallback + flows 注册表`

### Task 4：migrateV4（v4→v5 行为保持）

**Files:**
- Modify: `packages/dsh-kimi-tide/src/migrate.ts`
- Test: `packages/dsh-kimi-tide/test/migrate.test.ts`（无此文件则新建，沿用既有 migrate 测试风格）

**Interfaces:**
- Consumes: `RouterConfigV5/DEFAULT_CONFIG_V5/DEFAULT_FLOWS`（Task 3）
- Produces: `migrateV4(raw: unknown): RouterConfigV5`、`coerceRouterConfigV5(raw: unknown, warn: (m: string) => void): RouterConfigV5`、`hasKimiTideResidueV5(config: unknown): boolean`

- [ ] **Step 1（RED）**: 测试——v4 输入（含用户自定义预设/规则/关键词组）迁移后：version=5、presets/keywordGroups 逐字相等、flows=两预置、无 imageFallback 字段注入；v5 直通幂等（同引用）；v1/v3 链路端到端出 v5；residue 检测 version≠5 为真
- [ ] **Step 2**: 跑确认失败
- [ ] **Step 3（GREEN）**: `migrateV4`：v5 直通；否则 `coerceRouterConfigV4` 链到 v4 后展开为 v5（presets 原样、flows=DEFAULT_FLOWS()、不注入 imageFallback）；`coerceRouterConfigV5` 分派；`hasKimiTideResidueV5`：version!==5 或序列化含 'kimi-tide'
- [ ] **Step 4**: 绿 + 全量绿
- [ ] **Step 5**: Commit：`feat(migrate): v4→v5 行为保持迁移——预置流注册不绑定，残留检测跟进`

### Task 5：settings-schema v5 + 语义校验

**Files:**
- Modify: `packages/dsh-kimi-tide/src/settings-schema.ts`
- Test: `packages/dsh-kimi-tide/test/settings-schema.test.ts`、`test/schema-probe.test.ts`（探测先行）

**Interfaces:**
- Consumes: Task 3 全部类型
- Produces: `routerConfigSchema`（v5 形）、`validateRouterConfig(raw: RouterConfigV5): string | undefined`、`mergeResolved(entry: unknown): RouterConfigV5`

- [ ] **Step 1（探测）**: schema-probe.test.ts 补 v5 行为钉桩——flows dict 缺失注入 {}、imageFallback union 无 default 缺失省略、version union 收 2/3/4/5
- [ ] **Step 2（RED）**: settings-schema 测试——合法 v5 往返相等；规则 target `{flow:'x'}` 引用不存在 → 报错；引用 review 流作规则目标 → 报错（P1 仅 transcribe 可作规则目标）；`imageFallback:'transcribe-lazy'` 而 imageFallbackFlow 缺失 → 默认可解析到预置 transcribe；review 流 rounds 越界/trigger=keywords 无 keywordGroup → 报错
- [ ] **Step 3（GREEN）**: ruleSchema.target 改 union（targetSchema | `{flow: string}`）；presetSchema 增 imageFallback union（**无 default**）+ imageFallbackFlow string（无 default）；顶层增 flows dict（默认 DEFAULT_FLOWS 派生）；version union 加 const(5) 默认 5；validate 按 Step 2 语义实现；mergeResolved 出 v5
- [ ] **Step 4**: 绿 + 全量绿 + typecheck
- [ ] **Step 5**: Commit：`feat(settings): v5 schema 与语义校验——flow 引用存在性/类型/级联字段`

### Task 6：按图状态表（image-state.ts）

**Files:**
- Create: `packages/dsh-kimi-tide/src/image-state.ts`
- Test: `packages/dsh-kimi-tide/test/image-state.test.ts`

**Interfaces（Produces）：**

```ts
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { RouteTarget } from './config.js'
export type ImageHandling = 'native' | 'transcribed' | 'blind'
export interface ImageStateEntry { state: ImageHandling; latchTarget?: RouteTarget }
export class ImageStateStore {
  mark(agent: Agent, attachmentId: string, state: ImageHandling, latchTarget?: RouteTarget): void
  get(agent: Agent, attachmentId: string): ImageStateEntry | undefined
  native(agent: Agent): Array<readonly [string, ImageStateEntry]>
  counts(agent: Agent): { native: number; transcribed: number; blind: number }
}
```

- [ ] **Step 1（RED）**: 测试——mark/get 三态往返；native() 只列 native 且保持插入序；counts 汇总；transcribed/blind 覆盖 native 后 native() 不再列出；不同 agent 隔离（WeakMap 语义）
- [ ] **Step 2**: 跑确认失败（模块不存在）
- [ ] **Step 3（GREEN）**: 实现（WeakMap<Agent, Map<string, ImageStateEntry>>）
- [ ] **Step 4**: 绿 + 全量绿
- [ ] **Step 5**: Commit：`feat(image-state): 按图三态状态表——布尔锁存的替代基元`

### Task 7：转述器（transcribe.ts）

**Files:**
- Create: `packages/dsh-kimi-tide/src/transcribe.ts`
- Test: `packages/dsh-kimi-tide/test/transcribe.test.ts`

**Interfaces（Produces）：**

```ts
import type { RouteTarget, TranscribeFlow } from './config.js'
export interface ResolvedImage { attachmentId: string; bytes: Uint8Array; mimeType: string }
export type VisionCaller = (target: RouteTarget, prompt: string, images: readonly ResolvedImage[]) => Promise<string>
export const DEFAULT_TRANSCRIBE_PROMPT: string   // spec §5.5 T2 基线文案
export class Transcriber {
  constructor(deps: { caller: VisionCaller; log?: (message: string) => void; cacheCap?: number })
  peek(attachmentId: string): string | undefined        // 仅命中成功缓存
  async text(flow: TranscribeFlow, image: ResolvedImage): Promise<string | null>  // null=失败或已标记失败
}
```

- [ ] **Step 1（RED）**: 测试（mock caller）——成功路径缓存（同图二次调用 caller 只跑一次）；caller 抛错 → 返回 null 且记入失败集（同图不再重打，caller 仍一次）；`flow.prompt` 覆盖默认提示词；LRU 超 cap 逐出最旧；多图一次调用全传
- [ ] **Step 2**: 跑确认失败
- [ ] **Step 3（GREEN）**: 实现；DEFAULT_TRANSCRIBE_PROMPT 用 spec §5.5 文案（逐字保留图中文字+结构关系+关键视觉细节+报错截图堆栈行号高亮语义+不确定标注）
- [ ] **Step 4**: 绿 + 全量绿
- [ ] **Step 5**: Commit：`feat(transcribe): 转述器——VisionCaller 缝 + LRU 缓存 + 失败不重打`

### Task 8：router.ts 决策扩展（flow 目标 + imageFallback 判定）

**Files:**
- Modify: `packages/dsh-kimi-tide/src/router.ts`
- Test: `packages/dsh-kimi-tide/test/router.test.ts`

**Interfaces:**
- Consumes: Task 3/5/6 类型
- Produces:
  - `RouteDecision` 增 `{ kind: 'flow'; flowId: string; flow: TranscribeFlow; reason: string; via: 'rule' }`
  - `resolveImageFallback(preset: RouterPreset, flows: Record<string, CollaborationFlow>, native: ReadonlyArray<readonly [string, ImageStateEntry]>): { kind: 'latch'; target: RouteTarget } | { kind: 'blind' } | { kind: 'lazy'; flowId: string; flow: TranscribeFlow } | null`（native 空 → null；preset.imageFallback 默认 latch；lazy 时解析 imageFallbackFlow ?? 'transcribe'）

- [ ] **Step 1（RED）**: 测试——规则 target `{flow}`：flow 存在且 transcribe 且 visionModel 可用 → flow 决策；flow 不存在/类型 review/visionModel 不可用 → 跳过该规则降级；`resolveImageFallback` 四态（空/latch 取最近 native 的 latchTarget/blind/lazy 解析指定流）；既有 decide 断言全绿（行为保持）
- [ ] **Step 2**: 跑确认失败
- [ ] **Step 3（GREEN）**: decide 规则循环分流 model/flow 目标；新增 resolveImageFallback 纯函数；guardImage/applyTo/replaceRoute 不动
- [ ] **Step 4**: 绿 + 全量绿 + typecheck
- [ ] **Step 5**: Commit：`feat(router): 决策扩展——flow 规则目标变体 + imageFallback 三态判定`

### Task 9：installRouter 重接线 + llm/stream 智能投影拦截器

**Files:**
- Modify: `packages/dsh-kimi-tide/src/router.ts`（installRouter）
- Test: `packages/dsh-kimi-tide/test/router-wiring.test.ts`、`test/integration.test.ts`

**Interfaces:**
- Consumes: Task 1 spike 报告（图块线形+拦截器范式）、Task 6/7/8 全部
- Produces: `installRouter(ctx, router, deps: { images: ImageStateStore; transcriber: Transcriber; resolveImages: (messages: readonly UserMessage[]) => Promise<ResolvedImage[]>; onDecision?: (agent: Agent, decision: RouteDecision, extra?: { flowId?: string }) => void }): () => void`

- [ ] **Step 1（RED）**: 接线测试——①eager：本轮新图 + 规则命中 transcribe 流 → pre-step 内完成转述 → 请求落文本模型且 decide 重跑（图已转述 hasImage=false）②转述失败 latch-image → 该轮落 flow.visionModel③lazy：历史 native 图 + 文本轮 → 先转述再放行文本目标④llm/stream 拦截器：text-only 目标的已转述图块被替换为文本块、native 图块保留、视觉目标不改写、无缓存图块不重写、拦截器对自身转述调用不递归⑤锁存布尔退役：旧 `imageSeen` 引用清零
- [ ] **Step 2**: 跑确认失败
- [ ] **Step 3（GREEN）**: installRouter 按 spec §5.1/5.2/5.6 重排 pre-step（step===1：resolveImages→状态表登记→decide→flow 执行/fallback 应用→槽位）；request 钩子护栏输入改用「本轮未转述图」语义；注册 llm/stream 拦截器（重入守卫 WeakSet + 自调 `ctx.llm.stream`，cordis waterfall 不支持 next(改后载荷)——锚点 cordis lib:317-325）；生产 VisionCaller（`ctx.llm.stream` + BlockAssembler，图块线形按 spike 报告）
- [ ] **Step 4**: 绿 + 全量绿 + typecheck + build
- [ ] **Step 5**: Commit：`feat(router): 编排执行层——eager/lazy 转述接线 + llm/stream 智能投影拦截器，布尔锁存退役`

### Task 10：面板投影 v6（图像上下文行 + 流事件）

**Files:**
- Modify: `packages/dsh-kimi-tide/src/projection.ts`
- Test: `packages/dsh-kimi-tide/test/projection.test.ts`

**Interfaces:**
- Produces: 面板状态增 `imageContext?: { native: number; transcribed: number; blind: number }` 与 `lastFlowEvent?: string`（≤120 截断惯例）；`stateVersion: 5→6`

- [ ] **Step 1（RED）**: 测试——新字段 schema 往返、stateVersion 6 钉桩、wire.view 投影含图像上下文（rc.2 契约形态沿用）
- [ ] **Step 2**: 跑确认失败
- [ ] **Step 3（GREEN）**: projection 定义扩展（stateSchema/wire 同形扩展，zod 桥接断言惯例保留）
- [ ] **Step 4**: 绿 + 全量绿
- [ ] **Step 5**: Commit：`feat(projection): 面板 v6——图像上下文三态计数 + 流执行事件`

### Task 11：SettingsCard 流配置 UI

**Files:**
- Modify: `packages/dsh-kimi-tide/src/client/SettingsCard.tsx`、`src/client/card-store.ts`
- Test: `packages/dsh-kimi-tide/test/SettingsCard.test.tsx`、`test/SettingsCard.dom.test.tsx`

- [ ] **Step 1（RED）**: 测试——规则 target 选择器出现「协作流」分组（列 flows 注册表 transcribe 型）；「协作流」手风琴区渲染预置流参数可编；imageFallback 三态选择落盘；写失败（validate 拒）上浮错误提示（不静默——2026-08-21 避坑）；hooks 置顶纪律（dom 重渲染回归）
- [ ] **Step 2**: 跑确认失败
- [ ] **Step 3（GREEN）**: 实现；写路径拆 mutate result.ok:false 进 error 通道惯例
- [ ] **Step 4**: 绿 + 全量绿 + typecheck + build（client bundle 重建）
- [ ] **Step 5**: Commit：`feat(client): 设置卡片协作流配置——流注册表编辑 + 规则 target 流分组 + imageFallback 三态`

### Task 12：迁移接线 + 命令 + 版本与文档 + 验收清单

**Files:**
- Modify: `packages/dsh-kimi-tide/src/index.ts`（命名空间 v5 schema + 迁移调用 + `.pre-v5` 留档，沿用 settings-migration.ts 既有链路）、`src/commands.ts`（show 补 flows/图像上下文）、`package.json`（0.6.0）、`README.md`/`docs/development-plan-router.md`（路线图行）
- Test: `test/index-apply.test.ts`、`test/commands.test.ts`

- [ ] **Step 1（RED）**: 测试——v4 存量命名空间启动迁移到 v5 且留档 `.pre-v5`；show 输出含 flows 注册表与 imageFallback
- [ ] **Step 2**: 跑确认失败
- [ ] **Step 3（GREEN）**: 实现 + 版本 bump 0.6.0
- [ ] **Step 4**: 全量绿 + typecheck 0 + build + `npm pack` 体检
- [ ] **Step 5**: Commit：`feat(release): 0.6.0 协作编排——v5 迁移接线 + 命令族 + 文档`
- [ ] **Step 6**: 实机验收清单交付用户（spec §11 之 1-8、10 项；review 相关第 9 项属 P2）：迁移留档 / 流改挂生效 / eager 转述作答含图信息 / 切回观测 / latch 与 blind 姿态 / 看原图重挂 / **T4 门**（报错截图转述→文本模型诊断，用户目检）/ vision-exp 账单复核

---

## Self-Review 记录（2026-08-22 计划成稿后）

- **Spec 覆盖**：§4 配置→Task 3/5；§5.1/5.7 决策→Task 8/9；§5.2 transcribe→Task 7/9；§5.4 缝→Task 1/9；§5.6 护栏优先级→Task 8/9（既有护栏测试保绿）；§6 迁移→Task 4/5/12；§7 UI→Task 11；§8 观测→Task 10；§9 命令→Task 12；§10 测试纪律→各任务 + T4 在 Task 12；§14 spike→Task 1/2。§5.3 review 流=P2 不在本计划（spec 已注明）
- **类型一致性**：ImageStateEntry/ResolvedImage/VisionCaller/RouteDecision flow 变体/resolveImageFallback 签名跨 Task 6-9 对齐；isFlowTarget 窄化消费于 Task 5/8
- **门禁**：Task 1 失败=停线重议（不 SDD）；Task 2 不门禁 P1
