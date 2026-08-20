# 0.4.x「API key 直连」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 kimi-tide 接入层从自研 OAuth（约 740 行）切换为 pi-ai 原生 `kimi-coding` 路由 + API key 凭据，RouterConfig 格式 v2→v3（provider 改名 `kimi-tide/*` → `kimi-coding/*` 自动迁移），随 v0.4.0 发布。

**Architecture:** 零插件接入层代码——Kimi 模型经 `settings.yaml` 的 `llm-pi-ai.providers.kimi-coding` 路由（官方 Models 页维护）进 DSH LLM 注册表；kimi-tide 只保留路由器/护栏/观测。配置格式升 v3：`version: 3`，所有 provider 名 `kimi-tide` 改写为 `kimi-coding`（default/candidates/allowedProviders 值 + scores/costTiers 键前缀），迁移幂等、留档 `.pre-v3`。UsageMonitor 鉴权从 OAuth token 改为 API key（`ctx.credentials.resolve(apiKeyEnv)` 缝，兜底 `process.env`），401 不再刷新重试。面板本地 token 统计整块删除（数据源随适配器退役），新增「kimi 二态接入指示」（路由已注册 + key 可解析）。

**Tech Stack:** TypeScript 5.6 / vitest 2 / cordis 插件（@deepseek-ai/dsh-llm、dsh-settings rc.7、dsh-credentials）/ pi-ai 0.82.1 catalog / yaml / schemastery。

**Spec:** [`docs/superpowers/specs/2026-08-20-api-key-direct-design.md`](../specs/2026-08-20-api-key-direct-design.md)（本计划从该 spec 论证；实施者两份都要读）。宿主契约基线：[`docs/host-platform-map.md`](../../host-platform-map.md)。

## 与 spec 的偏差（已裁决，实施时无需再问）

| # | spec 原文 | 本计划落地 | 理由 |
|---|---|---|---|
| D1 | 「`RouterConfigV2.version` 升 3（类型改 `version: 3`）」 | 类型改名为 `RouterConfigV3`，`DEFAULT_CONFIG_V3()` 去掉 providerName 参数（固定 `'kimi-coding'`） | 名字带 V2 字段却是 3 是永久谎言；`Config.providerName` 已删（spec §3.3），参数化失去唯一调用方 |
| D2 | （未明确 schema 的 version 校验） | `routerConfigSchema.version` 用 `union([const(2), const(3)]).default(3)` 宽松读取 | 存量用户层 `version: 2` 若被 `const(3)` 拒绝，命名空间注册整体失败 → 静默退化 sidecar 且配置滞留（dsh-settings 契约：无效存量节拒绝注册）。宽松读 + 附加一次性迁移（Task 5）归一为 3 |
| D3 | scripts/ 同步退役或改写 | 仓库根 `scripts/plugin-smoke.mjs`（唯一调 OAuth 的脚本）直接删除 | spec §3.2 授权退役；该脚本唯一用途是 OAuth 冒烟 |
| D4 | 本地 token 统计删除 | 折叠进 Task 6（面板数据形），与 types/projection/TideDock 同任务 | 删除 `local` 必须同时改类型、wire schema、客户端渲染，拆开会产生中间态编译错误 |

## Global Constraints

- 配置格式：`RouterConfigV3.version === 3`（写入一律 3；schema 读 2|3）。
- 固定标识（**不得**因改名波及）：插件 id `dsh-kimi-tide`、命令 `/kimi-tide`、设置命名空间 `kimi-tide-router`、面板投影/事件键 `kimi-tide/panel`、日志前缀 `kimi-tide:`。
- 固定 provider 路由：`kimi-coding`（= `config.ts` 的 `KIMI_PROVIDER` 常量）。改名只作用于**provider 值/键**：`default.provider`、`candidates[].provider`、`allowedProviders[]`、`scores`/`costTiers` 键前缀 `kimi-tide/`。
- 密钥纪律：插件**永不触碰密钥本体**——只持有 env 引用名；每次请求经 `ctx.credentials.resolve()` 现取（按 dsh-credentials 契约「per-operation read，不缓存跨操作」）；不得在任何日志/投影/命令输出打印 key 值。
- 依赖纪律：运行时**不新增** `@deepseek-ai/dsh-credentials` 依赖（`ctx.get('credentials')` 可选读取，缺失兜底 `process.env`）；`credentialRef` 品牌与 `settingsNamespace` 品牌在运行时就是字符串，用类型断言即可，无需运行时 import。
- 质量门禁（每任务收尾）：`npm test`（vitest 全量）绿 + `npm run typecheck` 0 错误；Task 7 起加 `npm run build`。
- 事实纪律（顶级规则）：spec/host-platform-map 的锚点（文件+行）在实施中如与代码不符，以实读为准并在 commit message 注明。

---

### Task 1: v3 配置基座 + 全局改名（config / migrate / scores / classify / schema 基座 / 机械改名）

**Files:**
- Modify: `packages/dsh-kimi-tide/src/config.ts`（RouterConfigV3、DEFAULT_CONFIG_V3、KIMI_PROVIDER）
- Modify: `packages/dsh-kimi-tide/src/migrate.ts`（migrateV2、migrateV1→v3、coerceRouterConfig、hasKimiTideResidue）
- Modify: `packages/dsh-kimi-tide/src/scores.ts`（SCORES_VERSION 3 + 基线键改名）
- Modify: `packages/dsh-kimi-tide/src/classify.ts`（@kimi → KIMI_PROVIDER）
- Modify: `packages/dsh-kimi-tide/src/client/CandidateList.tsx`（PROVIDER_OPTIONS）
- Modify: `packages/dsh-kimi-tide/src/settings-schema.ts`（D=DEFAULT_CONFIG_V3()、version union、mergeResolved 去参）
- Modify: `packages/dsh-kimi-tide/src/index.ts`（仅 routerConfigToV2→V3 桥与类型引用；其余 Task 4）
- Modify: `packages/dsh-kimi-tide/test/*.test.ts`（机械改名，见步骤 3）
- Test: `packages/dsh-kimi-tide/test/migrate.test.ts`、`test/config.test.ts`

**Interfaces:**
- Consumes: 无（基座任务）。
- Produces:
  - `KIMI_PROVIDER: 'kimi-coding'`（config.ts 导出常量）
  - `RouterConfigV3 { version: 3; mode; default; candidates; scores; classify; allowedProviders; costTiers; routeThreshold; lambda; premiumBudget; budgetWindow; charsPerToken }`（config.ts）
  - `DEFAULT_CONFIG_V3(): RouterConfigV3`（config.ts，无参，candidates=[kimi-coding/kimi-for-coding]、allowedProviders=[kimi-coding, deepseek-official]）
  - `migrateV2(raw: unknown): RouterConfigV3`（migrate.ts；v2 形 → 改名 → version 3；无 kimi-tide 残留且 version 3 → 原样返回，幂等）
  - `migrateV1(raw: unknown, warn): RouterConfigV3`（migrate.ts；旧 v1 逻辑产出 v2 形 → 过 migrateV2）
  - `coerceRouterConfig(raw: unknown, warn): RouterConfigV3`（migrate.ts；version 3→直通、2→migrateV2、其余→migrateV1）
  - `hasKimiTideResidue(config: unknown): boolean`（migrate.ts；version≠3 或序列化含 'kimi-tide'）
  - `mergeResolved(entry: unknown): RouterConfigV3`（settings-schema.ts，**单参**）

- [ ] **Step 1: 写失败测试（migrate.test.ts 追加 v3 用例）**

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_V3, type RouterConfigV3 } from '../src/config.js'
import { coerceRouterConfig, hasKimiTideResidue, migrateV1, migrateV2 } from '../src/migrate.js'

const V2: Record<string, unknown> = {
  version: 2, mode: 'capability',
  default: { provider: 'kimi-tide', model: 'k3' },
  candidates: [
    { provider: 'kimi-tide', model: 'k3' },
    { provider: 'kimi-tide', model: 'kimi-for-coding' },
    { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  ],
  scores: { 'kimi-tide/k3': { code: 4.7 }, 'kimi-tide/kimi-for-coding': { code: 4.5 } },
  classify: { patterns: { code: ['审查'] } },
  allowedProviders: ['kimi-tide', 'deepseek-official'],
  costTiers: { 'kimi-tide/k3': 'mid' },
  routeThreshold: 0.8, lambda: 0.4, premiumBudget: 0.2, budgetWindow: 20, charsPerToken: 2,
}

describe('migrateV2（kimi-tide → kimi-coding）', () => {
  it('rewrites provider values in default/candidates/allowedProviders', () => {
    const out = migrateV2(V2)
    expect(out.version).toBe(3)
    expect(out.default).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(out.candidates.map((c) => c.provider)).toEqual(['kimi-coding', 'kimi-coding', 'deepseek-official'])
    expect(out.allowedProviders).toEqual(['kimi-coding', 'deepseek-official'])
  })

  it('rewrites kimi-tide/ key prefixes in scores and costTiers, keeps other fields', () => {
    const out = migrateV2(V2)
    expect(out.scores).toEqual({
      'kimi-coding/k3': { code: 4.7 },
      'kimi-coding/kimi-for-coding': { code: 4.5 },
    })
    expect(out.costTiers).toEqual({ 'kimi-coding/k3': 'mid' })
    expect(out.classify).toEqual({ patterns: { code: ['审查'] } })
    expect(out.routeThreshold).toBe(0.8)
    expect(out.lambda).toBe(0.4)
  })

  it('is idempotent: a v3 config with no residue passes through unchanged', () => {
    const out = migrateV2(migrateV2(V2))
    expect(out).toEqual(migrateV2(V2))
    expect(hasKimiTideResidue(out)).toBe(false)
    expect(migrateV2(out)).toBe(out)   // 原引用返回 = 幂等
  })
})

describe('coerceRouterConfig 版本分派', () => {
  it('version 3 passes through, version 2 migrates, v1 shape migrates via migrateV1', () => {
    const v3 = migrateV2(V2)
    expect(coerceRouterConfig(v3, () => {})).toBe(v3)
    expect(coerceRouterConfig(V2, () => {}).default.provider).toBe('kimi-coding')
    const v1 = { mode: 'cost', primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, premium: { provider: 'kimi-tide', model: 'k3' } }
    const fromV1 = coerceRouterConfig(v1, () => {})
    expect(fromV1.version).toBe(3)
    expect(fromV1.candidates[0]).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(migrateV1(v1, () => {}).default).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run（在 `packages/dsh-kimi-tide` 下）: `npx vitest run test/migrate.test.ts`
Expected: FAIL——`migrateV2`/`coerceRouterConfig`/`hasKimiTideResidue` not exported（类型改名未完成前编译也报错，属预期红）。

- [ ] **Step 3: 实现 config.ts / migrate.ts / scores.ts / classify.ts / CandidateList.tsx / settings-schema.ts 基座**

`src/config.ts` 全文替换为：

```ts
export type Dim = 'code' | 'reasoning' | 'writing' | 'tooluse' | 'vision' | 'longctx'
export const DIMS: Dim[] = ['code', 'reasoning', 'writing', 'tooluse', 'vision', 'longctx']
export interface RouteTarget { provider: string; model: string }
export interface CandidateMeta extends RouteTarget {
  modalities: string[]
  costTier: 'cheap' | 'mid' | 'expensive'
  available: boolean
}
/** 0.4.x：插件固定的 Kimi provider 路由（pi-ai catalog 原生名）。 */
export const KIMI_PROVIDER = 'kimi-coding'
export interface RouterConfigV3 {
  version: 3
  mode: 'off' | 'cost' | 'capability'
  default: RouteTarget
  candidates: RouteTarget[]
  scores: Record<string, Partial<Record<Dim, number>>>
  classify: { patterns?: Record<string, string[]> }
  allowedProviders: string[]
  costTiers: Record<string, 'cheap' | 'mid' | 'expensive'>
  routeThreshold: number
  lambda: number
  premiumBudget: number
  budgetWindow: number
  charsPerToken: number
}
export const configKey = (t: RouteTarget): string => `${t.provider}/${t.model}`
export function DEFAULT_CONFIG_V3(): RouterConfigV3 {
  return {
    version: 3, mode: 'off',
    default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    candidates: [{ provider: KIMI_PROVIDER, model: 'kimi-for-coding' }],
    scores: {}, classify: {}, allowedProviders: [KIMI_PROVIDER, 'deepseek-official'],
    costTiers: {}, routeThreshold: 0.75, lambda: 0.5,
    premiumBudget: 0.2, budgetWindow: 20, charsPerToken: 2,
  }
}
```

`src/migrate.ts` 全文替换为：

```ts
import { DEFAULT_CONFIG_V3, KIMI_PROVIDER, type RouterConfigV3, type RouteTarget } from './config.js'

function target(v: unknown): RouteTarget | null {
  const r = (v ?? {}) as Record<string, unknown>
  if (typeof r.provider !== 'string' || typeof r.model !== 'string') return null
  return { provider: r.provider, model: r.model }
}

/** provider 值改名：'kimi-tide' → KIMI_PROVIDER，其余原样（空串表示缺失）。 */
function renameProvider(p: unknown): string {
  return p === 'kimi-tide' ? KIMI_PROVIDER : typeof p === 'string' ? p : ''
}
/** 'kimi-tide/xxx' 键前缀改名 → 'kimi-coding/xxx'。 */
function renameKey(k: string): string {
  return k.startsWith('kimi-tide/') ? `${KIMI_PROVIDER}/${k.slice('kimi-tide/'.length)}` : k
}

/**
 * v2 → v3 迁移（spec §3.3）：把 default/candidates/allowedProviders 中的
 * provider 'kimi-tide' 改写为 'kimi-coding'，scores/costTiers 键前缀同步改写，
 * 其余字段原样；version 置 3。幂等：已是 v3 且无 kimi-tide 残留 → 原引用返回。
 * 输入假定为结构合格的 v2 形（调用方已做结构校验，见 sidecar.validate /
 * commands.parseImportedFile / 命名空间 scope.get()）。
 */
export function migrateV2(raw: unknown): RouterConfigV3 {
  const base = DEFAULT_CONFIG_V3()
  const r = (raw ?? {}) as Record<string, unknown>
  const residue = JSON.stringify([r.default, r.candidates, r.allowedProviders, r.scores, r.costTiers]).includes('kimi-tide')
  if (r.version === 3 && !residue) return raw as RouterConfigV3
  const d = (r.default ?? {}) as Record<string, unknown>
  const candidates = Array.isArray(r.candidates) ? r.candidates : base.candidates
  const allowed = Array.isArray(r.allowedProviders) ? r.allowedProviders : base.allowedProviders
  const scores: Record<string, unknown> = {}
  for (const [k, v] of Object.entries((r.scores ?? {}) as Record<string, unknown>)) scores[renameKey(k)] = v
  const costTiers: Record<string, unknown> = {}
  for (const [k, v] of Object.entries((r.costTiers ?? {}) as Record<string, unknown>)) costTiers[renameKey(k)] = v
  return {
    version: 3,
    mode: r.mode === 'off' || r.mode === 'cost' || r.mode === 'capability' ? r.mode : base.mode,
    default: { provider: renameProvider(d.provider) || base.default.provider, model: typeof d.model === 'string' ? d.model : base.default.model },
    candidates: candidates.map((c) => {
      const t = (c ?? {}) as Record<string, unknown>
      return { provider: renameProvider(t.provider) || base.candidates[0].provider, model: typeof t.model === 'string' ? t.model : base.candidates[0].model }
    }),
    scores,
    classify: (r.classify ?? base.classify) as RouterConfigV3['classify'],
    allowedProviders: allowed.map((p) => renameProvider(p) || KIMI_PROVIDER),
    costTiers,
    routeThreshold: typeof r.routeThreshold === 'number' ? r.routeThreshold : base.routeThreshold,
    lambda: typeof r.lambda === 'number' ? r.lambda : base.lambda,
    premiumBudget: typeof r.premiumBudget === 'number' ? r.premiumBudget : base.premiumBudget,
    budgetWindow: typeof r.budgetWindow === 'number' ? r.budgetWindow : base.budgetWindow,
    charsPerToken: typeof r.charsPerToken === 'number' ? r.charsPerToken : base.charsPerToken,
  }
}

/** v1（0.2.x）→ v3：旧逻辑产出 v2 形（base 已 v3），再过 migrateV2 收尾改名。 */
export function migrateV1(raw: unknown, warn: (m: string) => void): RouterConfigV3 {
  const base = DEFAULT_CONFIG_V3()
  const r = (raw ?? {}) as Record<string, unknown>
  const primary = target(r.primary)
  const premium = target(r.premium)
  if (primary === null && premium === null) return base
  if (r.premiumLong !== undefined) warn('dsh-kimi-tide: premiumLong 已废弃（0.3.0），迁移时丢弃')
  return migrateV2({
    version: 2,
    mode: r.mode === 'cost' || r.mode === 'capability' ? r.mode : 'off',
    default: primary ?? base.default,
    candidates: premium !== null ? [premium] : base.candidates,
    premiumBudget: typeof r.premiumBudget === 'number' ? r.premiumBudget : base.premiumBudget,
    budgetWindow: typeof r.budgetWindow === 'number' ? r.budgetWindow : base.budgetWindow,
    charsPerToken: typeof r.charsPerToken === 'number' ? r.charsPerToken : base.charsPerToken,
  })
}

/** 版本分派迁移入口：3 → 直通；2 → migrateV2；其余 → v1 链。 */
export function coerceRouterConfig(raw: unknown, warn: (m: string) => void): RouterConfigV3 {
  const v = (raw as { version?: unknown } | null)?.version
  if (v === 3) return raw as RouterConfigV3
  if (v === 2) return migrateV2(raw)
  return migrateV1(raw, warn)
}

/** 命名空间用户层残留检测（Task 5）：version≠3 或序列化含 'kimi-tide'。 */
export function hasKimiTideResidue(config: unknown): boolean {
  const v = (config as { version?: unknown } | null)?.version
  if (v !== 3) return true
  return JSON.stringify(config).includes('kimi-tide')
}
```

`src/scores.ts`：`SCORES_VERSION = 2` → `3`；BASELINE 键 `'kimi-tide/k3'`→`'kimi-coding/k3'`、`'kimi-tide/kimi-for-coding'`→`'kimi-coding/kimi-for-coding'`；注释里的 `kimi-tide/` 引用同步改为 `kimi-coding/`。

`src/classify.ts`：L18 改为 `if (m === null || m[1] === 'kimi') return m?.[1] === 'kimi' ? KIMI_PROVIDER : null`，并 `import { KIMI_PROVIDER } from './config.js'`。

`src/client/CandidateList.tsx` L28：`const PROVIDER_OPTIONS = ['kimi-coding', 'deepseek-official']`。

`src/settings-schema.ts`：
- L10 `const D = DEFAULT_CONFIG_V3()`（同步更新其上注释：schema 无法参数化，固定取生产 provider 'kimi-coding'）；
- version 行改为 `version: Schema.union([Schema.const(2), Schema.const(3)]).default(D.version)`，注释说明：宽松读取存量 v2 用户层（dsh-settings 契约：存量节校验失败会拒绝整个命名空间注册），Task 5 一次性迁移归 3；
- `mergeResolved(entry: unknown, providerName: string)` → `mergeResolved(entry: unknown): RouterConfigV3`（内部 `DEFAULT_CONFIG_V3()`）。

- [ ] **Step 4: 全库机械改名（保持全绿）**

在 `packages/dsh-kimi-tide` 下执行（或等价手工编辑），**逐项核对例外清单**：

```bash
# 1) 类型与工厂改名
#    RouterConfigV2 → RouterConfigV3
#    DEFAULT_CONFIG_V2( → DEFAULT_CONFIG_V3(   （随后删掉参数 'kimi-tide'）
#    routerConfigToV2 → routerConfigToV3（src/index.ts）
# 2) provider 字面量改名（严格带引号，只匹配 provider 值）
#    'kimi-tide' → 'kimi-coding'      （src + test）
#    "kimi-tide" → "kimi-coding"      （src + test）
#    kimi-tide/  → kimi-coding/       （scores 键、YAML 夹具中的键前缀；src + test）
# 3) 例外清单（保持原样，不得命中）：
#    'dsh-kimi-tide'  'kimi-tide-router'  'kimi-tide/panel'  'Kimi Code (kimi-tide)'
#    日志前缀 kimi-tide:  命令 /kimi-tide  注释中描述插件身份处
```

用 PowerShell 执行（在 `packages/dsh-kimi-tide` 目录）：

```powershell
Get-ChildItem src,test -Recurse -Include *.ts,*.tsx | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  # 例外保护：先占位 'kimi-tide/panel' 投影键（Global Constraints 固定标识），
  # 再替换 provider 值/键，最后还原占位。
  $c = $c -replace "'kimi-tide/panel'","'KIMI_TIDE_PANEL_PLACEHOLDER'"
  $c = $c -replace 'RouterConfigV2','RouterConfigV3'
  $c = $c -replace 'DEFAULT_CONFIG_V2\(','DEFAULT_CONFIG_V3()'
  $c = $c -replace "'kimi-tide'(?=[^-\w/])","'kimi-coding'"
  $c = $c -replace '"kimi-tide"(?=[^-\w/])','"kimi-coding"'
  $c = $c -replace 'kimi-tide/','kimi-coding/'
  $c = $c -replace "'KIMI_TIDE_PANEL_PLACEHOLDER'","'kimi-tide/panel'"
  Set-Content $_.FullName -Value $c -NoNewline -Encoding UTF8
}
```

注意 `DEFAULT_CONFIG_V3()` 后残留的 `('kimi-tide')` 参数要手工清掉（正则只替换了前缀）。逐个 grep 核对：`grep -rn "'kimi-tide'" src test` 应只剩 migrate.test.ts 的 v1/v2 **输入**夹具与注释；`grep -rn "RouterConfigV2" src test` 应为 0；`grep -rn "kimi-tide/panel" src test` 必须原样保留 4+ 处（投影键）。`src/index.ts` 里 `routerConfigToV2`→`routerConfigToV3`、`DEFAULT_ROUTER_CONFIG` 的 premium/premiumLong provider 也按 #2 规则改名（此刻 index.ts 仍在 apply() 里引用 adapter/oauth——那是 Task 4 的活，本次只改名字）。`src/settings.ts` 的 ROW_ANCHOR（`- id: dsh-kimi-tide`）在例外清单内，不得改。`src/index.ts` 的 `DEFAULT_CONFIG_V2(providerName)` 调用点改 `DEFAULT_CONFIG_V3()`（providerName 变量仍在，Task 4 删除）。

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: 全绿（改名后的期望值已在夹具中同步翻转；migrate.test.ts 的新用例过）。若有断言仍写旧名，按「夹具期望值 = 迁移后值」修正，**不得**改回 `kimi-tide`。

- [ ] **Step 6: typecheck + 提交**

Run: `npm run typecheck` → 0 错误。
Commit:

```bash
git add src test
git commit -m "refactor(config): RouterConfigV3 + kimi-tide → kimi-coding 迁移链（migrateV2/coerceRouterConfig，spec 0.4.x Task 1）
```

---

### Task 2: sidecar / commands 的 v3 读写链（含 .pre-v3 留档）

**Files:**
- Modify: `packages/dsh-kimi-tide/src/sidecar.ts`（validate 走 coerce + v2 文件写回迁移 + .pre-v3 留档）
- Modify: `packages/dsh-kimi-tide/src/commands.ts`（parseImportedFile 走 coerce、mergeInlineText version=3）
- Modify: `packages/dsh-kimi-tide/test/sidecar.test.ts`、`test/commands.test.ts`、`test/integration.test.ts`
- Test: `packages/dsh-kimi-tide/test/sidecar.test.ts`

**Interfaces:**
- Consumes: `coerceRouterConfig(raw, warn)`、`migrateV1(raw, warn)`（Task 1）。
- Produces: `RouterSidecarStore.load()` 对 v2 文件返回**已迁移的 v3 配置**、落 `.pre-v3` 副本并回写 v3 文件；`RouterSidecarStore.validate` 内部（私有）。

- [ ] **Step 1: 写失败测试（sidecar.test.ts 追加）**

```ts
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RouterSidecarStore } from '../src/sidecar.js'

const V2_YAML = [
  'version: 2',
  'mode: capability',
  'default:',
  '  provider: kimi-tide',
  '  model: k3',
  'candidates:',
  '  - provider: kimi-tide',
  '    model: k3',
  '  - provider: deepseek-official',
  '    model: deepseek-v4-flash',
  'allowedProviders:',
  '  - kimi-tide',
  '  - deepseek-official',
  'scores:',
  '  kimi-tide/k3:',
  '    code: 4.7',
].join('\n')

describe('sidecar v2 → v3 迁移', () => {
  it('loads a v2 sidecar as migrated v3, archives .pre-v3 and rewrites the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kt-sidecar-v3-'))
    try {
      const file = join(dir, 'kimi-tide-router.yml')
      writeFileSync(file, V2_YAML, 'utf8')
      const store = new RouterSidecarStore({ file, onError: () => {} })
      const loaded = store.load()
      expect(loaded.source).toBe('sidecar')
      expect(loaded.config!.version).toBe(3)
      expect(loaded.config!.default).toEqual({ provider: 'kimi-coding', model: 'k3' })
      expect(loaded.config!.allowedProviders).toEqual(['kimi-coding', 'deepseek-official'])
      expect(loaded.config!.scores).toEqual({ 'kimi-coding/k3': { code: 4.7 } })
      expect(existsSync(file + '.pre-v3')).toBe(true)
      // 回写后文件是 v3：再 load 不重复迁移、不留第二份 .pre-v3
      const again = new RouterSidecarStore({ file, onError: () => {} }).load()
      expect(again.config!.version).toBe(3)
      expect(again.config!.default.provider).toBe('kimi-coding')
      expect(readFileSync(file + '.pre-v3', 'utf8')).toContain('provider: kimi-tide')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes a v3 sidecar through untouched (no archive, no rewrite)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kt-sidecar-v3b-'))
    try {
      const file = join(dir, 'kimi-tide-router.yml')
      const v3 = { version: 3, mode: 'off' as const, default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, candidates: [{ provider: 'kimi-coding', model: 'kimi-for-coding' }] }
      const store = new RouterSidecarStore({ file, onError: () => {} })
      store.save(v3)
      const out = store.load()
      expect(out.config!.version).toBe(3)
      expect(existsSync(file + '.pre-v3')).toBe(false)
      expect(out.config!.candidates[0].provider).toBe('kimi-coding')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

（`existsSync` 需要从 `node:fs` import，补在文件头。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/sidecar.test.ts`
Expected: FAIL——v2 文件 load 后 version 仍 2、无 `.pre-v3`。

- [ ] **Step 3: 实现 sidecar.ts**

`load()` 的成功分支改为：

```ts
try {
  const raw = YAML.parse(readFileSync(this.o.file, 'utf8')) as unknown
  const config = this.validate(raw)
  // v2→v3 写回迁移（spec §3.3）：旧文件留档 .pre-v3 后把迁移结果写回，
  // 使后续 load 走直通路径（幂等；settings 宿主随后整体导入并留档 .legacy-imported）。
  if ((raw as { version?: unknown })?.version === 2) {
    try { copyFileSync(this.o.file, this.o.file + '.pre-v3') } catch (error) {
      this.o.onError(`dsh-kimi-tide: sidecar .pre-v3 留档失败（${(error as Error).message}）`)
    }
    this.save(config)
  }
  return { config, source: 'sidecar' }
} catch (error) { /* 原 .corrupt 逻辑不动 */ }
```

`validate()` 改为：

```ts
private validate(raw: unknown): RouterConfigV3 {
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.version === 3 || r.version === 2) {
    // 损坏永不崩：半损坏 v2/v3 直通会导致 configKey(config.default) 抛 TypeError
    const d = (r.default ?? {}) as Record<string, unknown>
    if (typeof d.provider !== 'string' || typeof d.model !== 'string') {
      throw new Error('sidecar 结构不合格：default.provider/default.model 缺失或非字符串')
    }
    if (!Array.isArray(r.candidates)) {
      throw new Error('sidecar 结构不合格：candidates 缺失或非数组')
    }
    return coerceRouterConfig(raw, this.o.onError)
  }
  return migrateV1(raw, this.o.onError)   // 旧形状 sidecar 也走迁移（收尾 v3）
}
```

文件头 import 更新：`import { coerceRouterConfig, migrateV1 } from './migrate.js'`、`import { DEFAULT_CONFIG_V3, type RouterConfigV3 } from './config.js'`（`RouterConfigV3` 替代原 `RouterConfigV2` 类型引用）。

- [ ] **Step 4: commands.ts 同步**

- `parseImportedFile`：`if (r.version === 2)` 改为 `if (r.version === 3 || r.version === 2)`，结构检查后 `return coerceRouterConfig(raw, () => {})`（替代原 `return raw as RouterConfigV2`）；错误文案 `'config v2 结构不合格'` → `'config v3 结构不合格'`；`return migrateV1(raw, () => {})` 不变。
- `mergeInlineText`：`merged.version = 2` → `merged.version = 3`。
- import：`import { coerceRouterConfig, migrateV1 } from './migrate.js'`；`RouterConfigV2` → `RouterConfigV3`（类型引用）。
- 文件头注释里 "subcommands (0.3.0, v2)" 与 SETTABLE_KEYS 注释的 "v2" 字样更新为 "v3"（仅注释）。

- [ ] **Step 5: 更新受影响的既有断言**

`test/commands.test.ts`、`test/integration.test.ts`：`expect(...version).toBe(2)` → `toBe(3)`（integration.test.ts L209 等）；Task 1 机械改名未覆盖的手写 YAML 夹具（如 commands.test.ts L73/L170/L196、integration.test.ts L193-199 的 `kimi-tide/kimi-for-coding` 键）已由 `kimi-tide/` → `kimi-coding/` 规则命中，逐条确认。

- [ ] **Step 6: 全量测试 + typecheck + 提交**

Run: `npm test && npm run typecheck`
Commit:

```bash
git add src test
git commit -m "feat(sidecar): v2→v3 写回迁移 + .pre-v3 留档；commands 导入链走 coerceRouterConfig（spec 0.4.x Task 2）
```

---

### Task 3: UsageMonitor 改 API key 鉴权

**Files:**
- Modify: `packages/dsh-kimi-tide/src/usage.ts`（resolveKey 缝、去 OAuth、401 不再刷新重试）
- Modify: `packages/dsh-kimi-tide/test/usage.test.ts`（重写配额部分）
- Test: `packages/dsh-kimi-tide/test/usage.test.ts`

**Interfaces:**
- Consumes: 无新依赖（oauth.ts 的 import 删除；本地统计部分 Task 6 删）。
- Produces: `new UsageMonitor(options: { pollMs; onUpdate; resolveKey: () => Promise<string | null>; fetchFn?; now? })`；`refresh()`/`snapshot()`/`start()`/`stop()` 签名不变。本地统计 API（`tapUsage`/`snapshot().local`）**暂保留**（Task 6 删）。

- [ ] **Step 1: 写失败测试（usage.test.ts 重写配额段）**

```ts
import { describe, expect, it, vi } from 'vitest'
import { UsageMonitor } from '../src/usage.js'

const USAGES_OK = {
  usage: { used: 9, limit: 100, resetTime: 'w' },
  limits: [{ used: 10, limit: 100, resetTime: 'f' }],
  user: { membership: { level: 'LEVEL_INTERMEDIATE' } },
}

function fetchResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

describe('UsageMonitor quota polling (API key auth)', () => {
  it('resolves the key per refresh and sends it as Bearer', async () => {
    const resolveKey = vi.fn(async () => 'sk-abc')
    const fetchFn = vi.fn(async () => fetchResponse(200, USAGES_OK))
    const monitor = new UsageMonitor({ pollMs: 60000, onUpdate: () => {}, resolveKey, fetchFn: fetchFn as unknown as typeof fetch, now: () => 1000 })
    await monitor.refresh()
    expect(monitor.snapshot().quota?.weekly.used).toBe(9)
    expect(resolveKey).toHaveBeenCalledOnce()
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-abc' })
  })

  it('does not fetch when the key is unresolvable (null)', async () => {
    const fetchFn = vi.fn()
    const monitor = new UsageMonitor({ pollMs: 60000, onUpdate: () => {}, resolveKey: async () => null, fetchFn: fetchFn as unknown as typeof fetch })
    await monitor.refresh()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(monitor.snapshot().quota).toBeNull()
  })

  it('on 401 marks stale without any refresh-retry (no OAuth anymore)', async () => {
    const fetchFn = vi.fn(async () => fetchResponse(401, {}))
    const monitor = new UsageMonitor({ pollMs: 60000, onUpdate: () => {}, resolveKey: async () => 'sk-abc', fetchFn: fetchFn as unknown as typeof fetch })
    await monitor.refresh()
    await monitor.refresh()
    expect(fetchFn).toHaveBeenCalledTimes(2)   // 每次 refresh 只拉一次，无重试
    expect(monitor.snapshot().quota).toBeNull()
  })

  it('on persistent failure keeps the old snapshot and marks it stale', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(fetchResponse(200, USAGES_OK))
      .mockResolvedValue(fetchResponse(500, {}))
    const monitor = new UsageMonitor({ pollMs: 60000, onUpdate: () => {}, resolveKey: async () => 'sk-abc', fetchFn: fetchFn as unknown as typeof fetch })
    await monitor.refresh()
    await monitor.refresh()
    expect(monitor.snapshot().quota?.stale).toBe(true)
  })

  it('throttles onUpdate notifications (2s window)', async () => {
    let now = 0
    const onUpdate = vi.fn()
    const fetchFn = vi.fn(async () => fetchResponse(200, USAGES_OK))
    const monitor = new UsageMonitor({ pollMs: 60000, onUpdate, resolveKey: async () => 'sk-abc', fetchFn: fetchFn as unknown as typeof fetch, now: () => now })
    await monitor.refresh()
    await monitor.refresh()
    expect(onUpdate).toHaveBeenCalledOnce()
    now = 3000
    await monitor.refresh()
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })
})

// 本地统计 describe 段（accumulates today/session…）本任务保留，Task 6 删除
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/usage.test.ts`
Expected: 编译失败（构造签名变了）+ 用例红。

- [ ] **Step 3: 实现 usage.ts**

- 删 `import type { KimiOAuthManager } from './oauth.js'`。
- `UsageMonitorOptions` 增 `resolveKey: () => Promise<string | null>`，删除 oauth 构造参数。
- `fetchQuota` 替换为：

```ts
private async fetchQuota(): Promise<QuotaSnapshot | null> {
  // 每次轮询现取 key（dsh-credentials 契约：per-operation read）。
  const key = await this.options.resolveKey()
  if (key === null) return null
  try {
    const response = await this.fetchFn(USAGES_URL, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    })
    if (!response.ok) return null
    return parseQuotaSnapshot(await response.json(), this.now())
  } catch {
    return null
  }
}
```

- `refresh()` 去掉 `retried` 语义（保持原逻辑：snapshot 非 null 更新，否则旧值标 stale）。`tapUsage`/`local`/`rollDayIfNeeded`/`addUsage` **原样保留**（Task 6 删）。文件头注释更新为「official quota polling (GET /coding/v1/usages) via API key」。

- [ ] **Step 4: 全量测试 + typecheck + 提交**

Run: `npm test && npm run typecheck`
Commit:

```bash
git add src test
git commit -m "feat(usage): UsageMonitor 改 API key 鉴权（resolveKey 缝；401 不再刷新重试，spec 0.4.x Task 3）
```

---

### Task 4: index.ts 拆线重接 + 自研接入层退役删除

**Files:**
- Delete: `packages/dsh-kimi-tide/src/oauth.ts`、`src/adapter.ts`、`src/context.ts`、`src/stream.ts`、`test/adapter-usage.test.ts`、`test/context.test.ts`
- Modify: `packages/dsh-kimi-tide/src/index.ts`（拆线、Config 清理、resolveKey 接线、modelOptions.kimi 异步化、settings-migration 去 providerName）
- Modify: `packages/dsh-kimi-tide/src/settings-migration.ts`（MigrationDeps 去 providerName、mergeResolved 单参）
- Modify: `packages/dsh-kimi-tide/test/index-apply.test.ts`、`test/index-wiring.test.ts`、`test/integration.test.ts`
- Test: `packages/dsh-kimi-tide/test/index-apply.test.ts`（新增 resolveKey/接线断言）

**Interfaces:**
- Consumes: `resolveKey` 依赖 `ctx.get('settings')`（读 `llm-pi-ai` 节的 `providers['kimi-coding'].apiKeyEnv`，兜底 `'KIMI_API_KEY'`）与 `ctx.get('credentials')`（`resolve(ref)`，兜底 `process.env`）；`mergeResolved(entry)` 单参（Task 1）。
- Produces: `apply(ctx, config)` 的新 Config 面（删 `providerName`/`kimiHome`/`refreshIntervalMs`/`refreshOnStart`）；`UsageMonitor` 以 `{ resolveKey }` 构造；`KimiTidePanelProjection.models.kimi` 改由 `ctx.llm.listModels('kimi-coding')` 异步供给。

- [ ] **Step 1: 写失败测试（index-apply.test.ts 新增）**

```ts
it('面板 models.kimi 来自 ctx.llm.listModels("kimi-coding")（异步枚举，无 adapter）', async () => {
  const agent: FakeAgent = { session: { append: vi.fn() } }
  const { ctx } = makeCtx([agent])
  apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const snapshot = agent.session.append.mock.calls.at(-1)?.[1] as { models?: { kimi: string[] } }
  expect(snapshot.models?.kimi).toEqual(['kimi-for-coding'])
})
```

（`makeCtx` 的 fake llm 本任务同步改为 `listProviders` 含 `kimi-coding` 且 `listModels` 对 `kimi-coding` 返回模型——见 Step 4 测试更新说明。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/index-apply.test.ts`
Expected: FAIL——`models.kimi` 为空/未定义（当前实现同步取 `adapter.listModelIds()`）。

- [ ] **Step 3: 实现 index.ts**

按顺序做以下编辑（其余逻辑不动）：

1. **删 import**：`import { KimiAdapter } from './adapter.js'`、`import { KimiOAuthManager } from './oauth.js'`。删 `./context.js`/`./stream.js` 相关（index.ts 未直接 import 它们，无需处理）。
2. **Config 接口**删 4 字段（providerName/kimiHome/refreshIntervalMs/refreshOnStart），注释同步。
3. **DEFAULT_ROUTER_CONFIG**：premium/premiumLong 的 provider → `'kimi-coding'`（Task 1 规则应已改）。
4. **routerConfigToV2 → routerConfigToV3**：`const v2 = DEFAULT_CONFIG_V3()`（内部命名同步），返回类型 `RouterConfigV3`；注释更新。
5. **apply() 拆线**：

```ts
export function apply(ctx: Context, config: Config = {}) {
  const log: RouterLog = { info: (message: string) => { ctx.logger.info(message) } }
  const warn = (message: string) => { ctx.logger?.warn?.(message) }

  // 0.4.x：零接入层——Kimi 模型经 settings.yaml 的 llm-pi-ai.providers.kimi-coding
  // 路由（官方 Models 页维护）进 DSH LLM 注册表。本插件只负责读该路由的
  // apiKeyEnv 引用名并解析 key（配额轮询用），永不触碰密钥本体。
  const kimiApiKeyEnv = (): string => {
    const settings = ctx.get('settings') as { get?: (ns: unknown) => unknown } | undefined
    const section = settings?.get?.('llm-pi-ai') as { providers?: Record<string, { apiKeyEnv?: string }> } | undefined
    return section?.providers?.['kimi-coding']?.apiKeyEnv ?? 'KIMI_API_KEY'
  }
  const resolveKey = async (): Promise<string | null> => {
    const env = kimiApiKeyEnv()
    const credentials = ctx.get('credentials') as { resolve?: (ref: string) => Promise<{ value: string } | undefined> } | undefined
    if (typeof credentials?.resolve === 'function') {
      try {
        const resolved = await credentials.resolve(env)
        if (resolved !== undefined && resolved.value.length > 0) return resolved.value
      } catch { /* 落到 env 兜底 */ }
    }
    const fromEnv = process.env[env]
    return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : null
  }

  // Panel data source: quota polling（本地 token 统计随接入层退役，Task 6 移除）。
  const monitor = new UsageMonitor({
    pollMs: config.usagePollMs ?? 60_000,
    onUpdate: () => pushPanelToAllSessions(),
    resolveKey,
  })

  // （删掉 oauth / adapter / registerAdapter / OAuth 刷新环整段）
  // （删掉 apply() 尾部 "OAuth refresh loop (0.1.x behavior)" 段）
```

6. **modelOptions 异步化**（替换原 L466-505 段）：

```ts
  let modelOptions: { kimi: string[]; deepseek: string[] } = { kimi: [], deepseek: [] }
  const refreshModelOptions = () => {
    const llm = ctx.llm as { listModels?: (provider: string) => Promise<Array<{ id: string }>> }
    if (typeof llm.listModels !== 'function') return
    void llm.listModels('kimi-coding')
      .then((models) => {
        modelOptions = { ...modelOptions, kimi: models.map((m) => m.id) }
        pushPanelToAllSessions()
      })
      .catch(() => { /* kimi-coding 路由未注册：下拉回退空列表，面板给接入指引 */ })
    void llm.listModels('deepseek-official')
      .then((models) => {
        modelOptions = { ...modelOptions, deepseek: models.map((m) => m.id) }
        pushPanelToAllSessions()
      })
      .catch(() => { /* deepseek adapter absent: dropdown falls back to free text */ })
  }
```

7. **settingsBase 段**（替换 L372-377）：

```ts
  const settingsBase: Partial<RouterConfigV3> =
    seedRaw === null || seedRaw === undefined
      ? DEFAULT_CONFIG_V3()
      : loaded.source === 'patch' && loaded.config !== null
        ? loaded.config
        : coerceRouterConfig(seedRaw, warn)
```

   （L354 `routerConfigV2` 类型引用改 `RouterConfigV3`；所有 `RouterConfigV2` 类型引用由 Task 1 机械改名覆盖。）

8. **settings 命名空间注册处**（L536 起，inject 回调内）：`SettingsScope<RouterConfigV3>`；`mergeResolved(entry)` 单参（删 providerName）；`migrateSidecarIntoScope` 调用删 `providerName` 字段。Task 5 再往该回调加 v3 迁移段。
9. **settings-migration.ts**：`MigrationDeps` 删 `providerName: string`；L26 改为 `deepEqualJson(d.scope.get(), mergeResolved(d.entry))`；import 的 `mergeResolved` 类型同步。
10. **依赖清理**：`@earendil-works/pi-ai`、`zod`（若不再被 src 引用）从 `package.json` dependencies 移除？——**先查后动**：`grep -rn "pi-ai\|zod" src`——zod 仍被 projection.ts 用（保留）；pi-ai 在 src 中若已无引用则从 dependencies 删除（lib/ 已编译产物无关），devDependencies 不动。本步骤只动 dependencies 的 pi-ai 一行。

- [ ] **Step 4: 更新受影响测试**

- `test/index-apply.test.ts` / `test/index-wiring.test.ts` / `test/integration.test.ts` 的 `makeCtx`：
  - `listProviders` 返回 `[{ id: 'kimi-coding', name: 'Kimi' }, { id: 'deepseek-official', name: 'DeepSeek' }, ...]`；
  - `listModels` 分支 `provider === 'kimi-coding' ? [{ id: 'kimi-for-coding' }] : ...`；
  - `resolveModelInfo` 的 `inputModalities` 分支同改；
  - `registerAdapter: () => {}` 保留（fake llm 面多余字段无害）。
- 所有 `apply(ctx, { ..., refreshOnStart: false })` 调用删掉 `refreshOnStart: false`（Config 已无此字段；TypeScript 多余属性在对象字面量上会报错——这正是要它报的点）。
- `test/index-wiring.test.ts` L345「parameterizes the namespace base by providerName」用例改为「无 composition seed 时 namespace base 固定 kimi-coding」：

```ts
  it('uses the fixed kimi-coding base when there is no composition seed', async () => {
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()
    const resolved = settings.get(NS) as RouterConfigV3
    expect(resolved.candidates[0].provider).toBe('kimi-coding')
    expect(resolved.allowedProviders).toContain('kimi-coding')
  })
```

- `test/index-wiring.test.ts` 其他用例中 `DEFAULT_CONFIG_V2('kimi-tide')` → `DEFAULT_CONFIG_V3()`（Task 1 规则应已改）；`premium: { provider: 'kimi-tide', ... }` 夹具 → `'kimi-coding'`。
- `test/integration.test.ts` L251-256 `apply(...refreshOnStart: false...)` 删除该字段；其余夹具随机械改名。

- [ ] **Step 5: 删除退役文件 + 校验无残留引用**

```bash
git rm src/oauth.ts src/adapter.ts src/context.ts src/stream.ts test/adapter-usage.test.ts test/context.test.ts
```

`grep -rn "oauth\|KimiAdapter\|KimiOAuthManager\|ensureAccessToken\|tapUsageChunk" src test` → 应为 0（`usage.ts` 的 tapUsage 本地统计 API 是自身定义，不算引用；`index.ts` 不再喂它）。

- [ ] **Step 6: 全量测试 + typecheck + 提交**

Run: `npm test && npm run typecheck`
Commit:

```bash
git add src test package.json package-lock.json
git commit -m "refactor(index): 拆线退役自研接入层（oauth/adapter/context/stream 删除）；UsageMonitor 接 resolveKey；models.kimi 异步枚举（spec 0.4.x Task 4）
```

（package.json/package-lock.json 只在第 10 步动了依赖时才 add。）

---

### Task 5: 设置命名空间 v2→v3 一次性迁移

**Files:**
- Modify: `packages/dsh-kimi-tide/src/index.ts`（inject 回调内迁移段）
- Modify: `packages/dsh-kimi-tide/test/index-wiring.test.ts`（新增迁移用例）
- Test: `packages/dsh-kimi-tide/test/index-wiring.test.ts`

**Interfaces:**
- Consumes: `hasKimiTideResidue(config)`、`migrateV2(raw)`（Task 1）；`SettingsProvider.documentPath`（dsh-settings 契约，getter 可能 undefined）。
- Produces: 命名空间 `kimi-tide-router` 用户层一次性归一 v3：迁移前快照文档 `.pre-v3`；在 sidecar 导入（migrateSidecarIntoScope）之前执行。

- [ ] **Step 1: 写失败测试（index-wiring.test.ts 追加）**

```ts
it('一次性迁移存量 v2 用户层（kimi-tide → kimi-coding，version 3，文档 .pre-v3 快照）', async () => {
  // 预置一个「用户编辑过」的 v2 命名空间节（0.3.0 面板写出来的形状）
  const seed = {
    [NS]: {
      version: 2, mode: 'capability',
      default: { provider: 'kimi-tide', model: 'k3' },
      candidates: [{ provider: 'kimi-tide', model: 'k3' }, { provider: 'deepseek-official', model: 'deepseek-v4-flash' }],
      allowedProviders: ['kimi-tide', 'deepseek-official'],
      scores: { 'kimi-tide/k3': { code: 4.7 } },
      classify: {}, costTiers: {}, routeThreshold: 0.75, lambda: 0.5, premiumBudget: 0.2, budgetWindow: 20, charsPerToken: 2,
    },
  }
  const settings = await bootSettings(seed)
  const agent: FakeAgent = { session: { append: vi.fn() } }
  const { ctx } = makeCtx([agent], settings)

  apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
  await tick()

  const resolved = settings.get(NS) as RouterConfigV3
  expect(resolved.version).toBe(3)
  expect(resolved.default).toEqual({ provider: 'kimi-coding', model: 'k3' })
  expect(resolved.allowedProviders).toEqual(['kimi-coding', 'deepseek-official'])
  expect(resolved.scores).toEqual({ 'kimi-coding/k3': { code: 4.7 } })
  // 用户编辑保留（非 dirty 跳过）；sidecar 不存在 → 无导入行为
  expect(existsSync(sidecarFile)).toBe(false)
})

it('干净的 v3 用户层不触发迁移（无替换写、无 .pre-v3 快照）', async () => {
  const settings = await bootSettings({ [NS]: { lambda: 0.31 } })
  const agent: FakeAgent = { session: { append: vi.fn() } }
  const { ctx } = makeCtx([agent], settings)
  apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
  await tick()
  const resolved = settings.get(NS) as RouterConfigV3
  expect(resolved.version).toBe(3)
  expect(resolved.lambda).toBe(0.31)
})
```

（内存测试 provider 的 `documentPath` 为 undefined——迁移段须在无 documentPath 时仅 warn 不崩；`.pre-v3` 快照的落盘由实机验收覆盖，单测只锁迁移语义。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/index-wiring.test.ts`
Expected: FAIL——存量 v2 节解析后 version 仍 2、provider 仍 kimi-tide（Task 4 后 schema 宽容读取但无人迁移）。

- [ ] **Step 3: 实现 index.ts 迁移段**

在 inject 回调内、`settingsScope = port` 之后、`applyConfig(scope.get())` 之前插入：

```ts
    // v3 一次性迁移（0.4.x，spec §3.3）：存量用户层（version 2 + kimi-tide/*）
    // 改写为 kimi-coding/*。必须在 applyConfig 与 sidecar 导入（脏检查）
    // 之前完成——迁移后的 scope 才是后续逻辑看到的基线。
    void (async () => {
      try {
        const current = scope.get()
        if (hasKimiTideResidue(current)) {
          const docPath = (sctx.settings as { documentPath?: string }).documentPath
          if (typeof docPath === 'string' && docPath.length > 0) {
            try { copyFileSync(docPath, docPath + '.pre-v3') } catch (error) {
              warn(`dsh-kimi-tide: 设置文档 .pre-v3 快照失败（${(error as Error).message}）`)
            }
          }
          await scope.replace(migrateV2(current) as unknown as object)
          warn('dsh-kimi-tide: 设置命名空间 kimi-tide-router 已迁移至 v3（kimi-coding/*）')
        }
      } catch (error) {
        warn(`dsh-kimi-tide: 命名空间 v3 迁移失败（${(error as Error).message}）；本次运行保留旧形状`)
      }
    })()
```

import 增补：`import { copyFileSync } from 'node:fs'`、`import { hasKimiTideResidue, migrateV2 } from './migrate.js'`。

- [ ] **Step 4: 全量测试 + typecheck + 提交**

Run: `npm test && npm run typecheck`
Commit:

```bash
git add src test
git commit -m "feat(settings): 命名空间 v2→v3 一次性迁移（hasKimiTideResidue + .pre-v3 文档快照，spec 0.4.x Task 5）
```

---

### Task 6: 面板数据形——删本地统计 + kimi 二态接入指示

**Files:**
- Modify: `packages/dsh-kimi-tide/src/types.ts`（删 LocalTokenStats/emptyLocalTokenStats；KimiTidePanelProjection 删 local、增 kimi）
- Modify: `packages/dsh-kimi-tide/src/projection.ts`（panelSchema 同步、stateVersion 3）
- Modify: `packages/dsh-kimi-tide/src/usage.ts`（删 tapUsage/local/rollDayIfNeeded/addUsage）
- Modify: `packages/dsh-kimi-tide/src/index.ts`（panelSnapshot 删 local 增 kimi；kimiStatus 维护 + 刷新触发）
- Modify: `packages/dsh-kimi-tide/src/client/TideDock.tsx`（删用量 chip、增接入指引 chip）
- Modify: `packages/dsh-kimi-tide/test/usage.test.ts`（删本地统计 describe）、`test/projection.test.ts`、`test/panel-v3.test.tsx`、`test/SettingsCard.test.tsx`（夹具适配）
- Test: `packages/dsh-kimi-tide/test/projection.test.ts`、`test/usage.test.ts`

**Interfaces:**
- Consumes: `resolveKey`（Task 4）、`UsageMonitor.snapshot()`（现只含 quota）。
- Produces: `KimiAccessStatus { route: boolean; key: boolean }`（types.ts）；投影新增必填 `kimi` 字段；`stateVersion: 3`。

- [ ] **Step 1: 写失败测试（projection.test.ts 改夹具）**

`panel()` 夹具：删 `local: emptyLocalTokenStats()`，增 `kimi: { route: true, key: true }`；新增：

```ts
it('projection v3：携带 kimi 二态接入指示，拒绝缺失字段', () => {
  const p = panel(1)
  p.candidates = []
  p.decision = null
  p.configSource = 'default'
  const out = parse(p)
  expect(out!.kimi).toEqual({ route: true, key: true })
  const { kimi: _kimi, ...rest } = p
  expect(() => parse(rest as never)).toThrow()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/projection.test.ts`
Expected: FAIL——schema 仍要求 local、无 kimi。

- [ ] **Step 3: 实现 types.ts / projection.ts / usage.ts**

- `types.ts`：删 `LocalTokenStats`、`emptyLocalTokenStats()`；`KimiTidePanelProjection` 删 `local: LocalTokenStats`，增：

```ts
/** 0.4.x 二态接入指示：kimi-coding 路由已注册（llm 目录）+ API key 可解析。 */
export interface KimiAccessStatus {
  route: boolean
  key: boolean
}
```

- `projection.ts`：`panelSchema` 删 `local` 块，增 `kimi: z.object({ route: z.boolean(), key: z.boolean() })`；`stateVersion: 2` → `3`；文件头注释同步（payload 含 quota + router + kimi 二态 + candidates + decision）。
- `usage.ts`：删 `tapUsage`、`snapshot().local` 返回、`rollDayIfNeeded`、`addUsage`、`emptyLocalTokenStats`/`LocalTokenStats` import；`snapshot()` 只返回 `{ quota }`；文件头注释删「local token bucket」字样。`TokenUsage` import 若不再用则删。

- [ ] **Step 4: 实现 index.ts kimiStatus**

```ts
  // 0.4.x 二态接入指示：路由注册 + key 可解析。缺任一 → 面板显示配置指引
  // （spec §3.5/验收 5）。刷新触发：启动、llm/adapters-updated、设置文档变化
  // （llm-pi-ai 节经 settings 服务提交）、配额轮询（顺带 60s 兜底）、
  // credentials/updated（凭据落盘即生效，无需重启）。
  let kimiStatus: KimiAccessStatus = { route: false, key: false }
  const refreshKimiStatus = async () => {
    let route = false
    try {
      route = (ctx.llm as unknown as LlmCatalog).listProviders().some((p) => p.id === 'kimi-coding')
    } catch { /* llm 不可用：保持 false */ }
    let key = false
    try { key = (await resolveKey()) !== null } catch { /* 同上 */ }
    if (route !== kimiStatus.route || key !== kimiStatus.key) {
      kimiStatus = { route, key }
      pushPanelToAllSessions()
    }
  }
  void refreshKimiStatus()
```

触发点接线：
- `llm/adapters-updated` 回调里加 `void refreshKimiStatus()`（原 refreshCandidates 旁）；
- monitor 的 `onUpdate` 回调里加 `void refreshKimiStatus()`（顺带兜底）；
- 新增 `ctx.on('credentials/updated', () => { void refreshKimiStatus(); void monitor.refresh() })`（事件未声明也不会崩——宿主无凭据服务时永不触发）。

`panelSnapshot()`：删 `local: monitor.snapshot().local`，增 `kimi: kimiStatus`。

- [ ] **Step 5: 实现 TideDock.tsx**

- 删 `inTok/outTok/cacheTok/cachePct` 计算与 `<span style={chip}>📥 …</span>` 行；
- 解构加 `kimi`：`const { quota, router, kimi } = panel`；
- 新增接入指引（放在路由 chips 之后、配额之前）：

```tsx
      {(!kimi.route || !kimi.key) && (
        <span style={chip} className="kt-warn" title="缺少 kimi-coding 路由或 API key（设置 → Models 配置，apiKeyEnv 指向你的凭据）">
          ⚠️ Kimi 未接入：设置 → Models
        </span>
      )}
```

- [ ] **Step 6: 适配其余测试**

- `test/usage.test.ts`：删「local token stats」describe 段（含 tapUsage 用例）；文件头 import 同步。
- `test/projection.test.ts`：夹具按 Step 1；`emptyLocalTokenStats` import 删除。
- `test/panel-v3.test.tsx` / `test/SettingsCard.test.tsx`：跑 `npm test`，修夹具中的 provider 名残留（若有）；这两组测试不触碰投影 `local` 字段则无需改。
- `test/index-apply.test.ts` / `test/index-wiring.test.ts`：快照断言若引用 `local` 则删除；`kimi` 字段断言用宽松匹配（fake ctx 无 credentials 且测试机环境变量不定）：`expect.objectContaining({ kimi: expect.objectContaining({ route: true }) })`。

- [ ] **Step 7: 全量测试 + typecheck + 提交**

Run: `npm test && npm run typecheck`
Commit:

```bash
git add src test
git commit -m "feat(panel): 删本地 token 统计（数据源随接入层退役）；投影 v3 增 kimi 二态接入指示（spec 0.4.x Task 6）
```

---

### Task 7: 打包元数据 + 脚本退役

**Files:**
- Modify: `packages/dsh-kimi-tide/package.json`（version 0.4.0；pi-ai 依赖若 Task 4 已删则核对）
- Modify: `packages/dsh-kimi-tide/cordis.patch.yml`（删 providerName/kimiHome/refresh* 键）
- Delete: `scripts/plugin-smoke.mjs`（仓库根，唯一调 OAuth 的脚本）
- Test: 无（构建验证）

**Interfaces:** 无新接口。

- [ ] **Step 1: package.json**

`"version": "0.1.3"` → `"0.4.0"`。description 若仍含「routes each agent step between Kimi (kimi-coding) and DeepSeek」则已符合（无需改）。确认 dependencies 里 `@earendil-works/pi-ai` 已删（Task 4 第 10 步）且 `zod` 保留。

- [ ] **Step 2: cordis.patch.yml 重写**

```yaml
# Bundle patch layer for dsh-kimi-tide (月汐).
# Applied when a profile lists this bundle (dsh plugin --profile <name> add .).
# A patch replaces a row's whole config; rows are addressed by id, later
# layers win. 0.4.x: the plugin owns NO access-layer code — Kimi models arrive
# via the llm-pi-ai `kimi-coding` route (Settings → Models) with an API key;
# this row only carries the router/panel knobs.
- insert:
    - id: dsh-kimi-tide
      name: dsh-kimi-tide
      config:
        # usagePollMs: 60000      # quota poll period (月汐 dock)
        # usagePollOnStart: true  # poll quota on startup
        # router:                 # legacy static seed; the 月汐 settings card owns the live config
        #   mode: off             # off | cost | capability
```

- [ ] **Step 3: 删脚本**

```bash
git rm scripts/plugin-smoke.mjs
```

先 `grep -rn "plugin-smoke" . --include=*.md --include=*.json --include=*.mjs` 确认无文档/脚本引用（README 若有提及一并处理，属 Task 8）。

- [ ] **Step 4: 构建验证**

Run: `npm test && npm run typecheck && npm run build`
Expected: 全绿 + `lib/` 重建无错。检查 `git status`：`lib/` 是否被 git 跟踪（`git check-ignore lib`）——被忽略则无需提交；被跟踪则 `git add lib` 一并提交（历史先例：0.3.0 提交含 lib 与否以 .gitignore 为准）。

Commit:

```bash
git add packages/dsh-kimi-tide scripts
git commit -m "chore(release): v0.4.0 打包面——bundle patch 去 OAuth 键、退役 plugin-smoke 脚本（spec 0.4.x Task 7）
```

---

### Task 8: GitHub Actions Release 流水线

**Files:**
- Create: `.github/workflows/release.yml`（仓库根）
- Modify: `packages/dsh-kimi-tide/package.json`（无——仅核对）
- Test: 无（CI 验证在发布时进行；本机 `node --check` 无法跑 YAML，人工核对缩进）

**Interfaces:** 无。

- [ ] **Step 1: 实读仓库构建事实（顶级规则：不假设）**

- 读仓库根 `package.json`：确认 workspace 布局（根是否 `"workspaces"`）、`npm ci` 在根还是 `packages/dsh-kimi-tide` 下跑、构建脚本入口。
- 读 `packages/dsh-kimi-tide/package.json`：确认 `scripts`（`build`/`test`/`typecheck`）与 `dsh.bundle.patch` 字段仍在（README「发布规范」历史教训：缺它导致 profile 层加载失败）。
- 读既有 Release 的 tgz 产物名规则（`npm pack` 默认 `dsh-kimi-tide-<version>.tgz`）。

- [ ] **Step 2: 创建工作流文件 `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Build
        working-directory: packages/dsh-kimi-tide
        run: npm run build
      - name: Test
        working-directory: packages/dsh-kimi-tide
        run: npm test
      - name: Version consistency check
        shell: bash
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          PKG_VERSION="$(node -p "require('./packages/dsh-kimi-tide/package.json').version")"
          if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
            echo "tag v${TAG_VERSION} != package.json ${PKG_VERSION}" >&2
            exit 1
          fi
      - name: Bundle-patch field guard
        shell: bash
        run: |
          node -e "
            const p = require('./packages/dsh-kimi-tide/package.json');
            if (!p.dsh?.bundle?.patch) { console.error('dsh.bundle.patch missing'); process.exit(1); }
          "
      - name: Pack
        working-directory: packages/dsh-kimi-tide
        run: npm pack
      - name: Publish GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        working-directory: packages/dsh-kimi-tide
        run: |
          gh release create "$GITHUB_REF_NAME" \
            --repo "$GITHUB_REPOSITORY" \
            --title "dsh-kimi-tide v${GITHUB_REF_NAME#v}" \
            --notes "Automated release from tag $GITHUB_REF_NAME（构建/测试通过，附 npm pack tgz）" \
            dsh-kimi-tide-*.tgz
```

（`gh` 在 ubuntu-latest 预装；`permissions.contents: write` 使 `github.token` 可建 Release。若根 `package.json` 不是 npm workspace 且 `npm ci` 需在 `packages/dsh-kimi-tide` 下跑，则把 `npm ci` 步骤的 `working-directory` 一并指过去——以 Step 1 实读为准。）

- [ ] **Step 3: 本地语法核对**

Run: `node --check` 不适用 YAML；用 `npx yaml-lint .github/workflows/release.yml` 若可用，否则人工核对缩进（2 空格、`on` 顶层键、`steps` 列表对齐）。检查 `.gitignore` 不忽略 `.github/`。

- [ ] **Step 4: 提交**

Commit:

```bash
git add .github
git commit -m "ci(release): tag 触发全自动发版（build/test/版本一致性/bundle-patch 守卫/npm pack + gh release，spec 0.4.x Task 8）
```

> 注：流水线首次实跑验证随 v0.4.0 打 tag 发布时进行（台账既有待办「随 0.3.0/0.4.0 首发验证」）。

---

### Task 9: 文档清扫

**Files:**
- Modify: `README.md`（仓库根：路线图/开发计划 notice/badge/测试数/快速开始提示语）
- Modify: `docs/legacy-setup.md`（「已被 0.4.x 取代」横幅）
- Modify: `packages/dsh-kimi-tide/docs/router-v3.md`（SCORES_VERSION 3、基线键 kimi-coding/*、接入层段）
- Modify: `docs/development-plan-router.md`、`docs/positioning.md` 等（grep 后按需）
- Modify: `docs/superpowers/specs/2026-08-20-api-key-direct-design.md`（状态行改「已实施」+ 待核实项 2 落锤注记）
- Test: 无（链接核对）

**Interfaces:** 无。

- [ ] **Step 1: 盘点现状**

`grep -rn "kimi-tide/" docs README.md packages/dsh-kimi-tide/README.md packages/dsh-kimi-tide/docs`——区分「provider 路由引用（要改 kimi-coding/）」与「插件身份/命令/命名空间引用（保留）」。

- [ ] **Step 2: README 更新**

- 「📌 开发计划（重要）」notice 删除或改为已发布说明（发布日期以实际为准）；路线图行 `0.4.x API key 直连 | 📐 设计定稿…` → `✅ 已发布 v0.4.0`（附实施 commit 锚点）；「快速开始（v0.4.0 形态）」下的「在此之前，源码构建仍是 0.1.x 的 OAuth 接入形态」提示删除；badge `Release-v0.1.3` → `Release-v0.4.0`、`Next%20Release-v0.4.0` 删除（中英两处，L11-12 与 L307-308）；测试数 badge 更新为实际（`npm test` 总数）；FAQ「v0.4.0 于 2026-08-21 发布」类表述改为已发布。
- 顺手核对：快速开始里 `apiKeyEnv` 建议（`KIMI_API_KEY`）与实现一致（本机实况为 `KIMI_CODING_API_KEY`——README 建议值保持 `KIMI_API_KEY`（pi-ai ambient 名），实现按路由配置实际引用名解析，两者都行，无需改）。

- [ ] **Step 3: legacy-setup.md 横幅**

文件顶部加：

```markdown
> ⚠️ **已被 0.4.x 取代**：v0.4.0 起 kimi-tide 走 pi-ai 原生 `kimi-coding` 路由 + Console API Key（见 README 快速开始），本文档的定时任务/OAuth 方案仅作历史存档，不再适用。
```

- [ ] **Step 4: router-v3.md / 其他 docs**

- `router-v3.md`：SCORES_VERSION 2→3、基线表键 `kimi-tide/` → `kimi-coding/`、接入层段落更新（OAuth 退役 → pi-ai 原生路由 + API key）。
- `development-plan-router.md` / `positioning.md` 等：grep 命中的 provider 路由引用更新；「接入层」相关状态行补 0.4.x 完结注记。
- `README.md` 内相对链接复验：`grep -oE '\]\([^)]+' README.md docs -r` 逐个解析（相对文件存在性），0 断链。

- [ ] **Step 5: spec 状态更新**

spec 头部「状态：设计已定稿（用户三项裁决批准），待实施（预计 2026-08-21，随 v0.4.0 发布）」改为「已实施（YYYY-MM-DD，commit <锚点>），随 v0.4.0 发布」；§6 待核实项 2 落锤注记：

```markdown
2. ~~`dsh-credentials-local` 对插件暴露的解析 API 形状~~ **已落锤（实施时实读）**：`ctx.credentials.resolve(CredentialRef) → { value, source }`（`@deepseek-ai/dsh-credentials` lib/types/index.d.ts:46-56）；apiKeyEnv 引用名从 `ctx.settings.get('llm-pi-ai')` 的 `providers['kimi-coding'].apiKeyEnv` 读取（`@deepseek-ai/dsh-llm-pi-ai` lib/types/config.d.ts:40-42，README.md:108），兜底 `'KIMI_API_KEY'` 与 `process.env`。
```

- [ ] **Step 6: 提交**

Commit:

```bash
git add README.md docs packages/dsh-kimi-tide/docs
git commit -m "docs: 0.4.x API key 直连落地（README/legacy-setup/router-v3/spec 状态与待核实落锤）
```

---

### Task 10: 终验与收尾

**Files:** 无新改动（验证 + 可选修复波）。

- [ ] **Step 1: 全量门禁**

Run（packages/dsh-kimi-tide 下）: `npm test && npm run typecheck && npm run build`
Expected: 全绿 + typecheck 0 + build 0。

- [ ] **Step 2: 残留扫描**

```bash
grep -rn "kimi-tide" src --include=*.ts --include=*.tsx | grep -v "dsh-kimi-tide\|kimi-tide-router\|kimi-tide/panel\|kimi-tide:" | grep "'kimi-tide'\|kimi-tide/"
grep -rn "RouterConfigV2\|DEFAULT_CONFIG_V2\|refreshOnStart\|providerName\|KimiOAuthManager\|KimiAdapter" src test
```

Expected: 均 0 命中（注释中描述迁移来源的除外）。

- [ ] **Step 3: 提交链审查 + 推送**

`git log --oneline -12` 核对 10 个任务的提交信息与 spec Task 编号对应；`git push`（沙箱禁网时按既有避坑记录流程：git 配置了 7897 代理，直接 push；若 schannel 失败按避坑记录重试）。

- [ ] **Step 4: 实机验收移交清单（用户侧，README/计划不落盘）**

按 spec §3.8 六项移交用户实机验收：① 设置卡片显示 `kimi-coding/*` 候选与 scores、`.pre-v3` 留档存在 ② capability 探针 `request/header = kimi-coding/k3` ③ 带图改道无 UNSUPPORTED_CONTENT ④ Console Key 下 `/usages` 出数（待核实项 1 落锤；拒绝则配额区指引文案）⑤ key 缺失报 `MISSING_CREDENTIAL` + 面板指引 ⑥ 未声明模型 `available:false` 标灰。另：本机 `settings.yaml` 的 `kimi-coding` 路由是否补 `k3-256k`/`kimi-for-coding` 声明（待核实项 3，用户决策）。
