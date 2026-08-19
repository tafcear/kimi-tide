# kimi-tide 0.3.0 能力评分路由 Implementation Plan

> **状态（2026-08-19 更新）**：✅ 11 任务全部实施完成（2026-08-18，ff 合并 main，commit 86da918，154/154 测试绿），待 README 7 步手工验收。3 处计划缺陷经裁定修正：T6 defaultTarget 笔误 / T8 RouteDecision 缺 scoreDelta / T10 import-config 双形态。架构实况详见 `packages/dsh-kimi-tide/docs/router-v3.md`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 kimi-tide 路由从「固定槽位+关键词升级」升级为「六维能力评分+provider 无关候选池」，配置持久化迁出被监视的 patch 文件（sidecar），面板 v3 可管理候选与评分并显示决策理由。

**Architecture:** 纯函数核心（classify/score/select）+ 薄引擎（KimiRouter v2）+ sidecar 持久化（yaml ^2.x，损坏回退链）+ index.ts 装配（候选枚举/modality 缓存/projection 可观测）。接口契约：`RouterConfigV2` / `CandidateMeta`（M4.1a 产出）与 `classify()/scoreCandidate()/selectCandidate()`（M4.2 产出）。

**Tech Stack:** TypeScript（host）、React.createElement-free TSX（client，esbuild jsx）、vitest、yaml ^2.x、schemastery/zod 仅沿用现状。

**Spec:** `docs/superpowers/plans/2026-08-17-capability-scored-routing.md`（v2.2 定稿）+ 审查归档 `docs/superpowers/reviews/2026-08-17-capability-routing-kimi-review-{round1,round2,round3}.md`

## Global Constraints

- `yaml` 固定 `^2.x`；sidecar 限 JSON-compatible YAML 子集（无 anchor/tag/自定义类型）。
- 零智能依赖：不引入嵌入/训练/学习式路由库。
- 每任务 TDD（先红后绿）+ 独立提交；提交信息 `feat/fix/test/docs: ...`。
- provider 无关；默认白名单动态 = `[实际 providerName, 'deepseek-official']`。
- sidecar 损坏/缺失永不崩：warn（含路径原因）→ patch 静态 → 默认；留 `.corrupt`/`.bak`。
- projection 带 `configSource: 'sidecar'|'patch'|'default'` 与决策摘要；仅 capability 非 keep 下发详细分。
- 面板文案中文+emoji，沿用 0.2.x 风格；组件拆分 CandidateList/ScoreEditor/ReasonPanel。
- 包根目录：`packages/dsh-kimi-tide`（下称 `<pkg>`）；测试跑法 `node node_modules/vitest/vitest.mjs run [file]`。

---

### Task 1（M4.1a）: RouterConfigV2 类型 + 默认值 + yaml 依赖

**Files:**
- Create: `<pkg>/src/config.ts`
- Modify: `<pkg>/package.json`（dependencies 加 `"yaml": "^2.4.0"`）
- Test: `<pkg>/test/config.test.ts`

**Interfaces:**
- Produces: `type Dim`, `interface RouteTarget`, `interface CandidateMeta`, `interface RouterConfigV2`, `DEFAULT_CONFIG_V2(providerName: string): RouterConfigV2`, `configKey(t: RouteTarget): string`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { configKey, DEFAULT_CONFIG_V2 } from '../src/config.js'

describe('RouterConfigV2 defaults', () => {
  it('dynamic whitelist contains the actual providerName plus deepseek-official', () => {
    const cfg = DEFAULT_CONFIG_V2('moonshot-code')
    expect(cfg.allowedProviders).toEqual(['moonshot-code', 'deepseek-official'])
    expect(cfg.version).toBe(2)
    expect(cfg.mode).toBe('off')
  })
  it('configKey joins provider and model', () => {
    expect(configKey({ provider: 'kimi-tide', model: 'k3' })).toBe('kimi-tide/k3')
  })
})
```

- [ ] **Step 2: 跑测试确认红**：`node node_modules/vitest/vitest.mjs run test/config.test.ts`，Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 config.ts**

```ts
export type Dim = 'code' | 'reasoning' | 'writing' | 'tooluse' | 'vision' | 'longctx'
export const DIMS: Dim[] = ['code', 'reasoning', 'writing', 'tooluse', 'vision', 'longctx']
export interface RouteTarget { provider: string; model: string }
export interface CandidateMeta extends RouteTarget {
  modalities: string[]
  costTier: 'cheap' | 'mid' | 'expensive'
  available: boolean
}
export interface RouterConfigV2 {
  version: 2
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
export function DEFAULT_CONFIG_V2(providerName: string): RouterConfigV2 {
  return {
    version: 2, mode: 'off',
    default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    candidates: [{ provider: providerName, model: 'kimi-for-coding' }],
    scores: {}, classify: {}, allowedProviders: [providerName, 'deepseek-official'],
    costTiers: {}, routeThreshold: 0.75, lambda: 0.5,
    premiumBudget: 0.2, budgetWindow: 20, charsPerToken: 2,
  }
}
```

- [ ] **Step 4: 跑测试确认绿**；`pnpm install`（或 npm i yaml@^2.4.0）落依赖。
- [ ] **Step 5: 提交** `feat: router config v2 types with dynamic provider whitelist`

---

### Task 2（M4.1a）: migrateRouterConfig v1→v2

**Files:** Create: `<pkg>/src/migrate.ts`；Test: `<pkg>/test/migrate.test.ts`
**Interfaces:** Consumes: Task 1 类型；Produces: `migrateV1(raw: unknown, warn: (m: string) => void): RouterConfigV2`

- [ ] **Step 1: 失败测试**

```ts
import { describe, expect, it, vi } from 'vitest'
import { migrateV1 } from '../src/migrate.js'

const V1 = {
  mode: 'cost',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
  premiumLong: { provider: 'kimi-tide', model: 'k3' },
  premiumBudget: 0.3,
}

describe('migrateV1', () => {
  it('maps primary→default, premium→candidates[0], drops premiumLong with one warn', () => {
    const warn = vi.fn()
    const out = migrateV1(V1, warn)
    expect(out.version).toBe(2)
    expect(out.default).toEqual(V1.primary)
    expect(out.candidates[0]).toEqual(V1.premium)
    expect(out.premiumBudget).toBe(0.3)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('premiumLong')
  })
  it('non-v1 input falls back to defaults without throwing', () => {
    expect(migrateV1({ nonsense: 1 }, () => {}).version).toBe(2)
    expect(migrateV1(null, () => {}).version).toBe(2)
  })
})
```

- [ ] **Step 2: 红** → **Step 3: 实现**

```ts
import { DEFAULT_CONFIG_V2, type RouterConfigV2, type RouteTarget } from './config.js'

function target(v: unknown): RouteTarget | null {
  const r = (v ?? {}) as Record<string, unknown>
  if (typeof r.provider !== 'string' || typeof r.model !== 'string') return null
  return { provider: r.provider, model: r.model }
}

export function migrateV1(raw: unknown, warn: (m: string) => void): RouterConfigV2 {
  const base = DEFAULT_CONFIG_V2('kimi-tide')
  const r = (raw ?? {}) as Record<string, unknown>
  const primary = target(r.primary)
  const premium = target(r.premium)
  if (primary === null && premium === null) return base
  if (r.premiumLong !== undefined) warn('dsh-kimi-tide: premiumLong 已废弃（0.3.0），迁移时丢弃')
  return {
    ...base,
    mode: r.mode === 'cost' || r.mode === 'capability' ? r.mode : 'off',
    default: primary ?? base.default,
    candidates: premium !== null ? [premium] : base.candidates,
    premiumBudget: typeof r.premiumBudget === 'number' ? r.premiumBudget : base.premiumBudget,
    budgetWindow: typeof r.budgetWindow === 'number' ? r.budgetWindow : base.budgetWindow,
    charsPerToken: typeof r.charsPerToken === 'number' ? r.charsPerToken : base.charsPerToken,
  }
}
```

- [ ] **Step 4: 绿** → **Step 5: 提交** `feat: v1→v2 router config migration with premiumLong drop warn`

---

### Task 3（M4.1a）: sidecar 存储（load/save + 损坏回退链）

**Files:** Create: `<pkg>/src/sidecar.ts`；Test: `<pkg>/test/sidecar.test.ts`
**Interfaces:** Consumes: Task 1/2；Produces: `class RouterSidecarStore { load(): { config: RouterConfigV2 | null; source: 'sidecar' | 'none' }; save(c): void; exportText(): string; importFile(path): RouterConfigV2 }`，构造 `{ file, patchFallback?: () => unknown, onError }`

- [ ] **Step 1: 失败测试**（临时目录；覆盖：save→load 往返、损坏→.corrupt+回退 patch、缺失→none）

```ts
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RouterSidecarStore } from '../src/sidecar.js'
import { DEFAULT_CONFIG_V2 } from '../src/config.js'

describe('RouterSidecarStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-sidecar-'))
  const file = join(dir, 'kimi-tide-router.yml')

  it('save→load round-trips and reports source sidecar', () => {
    const store = new RouterSidecarStore({ file, onError: () => {} })
    const cfg = { ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'capability' as const }
    store.save(cfg)
    const out = store.load()
    expect(out.source).toBe('sidecar')
    expect(out.config!.mode).toBe('capability')
    expect(out.config!.candidates[0].model).toBe('kimi-for-coding')
  })

  it('corrupt sidecar → .corrupt kept, warn fired, falls back to patch fallback', () => {
    writeFileSync(file, 'version: [unclosed', 'utf8')
    const errors: string[] = []
    const store = new RouterSidecarStore({
      file, onError: (m) => errors.push(m),
      patchFallback: () => ({ mode: 'cost', primary: { provider: 'p', model: 'm' }, premium: { provider: 'k', model: 'x' } }),
    })
    const out = store.load()
    expect(out.source).toBe('patch')
    expect(out.config!.default.provider).toBe('p')
    expect(errors.some((e) => e.includes('.corrupt'))).toBe(true)
  })

  it('missing file → source none', () => {
    const store = new RouterSidecarStore({ file: join(dir, 'nope.yml'), onError: () => {} })
    expect(store.load().source).toBe('none')
  })
})
```

- [ ] **Step 2: 红** → **Step 3: 实现**（yaml 整文件；save 先 .bak 再 tmp+rename；load 解析失败→rename .corrupt+warn+patchFallback→migrateV1 结果或 null）

```ts
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import YAML from 'yaml'
import { DEFAULT_CONFIG_V2, type RouterConfigV2 } from './config.js'
import { migrateV1 } from './migrate.js'

export interface SidecarOptions {
  file: string
  patchFallback?: () => unknown
  onError: (m: string) => void
}

export class RouterSidecarStore {
  constructor(private readonly o: SidecarOptions) {}

  load(): { config: RouterConfigV2 | null; source: 'sidecar' | 'patch' | 'none' } {
    if (!existsSync(this.o.file)) return { config: this.fallback(), source: this.o.patchFallback ? 'patch' : 'none' }
    try {
      const raw = YAML.parse(readFileSync(this.o.file, 'utf8')) as unknown
      return { config: this.validate(raw), source: 'sidecar' }
    } catch (error) {
      try { renameSync(this.o.file, this.o.file + '.corrupt') } catch { /* keep going */ }
      this.o.onError(`dsh-kimi-tide: sidecar 损坏，已保留 .corrupt 副本（${this.o.file}）：${(error as Error).message}；可用 /kimi-tide import-config 恢复`)
      const fb = this.fallback()
      return { config: fb, source: fb !== null ? 'patch' : 'none' }
    }
  }

  private fallback(): RouterConfigV2 | null {
    if (this.o.patchFallback === undefined) return null
    return migrateV1(this.o.patchFallback(), this.o.onError)
  }

  save(config: RouterConfigV2): void {
    if (existsSync(this.o.file)) copyFileSync(this.o.file, this.o.file + '.bak')
    const tmp = this.o.file + `.tmp-${process.pid}`
    writeFileSync(tmp, YAML.stringify(config), 'utf8')
    renameSync(tmp, this.o.file)
  }

  exportText(): string { return readFileSync(this.o.file, 'utf8') }
  importFile(path: string): RouterConfigV2 {
    const cfg = this.validate(YAML.parse(readFileSync(path, 'utf8')) as unknown)
    this.save(cfg)
    return cfg
  }

  private validate(raw: unknown): RouterConfigV2 {
    const r = (raw ?? {}) as Record<string, unknown>
    if (r.version === 2) return raw as RouterConfigV2
    return migrateV1(raw, this.o.onError)   // 旧形状 sidecar 也走迁移
  }
}
export { DEFAULT_CONFIG_V2 }
```

- [ ] **Step 4: 绿** → **Step 5: 提交** `feat: sidecar router store with corruption fallback chain`

---

### Task 4（M4.2）: 评分基线表 + 版本化合并

**Files:** Create: `<pkg>/src/scores.ts`；Test: `<pkg>/test/scores.test.ts`
**Interfaces:** Produces: `SCORES_VERSION`, `scoreFor(cfg, target): Record<Dim, number>`（用户覆盖 > 内置基线 > 0 中性）

- [ ] **Step 1: 失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { scoreFor, SCORES_VERSION } from '../src/scores.js'
import { DEFAULT_CONFIG_V2 } from '../src/config.js'

describe('scoreFor', () => {
  const t = { provider: 'kimi-tide', model: 'k3' }
  it('baseline ranks k3 code above v4-flash', () => {
    const cfg = DEFAULT_CONFIG_V2('kimi-tide')
    expect(scoreFor(cfg, t).code).toBeGreaterThan(
      scoreFor(cfg, { provider: 'deepseek-official', model: 'deepseek-v4-flash' }).code)
  })
  it('user override wins over baseline', () => {
    const cfg = { ...DEFAULT_CONFIG_V2('kimi-tide'), scores: { 'kimi-tide/k3': { code: 1 } } }
    expect(scoreFor(cfg, t).code).toBe(1)
    expect(scoreFor(cfg, t).reasoning).toBeGreaterThan(0)  // 未覆盖维度仍取基线
  })
  it('unknown candidate gets neutral 2.5 with vision 0', () => {
    expect(scoreFor(DEFAULT_CONFIG_V2('x'), { provider: 'ollama', model: 'q' }).vision).toBe(0)
  })
  it('exports a numeric SCORES_VERSION', () => { expect(typeof SCORES_VERSION).toBe('number') })
})
```

- [ ] **Step 2: 红** → **Step 3: 实现**（基线表 curated 相对分；未知候选中性 2.5、vision 0）

```ts
import { configKey, DIMS, type Dim, type RouteTarget, type RouterConfigV2 } from './config.js'
export const SCORES_VERSION = 1
const BASELINE: Record<string, Partial<Record<Dim, number>>> = {
  'kimi-tide/k3': { code: 4.5, reasoning: 4.5, writing: 4, tooluse: 4, longctx: 4 },
  'kimi-tide/kimi-for-coding': { code: 4, reasoning: 4, writing: 3.5, tooluse: 4, longctx: 3 },
  'deepseek-official/deepseek-v4-flash': { code: 3.5, reasoning: 3.5, writing: 3.5, tooluse: 3.5, longctx: 3 },
  'deepseek-official/deepseek-v4-pro': { code: 4.5, reasoning: 4.5, writing: 4, tooluse: 4, longctx: 3.5 },
}
export function scoreFor(cfg: RouterConfigV2, target: RouteTarget): Record<Dim, number> {
  const key = configKey(target)
  const base = BASELINE[key]
  const user = cfg.scores[key]
  const out = {} as Record<Dim, number>
  for (const dim of DIMS) {
    out[dim] = user?.[dim] ?? base?.[dim] ?? (dim === 'vision' ? 0 : 2.5)
  }
  return out
}
```

- [ ] **Step 4: 绿** → **Step 5: 提交** `feat: capability baseline scores with user override merge`

---

### Task 5（M4.2）: classify 纯函数

**Files:** Create: `<pkg>/src/classify.ts`；Test: `<pkg>/test/classify.test.ts`
**Interfaces:** Produces: `classify(messages, opts): { weights, vision, estTokens, explicit?: string }`，`explicitProvider(text): string | null`

- [ ] **Step 1: 失败测试**（code 族关键词、vision 块、@provider、token 估算、longctx）

```ts
import { describe, expect, it } from 'vitest'
import { classify, explicitProvider } from '../src/classify.js'
import type { UserMessage } from '@deepseek-ai/dsh-session'

const msg = (text: string, image = false): UserMessage => ({
  role: 'user',
  content: [{ type: 'text', text }, ...(image ? [{ type: 'image' }] : [])],
} as unknown as UserMessage)

describe('classify', () => {
  it('code keywords raise code+reasoning weights', () => {
    const r = classify([msg('帮我 review 这段代码，有个 bug')], { charsPerToken: 2 })
    expect(r.weights.code).toBeGreaterThanOrEqual(2)
  })
  it('image block sets vision and explicit provider wins', () => {
    const r = classify([msg('看图', true)], { charsPerToken: 2 })
    expect(r.vision).toBe(true)
    expect(explicitProvider('用 @ollama 回答')).toBe('ollama')
  })
  it('long context raises longctx', () => {
    const r = classify([msg('x'.repeat(200000))], { charsPerToken: 2 })
    expect(r.weights.longctx).toBeGreaterThanOrEqual(1)
    expect(r.estTokens).toBeGreaterThan(60000)
  })
})
```

- [ ] **Step 2: 红** → **Step 3: 实现**（关键词族表可被 cfg.classify.patterns 覆盖；vision=任一 user image 块；longctx 阈值 60000 estTokens）

```ts
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { Dim } from './config.js'

const DEFAULT_PATTERNS: Record<string, string[]> = {
  code: ['代码', 'code', 'bug', '重构', 'refactor', '实现', '函数', '测试'],
  reasoning: ['审查', 'review', '推理', '证明', '分析', '为什么', '审计'],
  writing: ['文档', '总结', '翻译', '写一', '文章', 'report'],
  tooluse: [],
}
export interface ClassifyResult {
  weights: Partial<Record<Dim, number>>
  vision: boolean
  estTokens: number
  explicit?: string
}
export function explicitProvider(text: string): string | null {
  const m = /@([\w-]{2,20})\b/.exec(text)
  if (m === null || m[1] === 'kimi') return m?.[1] === 'kimi' ? 'kimi-tide' : null
  return m[1]
}
export function classify(messages: readonly UserMessage[], opts: { charsPerToken: number; patterns?: Record<string, string[]> }): ClassifyResult {
  const patterns = { ...DEFAULT_PATTERNS, ...(opts.patterns ?? {}) }
  let text = '', chars = 0, vision = false
  for (const m of messages) {
    if (m.role !== 'user') continue
    for (const b of m.content as Array<{ type?: string; text?: unknown }>) {
      if (b.type === 'image') vision = true
      if (b.type === 'text' && typeof b.text === 'string') { text += b.text; chars += b.text.length }
    }
  }
  const estTokens = Math.ceil(chars / Math.max(1, opts.charsPerToken))
  const weights: Partial<Record<Dim, number>> = {}
  for (const [dim, keys] of Object.entries(patterns)) {
    if (keys.some((k) => text.toLowerCase().includes(k.toLowerCase()))) weights[dim as Dim] = (weights[dim as Dim] ?? 0) + 2
  }
  if (estTokens > 60000) weights.longctx = (weights.longctx ?? 0) + 1
  if (vision) weights.vision = 3
  return { weights, vision, estTokens, explicit: explicitProvider(text) ?? undefined }
}
```

- [ ] **Step 4: 绿** → **Step 5: 提交** `feat: heuristic task classifier (dims/vision/tokens/@provider)`

---

### Task 6（M4.2）: scoring + select（costNorm/预算/视觉否决/平局）

**Files:** Create: `<pkg>/src/scoring.ts`；Test: `<pkg>/test/scoring.test.ts`
**Interfaces:** Consumes: Task 1/4；Produces: `costTierFromPrice(per1M?: number)`, `scoreCandidate(meta, weights, lambda)`, `selectCandidate(metas, weights, opts): { target, reason, scoreDelta } | null`

- [ ] **Step 1: 失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { costTierFromPrice, scoreCandidate, selectCandidate } from '../src/scoring.js'
import type { CandidateMeta } from '../src/config.js'

const meta = (provider: string, model: string, over: Partial<CandidateMeta> = {}): CandidateMeta => ({
  provider, model, modalities: ['text'], costTier: 'mid', available: true, ...over,
})

describe('scoring', () => {
  it('price→tier mapping per 1M tokens', () => {
    expect(costTierFromPrice(0.3)).toBe('cheap')
    expect(costTierFromPrice(1)).toBe('mid')
    expect(costTierFromPrice(5)).toBe('expensive')
    expect(costTierFromPrice(undefined)).toBe('mid')
  })
  it('code-heavy weights pick the stronger code model despite cost', () => {
    const a = meta('deepseek-official', 'deepseek-v4-flash', { costTier: 'cheap' })
    const b = meta('kimi-tide', 'k3', { costTier: 'mid' })
    const scores = new Map([[a, { code: 3.5, reasoning: 3.5, writing: 3.5, tooluse: 3.5, vision: 0, longctx: 3 }],
      [b, { code: 4.5, reasoning: 4.5, writing: 4, tooluse: 4, vision: 0, longctx: 4 }]])
    const sel = selectCandidate([a, b], { code: 2, reasoning: 1 }, {
      lambda: 0.5, defaultTarget: a, mode: 'capability', hasImage: false, budgetExhausted: false, scoresOf: (m) => scores.get(m)!,
    })
    expect(sel!.target.model).toBe('k3')
  })
  it('vision=0 candidates are excluded for image steps', () => {
    const a = meta('kimi-tide', 'k3', { modalities: ['text', 'image'] })
    const b = meta('deepseek-official', 'deepseek-v4-flash', { modalities: ['text'] })
    const sel = selectCandidate([a, b], { vision: 3 }, {
      lambda: 0, defaultTarget: a, mode: 'capability', hasImage: true, budgetExhausted: false,
      scoresOf: () => ({ code: 4, reasoning: 4, writing: 4, tooluse: 4, vision: 0, longctx: 4 }),
    })
    expect(sel!.target.provider).toBe('kimi-tide')  // deepseek-v4-flash（vision=0）被排除；k3 多模态胜出
  })
  it('cost mode keeps default unless score delta beats threshold and budget allows', () => {
    const a = meta('deepseek-official', 'f', { costTier: 'cheap' })
    const b = meta('kimi-tide', 'k3')
    const opts = { lambda: 0.5, defaultTarget: a, mode: 'cost' as const, hasImage: false, budgetExhausted: true, routeThreshold: 10,
      scoresOf: () => ({ code: 4, reasoning: 4, writing: 4, tooluse: 4, vision: 0, longctx: 4 }) }
    expect(selectCandidate([a, b], { code: 2 }, opts)).toBeNull()  // 预算耗尽直接 keep
  })
})
```

- [ ] **Step 2: 红** → **Step 3: 实现**

```ts
import { configKey, type CandidateMeta, type Dim, type RouteTarget } from './config.js'

export type CostTier = 'cheap' | 'mid' | 'expensive'
const COST_VALUE: Record<CostTier, number> = { cheap: 0, mid: 0.5, expensive: 1 }
export function costTierFromPrice(per1M?: number): CostTier {
  if (per1M === undefined || !Number.isFinite(per1M)) return 'mid'
  if (per1M < 0.5) return 'cheap'
  if (per1M <= 2) return 'mid'
  return 'expensive'
}
export function scoreCandidate(meta: CandidateMeta, weights: Partial<Record<Dim, number>>, lambda: number,
  scoresOf: (m: CandidateMeta) => Record<Dim, number>): number {
  const scores = scoresOf(meta)
  let sum = 0
  for (const [dim, w] of Object.entries(weights)) sum += (w as number) * scores[dim as Dim]
  return sum - lambda * COST_VALUE[meta.costTier]
}
export interface SelectOptions {
  lambda: number; defaultTarget: RouteTarget; mode: 'off' | 'cost' | 'capability'
  hasImage: boolean; budgetExhausted: boolean; routeThreshold?: number
  scoresOf: (m: CandidateMeta) => Record<Dim, number>
}
export function selectCandidate(metas: CandidateMeta[], weights: Partial<Record<Dim, number>>,
  opts: SelectOptions): { target: RouteTarget; reason: string; scoreDelta: number } | null {
  const eligible = metas.filter((m) => m.available && (!opts.hasImage || m.modalities.includes('image')))
  if (eligible.length === 0) return null
  const scored = eligible.map((m) => ({ m, s: scoreCandidate(m, weights, opts.lambda, opts.scoresOf) }))
    .sort((x, y) => y.s - x.s)
  const best = scored[0]
  const def = scored.find((x) => x.m.provider === opts.defaultTarget.provider && x.m.model === opts.defaultTarget.model)
  const base = def?.s ?? scored[scored.length - 1].s
  const delta = best.s - base
  if (best.m.provider === opts.defaultTarget.provider && best.m.model === opts.defaultTarget.model) return null
  if (opts.mode === 'cost') {
    if (opts.budgetExhausted) return null
    if (delta < (opts.routeThreshold ?? 0.75)) return null
  }
  const dims = Object.keys(weights).join('+') || 'general'
  return { target: { provider: best.m.provider, model: best.m.model }, reason: `${opts.mode}:${dims}`, scoreDelta: Math.round(delta * 100) / 100 }
}
export { configKey }
```

- [ ] **Step 4: 绿** → **Step 5: 提交** `feat: capability scoring engine with cost tiers and vision veto`

---

### Task 7（M4.3）: KimiRouter v2 引擎替换 decide()

**Files:** Modify: `<pkg>/src/router.ts`（保留 latestUserText/estimate*/messagesContainImage/applyImageGuard 签名兼容；KimiRouter 构造改 `(config: RouterConfigV2, metas: CandidateMeta[], log)`，decide 用 classify+selectCandidate+预算历史；guardImage 用 metas modalities）；Test: `<pkg>/test/router.test.ts` 扩展
**Interfaces:** Consumes: Task 1/5/6；Produces: `KimiRouter.decide(messages, step): RouteDecision`、`applyTo`、`budgetUsage`

- [ ] **Step 1: 失败测试**（capability 选 k3 on code；cost 预算窗口耗尽 keep；带图改道有 vision 的候选；单候选退化 keep；@provider 强制）

```ts
import { describe, expect, it } from 'vitest'
import { KimiRouter } from '../src/router.js'
import { DEFAULT_CONFIG_V2, type CandidateMeta } from '../src/config.js'
import type { UserMessage } from '@deepseek-ai/dsh-session'

const msg = (text: string): UserMessage => ({ role: 'user', content: [{ type: 'text', text }] } as unknown as UserMessage)
// 模态元数据按 pi-ai 目录实读修正（2026-08-18，见 development-plan-router.md §1.1）：
// deepseek-v4-flash 文本-only、k3 多模态——早期版本此处为反向假设（deepseek 带图 / k3 纯文本），
// 与真实能力矩阵相反，0.3.0 实施时不得沿用。step 参数按 dsh-agent-loop 已验证契约取 1（每轮首个模型步）。
const metas: CandidateMeta[] = [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], costTier: 'cheap', available: true },
  { provider: 'kimi-tide', model: 'k3', modalities: ['text', 'image'], costTier: 'mid', available: true },
]

describe('KimiRouter v2', () => {
  it('capability routes code task to k3', () => {
    const r = new KimiRouter({ ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'capability' }, metas, { info: () => {} })
    expect(r.decide([msg('审查这段代码 review')], 1).kind).toBe('route')
  })
  it('image step lands on the multimodal candidate, never a vision=0 one', () => {
    const r = new KimiRouter({ ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'capability' }, metas, { info: () => {} })
    const d = r.decide([msg('看图 @kimi-tide')], 1)
    const target = d.kind === 'route' ? d.target : null
    expect(target?.model).toBe('k3')   // deepseek-v4-flash 文本-only（vision=0）被排除；k3 多模态承接
  })
  it('single eligible candidate degrades to keep', () => {
    const r = new KimiRouter({ ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'capability' }, metas.slice(0, 1), { info: () => {} })
    expect(r.decide([msg('审查代码')], 1).kind).toBe('keep')
  })
})
```

- [ ] **Step 2: 红** → **Step 3: 实现**（decide：classify → explicit? 找该 provider 最优候选 : selectCandidate；cost 预算历史沿用 0.2.x record/budgetUsage；applyTo 不变；guardImage 查 metas）
- [ ] **Step 4: 绿（含旧 router 测试按需更新签名）** → **Step 5: 提交** `feat: scoring-based router engine replaces rule decide()`

---

### Task 8（M4.1b+M4.3 装配）: index.ts 候选枚举 + sidecar 接线 + configSource + 决策摘要

**Files:** Modify: `<pkg>/src/index.ts`、`<pkg>/src/types.ts`、`<pkg>/src/projection.ts`；Test: `<pkg>/test/index-apply.test.ts` 扩展
**Interfaces:** Consumes: Task 1-7；Produces: projection v2（`configSource`、`decision`、`candidates` 摘要）、onSaved 写 sidecar

- [ ] **Step 1: 失败测试**（fake ctx：agents registry + llm.listProviders/listModels/resolveModel；apply 后 push 的快照含 configSource 与 candidates；save 命令后 sidecar 文件存在且第二次 push mode 更新——复用 57c7ef8 的 roster 回归）
- [ ] **Step 2: 红** → **Step 3: 实现要点**：
  - `defaultSidecarFile()` = join(dirname(defaultPatchFile()), 'kimi-tide-router.yml')
  - 枚举：`ctx.llm.listProviders()` 过滤白名单 → 每 provider `listModels` → `resolveModel` 取 inputModalities 缓存进 CandidateMeta；`ctx.on('llm/adapters-updated')` 重建缓存
  - 加载优先级：sidecar > patch 静态（patchFallback 用旧 RouterSettingsStore.load 的 router 块）> DEFAULT_CONFIG_V2(providerName)；configSource 随之
  - onSaved：sidecar.save + mountRouter(新 metas) + push
- [ ] **Step 4: 绿** → **Step 5: 提交** `feat: wire sidecar persistence + provider-agnostic candidate enumeration`

---

### Task 9（M4.1b）: commands v2（settable keys + export/import-config + @<provider> 文档）

**Files:** Modify: `<pkg>/src/commands.ts`；Test: `<pkg>/test/commands.test.ts` 扩展
- [ ] **Step 1: 失败测试**（`/kimi-tide export-config` 返回 YAML 文本；`import-config <tmp>` 读取并保存；`set lambda 0.3` 生效；未知键报错列出 v2 键表）
- [ ] **Step 2: 红** → **Step 3: 实现**（SETTABLE_KEYS v2：lambda/routeThreshold/premiumBudget/budgetWindow/charsPerToken/default.model；export/import 走 sidecar store）
- [ ] **Step 4: 绿** → **Step 5: 提交** `feat: v2 commands with export/import-config`

---

### Task 10（M4.4）: 面板 v3（组件拆分 + configSource + ReasonPanel）

**Files:** Create: `<pkg>/src/client/CandidateList.tsx`、`ScoreEditor.tsx`、`ReasonPanel.tsx`；Modify: `<pkg>/src/client/TideDock.tsx`、`<pkg>/src/client/index.ts`（样式）
- [ ] **Step 1: 组件 CandidateList**（候选行：provider/model 双下拉（选项来自 projection.models 全量）、default 单选、不可用标灰、增删行→命令占位用 set 表达）+ 快照测试（render-to-string 断言关键文案）
- [ ] **Step 2: ScoreEditor**（选中候选六维滑杆 0–5 步长 0.5，显示基线分 vs 覆盖分，回车提交 `set scores.<key>.<dim>`——若命令键表不含 scores，则经 import-config 文本往返：本任务以「滑杆改本地 draft + 一次性保存生成 sidecar 文本经 import」实现，保持命令面最小）
- [ ] **Step 3: ReasonPanel + 主行 chip**（显示 `configSource`、本步 `decision.reason/scoreDelta`、「实际路由：xxx（router 决策）」）
- [ ] **Step 4: client build 干净 + 全量测试绿** → **Step 5: 提交** `feat: panel v3 with candidate management and decision observability`

---

### Task 11（M4.5）: 集成验证 + 文档

**Files:** Create: `<pkg>/test/integration.test.ts`、`<pkg>/docs/router-v3.md`；Modify: `<pkg>/README.md`
- [ ] **Step 1: 集成用例**（临时 DSH_HOME：sidecar 生命周期 save/load/corrupt/import；双源优先级 sidecar>patch；modality 护栏端到端 decide；cost 预算窗口序列）
- [ ] **Step 2: 5 分钟手工清单写入 README**（重启 dsh web → 面板保存 → chip 显示实际路由 → 带图消息改道 → export/import 往返 → mode off 逃生）
- [ ] **Step 3: 全量测试 + 双端 build** → **Step 4: 提交** `test: integration suite + v3 docs and manual checklist`

---

## 自审（writing-plans self-review）

- **Spec 覆盖**：2.1 sidecar+迁移+guardrails→T1-3/T8；2.2 评分版本化→T4；2.3 分类器→T5；2.4 选路+cost 语义+显式选择（M4.3 首任务调研在 T7 实现前以注释占位记录结论）→T6-7；2.5 候选池→T8；2.6 面板→T10；2.7 可观测→T8/T10；M4.5→T11；import-config→T3/T9。
- **占位符扫描**：无 TBD；T7/T8 Step 3 为实现要点（引擎装配依赖前序纯函数，代码量在实现期按要点展开）。
- **类型一致性**：`RouterConfigV2/CandidateMeta/Dim/configKey`（T1）在 T2-8 一致；`classify/scoreCandidate/selectCandidate` 签名 T5/T6 定义、T7 消费一致。
