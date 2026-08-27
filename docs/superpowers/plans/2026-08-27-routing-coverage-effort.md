# 规则体系补全 + 可解释性 + 推理程度配置（0.8.0）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> 📌 **决策注记（2026-08-27 用户裁定）**：0.7.0 不发版（用户不满意）——0.7.0 的 tag / 合并 main / Actions 发版环节整体取消；关键词匹配改进随 0.8.0 一并发布（0.8.0 基线含 0.7.0 全部内容）；发版门禁适用 0.8.0（实机验收 B1–B8 全绿 + 用户裁定 tag）。执行分支：`feat/0.8.0-routing-coverage`（自 feat/0.7.0 尖端起）。

**Goal:** 按 0.8.0 设计稿 v2 落地三条决策线——D1 内置关键词组补 5 组并接线预设；D2 规则区可解释性（真语义标题 / minHits 标签 / 行级条件摘要 / 「试一句」测试器 / 决策 chip 命中词数）；D3 `effort` 可选字段（规则目标 / 预设默认 / 转述流视觉模型）经插件自有 Host→Client 通道（Typert remote）把 per-model 档位表送进设置卡片。

**Architecture:** 数据面（新组/预设序/`RouteTarget.effort?`）集中在 `src/config.ts`；schema 形状与语义校验在 `src/settings-schema.ts`（review.reviewer 内联无 effort target schema）；纯函数面（`matchingScored` 命中计分、条件摘要、`previewRoute` 试一句预测）在 `src/rules.ts`；路由决策（词数原因、effort 优先级/降级、VisionCaller 能力注入）在 `src/router.ts`；档位目录通道 = 宿主服务 `kimi-tide.catalog`（手工 Typert contribution + `typertRemote` 绑定，spike 实证 PASS）+ 客户端 `ctx.remote.$mount` 同名贡献；UI 面在 `src/client/SettingsCard.tsx` + `card-store.ts`。

**Tech Stack:** TypeScript + vitest（包目录 `packages/dsh-kimi-tide`，`npm test` = `vitest run`；沙箱内跑 `npx vitest run --pool=threads`）+ React 18 设置卡片（jsdom DOM 测试）+ schemastery（非 strict 透传语义）+ Typert remote（dsh-typert-protocol 0.1.1-rc.2，仅类型依赖）。

**Spec:** [`docs/superpowers/specs/2026-08-27-routing-coverage-effort-design.md`](../specs/2026-08-27-routing-coverage-effort-design.md)（v2，Round-1 评审修订后用户审定通过）——计划从 spec 展开，执行者两份并读。

## Global Constraints

- 版本定位：0.8.0（minor）；`packages/dsh-kimi-tide/package.json` version → 0.8.0。
- 兼容：全部新字段可选，**无 version bump、无迁移、无 `.pre-v5` 留档**；存量 v5 配置逐字节合法（schemastery 非 strict 透传 + effort 不带 default 缺省省略）。
- 匹配语义不变量保持：中文子串 / 纯 ASCII 词边界邻接守卫 / 特异度排序（命中词数 desc、平手列表序）/ 带图轮 image 规则恒优先 / minHits 缺省 1。
- effort 生效点限定：规则 target、预设 default、`TranscribeFlow.visionModel`；**review.reviewer 不生效**（内联无 effort schema）；**显式 @ 指令不指定 effort**；**图像护栏二次改道不带规则 effort**。
- 校验口径（M4）：`validateRouterConfig` 只做形状校验（effort 为非空 string）；档位合法性全部运行期降级（支持集判定，不支持 → 剥离 + 日志）。
- 优先级（M5）：`target.effort` 覆盖会话继承 effort → 过支持集判定 → 不支持剥离；继承路径的越级钳制语义（reasoningEffortFor）不变。
- TDD：每任务先写失败测试（RED）→ 最小实现（GREEN）→ 全量验证三绿才 commit；每任务一次 commit。
- 全量验证命令（在 `packages/dsh-kimi-tide` 下）：`npx vitest run --pool=threads`（= npm test 同集）+ `npm run typecheck` + `npm run build`。
- 包目录布局以 package-lock.json 为准：**绝不跑 pnpm install**；误装后 `npm ci` 还原（避坑 2026-08-26）。
- hooks 纪律：SettingsCard 所有新增 useState 必须置于 `config === null` 提前返回之前（2026-08-20 事故钉）。
- 三文档面同步：`docs/router.md`、仓库根 `README.md`（中英镜像）、`packages/dsh-kimi-tide/README.md`。
- 发布门禁：实机验收清单 B1–B8 全绿 + 用户裁定 tag 方可发版（0.7.0 起用户裁定门禁）。

---

## Spike 记录（0.8.0 前置，2026-08-27 已完成——本计划通道缝的实证基础）

spec §D3（评审 S1）要求「spike 钉死 effort 档位自有通道后再写计划」。已做：

1. **宿主半链实证 PASS**（动态 cordis 探针 `ktprobe_effort_channel`，本会话实跑）：
   - `ctx.provide(serviceKey, svc)` + `svc.typertRemote = Object.freeze({ service, serviceKey, namespace })`（无需装饰器）✓
   - `ctx.typert.register({ package, face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: [descriptor] })`——descriptor 为手工 `src-json` 编解码（`invocation: { kind: 'direct' }`、`parameters: []`、`result: { mode: 'src-json' }`）✓
   - `ctx.get('typertGateway').invoke({ namespace, method, args: {} })` 分发到插件服务并返回档位表 ✓（探针实测 `{"status":"pass", ...}`）
2. **客户端半链契约溯源**（源码实读）：`TypertClientRemote.$mount(contribution: TypertRemoteContribution)` 挂载 `{ package, descriptors }` 贡献（dsh-typert-protocol types.d.ts）；官方客户端装配 dsh-api-remotes 对 7 个贡献 `await ctx.remote.$mount(...)` 后按命名空间位置参数调用（`ctx.remote.commands.execute(agentId, line, images)`、`ctx.remote.dynamicCordisRunner.invoke(...)` 实例）。客户端动态探针因本会话审批策略（never）无法激活，未实跑；**Task 1 首步与实机验收 B5 兜底验证**（卡片 effort 下拉渲染即端到端证据）。
3. **注记（仅动态沙箱相关，真实插件无关）**：动态 cordis 插件在 VM realm 运行，传给宿主服务的 plain 对象会被网关 `isPlainObject`（宿主 `Object.prototype`）拒绝——探针用宿主原型链构造绕过。kimi-tide 真实插件在宿主 realm 原生运行，无此边界。
4. **事故（已入避坑记录）**：spike 探针首两版用「故意 throw 带报告」观察手法，unhandled promise rejection 两次杀死 DSH 宿主——任何探针/插件代码严禁无外层 catch 的异步 throw；探针观察通道改用「注册模型工具」。

---

### Task 1: effort 档位目录通道（Host→Client remote + card-store 消费）

**Files:**
- Create: `packages/dsh-kimi-tide/src/effort-catalog.ts`
- Create: `packages/dsh-kimi-tide/src/client/effort-remote.ts`
- Modify: `packages/dsh-kimi-tide/src/index.ts`（provide/注册/候选枚举刷新档位表；`import type {} from '@deepseek-ai/dsh-typert-protocol'`）
- Modify: `packages/dsh-kimi-tide/src/client/index.ts`（mount 贡献 + settings.section inject 传 `fetchEfforts`）
- Modify: `packages/dsh-kimi-tide/src/client/card-store.ts`（`CardSnapshot.efforts` + `loadEfforts`）
- Modify: `packages/dsh-kimi-tide/src/client/SettingsCard.tsx`（props 增 `fetchEfforts`，mount 后加载——effort 下拉渲染在 Task 6）
- Modify: `packages/dsh-kimi-tide/package.json`（devDependencies 增 `"@deepseek-ai/dsh-typert-protocol": "0.1.1-rc.2"`——仅类型依赖，运行时零 import；peer 不需要）
- Test: `packages/dsh-kimi-tide/test/card-store.test.ts`、`packages/dsh-kimi-tide/test/index-wiring.test.ts`

**Interfaces:**
- Consumes: 现有 `enumerateCandidates` 产出的 `CandidateMeta.reasoningEfforts`（src/index.ts）。
- Produces: `buildEffortCatalog(metas: readonly CandidateMeta[]): Record<string, string[]>`、`EFFORT_CATALOG_SERVICE = 'kimi-tide.catalog'`、`EFFORT_CATALOG_CONTRIBUTION`（宿主注册用）、客户端 `mountEffortCatalog(remote): Promise<EffortCatalogFetcher>`、`EffortCatalogFetcher = () => Promise<Record<string, string[]>>`、`CardSnapshot.efforts: Record<string, string[]> | null`、`CardStore.loadEfforts(fetch: () => Promise<Record<string, string[]>>): Promise<void>`。Task 6 消费 `snapshot.efforts`。

- [ ] **Step 1: 写失败测试**（`test/card-store.test.ts` 追加两个用例）

```ts
describe('card-store effort 档位目录（0.8.0）', () => {
  it('loadEfforts 取数成功 → efforts 入快照；取数失败 → efforts null（不占 error 通道）', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V4())
    const store = createCardStore(scope, null)
    await store.loadEfforts(async () => ({ 'kimi-coding/k3': ['low', 'high', 'max'] }))
    expect(store.getSnapshot().efforts).toEqual({ 'kimi-coding/k3': ['low', 'high', 'max'] })
    expect(store.getSnapshot().error).toBeNull()
    await store.loadEfforts(async () => { throw new Error('remote 挂了') })
    expect(store.getSnapshot().efforts).toBeNull()
    expect(store.getSnapshot().error).toBeNull()  // 降级通道，不污染 error
  })

  it('无 fetch（旧宿主/未接 remote）→ efforts 保持 null', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V4())
    const store = createCardStore(scope, null)
    expect(store.getSnapshot().efforts).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --pool=threads test/card-store.test.ts`
Expected: FAIL（`loadEfforts` 不存在 → TypeError / `efforts` 为 undefined）

- [ ] **Step 3: 写最小实现——宿主侧 `src/effort-catalog.ts`（新建，spike 实证形状逐字复用）**

```ts
// src/effort-catalog.ts — effort 档位目录通道（0.8.0，spike 2026-08-27 实证）：
// 插件自有 Host→Client JSON 通道。宿主把候选枚举得到的 per-model
// reasoningEfforts 打成表，经 Typert remote（手工 contribution，src-json
// 编解码）供设置卡片读取；客户端经 ctx.remote.$mount 同名贡献获得
// kimiTide.effortCatalog() 调用面（评审 S1：panel 投影通道证伪后的正选）。
// 无装饰器、无生成器依赖：bindTypertRemote 形状以普通对象字面量复刻。
import type { CandidateMeta } from './config.js'

/** 服务键（wire namespace 与之一致，见 EFFORT_CATALOG_DESCRIPTOR）。 */
export const EFFORT_CATALOG_SERVICE = 'kimi-tide.catalog'

/** 档位表：'provider/model' → 支持的 reasoningEffort id 列表。 */
export type EffortCatalog = Record<string, string[]>

/** 从候选池建档位表（纯函数）：只收带 reasoningEfforts 的条目，返回副本。 */
export function buildEffortCatalog(metas: readonly CandidateMeta[]): EffortCatalog {
  const out: EffortCatalog = {}
  for (const meta of metas) {
    if (meta.reasoningEfforts === undefined || meta.reasoningEfforts.length === 0) continue
    out[`${meta.provider}/${meta.model}`] = [...meta.reasoningEfforts]
  }
  return out
}

/** 宿主/客户端共享的手工 InvocationDescriptor（两端逐字段一致）。 */
export const EFFORT_CATALOG_DESCRIPTOR = {
  id: 'dsh-kimi-tide#effortCatalog',
  service: EFFORT_CATALOG_SERVICE,
  namespace: 'kimiTide',
  method: 'effortCatalog',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'src-json' },
} as const

/** 宿主侧注册贡献（ctx.typert.register 的形状）。 */
export const EFFORT_CATALOG_CONTRIBUTION = {
  package: 'dsh-kimi-tide',
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [EFFORT_CATALOG_DESCRIPTOR],
} as const
```

- [ ] **Step 4: 客户端贡献 `src/client/effort-remote.ts`（新建）**

```ts
// src/client/effort-remote.ts — 客户端半链（0.8.0）：$mount 手工贡献 + 调用面。
// 与宿主侧 src/effort-catalog.ts 的 descriptor 逐字段一致（同一 endpoint）。
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

export const EFFORT_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: 'dsh-kimi-tide',
  descriptors: [{
    id: 'dsh-kimi-tide#effortCatalog',
    service: 'kimi-tide.catalog',
    namespace: 'kimiTide',
    method: 'effortCatalog',
    invocation: { kind: 'direct' },
    parameters: [],
    result: { mode: 'src-json' },
  }],
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    kimiTide: {
      effortCatalog(): Promise<RemoteResult<Record<string, string[]>>>
    }
  }
}

export type EffortCatalogFetcher = () => Promise<Record<string, string[]>>

/**
 * $mount 贡献并返回取数闭包。挂载失败/调用失败一律 reject——调用方
 * （client/index.ts）捕获后降级为空表（卡片显示「跟随默认」禁用态）。
 */
export async function mountEffortCatalog(remote: {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>
} & Record<'kimiTide', { effortCatalog(): Promise<RemoteResult<Record<string, string[]>>> }>): Promise<EffortCatalogFetcher> {
  await remote.$mount(EFFORT_REMOTE_CONTRIBUTION)
  return async () => {
    const result = await remote.kimiTide.effortCatalog()
    if (!result.ok) throw new Error(`effort 档位目录取数失败：${result.error.message}`)
    return result.value
  }
}
```

- [ ] **Step 5: `src/index.ts` 接线（provide + 注册 + 枚举刷新 + 处置）**

文件头 `import` 区追加两行：

```ts
import type {} from '@deepseek-ai/dsh-typert-protocol'
import { buildEffortCatalog, EFFORT_CATALOG_CONTRIBUTION, EFFORT_CATALOG_SERVICE } from './effort-catalog.js'
```

在 `let candidateMetas: CandidateMeta[] = fallbackCandidateMetas(routerConfig)` 之后追加：

```ts
// 0.8.0 effort 档位目录：随候选枚举刷新（spike 实证通道，见 effort-catalog.ts）。
let effortCatalog: Record<string, string[]> = buildEffortCatalog(candidateMetas)
```

在 `refreshCandidates` 的 `.then((metas) => {...})` 内 `candidateMetas = metas` 之后追加：

```ts
        effortCatalog = buildEffortCatalog(metas)
```

在 `mountRouter()` 定义之后（`refreshCandidates()` 调用之前）追加服务提供与注册：

```ts
  // 0.8.0 自有 Host→Client 通道（Typert remote，spike 实证）：服务对象 + 手工
  // contribution。ctx.provide 的处置随插件 fiber 自动回收；typert.register
  // 返回的 disposer 手工挂到插件 fiber 上（注册表 effect 宿主级存活，插件
  // 停止时显式撤回，防重挂载「already registered」）。
  const effortService = {
    effortCatalog: () => effortCatalog,
  }
  ;(effortService as { typertRemote?: unknown }).typertRemote = Object.freeze({
    service: effortService,
    serviceKey: EFFORT_CATALOG_SERVICE,
    namespace: 'kimiTide',
  })
  if (typeof ctx.provide === 'function') {
    ctx.provide(EFFORT_CATALOG_SERVICE, effortService)
  }
  try {
    const disposeEffortRemote = (ctx.typert as unknown as {
      register?: (contribution: unknown) => (() => Promise<void>) | undefined
    }).register?.(EFFORT_CATALOG_CONTRIBUTION)
    if (disposeEffortRemote !== undefined) {
      ctx.effect(() => () => { void disposeEffortRemote() })
    }
  } catch (error) {
    warn(`dsh-kimi-tide: effort 档位目录注册失败（${(error as Error).message}）；effort 下拉降级为「跟随默认」`)
  }
```

- [ ] **Step 6: `src/client/index.ts` 接线（mount + 注入 fetchEfforts）**

文件头追加 import：

```ts
import { mountEffortCatalog, type EffortCatalogFetcher } from './effort-remote.js'
```

在 `apply(ctx)` 开头（tideDockBridge 接线之前）追加：

```ts
  // 0.8.0 effort 档位目录：$mount 手工贡献，失败降级为空表（卡片显示
  // 「跟随默认」禁用态）。catch 显式吞掉——绝不产生 unhandled rejection。
  const effortFetcher: Promise<EffortCatalogFetcher> = mountEffortCatalog(ctx.remote).catch(
    (error: unknown) => {
      console.warn(`[kimi-tide] effort 档位目录不可用（${error instanceof Error ? error.message : String(error)}）`)
      return async () => ({})
    },
  )
```

settings.section 的 `inject` 回调追加一行（`connection` 之后）：

```ts
      fetchEfforts: () => effortFetcher.then((fetch) => fetch()),
```

- [ ] **Step 7: `src/client/card-store.ts` 增快照字段与取数方法**

`CardSnapshot` 接口追加字段（`availability` 之后）：

```ts
  /**
   * per-model 推理档位表（'provider/model' → effort id 列表，0.8.0 自有
   * Host→Client 通道）。null = 未取/取数失败——UI 降级为「跟随默认」禁用态，
   * 与 availability 同款：不占 error 通道。
   */
  efforts: Record<string, string[]> | null
```

初始化快照对象（两处：`let snapshot` 初始值 + `load()` 内两个 `publish` 的不可用分支 + `readScope` 的 publish）都补 `efforts: snapshot.efforts`（沿用 catalog/availability 的既有搬运惯例——初始值 `efforts: null`；`load()` connection 路径两处 `publish({...})` 与 `readScope` 内 publish 各加 `efforts: snapshot.efforts`）。

`CardStore` 接口追加：

```ts
  /** 取 per-model 推理档位表（0.8.0 自有通道）；失败/未提供 → efforts=null。 */
  loadEfforts(fetch: () => Promise<Record<string, string[]>>): Promise<void>
```

返回值对象（`return {...}` 块）追加：

```ts
    loadEfforts: async (fetch) => {
      try {
        publish({ ...snapshot, efforts: await fetch() })
      } catch {
        publish({ ...snapshot, efforts: null })
      }
    },
```

- [ ] **Step 8: `src/client/SettingsCard.tsx` props + 加载**

`SettingsCardProps` 追加：

```ts
  /** 0.8.0：per-model 推理档位取数（宿主自有通道）；缺席/失败 → 下拉「跟随默认」。 */
  fetchEfforts?: () => Promise<Record<string, string[]>>
```

组件签名解构与加载（`useEffect` 处追加一个 effect，紧邻现有 `store.load()` effect）：

```ts
  useEffect(() => {
    if (props.fetchEfforts !== undefined) {
      void store.loadEfforts(props.fetchEfforts)
    }
  }, [store, props.fetchEfforts])
```

- [ ] **Step 9: `package.json` devDependencies**

```json
    "@deepseek-ai/dsh-typert-protocol": "0.1.1-rc.2",
```

然后 `npm install`（**新增依赖须更新 package-lock.json——`npm ci` 只按既有锁安装会报 lock 失步**；npm install 维持 npm 平铺布局，避坑规则只禁 pnpm；协议包经依赖树已存在于 node_modules，本次仅声明 + 锁更新）。

- [ ] **Step 10: 跑全量验证确认通过**

Run: `npx vitest run --pool=threads && npm run typecheck && npm run build`
Expected: 全绿（含 Step 1 新用例与全部存量测试——index-apply 测试 fake 无 `provide`/`typert`，接线代码的 `typeof` 守卫与 `?.` 保证其零影响）。注意：`test/SettingsCard.dom.test.tsx` 与 `test/SettingsCard.test.tsx` 的快照夹具（`makeDeferredStore` / `readySnapshot` / `readyV5Snapshot` 及 renderToString 夹具）构造 `CardSnapshot` 需同步补 `efforts: null` 字段——typecheck 绿的任务级义务归本任务（执行前裁定：字段新增者承担夹具连带更新，勿推迟到 Task 6）。

- [ ] **Step 11: Commit**

```bash
git add packages/dsh-kimi-tide/src/effort-catalog.ts packages/dsh-kimi-tide/src/client/effort-remote.ts packages/dsh-kimi-tide/src/index.ts packages/dsh-kimi-tide/src/client/index.ts packages/dsh-kimi-tide/src/client/card-store.ts packages/dsh-kimi-tide/src/client/SettingsCard.tsx packages/dsh-kimi-tide/test/card-store.test.ts packages/dsh-kimi-tide/package.json packages/dsh-kimi-tide/package-lock.json
git commit -m "feat(catalog): effort 档位目录 Host→Client 自有通道（typert remote，spike 实证）"
```

---

### Task 2: 数据面 D1——新关键词组 + 内置预设接线 + `RouteTarget.effort?`

**Files:**
- Modify: `packages/dsh-kimi-tide/src/config.ts`
- Test: `packages/dsh-kimi-tide/test/config.test.ts`

**Interfaces:**
- Consumes: 无新增。
- Produces: `RouteTarget { provider: string; model: string; effort?: string }`；`DEFAULT_KEYWORD_GROUPS` 7 组（code 17 词不变 / chitchat 瘦身为 6 词 / 新 5 组词表逐字如下）；capability 预设规则序 `image → review → code → math → longdoc → writing → translate → chitchat`（canonical 目标：review→k3、math→deepseek-v4-pro、longdoc→k3、writing→deepseek-v4-pro、translate→deepseek-v4-flash）；saving 只加一条 translate→deepseek-v4-flash。Task 3–6 消费这些形状。

- [ ] **Step 1: 写失败测试**（`test/config.test.ts` 追加/更新）

```ts
  it('0.8.0 关键词组：内置 7 组；chitchat 瘦身迁出翻译/总结', () => {
    expect(Object.keys(DEFAULT_KEYWORD_GROUPS).sort()).toEqual(['chitchat', 'code', 'longdoc', 'math', 'review', 'translate', 'writing'])
    expect(DEFAULT_KEYWORD_GROUPS.chitchat).toEqual(['你好', '谢谢', '怎么样', '随便', '聊聊', '天气'])
    expect(DEFAULT_KEYWORD_GROUPS.review).toEqual(['审查', 'review', '评审', '挑毛病', '复检', '检查', 'audit', '意见', '打分'])
    expect(DEFAULT_KEYWORD_GROUPS.writing).toEqual(['写作', '文案', '润色', '改写', '扩写', '标题', '推文', '周报', '演讲稿', '总结'])
    expect(DEFAULT_KEYWORD_GROUPS.translate).toEqual(['翻译', '译成', '中译英', '英译中', 'translate', '本地化'])
    expect(DEFAULT_KEYWORD_GROUPS.longdoc).toEqual(['长文档', '通读', '逐段', '全文', '上万字', '大文档'])
    expect(DEFAULT_KEYWORD_GROUPS.math).toEqual(['数学', '证明', '推导', '求解', '公式', '数论', '概率', '逻辑题'])
    expect(DEFAULT_KEYWORD_GROUPS.code).toHaveLength(17)  // code 17 词不动
  })

  it('0.8.0 内置预设接线：capability 序 image→review→code→math→longdoc→writing→translate→chitchat', () => {
    const p = DEFAULT_CONFIG_V4().presets.capability
    expect(p.rules.map((r) => r.id)).toEqual([
      'image-k3', 'review-k3', 'code-kfc', 'math-v4p', 'longdoc-k3', 'writing-v4p', 'translate-v4f', 'chitchat-flash',
    ])
    expect(p.rules[1]).toEqual({
      id: 'review-k3', when: { kind: 'keywords', group: 'review' },
      target: { provider: 'kimi-coding', model: 'k3' },
    })
    expect(p.rules[3].target).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(p.rules[5].target).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(p.rules[6].target).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('0.8.0 内置预设接线：saving 只加 translate→flash（其余不动）', () => {
    const p = DEFAULT_CONFIG_V4().presets.saving
    expect(p.rules.map((r) => r.id)).toEqual(['image-k3', 'code-kfc', 'translate-v4f'])
    expect(p.rules[2]).toEqual({
      id: 'translate-v4f', when: { kind: 'keywords', group: 'translate' },
      target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
  })
```

更新既有钉桩（两处：`关键词组内置词表（钉桩；0.7.0 code 17 词）` 的 chitchat 断言、`DEFAULT_CONFIG_V4` 的 `keywordGroups` 键断言——capability 规则数从 2 变 8，`能力预设：k3 打底 + 代码→kimi-for-coding + 闲聊→flash` 用例整体改写为上面的新序断言）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --pool=threads test/config.test.ts`
Expected: FAIL（新组缺失 / 规则序不符）

- [ ] **Step 3: 写实现 `src/config.ts`**

`RouteTarget` 改：

```ts
export interface RouteTarget { provider: string; model: string; effort?: string }
```

`DEFAULT_KEYWORD_GROUPS` 改：

```ts
export const DEFAULT_KEYWORD_GROUPS: Record<string, string[]> = {
  code: ['代码', 'code', 'bug', '重构', 'refactor', '实现', '函数', '测试', '接口', '联调', '部署', '性能', '报错', '日志', '编译', '命令', '脚本'],
  chitchat: ['你好', '谢谢', '怎么样', '随便', '聊聊', '天气'],
  review: ['审查', 'review', '评审', '挑毛病', '复检', '检查', 'audit', '意见', '打分'],
  writing: ['写作', '文案', '润色', '改写', '扩写', '标题', '推文', '周报', '演讲稿', '总结'],
  translate: ['翻译', '译成', '中译英', '英译中', 'translate', '本地化'],
  longdoc: ['长文档', '通读', '逐段', '全文', '上万字', '大文档'],
  math: ['数学', '证明', '推导', '求解', '公式', '数论', '概率', '逻辑题'],
}
```

`DEFAULT_CONFIG_V4` 的 saving rules 追加 translate（`code-kfc` 之后）：

```ts
          { id: 'translate-v4f', when: { kind: 'keywords', group: 'translate' }, target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
```

capability rules 整体替换为：

```ts
        // 0.8.0（D1）覆盖面补全：image → review → code → math → longdoc →
        // writing → translate → chitchat。review 在 code 前（用户裁定 2026-08-27：
        // 审查意图优先于泛 code 词，平手时落 review）；canonical 模型对 =
        // kimi-coding × deepseek-official，不假设 qwen/glm 存在。
        rules: [
          { id: 'image-k3', when: { kind: 'image' }, target: { provider: KIMI_PROVIDER, model: 'k3' } },
          { id: 'review-k3', when: { kind: 'keywords', group: 'review' }, target: { provider: KIMI_PROVIDER, model: 'k3' } },
          { id: 'code-kfc', when: { kind: 'keywords', group: 'code' }, target: { provider: KIMI_PROVIDER, model: 'kimi-for-coding' } },
          { id: 'math-v4p', when: { kind: 'keywords', group: 'math' }, target: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } },
          { id: 'longdoc-k3', when: { kind: 'keywords', group: 'longdoc' }, target: { provider: KIMI_PROVIDER, model: 'k3' } },
          { id: 'writing-v4p', when: { kind: 'keywords', group: 'writing' }, target: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } },
          { id: 'translate-v4f', when: { kind: 'keywords', group: 'translate' }, target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
          { id: 'chitchat-flash', when: { kind: 'keywords', group: 'chitchat' }, target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
        ],
```

- [ ] **Step 4: 跑测试确认通过 + 全量验证**

Run: `npx vitest run --pool=threads test/config.test.ts && npx vitest run --pool=threads && npm run typecheck && npm run build`
Expected: 全绿。注意：`test/rules.test.ts` 的「0.7.0 特异度」用例中『帮我总结这次重构，顺便写个测试』断言 `['code-kfc', 'chitchat-flash']` 需随 chitchat 瘦身（「总结」迁入 writing）更新为 `['code-kfc', 'writing-v4p']`——数据面变更的连带断言更新归本任务（执行前裁定：变更引发者当场修断言，保证每任务绿）。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/config.ts packages/dsh-kimi-tide/test/config.test.ts
git commit -m "feat(config): 0.8.0 内置关键词组补 5 组 + 预设接线 + RouteTarget.effort 可选字段"
```

---

### Task 3: settings-schema——effort 形状 + review.reviewer 内联无 effort + validate 空串检查

**Files:**
- Modify: `packages/dsh-kimi-tide/src/settings-schema.ts`
- Test: `packages/dsh-kimi-tide/test/settings-schema.test.ts`

**Interfaces:**
- Consumes: `RouteTarget.effort?`（Task 2）。
- Produces: `targetSchema`（含 `effort: Schema.string()`，无 default——缺省省略不注入）；`reviewerTargetSchema`（内联无 effort，仅供 flowSchema review 分支）；`validateRouterConfig` 的 effort 形状检查（非空 string）。Task 5/6 消费。

- [ ] **Step 1: 写失败测试**（追加到 `test/settings-schema.test.ts` 尾部）

```ts
describe('effort 形状（0.8.0）', () => {
  it('effort 缺省不注入（v5 默认往返相等保持）；提供则存活', () => {
    const c = DEFAULT_CONFIG_V5()
    expect(routerConfigSchema(c as never)).toEqual(DEFAULT_CONFIG_V5())  // 默认无 effort
    ;(c.presets.saving.rules[0].target as { effort?: string }).effort = 'max'
    const parsed = routerConfigSchema(c as never) as RouterConfigV5
    expect(parsed.presets.saving.rules[0].target).toMatchObject({ effort: 'max' })
  })

  it('预设 default 与 transcribe.visionModel 接受 effort；review.reviewer 无该字段（内联 schema）', () => {
    const c = DEFAULT_CONFIG_V5()
    ;(c.presets.saving.default as { effort?: string }).effort = 'high'
    ;(c.flows.transcribe.visionModel as { effort?: string }).effort = 'low'
    const parsed = routerConfigSchema(c as never) as RouterConfigV5
    expect(parsed.presets.saving.default.effort).toBe('high')
    expect(parsed.flows.transcribe.visionModel.effort).toBe('low')
  })

  it('effort 非法类型 → schema 拒绝（存在即校验）', () => {
    const c = DEFAULT_CONFIG_V5()
    ;(c.presets.saving.rules[0].target as { effort?: unknown }).effort = 42
    expect(() => routerConfigSchema(c as never)).toThrow(/effort/)
  })
})

describe('validateRouterConfig effort（0.8.0，形状校验口径 M4）', () => {
  const withEffort = (target: unknown, effort: unknown) => {
    const c = structuredClone(DEFAULT_CONFIG_V5()); c.activePreset = 'saving'
    ;(c.presets.saving.rules[0].target as Record<string, unknown>).effort = effort
    return validateRouterConfig(c)
  }
  it('空串拒写；任意非空档位串（含未知档位）通过——档位合法性运行期降级', () => {
    expect(withEffort({}, '')).toContain('effort')
    expect(withEffort({}, 'max')).toBeUndefined()
    expect(withEffort({}, 'xhigh')).toBeUndefined()
    expect(withEffort({}, 'unknown-tier')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --pool=threads test/settings-schema.test.ts`
Expected: FAIL（effort 断言失败/`toThrow(/effort/)` 不抛）

- [ ] **Step 3: 写实现 `src/settings-schema.ts`**

第 8 行起替换 target 相关三处：

```ts
const targetSchema = Schema.object({ provider: Schema.string(), model: Schema.string(), effort: Schema.string() })
// 0.8.0（评审 M7）：review.reviewer 不接收 effort——flowSchema review 分支
// 内联一份无 effort 的 target schema，尊重用户圈定范围（评审执行层不消费）。
const reviewerTargetSchema = Schema.object({ provider: Schema.string(), model: Schema.string() })
```

flowSchema review 分支的 `reviewer: targetSchema` 改为 `reviewer: reviewerTargetSchema`（transcribe 分支 `visionModel: targetSchema` 不变——D3 生效点含转述流视觉模型）。

`validateRouterConfig` 追加 effort 形状检查——preset.default（在 `for (const [key, preset] of ...)` 循环内、规则循环之前）：

```ts
    const dft = (preset.default ?? {}) as { effort?: unknown }
    if (dft.effort !== undefined && (typeof dft.effort !== 'string' || dft.effort.trim() === '')) {
      return `预设 '${key}' 的 default.effort 必须为非空字符串`
    }
```

规则 target 模型分支（现有 `else if (typeof t.provider ...)` 块内、return 之前追加）：

```ts
      if (typeof (t as { effort?: unknown }).effort !== 'undefined'
        && (typeof (t as { effort?: unknown }).effort !== 'string' || ((t as { effort?: string }).effort as string).trim() === '')) {
        return `规则 '${rule.id}' 的 target.effort 必须为非空字符串`
      }
```

flows 循环内（`if (flow.type !== 'review') continue` 之前追加 transcribe 分支检查）：

```ts
    if (flow.type === 'transcribe') {
      const vm = (flow.visionModel ?? {}) as { effort?: unknown }
      if (vm.effort !== undefined && (typeof vm.effort !== 'string' || vm.effort.trim() === '')) {
        return `转述流 '${fid}' 的 visionModel.effort 必须为非空字符串`
      }
    }
```

- [ ] **Step 4: 跑测试确认通过 + 全量验证**

Run: `npx vitest run --pool=threads test/settings-schema.test.ts && npx vitest run --pool=threads && npm run typecheck && npm run build`
Expected: 全绿（「v5 默认往返相等」因 effort 无 default 保持成立——schemastery 非 strict 透传语义钉）。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/settings-schema.ts packages/dsh-kimi-tide/test/settings-schema.test.ts
git commit -m "feat(schema): 0.8.0 effort 可选字段——形状校验口径，review.reviewer 内联无 effort"
```

---

### Task 4: rules.ts——`matchingScored` + 条件摘要 + `previewRoute`（试一句纯函数面）

**Files:**
- Modify: `packages/dsh-kimi-tide/src/rules.ts`
- Test: `packages/dsh-kimi-tide/test/rules.test.ts`

**Interfaces:**
- Consumes: Task 2 的新组形状；`DEFAULT_CONFIG_V5`（测试）。
- Produces: `interface RuleMatch { rule: RouterRule; score: number }`；`matchingScored(config: RuleMatchConfig, text: string, hasImage: boolean): RuleMatch[]`（命中计分排序，matchingRules 变为其薄封装保旧契约）；`ruleConditionSummary(rule: RouterRule, config: RuleMatchConfig): string`；`previewRoute(config: RuleMatchConfig, text: string, deps: RoutePreviewDeps): RoutePreview`（Task 6 测试器消费；Task 5 不消费 previewRoute）。

- [ ] **Step 1: 写失败测试**（追加到 `test/rules.test.ts`）

```ts
import { matchingScored, previewRoute, ruleConditionSummary } from '../src/rules.js'
import type { RoutePreviewDeps } from '../src/rules.js'
// …（import 行合并进文件头，matchingRules 已存在）

describe('matchingScored（0.8.0）', () => {
  it('返回 {rule, score} 计分排序（与 matchingRules 同序）；matchingRules 为薄封装', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'capability'
    const scored = matchingScored(c, '帮我总结这次重构，顺便写个测试', false)
    expect(scored.map((h) => h.rule.id)).toEqual(['code-kfc', 'writing-v4p'])
    expect(scored.map((h) => h.score)).toEqual([2, 1])
    expect(matchingRules(c, '帮我总结这次重构，顺便写个测试', false).map((r) => r.id))
      .toEqual(scored.map((h) => h.rule.id))
  })
  it('带图轮 image 规则 score = +∞ 恒首位', () => {
    const s = DEFAULT_CONFIG_V4(); s.activePreset = 'saving'
    expect(matchingScored(s, '翻译这句话', true)[0]).toMatchObject({ rule: { id: 'image-k3' }, score: Number.POSITIVE_INFINITY })
  })
})

describe('ruleConditionSummary（0.8.0）', () => {
  it('image→带图；keywords→「命中 <组> 组 ≥N 词」（minHits 缺省 1）', () => {
    const c = DEFAULT_CONFIG_V4()
    expect(ruleConditionSummary(c.presets.saving.rules[0], c)).toBe('带图')
    expect(ruleConditionSummary(c.presets.saving.rules[1], c)).toBe('命中 code 组 ≥1 词')
    const s = DEFAULT_CONFIG_V4(); s.activePreset = 'saving'
    s.presets.saving.rules.unshift({ id: 'plan-2', when: { kind: 'keywords', group: 'plan', minHits: 2 }, target: { provider: 'x', model: 'y' } })
    s.keywordGroups.plan = ['plan', '计划']
    expect(ruleConditionSummary(s.presets.saving.rules[0], s)).toBe('命中 plan 组 ≥2 词')
  })
})

describe('previewRoute（0.8.0 试一句纯函数）', () => {
  const CATALOG: RoutePreviewDeps['catalog'] = [
    { provider: 'kimi-coding', models: ['k3', 'kimi-for-coding'] },
    { provider: 'deepseek-official', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
  ]
  const DEPS: RoutePreviewDeps = { catalog: CATALOG, availability: null }
  it('off：activePreset null', () => {
    expect(previewRoute(DEFAULT_CONFIG_V4(), '随便一句', DEPS).outcome).toEqual({ kind: 'off', reason: '路由已关闭' })
  })
  it('rule：命中并显示词数；未命中 → default', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'capability'
    const hit = previewRoute(c, '帮我重构这个函数', DEPS)
    expect(hit.hits[0]).toMatchObject({ rule: { id: 'code-kfc' }, score: 1 })
    expect(hit.outcome).toEqual({ kind: 'rule', ruleId: 'code-kfc', label: 'code', score: 1, target: { provider: 'kimi-coding', model: 'kimi-for-coding' }, reason: '规则「code」命中 1 词' })
    expect(previewRoute(c, '今天天气不错', DEPS).outcome).toMatchObject({ kind: 'default', target: { provider: 'kimi-coding', model: 'k3' } })
  })
  it('rule：目标不可用（availability false）→ 跳过落下一命中', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'capability'
    const deps: RoutePreviewDeps = { catalog: CATALOG, availability: { 'kimi-coding/kimi-for-coding': false } }
    expect(previewRoute(c, '帮我重构这个函数', deps).outcome).toMatchObject({ kind: 'rule', ruleId: 'writing-v4p' })
  })
  it('explicit：@kimi → 该 provider 目录首个模型；目录缺失 → target 空 + 提示', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    expect(previewRoute(c, '@kimi 帮我看代码', DEPS).outcome).toMatchObject({ kind: 'explicit', provider: 'kimi-coding', target: { provider: 'kimi-coding', model: 'k3' } })
    expect(previewRoute(c, '@kimi 你好', { catalog: null, availability: null }).outcome).toMatchObject({ kind: 'explicit', target: null })
  })
  it('flow 目标（v5）：flow 存在且 transcribe → outcome 标注 flowId', () => {
    const c = DEFAULT_CONFIG_V5(); c.activePreset = 'saving'
    c.presets.saving.rules.unshift({ id: 'flow-first', when: { kind: 'image' }, target: { flow: 'transcribe' } })
    // previewRoute 纯文本调用：带图规则不命中（无 hasImage 参数——文本探针语义）
    const out = previewRoute(c, '帮我重构这个函数', { catalog: CATALOG, availability: null, flows: c.flows })
    expect(out.outcome).toMatchObject({ kind: 'rule', ruleId: 'code-kfc' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --pool=threads test/rules.test.ts`
Expected: FAIL（导出缺失）

- [ ] **Step 3: 写实现 `src/rules.ts`**

文件头 import 追加 `type CollaborationFlow`（config）：

```ts
import { KIMI_PROVIDER, type CollaborationFlow, type RouterPreset, type RouterRule } from './config.js'
```

`matchingRules` 重构为（替换现有函数体，排序留在 matchingScored）：

```ts
/** 单条命中：规则 + 命中词数（image 规则 = +∞）。 */
export interface RuleMatch { rule: RouterRule; score: number }

/**
 * 返回全部命中规则及计分，按（命中特异度 desc，列表序 asc）稳定排序
 * （0.7.0 设计决策 B2；0.8.0 起 score 随结果带出供决策原因/试一句消费——
 * 评审 M3）。含目标不可用者，可用性过滤在路由层。
 */
export function matchingScored(config: RuleMatchConfig, text: string, hasImage: boolean): RuleMatch[] {
  if (config.activePreset === null) return []
  const preset = config.presets[config.activePreset]
  if (preset === undefined) return []
  const lower = text.toLowerCase()
  const hits: RuleMatch[] = []
  for (const rule of preset.rules) {
    if (rule.when.kind === 'image') {
      // 带图轮 image 规则恒优先（设计决策 B2）
      if (hasImage) hits.push({ rule, score: Number.POSITIVE_INFINITY })
      continue
    }
    const words = config.keywordGroups[rule.when.group]
    if (words === undefined) continue
    let matched = 0
    for (const k of words) {
      if (k.length > 0 && compileKeyword(k).matches(lower)) matched += 1
    }
    const minHits = rule.when.minHits ?? 1
    if (matched >= minHits) hits.push({ rule, score: matched })
  }
  // ES2019+ 稳定排序：平手（含双 image 规则 ∞−∞=NaN 视同 0）保持列表序。
  hits.sort((a, b) => b.score - a.score)
  return hits
}

/** 薄封装：只取规则序列，保 0.7.0 契约（router/试一句之外的所有消费方不动）。 */
export function matchingRules(config: RuleMatchConfig, text: string, hasImage: boolean): RouterRule[] {
  return matchingScored(config, text, hasImage).map((h) => h.rule)
}
```

文件尾追加：

```ts
/** 规则行条件摘要（0.8.0 D2）：「带图」/「命中 code 组 ≥1 词」/「命中 plan 组 ≥2 词」。 */
export function ruleConditionSummary(rule: RouterRule, config: RuleMatchConfig): string {
  if (rule.when.kind === 'image') return '带图'
  return `命中 ${rule.when.group} 组 ≥${rule.when.minHits ?? 1} 词`
}

/** 试一句测试器依赖（0.8.0 D2）：候选目录与已配置目标可用性（浏览器侧无 modalities）。 */
export interface RoutePreviewDeps {
  catalog: Array<{ provider: string; models: string[] }> | null
  availability: Record<string, boolean> | null
  flows?: Record<string, CollaborationFlow>
}

/** 试一句预测结果（纯文本语义；带图偏差见 SettingsCard 固定声明）。 */
export interface RoutePreview {
  hits: RuleMatch[]
  outcome:
    | { kind: 'off'; reason: string }
    | { kind: 'explicit'; provider: string; target: RouteTarget | null; reason: string }
    | { kind: 'rule'; ruleId: string; label: string; score: number; target: RuleTarget | null; reason: string }
    | { kind: 'default'; target: RouteTarget; reason: string }
}

/**
 * 「试一句」预测（0.8.0 D2）：浏览器侧复刻 decide 的文本语义——显式 @ →
 * 规则链（首个目标可用者；availability===false 即不可用，null 全可用；
 * flow 目标须存在且 transcribe 型且 visionModel 可用，否则跳过）→ 默认打底。
 * 不模拟图像护栏/flow 降级路径（无 modalities，带图偏差声明在卡片）。
 */
export function previewRoute(config: RuleMatchConfig, text: string, deps: RoutePreviewDeps): RoutePreview {
  const availability = deps.availability
  const available = (target: RouteTarget): boolean =>
    availability === null || availability[`${target.provider}/${target.model}`] !== false
  const hits = matchingScored(config, text, false)
  if (config.activePreset === null) return { hits, outcome: { kind: 'off', reason: '路由已关闭' } }
  const preset = config.presets[config.activePreset]
  if (preset === undefined) return { hits, outcome: { kind: 'off', reason: '激活预设不存在' } }
  const explicit = explicitProvider(text)
  if (explicit !== null) {
    const models = deps.catalog?.find((group) => group.provider === explicit)?.models
    const target = models !== undefined && models.length > 0
      ? { provider: explicit, model: models[0] }
      : null
    return {
      hits,
      outcome: {
        kind: 'explicit', provider: explicit, target,
        reason: target === null ? `显式 @${explicit} 指令（候选目录不可判）` : `显式 @${explicit} 指令`,
      },
    }
  }
  const flows = deps.flows ?? {}
  for (const { rule, score } of hits) {
    if (isFlowTarget(rule.target)) {
      const flow = flows[rule.target.flow]
      if (flow === undefined || flow.type !== 'transcribe') continue
      if (!available(flow.visionModel)) continue
      return {
        hits,
        outcome: {
          kind: 'rule', ruleId: rule.id, label: ruleLabel(rule), score,
          target: { flow: rule.target.flow },
          reason: `规则「${ruleLabel(rule)}」命中 ${score} 词（协作流 ${rule.target.flow}）`,
        },
      }
    }
    if (!available(rule.target)) continue
    return {
      hits,
      outcome: {
        kind: 'rule', ruleId: rule.id, label: ruleLabel(rule), score, target: { ...rule.target },
        reason: `规则「${ruleLabel(rule)}」命中 ${score} 词`,
      },
    }
  }
  return { hits, outcome: { kind: 'default', target: { ...preset.default }, reason: `预设「${preset.name}」默认` } }
}
```

（`RouteTarget` 需加入 config import；`isFlowTarget` 从 config import。）

- [ ] **Step 4: 跑测试确认通过 + 全量验证**

Run: `npx vitest run --pool=threads test/rules.test.ts && npx vitest run --pool=threads && npm run typecheck && npm run build`
Expected: 全绿（matchingRules 既有断言逐条保持——薄封装同序；「总结」断言已在 Task 2 更新）。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/rules.ts packages/dsh-kimi-tide/test/rules.test.ts
git commit -m "feat(rules): matchingScored 命中计分带出 + 条件摘要 + previewRoute 试一句纯函数"
```

---

### Task 5: router.ts——决策原因词数升级 + effort 注入/降级 + VisionCaller 能力注入

**Files:**
- Modify: `packages/dsh-kimi-tide/src/router.ts`（decide / effortForTarget / replaceRoute / createStreamVisionCaller / EffortResolver）
- Modify: `packages/dsh-kimi-tide/src/index.ts`（`createStreamVisionCaller(ctx, resolveEfforts)` 调用点）
- Test: `packages/dsh-kimi-tide/test/router.test.ts`

**Interfaces:**
- Consumes: `matchingScored`（Task 4）、`RouteTarget.effort?`（Task 2）。
- Produces: `effortForTarget(metas, target, inherited, explicit: string | undefined): ReasoningEffortId | undefined`；`type EffortResolver = (target: RouteTarget) => string[] | undefined`；`createStreamVisionCaller(ctx: Context, resolveEfforts: EffortResolver): VisionCaller`（签名变更——index.ts 唯一调用点同步）；decide 原因新形状（`规则「code」命中 2 词（特异度最高）`/`规则「带图」命中`）。Task 7 断言消费原因形状。

- [ ] **Step 1: 写失败测试**（追加到 `test/router.test.ts`；同步更新两个既有用例的 reason 断言）

```ts
describe('决策原因词数（0.8.0）', () => {
  it('单命中：reason 带词数；多命中：加（特异度最高）', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    expect(r.decide([textMsg('帮我重构这个函数')], 1).reason).toBe('规则「code」命中 1 词')
    const c = cfg('capability')
    const r2 = new KimiRouter(c, METAS, log)
    const d = r2.decide([textMsg('帮我总结这次重构，顺便写个测试')], 1)
    expect(d.reason).toBe('规则「code」命中 2 词（特异度最高）')
  })
  it('image 规则：不带词数（∞ 无语义）', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    expect(r.decide([imageMsg()], 1).reason).toBe('规则「带图」命中')
  })
})

describe('effortForTarget / replaceRoute（0.8.0）', () => {
  const K3 = { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available: true, reasoningEfforts: ['low', 'high', 'max'] }
  const FLASH = { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], available: true, reasoningEfforts: ['off'] }
  const UNKNOWN = { provider: 'kimi-coding', model: 'k3-256k', modalities: ['text', 'image'], available: true }

  it('显式 effort 支持 → 覆盖继承值；不支持/能力未知 → 剥离（不钳制）', () => {
    expect(effortForTarget([K3], K3, 'low', 'max')).toBe('max')
    expect(effortForTarget([K3], K3, undefined, 'low')).toBe('low')
    expect(effortForTarget([K3], K3, 'low', 'xhigh')).toBeUndefined()
    expect(effortForTarget([UNKNOWN], UNKNOWN, 'low', 'max')).toBeUndefined()
    expect(effortForTarget([FLASH], FLASH, undefined, 'max')).toBeUndefined()
    expect(effortForTarget([K3], K3, undefined, undefined)).toBeUndefined()
  })
  it('无显式 effort → 继承语义不变（reasoningEffortFor 全量回归）', () => {
    expect(effortForTarget([K3], K3, 'max', undefined)).toBe('max')
    expect(effortForTarget([K3], K3, 'xhigh', undefined)).toBe('high')  // 越级钳制
    expect(effortForTarget([FLASH], FLASH, 'max', undefined)).toBeUndefined()  // 仅 off → 剥离
  })
  it('replaceRoute：规则 target.effort=max 覆盖继承 low；护栏目标（无 effort）保持继承钳制', () => {
    const r = new KimiRouter(cfg('saving'), [K3, FLASH, ...METAS], log)
    const base = { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' }
    expect(r.replaceRoute(base, { provider: 'kimi-coding', model: 'k3', effort: 'max' }))
      .toEqual({ provider: 'kimi-coding', model: 'k3', reasoningEffort: 'max' })
    expect(r.replaceRoute(base, { provider: 'kimi-coding', model: 'k3' }))
      .toEqual({ provider: 'kimi-coding', model: 'k3', reasoningEffort: 'low' })
  })
})

describe('createStreamVisionCaller effort 注入（0.8.0 M6）', () => {
  it('visionModel.effort 支持 → options.reasoningEffort 携带；不支持/未配置 → 不携带', async () => {
    const stream = vi.fn(async function* () { yield { type: 'finish' as const, reason: { kind: 'stop' as const } } })
    const ctx = { llm: { stream } } as never
    const resolveEfforts = (t: RouteTarget) => t.model === 'vision-exp' ? ['low', 'high'] : undefined
    const caller = createStreamVisionCaller(ctx, resolveEfforts)
    const images: ResolvedImage[] = [{ attachmentId: 'a1', ref: {} }]
    await caller({ provider: 'deepseek-official', model: 'vision-exp', effort: 'high' }, 'p', images)
    expect(stream.mock.calls[0][0]).toMatchObject({ provider: 'deepseek-official', model: 'vision-exp', reasoningEffort: 'high' })
    await caller({ provider: 'deepseek-official', model: 'vision-exp', effort: 'max' }, 'p', images)
    expect(stream.mock.calls[1][0].reasoningEffort).toBeUndefined()
    await caller({ provider: 'deepseek-official', model: 'vision-exp' }, 'p', images)
    expect(stream.mock.calls[2][0].reasoningEffort).toBeUndefined()
  })
})
```

更新既有 reason 断言：`规则命中 → via:rule，reason 含条件名` 的 `'规则「code」命中'` → `'规则「code」命中 1 词'`；`带图（消息含图）→ image 规则` 无 reason 断言不动；`v4 存量 flow 跳过` 等 toMatchObject 不含 reason 的不动；`v5 存量行为保持` 三处 reason 同步改。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --pool=threads test/router.test.ts`
Expected: FAIL（reason 不符 / effortForTarget 缺失）

- [ ] **Step 3: 写实现 `src/router.ts`**

`matchingRules` import 改：

```ts
import { explicitProvider, latestUserText, matchingScored, messagesContainImage, ruleLabel } from './rules.js'
```

`decide` 规则链循环改（替换现有 `for (const rule of matchingRules(...))` 块）：

```ts
    const hits = matchingScored(this.config, text, hasImage)
    for (const { rule, score } of hits) {
      const target = rule.target
      // 0.8.0 原因升级：携带命中词数；多命中加（特异度最高）标注（image=∞ 不带）。
      const note = score === Number.POSITIVE_INFINITY
        ? ''
        : ` ${score} 词${hits.length > 1 ? '（特异度最高）' : ''}`
      if (isFlowTarget(target)) {
        const flowId = target.flow
        const flow = flows[flowId]
        if (flow === undefined || flow.type !== 'transcribe') continue
        const vision = this.metas.find(
          (m) => m.provider === flow.visionModel.provider && m.model === flow.visionModel.model && m.available,
        )
        if (vision === undefined) continue
        return { kind: 'flow', flowId, flow, reason: `规则「${ruleLabel(rule)}」命中${note}（协作流 ${flowId}）`, via: 'rule' }
      }
      const meta = this.metas.find((m) => m.provider === target.provider && m.model === target.model && m.available)
      if (meta === undefined) continue
      return { kind: 'route', target: { ...target }, reason: `规则「${ruleLabel(rule)}」命中${note}`, via: 'rule' }
    }
```

`reasoningEffortFor` 之后追加 `effortForTarget`：

```ts
/**
 * 目标 effort 判定（0.8.0，spec D3/M5）：explicit（target.effort）覆盖会话继承
 * 值后再过支持集判定——支持 → 原样；不支持/能力未知/仅 off → 剥离（模型默认），
 * 不做越级钳制（用户显式指定的语义；dsh-llm 对不支持显式档位抛
 * UNSUPPORTED_REASONING_EFFORT，第二保险）。explicit 缺省 → 继承语义与
 * reasoningEffortFor 逐字节一致（护栏二次改道 target 无 effort 即走此路，
 * 保证规则 effort 不泄漏给视觉模型——M5 用户裁定）。
 */
export function effortForTarget(
  metas: readonly CandidateMeta[],
  target: RouteTarget,
  inherited: ReasoningEffortId | undefined,
  explicit: string | undefined,
): ReasoningEffortId | undefined {
  const meta = metas.find((m) => m.provider === target.provider && m.model === target.model)
  const supported = meta?.reasoningEfforts
  if (explicit !== undefined) {
    if (supported !== undefined && supported.length > 0 && supported.includes(explicit)) return explicit as ReasoningEffortId
    return undefined
  }
  return reasoningEffortFor(metas, target, inherited)
}
```

`replaceRoute` 改：

```ts
  replaceRoute(config: LlmCallConfig, target: RouteTarget): LlmCallConfig {
    const { reasoningEffort: inherited, ...rest } = config
    const effort = effortForTarget(this.metas, target, inherited, target.effort)
    if (effort !== (target.effort ?? inherited)) {
      this.log.info(`kimi-router: reasoning effort ${target.effort ?? inherited ?? '∅'} → ${effort ?? '∅'} on ${target.provider}/${target.model}`)
    }
    return {
      ...rest,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
      provider: target.provider,
      model: target.model,
    }
  }
```

`createStreamVisionCaller` 改（签名 + 工厂体）：

```ts
/** 目标能力的档位查询缝（M6）：metas 池注入，供「visionModel.effort 不支持则降级」。 */
export type EffortResolver = (target: RouteTarget) => string[] | undefined

export function createStreamVisionCaller(ctx: Context, resolveEfforts: EffortResolver): VisionCaller {
  return async (target, prompt, images, signal) => {
    const content = [
      { type: 'text', text: prompt },
      ...images.map((img) => ({ type: 'image', attachment: img.ref })),
    ] as unknown as ContentBlock[]
    const options: GenerateOptions = {
      provider: target.provider,
      model: target.model,
      messages: [{ role: 'user', content }] as unknown as Message[],
      ...(signal === undefined ? {} : { signal }),
    }
    // 0.8.0 D3：visionModel.effort 经支持集判定后显式下发；不支持/未配置 →
    // 不携带（Ruling 2 的 adapter 默认语义保持）。
    if (target.effort !== undefined) {
      const supported = resolveEfforts(target)
      if (supported !== undefined && supported.includes(target.effort)) {
        options.reasoningEffort = target.effort as ReasoningEffortId
      }
    }
    let text = ''
    for await (const chunk of ctx.llm.stream(options)) {
      // …（原样：text-delta 累计 / finish error|aborted 抛错）
    }
    return text
  }
}
```

- [ ] **Step 4: `src/index.ts` 调用点更新**

`transcriber` 构造处改（原 `caller: createStreamVisionCaller(ctx)`）：

```ts
  const resolveEfforts = (target: RouteTarget): string[] | undefined =>
    candidateMetas.find((m) => m.provider === target.provider && m.model === target.model)?.reasoningEfforts
  const transcriber = new Transcriber({
    caller: createStreamVisionCaller(ctx, resolveEfforts),
    log: (message) => { ctx.logger.info(message) },
  })
```

（`candidateMetas` 是 `let`——闭包读最新枚举值。）

- [ ] **Step 5: 跑测试确认通过 + 全量验证**

Run: `npx vitest run --pool=threads test/router.test.ts && npx vitest run --pool=threads && npm run typecheck && npm run build`
Expected: 全绿。注意 `test/index-apply.test.ts` / `test/index-wiring.test.ts` / `test/transcribe.test.ts` 若有 `createStreamVisionCaller` 直调或 reason 精确断言，按失败信息逐条更新（本任务显式预期；transcribe.test.ts 经 Transcriber 间接使用，签名变化仅影响直调处）。

- [ ] **Step 6: Commit**

```bash
git add packages/dsh-kimi-tide/src/router.ts packages/dsh-kimi-tide/src/index.ts packages/dsh-kimi-tide/test/router.test.ts
git commit -m "feat(router): 0.8.0 决策原因词数升级 + effortForTarget 优先级/降级 + VisionCaller 能力注入"
```

---

### Task 6: SettingsCard UI——真语义标题 / minHits 标签 / 行级摘要 / effort 下拉 / 「试一句」测试器

**Files:**
- Modify: `packages/dsh-kimi-tide/src/client/SettingsCard.tsx`
- Test: `packages/dsh-kimi-tide/test/SettingsCard.test.tsx`、`packages/dsh-kimi-tide/test/SettingsCard.dom.test.tsx`

**Interfaces:**
- Consumes: `snapshot.efforts`（Task 1）、`ruleConditionSummary` / `previewRoute`（Task 4）、`RouteTarget.effort?`（Task 2）、`DEFAULT_FLOWS` 既有。
- Produces: 纯 UI——`EffortSelect` 内部组件（不导出）；DOM 稳定锚点：规则区标题新文案、`aria-label="最少命中词数"` 旁可见标签、`aria-label="试一句"` 输入框、`aria-label="effort"` 下拉组。

- [ ] **Step 1: 写失败测试**

`test/SettingsCard.dom.test.tsx` 追加（fixtures 用 `readyV5Snapshot`，其 `efforts` 由 overrides 注入）：

```tsx
describe('SettingsCard 0.8.0 可解释性 + effort 下拉 + 试一句', () => {
  // （容器 setup 同既有 describe——复制 beforeEach/afterEach 与 mount 助手）

  it('规则区标题真语义文案 + minHits 可见标签 + 行级条件摘要渲染', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => { publish(readyV5Snapshot()) })
    // Fails if: 标题仍为 0.5.0 时代「有序，首条命中生效」
    expect(container.textContent).toContain('规则（命中词数多者优先，平手按列表序，带图恒第一）')
    // Fails if: minHits 缺可见标签（0.7.0 只有 aria-label）
    expect(container.textContent).toContain('最少命中词数')
    // Fails if: 规则行缺自动条件摘要（code-kfc 行 = 「命中 code 组 ≥1 词」）
    expect(container.textContent).toContain('命中 code 组 ≥1 词')
  })

  it('effort 下拉：有档位表 → 显示档位选项；模型未声明档位 → 禁用「跟随默认」', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => {
      publish(readyV5Snapshot({ efforts: { 'kimi-coding/k3': ['low', 'high', 'max'] } }))
    })
    // saving 预设默认模型 deepseek-v4-flash：未在档位表 → 只渲染禁用「跟随默认」
    const disabled = container.querySelectorAll<HTMLSelectElement>('select[aria-label="effort 默认模型"]')
    expect(disabled.length).toBe(1)
    expect(disabled[0].disabled).toBe(true)
    // 规则 image-k3 目标 k3：在档位表 → 可选 low/high/max + 跟随默认
    const k3 = container.querySelector<HTMLSelectElement>('select[aria-label="effort image-k3"]')
    expect(k3).not.toBeNull()
    expect([...k3!.options].map((o) => o.value)).toEqual(['', 'low', 'high', 'max'])
  })

  it('试一句：输入文本 → 实时显示命中规则词数与最终目标；标注按当前激活预设', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => { publish(readyV5Snapshot()) })
    const input = container.querySelector<HTMLInputElement>('input[aria-label="试一句"]')
    expect(input).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '帮我重构这个函数')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // Fails if: 测试器不显示命中规则（词数）与最终路由目标
    expect(container.textContent).toContain('code')
    expect(container.textContent).toContain('kimi-for-coding')
    expect(container.textContent).toContain('按当前激活预设')
    expect(container.textContent).toContain('仅文本探针')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --pool=threads test/SettingsCard.dom.test.tsx`
Expected: FAIL（文案/元素缺失）

- [ ] **Step 3: 写实现 `src/client/SettingsCard.tsx`**

import 区追加：

```ts
import { previewRoute, ruleConditionSummary } from '../rules.js'
```

文件头注释区（组件 doc 块）追加 0.8.0 一行说明。

hooks 置顶区追加（`const [newGroupName, setNewGroupName] = useState('')` 之后、`if (config === null)` 之前）：

```ts
  const [trialText, setTrialText] = useState('')
```

`config === null` 提前返回之后、`writable` 定义附近追加：

```ts
  const efforts = snapshot.efforts
```

新增 EffortSelect 组件（放在 `TargetSelect` 组件定义之后）：

```ts
/** effort 下拉（0.8.0 D3）：选项 = 该模型支持档位（宿主档位表）；未声明档位
 *  → 只渲染禁用态「跟随默认」；value 不在选项集 → 视同「跟随默认」。 */
function EffortSelect(props: {
  label: string
  value: string | undefined
  options: string[] | undefined
  disabled: boolean
  onChange: (effort: string | undefined) => void
}) {
  const options = props.options ?? []
  const known = props.value !== undefined && options.includes(props.value)
  return (
    <select
      aria-label={`effort ${props.label}`}
      value={known ? props.value! : ''}
      disabled={props.disabled || options.length === 0}
      onChange={(e) => props.onChange(e.target.value === '' ? undefined : e.target.value)}
    >
      <option value="">跟随默认</option>
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  )
}
```

effort 选项取数助手（`availability` 定义之后）：

```ts
  const effortsOf = (target: RouteTarget): string[] | undefined =>
    efforts === null || efforts === undefined ? undefined : efforts[configKey(target)]
```

**默认模型行**（`saveDefault` 的 TargetSelect 之后追加 EffortSelect）：

```tsx
            <EffortSelect
              label="默认模型"
              value={active.default.effort}
              options={effortsOf(active.default)}
              disabled={!writable}
              onChange={(effort) => {
                const next: RouteTarget = effort === undefined
                  ? { provider: active.default.provider, model: active.default.model }
                  : { ...active.default, effort }
                void store.savePreset(activeId, { ...active, default: next })
              }}
            />
```

（写路径「切换模型后 effort 不在新档位 → 自动清空」**天然满足，无需额外代码**：`parseTarget` 只产 `{provider, model}` 不含 effort 字段——下拉换模型即清空 effort。`saveDefault` 保持原样不动，在 `TargetSelect` 的 `onChange={saveDefault}` 旁加注释：

```tsx
            {/* 切换默认模型天然清空 effort（parseTarget 不产 effort 字段，D3 UI 语义） */}
```
）

**规则区标题与行**（`<div className="kt-rules">` 内）：

标题改：

```tsx
            <span className="kt-h">规则（命中词数多者优先，平手按列表序，带图恒第一）</span>
```

规则行内：minHits input 加可见标签与小字提示（替换既有 input 块为 label 包裹，其余原样）：

```tsx
                  {rule.when.kind === 'keywords' && (
                    <label className="kt-row">
                      <span className="kt-hint">最少命中词数</span>
                      <input
                        aria-label="最少命中词数"
                        title="≥N 个词同时命中才触发"
                        className="kt-minhits"
                        type="number"
                        min={1}
                        step={1}
                        value={rule.when.minHits ?? 1}
                        disabled={!writable}
                        onChange={(e) => {
                          const n = Math.round(Number(e.target.value))
                          if (Number.isInteger(n) && n >= 1) {
                            editActiveRule(index, { when: { ...rule.when, minHits: n } })
                          }
                        }}
                      />
                    </label>
                  )}
```

规则行尾部（TargetSelect 之后、上移按钮之前）追加条件摘要与 effort 下拉：

```tsx
                  <span className="kt-hint">{ruleConditionSummary(rule, config)}</span>
                  {!isFlowTarget(rule.target) && (
                    <EffortSelect
                      label={rule.id}
                      value={rule.target.effort}
                      options={effortsOf(rule.target)}
                      disabled={!writable}
                      onChange={(effort) => {
                        const t = rule.target as RouteTarget
                        const next: RouteTarget = effort === undefined
                          ? { provider: t.provider, model: t.model }
                          : { ...t, effort }
                        editActiveRule(index, { target: next })
                      }}
                    />
                  )}
```

规则目标 onChange（既有 `onChange={(value) => editActiveRule(index, { target: parseRuleTarget(value) })}` 保持原样——`parseRuleTarget` 天然不产 effort 字段 = 切换目标自动清空 effort，加注释：

```tsx
                    {/* 切换规则目标天然清空 effort（parseRuleTarget 不产 effort 字段，D3 UI 语义） */}
```

）

**FlowRow 视觉模型行**（transcribe 分支 TargetSelect 之后追加 EffortSelect；视觉模型 TargetSelect 的 `onChange` 保持原样 `props.onSave({ ...flow, visionModel: parseTarget(value) })`——同样天然清 effort）——`FlowRow` props 增 `effortsOf: (target: RouteTarget) => string[] | undefined`：

```tsx
          <EffortSelect
            label={`${props.id} 视觉模型`}
            value={flow.visionModel.effort}
            options={props.effortsOf(flow.visionModel)}
            disabled={!props.writable}
            onChange={(effort) => {
              const v = flow.visionModel
              const next: RouteTarget = effort === undefined
                ? { provider: v.provider, model: v.model }
                : { ...v, effort }
              props.onSave({ ...flow, visionModel: next })
            }}
          />
```

FlowRow 的 visionModel TargetSelect `onChange` 保持原样（parseTarget 天然清 effort）；FlowRow 调用处（协作流手风琴区）传 `effortsOf={effortsOf}`。

**「试一句」测试器**（放在关键词组管理区 `<details className="kt-groups">` 之前）：

```tsx
      {/* 「试一句」测试器（0.8.0 D2）：纯文本语义预测——命中规则（词数）+ 最终
          目标；带图输入只展示规则命中、不承诺最终改道（浏览器侧无 modalities）。 */}
      <details className="kt-trial">
        <summary>试一句</summary>
        <input
          aria-label="试一句"
          placeholder="输入一句话，看它会命中哪条规则、路由到哪个模型"
          value={trialText}
          disabled={false}
          onChange={(e) => setTrialText(e.target.value)}
        />
        {trialText.trim() !== '' && (() => {
          const preview = previewRoute(config, trialText, {
            catalog: snapshot.catalog,
            availability: snapshot.availability,
            flows: isV5 ? config.flows : undefined,
          })
          return (
            <div className="kt-trial-result">
              <span className="kt-hint">按当前激活预设（{activeId === null ? '关闭' : active?.name ?? activeId}）</span>
              {preview.hits.length === 0 && <div className="kt-h">未命中任何规则</div>}
              {preview.hits.map(({ rule, score }) => (
                <div key={rule.id} className="kt-trial-hit">
                  {ruleLabel(rule)} 命中 {score === Number.POSITIVE_INFINITY ? '（带图规则）' : `${score} 词`}
                  —— {ruleConditionSummary(rule, config)}
                </div>
              ))}
              <div className="kt-trial-outcome">
                最终路由：{preview.outcome.kind === 'off' ? preview.outcome.reason
                  : preview.outcome.kind === 'explicit' ? preview.outcome.reason
                  : preview.outcome.kind === 'rule'
                    ? `${preview.outcome.reason} → ${preview.outcome.target === null ? '（不可判）' : isFlowTarget(preview.outcome.target) ? `协作流 ${preview.outcome.target.flow}` : configKey(preview.outcome.target)}`
                    : `${preview.outcome.reason} → ${configKey(preview.outcome.target)}`}
              </div>
              <span className="kt-hint">仅文本探针：带图输入只展示规则命中，最终改道取决于图像护栏/协作流，此处不承诺。</span>
            </div>
          )
        })()}
      </details>
```

（`ruleLabel` 需从 `../rules.js` import。）

- [ ] **Step 4: 跑测试确认通过 + 全量验证**

Run: `npx vitest run --pool=threads test/SettingsCard.dom.test.tsx test/SettingsCard.test.tsx && npx vitest run --pool=threads && npm run typecheck && npm run build`
Expected: 全绿。既有 `test/SettingsCard.test.tsx` 若有标题旧文案断言（「有序，首条命中生效」）按失败信息逐条更新（fixtures 的 `efforts` 字段已在 Task 1 补过）。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/client/SettingsCard.tsx packages/dsh-kimi-tide/test/SettingsCard.test.tsx packages/dsh-kimi-tide/test/SettingsCard.dom.test.tsx
git commit -m "feat(client): 0.8.0 规则区真语义标题 + minHits 标签 + 行级摘要 + effort 下拉 + 试一句测试器"
```

---

### Task 7: 决策 chip 断言收口 + 三文档面 + version 0.8.0 + 验收清单 B1–B8

**Files:**
- Modify: `packages/dsh-kimi-tide/test/index-apply.test.ts`（buildDecisionSummary 词数断言）
- Modify: `packages/dsh-kimi-tide/package.json`（version 0.8.0）
- Modify: `docs/router.md`、`README.md`（根，中英镜像）、`packages/dsh-kimi-tide/README.md`
- Modify: 本计划文档（末节验收清单回填）

**Interfaces:**
- Consumes: Task 5 的原因新形状（chip 数据经投影透传——`DecisionSummary.reason` ≤120 截断契约不变，无 schema/stateVersion 变更）。
- Produces: 0.8.0 文档面与版本号。Task 8 与实机验收依赖 version。

- [ ] **Step 1: 写失败测试**（`test/index-apply.test.ts` 追加）

```ts
  it('buildDecisionSummary：0.8.0 原因含命中词数；flow 决策与 via:default 语义不变', () => {
    expect(buildDecisionSummary({
      kind: 'route', target: { provider: 'kimi-coding', model: 'kimi-for-coding' },
      reason: '规则「code」命中 2 词（特异度最高）', via: 'rule',
    })?.reason).toBe('规则「code」命中 2 词（特异度最高）')
    expect(buildDecisionSummary({
      kind: 'route', target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      reason: '预设「省钱」默认', via: 'default',
    })).toBeNull()  // 打底不上 chip（既有语义）
    expect(buildDecisionSummary({
      kind: 'flow', flowId: 'transcribe', flow: { type: 'transcribe', visionModel: { provider: 'x', model: 'y' }, failurePolicy: 'blind' },
      reason: '规则「带图」命中（协作流 transcribe）', via: 'rule',
    })).toMatchObject({ chosen: { provider: 'flow', model: 'transcribe' } })
  })
```

- [ ] **Step 2: 跑测试确认失败/通过**

Run: `npx vitest run --pool=threads test/index-apply.test.ts`
Expected: 若实现已满足（Task 5 原因已含词数）则直接 PASS——本用例是钉桩而非行为改动；FAIL 则说明 Task 5 遗漏，回补后重跑。

- [ ] **Step 3: version + 文档**

`package.json`：`"version": "0.7.0"` → `"version": "0.8.0"`。

`docs/router.md` 追加「0.8.0 规则体系补全 + 可解释性 + 推理程度配置」小节（五新组词表 / capability 序 / saving translate / effort 字段语义与优先级 / 试一句与条件摘要 / 决策原因词数；标注「effort 档位合法性运行期降级」「护栏二次改道不带规则 effort」「review.reviewer 不接收 effort」）。

根 `README.md` 中英镜像同步：关键词组表（7 组）、配置字段 `effort`（可选，规则目标/预设默认/转述流视觉模型）、设置卡片功能清单加「试一句」、规则区标题语义句、路线图 0.8.0 行、版本记录。`packages/dsh-kimi-tide/README.md` 同要点同步。

- [ ] **Step 4: 全量验证**

Run: `npx vitest run --pool=threads && npm run typecheck && npm run build && npm pack --dry-run`
Expected: 全绿 + 0.8.0 tgz 体检（版本一致性）。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/package.json packages/dsh-kimi-tide/package-lock.json packages/dsh-kimi-tide/README.md docs/router.md README.md packages/dsh-kimi-tide/test/index-apply.test.ts docs/superpowers/plans/2026-08-27-routing-coverage-effort.md
git commit -m "docs: 0.8.0 规则体系补全/可解释性/effort 三文档面同步 + version 0.8.0 + 验收清单 B1-B8"
```

---

### Task 8: 用户实机配置同步（兵器库目标 + 备份，实机验收前）

**Files:**
- Modify: `C:\Users\tafce\.dsh\settings.yaml`（`kimi-tide-router` 命名空间段）
- Backup: 同目录 `settings.yaml.bak-080-groups`（0.7.0 先例 `.bak-keyword-upgrade` 同款）

**Interfaces:**
- Consumes: Task 2 的组名与序。
- Produces: 用户 saving/capability 预设接入 5 新组（spec D1 尾「实施时按用户兵器库」：review→`qwen-token-plan-cn/qwen3.8-max-preview`、math→`zai-coding-cn/glm-5.2`、longdoc→`kimi-coding/k3`、writing→`deepseek-official/deepseek-v4-pro`、translate→`deepseek-official/deepseek-v4-flash`；capability 新序 image→review→code→math→longdoc→writing→translate→chitchat；saving 只加 translate）。**用户在场确认**（涉及用户机器配置与兵器库目标，0.7.0 同款操作先例为 DSH 执行 + 备份）。

- [ ] **Step 1: 备份**

```bash
Copy-Item C:\Users\tafce\.dsh\settings.yaml C:\Users\tafce\.dsh\settings.yaml.bak-080-groups
```

- [ ] **Step 2: 读现行 `kimi-tide-router` 段（`saving` 预设 rules / `capability` 预设 rules / keywordGroups），按上表组出完整新值**

目标形状（`keywordGroups` 增 5 组、chitchat 迁出「翻译」「总结」；`saving.rules` 序 `image→code→translate`；`capability.rules` 序 `image→review→code→math→longdoc→writing→translate→chitchat`）：

```yaml
kimi-tide-router:
  keywordGroups:
    code: [代码, code, bug, 重构, refactor, 实现, 函数, 测试, 接口, 联调, 部署, 性能, 报错, 日志, 编译, 命令, 脚本]
    chitchat: [你好, 谢谢, 怎么样, 随便, 聊聊, 天气]
    review: [审查, review, 评审, 挑毛病, 复检, 检查, audit, 意见, 打分]
    writing: [写作, 文案, 润色, 改写, 扩写, 标题, 推文, 周报, 演讲稿, 总结]
    translate: [翻译, 译成, 中译英, 英译中, translate, 本地化]
    longdoc: [长文档, 通读, 逐段, 全文, 上万字, 大文档]
    math: [数学, 证明, 推导, 求解, 公式, 数论, 概率, 逻辑题]
  presets:
    saving:
      rules:
        - { id: image-k3, when: { kind: image }, target: { provider: kimi-coding, model: k3 } }
        - { id: code-kfc, when: { kind: keywords, group: code }, target: { provider: kimi-coding, model: kimi-for-coding } }
        - { id: translate-v4f, when: { kind: keywords, group: translate }, target: { provider: deepseek-official, model: deepseek-v4-flash } }
    capability:
      rules:
        - { id: image-k3, when: { kind: image }, target: { provider: kimi-coding, model: k3 } }
        - { id: review-qwen, when: { kind: keywords, group: review }, target: { provider: qwen-token-plan-cn, model: qwen3.8-max-preview } }
        - { id: code-kfc, when: { kind: keywords, group: code }, target: { provider: kimi-coding, model: kimi-for-coding } }
        - { id: math-glm, when: { kind: keywords, group: math }, target: { provider: zai-coding-cn, model: glm-5.2 } }
        - { id: longdoc-k3, when: { kind: keywords, group: longdoc }, target: { provider: kimi-coding, model: k3 } }
        - { id: writing-v4p, when: { kind: keywords, group: writing }, target: { provider: deepseek-official, model: deepseek-v4-pro } }
        - { id: translate-v4f, when: { kind: keywords, group: translate }, target: { provider: deepseek-official, model: deepseek-v4-flash } }
        - { id: chitchat-flash, when: { kind: keywords, group: chitchat }, target: { provider: deepseek-official, model: deepseek-v4-flash } }
```

（用户兵器库目标按 spec D1 尾；若用户实机某个 provider 未挂载，目标显示（未挂载）灰态、路由按「目标不可用跳过」降级——不阻断验收 B1/B2 对应项。）

- [ ] **Step 3: 写回（原子替换 + YAML 解析复核）**

写后必须复核：YAML 可解析、`validateRouterConfig` 语义过（无指向不存在组的规则）、非路由字段逐字不动（0.7.0 先例的「其余字段不动」检查）。

- [ ] **Step 4: 重启 dsh web → 实机验收 B1–B8**

验收清单（发布门禁，用户裁定 tag 方可发版；`plan` 交叉探针为用户实机自建组，若用户已删该组则跳过并记录）：

- B1 新组命中阳性：审查/写作/翻译/长文档/数学各一探针，request/header 解码；
- B2 特异度与新组交叉：「帮我审查这段代码」（review 1 词 + code 1 词平手）→ 落 review 目标（序级裁定）；「帮我重构这段代码」（code 2 词）→ 落 code 目标；用户实机补 plan 交叉探针（「plan：帮我做个方案」→ plan 目标）；
- B3 minHits 摘要与可见标签渲染（设置卡片目检）；
- B4「试一句」测试器结果与实机路由一致（限定文本探针；带图只展示命中不承诺改道）；
- B5 effort 生效：deepseek 目标 effort=max → header 携带 reasoningEffort:max；qwen3.8 目标「跟随默认」禁用态；
- B6 转述流 visionModel effort 生效；护栏改道后视觉模型不带规则 effort；
- B7 存量兼容（无迁移留档、旧配置行为不变）；
- B8 决策 chip 显示命中词数。

全绿 + 用户裁定 → tag `v0.8.0` + 合并 main + Actions 发版（与 0.7.0 发版 tag 裁定各自独立）。
