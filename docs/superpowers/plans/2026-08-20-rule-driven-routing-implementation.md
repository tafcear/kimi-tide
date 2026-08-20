# 0.5.0 规则驱动路由实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 kimi-tide 路由器从六维评分引擎换成「预设 + 规则」驱动（RouterConfigV4），含迁移链、全量候选池、设置卡片预设管理器重做与评分面整体退役。

**Architecture:** 换核不换壳——保留事件接线（agent/pre-step 槽位、agent/request 改道、图片锁存、image-admission bail、面板投影、配额/二态指示）与持久化管线（settings 命名空间 + sidecar + patch 链），只替换决策核心（scoring→rules）、配置形状（v3→v4）、设置 UI 与迁移。决策语义：显式 @指令 → 预设规则链（列表顺序首命中，目标不可用跳过）→ 未命中路由到预设默认模型（打底）。

**Tech Stack:** TypeScript ESM、vitest 4、schemastery（settings schema）、zod v3（投影 schema）、React 18（client）、yaml。

**Spec:** `docs/superpowers/specs/2026-08-20-rule-driven-routing-design.md`（本计划逐节对应该 spec；执行者须先读 spec §2 裁决表、§3 调研锚点、§4-6 配置/引擎/迁移、§11 退役清单）

## Global Constraints

- 包路径：`packages/dsh-kimi-tide/`（下文 `<pkg>` 指代）；所有测试命令在 `<pkg>` 下执行。
- TDD：每个任务先写失败测试（RED）再实现（GREEN）；提交粒度 = 任务。
- 全量门槛（每个任务完成后）：`npm test` 全绿 + `npm run typecheck` 0 错 + `npm run build` 通过。
- 配置 schema 单一真相源：所有默认值从 `DEFAULT_CONFIG_V4()` 派生，不另抄。
- 内置预设按**官方 catalog id** 书写（`kimi-coding/kimi-for-coding`，非 highspeed）；不可用目标由降级语义兜住（spec §5.3）。
- 文件名不承载版本号（长期偏好）：`docs/router-v3.md` → `docs/router.md`（T11 git mv + 全库引用更新）。
- 护栏/锁存/准入 bail 语义不变（spec §5.2），只改配置词汇（v1/v3 → v4）。
- 决策摘要上屏规则：`via: explicit | rule` 且 activePreset 非 null 才显示；`via: default`/keep/关闭不上屏（spec §9）。
- 决策原因文案（测试钉桩用词，逐字）：`规则「<条件名>」命中`、`预设「<name>」默认`、`显式 @<provider> 指令`、`router off`。

---

### Task 1: config v4 形状 + schemastery 未知键探测（待核实 1 落锤）

**Files:**
- Modify: `<pkg>/src/config.ts`（整体重写为 v4 + 保留 legacy v3 类型）
- Test: `<pkg>/test/config.test.ts`（重写）
- Test: `<pkg>/test/schema-probe.test.ts`（新建，探测后保留为行为钉桩）

**Interfaces:**
- Produces（后续全部任务依赖）:
  - `RuleCondition = { kind: 'image' } | { kind: 'keywords'; group: string }`
  - `RouterRule { id: string; when: RuleCondition; target: RouteTarget }`
  - `RouterPreset { name: string; default: RouteTarget; rules: RouterRule[] }`
  - `RouterConfigV4 { version: 4; activePreset: string | null; presets: Record<string, RouterPreset>; keywordGroups: Record<string, string[]> }`
  - `DEFAULT_CONFIG_V4(): RouterConfigV4`、`DEFAULT_KEYWORD_GROUPS: Record<string, string[]>`
  - 保留：`RouteTarget`、`configKey`、`KIMI_PROVIDER`、`RouterConfigV3`（@legacy 迁移输入专用）、`DEFAULT_CONFIG_V3()`（@legacy，migrateV1/V2 的 base）
  - **删除**：`Dim`、`DIMS`、`CandidateMeta.costTier` 字段（CandidateMeta = RouteTarget + modalities + available）

- [ ] **Step 1: 写 schemastery 未知键探测测试（RED→行为钉桩）**

```typescript
// test/schema-probe.test.ts
import { describe, expect, it } from 'vitest'
import Schema from 'schemastery'

describe('schemastery 未知键行为探测（spec 待核实 1）', () => {
  it('Schema.object 对 schema 外未知键：记录实际行为（剥离 or 拒绝）', () => {
    const s = Schema.object({ a: Schema.string() })
    // 两种可接受结果，实跑后把另一条删掉、保留实际行为并据此写 T5 兼容层：
    // A. 剥离：expect(s({ a: 'x', b: 1 } as never)).toEqual({ a: 'x' })
    // B. 拒绝：expect(() => s({ a: 'x', b: 1 } as never)).toThrow()
    expect(s({ a: 'x', b: 1 } as never)).toEqual({ a: 'x' })
  })
})
```

- [ ] **Step 2: 跑探测，落锤**

Run: `npx vitest run test/schema-probe.test.ts`
Expected: 若 PASS = 剥离语义（T5 只需把 version/mode/default 列入 schema，其余 v3 字段被自动剥离，migrateV3 只需要这三个字段）；若 FAIL（抛错）= 拒绝语义 → 把断言改为 `toThrow()` 钉桩，T5 必须把 v3 全部遗留字段列入 schema。**把结论写进本任务 commit message。**

- [ ] **Step 3: 写 config v4 测试（RED）**

```typescript
// test/config.test.ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_V4, DEFAULT_KEYWORD_GROUPS, configKey } from '../src/config.js'

describe('DEFAULT_CONFIG_V4', () => {
  it('version 4、默认关闭、内置两预设两关键词组', () => {
    const c = DEFAULT_CONFIG_V4()
    expect(c.version).toBe(4)
    expect(c.activePreset).toBeNull()
    expect(Object.keys(c.presets).sort()).toEqual(['capability', 'saving'])
    expect(Object.keys(c.keywordGroups).sort()).toEqual(['chitchat', 'code'])
  })
  it('省钱预设：flash 打底 + 带图→k3 + 代码→kimi-for-coding', () => {
    const p = DEFAULT_CONFIG_V4().presets.saving
    expect(p.name).toBe('省钱')
    expect(p.default).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(p.rules.map((r) => r.when)).toEqual([
      { kind: 'image' },
      { kind: 'keywords', group: 'code' },
    ])
    expect(p.rules[0].target).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(p.rules[1].target).toEqual({ provider: 'kimi-coding', model: 'kimi-for-coding' })
  })
  it('能力预设：k3 打底 + 闲聊→flash + 代码→kimi-for-coding', () => {
    const p = DEFAULT_CONFIG_V4().presets.capability
    expect(p.default).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(p.rules[0].when).toEqual({ kind: 'keywords', group: 'chitchat' })
    expect(p.rules[0].target).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(p.rules[1].when).toEqual({ kind: 'keywords', group: 'code' })
  })
  it('每次调用返回新对象（内置真相源不被意外共享改写）', () => {
    const a = DEFAULT_CONFIG_V4()
    a.presets.saving.rules.pop()
    expect(DEFAULT_CONFIG_V4().presets.saving.rules).toHaveLength(2)
  })
  it('configKey 不变', () => {
    expect(configKey({ provider: 'kimi-coding', model: 'k3' })).toBe('kimi-coding/k3')
  })
  it('关键词组内置词表（钉桩）', () => {
    expect(DEFAULT_KEYWORD_GROUPS.code).toEqual(['代码', 'code', 'bug', '重构', 'refactor', '实现', '函数', '测试'])
    expect(DEFAULT_KEYWORD_GROUPS.chitchat).toEqual(['你好', '谢谢', '怎么样', '随便', '聊聊', '翻译', '总结', '天气'])
  })
})
```

- [ ] **Step 4: 实现 config.ts v4（GREEN）**

```typescript
// src/config.ts（整体重写）
export interface RouteTarget { provider: string; model: string }
/** 候选元数据（0.5.0：costTier 随评分退役）。 */
export interface CandidateMeta extends RouteTarget {
  modalities: string[]
  available: boolean
}
/** 0.4.x：插件固定的 Kimi provider 路由（pi-ai catalog 原生名）。 */
export const KIMI_PROVIDER = 'kimi-coding'

export type RuleCondition =
  | { kind: 'image' }                    // 带图（本轮或历史含图，锁存后恒真）
  | { kind: 'keywords'; group: string }  // 命名关键词组命中（大小写不敏感子串）

export interface RouterRule {
  id: string
  when: RuleCondition
  target: RouteTarget
}

export interface RouterPreset {
  name: string
  default: RouteTarget
  rules: RouterRule[]   // 有序；首条命中生效
}

export interface RouterConfigV4 {
  version: 4
  /** null = 关闭（逃生舱）；否则为 presets 的键。 */
  activePreset: string | null
  presets: Record<string, RouterPreset>
  keywordGroups: Record<string, string[]>
}

export const configKey = (t: RouteTarget): string => `${t.provider}/${t.model}`

/** 内置关键词组（用户可增删改；内置预设引用 code/chitchat）。 */
export const DEFAULT_KEYWORD_GROUPS: Record<string, string[]> = {
  code: ['代码', 'code', 'bug', '重构', 'refactor', '实现', '函数', '测试'],
  chitchat: ['你好', '谢谢', '怎么样', '随便', '聊聊', '翻译', '总结', '天气'],
}

export function DEFAULT_CONFIG_V4(): RouterConfigV4 {
  return {
    version: 4,
    activePreset: null,
    presets: {
      saving: {
        name: '省钱',
        default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        rules: [
          { id: 'image-k3', when: { kind: 'image' }, target: { provider: KIMI_PROVIDER, model: 'k3' } },
          { id: 'code-kfc', when: { kind: 'keywords', group: 'code' }, target: { provider: KIMI_PROVIDER, model: 'kimi-for-coding' } },
        ],
      },
      capability: {
        name: '能力',
        default: { provider: KIMI_PROVIDER, model: 'k3' },
        rules: [
          { id: 'chitchat-flash', when: { kind: 'keywords', group: 'chitchat' }, target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
          { id: 'code-kfc', when: { kind: 'keywords', group: 'code' }, target: { provider: KIMI_PROVIDER, model: 'kimi-for-coding' } },
        ],
      },
    },
    keywordGroups: { ...DEFAULT_KEYWORD_GROUPS },
  }
}

/* ---- @legacy v3（0.4.x）形状：迁移输入专用（migrate.ts/settings-schema.ts），新代码禁止消费 ---- */
export type Dim = 'code' | 'reasoning' | 'writing' | 'tooluse' | 'vision' | 'longctx'
/** @legacy v3 维度表：仅 migrateV2 改名与 settings-schema 兼容层使用。 */
export const DIMS: Dim[] = ['code', 'reasoning', 'writing', 'tooluse', 'vision', 'longctx']
export interface RouterConfigV3 { /* 原样保留 0.4.x 定义（含 scores/classify/allowedProviders/costTiers/routeThreshold/lambda/premiumBudget/budgetWindow/charsPerToken） */ }
export function DEFAULT_CONFIG_V3(): RouterConfigV3 { /* 原样保留 */ }
```

（注：`RouterConfigV3`/`DEFAULT_CONFIG_V3` 从现状文件原样搬运并加 `@legacy` 注释；`Dim`/`DIMS` 同理保留——settings-schema 兼容层与 migrateV2 仍引用。）

- [ ] **Step 5: 跑测试**

Run: `npx vitest run test/config.test.ts test/schema-probe.test.ts`
Expected: PASS（config.test 全绿）

- [ ] **Step 6: Commit**

```bash
git add packages/dsh-kimi-tide/src/config.ts packages/dsh-kimi-tide/test/config.test.ts packages/dsh-kimi-tide/test/schema-probe.test.ts
git commit -m "feat(config): RouterConfigV4 预设+规则形状（内置省钱/能力预设与 code/chitchat 关键词组；v3 类型留作 legacy 迁移输入）——schemastery 未知键行为实测=<剥离|拒绝>（spec 待核实 1 落锤）"
```

---

### Task 2: 规则引擎 rules.ts（classify.ts 退役并入）

**Files:**
- Create: `<pkg>/src/rules.ts`
- Delete: `<pkg>/src/classify.ts`、`<pkg>/test/classify.test.ts`
- Test: `<pkg>/test/rules.test.ts`（新建）

**Interfaces:**
- Consumes: T1 的 `RouterConfigV4`/`RouterRule`/`RouterPreset`/`RouteTarget`/`KIMI_PROVIDER`
- Produces:
  - `explicitProvider(text: string): string | null`（`@kimi`/`@kimi-tide` → KIMI_PROVIDER，其余按字面）
  - `latestUserText(messages: readonly UserMessage[]): string`
  - `messagesContainImage(messages: readonly UserMessage[]): boolean`
  - `matchingRules(config: RouterConfigV4, text: string, hasImage: boolean): RouterRule[]`（按序全部命中，含目标不可用者；可用性过滤在 T3 路由层）
  - `ruleLabel(rule: RouterRule): string`（`带图` 或组名）

- [ ] **Step 1: 写 rules 测试（RED）**

```typescript
// test/rules.test.ts
import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { DEFAULT_CONFIG_V4 } from '../src/config.js'
import { explicitProvider, latestUserText, matchingRules, messagesContainImage, ruleLabel } from '../src/rules.js'

const textMsg = (text: string): UserMessage => ({ role: 'user', content: [{ type: 'text', text }] }) as unknown as UserMessage
const imageMsg = (): UserMessage => ({ role: 'user', content: [{ type: 'image', attachment: 'a1' }] }) as unknown as UserMessage

describe('explicitProvider', () => {
  it('@kimi / @kimi-tide → kimi-coding；@deepseek-official 按字面；无 @ → null', () => {
    expect(explicitProvider('@kimi 帮我看这段代码')).toBe('kimi-coding')
    expect(explicitProvider('@kimi-tide 来')).toBe('kimi-coding')
    expect(explicitProvider('@deepseek-official 你好')).toBe('deepseek-official')
    expect(explicitProvider('没有指令')).toBeNull()
  })
})

describe('matchingRules', () => {
  it('activePreset null → 空', () => {
    expect(matchingRules(DEFAULT_CONFIG_V4(), '代码', false)).toEqual([])
  })
  it('规则顺序首命中在前；未命中为空', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    expect(matchingRules(c, '帮我重构这个函数', false).map((r) => r.id)).toEqual(['code-kfc'])
    expect(matchingRules(c, '今天天气怎么样', false)).toEqual([])  // 省钱预设无闲聊规则
  })
  it('带图消息命中 image 规则（与文本无关）', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    expect(matchingRules(c, '', true).map((r) => r.id)).toEqual(['image-k3'])
  })
  it('带图+代码词同时满足时按列表顺序全部返回（首命中=image-k3）', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    expect(matchingRules(c, '看这个 bug 截图', true).map((r) => r.id)).toEqual(['image-k3', 'code-kfc'])
  })
  it('关键词大小写不敏感子串匹配', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'capability'
    expect(matchingRules(c, 'please REFACTOR this', false).map((r) => r.id)).toEqual(['code-kfc'])
  })
  it('引用不存在关键词组的规则不命中', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    delete c.keywordGroups.code
    expect(matchingRules(c, '重构函数', false)).toEqual([])
  })
  it('activePreset 指向不存在的预设 → 空', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'nope'
    expect(matchingRules(c, '代码', true)).toEqual([])
  })
})

describe('ruleLabel / 消息工具', () => {
  it('ruleLabel：image→带图；keywords→组名', () => {
    const c = DEFAULT_CONFIG_V4()
    expect(ruleLabel(c.presets.saving.rules[0])).toBe('带图')
    expect(ruleLabel(c.presets.saving.rules[1])).toBe('code')
  })
  it('latestUserText 取最后一条非空用户文本；messagesContainImage 识别图片块', () => {
    expect(latestUserText([textMsg('第一句'), textMsg('第二句')])).toBe('第二句')
    expect(latestUserText([])).toBe('')
    expect(messagesContainImage([textMsg('x'), imageMsg()])).toBe(true)
    expect(messagesContainImage([textMsg('x')])).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/rules.test.ts`
Expected: FAIL（`../src/rules.js` 不存在）

- [ ] **Step 3: 实现 rules.ts（GREEN）**

```typescript
// src/rules.ts
/**
 * kimi-tide 0.5.0 规则引擎（纯函数，无 ctx/agent 依赖）：
 * 显式 @指令提取、消息工具、预设规则匹配。决策组装（可用性过滤/打底/护栏）
 * 在 router.ts。匹配语义：规则列表顺序、首条命中生效（本函数按序返回全部
 * 命中，由路由层取第一个目标可用者）；关键词为大小写不敏感子串匹配。
 */
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { KIMI_PROVIDER, type RouterConfigV4, type RouterRule } from './config.js'

export function explicitProvider(text: string): string | null {
  const m = /@([\w-]{2,20})\b/.exec(text)
  if (m === null) return null
  if (m[1] === 'kimi' || m[1] === 'kimi-tide') return KIMI_PROVIDER
  return m[1]
}

/** 从消息批次提取最新一条用户文本。 */
export function latestUserText(messages: readonly UserMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue
    let out = ''
    for (const block of message.content) {
      const b = block as { type?: string; text?: unknown }
      if (b?.type === 'text' && typeof b.text === 'string') out += b.text
    }
    if (out.trim().length > 0) return out
  }
  return ''
}

/** True when any user message in the batch carries an image block. */
export function messagesContainImage(messages: readonly UserMessage[]): boolean {
  return messages.some(
    (m) => m.role === 'user' && m.content.some((b) => (b as { type?: string }).type === 'image'),
  )
}

/** 按预设规则顺序返回全部命中规则（含目标不可用者；可用性过滤在路由层）。 */
export function matchingRules(config: RouterConfigV4, text: string, hasImage: boolean): RouterRule[] {
  if (config.activePreset === null) return []
  const preset = config.presets[config.activePreset]
  if (preset === undefined) return []
  const lower = text.toLowerCase()
  const hits: RouterRule[] = []
  for (const rule of preset.rules) {
    if (rule.when.kind === 'image') {
      if (hasImage) hits.push(rule)
      continue
    }
    const words = config.keywordGroups[rule.when.group]
    if (words === undefined) continue
    if (words.some((k) => k.length > 0 && lower.includes(k.toLowerCase()))) hits.push(rule)
  }
  return hits
}

/** 决策摘要/UI 用的条件名：image→带图；keywords→组名。 */
export function ruleLabel(rule: RouterRule): string {
  return rule.when.kind === 'image' ? '带图' : rule.when.group
}
```

- [ ] **Step 4: 删除 classify.ts 与其测试，跑测试**

```bash
git rm packages/dsh-kimi-tide/src/classify.ts packages/dsh-kimi-tide/test/classify.test.ts
npx vitest run test/rules.test.ts
```
Expected: PASS。（此时全量测试会红——router.ts 等仍 import classify/scoring，属预期，T3 收口；本任务只要求 rules.test 绿 + 删除完成，全量绿在 T6 恢复。例外纪律：若 CI/评审要求每任务全量绿，则把 T2 的删除推迟到 T3 合并执行。）

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/rules.ts packages/dsh-kimi-tide/test/rules.test.ts
git commit -m "feat(rules): 0.5.0 规则引擎（matchingRules 按序全命中/ruleLabel/显式@与消息工具）；classify.ts 权重分类退役"
```

---

### Task 3: KimiRouter v4 换核（护栏/锁存/准入保留，词汇改 v4）

**Files:**
- Modify: `<pkg>/src/router.ts`（decide 换核 + RouteDecision via + 删预算/评分/v1 桥；护栏函数签名改 v4）
- Test: `<pkg>/test/router.test.ts`（重写）
- Test: `<pkg>/test/router-wiring.test.ts`（适配 v4 配置夹具）
- Test: `<pkg>/test/smoke.test.ts`（estimateTokens 退役适配）

**Interfaces:**
- Consumes: T1 `RouterConfigV4`/`CandidateMeta`（无 costTier）、T2 `matchingRules`/`ruleLabel`/`explicitProvider`/`latestUserText`/`messagesContainImage`
- Produces:
  - `RouteDecision = { kind: 'route'; target; reason; via: 'explicit'|'rule'|'default' } | { kind: 'keep'; reason }`（**scoreDelta 删除**）
  - `class KimiRouter`：构造 `new KimiRouter(config: RouterConfigV4, metas: CandidateMeta[], log: RouterLog)`（**v1 重载删除**）；`decide(messages, step, hasImageOverride?)`、`applyTo(config, decision)`、`guardImage(target, hasImage)`
  - `textOnlyProviders(metas): Set<string>`（签名简化：不再吃 config；metas 缺省时返回空集——护栏调用方总有 metas）
  - `applyImageGuard(target, hasImage, metas): { target, reason } | null`（签名简化）
  - `canClaimImageAdmission(config: RouterConfigV4, metas): boolean`（`activePreset !== null` 且池内有多模态可用候选）
  - `installRouter(ctx, router, onDecision?)`（不变）
  - re-export：`latestUserText`、`messagesContainImage`（来自 rules.js，保 smoke/外部 import 路径）
  - **删除**：`RouterConfigV1`/`RouterConfig`/`MatchRule`/`matchesPatterns`/`estimateTokens`/`estimateContextTokens`、预算史（budgetHistory/record/budgetUsage）、`legacyConfig` getter、`legacyConfigToV3`/`legacyMetasFromConfig`/`legacyWeights`

- [ ] **Step 1: 重写 router.test.ts（RED）——核心用例逐字钉桩**

```typescript
// test/router.test.ts（骨架；消息夹具同 T2）
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_V4, type CandidateMeta } from '../src/config.js'
import { KimiRouter } from '../src/router.js'

const log = { info: () => {} }
const METAS: CandidateMeta[] = [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], available: true },
  { provider: 'deepseek-official', model: 'deepseek-v4-pro', modalities: ['text'], available: true },
  { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available: true },
  { provider: 'kimi-coding', model: 'kimi-for-coding', modalities: ['text', 'image'], available: true },
]
const textMsg = (t: string) => ({ role: 'user', content: [{ type: 'text', text: t }] }) as never
const imageMsg = () => ({ role: 'user', content: [{ type: 'image', attachment: 'a' }] }) as never
const cfg = (active: string | null) => { const c = DEFAULT_CONFIG_V4(); c.activePreset = active; return c }

describe('KimiRouter v4 decide', () => {
  it('activePreset null → keep router off', () => {
    const r = new KimiRouter(cfg(null), METAS, log)
    expect(r.decide([textMsg('代码')], 1)).toEqual({ kind: 'keep', reason: 'router off' })
  })
  it('未命中规则 → via:default 路由到预设默认（打底语义）', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    expect(r.decide([textMsg('今天天气不错')], 1)).toEqual({
      kind: 'route', target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      reason: '预设「省钱」默认', via: 'default',
    })
  })
  it('规则命中 → via:rule，reason 含条件名', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    expect(r.decide([textMsg('帮我重构这个函数')], 1)).toEqual({
      kind: 'route', target: { provider: 'kimi-coding', model: 'kimi-for-coding' },
      reason: '规则「code」命中', via: 'rule',
    })
  })
  it('带图（消息含图）→ image 规则', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    const d = r.decide([imageMsg()], 1)
    expect(d).toMatchObject({ kind: 'route', target: { provider: 'kimi-coding', model: 'k3' }, via: 'rule' })
  })
  it('带图锁存：hasImageOverride=true 时纯文本轮也按带图处理', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    const d = r.decide([textMsg('继续')], 2, true)
    expect(d).toMatchObject({ kind: 'route', target: { provider: 'kimi-coding', model: 'k3' }, via: 'rule' })
  })
  it('规则目标不可用 → 跳过该规则落默认', () => {
    const metas = METAS.filter((m) => m.model !== 'kimi-for-coding')
    const r = new KimiRouter(cfg('saving'), metas, log)
    expect(r.decide([textMsg('重构函数')], 1)).toMatchObject({ via: 'default', target: { model: 'deepseek-v4-flash' } })
  })
  it('能力预设：闲聊→flash，其余→k3 打底', () => {
    const r = new KimiRouter(cfg('capability'), METAS, log)
    expect(r.decide([textMsg('你好呀')], 1)).toMatchObject({ via: 'rule', target: { model: 'deepseek-v4-flash' } })
    expect(r.decide([textMsg('推导这个式子')], 1)).toMatchObject({ via: 'default', target: { model: 'k3' } })
  })
  it('显式 @kimi 优先于规则与默认', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    const d = r.decide([textMsg('@kimi 随便聊聊')], 1)
    expect(d).toMatchObject({ kind: 'route', via: 'explicit', reason: '显式 @kimi-coding 指令' })
    expect((d as { target: { provider: string } }).target.provider).toBe('kimi-coding')
  })
  it('显式 @provider 无可用候选 → keep', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    expect(r.decide([textMsg('@anthropic 你好')], 1)).toMatchObject({ kind: 'keep' })
  })
  it('显式 @kimi 且带图：池限定多模态候选', () => {
    const metas: CandidateMeta[] = [
      { provider: 'kimi-coding', model: 'text-only-x', modalities: ['text'], available: true },
      { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available: true },
      ...METAS.filter((m) => m.provider !== 'kimi-coding'),
    ]
    const r = new KimiRouter(cfg('saving'), metas, log)
    const d = r.decide([textMsg('@kimi 看图')], 1, true)
    expect((d as { target: { model: string } }).target.model).toBe('k3')
  })
  it('activePreset 指向缺失预设 → keep + warn 日志', () => {
    const c = cfg('ghost')
    const infos: string[] = []
    const r = new KimiRouter(c, METAS, { info: (m) => infos.push(m) })
    expect(r.decide([textMsg('x')], 1)).toEqual({ kind: 'keep', reason: 'active preset not found' })
    expect(infos.some((m) => m.includes('ghost'))).toBe(true)
  })
})

describe('图像护栏（v4 词汇）', () => {
  it('带图且目标文本-only → 换首个多模态可用候选', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    const g = r.guardImage({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, true)
    expect(g?.target.provider).toBe('kimi-coding')
  })
  it('不带图 / 目标已多模态 / 池内无多模态 → null', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    expect(r.guardImage({ provider: 'kimi-coding', model: 'k3' }, true)).toBeNull()
    expect(r.guardImage({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, false)).toBeNull()
    const textOnly = METAS.map((m) => ({ ...m, modalities: ['text'] }))
    expect(new KimiRouter(cfg('saving'), textOnly, log).guardImage({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, true)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/router.test.ts`
Expected: FAIL（构造签名/字段不存在）

- [ ] **Step 3: 实现 router.ts 换核（GREEN）——decide 全量替换，关键段落逐字**

```typescript
// src/router.ts 顶部 import 改为：
import { KIMI_PROVIDER, type CandidateMeta, type RouteTarget, type RouterConfigV4 } from './config.js'
import { explicitProvider, latestUserText, matchingRules, messagesContainImage, ruleLabel } from './rules.js'
export { latestUserText, messagesContainImage } from './rules.js'
export type { RouteTarget }

export type RouteDecision =
  | { kind: 'route'; target: RouteTarget; reason: string; via: 'explicit' | 'rule' | 'default' }
  | { kind: 'keep'; reason: string }

export class KimiRouter {
  readonly config: RouterConfigV4
  readonly metas: CandidateMeta[]
  private readonly log: RouterLog
  constructor(config: RouterConfigV4, metas: CandidateMeta[], log: RouterLog) {
    this.config = config; this.metas = metas; this.log = log
  }

  decide(messages: readonly UserMessage[], step: number, hasImageOverride?: boolean): RouteDecision {
    if (this.config.activePreset === null) return { kind: 'keep', reason: 'router off' }
    const text = latestUserText(messages)
    const hasImage = hasImageOverride ?? messagesContainImage(messages)
    // 1. 显式 @指令（最高优先级）：只锁 provider 层，模型=该 provider 枚举序首个可用候选（带图限定多模态）。
    const explicit = explicitProvider(text)
    if (explicit !== null) {
      const pool = this.metas.filter(
        (m) => m.provider === explicit && m.available && (!hasImage || m.modalities.includes('image')),
      )
      if (pool.length === 0) return { kind: 'keep', reason: `explicit @${explicit}: no available candidate` }
      return { kind: 'route', target: { provider: pool[0].provider, model: pool[0].model }, reason: `显式 @${explicit} 指令`, via: 'explicit' }
    }
    // 2. 预设规则链（首条目标可用者生效；目标不可用 → 跳过该规则，降级）。
    const preset = this.config.presets[this.config.activePreset]
    if (preset === undefined) {
      this.log.info(`kimi-router: active preset '${this.config.activePreset}' not found, keeping current route`)
      return { kind: 'keep', reason: 'active preset not found' }
    }
    for (const rule of matchingRules(this.config, text, hasImage)) {
      const meta = this.metas.find((m) => m.provider === rule.target.provider && m.model === rule.target.model && m.available)
      if (meta === undefined) continue
      return { kind: 'route', target: { ...rule.target }, reason: `规则「${ruleLabel(rule)}」命中`, via: 'rule' }
    }
    // 3. 打底：未命中 ≠ keep——路由到预设默认模型（0.5.0 语义，spec §5.1）。
    return { kind: 'route', target: { ...preset.default }, reason: `预设「${preset.name}」默认`, via: 'default' }
  }
  // applyTo / guardImage / installRouter 见下
}
```

护栏改造（替换 v1 词汇，语义不变）：

```typescript
/** Providers that cannot accept image input, derived from candidate modalities. */
export function textOnlyProviders(metas: readonly CandidateMeta[]): Set<string> {
  const imageCapable = new Set(metas.filter((m) => m.modalities.includes('image')).map((m) => m.provider))
  return new Set([...new Set(metas.map((m) => m.provider))].filter((p) => !imageCapable.has(p)))
}

function imageCapablePicks(metas: readonly CandidateMeta[]): CandidateMeta[] {
  return metas.filter((m) => m.modalities.includes('image') && m.available)
}

export function applyImageGuard(
  target: RouteTarget,
  hasImage: boolean,
  metas: readonly CandidateMeta[],
): { target: RouteTarget; reason: string } | null {
  if (!hasImage) return null
  if (!textOnlyProviders(metas).has(target.provider)) return null
  const picks = imageCapablePicks(metas)
  if (picks.length === 0) return null
  return { target: { provider: picks[0].provider, model: picks[0].model }, reason: 'image input: rerouted to multimodal candidate' }
}

export function canClaimImageAdmission(config: RouterConfigV4, metas: readonly CandidateMeta[]): boolean {
  if (config.activePreset === null) return false
  return imageCapablePicks(metas).length > 0
}
```

`guardImage(target, hasImage)` 方法体 = `applyImageGuard(target, hasImage, this.metas)`；`installRouter` 保留现状（step===1 门控 / slots WeakMap / imageSeen 锁存 / admission bail），仅把 `canClaimImageAdmission(router.legacyConfig, ...)` 改 `canClaimImageAdmission(router.config, ...)`；删除文件头 v1 注释块与全部预算/v1 桥代码。`step` 参数保留（契约占位注释沿用）。

- [ ] **Step 4: 适配 router-wiring.test.ts 与 smoke.test.ts**

- router-wiring.test.ts：夹具 `new KimiRouter(v1Config, log)` → `new KimiRouter(v4Config, METAS, log)`（v4Config = DEFAULT_CONFIG_V4() + activePreset 按需）；step=1 门控/锁存/admission 断言语义不变，配置词汇改 v4。
- smoke.test.ts：`estimateTokens` 删除 → 改为 `latestUserText` + `messagesContainImage` 钉桩：

```typescript
import { latestUserText, messagesContainImage } from '../src/router.js'
describe('scaffold smoke', () => {
  it('router.ts compiles and re-exports message helpers', () => {
    expect(latestUserText([])).toBe('')
    expect(messagesContainImage([])).toBe(false)
  })
})
```

- [ ] **Step 5: 跑测试**

Run: `npx vitest run test/router.test.ts test/router-wiring.test.ts test/smoke.test.ts`
Expected: PASS（其余测试红属预期，T4-T6 收口）

- [ ] **Step 6: Commit**

```bash
git add packages/dsh-kimi-tide/src/router.ts packages/dsh-kimi-tide/test/router.test.ts packages/dsh-kimi-tide/test/router-wiring.test.ts packages/dsh-kimi-tide/test/smoke.test.ts
git commit -m "feat(router): KimiRouter v4 换核——显式@→规则链首命中(目标不可用跳过)→预设默认打底；预算/评分/v1 桥退役；护栏/锁存/准入语义不变改 v4 词汇"
```

---

### Task 4: 迁移链 v4（migrateV3 + sidecar/settings-migration 适配）

**Files:**
- Modify: `<pkg>/src/migrate.ts`（+migrateV3/+coerceRouterConfigV4/hasKimiTideResidue v4 化）
- Modify: `<pkg>/src/sidecar.ts`（validate/write-back v4 化）
- Modify: `<pkg>/src/settings-migration.ts`（类型改 v4，逻辑不变）
- Test: `<pkg>/test/migrate.test.ts`（+migrateV3/链式用例）
- Test: `<pkg>/test/sidecar.test.ts`、`<pkg>/test/settings-migration.test.ts`（适配）

**Interfaces:**
- Consumes: T1 v4/v3 类型
- Produces:
  - `migrateV3(raw: unknown): RouterConfigV4`（v4 直通；v3/v2 → 语义映射）
  - `coerceRouterConfigV4(raw: unknown, warn: (m: string) => void): RouterConfigV4`（v4 直通；否则 coerceRouterConfig → migrateV3）
  - `hasKimiTideResidue(config: unknown): boolean`（**v4 语义**：`version !== 4` 或序列化含 `'kimi-tide'`）
  - `RouterSidecarStore.load(): { config: RouterConfigV4 | null; source }`、`save(config: RouterConfigV4)`、`importFile(path): RouterConfigV4`

- [ ] **Step 1: 写迁移测试（RED）**

```typescript
// test/migrate.test.ts 追加 describe('migrateV3')
import { migrateV3, coerceRouterConfigV4, hasKimiTideResidue } from '../src/migrate.js'

describe('migrateV3', () => {
  it('mode off → activePreset null，预设保持内置', () => {
    const v4 = migrateV3({ version: 3, mode: 'off', default: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } })
    expect(v4.version).toBe(4)
    expect(v4.activePreset).toBeNull()
    expect(v4.presets.saving.default.model).toBe('deepseek-v4-flash')
  })
  it('mode cost → saving；default 与内置相同 → 不覆盖', () => {
    const v4 = migrateV3({ version: 3, mode: 'cost', default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    expect(v4.activePreset).toBe('saving')
    expect(v4.presets.saving.default.model).toBe('deepseek-v4-flash')
  })
  it('mode capability + 自定义 default → capability 且 default 写入该预设', () => {
    const v4 = migrateV3({ version: 3, mode: 'capability', default: { provider: 'kimi-coding', model: 'kimi-for-coding-highspeed' } })
    expect(v4.activePreset).toBe('capability')
    expect(v4.presets.capability.default).toEqual({ provider: 'kimi-coding', model: 'kimi-for-coding-highspeed' })
    expect(v4.presets.saving.default.model).toBe('deepseek-v4-flash')  // 另一预设不动
  })
  it('scores/candidates/classify/预算参数一律不迁移', () => {
    const v4 = migrateV3({ version: 3, mode: 'cost', default: { provider: 'a', model: 'b' }, scores: { 'a/b': { code: 5 } }, premiumBudget: 0.9 })
    expect(v4).not.toHaveProperty('scores')
    expect(v4).not.toHaveProperty('premiumBudget')
  })
  it('v4 直通（幂等）', () => {
    const c = DEFAULT_CONFIG_V4()
    expect(migrateV3(c)).toBe(c)
  })
  it('coerceRouterConfigV4：v2 链（kimi-tide 改名 → 语义映射）', () => {
    const v4 = coerceRouterConfigV4({ version: 2, mode: 'cost', default: { provider: 'kimi-tide', model: 'k3' }, candidates: [] }, () => {})
    expect(v4.activePreset).toBe('saving')
    expect(v4.presets.saving.default.provider).toBe('kimi-coding')
  })
  it('hasKimiTideResidue：version!==4 → true；v4 无残留 → false', () => {
    expect(hasKimiTideResidue({ version: 3 })).toBe(true)
    expect(hasKimiTideResidue(DEFAULT_CONFIG_V4())).toBe(false)
    const dirty = DEFAULT_CONFIG_V4(); dirty.presets.saving.name = 'kimi-tide 遗留'
    expect(hasKimiTideResidue(dirty)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/migrate.test.ts`
Expected: FAIL（migrateV3/coerceRouterConfigV4 未定义）

- [ ] **Step 3: 实现（GREEN）**

```typescript
// migrate.ts 追加（import 增 DEFAULT_CONFIG_V4/RouterConfigV4）
/** v3 → v4 语义映射（spec §6.1）：mode→预设选择；default 与内置不同则写入该预设；
 *  scores/candidates/classify/预算参数一律不迁移。v4 直通幂等。 */
export function migrateV3(raw: unknown): RouterConfigV4 {
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.version === 4) return raw as RouterConfigV4
  const v4 = DEFAULT_CONFIG_V4()
  const presetId = r.mode === 'cost' ? 'saving' : r.mode === 'capability' ? 'capability' : null
  if (presetId !== null) {
    v4.activePreset = presetId
    const d = target(r.default)
    if (d !== null) {
      const builtin = v4.presets[presetId]
      if (d.provider !== builtin.default.provider || d.model !== builtin.default.model) {
        v4.presets[presetId] = { ...builtin, default: d }
      }
    }
  }
  return v4
}

/** 版本分派到 v4：4 直通；其余走 v1/v2→v3 链后 migrateV3。 */
export function coerceRouterConfigV4(raw: unknown, warn: (m: string) => void): RouterConfigV4 {
  const v = (raw as { version?: unknown } | null)?.version
  if (v === 4) return raw as RouterConfigV4
  return migrateV3(coerceRouterConfig(raw, warn))
}
```

`hasKimiTideResidue` 改：`const v = ...; if (v !== 4) return true; return JSON.stringify(config).includes('kimi-tide')`。

sidecar.ts：类型 `RouterConfigV3` → `RouterConfigV4`；`validate()` 增 v4 分支（结构检查：`presets` 为对象且非数组、`activePreset` 为 string|null，不合格抛错走 .corrupt；合格直通），v2/v3 分支尾部改 `coerceRouterConfigV4`，v1 分支 `migrateV1(...)` 改 `coerceRouterConfigV4(...)`；load() 写回迁移条件 `version === 2` 改 `version !== 4`，留档名 `.pre-v3` 改 `.pre-v4`（注释同步：v2/v3→v4 写回）；`export { DEFAULT_CONFIG_V3 }` 改 `export { DEFAULT_CONFIG_V4 }`。

settings-migration.ts：`MigrationScope.get(): RouterConfigV4`、`replace` 不变；`mergeResolved` 返回类型改 v4（T5 落地后对齐——本任务先改类型引用，schema 实现属 T5；两任务接口以 `mergeResolved(entry: unknown): RouterConfigV4` 为准）。

- [ ] **Step 4: 适配 sidecar.test/settings-migration.test 并跑**

夹具 v3 配置 → v4（`DEFAULT_CONFIG_V4()` 改造）；「v2 写回 .pre-v3」用例改「v2/v3 写回 .pre-v4」。
Run: `npx vitest run test/migrate.test.ts test/sidecar.test.ts test/settings-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/migrate.ts packages/dsh-kimi-tide/src/sidecar.ts packages/dsh-kimi-tide/src/settings-migration.ts packages/dsh-kimi-tide/test/migrate.test.ts packages/dsh-kimi-tide/test/sidecar.test.ts packages/dsh-kimi-tide/test/settings-migration.test.ts
git commit -m "feat(migrate): v3→v4 语义映射链（mode→预设/default→预设默认，评分参数不迁移）；sidecar v4 校验+写回留档 .pre-v4"
```

---

### Task 5: settings-schema v4 兼容层

**Files:**
- Modify: `<pkg>/src/settings-schema.ts`
- Test: `<pkg>/test/settings-schema.test.ts`

**Interfaces:**
- Consumes: T1 v4 + Step 1 落锤的 schemastery 行为；T4 `RouterConfigV4`
- Produces: `routerConfigSchema`（接受 version 2/3/4 存量）、`validateRouterConfig(raw: RouterConfigV4): string | undefined`、`mergeResolved(entry: unknown): RouterConfigV4`

- [ ] **Step 1: 写测试（RED）**

```typescript
// test/settings-schema.test.ts（重写）
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_V4 } from '../src/config.js'
import { mergeResolved, routerConfigSchema, validateRouterConfig } from '../src/settings-schema.js'

describe('routerConfigSchema v4', () => {
  it('v4 默认往返相等（单一真相源）', () => {
    expect(routerConfigSchema(DEFAULT_CONFIG_V4() as never)).toEqual(DEFAULT_CONFIG_V4())
  })
  it('存量 v3 节可过 schema（注册不被拒绝）', () => {
    const v3 = { version: 3, mode: 'capability', default: { provider: 'kimi-coding', model: 'k3' }, candidates: [], scores: {}, classify: {}, allowedProviders: [], costTiers: {}, routeThreshold: 0.75, lambda: 0.5, premiumBudget: 0.2, budgetWindow: 20, charsPerToken: 2 }
    const parsed = routerConfigSchema(v3 as never) as { version: number; mode?: string; default?: { model: string } }
    expect(parsed.version).toBe(3)
    expect(parsed.mode).toBe('capability')          // migrateV3 需要 mode+default 存活
    expect(parsed.default?.model).toBe('k3')
  })
  it('存量 v2 节可过 schema', () => {
    expect((routerConfigSchema({ version: 2, mode: 'cost', default: { provider: 'kimi-tide', model: 'k3' } } as never) as { version: number }).version).toBe(2)
  })
})

describe('validateRouterConfig v4', () => {
  it('合法默认配置通过', () => {
    expect(validateRouterConfig(DEFAULT_CONFIG_V4())).toBeUndefined()
  })
  it('activePreset 不存在于 presets → 拒绝', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'ghost'
    expect(validateRouterConfig(c)).toContain('ghost')
  })
  it('规则引用缺失关键词组 → 拒绝并指出组名', () => {
    const c = DEFAULT_CONFIG_V4(); delete c.keywordGroups.code
    expect(validateRouterConfig(c)).toContain('code')
  })
  it('规则 target 缺 model → 拒绝', () => {
    const c = DEFAULT_CONFIG_V4(); c.presets.saving.rules[0].target.model = ''
    expect(validateRouterConfig(c)).toContain('image-k3')
  })
  it('legacy version（≠4）直通不校验（迁移兜底）', () => {
    expect(validateRouterConfig({ version: 3 } as never)).toBeUndefined()
  })
  it('mergeResolved：空 entry → v4 默认；部分覆盖深合并', () => {
    expect(mergeResolved(undefined)).toEqual(DEFAULT_CONFIG_V4())
    const merged = mergeResolved({ activePreset: 'saving' })
    expect(merged.activePreset).toBe('saving')
    expect(merged.presets.capability.rules).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/settings-schema.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现（GREEN）**

schema 结构（v4 字段 + version union；v3 遗留字段按 T1 探测结论处理——剥离语义则只列 `mode`/`default` 两个 v3 字段保 migrateV3 输入，拒绝语义则列全量遗留字段并加注释「仅为存量注册兼容」）：

```typescript
const D4 = DEFAULT_CONFIG_V4()
const targetSchema = Schema.object({ provider: Schema.string(), model: Schema.string() })
const ruleSchema = Schema.object({
  id: Schema.string(),
  when: Schema.union([
    Schema.object({ kind: Schema.const('image') }),
    Schema.object({ kind: Schema.const('keywords'), group: Schema.string() }),
  ]),
  target: targetSchema,
})
const presetSchema = Schema.object({
  name: Schema.string(),
  default: targetSchema,
  rules: Schema.array(ruleSchema),
})
export const routerConfigSchema = Schema.object({
  version: Schema.union([Schema.const(2), Schema.const(3), Schema.const(4)]).default(4),
  activePreset: Schema.union([Schema.string(), Schema.const(null)]).default(D4.activePreset),
  presets: Schema.dict(presetSchema).default(D4.presets),
  keywordGroups: Schema.dict(Schema.array(Schema.string())).default(D4.keywordGroups),
  // v3 存量兼容（注册期不被拒；迁移后整段 replace 覆盖）：
  mode: Schema.union([Schema.const('off'), Schema.const('cost'), Schema.const('capability')]).default('off'),
  default: targetSchema.default({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
  // …（T1 探测为「拒绝」时补齐 scores/classify/candidates/allowedProviders/costTiers/routeThreshold/lambda/premiumBudget/budgetWindow/charsPerToken 各带默认）
})
```

validate/mergeResolved 按上面测试语义实现（mergeResolved 沿用 deepMerge + schema 两段式，返回类型改 v4）。

- [ ] **Step 4: 跑测试**

Run: `npx vitest run test/settings-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/settings-schema.ts packages/dsh-kimi-tide/test/settings-schema.test.ts
git commit -m "feat(settings-schema): v4 兼容层（version 2/3/4 存量可注册；validate 按 v4 语义校验预设/规则/组引用）"
```

---

### Task 6: index.ts 接线 v4（全量枚举 / mount 门控 / 决策摘要 / 投影）

**Files:**
- Modify: `<pkg>/src/index.ts`
- Test: `<pkg>/test/index-wiring.test.ts`、`<pkg>/test/index-apply.test.ts`（适配 v4）
- Test: `<pkg>/test/integration.test.ts`（适配 v4）

**Interfaces:**
- Consumes: T1-T5 全部
- Produces（T7/T9 依赖的投影形状）:
  - `buildDecisionSummary(decision: RouteDecision): DecisionSummary | null`（删 mode 参数；`via !== 'default'` 且 kind route 才返回 `{ chosen, reason(≤120) }`）
  - 投影 `router` 视图：`{ activePreset, presetName, defaultTarget, ruleCount }`（T7 types 落地 `RouterPanelView`）
  - `enumerateCandidates` 全量化（无白名单）、`fallbackCandidateMetas(config: RouterConfigV4)`

- [ ] **Step 1: 适配测试（RED）——按以下映射机械更新三个测试文件的夹具与断言**

- 配置夹具：v3 `{mode:'capability', default, candidates, scores...}` → `DEFAULT_CONFIG_V4()` + `activePreset` 按需 + 必要时改 `presets.<id>.default/rules`。
- mount 断言：`mode !== 'off'` → `activePreset !== null`。
- 决策摘要断言：capability route → 现 `via:'rule'|'explicit'` 上屏；`via:'default'` 不上屏（新增钉桩）；`scoreDelta` 断言删除。
- 枚举断言：白名单外 provider 被跳过 → 现全量入池（改断言：非枚举失败即入池）。
- `routerConfigToV3`/`candidateMetasFromConfig`/`buildRouter`/`v3ToV1View` 的 import/用例删除。
- integration.test.ts：显式@/规则命中/打底/护栏 端到端断言改 v4 配置与 via 语义（保留原有场景：双源优先级、锁存、护栏兜底）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/index-wiring.test.ts test/index-apply.test.ts test/integration.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 index.ts 改造（GREEN）**

- 删：`routerConfigToV3`、`candidateMetasFromConfig`、`buildRouter`、`v3ToV1View`、`DEFAULT_ROUTER_CONFIG`（确认无外部引用后删；index-wiring 有引用则同步删用例）。
- `enumerateCandidates`：删 `allowed` 集合与过滤两行；`costTier` 字段删除（CandidateMeta 已无）；「configured targets 补登记」循环的目标集 = 所有预设的 default + 所有规则 target（去重）：

```typescript
const configuredTargets = (): RouteTarget[] => {
  const out: RouteTarget[] = []; const seen = new Set<string>()
  for (const preset of Object.values(routerConfigV4.presets)) {
    for (const t of [preset.default, ...preset.rules.map((r) => r.target)]) {
      const key = configKey(t)
      if (seen.has(key)) continue
      seen.add(key); out.push(t)
    }
  }
  return out
}
```

- `fallbackCandidateMetas(config: RouterConfigV4)`：同上目标集，`modalities: ['text'], available: true`。
- `mountRouter`：`if (routerConfigV4.activePreset !== null)`。
- `buildDecisionSummary`：

```typescript
export function buildDecisionSummary(decision: RouteDecision): DecisionSummary | null {
  if (decision.kind !== 'route' || decision.via === 'default') return null
  return { chosen: { provider: decision.target.provider, model: decision.target.model }, reason: decision.reason.slice(0, 120) }
}
```

- `onDecision` 去掉 mode 传参；`applyConfig(next: RouterConfigV4)` 逻辑不变（sameJson 幂等）。
- settings attach 迁移段：`hasKimiTideResidue(current)` → `coerceRouterConfigV4(current, warn)`；留档名 `.pre-v3` → `.pre-v4`；日志文案「已迁移至 v3」→「已迁移至 v4（预设+规则）」。
- `settingsBase`：`seedRaw === null → DEFAULT_CONFIG_V4()`；否则 `coerceRouterConfigV4(seedRaw, warn)`（patch 静态 v1 经 v1→v3→v4 链）。
- `panelSnapshot`：`router: { activePreset, presetName, defaultTarget, ruleCount }`（按 T7 `RouterPanelView`）；candidates 摘要删 scores 字段。
- `Config` 接口注释更新（seed 仍为 v1 词汇，经迁移链进 v4）。

- [ ] **Step 4: 跑测试 + 全量**

Run: `npx vitest run test/index-wiring.test.ts test/index-apply.test.ts test/integration.test.ts`，随后 `npm test`
Expected: PASS；全量红应只剩 client 侧（SettingsCard/panel-v3/types/projection/commands/card-store 相关），T7-T10 收口

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/index.ts packages/dsh-kimi-tide/test/index-wiring.test.ts packages/dsh-kimi-tide/test/index-apply.test.ts packages/dsh-kimi-tide/test/integration.test.ts
git commit -m "feat(index): 0.5.0 接线——全量候选枚举去白名单、activePreset 门控、via 语义决策摘要、v4 投影视图与迁移留档 .pre-v4"
```

---

### Task 7: types + projection + commands v4

**Files:**
- Modify: `<pkg>/src/types.ts`、`<pkg>/src/projection.ts`、`<pkg>/src/commands.ts`
- Test: `<pkg>/test/types.test.ts`、`<pkg>/test/projection.test.ts`、`<pkg>/test/commands.test.ts`

**Interfaces:**
- Produces:
  - `RouterPanelView { activePreset: string | null; presetName: string | null; defaultTarget: RouteTarget | null; ruleCount: number }`
  - `CandidateSummary { provider; model; available }`（scores 删）、`DecisionSummary { chosen; reason }`（scoreDelta 删）
  - `KimiTidePanelProjection.router: RouterPanelView`
  - 命令：`/kimi-tide preset <id|off>`、`/kimi-tide show`、`/kimi-tide set activePreset <id|off>`、`export-config`/`import-config`（v4）、`refresh`、`help`

- [ ] **Step 1: 写/改测试（RED）**

types.test.ts：parseQuotaSnapshot 用例不动；删 scores/scoreDelta 相关断言（若有）。
projection.test.ts：zod schema 断言更新——candidates 无 scores、decision 无 scoreDelta、`stateVersion` 4（钉桩）：

```typescript
it('panel schema v4：candidates 无 scores、decision 无 scoreDelta、stateVersion 4', () => {
  expect(kimiTideProjectionDefinition.stateVersion).toBe(4)
  const payload = { /* 合法 v4 投影全字段 */ }
  // parse 通过 + 带 scores/scoreDelta 的旧负载被拒（schema 严格段）或透传（passthrough 段）按实现断言
})
```

commands.test.ts（关键新用例）：

```typescript
it('/kimi-tide preset saving → activePreset=saving 持久化', async () => {
  const saved: RouterConfigV4[] = []
  const deps = makeDeps(v4cfg(null), (c) => saved.push(c))   // 测试夹具工厂按现状文件调整
  const out = await applyKimiTideCommand(parseKimiTideCommand('preset saving'), deps)
  expect(saved[0].activePreset).toBe('saving')
  expect(out).toContain('saving')
})
it('/kimi-tide preset off → activePreset=null', async () => { /* … */ })
it('/kimi-tide preset ghost → error 且不落盘', async () => {
  const out = await applyKimiTideCommand(parseKimiTideCommand('preset ghost'), deps)
  expect(out).toContain('不存在')
})
it('/kimi-tide show → 输出当前预设/默认/规则数', async () => {
  const out = await applyKimiTideCommand(parseKimiTideCommand('show'), depsWithSaving)
  expect(out).toContain('省钱').toContain('deepseek-v4-flash').toContain('2')
})
it('/kimi-tide mode … 子命令已退役 → error 提示 preset', async () => {
  expect(await applyKimiTideCommand(parseKimiTideCommand('mode cost'), deps)).toContain('preset')
})
it('import-config 内联 YAML 合并 version 置 4；文件形态走 v4 结构校验', async () => { /* 沿用现双形态用例改 v4 断言 */ })
```

- [ ] **Step 2: 跑测试确认失败** → Expected: FAIL

- [ ] **Step 3: 实现（GREEN）**

types.ts：`Dim`/`RouterConfig` import 删除；`CandidateSummary.scores` 删；`DecisionSummary.scoreDelta` 删；新增 `RouterPanelView`；`KimiTidePanelProjection.router: RouterPanelView`；`models` 字段保留（T9 卡片下拉仍可用，但主要数据源改 card-store catalog——保留不删，零成本）。
projection.ts：candidates 对象删 `scores` 行；decision 删 `scoreDelta` 行；`stateVersion: 3 → 4`；router 保持 `z.record(z.string(), z.unknown())` 透传。
commands.ts：
- `KimiTideCommand`：`mode` 换 `{ kind: 'preset'; preset: string | null }`；增 `{ kind: 'show' }`；parse：`preset <id|off>`（`off`→null）；`mode` 子命令返回 error「已退役，请用 /kimi-tide preset」。
- `SETTABLE_KEYS` → `{ activePreset: 'string' }`（set activePreset 时 'off'→null；其余值须存在于 presets，否则 error 不落盘）。
- preset/show 实现：

```typescript
case 'preset': {
  if (cmd.preset !== null && deps.current().presets[cmd.preset] === undefined) {
    return `kimi-tide: 预设 '${cmd.preset}' 不存在（现有：${Object.keys(deps.current().presets).join(', ') || '无'}）`
  }
  return persist({ ...deps.current(), activePreset: cmd.preset }, deps, `preset → ${cmd.preset ?? 'off'}`)
}
case 'show': {
  const c = deps.current()
  if (c.activePreset === null) return 'kimi-tide: 路由关闭（/kimi-tide preset <id> 启用）'
  const p = c.presets[c.activePreset]
  return p === undefined
    ? `kimi-tide: activePreset '${c.activePreset}' 缺失（配置异常）`
    : `kimi-tide: 预设「${p.name}」· 默认 ${p.default.provider}/${p.default.model} · 规则 ${p.rules.length} 条 · 关键词组 ${Object.keys(c.keywordGroups).length} 个`
}
```

- import-config：`mergeInlineText` 的 `merged.version = 3` 改 `= 4`；`parseImportedFile` 增 v4 分支（结构检查 presets/activePreset 后直通）并把旧分支尾部分派到 `coerceRouterConfigV4`；HELP_TEXT/input hint 更新。

- [ ] **Step 4: 跑测试** → `npx vitest run test/types.test.ts test/projection.test.ts test/commands.test.ts` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/types.ts packages/dsh-kimi-tide/src/projection.ts packages/dsh-kimi-tide/src/commands.ts packages/dsh-kimi-tide/test/types.test.ts packages/dsh-kimi-tide/test/projection.test.ts packages/dsh-kimi-tide/test/commands.test.ts
git commit -m "feat(types,projection,commands): v4 投影（去 scores/scoreDelta、RouterPanelView、stateVersion 4）+ 命令族 preset/show 化"
```

---

### Task 8: card-store v4（预设/规则/组写方法 + 全量目录）

**Files:**
- Modify: `<pkg>/src/client/card-store.ts`
- Test: `<pkg>/test/card-store.test.ts`（新建——store 层独立钉桩，UI 测试在 T9）

**Interfaces:**
- Consumes: T1 v4、T7 类型
- Produces（T9 依赖）:
  - `CardSnapshot` 增 `catalog: Array<{ provider: string; models: string[] }> | null`（全量模型目录，下拉数据源）；`config/base/user` 类型改 `RouterConfigV4`
  - `CardStore` 新方法（全部经既有 saveTop 整段写）：
    - `saveActivePreset(id: string | null): Promise<void>`
    - `savePreset(presetId: string, preset: RouterPreset): Promise<void>`（整体覆盖该预设）
    - `renamePresetId(oldId, newId)` 不做——新建/复制/删除替代：
    - `createPreset(id: string, preset: RouterPreset): Promise<void>`（id 冲突 → error 通道）
    - `deletePreset(id: string): Promise<void>`（删激活预设时同写 `activePreset: null`）
    - `saveKeywordGroups(groups: Record<string, string[]>): Promise<void>`

- [ ] **Step 1: 写 card-store 测试（RED）**

```typescript
// test/card-store.test.ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_V4 } from '../src/config.js'
import { createCardStore, type SettingsScopeLike } from '../src/client/card-store.js'

const makeScope = (initial: unknown): SettingsScopeLike & { writes: Array<[string, unknown]> } => {
  let value = initial
  const writes: Array<[string, unknown]> = []
  const listeners = new Set<() => void>()
  return {
    writes,
    getSnapshot: () => ({ status: 'ready', value, base: value, user: {}, writable: true }),
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) },
    set: async (f, v) => { writes.push([f, v]); value = { ...(value as object), [f]: v }; for (const l of listeners) l() },
    unset: async (f) => { writes.push([f, undefined]); const { [f]: _, ...rest } = value as Record<string, unknown>; value = rest; for (const l of listeners) l() },
  }
}

describe('card-store v4', () => {
  it('saveActivePreset 写 activePreset（null=关闭）', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V4())
    const store = createCardStore(scope, null)
    await store.saveActivePreset('saving')
    expect(scope.writes).toEqual([['activePreset', 'saving']])
    await store.saveActivePreset(null)
    expect(scope.writes[1]).toEqual(['activePreset', null])
  })
  it('savePreset 整段覆盖单个预设（rules 数组整体替换）', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V4())
    const store = createCardStore(scope, null)
    const edited = { ...DEFAULT_CONFIG_V4().presets.saving, rules: [] }
    await store.savePreset('saving', edited)
    const [field, value] = scope.writes[0]
    expect(field).toBe('presets')
    expect((value as Record<string, { rules: unknown[] }>).saving.rules).toEqual([])
    expect((value as Record<string, { name: string }>).capability.name).toBe('能力')  // 其他预设不动
  })
  it('deletePreset 删除激活预设时同写 activePreset null（一次写入两个字段）', async () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    const scope = makeScope(c)
    const store = createCardStore(scope, null)
    await store.deletePreset('saving')
    const presetWrite = scope.writes.find(([f]) => f === 'presets')
    const activeWrite = scope.writes.find(([f]) => f === 'activePreset')
    expect(presetWrite).toBeDefined()
    expect((presetWrite![1] as Record<string, unknown>).saving).toBeUndefined()
    expect(activeWrite).toEqual(['activePreset', null])
  })
  it('createPreset id 冲突 → error 通道，不写', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V4())
    const store = createCardStore(scope, null)
    await store.createPreset('saving', DEFAULT_CONFIG_V4().presets.saving)
    expect(scope.writes).toEqual([])
    expect(store.getSnapshot().error).toContain('saving')
  })
  it('catalog：connection.llm.models 全量目录入快照；availability=目录命中', async () => {
    const connection = { api: {
      settings: { describe: async () => ({ result: { ok: true as const, value: { writable: true, namespaces: [{ ns: 'kimi-tide-router', value: DEFAULT_CONFIG_V4(), revision: 1 }] } } }), mutate: async () => ({}) },
      llm: { models: async () => ({ result: { ok: true as const, value: { groups: [
        { id: 'kimi-coding', models: [{ id: 'k3' }, { id: 'kimi-for-coding-highspeed' }] },
        { id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] },
      ] } } }) },
    } }
    const store = createCardStore(null, connection as never)
    await store.load()
    const snap = store.getSnapshot()
    expect(snap.catalog?.find((g) => g.provider === 'kimi-coding')?.models).toContain('k3')
    expect(snap.availability?.['kimi-coding/k3']).toBe(true)
    expect(snap.availability?.['kimi-coding/kimi-for-coding']).toBe(false)  // 未挂载 → 标灰
  })
})
```

- [ ] **Step 2: 跑测试确认失败** → Expected: FAIL

- [ ] **Step 3: 实现（GREEN）**

要点：`saveTop` 原样复用（scope.set/mutate set 单段 path 整值）；新方法全部组装「下一个完整 presets/keywordGroups 对象」后调 `saveTop('presets', next)`；`loadAvailability` 重写为：拉 `llm.models` → 填 `catalog`（全量）+ `availability`（目标集=所有预设 default+规则 target 去重；`served.has(key)`，无白名单）；删 `saveScores`；类型全改 v4。

- [ ] **Step 4: 跑测试** → `npx vitest run test/card-store.test.ts` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/client/card-store.ts packages/dsh-kimi-tide/test/card-store.test.ts
git commit -m "feat(card-store): v4 数据面——预设/规则/组整段写方法、全量模型目录 catalog、无白名单可用性"
```

---

### Task 9: SettingsCard 预设管理器重做

**Files:**
- Modify: `<pkg>/src/client/SettingsCard.tsx`（整体重写）
- Modify: `<pkg>/src/client/index.ts`（styles：删评分区样式，增规则表/预设行样式）
- Test: `<pkg>/test/SettingsCard.test.tsx`（重写）
- Test: `<pkg>/test/SettingsCard.dom.test.tsx`（适配——hooks 顺序回归钉必须保留）

**Interfaces:**
- Consumes: T8 CardStore 全部方法 + snapshot.catalog/availability
- Produces: 预设管理器 UI（spec §8）

- [ ] **Step 1: 写 UI 测试（RED）——renderToString 断言关键结构**

```typescript
// 关键用例（夹具：storeFactory 注入预制快照，沿用现状测试的 storeFactory 缝）
it('预设选择行：关闭/省钱/能力 + 激活态 aria-pressed', () => {
  const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v4cfg('saving')) }))
  expect(html).toContain('关闭')
  expect(html).toContain('省钱')
  expect(html).toContain('能力')
  expect(html).toMatch(/aria-pressed="true"[^>]*>[^<]*省钱|省钱[^]*aria-pressed="true"/)
})
it('当前预设编辑器：默认模型下拉 + 规则表行（条件/目标/上移下移删除）+ 新增规则', () => {
  const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v4cfg('saving')) }))
  expect(html).toContain('默认模型')
  expect(html).toContain('带图')
  expect(html).toContain('kimi-coding/k3')
  expect(html).toContain('新增规则')
})
it('不可用目标标灰（kt-unavailable）', () => {
  const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWithAvailability(v4cfg('saving'), { 'kimi-coding/kimi-for-coding': false }) }))
  expect(html).toMatch(/kt-unavailable[^]*kimi-for-coding|kimi-for-coding[^]*kt-unavailable/)
})
it('关闭态：只显示预设行，不显示编辑器', () => {
  const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v4cfg(null)) }))
  expect(html).toContain('关闭')
  expect(html).not.toContain('新增规则')
})
it('关键词组管理区：组名 + 词表 textarea + 新建/删除组', () => {
  const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v4cfg('saving')) }))
  expect(html).toContain('关键词组')
  expect(html).toContain('chitchat')
})
it('预设操作：新建/复制/删除按钮在', () => {
  const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v4cfg('saving')) }))
  expect(html).toContain('新建预设').toContain('复制').toContain('删除')
})
```

dom 测试适配：保留「loading→ready 重渲染不崩（hooks 顺序）」用例（`test/SettingsCard.dom.test.tsx` 现 RED 复现钉），快照工厂换 v4 配置即可，断言改为新结构存在（如「关闭」按钮）。

- [ ] **Step 2: 跑测试确认失败** → Expected: FAIL

- [ ] **Step 3: 实现 SettingsCard（GREEN）——结构骨架**

```tsx
export function SettingsCard(props: SettingsCardProps) {
  const { scope, connection } = props
  const [store] = useState(() => (props.storeFactory ?? createCardStore)(scope, connection))
  useEffect(() => { void store.load() }, [store])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const config = snapshot.config
  // hooks 纪律（2026-08-20 生产事故回归钉）：全部 useState 必须先于 config===null 提前返回
  const [newPresetName, setNewPresetName] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  if (config === null) { /* 现状不可用态原样保留 */ }
  const writable = snapshot.writable
  const active = config.activePreset !== null ? config.presets[config.activePreset] ?? null : null
  const catalog = snapshot.catalog ?? []
  const modelOptions = catalog.flatMap((g) => g.models.map((m) => `${g.provider}/${m}`))
  // 规则编辑：全部组装 next presets 后 store.savePreset / store 层整段写
  const updateRules = (presetId: string, rules: RouterRule[]) => {
    const preset = config.presets[presetId]
    void store.savePreset(presetId, { ...preset, rules })
  }
  // …预设行 → active 编辑器（默认模型 select：modelOptions + 当前值兜底 option；
  //   规则表 map rule → 条件 select（带图/各组名）+ 目标 select（modelOptions，kt-unavailable 标灰）
  //   + ↑ ↓ 删除 按钮 + 新增规则；预设操作：新建(newPresetName→slug id)/复制/删除）→
  //   关键词组 details（组列表 + textarea 词表（逗号/换行分隔）+ 新建(newGroupName)/删除）
}
```

slug 规则：`name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')`，空 → `preset-<Date.now()%100000>`；冲突 → 后缀 `-2/-3…`（冲突检测由 store.createPreset 的 error 通道兜底）。

- [ ] **Step 4: 跑测试 + styles 清理** → `npx vitest run test/SettingsCard.test.tsx test/SettingsCard.dom.test.tsx` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/client/SettingsCard.tsx packages/dsh-kimi-tide/src/client/index.ts packages/dsh-kimi-tide/test/SettingsCard.test.tsx packages/dsh-kimi-tide/test/SettingsCard.dom.test.tsx
git commit -m "feat(settings-card): 预设管理器重做——预设选择/规则表编辑/新建复制删除预设/关键词组管理（hooks 顺序回归钉保留）"
```

---

### Task 10: TideDock + ReasonPanel v4 + 评分组件退役

**Files:**
- Modify: `<pkg>/src/client/TideDock.tsx`、`<pkg>/src/client/ReasonPanel.tsx`
- Delete: `<pkg>/src/client/ScoreEditor.tsx`、`<pkg>/src/client/CandidateList.tsx`、`<pkg>/test/panel-v3.test.tsx`
- Test: `<pkg>/test/TideDock.test.tsx`（若不存在则新建，钉桩 dock v4 视图）

**Interfaces:**
- Consumes: T7 `RouterPanelView`/`DecisionSummary`

- [ ] **Step 1: 写测试（RED）**

```typescript
it('dock 显示当前预设名与默认模型；关闭时显示关闭', () => {
  const panel = makePanel({ router: { activePreset: 'saving', presetName: '省钱', defaultTarget: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, ruleCount: 2 } })
  const html = renderToString(createElement(TideDock, { sessionId: 's', useProjection: () => panel }))
  expect(html).toContain('省钱')
  expect(html).toContain('deepseek-v4-flash')
  const off = renderToString(createElement(TideDock, { sessionId: 's', useProjection: () => makePanel({ router: { activePreset: null, presetName: null, defaultTarget: null, ruleCount: 0 } }) }))
  expect(off).toContain('关闭')
})
it('决策 chip 显示 reason，无 scoreDelta', () => {
  const panel = makePanel({ decision: { chosen: { provider: 'kimi-coding', model: 'kimi-for-coding' }, reason: '规则「code」命中' } })
  const html = renderToString(createElement(TideDock, { sessionId: 's', useProjection: () => panel }))
  expect(html).toContain('规则「code」命中')
  expect(html).not.toContain('Δ')
})
```

- [ ] **Step 2: 跑测试确认失败** → Expected: FAIL

- [ ] **Step 3: 实现（GREEN）**

TideDock：`router.mode` → `router.presetName ?? '关闭'`（chip `📡`）；`⚡ {router.primary.model}` → `⚡ {router.defaultTarget?.model}`（activePreset null 时不渲染）；删 `💰 premiumBudget` 段；决策 chip title 去 `Δ scoreDelta`；ReasonPanel 调用改 `presetName={router.presetName}`。
ReasonPanel props：`{ configSource, decision, presetName: string | null }`——`mode==='off'` 文案改 `presetName === null`；删 Δ 评分差行。
删除 ScoreEditor.tsx/CandidateList.tsx/panel-v3.test.tsx（git rm）。

- [ ] **Step 4: 全量回归**

Run: `npm test && npm run typecheck && npm run build`
Expected: **全绿**（退役面收口完成；若 panel-v3 之外的测试仍引用被删组件，按编译错误逐个清理）

- [ ] **Step 5: Commit**

```bash
git add -A packages/dsh-kimi-tide/src/client packages/dsh-kimi-tide/test
git commit -m "feat(dock): TideDock/ReasonPanel v4 视图（预设名/默认模型/规则命中摘要）；ScoreEditor/CandidateList 评分组件退役"
```

---

### Task 11: 文档 + 打包面 0.5.0 + 全量回归

**Files:**
- Rename: `<pkg>/docs/router-v3.md` → `<pkg>/docs/router.md`（内容重写为规则驱动架构）
- Modify: `README.md`（根，中英镜像）、`<pkg>/README.md`、`docs/development-plan-router.md`、`docs/positioning.md`、`<pkg>/package.json`
- Test: 全量

- [ ] **Step 1: 文档改造**

- `git mv packages/dsh-kimi-tide/docs/router-v3.md packages/dsh-kimi-tide/docs/router.md`，内容重写：规则引擎架构（预设/规则/打底语义/降级）、护栏/锁存/准入、迁移链（v1→v3→v4）、配置参考（v4 全字段）、决策可观测语义。引用更新（grep `router-v3` 逐一改 `router.md`）：根 README.md（4 处）、`<pkg>/README.md`（2 处）、`docs/development-plan-router.md`（2 处）；历史 specs/plans 档案不改。
- 根 README：路线图 0.5.0 行（规则驱动路由）、配置表（预设/规则/关键词组）、「评分基线」段删除或改写（中英镜像同步）；`<pkg>/README.md` 同步。
- `docs/development-plan-router.md` 状态行：0.5.0 承接说明。
- `docs/positioning.md`：0.5.0 差异化定位（预设层，与社区关键词路由器的边界，spec §3.2）。
- `<pkg>/package.json`：`version` → `0.5.0`；`description` 更新为规则驱动定位（中英一句话）。

- [ ] **Step 2: 全量回归 + bundle 守卫**

Run: `npm test && npm run typecheck && npm run build`
确认 `cordis.patch.yml` 无 OAuth/评分残留键（bundle.patch 红线）；README 相对链接全部可解析。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs+release: 0.5.0 规则驱动路由——router.md 重写（弃版本号文件名）、README/路线图/定位同步、package 0.5.0"
```

---

## 收尾（实施完成后）

1. 实机验收 8 项（spec §13，用户重启 dsh web 后进行）
2. 用户侧操作项：本机 `settings.yaml` 的 kimi-coding models 补挂 `kimi-for-coding`（或把内置预设代码规则目标改为 `kimi-for-coding-highspeed`）
3. 打 `v0.5.0` tag 触发 Actions Release 流水线

## Self-Review 记录

- Spec 覆盖：§4 配置→T1；§5 引擎→T2/T3；§5.2 不变量→T3；§5.3 降级→T3/T8/T9；§6 迁移→T4/T5/T6；§7 候选池→T6/T8；§8 UI→T8/T9；§9 可观测→T6/T7/T10；§10 命令→T7；§11 退役→T2/T3/T10/T11；§12 测试→各任务；§13 验收→收尾节。无缺口。
- 占位符扫描：T6 Step 1 的测试适配为机械映射指令（38K 测试文件不宜逐字内联），已给出逐条映射表；其余代码步骤均含实码。
- 类型一致性：RouteDecision.via / matchingRules / RouterPanelView / CardStore 方法名跨任务一致；`mergeResolved` 返回 v4 在 T4/T5 接口块对齐。
