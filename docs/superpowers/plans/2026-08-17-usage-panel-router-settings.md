# kimi-tide 0.2.0 — 用量显示 · 路由设置面板 · 双端化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 kimi-tide 现有 host 插件之上交付双端「月汐」dock 面板：官方配额/本地 token 用量显示（M3.6）、路由设置回写 patch yml（M3.7），以及承载它们的双端化机制（M3.5）。

**Architecture:** host 侧新增 usage/settings/commands/projection 四个单元 + adapter usage tap；browser 侧经 esbuild 打包 `lib/client.js`，注册 `conversation.composer.dock` slot 渲染 TideDock 面板；client→host 通道复用 `ctx.remote.commands.execute(sessionId, '/kimi-tide …')` slash command（机制已在本机 dsh 安装中确认）；面板数据走 session projection（dsh-kimi-bridge 已验证：host `agent.session.append('kimi-tide/panel', payload)` → 框架折叠推送 → client `useProjection('kimi-tide/panel')`）。配置持久化用行级锚点文本替换（保注释），不用 js-yaml 往返。

**Tech Stack:** TypeScript (NodeNext, strict) / React 18 / esbuild / schemastery + zod / vitest / cordis patch yml

**Spec:** [`docs/superpowers/specs/2026-08-17-usage-panel-router-settings-design.md`](../superpowers/specs/2026-08-17-usage-panel-router-settings-design.md)（设计定稿）；上游计划 [`docs/development-plan-router.md`](../development-plan-router.md)

## Global Constraints

- 工作区根：`E:\BaiduSyncdisk\Data\vibe-coding\kimi-tide\kimi-tide`（双层嵌套），包目录 `packages/dsh-kimi-tide/`
- Node ≥ 22；TS `module: NodeNext`、`strict`、`verbatimModuleSyntax`；相对 import 必须带 `.js` 后缀
- 现有 tsconfig `exclude: ["src/router.ts"]` —— Task 1 必须先移除该排除，否则后续任务 `import './router.js'` 全部编不过
- 用户 patch 文件（`$DSH_HOME/profiles/web/cordis.patch.yml`）含其他插件配置：**只允许行级局部替换，禁止全量 parse→dump**（js-yaml 会丢注释）
- projection 走 session 事件通道：host 必须 `KNOWN_SESSION_EVENT_TYPES.add('kimi-tide/panel')`（`@deepseek-ai/dsh-session` 导出，bridge `src/index.ts:105` 先例），否则持久化日志重启后拒读
- projection definition 的 `schema` 字段类型是 `ZodType` —— 新增 runtime 依赖 `zod`（bridge 同款用法）
- client→host 通道：`ctx.remote.commands.execute(sessionId, '/kimi-tide …')`（dsh-client-runtime 内置 remote namespace，client inject 加 `'remote'`、`'remote.commands'`）；host 侧 `ctx.commands.register(CommandDefinition)`（API 已从 `@deepseek-ai/dsh-commands@0.1.0-rc.6` 的 `.d.ts` 确认：`handler(invocation) => CommandResult | Promise<CommandResult>`，`CommandResult = { kind:'success', text? } | { kind:'error', text }`）
- dock slot 契约（已从本机 dsh-client-ui-conversation 确认）：`conversation.composer.dock`，list 型、session 作用域；注册 `{ name, id: 'kimi-tide', order, label }`；组件收到 standard props 含 `sessionId: SessionId`、`useProjection: UseProjection`（`UseProjection` 泛型约束到 `SessionProjectionMap`——必须做 declaration merging，见 Task 5）
- 面板变色阈值：正常 → ≥80% 黄 → ≥90% 红（对齐 dsh-opencode-go-usage）
- 依赖变更：runtime + `schemastery`、`zod`；dev + `esbuild`、`vitest`、`@types/react`、`react`；peerDeps + `@deepseek-ai/dsh-commands`、`@deepseek-ai/dsh-session-projection`（`^0.1.0-rc.6`，与本机安装版本一致）
- package.json 必须声明 `dsh.client`（inject: `@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-api-remotes`，platform: web）——缺它浏览器不拉 client bundle
- 所有单元测试放 `packages/dsh-kimi-tide/test/`，vitest，运行 `npm test`

---

## File Structure

```
packages/dsh-kimi-tide/
├── src/
│   ├── index.ts            修改：装配 usage/settings/commands/projection/router；inject + commands/sessionProjections
│   ├── adapter.ts          修改：KimiAdapterOptions + onUsage 回调，stream() 内 tap usage chunk（~8 行）
│   ├── router.ts           不变（M1 草稿；tsconfig 解除排除后参与编译）
│   ├── types.ts            新增：QuotaSnapshot / LocalTokenStats / KimiTidePanelProjection / parseQuotaSnapshot
│   ├── usage.ts            新增：UsageMonitor（usages 轮询 + 本地 token 桶 + 节流通知）
│   ├── settings.ts         新增：RouterSettingsStore（schemastery 校验 + 行级锚点回写 patch yml）
│   ├── commands.ts         新增：/kimi-tide slash command（mode/set/refresh 子命令）
│   ├── projection.ts       新增：kimiTideProjectionDefinition + SessionProjectionMap declaration merging
│   └── client/
│       ├── index.ts        新增：dock slot 注册 + style 注入 + inject 声明
│       └── TideDock.tsx    新增：紧凑单行面板 + <details> 展开区（用量/表单/推理状态行）
├── scripts/build-client.mjs 新增：esbuild → lib/client.js（banner/footer 挂 __ModuleLoader__）
├── test/
│   ├── smoke.test.ts       新增：脚手架自检
│   ├── types.test.ts       新增：usages 响应解析
│   ├── usage.test.ts       新增：轮询/401 重试/stale/本地累计/日界归零/节流
│   ├── adapter-usage.test.ts 新增：usage tap 透传
│   ├── projection.test.ts  新增：fold 幂等 + view 透传
│   ├── settings.test.ts    新增：行级替换/注释保留/缺行 append/.bak/校验拒绝
│   └── commands.test.ts    新增：子命令解析与 dispatch、非法参数
├── package.json            修改：files/exports/scripts/dsh.client/deps
├── tsconfig.json           修改：移除 exclude src/router.ts，+jsx
├── tsconfig.build.json     新增：host-only build（排除 src/client）
└── cordis.patch.yml        修改：补 usagePollMs / router 注释示例（默认 off）
```

职责边界：usage 只产数据不碰 UI；settings 只碰文件与校验；commands 只做解析与 dispatch；projection 纯函数 + 类型合并；TideDock 只渲染 + 发命令。单一 `buildRouter(config)` 装配入口放 index.ts，settings 保存后复用重建。

---

## Task 1: 构建与测试脚手架（vitest + esbuild + dsh.client 声明 + 解除 router 排除）

**Files:**
- Modify: `packages/dsh-kimi-tide/tsconfig.json`
- Create: `packages/dsh-kimi-tide/tsconfig.build.json`
- Create: `packages/dsh-kimi-tide/scripts/build-client.mjs`
- Create: `packages/dsh-kimi-tide/test/smoke.test.ts`
- Modify: `packages/dsh-kimi-tide/package.json`

**Interfaces:**
- Produces: `npm test`（vitest run）、`npm run build`（host tsc + client esbuild）、`npm run build:client`、package.json `dsh.client` 字段。后续所有任务依赖此脚手架。

- [ ] **Step 1: 移除 tsconfig 对 router.ts 的排除，新增 jsx；拆出 host-only build 配置**

`tsconfig.json` 改为：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "lib",
    "rootDir": "src",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "exclude": ["src/client"]
}
```

新建 `tsconfig.build.json`：

```json
{
  "extends": "./tsconfig.json",
  "include": ["src"],
  "exclude": ["src/client"]
}
```

- [ ] **Step 2: 写 build-client.mjs（对齐 bridge 的 bundle 协议）**

新建 `scripts/build-client.mjs`：

```js
/**
 * Build the browser half (lib/client.js) with esbuild, replicating the
 * harness's client bundle protocol (same as vendor/dsh-kimi-bridge).
 */
import { build } from 'esbuild'

const PLUGIN_ID = 'dsh-kimi-tide'

const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
]

const RUNTIME_EXTERNALS = ['@deepseek-ai/dsh-client-runtime/client']

await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  outfile: 'lib/client.js',
  sourcemap: true,
  external: [...PLATFORM_EXTERNALS, ...RUNTIME_EXTERNALS],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      'var module = { exports: {} }; var exports = module.exports;',
    ].join('\n'),
  },
  footer: {
    js: 'return module.exports; } });',
  },
})

console.log('[dsh-kimi-tide] built lib/client.js (browser half)')
```

- [ ] **Step 3: package.json 更新（scripts / files / exports / dsh.client / deps）**

对 `package.json` 做如下编辑（未提及字段保持原样）：

- `exports` 增加 `"./client": { "default": "./lib/client.js" }`
- `files` 保持 `["lib", "cordis.patch.yml"]`（client.js 在 lib 内，已覆盖）
- `scripts` 改为：

```json
"scripts": {
  "build": "npm run build:host && npm run build:client",
  "build:host": "tsc -p tsconfig.build.json",
  "build:client": "node scripts/build-client.mjs",
  "typecheck": "tsc -p tsconfig.build.json --noEmit",
  "test": "vitest run"
}
```

- `dsh` 字段改为：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "inject": [
      "@deepseek-ai/dsh-client-ui-conversation",
      "@deepseek-ai/dsh-api-remotes"
    ],
    "platform": "web"
  }
}
```

- `peerDependencies` 增加：

```json
"@deepseek-ai/dsh-commands": "^0.1.0-rc.6",
"@deepseek-ai/dsh-session-projection": "^0.1.0-rc.6"
```

- `dependencies` 增加：`"schemastery": "^3.18.0"`、`"zod": "^3.23.8"`
- `devDependencies` 增加：`"@deepseek-ai/dsh-commands": "0.1.0-rc.6"`、`"@deepseek-ai/dsh-session-projection": "0.1.0-rc.6"`、`"@types/react": "~18.3.1"`、`"esbuild": "^0.24.0"`、`"react": "^18.3.1"`、`"vitest": "^2.1.0"`

- [ ] **Step 4: 安装依赖**

Run: `npm install`（工作目录 `packages/dsh-kimi-tide`）
Expected: 成功。若 `@deepseek-ai/dsh-commands`/`dsh-session-projection` 解析失败，先 `npm view <pkg> versions` 确认版本（本机 dsh 安装内两者均为 0.1.0-rc.6）。

- [ ] **Step 5: 写 smoke 测试**

新建 `test/smoke.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { estimateTokens, latestUserText } from '../src/router.js'

describe('scaffold smoke', () => {
  it('router.ts now compiles and is importable', () => {
    expect(estimateTokens('abcd', 2)).toBe(2)
    expect(latestUserText([])).toBe('')
  })
})
```

- [ ] **Step 6: 验证 typecheck + test 全绿**

Run: `npm run typecheck && npm test`（工作目录 `packages/dsh-kimi-tide`）
Expected: typecheck 无错误；vitest 1 PASS

- [ ] **Step 7: Commit**

```bash
git add packages/dsh-kimi-tide
git commit -m "chore: dual-end scaffold (vitest, esbuild client bundle, dsh.client) + unexclude router.ts"
```

---

## Task 2: types.ts — 共享类型与 usages 响应解析

**Files:**
- Create: `packages/dsh-kimi-tide/src/types.ts`
- Test: `packages/dsh-kimi-tide/test/types.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface QuotaWindow { used: number; limit: number; resetTime: string }`
  - `interface QuotaSnapshot { weekly: QuotaWindow; fiveHour: QuotaWindow; membershipLevel: string; fetchedAt: number; stale: boolean }`
  - `interface LocalTokenStats { today: TokenUsage; session: TokenUsage; calls: number }`（TokenUsage 来自 `@deepseek-ai/dsh-llm`）
  - `interface KimiTidePanelProjection { quota: QuotaSnapshot | null; local: LocalTokenStats; router: RouterConfig; reasoning: { enabled: true } }`
  - `parseQuotaSnapshot(json: unknown, fetchedAt: number): QuotaSnapshot | null`
  - `emptyLocalTokenStats(): LocalTokenStats`

- [ ] **Step 1: 写失败测试**

新建 `test/types.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { parseQuotaSnapshot } from '../src/types.js'

describe('parseQuotaSnapshot', () => {
  it('parses a full usages response (numeric fields)', () => {
    const snap = parseQuotaSnapshot({
      usage: { used: 9, limit: 100, resetTime: '2026-08-24T00:00:00Z' },
      limits: [{ used: 10, limit: 100, resetTime: '2026-08-17T18:00:00Z', windowMinutes: 300 }],
      user: { membership: { level: 'LEVEL_INTERMEDIATE' } },
    }, 1724000000000)
    expect(snap).not.toBeNull()
    expect(snap!.weekly).toEqual({ used: 9, limit: 100, resetTime: '2026-08-24T00:00:00Z' })
    expect(snap!.fiveHour.used).toBe(10)
    expect(snap!.membershipLevel).toBe('LEVEL_INTERMEDIATE')
    expect(snap!.stale).toBe(false)
    expect(snap!.fetchedAt).toBe(1724000000000)
  })

  it('tolerates string numbers ("used":"9")', () => {
    const snap = parseQuotaSnapshot({
      usage: { used: '9', limit: '100', resetTime: 'x' },
      limits: [{ used: '10', limit: '100', resetTime: 'y' }],
      user: { membership: { level: 'L' } },
    }, 0)
    expect(snap!.weekly.used).toBe(9)
    expect(snap!.fiveHour.used).toBe(10)
  })

  it('returns null when usage section is missing', () => {
    expect(parseQuotaSnapshot({}, 0)).toBeNull()
    expect(parseQuotaSnapshot(null, 0)).toBeNull()
  })

  it('degrades gracefully when limits[] is empty (fiveHour zeroed)', () => {
    const snap = parseQuotaSnapshot({
      usage: { used: 1, limit: 100, resetTime: 'x' },
      limits: [],
      user: {},
    }, 0)
    expect(snap!.fiveHour).toEqual({ used: 0, limit: 0, resetTime: '' })
    expect(snap!.membershipLevel).toBe('')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/types.test.ts`
Expected: FAIL — `Cannot find module '../src/types.js'`

- [ ] **Step 3: 实现 types.ts**

新建 `src/types.ts`：

```ts
/**
 * kimi-tide: shared types for the 月汐 panel (quota / local tokens / projection).
 * The usages endpoint is undocumented — parsing is deliberately lenient
 * (string-or-number fields, missing sections degrade instead of throwing).
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { RouterConfig } from './router.js'

export interface QuotaWindow {
  used: number
  limit: number
  resetTime: string
}

export interface QuotaSnapshot {
  weekly: QuotaWindow
  fiveHour: QuotaWindow
  membershipLevel: string
  fetchedAt: number
  /** true when the last refresh failed and this snapshot is from an earlier fetch. */
  stale: boolean
}

export interface LocalTokenStats {
  /** Counters reset at local midnight. */
  today: TokenUsage
  /** Counters for the whole process lifetime. */
  session: TokenUsage
  /** Number of usage chunks observed. */
  calls: number
}

export interface KimiTidePanelProjection {
  quota: QuotaSnapshot | null
  local: LocalTokenStats
  /** Currently effective router config (panel form initial values). */
  router: RouterConfig
  reasoning: { enabled: true }
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function toWindow(value: unknown): QuotaWindow {
  const v = (value ?? {}) as Record<string, unknown>
  return {
    used: toNumber(v.used),
    limit: toNumber(v.limit),
    resetTime: typeof v.resetTime === 'string' ? v.resetTime : '',
  }
}

/**
 * Parse `GET /coding/v1/usages` JSON into a QuotaSnapshot.
 * Returns null only when the weekly `usage` section is absent entirely.
 */
export function parseQuotaSnapshot(json: unknown, fetchedAt: number): QuotaSnapshot | null {
  if (json === null || typeof json !== 'object') return null
  const root = json as Record<string, unknown>
  if (root.usage === undefined || root.usage === null) return null
  const limits = Array.isArray(root.limits) ? root.limits : []
  const user = (root.user ?? {}) as Record<string, unknown>
  const membership = (user.membership ?? {}) as Record<string, unknown>
  return {
    weekly: toWindow(root.usage),
    fiveHour: limits.length > 0 ? toWindow(limits[0]) : { used: 0, limit: 0, resetTime: '' },
    membershipLevel: typeof membership.level === 'string' ? membership.level : '',
    fetchedAt,
    stale: false,
  }
}

export function emptyLocalTokenStats(): LocalTokenStats {
  return { today: {}, session: {}, calls: 0 }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/types.test.ts`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/types.ts packages/dsh-kimi-tide/test/types.test.ts
git commit -m "feat: shared panel types + lenient usages response parser"
```

---

## Task 3: usage.ts — UsageMonitor（官方配额轮询 + 本地 token 桶）

**Files:**
- Create: `packages/dsh-kimi-tide/src/usage.ts`
- Test: `packages/dsh-kimi-tide/test/usage.test.ts`

**Interfaces:**
- Consumes: `parseQuotaSnapshot / QuotaSnapshot / LocalTokenStats / emptyLocalTokenStats`（Task 2）；`KimiOAuthManager`（`getAccessToken()`、`refresh()`）
- Produces:
  - `class UsageMonitor { constructor(oauth: KimiOAuthManager, options: UsageMonitorOptions) }`
  - `UsageMonitorOptions { pollMs: number; onUpdate: () => void; fetchFn?: typeof fetch; now?: () => number }`（fetchFn/now 为测试注入点）
  - `start(): void` / `stop(): void` / `refresh(): Promise<void>`
  - `tapUsage(usage: TokenUsage): void`
  - `snapshot(): { quota: QuotaSnapshot | null; local: LocalTokenStats }`

- [ ] **Step 1: 写失败测试**

新建 `test/usage.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import { UsageMonitor } from '../src/usage.js'
import type { KimiOAuthManager } from '../src/oauth.js'

function fakeOAuth(token = 'tok'): KimiOAuthManager {
  return {
    getAccessToken: () => token,
    refresh: vi.fn(async () => true),
  } as unknown as KimiOAuthManager
}

const USAGES_OK = {
  usage: { used: 9, limit: 100, resetTime: 'w' },
  limits: [{ used: 10, limit: 100, resetTime: 'f' }],
  user: { membership: { level: 'LEVEL_INTERMEDIATE' } },
}

function fetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('UsageMonitor quota polling', () => {
  it('fetches usages and stores a fresh snapshot', async () => {
    const fetchFn = vi.fn(async () => fetchResponse(200, USAGES_OK))
    const monitor = new UsageMonitor(fakeOAuth(), { pollMs: 60000, onUpdate: () => {}, fetchFn: fetchFn as unknown as typeof fetch, now: () => 1000 })
    await monitor.refresh()
    const { quota } = monitor.snapshot()
    expect(quota?.weekly.used).toBe(9)
    expect(quota?.stale).toBe(false)
    expect(fetchFn).toHaveBeenCalledOnce()
    const url = String((fetchFn.mock.calls[0] as unknown[])[0])
    expect(url).toBe('https://api.kimi.com/coding/v1/usages')
  })

  it('on 401 refreshes the OAuth token and retries once', async () => {
    const oauth = fakeOAuth()
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(fetchResponse(401, {}))
      .mockResolvedValueOnce(fetchResponse(200, USAGES_OK))
    const monitor = new UsageMonitor(oauth, { pollMs: 60000, onUpdate: () => {}, fetchFn: fetchFn as unknown as typeof fetch })
    await monitor.refresh()
    expect(oauth.refresh).toHaveBeenCalledOnce()
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(monitor.snapshot().quota?.weekly.used).toBe(9)
  })

  it('on persistent failure keeps the old snapshot and marks it stale', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(fetchResponse(200, USAGES_OK))
      .mockResolvedValue(fetchResponse(500, {}))
    const monitor = new UsageMonitor(fakeOAuth(), { pollMs: 60000, onUpdate: () => {}, fetchFn: fetchFn as unknown as typeof fetch })
    await monitor.refresh()
    await monitor.refresh()
    const { quota } = monitor.snapshot()
    expect(quota?.weekly.used).toBe(9)
    expect(quota?.stale).toBe(true)
  })

  it('throttles onUpdate notifications (2s window)', async () => {
    let now = 0
    const onUpdate = vi.fn()
    const fetchFn = vi.fn(async () => fetchResponse(200, USAGES_OK))
    const monitor = new UsageMonitor(fakeOAuth(), { pollMs: 60000, onUpdate, fetchFn: fetchFn as unknown as typeof fetch, now: () => now })
    await monitor.refresh()
    await monitor.refresh()
    expect(onUpdate).toHaveBeenCalledOnce()
    now = 3000
    await monitor.refresh()
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })
})

describe('UsageMonitor local token stats', () => {
  it('accumulates today/session buckets and call count', () => {
    const monitor = new UsageMonitor(fakeOAuth(), { pollMs: 60000, onUpdate: () => {}, now: () => Date.parse('2026-08-17T10:00:00') })
    monitor.tapUsage({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 20 })
    monitor.tapUsage({ inputTokens: 30, outputTokens: 10 })
    const { local } = monitor.snapshot()
    expect(local.calls).toBe(2)
    expect(local.today).toEqual({ inputTokens: 130, outputTokens: 60, cacheReadTokens: 20 })
    expect(local.session.inputTokens).toBe(130)
  })

  it('resets the today bucket across a local-day boundary', () => {
    let now = Date.parse('2026-08-17T23:59:00')
    const monitor = new UsageMonitor(fakeOAuth(), { pollMs: 60000, onUpdate: () => {}, now: () => now })
    monitor.tapUsage({ inputTokens: 100, outputTokens: 0 })
    now = Date.parse('2026-08-18T00:01:00')
    monitor.tapUsage({ inputTokens: 5, outputTokens: 0 })
    const { local } = monitor.snapshot()
    expect(local.today.inputTokens).toBe(5)
    expect(local.session.inputTokens).toBe(105)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/usage.test.ts`
Expected: FAIL — `Cannot find module '../src/usage.js'`

- [ ] **Step 3: 实现 usage.ts**

新建 `src/usage.ts`：

```ts
/**
 * kimi-tide: UsageMonitor — official quota polling (GET /coding/v1/usages)
 * plus a local token bucket fed by the adapter's usage chunks.
 * Pure data source: emits onUpdate (throttled 2s); pushing projections is
 * the caller's job (index.ts).
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { KimiOAuthManager } from './oauth.js'
import { emptyLocalTokenStats, parseQuotaSnapshot, type LocalTokenStats, type QuotaSnapshot } from './types.js'

const USAGES_URL = 'https://api.kimi.com/coding/v1/usages'
const NOTIFY_THROTTLE_MS = 2000

export interface UsageMonitorOptions {
  pollMs: number
  onUpdate: () => void
  /** Test seam: inject a fake fetch. */
  fetchFn?: typeof fetch
  /** Test seam: inject a clock. */
  now?: () => number
}

export class UsageMonitor {
  private quota: QuotaSnapshot | null = null
  private local: LocalTokenStats = emptyLocalTokenStats()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastNotify = 0
  private todayKey = ''
  private readonly fetchFn: typeof fetch
  private readonly now: () => number

  constructor(
    private readonly oauth: KimiOAuthManager,
    private readonly options: UsageMonitorOptions,
  ) {
    this.fetchFn = options.fetchFn ?? fetch
    this.now = options.now ?? (() => Date.now())
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => { void this.refresh() }, this.options.pollMs)
    void this.refresh()
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /** Fetch the usages endpoint once; on 401 refresh the token and retry once. */
  async refresh(): Promise<void> {
    const snapshot = await this.fetchQuota(false)
    if (snapshot !== null) {
      this.quota = snapshot
    } else if (this.quota !== null) {
      this.quota = { ...this.quota, stale: true }
    }
    this.notify()
  }

  /** Feed one adapter usage chunk into the local buckets. */
  tapUsage(usage: TokenUsage): void {
    this.rollDayIfNeeded()
    this.local = {
      today: addUsage(this.local.today, usage),
      session: addUsage(this.local.session, usage),
      calls: this.local.calls + 1,
    }
    this.notify()
  }

  snapshot(): { quota: QuotaSnapshot | null; local: LocalTokenStats } {
    return { quota: this.quota, local: this.local }
  }

  private async fetchQuota(retried: boolean): Promise<QuotaSnapshot | null> {
    const token = this.oauth.getAccessToken()
    if (token.length === 0) return null
    try {
      const response = await this.fetchFn(USAGES_URL, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      if (response.status === 401 && !retried) {
        const refreshed = await this.oauth.refresh()
        if (refreshed) return this.fetchQuota(true)
        return null
      }
      if (!response.ok) return null
      return parseQuotaSnapshot(await response.json(), this.now())
    } catch {
      return null
    }
  }

  private notify(): void {
    const t = this.now()
    if (t - this.lastNotify < NOTIFY_THROTTLE_MS) return
    this.lastNotify = t
    this.options.onUpdate()
  }

  private rollDayIfNeeded(): void {
    const key = new Date(this.now()).toDateString()
    if (this.todayKey === key) return
    this.todayKey = key
    this.local = { ...this.local, today: {} }
  }
}

function addUsage(base: TokenUsage, delta: TokenUsage): TokenUsage {
  const out: TokenUsage = { ...base }
  out.inputTokens = (out.inputTokens ?? 0) + (delta.inputTokens ?? 0)
  out.outputTokens = (out.outputTokens ?? 0) + (delta.outputTokens ?? 0)
  if (delta.cacheReadTokens !== undefined) out.cacheReadTokens = (out.cacheReadTokens ?? 0) + delta.cacheReadTokens
  if (delta.cacheWriteTokens !== undefined) out.cacheWriteTokens = (out.cacheWriteTokens ?? 0) + delta.cacheWriteTokens
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/usage.test.ts`
Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/usage.ts packages/dsh-kimi-tide/test/usage.test.ts
git commit -m "feat: UsageMonitor — usages polling (401 retry, stale fallback) + local token buckets"
```

---

## Task 4: adapter.ts usage tap — usage chunk 接进 UsageMonitor

**Files:**
- Modify: `packages/dsh-kimi-tide/src/adapter.ts`
- Test: `packages/dsh-kimi-tide/test/adapter-usage.test.ts`

**Interfaces:**
- Consumes: `TokenUsage`（dsh-llm）
- Produces: `KimiAdapterOptions` 增加可选 `onUsage?: (usage: TokenUsage) => void`；新增导出 `tapUsageChunk(chunk, onUsage)` 纯函数。index.ts 装配时把 `monitor.tapUsage` 绑定传入。

- [ ] **Step 1: 写失败测试**

新建 `test/adapter-usage.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import type { StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { tapUsageChunk } from '../src/adapter.js'

describe('tapUsageChunk', () => {
  it('invokes onUsage for usage chunks and returns the chunk unchanged', () => {
    const onUsage = vi.fn()
    const chunk: StreamChunk = { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    const out = tapUsageChunk(chunk, onUsage)
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 5 })
    expect(out).toBe(chunk)
  })

  it('ignores non-usage chunks', () => {
    const onUsage = vi.fn()
    const chunk: StreamChunk = { type: 'text-delta', index: 0, text: 'hi' }
    tapUsageChunk(chunk, onUsage)
    expect(onUsage).not.toHaveBeenCalled()
  })

  it('works without a callback (zero overhead path)', () => {
    const chunk: StreamChunk = { type: 'usage', usage: {} as TokenUsage }
    expect(tapUsageChunk(chunk, undefined)).toBe(chunk)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/adapter-usage.test.ts`
Expected: FAIL — `tapUsageChunk is not exported`

- [ ] **Step 3: 实现 tap（adapter.ts 三处修改）**

1. dsh-llm import 列表加 `type TokenUsage`（与现有 `type StreamChunk` 并列）。
2. `KimiAdapterOptions` 加字段，constructor 参数改为 `private readonly options`：

```ts
export interface KimiAdapterOptions {
  /** Route name this adapter owns (default 'kimi-tide'). */
  providerName: string
  /** Optional tap for usage chunks (feeds UsageMonitor local stats). */
  onUsage?: (usage: TokenUsage) => void
}
```

```ts
  constructor(
    private readonly oauth: KimiOAuthManager,
    private readonly options: KimiAdapterOptions,
  ) {
    super()
    this.providerName = options.providerName
    // …其余不变
  }
```

3. `stream()` 末尾的 `yield*` 改为：

```ts
    for await (const chunk of toStreamChunks(events, model.contextWindow)) {
      yield tapUsageChunk(chunk, this.options.onUsage)
    }
```

4. 文件末尾（class 外）新增：

```ts
/** Pass through a chunk; invoke the usage tap on usage chunks. */
export function tapUsageChunk(chunk: StreamChunk, onUsage: ((usage: TokenUsage) => void) | undefined): StreamChunk {
  if (onUsage !== undefined && chunk.type === 'usage') onUsage(chunk.usage)
  return chunk
}
```

- [ ] **Step 4: 全量回归**

Run: `npx vitest run && npm run typecheck`
Expected: adapter-usage 3 PASS；其余保持绿；typecheck 无错误

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/adapter.ts packages/dsh-kimi-tide/test/adapter-usage.test.ts
git commit -m "feat: adapter usage tap (onUsage option, pure pass-through helper)"
```

---

## Task 5: projection.ts — kimi-tide/panel 数据通道（含 SessionProjectionMap 合并）

**Files:**
- Create: `packages/dsh-kimi-tide/src/projection.ts`
- Test: `packages/dsh-kimi-tide/test/projection.test.ts`

**Interfaces:**
- Consumes: `KimiTidePanelProjection`（Task 2）
- Produces:
  - `KIMI_TIDE_PANEL_KEY = 'kimi-tide/panel'`
  - `KIMI_TIDE_PANEL_EVENT = 'kimi-tide/panel'`（host 侧 `session.append` 用；index.ts 用它 + `KNOWN_SESSION_EVENT_TYPES.add`）
  - `kimiTideProjectionDefinition: ProjectionDefinition<'kimi-tide/panel', KimiTidePanelProjection | null>`（whole-value fold）
  - declaration merging：`declare module '@deepseek-ai/dsh-session-projection/types' { interface SessionProjectionMap { 'kimi-tide/panel': KimiTidePanelProjection | null } }`——host 的 register 泛型与 client 的 `useProjection('kimi-tide/panel')` 都靠它解析

- [ ] **Step 1: 写失败测试**

新建 `test/projection.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { kimiTideProjectionDefinition, KIMI_TIDE_PANEL_EVENT } from '../src/projection.js'
import { emptyLocalTokenStats, type KimiTidePanelProjection } from '../src/types.js'
import type { RouterConfig } from '../src/router.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const router: RouterConfig = {
  mode: 'off',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
}

function panel(quotaUsed: number): KimiTidePanelProjection {
  return {
    quota: {
      weekly: { used: quotaUsed, limit: 100, resetTime: 'w' },
      fiveHour: { used: 0, limit: 100, resetTime: 'f' },
      membershipLevel: 'LEVEL_INTERMEDIATE',
      fetchedAt: 1,
      stale: false,
    },
    local: emptyLocalTokenStats(),
    router,
    reasoning: { enabled: true },
  }
}

function eventOf(data: unknown): SessionEvent {
  return { type: KIMI_TIDE_PANEL_EVENT, data } as unknown as SessionEvent
}

describe('kimiTideProjectionDefinition', () => {
  it('init is null (no data pushed yet)', () => {
    expect(kimiTideProjectionDefinition.init()).toBeNull()
  })

  it('apply replaces the whole value (same state reference rules do not apply across events)', () => {
    const p = panel(9)
    const s1 = kimiTideProjectionDefinition.apply(null, eventOf(p))
    expect(s1).toEqual(p)
    const s2 = kimiTideProjectionDefinition.apply(s1, eventOf(panel(9)))
    expect(s2).toEqual(p)
  })

  it('apply ignores unrelated events (same reference back)', () => {
    const other = { type: 'kimi/session', data: {} } as unknown as SessionEvent
    const before = kimiTideProjectionDefinition.apply(null, eventOf(panel(1)))
    expect(kimiTideProjectionDefinition.apply(before, other)).toBe(before)
  })

  it('view passes the state through', () => {
    const p = panel(3)
    expect(kimiTideProjectionDefinition.view(p)).toBe(p)
    expect(kimiTideProjectionDefinition.view(null)).toBeNull()
  })
})
```

注：`SessionEvent` 从 `@deepseek-ai/dsh-session` 导入——需把它也加进 devDependencies（`"@deepseek-ai/dsh-session": "0.1.0-rc.6"`）。若 apply 的 event 参数实际类型与测试字面量不兼容，按编译错误调整 `as unknown as SessionEvent` 的位置。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/projection.test.ts`
Expected: FAIL — `Cannot find module '../src/projection.js'`

- [ ] **Step 3: 实现 projection.ts**

新建 `src/projection.ts`：

```ts
/**
 * kimi-tide: panel projection — key 'kimi-tide/panel', whole-value push.
 * The payload is process-global (quota/router are not per-session), so the
 * host appends the same snapshot to every live session's log; the framework
 * folds and pushes it. Pure unit functions + the SessionProjectionMap merge
 * that types both ends (host register / client useProjection).
 */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { KimiTidePanelProjection } from './types.js'

export const KIMI_TIDE_PANEL_KEY = 'kimi-tide/panel' as const
/** Session event type carrying the whole panel payload (log + fold input). */
export const KIMI_TIDE_PANEL_EVENT = 'kimi-tide/panel' as const

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'kimi-tide/panel': KimiTidePanelProjection | null
  }
}

/** Wire-payload guard. Structural (passthrough) — the payload crosses one process boundary only. */
const panelSchema = z.object({
  quota: z.object({
    weekly: z.object({ used: z.number(), limit: z.number(), resetTime: z.string() }),
    fiveHour: z.object({ used: z.number(), limit: z.number(), resetTime: z.string() }),
    membershipLevel: z.string(),
    fetchedAt: z.number(),
    stale: z.boolean(),
  }).nullable(),
  local: z.object({
    today: z.record(z.string(), z.number()),
    session: z.record(z.string(), z.number()),
    calls: z.number(),
  }),
  router: z.record(z.string(), z.unknown()),
  reasoning: z.object({ enabled: z.literal(true) }),
}).nullable() as unknown as z.ZodType<KimiTidePanelProjection | null>

export const kimiTideProjectionDefinition:
ProjectionDefinition<typeof KIMI_TIDE_PANEL_KEY, KimiTidePanelProjection | null> = {
  key: KIMI_TIDE_PANEL_KEY,
  schema: panelSchema,
  stateVersion: 1,
  init: () => null,
  apply: (state, event) => {
    if (event.type === KIMI_TIDE_PANEL_EVENT) {
      return event.data as KimiTidePanelProjection
    }
    return state
  },
  view: (state) => state,
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/projection.test.ts && npm run typecheck`
Expected: 4 PASS；typecheck 无错误（若 `router`/`local` 的 record schema 与 KimiTidePanelProjection 不兼容，放宽为 `z.any()` 后重试）

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/projection.ts packages/dsh-kimi-tide/test/projection.test.ts
git commit -m "feat: kimi-tide/panel projection (whole-value fold + SessionProjectionMap merge)"
```

---

## Task 6: settings.ts — RouterSettingsStore（行级锚点回写 patch yml）

**Files:**
- Create: `packages/dsh-kimi-tide/src/settings.ts`
- Test: `packages/dsh-kimi-tide/test/settings.test.ts`

**Interfaces:**
- Consumes: `RouterConfig`（router.ts）；schemastery
- Produces:
  - `RouterConfigSchema`（schemastery `Schema<RouterConfig>`）
  - `class RouterSettingsStore { constructor(options: { patchFile: string; onError: (message: string) => void }) }`
  - `load(): RouterConfig | null`
  - `save(config: RouterConfig): void`（校验失败 throw；成功路径：.bak → .tmp → rename）

- [ ] **Step 1: 写失败测试**

新建 `test/settings.test.ts`：

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RouterSettingsStore, RouterConfigSchema } from '../src/settings.js'
import type { RouterConfig } from '../src/router.js'

const BASE_YML = `# user patch — keep my comments!
- insert:
    - id: some-other-plugin   # unrelated row
      name: some-other-plugin
      config:
        foo: 1
    - id: dsh-kimi-tide
      name: dsh-kimi-tide
      config:
        providerName: kimi-tide   # provider comment stays
        kimiHome: ''
        router:
          mode: off
          primary: { provider: deepseek-official, model: deepseek-v4-flash }
          premium: { provider: kimi-tide, model: kimi-for-coding }
`

const NEW_CONFIG: RouterConfig = {
  mode: 'cost',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
  premiumLong: { provider: 'kimi-tide', model: 'k3' },
  escalateWhen: { explicit: true, estimatedTokensGt: 60000, patterns: ['审查', 'review'] },
  premiumBudget: 0.2,
  budgetWindow: 20,
  charsPerToken: 2,
}

describe('RouterSettingsStore', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kimi-tide-settings-'))
    file = join(dir, 'cordis.patch.yml')
    writeFileSync(file, BASE_YML, 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('load() extracts the router section', () => {
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    const config = store.load()
    expect(config?.mode).toBe('off')
    expect(config?.primary.model).toBe('deepseek-v4-flash')
  })

  it('load() returns null when no router section exists', () => {
    writeFileSync(file, '- insert:\n    - id: dsh-kimi-tide\n      config:\n        providerName: kimi-tide\n', 'utf8')
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    expect(store.load()).toBeNull()
  })

  it('save() replaces the router block and preserves comments and other rows', () => {
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    store.save(NEW_CONFIG)
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('# user patch — keep my comments!')
    expect(text).toContain('providerName: kimi-tide   # provider comment stays')
    expect(text).toContain('some-other-plugin')
    expect(text).toContain('mode: cost')
    expect(text).toContain('estimatedTokensGt: 60000')
    expect(text).not.toContain('mode: off')
    expect(store.load()).toEqual(NEW_CONFIG)
  })

  it('save() appends a router block when the row has none', () => {
    writeFileSync(file, '- insert:\n    - id: dsh-kimi-tide\n      name: dsh-kimi-tide\n      config:\n        providerName: kimi-tide\n', 'utf8')
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    store.save(NEW_CONFIG)
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('router:')
    expect(text).toContain('mode: cost')
    expect(store.load()?.mode).toBe('cost')
  })

  it('save() creates a .bak backup before writing', () => {
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    store.save(NEW_CONFIG)
    expect(existsSync(file + '.bak')).toBe(true)
    expect(readFileSync(file + '.bak', 'utf8')).toBe(BASE_YML)
  })

  it('save() rejects invalid configs (schemastery) without touching the file', () => {
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    const bad = { ...NEW_CONFIG, mode: 'bogus' } as unknown as RouterConfig
    expect(() => store.save(bad)).toThrow()
    expect(readFileSync(file, 'utf8')).toBe(BASE_YML)
  })

  it('RouterConfigSchema validates a minimal config', () => {
    const parsed = RouterConfigSchema({
      mode: 'off',
      primary: { provider: 'a', model: 'b' },
      premium: { provider: 'c', model: 'd' },
    })
    expect(parsed.mode).toBe('off')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/settings.test.ts`
Expected: FAIL — `Cannot find module '../src/settings.js'`

- [ ] **Step 3: 实现 settings.ts**

新建 `src/settings.ts`：

```ts
/**
 * kimi-tide: RouterSettingsStore — line-anchored read/write of the router
 * section inside the user's cordis.patch.yml. js-yaml round-trips would
 * destroy user comments, so writes operate on raw text: locate the
 * `- id: dsh-kimi-tide` row, then its `config:` block, then the `router:`
 * subtree, and splice only those lines. Writes are atomic (.tmp + rename)
 * with a .bak copy taken first.
 */
import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import Schema from 'schemastery'
import type { RouterConfig } from './router.js'

const ROW_ANCHOR = /^(\s*)- id: dsh-kimi-tide\s*$/

export const RouterConfigSchema = Schema.object({
  mode: Schema.union([Schema.const('off'), Schema.const('cost'), Schema.const('capability')]),
  primary: Schema.object({ provider: Schema.string(), model: Schema.string() }),
  premium: Schema.object({ provider: Schema.string(), model: Schema.string() }),
  premiumLong: Schema.object({ provider: Schema.string(), model: Schema.string() }),
  escalateWhen: Schema.object({
    explicit: Schema.boolean(),
    estimatedTokensGt: Schema.number(),
    patterns: Schema.array(Schema.string()),
  }),
  premiumBudget: Schema.number(),
  budgetWindow: Schema.number(),
  charsPerToken: Schema.number(),
  rules: Schema.array(Schema.object({
    match: Schema.object({
      patterns: Schema.array(Schema.string()),
      estimatedTokensGt: Schema.number(),
    }),
    route: Schema.object({ provider: Schema.string(), model: Schema.string() }),
  })),
}) as unknown as Schema<RouterConfig>

export interface RouterSettingsStoreOptions {
  /** Absolute path to the user's cordis.patch.yml. */
  patchFile: string
  onError: (message: string) => void
}

interface BlockSpan { start: number; end: number; indent: number }

export class RouterSettingsStore {
  constructor(private readonly options: RouterSettingsStoreOptions) {}

  /** Extract config.router from the dsh-kimi-tide row; null when absent/invalid. */
  load(): RouterConfig | null {
    const lines = readFileSync(this.options.patchFile, 'utf8').split('\n')
    const span = locateRouterBlock(lines)
    if (span === null) return null
    const raw = parseSimpleYamlBlock(lines.slice(span.start + 1, span.end))
    try {
      return RouterConfigSchema(raw) as RouterConfig
    } catch (error) {
      this.options.onError(`dsh-kimi-tide: stored router config invalid, ignoring: ${(error as Error).message}`)
      return null
    }
  }

  /** Validate, then splice the router block into the patch file. */
  save(config: RouterConfig): void {
    const validated = RouterConfigSchema(config) as RouterConfig
    const lines = readFileSync(this.options.patchFile, 'utf8').split('\n')
    const rendered = renderRouterBlock(validated)
    const span = locateRouterBlock(lines)
    let next: string[]
    if (span !== null) {
      next = [
        ...lines.slice(0, span.start),
        ...rendered.map((l) => ' '.repeat(span.indent) + l),
        ...lines.slice(span.end),
      ]
    } else {
      const configBlock = locateConfigBlock(lines)
      if (configBlock === null) {
        throw new Error(`dsh-kimi-tide: cannot locate the dsh-kimi-tide config block in ${this.options.patchFile}`)
      }
      const childIndent = configBlock.indent + 2
      next = [
        ...lines.slice(0, configBlock.end),
        ...rendered.map((l) => ' '.repeat(childIndent) + l),
        ...lines.slice(configBlock.end),
      ]
    }
    copyFileSync(this.options.patchFile, this.options.patchFile + '.bak')
    const tmp = this.options.patchFile + `.tmp-${process.pid}`
    writeFileSync(tmp, next.join('\n'), 'utf8')
    renameSync(tmp, this.options.patchFile)
  }
}

/** Find the dsh-kimi-tide row's `config:` block (children span). */
function locateConfigBlock(lines: string[]): BlockSpan | null {
  for (let i = 0; i < lines.length; i++) {
    const row = ROW_ANCHOR.exec(lines[i])
    if (row === null) continue
    const rowIndent = row[1].length
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      if (line.trim().length === 0) continue
      const indent = line.length - line.trimStart().length
      if (indent <= rowIndent) return null
      const m = /^(\s*)config:\s*(?:#.*)?$/.exec(line)
      if (m !== null) {
        const configIndent = m[1].length
        let end = j + 1
        while (end < lines.length) {
          const l = lines[end]
          if (l.trim().length > 0 && l.length - l.trimStart().length <= configIndent) break
          end++
        }
        return { start: j + 1, end, indent: configIndent }
      }
    }
    return null
  }
  return null
}

/** Find the `router:` subtree lines inside the config block. */
function locateRouterBlock(lines: string[]): BlockSpan | null {
  const config = locateConfigBlock(lines)
  if (config === null) return null
  for (let i = config.start; i < config.end; i++) {
    const m = /^(\s*)router:\s*(?:#.*)?$/.exec(lines[i])
    if (m === null || m[1].length <= config.indent) continue
    const indent = m[1].length
    let end = i + 1
    while (end < config.end) {
      const line = lines[end]
      if (line.trim().length > 0 && !line.trimStart().startsWith('#')) {
        if (line.length - line.trimStart().length <= indent) break
      }
      end++
    }
    return { start: i, end, indent }
  }
  return null
}

/**
 * Minimal YAML-subset parser for the router block (nested maps via indent,
 * flow maps { a: b }, inline arrays [a, b], scalars). Deliberately not a
 * general YAML parser: unreadable shapes fail schemastery validation and
 * load() degrades to null — the file is never corrupted by the read path.
 */
function parseSimpleYamlBlock(lines: string[]): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  const stack: { indent: number; target: Record<string, unknown> }[] = [{ indent: -1, target: root }]
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, '')
    if (line.trim().length === 0) continue
    const indent = rawLine.length - rawLine.trimStart().length
    const m = /^\s*([\w]+):\s*(.*)$/.exec(line)
    if (m === null) continue
    const [, key, rest] = m
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const target = stack[stack.length - 1].target
    if (rest === '') {
      const child: Record<string, unknown> = {}
      target[key] = child
      stack.push({ indent, target: child })
    } else {
      target[key] = parseScalar(rest.trim())
    }
  }
  return root
}

function parseScalar(text: string): unknown {
  if (text === 'true') return true
  if (text === 'false') return false
  if (text.startsWith('{') && text.endsWith('}')) {
    const out: Record<string, unknown> = {}
    const inner = text.slice(1, -1).trim()
    if (inner !== '') {
      for (const pair of inner.split(',')) {
        const idx = pair.indexOf(':')
        if (idx > 0) out[pair.slice(0, idx).trim()] = parseScalar(pair.slice(idx + 1).trim())
      }
    }
    return out
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim()
    return inner === '' ? [] : inner.split(',').map((s) => parseScalar(s.trim()))
  }
  const n = Number(text)
  if (text !== '' && Number.isFinite(n)) return n
  return text.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')
}

/** Render a RouterConfig as block-style YAML lines (relative indent, router: first). */
function renderRouterBlock(config: RouterConfig): string[] {
  const lines: string[] = ['router:']
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue
    renderEntry(lines, key, value, 1)
  }
  return lines
}

function renderEntry(lines: string[], key: string, value: unknown, depth: number): void {
  const pad = '  '.repeat(depth)
  if (Array.isArray(value)) {
    if (value.length === 0) { lines.push(`${pad}${key}: []`); return }
    if (typeof value[0] === 'string') {
      lines.push(`${pad}${key}: [${(value as string[]).join(', ')}]`)
      return
    }
    // rules: array of { match, route } objects — render in flow style per line pair
    lines.push(`${pad}${key}:`)
    for (const item of value as Array<Record<string, unknown>>) {
      lines.push(`${pad}  - match: ${flowMap(item.match as Record<string, unknown>)}`)
      lines.push(`${pad}    route: ${flowMap(item.route as Record<string, unknown>)}`)
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    lines.push(`${pad}${key}:`)
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue
      renderEntry(lines, k, v, depth + 1)
    }
    return
  }
  lines.push(`${pad}${key}: ${formatScalar(value)}`)
}

function flowMap(obj: Record<string, unknown>): string {
  return `{ ${Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${(v as string[]).join(', ')}]` : formatScalar(v)}`)
    .join(', ')} }`
}

function formatScalar(value: unknown): string {
  if (typeof value === 'string') return /^[\w@./\-\u4e00-\u9fff]+$/.test(value) ? value : JSON.stringify(value)
  return String(value)
}
```

注：schemastery 的 `Schema.object` 默认对可选字段的处理——`RouterConfig` 的可选字段（premiumLong 等）在 schema 中不带 `.default()` 时，缺失即拒绝还是放行取决于 schemastery 版本行为。若 Step 4 中 minimal-config 测试失败（"required" 报错），给可选字段逐个补 `.optional()` 或包一层：查阅 bridge `src/index.ts:70-90` 的 Config schema 写法（`z.object({...})` 全默认）后对齐。round-trip 测试（`load()` deep-equal `NEW_CONFIG`）必须绿才算完成。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/settings.test.ts && npm run typecheck`
Expected: 7 PASS；typecheck 无错误。round-trip 失败时修 render/parse 直到 deep-equal。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/settings.ts packages/dsh-kimi-tide/test/settings.test.ts
git commit -m "feat: RouterSettingsStore — line-anchored patch yml read/write with schemastery validation"
```

---

## Task 7: commands.ts — /kimi-tide slash command 族

**Files:**
- Create: `packages/dsh-kimi-tide/src/commands.ts`
- Test: `packages/dsh-kimi-tide/test/commands.test.ts`

**Interfaces:**
- Consumes: `RouterSettingsStore`（Task 6）、`UsageMonitor`（Task 3）、`RouterConfig`；host 注册 API `ctx.commands.register(definition: CommandDefinition): () => void`（`@deepseek-ai/dsh-commands`，d.ts 已确认）
- Produces:
  - `type KimiTideCommand = { kind:'mode', mode } | { kind:'set', key, value } | { kind:'refresh' } | { kind:'help' } | { kind:'error', message }`
  - `parseKimiTideCommand(args: string): KimiTideCommand`
  - `applyKimiTideCommand(cmd, deps): Promise<string>`（返回用户可见回执文本）
  - `KimiTideCommandDeps { store: RouterSettingsStore; monitor: UsageMonitor; current: () => RouterConfig; onSaved: (config: RouterConfig) => void }`
  - `registerKimiTideCommands(ctx: Context, deps: KimiTideCommandDeps): void`

- [ ] **Step 1: 写失败测试**

新建 `test/commands.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import { applyKimiTideCommand, parseKimiTideCommand, type KimiTideCommandDeps } from '../src/commands.js'
import type { RouterConfig } from '../src/router.js'
import type { RouterSettingsStore } from '../src/settings.js'
import type { UsageMonitor } from '../src/usage.js'

const BASE: RouterConfig = {
  mode: 'off',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
}

function makeDeps(saved: RouterConfig[] = []): KimiTideCommandDeps {
  return {
    store: { save: vi.fn((c: RouterConfig) => saved.push(c)) } as unknown as RouterSettingsStore,
    monitor: { refresh: vi.fn(async () => {}) } as unknown as UsageMonitor,
    current: () => BASE,
    onSaved: vi.fn(),
  }
}

describe('parseKimiTideCommand', () => {
  it('parses mode subcommand', () => {
    expect(parseKimiTideCommand('mode cost')).toEqual({ kind: 'mode', mode: 'cost' })
    expect(parseKimiTideCommand('mode off')).toEqual({ kind: 'mode', mode: 'off' })
  })
  it('rejects invalid mode', () => {
    expect(parseKimiTideCommand('mode bogus').kind).toBe('error')
  })
  it('parses set subcommand with number/boolean coercion', () => {
    expect(parseKimiTideCommand('set premiumBudget 0.3')).toEqual({ kind: 'set', key: 'premiumBudget', value: 0.3 })
    expect(parseKimiTideCommand('set escalateWhen.estimatedTokensGt 90000')).toEqual({ kind: 'set', key: 'escalateWhen.estimatedTokensGt', value: 90000 })
    expect(parseKimiTideCommand('set escalateWhen.explicit false')).toEqual({ kind: 'set', key: 'escalateWhen.explicit', value: false })
  })
  it('parses refresh and empty/help', () => {
    expect(parseKimiTideCommand('refresh')).toEqual({ kind: 'refresh' })
    expect(parseKimiTideCommand('')).toEqual({ kind: 'help' })
    expect(parseKimiTideCommand('help')).toEqual({ kind: 'help' })
  })
  it('errors on unknown subcommand', () => {
    expect(parseKimiTideCommand('frobnicate').kind).toBe('error')
  })
})

describe('applyKimiTideCommand', () => {
  it('mode: merges into current config, saves, fires onSaved', async () => {
    const saved: RouterConfig[] = []
    const deps = makeDeps(saved)
    const reply = await applyKimiTideCommand({ kind: 'mode', mode: 'cost' }, deps)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toEqual({ ...BASE, mode: 'cost' })
    expect(deps.onSaved).toHaveBeenCalledWith(saved[0])
    expect(reply).toContain('cost')
  })

  it('set: applies dotted key and persists', async () => {
    const saved: RouterConfig[] = []
    const deps = makeDeps(saved)
    await applyKimiTideCommand({ kind: 'set', key: 'premiumBudget', value: 0.5 }, deps)
    expect(saved[0].premiumBudget).toBe(0.5)
  })

  it('set: rejects unknown keys at parse time (error kind reaches apply as message)', async () => {
    const deps = makeDeps()
    const cmd = parseKimiTideCommand('set hacker 1')
    expect(cmd.kind).toBe('error')
    const reply = await applyKimiTideCommand(cmd, deps)
    expect(reply).toMatch(/unknown/i)
    expect(deps.store.save).not.toHaveBeenCalled()
  })

  it('refresh: triggers monitor.refresh and replies', async () => {
    const deps = makeDeps()
    const reply = await applyKimiTideCommand({ kind: 'refresh' }, deps)
    expect(deps.monitor.refresh).toHaveBeenCalledOnce()
    expect(reply).toMatch(/refresh/i)
  })

  it('surfaces store validation errors as a reply, not a throw', async () => {
    const deps = makeDeps()
    deps.store.save = vi.fn(() => { throw new Error('schema rejected') }) as unknown as RouterSettingsStore['save']
    const reply = await applyKimiTideCommand({ kind: 'mode', mode: 'cost' }, deps)
    expect(reply).toContain('schema rejected')
    expect(deps.onSaved).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/commands.test.ts`
Expected: FAIL — `Cannot find module '../src/commands.js'`

- [ ] **Step 3: 实现 commands.ts**

新建 `src/commands.ts`：

```ts
/**
 * kimi-tide: /kimi-tide slash command family — the client→host channel for
 * the dock panel (browser calls ctx.remote.commands.execute(sessionId,
 * '/kimi-tide …'); the harness routes it to this registration).
 *
 * Subcommands:
 *   /kimi-tide mode off|cost|capability
 *   /kimi-tide set <key> <value>     (dotted keys into RouterConfig)
 *   /kimi-tide refresh               (re-poll the usages endpoint now)
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { RouterConfig } from './router.js'
import type { RouterSettingsStore } from './settings.js'
import type { UsageMonitor } from './usage.js'

export type KimiTideCommand =
  | { kind: 'mode'; mode: RouterConfig['mode'] }
  | { kind: 'set'; key: string; value: unknown }
  | { kind: 'refresh' }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

export interface KimiTideCommandDeps {
  store: RouterSettingsStore
  monitor: UsageMonitor
  current: () => RouterConfig
  /** Called after a successful save: rebuild the router + push projection. */
  onSaved: (config: RouterConfig) => void
}

/** Keys settable via `/kimi-tide set` — dotted paths into RouterConfig. */
const SETTABLE_KEYS: Record<string, 'number' | 'boolean' | 'string'> = {
  premiumBudget: 'number',
  budgetWindow: 'number',
  charsPerToken: 'number',
  'escalateWhen.estimatedTokensGt': 'number',
  'escalateWhen.explicit': 'boolean',
  'primary.model': 'string',
  'premium.model': 'string',
  'premiumLong.model': 'string',
}

export function parseKimiTideCommand(args: string): KimiTideCommand {
  const parts = args.trim().split(/\s+/).filter((p) => p.length > 0)
  if (parts.length === 0 || parts[0] === 'help') return { kind: 'help' }
  switch (parts[0]) {
    case 'mode': {
      const mode = parts[1]
      if (mode === 'off' || mode === 'cost' || mode === 'capability') return { kind: 'mode', mode }
      return { kind: 'error', message: `usage: /kimi-tide mode off|cost|capability (got "${mode ?? ''}")` }
    }
    case 'set': {
      const [key, raw] = [parts[1], parts[2]]
      if (key === undefined || raw === undefined) return { kind: 'error', message: 'usage: /kimi-tide set <key> <value>' }
      const type = SETTABLE_KEYS[key]
      if (type === undefined) {
        return { kind: 'error', message: `unknown settable key "${key}" (allowed: ${Object.keys(SETTABLE_KEYS).join(', ')})` }
      }
      if (type === 'number') {
        const n = Number(raw)
        if (!Number.isFinite(n)) return { kind: 'error', message: `"${raw}" is not a number` }
        return { kind: 'set', key, value: n }
      }
      if (type === 'boolean') {
        if (raw !== 'true' && raw !== 'false') return { kind: 'error', message: `"${raw}" is not a boolean` }
        return { kind: 'set', key, value: raw === 'true' }
      }
      return { kind: 'set', key, value: raw }
    }
    case 'refresh':
      return { kind: 'refresh' }
    default:
      return { kind: 'error', message: `unknown subcommand "${parts[0]}" — try /kimi-tide help` }
  }
}

const HELP_TEXT = [
  '/kimi-tide mode off|cost|capability — switch routing mode',
  '/kimi-tide set <key> <value> — update one router setting',
  `  keys: ${Object.keys(SETTABLE_KEYS).join(', ')}`,
  '/kimi-tide refresh — re-poll Kimi quota now',
].join('\n')

export async function applyKimiTideCommand(cmd: KimiTideCommand, deps: KimiTideCommandDeps): Promise<string> {
  switch (cmd.kind) {
    case 'help':
      return HELP_TEXT
    case 'error':
      return `kimi-tide: ${cmd.message}`
    case 'refresh':
      await deps.monitor.refresh()
      return 'kimi-tide: quota refreshed'
    case 'mode':
      return persist({ ...deps.current(), mode: cmd.mode }, deps, `mode → ${cmd.mode}`)
    case 'set': {
      const next = structuredClone(deps.current())
      setDotted(next as unknown as Record<string, unknown>, cmd.key, cmd.value)
      return persist(next, deps, `${cmd.key} → ${String(cmd.value)}`)
    }
  }
}

function persist(config: RouterConfig, deps: KimiTideCommandDeps, what: string): string {
  try {
    deps.store.save(config)
  } catch (error) {
    return `kimi-tide: save failed — ${(error as Error).message}`
  }
  deps.onSaved(config)
  return `kimi-tide: saved (${what}); effective now, persists across restarts`
}

function setDotted(target: Record<string, unknown>, dotted: string, value: unknown): void {
  const segments = dotted.split('.')
  let node = target
  for (const segment of segments.slice(0, -1)) {
    if (node[segment] === undefined || node[segment] === null) node[segment] = {}
    node = node[segment] as Record<string, unknown>
  }
  node[segments[segments.length - 1]] = value
}

/**
 * Register the /kimi-tide command globally. Registration is an effect
 * (disposer rides the plugin fiber), matching dsh-commands' runtime.
 */
export function registerKimiTideCommands(ctx: Context, deps: KimiTideCommandDeps): void {
  ctx.effect(() => {
    return ctx.commands.register({
      name: 'kimi-tide',
      description: '月汐 panel: route mode / settings / quota refresh',
      input: { hint: 'mode off|cost|capability · set <key> <value> · refresh' },
      handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
        const cmd = parseKimiTideCommand(invocation.rawInput)
        const text = await applyKimiTideCommand(cmd, deps)
        return cmd.kind === 'error' ? { kind: 'error', text } : { kind: 'success', text }
      },
    })
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/commands.test.ts && npm run typecheck`
Expected: 全部 PASS；typecheck 无错误（`ctx.commands` 由 dsh-commands 的 declaration merging 提供，确保 devDep 已装）

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/commands.ts packages/dsh-kimi-tide/test/commands.test.ts
git commit -m "feat: /kimi-tide slash command family (mode/set/refresh) via dsh-commands"
```

---

## Task 8: index.ts 集成 — 装配全部单元 + patch 文件定位

**Files:**
- Modify: `packages/dsh-kimi-tide/src/index.ts`
- Test: `packages/dsh-kimi-tide/test/index-wiring.test.ts`（仅验证纯函数 `defaultPatchFile()` 与 `buildRouter()` 的行为，不启动 cordis）

**Interfaces:**
- Consumes: 全部前序任务产物 + `KNOWN_SESSION_EVENT_TYPES`（`@deepseek-ai/dsh-session`）+ `installRouter`（router.ts）+ `agent.session.append`（dsh-agent Session API，bridge `kimi-manager.ts:568` 先例）
- Produces:
  - `defaultPatchFile(): string`（`$DSH_HOME/profiles/web/cordis.patch.yml`，`DSH_HOME` 缺省 `~/.dsh`）
  - `buildRouter(config: RouterConfig, log: RouterLog): KimiRouter`
  - `DEFAULT_ROUTER_CONFIG: RouterConfig`（mode off 的完整默认）
  - Config 扩展：`usagePollMs?: number`、`usagePollOnStart?: boolean`、`router?: RouterConfig`、`patchFile?: string`（测试/自定义覆盖）
  - `apply()` 全装配：oauth → adapter(onUsage) → monitor(start) → store(load) → router(install, mode!=='off') → commands(register) → projection(register + KNOWN_SESSION_EVENT_TYPES.add) → session 生命周期 append（`session/created`/`agent/created` → 推送当前快照）

- [ ] **Step 1: 写失败测试**

新建 `test/index-wiring.test.ts`：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ROUTER_CONFIG, buildRouter, defaultPatchFile } from '../src/index.js'

describe('defaultPatchFile', () => {
  const original = process.env.DSH_HOME
  afterEach(() => {
    if (original === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = original
  })

  it('uses DSH_HOME when set', () => {
    process.env.DSH_HOME = '/tmp/dsh-test'
    expect(defaultPatchFile()).toBe('/tmp/dsh-test/profiles/web/cordis.patch.yml')
  })

  it('falls back to ~/.dsh', () => {
    delete process.env.DSH_HOME
    expect(defaultPatchFile()).toMatch(/\.dsh[\\/]profiles[\\/]web[\\/]cordis\.patch\.yml$/)
  })
})

describe('buildRouter / DEFAULT_ROUTER_CONFIG', () => {
  it('default config is mode off with deepseek primary and kimi premium', () => {
    expect(DEFAULT_ROUTER_CONFIG.mode).toBe('off')
    expect(DEFAULT_ROUTER_CONFIG.primary.provider).toBe('deepseek-official')
    expect(DEFAULT_ROUTER_CONFIG.premium.provider).toBe('kimi-tide')
  })

  it('buildRouter returns a KimiRouter whose decisions respect the config', () => {
    const logs: string[] = []
    const router = buildRouter({ ...DEFAULT_ROUTER_CONFIG, mode: 'cost' }, { info: (m) => logs.push(m) })
    const decision = router.decide([{ role: 'user', content: [{ type: 'text', text: '请审查这段代码 review' }] } as never], 0)
    expect(decision.kind).toBe('route')
  })
})
```

注：第二条测试依赖 router.ts 的默认升级词表（含「审查」「review」）。若 `UserMessage` 构造与类型不匹配，按编译错误调整 `as never` 为真实类型。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/index-wiring.test.ts`
Expected: FAIL — `DEFAULT_ROUTER_CONFIG is not exported`

- [ ] **Step 3: 实现 index.ts 集成**

将 `src/index.ts` 整体替换为：

```ts
/**
 * dsh-kimi-tide — 月汐
 *
 * Kimi Code (Moonshot) subscription as a native DeepSeek Harness LLM
 * provider, plus the 月汐 dock panel: official quota display, local token
 * stats, and a router-settings panel persisted back into the user's
 * cordis.patch.yml.
 */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { KimiAdapter } from './adapter.js'
import { registerKimiTideCommands } from './commands.js'
import { KimiOAuthManager } from './oauth.js'
import { KIMI_TIDE_PANEL_EVENT, kimiTideProjectionDefinition } from './projection.js'
import { installRouter, KimiRouter, type RouterConfig, type RouterLog } from './router.js'
import { RouterSettingsStore } from './settings.js'
import { UsageMonitor } from './usage.js'
import type { KimiTidePanelProjection } from './types.js'

export const name = 'dsh-kimi-tide'

export const inject = ['llm', 'timer', 'commands', 'sessionProjections']

export interface Config {
  /** Provider route name registered into ctx.llm. */
  providerName?: string
  /** Kimi home directory; default follows KIMI_CODE_HOME then ~/.kimi-code. */
  kimiHome?: string
  /** Token refresh period in milliseconds (access tokens live ~15 min). */
  refreshIntervalMs?: number
  /** Refresh immediately on startup (default true). */
  refreshOnStart?: boolean
  /** Quota poll period in milliseconds (default 60000). */
  usagePollMs?: number
  /** Poll quota immediately on startup (default true). */
  usagePollOnStart?: boolean
  /** Router config; absent/mode off = 0.1.x behavior. The dock panel persists edits to the patch file. */
  router?: RouterConfig
  /** Patch file to persist router settings into (default $DSH_HOME/profiles/web/cordis.patch.yml). */
  patchFile?: string
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  mode: 'off',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
  premiumLong: { provider: 'kimi-tide', model: 'k3' },
}

export function defaultPatchFile(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'profiles', 'web', 'cordis.patch.yml')
}

export function buildRouter(config: RouterConfig, log: RouterLog): KimiRouter {
  return new KimiRouter(config, log)
}

export function apply(ctx: Context, config: Config = {}) {
  const providerName = config.providerName ?? 'kimi-tide'
  const refreshIntervalMs = config.refreshIntervalMs ?? 10 * 60 * 1000
  const log: RouterLog = { info: (m) => ctx.logger?.info?.(m) }

  // The strict persistence reader refuses logs with unknown event types.
  KNOWN_SESSION_EVENT_TYPES.add(KIMI_TIDE_PANEL_EVENT)

  const oauth = new KimiOAuthManager(ctx.logger, { home: config.kimiHome ?? '' })

  // Panel data source: quota polling + local token buckets.
  const monitor = new UsageMonitor(oauth, {
    pollMs: config.usagePollMs ?? 60_000,
    onUpdate: () => pushPanelToAllSessions(),
  })

  const adapter = new KimiAdapter(oauth, {
    providerName,
    onUsage: (usage) => monitor.tapUsage(usage),
  })
  ctx.llm.registerAdapter([providerName], adapter)

  // Router: static config wins; otherwise the persisted panel config; else default off.
  const store = new RouterSettingsStore({
    patchFile: config.patchFile ?? defaultPatchFile(),
    onError: (message) => ctx.logger?.warn?.(message),
  })
  let routerConfig: RouterConfig = config.router ?? loadPersisted(store) ?? DEFAULT_ROUTER_CONFIG
  let disposeRouter: (() => void) | null = null
  const mountRouter = () => {
    disposeRouter?.()
    disposeRouter = null
    if (routerConfig.mode !== 'off') {
      disposeRouter = installRouter(ctx, buildRouter(routerConfig, log))
    }
  }
  mountRouter()

  // Panel persistence + commands (client→host channel).
  registerKimiTideCommands(ctx, {
    store,
    monitor,
    current: () => routerConfig,
    onSaved: (next) => {
      routerConfig = next
      mountRouter()
      pushPanelToAllSessions()
    },
  })

  // Projection: register the unit, then push the current snapshot into every
  // session as it appears (panel data is process-global, not per-session).
  ctx.sessionProjections.register(kimiTideProjectionDefinition)
  const panelSnapshot = (): KimiTidePanelProjection => ({
    quota: monitor.snapshot().quota,
    local: monitor.snapshot().local,
    router: routerConfig,
    reasoning: { enabled: true },
  })
  const pushPanel = (agent: Agent) => {
    try {
      agent.session.append(KIMI_TIDE_PANEL_EVENT, panelSnapshot())
    } catch (error) {
      ctx.logger?.warn?.(`dsh-kimi-tide: panel push failed: ${(error as Error).message}`)
    }
  }
  const liveAgents = new Set<Agent>()
  function pushPanelToAllSessions() {
    for (const agent of liveAgents) pushPanel(agent)
  }
  ctx.on('agent/created', (agent: Agent) => {
    liveAgents.add(agent)
    pushPanel(agent)
  })
  ctx.on('agent/disposed', (agent: Agent) => {
    liveAgents.delete(agent)
  })

  // OAuth refresh loop (0.1.x behavior).
  const refresh = () => { void oauth.refresh().catch(() => {}) }
  if (config.refreshOnStart !== false) void oauth.refresh().catch(() => {})
  ctx.effect(() => {
    const timer = ctx.setInterval(refresh, refreshIntervalMs)
    return () => timer()
  })

  // Quota polling lifecycle.
  if (config.usagePollOnStart !== false) monitor.start()
  ctx.effect(() => () => monitor.stop())
  ctx.effect(() => () => disposeRouter?.())
}

function loadPersisted(store: RouterSettingsStore): RouterConfig | null {
  try {
    return store.load()
  } catch {
    return null
  }
}
```

注意：`agent/created` / `agent/disposed` 事件名以 `@deepseek-ai/dsh-agent` 的 Events 声明为准——若编译报未知事件，改为 `ctx.on('session/created', ...)`（dsh-session 事件）或先 `grep` dsh-agent 的 `.d.ts` 确认可用事件名后调整。`agent.session.append(type, data)` 的签名先例见 bridge `kimi-manager.ts:467/568`。

同时更新 `cordis.patch.yml`（包内示例），在 config 块追加注释示例：

```yaml
        # usagePollMs: 60000      # quota poll period (月汐 dock)
        # usagePollOnStart: true  # poll quota on startup
        # router:                 # managed by the 月汐 dock panel; default off
        #   mode: off             # off | cost | capability
```

- [ ] **Step 4: 全量验证**

Run: `npm run typecheck && npm test && npm run build:host`（工作目录 `packages/dsh-kimi-tide`）
Expected: typecheck 无错误；全部测试 PASS；host build 产出 lib/index.js 等

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/index.ts packages/dsh-kimi-tide/test/index-wiring.test.ts packages/dsh-kimi-tide/cordis.patch.yml
git commit -m "feat: wire usage/settings/commands/projection/router into plugin apply"
```

---

## Task 9: client — TideDock 面板 + slot 注册

**Files:**
- Create: `packages/dsh-kimi-tide/src/client/index.ts`
- Create: `packages/dsh-kimi-tide/src/client/TideDock.tsx`
- （无单元测试——client 侧验证在 M5 实机；类型正确性由 Task 10 的 esbuild + 实机构建保障）

**Interfaces:**
- Consumes: standard props（`sessionId`、`useProjection`——SessionStandardProps，dsh-client-ui-slots 合并声明）；`ctx.remote.commands.execute`；`KimiTidePanelProjection` 类型（从 `../types.js` type-only import，esbuild 会抹掉）
- Produces: client bundle 默认导出 cordis 插件形态 `{ name, inject, apply }`（bridge client/index.ts 同款：named `inject` + `apply` 导出）

- [ ] **Step 1: 写 client/index.ts**

新建 `src/client/index.ts`：

```ts
/**
 * Browser half of dsh-kimi-tide: registers the 月汐 dock panel into the
 * conversation composer dock band (ambient readout under the composer card,
 * beside the shipped stats line). Panel data rides the
 * 'kimi-tide/panel' session projection; user actions go back through
 * ctx.remote.commands.execute(sessionId, '/kimi-tide …').
 */
import type { Context } from '@deepseek-ai/cordis'
import { TideDock } from './TideDock.js'

export const inject = ['slots', 'remote', 'remote.commands']

export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'kimi-tide',
    order: 10, // after the shipped stats line (order 0)
    label: '月汐',
  }, TideDock))

  // Plugin-scoped styles; the slot/loader lifecycle removes them on unload.
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-kimi-tide'
  style.textContent = `
    .kimi-tide-dock { display: flex; align-items: center; gap: 10px; font-size: 12px;
      color: var(--dsw-alias-label-tertiary, #8b93a7); flex-wrap: wrap; }
    .kimi-tide-dock .kt-label { font-weight: 600; color: var(--dsw-alias-label-primary, #2b3245); }
    .kimi-tide-dock .kt-warn { color: var(--dsw-alias-warning-strong, #d97706); }
    .kimi-tide-dock .kt-danger { color: var(--dsw-alias-danger-strong, #e5484d); }
    .kimi-tide-dock .kt-stale { opacity: 0.55; }
    .kimi-tide-dock button { font-size: 12px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1, #e4e7ee);
      background: transparent; color: inherit; border-radius: 6px; padding: 1px 8px; }
    .kimi-tide-dock button.kt-active { background: var(--dsw-alias-interactive-bg-hover-accent, rgba(77,107,254,0.12));
      color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: currentColor; }
    .kimi-tide-dock details { flex-basis: 100%; }
    .kimi-tide-dock details > div { padding: 6px 0 2px; display: flex; flex-direction: column; gap: 4px; }
    .kimi-tide-dock input, .kimi-tide-dock select { font-size: 12px; padding: 1px 6px;
      border: 1px solid var(--dsw-alias-border-l2, #d4d9e3); border-radius: 6px; background: var(--dsw-alias-bg-base, #fff);
      color: var(--dsw-alias-label-primary, #2b3245); }
  `
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove())
}
```

- [ ] **Step 2: 写 TideDock.tsx**

新建 `src/client/TideDock.tsx`：

```tsx
/**
 * TideDock — the 月汐 composer-dock panel. One compact row (mode toggle,
 * route chip, quota chips, local tokens, freshness), plus a <details> fold
 * with membership, reset countdowns, the router settings form, and the
 * reasoning status line. Reads 'kimi-tide/panel' via the standard-kit
 * useProjection hook; writes via remote slash commands.
 */
import { useState, type CSSProperties } from 'react'
import type { KimiTidePanelProjection } from '../types.js'

export interface TideDockProps {
  sessionId: string
  useProjection: (key: 'kimi-tide/panel') => KimiTidePanelProjection | null | undefined
  /** Remote command executor (standard kit via ctx.remote in index; passed as prop by the slot renderer is NOT
   *  available — TideDock reads it from the closure registered below). */
}

/** Wired in client/index.ts apply(): the dock component calls back into cordis ctx. */
export interface TideDockBridge {
  execute: (sessionId: string, line: string) => Promise<unknown>
}
export const tideDockBridge: TideDockBridge = { execute: async () => undefined }

function pct(used: number, limit: number): number {
  return limit > 0 ? Math.round((used / limit) * 100) : 0
}

function pctClass(p: number): string {
  if (p >= 90) return 'kt-danger'
  if (p >= 80) return 'kt-warn'
  return ''
}

function fmtClock(ts: number): string {
  if (ts <= 0) return '--:--'
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtCountdown(resetTime: string): string {
  const t = Date.parse(resetTime)
  if (!Number.isFinite(t)) return ''
  const ms = t - Date.now()
  if (ms <= 0) return '已到期'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h}h${m}m 后重置` : `${m}m 后重置`
}

const chip: CSSProperties = { whiteSpace: 'nowrap' }

export function TideDock(props: TideDockProps) {
  const panel = props.useProjection('kimi-tide/panel')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const run = async (line: string) => {
    setBusy(true)
    setNotice('')
    try {
      const result = await tideDockBridge.execute(props.sessionId, line) as { ok?: boolean; value?: { matched?: boolean } } | undefined
      if (result !== undefined && 'ok' in result && result.ok === false) {
        setNotice('命令通道不可用（需 dsh-api-remotes）')
      }
    } catch {
      setNotice('命令执行失败')
    } finally {
      setBusy(false)
    }
  }

  if (panel === undefined || panel === null) {
    return <div className="kimi-tide-dock"><span className="kt-label">🌙 月汐</span><span>面板数据加载中…</span></div>
  }

  const { quota, local, router } = panel
  const weekPct = quota === null ? 0 : pct(quota.weekly.used, quota.weekly.limit)
  const fivePct = quota === null ? 0 : pct(quota.fiveHour.used, quota.fiveHour.limit)
  const inTok = local.today.inputTokens ?? 0
  const outTok = local.today.outputTokens ?? 0
  const cacheTok = local.today.cacheReadTokens ?? 0
  const cachePct = inTok + cacheTok > 0 ? Math.round((cacheTok / (inTok + cacheTok)) * 100) : 0

  return (
    <div className="kimi-tide-dock">
      <span className="kt-label">🌙 月汐</span>

      <span role="group" aria-label="route mode">
        {(['off', 'cost', 'capability'] as const).map((m) => (
          <button
            key={m}
            disabled={busy}
            className={router.mode === m ? 'kt-active' : ''}
            onClick={() => void run(`/kimi-tide mode ${m}`)}
          >{m}</button>
        ))}
      </span>

      {router.mode !== 'off' && (
        <span style={chip}>
          {router.primary.model}
          {router.premiumBudget !== undefined && router.mode === 'cost' && ` · 预算 ${Math.round(router.premiumBudget * 100)}%`}
        </span>
      )}

      {quota === null ? (
        <span style={chip} className="kt-stale">配额不可用</span>
      ) : (
        <span style={chip} className={quota.stale ? 'kt-stale' : ''}>
          <span className={pctClass(weekPct)}>wk {weekPct}%</span>
          {' · '}
          <span className={pctClass(fivePct)}>5h {fivePct}%</span>
          {` · upd ${fmtClock(quota.fetchedAt)}`}
          {quota.stale && ' (过期)'}
        </span>
      )}

      <span style={chip}>今日 in {inTok} · out {outTok} · cache {cachePct}%</span>

      <button disabled={busy} onClick={() => void run('/kimi-tide refresh')}>刷新</button>

      <details>
        <summary>设置</summary>
        <div>
          {quota !== null && (
            <span>
              会员 {quota.membershipLevel || '未知'}
              {quota.weekly.resetTime !== '' && ` · 周配额 ${fmtCountdown(quota.weekly.resetTime)}`}
              {quota.fiveHour.resetTime !== '' && ` · 5h 窗口 ${fmtCountdown(quota.fiveHour.resetTime)}`}
            </span>
          )}
          <QuotaForm router={router} busy={busy} run={run} />
          <span>推理输出已启用（DSH 原生渲染 reasoning-delta）</span>
          {notice !== '' && <span className="kt-warn">{notice}</span>}
        </div>
      </details>
    </div>
  )
}

function QuotaForm({ router, busy, run }: {
  router: KimiTidePanelProjection['router']
  busy: boolean
  run: (line: string) => Promise<void>
}) {
  const fields: Array<{ key: string; label: string; value: string | number | boolean | undefined }> = [
    { key: 'premiumBudget', label: 'Kimi 预算占比', value: router.premiumBudget },
    { key: 'budgetWindow', label: '预算窗口', value: router.budgetWindow },
    { key: 'charsPerToken', label: '字符/token 比', value: router.charsPerToken },
    { key: 'escalateWhen.estimatedTokensGt', label: '升级 token 阈值', value: router.escalateWhen?.estimatedTokensGt },
    { key: 'primary.model', label: '主力模型', value: router.primary.model },
    { key: 'premium.model', label: 'Kimi 模型', value: router.premium.model },
    { key: 'premiumLong.model', label: '长上下文模型', value: router.premiumLong?.model },
  ]
  return (
    <>
      {fields.map((f) => (
        <label key={f.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ width: 110 }}>{f.label}</span>
          <input
            defaultValue={f.value === undefined ? '' : String(f.value)}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run(`/kimi-tide set ${f.key} ${(e.target as HTMLInputElement).value}`)
            }}
          />
        </label>
      ))}
      <span style={{ opacity: 0.7 }}>回车保存单项；模式切换用上方按钮。保存即写入 patch 文件并即时生效。</span>
    </>
  )
}
```

然后把 `tideDockBridge` 接到真实 remote：在 `client/index.ts` 的 `apply()` 顶部加：

```ts
import { tideDockBridge } from './TideDock.js'
// inside apply():
tideDockBridge.execute = (sessionId, line) =>
  (ctx as unknown as { remote: { commands: { execute: (sid: string, l: string) => Promise<unknown> } } })
    .remote.commands.execute(sessionId, line)
```

- [ ] **Step 3: 构建 client bundle 验证**

Run: `npm run build:client`
Expected: 输出 `lib/client.js` 且含 `window.__ModuleLoader__.load({ id: "dsh-kimi-tide"` 头。若 esbuild 报类型/解析错误（如 `../types.js` import），将 TideDock 中的类型 import 改为 `import type { KimiTidePanelProjection } from '../types.js'`（esbuild 不查类型，但 tsc typecheck 需要——host typecheck 已排除 src/client，所以 client 目录的 TS 严格性以 esbuild 可解析为准）。

- [ ] **Step 4: Commit**

```bash
git add packages/dsh-kimi-tide/src/client packages/dsh-kimi-tide/lib/client.js
git commit -m "feat: 月汐 TideDock composer panel (mode toggle, quota chips, settings fold)"
```

注：`lib/client.js` 是否入库按仓库惯例——bridge 的 `lib/` 未入库（`.gitignore`）。检查 `vendor/dsh-kimi-bridge/.gitignore`：若 lib 被忽略，则本包也不提交 lib，改为发布时构建；commit 中去掉 lib/client.js。

---

## Task 10: 端到端组装验证 + 文档

**Files:**
- Modify: `packages/dsh-kimi-tide/README.md`（新增「月汐 dock 面板」章节）
- Modify: `docs/development-plan-router.md`（里程碑 M3.5-M3.7 状态 → ✅）

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 可手工实机验证的构建产物 + 文档

- [ ] **Step 1: 全量构建 + 全量测试**

Run: `npm run build && npm test`（工作目录 `packages/dsh-kimi-tide`）
Expected: build:host + build:client 成功；全部 vitest PASS

- [ ] **Step 2: README 新增面板章节**

在 `packages/dsh-kimi-tide/README.md` 追加（中文，与现有文风一致）：

```markdown
## 月汐 dock 面板（0.2.0）

会话输入框下方的「🌙 月汐」面板提供：

- **用量显示**：周配额 / 5 小时窗口百分比（≥80% 黄、≥90% 红），会员等级与重置倒计时在展开区；`upd HH:MM` 为上次刷新时间，凭据失效时灰化显示「过期」。
- **本地 token 统计**：今日 input/output/cache 命中率（按调用次数口径，与官方配额分开展示，不做换算）。
- **路由模式切换**：off / cost / capability 一键切换，保存即写入用户 `cordis.patch.yml` 并即时生效（重启保持）。
- **设置表单**：展开区逐项编辑预算占比、升级阈值、模型选择等，回车保存。
- **推理状态**：推理输出已由 DSH 原生渲染（reasoning-delta），面板仅提示「已启用」。

面板命令族（也可在输入框直接敲）：
- `/kimi-tide mode off|cost|capability`
- `/kimi-tide set <key> <value>`（key 见面板表单）
- `/kimi-tide refresh`（立即刷新配额）
```

- [ ] **Step 3: 实机手工验证清单（M5 扩展项，人工执行）**

1. 构建后把包装进 web profile（`dsh plugin --profile web add .` 或既有安装方式），重启 `dsh web`
2. 会话区输入框下方出现「🌙 月汐」行：wk/5h 百分比与 `kimi` CLI 数据一致；今日 token 随对话增长
3. 模式切到 cost → 用户 patch yml 的 `dsh-kimi-tide` 行下出现 `router: mode: cost`，其他行与注释不动；重启 dsh web 后模式保持
4. `/kimi-tide refresh` 后 `upd` 时间戳更新；断凭据后显示「过期」
5. cost 模式下：普通消息走 deepseek（会话日志 `request/header` 观察）；`@kimi …` 走 kimi

- [ ] **Step 4: 更新上游计划里程碑状态**

`docs/development-plan-router.md` 里程碑表 M3.5/M3.6/M3.7 状态从「📋 已计划（2026-08-17）」改为「✅」（实机验证通过后）。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/README.md docs/development-plan-router.md
git commit -m "docs: 月汐 dock panel section + milestone status"
```

---

## 风险与开放点（执行时注意）

| 点 | 处理 |
|---|---|
| `agent/created` / `agent/disposed` 事件名未逐一核实 | Task 8 Step 3 有指引：编译失败时 grep dsh-agent d.ts 换事件名（备选 `session/created`）；panel 数据是进程级，推送到哪个会话载体都行 |
| schemastery 可选字段行为 | Task 6 Step 3 有指引：对齐 bridge Config schema 写法 |
| projection schema 严格度 | Task 5 schema 用宽松 record；若框架对 wire payload 校验失败，放宽到 `z.any()` 并在测试锁定 fold 行为 |
| client 类型检查弱 | src/client 被 host typecheck 排除，esbuild 不做类型检查——实机验证（Task 10 Step 3）是最终防线 |
| dsh-api-remotes 包名 | 设计文档指定；若 `npm install` 找不到，查本机 dsh 安装内 `dsh-client-runtime` 的 remote.commands 由哪个包声明（grep `"dsh-api-remotes"`），以实际包名为准 |
