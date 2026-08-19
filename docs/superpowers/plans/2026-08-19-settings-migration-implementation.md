# 设置界面迁移（settings.section + 原生设置命名空间）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把月汐路由器设置表单整体迁至 DSH 官方设置面板「月汐」卡片（`settings.section`），路由配置持久化迁至 DSH 设置文档原生命名空间 `kimi-tide-router`（revision 冲突检测 + base/user 分层），dock 面板退化为只读仪表。

**Architecture:** 宿主用官方 seam `installSettingsSection`（`@deepseek-ai/dsh-settings`）注册 schemastery schema，`patch.yml` 的 `router` 块作 base 层，scope.watch → onChange 复用现有 onSaved 热更新路径；客户端卡片经 `ctx.settingsScope.bind` 读写 + 嵌套字段走 `settings.mutate` 多段 path；现有 sidecar 一次性迁移进 user 层后改名留档，rc.6 无 settings 服务时回退 sidecar 只读路径。

**Tech Stack:** TypeScript + Cordis + schemastery（已是运行时依赖）+ esbuild client bundle；宿主 peer 新加 `@deepseek-ai/dsh-settings@^0.1.0-rc.7`；测试 vitest。

**Spec:** [`docs/superpowers/specs/2026-08-19-settings-migration-design.md`](../specs/2026-08-19-settings-migration-design.md)（本计划从 spec 立论，执行者两个文档都要读）

## Global Constraints

- 工作目录：`packages/dsh-kimi-tide/`；测试/typecheck/build 命令：`npm run test` / `npm run typecheck` / `npm run build`（仓库根 `npm run build` 亦同）
- 每个任务结束：该任务相关测试绿 + `npm run typecheck` 通过 + 独立 commit（message 前缀 `feat:` / `refactor:` / `test:` / `docs:`）
- 命名空间名：`kimi-tide-router`（小写 kebab-case，host 注册 + client bind 同一常量）
- 配置形状 = `RouterConfigV2`（`src/config.ts` 13 字段，含 `version: 2`）；schema 以 const 2 承载 version，**无需剥离**
- 宿主 owner scope 方法名（dsh-settings types.d.ts L85-111 实读）：`get()` / `watch(cb)` / **`update(patch)`**（合并 patch，非 `patch`）/ `replace(section)`；客户端 `set(field,value)` 单段 path、嵌套字段必须走 `connection.api.settings.mutate` 多段 path 数组
- rc.6 兼容红线：`@deepseek-ai/dsh-settings` 的导入必须**守卫式**（模块缺失时插件整体仍可加载并回退 sidecar 只读路径）；客户端卡片注册用 `ctx.slots.inject('settings.section', …)`（槽位声明不存在时永不注册，dock 不受影响）
- 不改路由器决策语义（classify/selectCandidate/护栏）；不改设置项集合
- 禁止向本计划未列出的文件引入改动；每个任务的代码块即实现内容，按字面落地

---

### Task 1: 宿主 RouterConfigV2 命名空间 schema

**Files:**
- Create: `src/settings-schema.ts`
- Test: `test/settings-schema.test.ts`
- Modify: `package.json`（peerDependencies + devDependencies 加 `@deepseek-ai/dsh-settings: ^0.1.0-rc.7` / `0.1.0-rc.7`；随后 `npm install` 让 lockfile 同步）

**Interfaces:**
- Consumes: `src/config.ts` 的 `DIMS`/`RouterConfigV2`/`DEFAULT_CONFIG_V2`；`src/settings.ts` 的 `RouterConfigSchema`（v1 先例，只读参考）
- Produces: `routerConfigSchema`（schemastery Schema，解析 RouterConfigV2）、`validateRouterConfig(raw: RouterConfigV2): string | undefined`（注册 validate 钩子，返回错误文案或 undefined）、`mergeResolved(entry: unknown, providerName: string): RouterConfigV2`（「schema 默认 + base(entry)」合并，供 T2 迁移纯净判定与 T4 使用）

- [ ] **Step 1: 安装依赖**

```bash
npm install --save-dev @deepseek-ai/dsh-settings@0.1.0-rc.7
```
并手工在 `package.json` 的 `peerDependencies` 加 `"@deepseek-ai/dsh-settings": "^0.1.0-rc.7"`（若 npm 自动加入 dependencies 则移回 devDependencies + 手写 peer）。运行 `npm install` 更新 lockfile。

- [ ] **Step 2: 写失败测试**

`test/settings-schema.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { mergeResolved, routerConfigSchema, validateRouterConfig } from '../src/settings-schema.js'
import { DEFAULT_CONFIG_V2, type RouterConfigV2 } from '../src/config.js'

describe('routerConfigSchema', () => {
  it('resolves a full valid config unchanged', () => {
    const cfg = DEFAULT_CONFIG_V2('kimi-tide')
    const out = routerConfigSchema(cfg) as RouterConfigV2
    expect(out).toEqual(cfg)
  })

  it('injects defaults for a bare section', () => {
    const out = routerConfigSchema({}) as RouterConfigV2
    expect(out.mode).toBe('off')
    expect(out.routeThreshold).toBe(0.75)
    expect(out.candidates).toEqual([{ provider: 'kimi-tide', model: 'kimi-for-coding' }])
  })

  it('rejects an invalid mode', () => {
    expect(() => routerConfigSchema({ ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'nope' })).toThrow()
  })

  it('rejects a malformed scores entry', () => {
    expect(() => routerConfigSchema({ ...DEFAULT_CONFIG_V2('kimi-tide'), scores: { 'kimi-tide/k3': { code: 7 } } })).toThrow()
  })
})

describe('validateRouterConfig', () => {
  const valid = () => validateRouterConfig({ ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'capability' })
  it('passes a well-formed config', () => { expect(valid()).toBeUndefined() })
  it('rejects a default target missing from candidates', () => {
    expect(validateRouterConfig({ ...DEFAULT_CONFIG_V2('kimi-tide'), default: { provider: 'x', model: 'y' } })).toMatch(/default/)
  })
  it('rejects out-of-range routeThreshold', () => {
    expect(validateRouterConfig({ ...DEFAULT_CONFIG_V2('kimi-tide'), routeThreshold: 5 })).toMatch(/routeThreshold/)
  })
})

describe('mergeResolved', () => {
  it('merges schema defaults under a patch entry (base layer)', () => {
    const entry = { mode: 'capability' }
    const out = mergeResolved(entry, 'kimi-tide')
    expect(out.mode).toBe('capability')
    expect(out.routeThreshold).toBe(0.75)  // schema default fills the rest
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run test/settings-schema.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 写实现**

```ts
// src/settings-schema.ts
import Schema from 'schemastery'
import { DIMS, DEFAULT_CONFIG_V2, type Dim, type RouterConfigV2 } from './config.js'

const dimSchema = Schema.object(Object.fromEntries(DIMS.map((d: Dim) => [d, Schema.number()])))
export const routerConfigSchema = Schema.object({
  version: Schema.const(2),
  mode: Schema.union([Schema.const('off'), Schema.const('cost'), Schema.const('capability')]),
  default: Schema.object({ provider: Schema.string(), model: Schema.string() }),
  candidates: Schema.array(Schema.object({ provider: Schema.string(), model: Schema.string() })),
  scores: Schema.dict(dimSchema),
  classify: Schema.object({ patterns: Schema.dict(Schema.array(Schema.string())).optional() }),
  allowedProviders: Schema.array(Schema.string()),
  costTiers: Schema.dict(Schema.union([Schema.const('cheap'), Schema.const('mid'), Schema.const('expensive')])),
  routeThreshold: Schema.number(),
  lambda: Schema.number(),
  premiumBudget: Schema.number(),
  budgetWindow: Schema.number(),
  charsPerToken: Schema.number(),
})

export function validateRouterConfig(raw: RouterConfigV2): string | undefined {
  const key = (t: { provider: string; model: string }) => `${t.provider}/${t.model}`
  const known = new Set(raw.candidates.map(key))
  if (!known.has(key(raw.default))) return `default target ${key(raw.default)} is not in candidates`
  for (const [name, range] of [['routeThreshold', 1], ['lambda', 1], ['premiumBudget', 1]] as const) {
    const v = raw[name]
    if (!Number.isFinite(v) || v < 0 || v > range) return `${name} out of range 0..${range}`
  }
  if (!Number.isInteger(raw.budgetWindow) || raw.budgetWindow <= 0) return 'budgetWindow must be a positive integer'
  if (raw.candidates.length === 0) return 'candidates must not be empty'
  return undefined
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return structuredClone(patch)
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = deepMerge(out[k], v)
  return out
}

export function mergeResolved(entry: unknown, providerName: string): RouterConfigV2 {
  const defaults = DEFAULT_CONFIG_V2(providerName)
  const resolved = deepMerge(defaults, entry) as RouterConfigV2
  return routerConfigSchema(resolved) as RouterConfigV2
}
```

> 注：schemastery 对 Record 用 `Schema.dict`；若 `Schema.const`/`Schema.dict` 在该版本 API 名称不同，以 `node_modules/schemastery` 类型为准调整（保持字段与默认值语义不变）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run test/settings-schema.test.ts` → PASS；再 `npm run typecheck` → 0 error

- [ ] **Step 6: Commit**

```bash
git add src/settings-schema.ts test/settings-schema.test.ts package.json package-lock.json
git commit -m "feat(settings): schemastery schema + validate hook for RouterConfigV2 namespace"
```

---

### Task 2: sidecar → 命名空间一次性迁移

**Files:**
- Create: `src/settings-migration.ts`
- Test: `test/settings-migration.test.ts`

**Interfaces:**
- Consumes: T1 的 `mergeResolved`；`deepEqualJson`（`@deepseek-ai/dsh-settings`，仅类型/运行时都可用）；`src/sidecar.ts` 的 `RouterSidecarStore.load()`
- Produces: `migrateSidecarIntoScope(deps): Promise<MigrationOutcome>`，其中
  `interface MigrationScope { get(): RouterConfigV2; replace(section: object): Promise<void> }`、
  `type MigrationOutcome = 'imported' | 'skipped-clean' | 'skipped-dirty' | 'no-sidecar'`

- [ ] **Step 1: 写失败测试**

`test/settings-migration.test.ts`（用临时目录 + fake scope）：

```ts
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { DEFAULT_CONFIG_V2, type RouterConfigV2 } from '../src/config.js'
import { mergeResolved } from '../src/settings-schema.js'
import { migrateSidecarIntoScope, type MigrationScope } from '../src/settings-migration.js'

function tmp(): string { return mkdtempSync(join(tmpdir(), 'kt-migrate-')) }
function fakeScope(current: RouterConfigV2) {
  const s: MigrationScope & { replaced: object | null } = {
    replaced: null,
    get: () => current,
    replace: async (section) => { s.replaced = section; current = section as RouterConfigV2 },
  }
  return s
}
const onError = () => {}

describe('migrateSidecarIntoScope', () => {
  it('imports an existing sidecar into the user layer and renames it', async () => {
    const dir = tmp()
    const file = join(dir, 'kimi-tide-router.yml')
    const cfg = { ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'capability' as const }
    writeFileSync(file, YAML.stringify(cfg), 'utf8')
    const scope = fakeScope(mergeResolved({}, 'kimi-tide'))
    const outcome = await migrateSidecarIntoScope({ sidecarFile: file, scope, entry: {}, providerName: 'kimi-tide', onError })
    expect(outcome).toBe('imported')
    expect((scope.replaced as RouterConfigV2).mode).toBe('capability')
    expect(existsSync(file)).toBe(false)
    expect(existsSync(file + '.legacy-imported')).toBe(true)
    expect(readFileSync(file + '.legacy-imported', 'utf8')).toContain('mode: capability')
    rmSync(dir, { recursive: true, force: true })
  })

  it('is a no-op when the sidecar is absent', async () => {
    const dir = tmp()
    const scope = fakeScope(mergeResolved({}, 'kimi-tide'))
    expect(await migrateSidecarIntoScope({ sidecarFile: join(dir, 'nope.yml'), scope, entry: {}, providerName: 'kimi-tide', onError })).toBe('no-sidecar')
    expect(scope.replaced).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('skips (dirty) when the user layer already differs from defaults+base', async () => {
    const dir = tmp()
    const file = join(dir, 'kimi-tide-router.yml')
    writeFileSync(file, YAML.stringify(DEFAULT_CONFIG_V2('kimi-tide')), 'utf8')
    const resolved = mergeResolved({}, 'kimi-tide')
    const dirty = { ...resolved, routeThreshold: 0.5 }
    const scope = fakeScope(dirty)
    const errors: string[] = []
    expect(await migrateSidecarIntoScope({ sidecarFile: file, scope, entry: {}, providerName: 'kimi-tide', onError: (m) => errors.push(m) })).toBe('skipped-dirty')
    expect(scope.replaced).toBeNull()
    expect(errors.some((m) => m.includes('跳过'))).toBe(true)
    expect(existsSync(file)).toBe(true)   // 未改名
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/settings-migration.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```ts
// src/settings-migration.ts
import { existsSync, renameSync } from 'node:fs'
import { deepEqualJson } from '@deepseek-ai/dsh-settings'
import type { RouterConfigV2 } from './config.js'
import { mergeResolved } from './settings-schema.js'
import { RouterSidecarStore } from './sidecar.js'

export interface MigrationScope { get(): RouterConfigV2; replace(section: object): Promise<void> }
export type MigrationOutcome = 'imported' | 'skipped-clean' | 'skipped-dirty' | 'no-sidecar'

export interface MigrationDeps {
  sidecarFile: string
  scope: MigrationScope
  entry: unknown                    // patch.yml router 块（composition entry）
  providerName: string
  onError: (m: string) => void
}

export async function migrateSidecarIntoScope(d: MigrationDeps): Promise<MigrationOutcome> {
  if (!existsSync(d.sidecarFile)) return 'no-sidecar'
  const store = new RouterSidecarStore({ file: d.sidecarFile, onError: d.onError })
  const loaded = store.load()
  if (loaded.config === null) return 'no-sidecar'   // 损坏已被 load 改名 .corrupt
  const clean = deepEqualJson(d.scope.get(), mergeResolved(d.entry, d.providerName))
  if (!clean) {
    d.onError('dsh-kimi-tide: 设置命名空间已有用户编辑，跳过 sidecar 迁移（保留 sidecar 未改名）；如需导入请先 /kimi-tide import-config')
    return 'skipped-dirty'
  }
  await d.scope.replace(loaded.config as unknown as object)
  try { renameSync(d.sidecarFile, d.sidecarFile + '.legacy-imported') } catch { /* 留档失败不阻塞 */ }
  return 'imported'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/settings-migration.test.ts` → PASS；`npm run typecheck` → 0

- [ ] **Step 5: Commit**

```bash
git add src/settings-migration.ts test/settings-migration.test.ts
git commit -m "feat(settings): one-shot sidecar → namespace migration with dirty-layer guard"
```

---

### Task 3: 命令族改读写命名空间（sidecar 降为兜底）

**Files:**
- Modify: `src/commands.ts`
- Test: `test/commands.test.ts`（更新既有断言 + 新增）

**Interfaces:**
- Consumes: T1 类型；`src/sidecar.ts` 现有 API
- Produces: `export interface SettingsNamespacePort { get(): RouterConfigV2; update(patch: object): Promise<void>; replace(section: object): Promise<void> }`；`KimiTideCommandDeps` 增加 `settings: SettingsNamespacePort | null`（null = 无 settings 服务，回退 sidecar 只读/写入）

- [ ] **Step 1: 改类型 + 写失败测试**

`KimiTideCommandDeps` 增加 `settings: SettingsNamespacePort | null`。在 `test/commands.test.ts` 现有 `makeDeps` 工厂（读该文件开头，按既有 helper 扩展）加 `settings` 字段。新增用例：

```ts
describe('applyKimiTideCommand with settings namespace', () => {
  it('mode writes through scope.update, not the sidecar', async () => {
    const writes: object[] = []
    const deps = makeDeps({
      settings: { get: () => current(), update: async (p) => { writes.push(p) }, replace: async () => {} },
    })
    const out = await applyKimiTideCommand({ kind: 'mode', mode: 'capability' }, deps)
    expect(writes).toEqual([{ mode: 'capability' }])
    expect(deps.sidecar.save).not.toHaveBeenCalled()   // 按既有 spy 习惯断言
    expect(out).toContain('saved')
  })

  it('export-config prints the resolved namespace value as YAML', async () => {
    const deps = makeDeps({ settings: { get: () => ({ ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'cost' }), update: async () => {}, replace: async () => {} } })
    const out = await applyKimiTideCommand({ kind: 'export-config' }, deps)
    expect(out).toContain('mode: cost')
  })

  it('import-config (file) replaces the namespace section', async () => { /* 写临时 YAML 文件，断言 scope.replace 收到整表、onSaved 被调 */ })

  it('falls back to sidecar when settings is null', async () => {
    const deps = makeDeps({ settings: null })
    const out = await applyKimiTideCommand({ kind: 'mode', mode: 'off' }, deps)
    expect(deps.sidecar.save).toHaveBeenCalled()
    expect(out).toContain('saved')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**（makeDeps 未加 settings 时类型错 / 新用例 FAIL）

Run: `npx vitest run test/commands.test.ts`
Expected: FAIL（类型报错或断言失败）

- [ ] **Step 3: 写实现**

`src/commands.ts` 改动（其余保持）：

```ts
export interface SettingsNamespacePort {
  get(): RouterConfigV2
  update(patch: object): Promise<void>
  replace(section: object): Promise<void>
}
export interface KimiTideCommandDeps {
  sidecar: RouterSidecarStore
  settings: SettingsNamespacePort | null
  monitor: UsageMonitor
  current: () => RouterConfigV2
  onSaved: (config: RouterConfigV2) => void
}
```

`applyKimiTideCommand` 内 `persist` 与 `export-config` 分支改为：

```ts
async function persist(config: RouterConfigV2, deps: KimiTideCommandDeps, what: string): Promise<string> {
  if (deps.settings !== null) {
    try { await deps.settings.update(config as unknown as object) } catch (error) {
      return `kimi-tide: save failed — ${(error as Error).message}`
    }
    deps.onSaved(config)
    return `kimi-tide: saved (${what}); effective now, persists across restarts`
  }
  // rc.6 兜底：无 settings 服务时维持旧 sidecar 写入
  try { deps.sidecar.save(config) } catch (error) { return `kimi-tide: save failed — ${(error as Error).message}` }
  deps.onSaved(config)
  return `kimi-tide: saved (${what}); effective now, persists across restarts（sidecar 兜底模式）`
}
```

`export-config` 分支：

```ts
case 'export-config': {
  if (deps.settings !== null) return YAML.stringify(deps.settings.get())
  try { return deps.sidecar.exportText() } catch (error) {
    return `kimi-tide: export failed — ${(error as Error).message}（sidecar 不存在或不可读；可先 /kimi-tide set 生成）`
  }
}
```

`import-config` 双形态：有 settings 时 `importInlineText`/`importFile` 解析出 next 后走 `await deps.settings.replace(next as unknown as object)` 再 `onSaved(next)`；无 settings 时维持现 sidecar 路径。`importInlineText` 内把 `deps.sidecar.save(merged)` 换成「返回 merged，由调用处统一 replace/save」（抽出纯函数 `mergeInlineText(text, current): RouterConfigV2`，保留 `isInlineYamlText` 导出）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/commands.test.ts` → PASS；`npm run typecheck` → 0

- [ ] **Step 5: Commit**

```bash
git add src/commands.ts test/commands.test.ts
git commit -m "feat(commands): /kimi-tide reads/writes the settings namespace, sidecar as fallback"
```

---

### Task 4: 宿主接线（installSettingsSection + 迁移 + configSource）

**Files:**
- Modify: `src/index.ts`（L302-385 区域）、`src/types.ts`（ConfigSource 枚举）、`src/projection.ts`（zod union 加 `'settings'`）
- Test: `test/index-wiring.test.ts`、`test/index-apply.test.ts`、`test/projection.test.ts`（更新）

**Interfaces:**
- Consumes: T1 `routerConfigSchema`/`validateRouterConfig`/`mergeResolved`；T2 `migrateSidecarIntoScope`；T3 `SettingsNamespacePort`
- Produces: `applyConfig(next: RouterConfigV2): void`（公开给 seam 与命令共用；内部 = 现 onSaved 逻辑：routerConfigV2=next、latestDecision=null、configSource、mountRouter、refreshCandidates、pushPanelToAllSessions）

- [ ] **Step 1: 改投影类型 + 写失败测试**

`src/types.ts` 的 `ConfigSource` 改为 `'settings' | 'sidecar' | 'patch' | 'default'`；`src/projection.ts` L48 的 union 同步加 `z.literal('settings')`。

`test/projection.test.ts` 加一条：`configSource: 'settings'` 的 payload 通过 schema；`'nope'` 被拒（既有断言若枚举缺 `'settings'` 会在此步 FAIL）。

`test/index-wiring.test.ts` 新增（按该文件既有 mock ctx 习惯扩展）：

```ts
it('applies config from the settings seam and exposes source "settings"', async () => {
  // mock settings 服务：register 捕获 scope；setSource 立即执行 scope.get()
  // 断言：注册 ns === 'kimi-tide-router'；panelSnapshot().configSource === 'settings'
  //       且 mode 变更触发 mountRouter 重挂（router 实例被替换）
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/projection.test.ts test/index-wiring.test.ts`
Expected: FAIL

- [ ] **Step 3: 写实现**

`src/index.ts` 中把 L323-326（sidecar 读）与 L375-384（onSaved）重构为：

```ts
// 守卫式导入：rc.6 缺 @deepseek-ai/dsh-settings 时 seam 不注册，走 sidecar 回退
let installSettingsSection: typeof import('@deepseek-ai/dsh-settings').installSettingsSection | undefined
try {
  ;({ installSettingsSection } = createRequire(import.meta.url)('@deepseek-ai/dsh-settings') as typeof import('@deepseek-ai/dsh-settings'))
} catch { /* rc.6 兼容：seam 不可用 */ }

let routerConfigV2: RouterConfigV2 = loaded.config ?? DEFAULT_CONFIG_V2(providerName)
let configSource: ConfigSource = loaded.source === 'sidecar' ? 'sidecar' : loaded.source === 'patch' ? 'patch' : 'default'
const applyConfig = (next: RouterConfigV2) => {
  routerConfigV2 = next
  latestDecision = null
  mountRouter()
  refreshCandidates()
  pushPanelToAllSessions()
}
```

`registerKimiTideCommands` 的 deps 增加：

```ts
settings: settingsScope !== null ? {
  get: () => routerConfigV2,
  update: async (patch) => { if (settingsScope) await settingsScope.update(patch) },
  replace: async (section) => { if (settingsScope) await settingsScope.replace(section) },
} : null,
```

`onSaved` 回调体改为 `applyConfig(next)`，并加 `configSource = 'settings'`（有 seam 时）。随后（在 `registerKimiTideCommands` 之后）加 seam 安装与迁移：

```ts
let settingsScope: { get(): RouterConfigV2; update(p: object): Promise<void>; replace(s: object): Promise<void> } | null = null
if (installSettingsSection !== undefined) {
  installSettingsSection(ctx as never, 'kimi-tide-router' as never, routerConfigSchema as never, config.router ?? {}, {
    validate: (v: RouterConfigV2) => { const err = validateRouterConfig(v); return err === undefined ? true : err },
    setSource: (get) => {
      settingsScope = { get: get as () => RouterConfigV2, update: async (p) => { await get().constructor; void p }, replace: async () => {} }
      // 注：seam 的 setSource 只传 getter；update/replace 须在 register 回调里从 scope 拿全句柄（见下修正）
    },
    onChange: () => { configSource = 'settings'; applyConfig(routerConfigV2FromSource()) },
  })
}
```

> **实现修正**：`installSettingsSection` 的 hooks 只有 `setSource(getter)` 与 `onChange`，没有 scope 写句柄。写法：在 `hooks.setSource` 内部调用方持有 `ctx.settings` 服务取 owner scope——`ctx.settings.register` 已由 seam 完成，写句柄从哪来？**seam 未回传 scope**。因此本任务改走手工接线（不用 installSettingsSection 的 hooks 抽象）：`ctx.inject(['settings'], (sctx) => { scope = sctx.settings.register(ns, schema, { base: entry, validate }); scope.watch(() => onChange()); … })` —— 与 seam 等价、但能同时拿到读/写句柄（dsh-settings types.d.ts L216-225 `register` 签名实读）。写实现时按此修正，`settingsScope` 直接 = `sctx.settings.register(...)` 返回值；`onChange` = `configSource='settings'; applyConfig(scope.get())`；`setSource` 等价物 = register 回调本身。guard：`ctx.inject` 在 rc.7 无 settings 服务时永不回调（等价 seam no-op）；rc.6 时本段不执行（守卫导入为 undefined）。

迁移在 register 回调内触发一次：

```ts
void migrateSidecarIntoScope({
  sidecarFile: sidecar.file, scope: settingsScope, entry: config.router ?? {}, providerName, onError: warn,
}).then((outcome) => { if (outcome === 'imported') warn('dsh-kimi-tide: sidecar 已迁移至设置命名空间 kimi-tide-router（原文件留档 .legacy-imported）') })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/index-wiring.test.ts test/index-apply.test.ts test/projection.test.ts test/integration.test.ts` → PASS（integration 中断言 sidecar 的用例改为 mock 或双路径）；`npm run typecheck` → 0

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/types.ts src/projection.ts test/index-wiring.test.ts test/index-apply.test.ts test/projection.test.ts test/integration.test.ts
git commit -m "feat(host): settings namespace registration, migration trigger, configSource 'settings'"
```

---

### Task 5: dock 退化为只读仪表

**Files:**
- Modify: `src/client/TideDock.tsx`
- Test: `test/panel-v3.test.tsx`（更新快照/断言）

**Interfaces:**
- Consumes: 现有 panel projection（`KimiTidePanelProjection`）；T4 的 `configSource` 新枚举值
- Produces: 无新导出；dock 只渲染只读信息 + 指引行

- [ ] **Step 1: 写失败测试**

在 `test/panel-v3.test.tsx` 更新既有设置区断言：删除 mode 下拉/保存按钮相关用例，新增：

```tsx
it('renders the read-only migration hint and no settings write controls', () => {
  const { queryByText, queryByRole } = render(<TideDock /* 按既有 render helper */ />)
  expect(queryByText(/路由设置已迁至/)).not.toBeNull()
  expect(queryByText(/保存/)).toBeNull()
  expect(queryByRole('combobox')).toBeNull()   // 无 mode 下拉
})
it('still renders quota/usage/decision chips', () => { /* 既有断言保留 */ })
```

- [ ] **Step 2: 跑测试确认失败**（旧快照不再匹配 → FAIL）

- [ ] **Step 3: 写实现**

`TideDock.tsx`：删除设置折叠区（`<details>` 内全部写控件与保存按钮、`kt-settings` 相关 JSX）；保留主行 chips（配额/用量/mode 徽标/decision chip）；`<ReasonPanel>` 若含写入口则只留 configSource/decision 展示（ReasonPanel 本身是只读展示，保留）；mode 徽标改只读文本（`📡 {mode}` 或等价）；新增指引行：

```tsx
<span className="kt-hint">路由设置已迁至 设置 → 月汐</span>
```

`configSource` 展示映射补 `settings → '⚙️ 设置'`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/panel-v3.test.tsx` → PASS；`npm run typecheck` → 0；`npm run build` 成功（client bundle）

- [ ] **Step 5: Commit**

```bash
git add src/client/TideDock.tsx test/panel-v3.test.tsx
git commit -m "refactor(dock): degrade to read-only dashboard, settings moved to official card"
```

---

### Task 6: 客户端「月汐」设置卡片

**Files:**
- Create: `src/client/SettingsCard.tsx`、`src/client/card-store.ts`
- Modify: `src/client/index.ts`（注册 settings.section）
- Test: `test/SettingsCard.test.tsx`

**Interfaces:**
- Consumes: T4 的命名空间（host 已注册）；`ctx.get('settingsScope')`（dsh-client-ui-settings 提供，rc.7）；`ctx.get('connection')`；既有 `src/client/CandidateList.tsx`/`ScoreEditor.tsx`/`ReasonPanel.tsx`
- Produces: `SettingsCard`（default export，React 组件）、`createCardStore(scopeLike)`（快照 store + write 函数：`saveTop(field, value)`、`saveScores(key, dim, value)`、`resetField(field)`）

- [ ] **Step 1: 写失败测试**

`test/SettingsCard.test.tsx`（参照 panel-v3 的 render 习惯，mock scope/connection）：

```tsx
it('registers a settings.section with id kimi-tide-router', () => { /* mock ctx.slots.inject 捕获注册调用：name='settings.section'，options.id='kimi-tide-router'，order=100 */ })
it('renders mode segmented control bound to snapshot', () => { /* snapshot.mode='capability' → 对应选项激活态 */ })
it('saveTop writes through scope.set for top-level scalar fields', async () => { /* fireEvent 改 lambda 输入 → save → 断言 scope.set('lambda', 0.6) 被调 */ })
it('saveScores writes through connection.api.settings.mutate with multi-segment path', async () => {
  /* 断言 ops[0] = { op:'set', path:['scores','kimi-tide/k3','code'], value: 4.7 } */
})
it('shows inherited vs overridden score values', () => { /* snapshot.base 有值、user 无 → 显示「继承」；user 有 → 显示覆盖 */ })
```

- [ ] **Step 2: 跑测试确认失败**（模块不存在）

- [ ] **Step 3: 写实现**

`src/client/card-store.ts`（照 Models 先例：`createSnapshotStore` 可用 `@deepseek-ai/dsh-client-web-react` 的 `bindSnapshotSelector`，或本地 useState+subscribe；**选后者**，零新依赖）：

```ts
// card-store.ts
import type { RouterConfigV2 } from '../config.js'
import type { ConnectionLike, SettingsScopeLike } from './SettingsCard.js'

export interface CardSnapshot { status: 'loading' | 'ready' | 'unavailable'; config: RouterConfigV2 | null; writable: boolean }
export function createCardStore(scope: SettingsScopeLike | null, connection: ConnectionLike | null) {
  let snapshot: CardSnapshot = { status: scope === null && connection === null ? 'unavailable' : 'loading', config: null, writable: false }
  const listeners = new Set<() => void>()
  const publish = (next: CardSnapshot) => { snapshot = next; for (const l of listeners) l() }
  const useSnapshot = () => { /* 组件内用 useSyncExternalStore(subscribe, getSnapshot) 包装（SettingsCard 内实现） */ }
  const load = async () => {
    if (scope !== null) {
      const s = scope.getSnapshot()
      publish(s.status === 'ready' && s.value !== undefined
        ? { status: 'ready', config: s.value as RouterConfigV2, writable: s.writable }
        : { status: s.status === 'unavailable' ? 'unavailable' : 'loading', config: null, writable: s.writable })
      scope.subscribe(load)
    } else if (connection !== null) {
      const r = await connection.api.settings.describe({})
      const view = r.result.ok ? r.result.value.namespaces.find((n) => n.ns === 'kimi-tide-router') : undefined
      publish(view === undefined ? { status: 'unavailable', config: null, writable: false }
        : { status: 'ready', config: view.value as RouterConfigV2, writable: r.result.value.writable })
    }
  }
  const saveTop = async (field: string, value: unknown) => {
    if (scope !== null) await scope.set(field, value)
    else if (connection !== null) await connection.api.settings.mutate({ ns: 'kimi-tide-router', ops: [{ op: 'set', path: [field], value }] })
    await load()
  }
  const saveScores = async (key: string, dim: string, value: number) => {
    if (connection !== null) await connection.api.settings.mutate({ ns: 'kimi-tide-router', ops: [{ op: 'set', path: ['scores', key, dim], value }] })
    await load()
  }
  return { load, saveTop, saveScores, getSnapshot: () => snapshot, subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } } }
}
```

`src/client/SettingsCard.tsx`：`React.useSyncExternalStore(store.subscribe, store.getSnapshot)` 读快照；渲染 mode 三选（`saveTop('mode', …)`）、默认路由与候选列表（复用 CandidateList 展示 + ScoreEditor 滑杆）、数值区（lambda/routeThreshold/premiumBudget/budgetWindow/charsPerToken，`saveTop`）、高级折叠（classify.patterns/costTiers/allowedProviders 只读+textarea 整值 `saveTop`）；`config === null` 时渲染 unavailable 提示。

`src/client/index.ts` 增加：

```ts
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'kimi-tide-router',
  order: 100,
  label: () => '月汐',
  inject: () => ({ scope: ctx.get('settingsScope')?.bind({ namespace: 'kimi-tide-router' }) ?? null, connection: ctx.get('connection') ?? null }),
}, SettingsCard))
```

（`settingsScope`/`connection` 均用 `ctx.get` 可选读取；bind 在 inject 内惰性执行，避免挂载即绑定。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/SettingsCard.test.tsx` → PASS；`npm run typecheck` → 0；`npm run build` 成功

- [ ] **Step 5: Commit**

```bash
git add src/client/SettingsCard.tsx src/client/card-store.ts src/client/index.ts test/SettingsCard.test.tsx
git commit -m "feat(client): 月汐 settings card on the official settings panel (settings.section)"
```

---

### Task 7: 文档同步

**Files:**
- Modify: `README.md`、`packages/dsh-kimi-tide/README.md`、`docs/development-plan-router.md`、`docs/superpowers/specs/2026-08-19-settings-migration-design.md`（状态行「待用户评审」→「已评审，实施计划见 plans/2026-08-19-settings-migration-implementation.md」）

**Interfaces:** 无代码接口。

- [ ] **Step 1:** 仓库 README「插件配置」表补一行 `settingsNamespace | kimi-tide-router | 路由配置的 DSH 设置命名空间（0.3.x；sidecar 已迁移为 .legacy-imported 留档）`；`router` 子配置表首行注「0.3.x 起持久化在设置面板 → 月汐；此处为部署基座（base 层）」
- [ ] **Step 2:** 插件 README「配置」节同步上述说明 + 「0.3.0 手工验收清单」第 2/3 步改为「设置面板 → 月汐卡片」表述
- [ ] **Step 3:** `docs/development-plan-router.md` 持久化相关小节（含 sidecar 描述）补 0.3.x 迁移注
- [ ] **Step 4:** spec 状态行更新
- [ ] **Step 5:** 相对链接校验（仓库脚本或手工 `grep` 检查新链接）→ Commit

```bash
git add README.md packages/dsh-kimi-tide/README.md docs/development-plan-router.md docs/superpowers/specs/2026-08-19-settings-migration-design.md
git commit -m "docs: settings namespace migration — READMEs, router plan, spec status"
```

---

### Task 8: 全量验证 + 交付

**Files:** 无（验证 + 收尾）

- [ ] **Step 1:** `npm run test` → 全量绿（原 162 + 新增，全数通过；记录总数）
- [ ] **Step 2:** `npm run typecheck` → 0 error
- [ ] **Step 3:** `npm run build`（host tsc + client esbuild）→ 成功
- [ ] **Step 4:** 仓库根 `git status` 无意外改动（`.npmrc`/`scripts/fetch-kimi-binary.mjs` 两个未跟踪本机工具文件保持不动）；`git log --oneline -8` 核对 T1-T7 提交齐
- [ ] **Step 5:** 尝试 `git push`；若沙箱拒绝（EPERM/网络策略），**不重试不绕过**，报告用户由其在 shell 执行推送
- [ ] **Step 6:** 产出「用户验收清单」写入会话报告：重启 dsh web → 设置面板出现「月汐」卡片 → 卡片改 mode → dock 只读区热更新 → sidecar 已改名留档 → 重启后设置保持（对应 spec §10 验收 1-6）

---

## 自审记录

- **Spec 覆盖**：§3.1 卡片注册→T6；§3.2 seam→T4；§3.3 configSource→T4；§4 schema→T1；§5 迁移→T2；§6 命令→T3；§7 dock→T5；§8 表单→T6；§10 测试/验收→T1-T8；§11 风险（rc.6 回退）→T3/T4 守卫导入与 sidecar 兜底
- **占位扫描**：无 TBD/TODO；每个代码步骤给出可运行内容；T4 中 seam hooks 不回传写句柄的偏差已在计划内以「实现修正」段落明示并给出 register 手工接线方案
- **类型一致性**：`SettingsNamespacePort`（T3 定义）在 T4 由 register 返回的 owner scope 适配；`MigrationScope`（T2）与 T4 传入的 settingsScope 结构一致（get/replace）；`saveTop/saveScores/createCardStore`（T6 定义）在 T6 测试与 SettingsCard 中同名同签名；`mergeResolved`（T1 定义）被 T2 消费；`validateRouterConfig`（T1）在 T4 注册选项使用
