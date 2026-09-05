# Review Flow 1.1.0 实施计划（评审回路落地 + 关键词组流认领）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「评审」关键词从「整轮切模型」改为「本轮照常执行 + 轮末评审模型异步出评审卡」——流认领静态抑制 + turn-stopping 异步评审 + 会话事件卡双端交付 + `/kimi-tide review` 手动命令。

**Architecture:** 路由层纯函数新增认领收集与抑制（rules.ts）；编排层在 installRouter 内新增 armed/lastTurn 槽、turn-stopping 异步评审、agent 作用域 session/event 累计（router.ts + 新模块 src/review.ts）；事件经 `kimi-tide/review` 新投影 unit 双端上屏（projection.ts + client）；手动命令与设置页认领提示收尾（commands.ts / SettingsCard.tsx）。

**Tech Stack:** TypeScript（零新依赖）、Vitest、zod（投影 schema）、esbuild 客户端 bundle、React 18（客户端卡片）。

**Spec:** `docs/superpowers/specs/2026-09-02-review-flow-design.md`（v2，2026-09-04 Kimi 评审修复波后）——本计划从 spec 论证，执行者两份都读。评审档案：`docs/audit/2026-09-04-review-flow-spec-kimi-review.md`。

## Global Constraints

- 宿主 peer `^0.1.1-rc.2 || >=0.1.2-0 <0.2.0-0` 零升级；全部新契约以 spec §2 锚点为准（2026-09-04 已复核）。
- 全部 cordis 监听器沿用 installRouter 现有四监听器的注册形态（`ctx.on(name, handler)`，effect 返回统一 dispose；重挂载即全量重建）。
- 评审调用：不设 `purpose`、不带 `effort`（M7）、纯文本无图块、`AbortSignal.timeout(60_000)` 有界。
- 截断常量 `REVIEW_INPUT_LIMIT = 12_000`（输入构造与累计侧同源）；投影每会话保留最近 20 条（新到旧）。
- 静态抑制无条件（认领即抑制）；可用性盲区经 previewRoute label 显式标注，不做静默（spec §4/§5）。
- 显式 @（含未知 provider）一律不武装评审（rules.ts:20 `explicitProvider` 对未知 @ 返回非空）。
- 版本面：`packages/dsh-kimi-tide/package.json` 1.0.1 → 1.1.0（Task 9 三方对齐）。
- 每任务收尾：`cd packages/dsh-kimi-tide && npm test` 全绿 + `npm run typecheck` 0 错；改客户端的任务加 `npm run build`。

---

### Task 1: claimedReviewGroups 纯函数 + decide 静态抑制

**Files:**
- Modify: `packages/dsh-kimi-tide/src/rules.ts`（新增导出函数；`matchingScored` 保持不变）
- Modify: `packages/dsh-kimi-tide/src/router.ts:249-281`（decide 规则链改走过滤后的 hits）
- Test: `packages/dsh-kimi-tide/test/review-flow.test.ts`（新建）

**Interfaces:**
- Consumes: `config.ts` 的 `CollaborationFlow`/`ReviewFlow`/`RouterConfigV5`（已在 rules.ts 导入面）。
- Produces: `claimedReviewGroups(config: RouterConfigAny): Set<string>`——Task 2（reviewTriggerHit/previewRoute）、Task 6（show 认领行）、Task 7（设置页提示）共用。

- [ ] **Step 1: 写失败测试**（`test/review-flow.test.ts` 新建，头部 import 沿用 `test/integration.test.ts` 的 `text()` helper 写法）

```ts
import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, DEFAULT_FLOWS, KIMI_PROVIDER } from '../src/config.js'
import { claimedReviewGroups, matchingScored } from '../src/rules.js'
import { KimiRouter } from '../src/router.js'

const text = (t: string): UserMessage =>
  ({ role: 'user', content: [{ type: 'text', text: t }] }) as unknown as UserMessage

const metas = (available = true) => [
  { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available },
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], available },
]

const v5Claimed = () => {
  const config = DEFAULT_CONFIG_V5()
  config.activePreset = 'capability'
  config.flows = {
    ...DEFAULT_FLOWS(),
    review: { ...DEFAULT_FLOWS().review, trigger: 'keywords', keywordGroup: 'review' },
  }
  return config
}

describe('claimedReviewGroups', () => {
  it('v4 形状 → 空集', () => {
    expect(claimedReviewGroups(DEFAULT_CONFIG_V4())).toEqual(new Set())
  })
  it('v5 收集 trigger=keywords 且 keywordGroup 非空的 review 流', () => {
    expect(claimedReviewGroups(v5Claimed())).toEqual(new Set(['review']))
  })
  it('trigger=manual 不收；keywordGroup 缺省不收', () => {
    const config = DEFAULT_CONFIG_V5()
    config.flows = {
      manual: { ...DEFAULT_FLOWS().review }, // trigger 默认 manual
      noGroup: { ...DEFAULT_FLOWS().review, trigger: 'keywords' }, // 缺 keywordGroup
    }
    expect(claimedReviewGroups(config)).toEqual(new Set())
  })
})

describe('decide 静态抑制', () => {
  it('被认领组规则跳过：纯评审词落预设默认（via=default，非 review-k3 的 rule）', () => {
    const router = new KimiRouter(v5Claimed(), metas(), { info: () => {} })
    const decision = router.decide([text('帮我评审一下这个方案')], 1)
    expect(decision).toMatchObject({ kind: 'route', via: 'default', target: { provider: KIMI_PROVIDER, model: 'k3' } })
  })
  it('他组规则照常：code 词不受 review 认领影响', () => {
    const router = new KimiRouter(v5Claimed(), metas(), { info: () => {} })
    const decision = router.decide([text('修复这个 bug')], 1)
    expect(decision).toMatchObject({ via: 'rule', target: { provider: KIMI_PROVIDER, model: 'kimi-for-coding' } })
  })
  it('认领不抑制 image 条件规则', () => {
    const router = new KimiRouter(v5Claimed(), metas(), { info: () => {} })
    const decision = router.decide([text('看看这张图')], 1, true)
    expect(decision).toMatchObject({ via: 'rule' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-flow.test.ts`
Expected: FAIL——`claimedReviewGroups` 未导出；decide 抑制用例显示 review-k3 命中。

- [ ] **Step 3: 实现 rules.ts 新增**

```ts
/** 认领中的关键词组（1.1.0 §4）：review 流 trigger=keywords 且 keywordGroup
 *  非空 → 该组被流认领。v4 无 flows → 空集（行为逐字节保持）。 */
export function claimedReviewGroups(config: RouterConfigAny): Set<string> {
  const claimed = new Set<string>()
  if (config.version !== 5) return claimed
  for (const flow of Object.values(config.flows)) {
    if (flow.type === 'review' && flow.trigger === 'keywords' && flow.keywordGroup) {
      claimed.add(flow.keywordGroup)
    }
  }
  return claimed
}
```

（`RouterConfigAny` 与 `matchingScored` 的 config 参数同源引用；若 rules.ts 尚未导入则从 router.ts/types.ts 现有导出补 type import，不复制定义。）

- [ ] **Step 4: 实现 router.ts decide 抑制**（:249 `const hits = matchingScored(...)` 之后、规则链遍历之前）

```ts
// 1.1.0 §4 静态抑制：被认领组的规则整条跳过（与本轮是否命中无关，语义可
// 预测）；命中词不再计入路由链。显式 @ 分支在其上方，天然先于抑制。
const claimed = claimedReviewGroups(this.config)
const routable = claimed.size === 0
  ? hits
  : hits.filter(({ rule }) => !(rule.when.kind === 'keywords' && claimed.has(rule.when.group)))
for (const [index, { rule, score }] of routable.entries()) {
```

（循环体与特异度标注逻辑不动——`routable` 顶替原 `hits`；末尾打底注释同步补一句「被认领组命中不入链」。）

- [ ] **Step 5: 跑测试确认通过 + 全量回归**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-flow.test.ts && npm test && npm run typecheck`
Expected: 新测试 PASS；存量 447+ 全绿（matchingScored 既有用例不得破）。

- [ ] **Step 6: Commit**

```bash
git add packages/dsh-kimi-tide/src/rules.ts packages/dsh-kimi-tide/src/router.ts packages/dsh-kimi-tide/test/review-flow.test.ts
git commit -m "feat(review-flow): claimedReviewGroups 纯函数 + decide 静态抑制（spec §4）"
```

---

### Task 2: reviewTriggerHit + previewRoute review-flow outcome

**Files:**
- Modify: `packages/dsh-kimi-tide/src/rules.ts`（新增 `reviewTriggerHit`；`RoutePreview` 联合扩展；`previewRoute` 分支）
- Test: `packages/dsh-kimi-tide/test/review-flow.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 `claimedReviewGroups`；rules.ts 现有 `explicitProvider`/词匹配助手（`matchingScored` 同款词边界/子串语义）。
- Produces:
  - `reviewTriggerHit(config: RouterConfigAny, text: string, isReviewerAvailable?: (target: RouteTarget) => boolean): { flowId: string; flow: ReviewFlow } | null`（Task 5 pre-step 武装、Task 2 previewRoute、Task 6 手动命令共用）；
  - `RoutePreview['outcome']` 新枝 `{ kind: 'review-flow'; flowId: string; label: string; score: number; routed: { kind: 'rule'; ruleId: string; label: string } | { kind: 'default'; target: RouteTarget } }`（Task 8 客户端试一句渲染消费）。

- [ ] **Step 1: 写失败测试**（追加到 test/review-flow.test.ts）

```ts
import { claimedReviewGroups, matchingScored, previewRoute, reviewTriggerHit } from '../src/rules.js'

describe('reviewTriggerHit', () => {
  it('命中取 flows 注册表序首个', () => {
    const config = v5Claimed()
    config.flows.review2 = { ...config.flows.review, keywordGroup: 'review' }
    const hit = reviewTriggerHit(config, '帮我评审一下', () => true)
    expect(hit?.flowId).toBe('review')
  })
  it('reviewer 不可用返 null；未命中返 null', () => {
    expect(reviewTriggerHit(v5Claimed(), '帮我评审一下', () => false)).toBeNull()
    expect(reviewTriggerHit(v5Claimed(), '今天天气不错', () => true)).toBeNull()
  })
  it('显式 @ 抑制：已知与未知 provider 都返 null', () => {
    expect(reviewTriggerHit(v5Claimed(), '@kimi 帮我评审', () => true)).toBeNull()
    expect(reviewTriggerHit(v5Claimed(), '@unknown-provider 帮我评审', () => true)).toBeNull()
  })
})

describe('previewRoute review-flow outcome', () => {
  const deps = { catalog: undefined, availability: null as Map<string, boolean> | null }
  it('命中认领组 → review-flow outcome，routed 携带过滤后路由，hits 剔除被认领组', () => {
    const preview = previewRoute(v5Claimed(), '帮我评审一下', deps as never)
    expect(preview.outcome).toMatchObject({ kind: 'review-flow', flowId: 'review' })
    expect((preview.outcome as { routed: { kind: string } }).routed.kind).toBe('default')
    expect(preview.hits.some((h) => h.rule.when.kind === 'keywords' && h.rule.when.group === 'review')).toBe(false)
  })
  it('可用性盲区：组认领 + reviewer 不可用 → 仍 review-flow 且 label 标注不可用', () => {
    const preview = previewRoute(v5Claimed(), '帮我评审一下', { ...deps, availability: { 'kimi-coding/k3': false } } as never)
    expect(preview.outcome).toMatchObject({ kind: 'review-flow' })
    expect((preview.outcome as { label: string }).label).toContain('不可用')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-flow.test.ts`
Expected: FAIL——`reviewTriggerHit` 未导出；outcome 无 review-flow 枝。

- [ ] **Step 3: 实现 reviewTriggerHit（rules.ts）**

```ts
/** 评审流触发判定（1.1.0 §5）：flows 注册表序首个「文本命中认领组（≥1 词）
 *  且 reviewer 可用」的 review 流。显式 @（含未知 provider，rules.ts:20 对
 *  未知 @ 返回非空）一律返 null——评审武装对一切显式 @ 关闭。
 *  isReviewerAvailable 缺省恒真（纯函数默认路径）；decide 侧传 metas 判定、
 *  previewRoute 传 availability 判定（spec §4 盲区语义：此处 false 只影响
 *  武装，不影响抑制）。 */
export function reviewTriggerHit(
  config: RouterConfigAny,
  text: string,
  isReviewerAvailable: (target: RouteTarget) => boolean = () => true,
): { flowId: string; flow: ReviewFlow } | null {
  if (explicitProvider(text) !== null) return null
  if (config.version !== 5) return null
  for (const [flowId, flow] of Object.entries(config.flows)) {
    if (flow.type !== 'review' || flow.trigger !== 'keywords' || !flow.keywordGroup) continue
    const words = config.keywordGroups[flow.keywordGroup] ?? []
    if (words.length === 0) continue
    // 复用 matchingScored 同一款词匹配助手（词边界/子串语义一致）——
    // 该助手如为模块私有则在本任务内导出，不复制实现。
    if (countGroupHits(words, text) < 1) continue
    if (!isReviewerAvailable(flow.reviewer)) continue
    return { flowId, flow }
  }
  return null
}
```

- [ ] **Step 4: 实现 previewRoute 扩展（rules.ts:164-226 区域）**

`RoutePreview` 联合新增一枝（M1 裁定：`routed` 为「本轮路由到 X」的类型化载体）：

```ts
| {
    kind: 'review-flow'
    flowId: string
    label: string
    score: number
    routed: { kind: 'rule'; ruleId: string; label: string } | { kind: 'default'; target: RouteTarget }
  }
```

`previewRoute` 内：现规则链改为在 `routable`（Task 1 同款过滤）上遍历，产出 `routedSummary`（首条命中 `{kind:'rule', ruleId, label}`，无命中 `{kind:'default', target: preset.default}`）；链走完后：

```ts
const armed = reviewTriggerHit(config, text, (t) => available(t))
if (armed !== null) {
  const reviewerOk = available(armed.flow.reviewer)
  return {
    hits: routable,
    outcome: {
      kind: 'review-flow',
      flowId: armed.flowId,
      label: reviewerOk ? `轮末触发评审流 ${armed.flowId}` : `评审流已认领但评审模型不可用`,
      score: 0,
      routed: routedSummary,
    },
  }
}
```

（显式 @ / off 分支保持在 review-flow 判定之前、原样返回——显式 @ 时 `reviewTriggerHit` 恒 null，不产生 review-flow outcome。）

- [ ] **Step 5: 跑测试确认通过 + 全量回归**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-flow.test.ts && npm test && npm run typecheck`
Expected: PASS；存量 previewRoute 用例全绿（试一句 0.8.0 既有断言不破）。

- [ ] **Step 6: Commit**

```bash
git add packages/dsh-kimi-tide/src/rules.ts packages/dsh-kimi-tide/test/review-flow.test.ts
git commit -m "feat(review-flow): reviewTriggerHit + previewRoute review-flow outcome（spec §4/§5，含盲区可见性）"
```

---

### Task 3: src/review.ts——输入构造 + 评审 runner

**Files:**
- Create: `packages/dsh-kimi-tide/src/review.ts`
- Test: `packages/dsh-kimi-tide/test/review-flow.test.ts`（追加）

**Interfaces:**
- Consumes: `config.ts` 的 `ReviewFlow`；`ctx.llm.stream` 调用形状与 `createStreamVisionCaller` 同款（router.ts:385-418：`text-delta` 累积、`finish.reason.kind==='error'|'aborted'` 抛错）。
- Produces:
  - `REVIEW_INPUT_LIMIT = 12_000`（常量，Task 5 累计侧共用）；
  - `truncate(text: string, limit?: number): string`（超限加「…（已截断）」）；
  - `buildReviewInput(req: ReviewRequest): string`（spec §6 三段模板）；
  - `createReviewRunner(ctx: Context): (req: ReviewRequest) => Promise<ReviewEventPayload>`（Task 5 编排、Task 6 手动命令共用）；
  - `ReviewRequest { flowId: string; flow: ReviewFlow; turn: number; userText: string; output: string }`；
  - `ReviewEventPayload { flowId; reviewer: {provider; model}; turn; userText(≤200); reviewText; ok; error?; durationMs; at(ISO) }`（= Task 4 投影 payload / 事件卡载荷）。

- [ ] **Step 1: 写失败测试**（追加）

```ts
import { buildReviewInput, createReviewRunner, REVIEW_INPUT_LIMIT, truncate } from '../src/review.js'

describe('buildReviewInput / truncate', () => {
  it('三段模板齐备', () => {
    const input = buildReviewInput({ flowId: 'review', flow: DEFAULT_FLOWS().review as never, turn: 3, userText: '需求X', output: '产出Y' })
    expect(input).toContain('资深技术评审')
    expect(input).toContain('[本轮用户需求]')
    expect(input).toContain('需求X')
    expect(input).toContain('[主模型本轮产出]')
    expect(input).toContain('产出Y')
  })
  it(`双段截断：${REVIEW_INPUT_LIMIT + 1} 字符触发标注`, () => {
    const input = buildReviewInput({ flowId: 'r', flow: DEFAULT_FLOWS().review as never, turn: 1, userText: 'a'.repeat(REVIEW_INPUT_LIMIT + 1), output: 'ok' })
    expect(input).toContain('…（已截断）')
    expect(truncate('abc')).toBe('abc')
  })
})

describe('createReviewRunner', () => {
  it('流成功 → ok:true 载荷；流失败 → ok:false + error，均不抛出', async () => {
    const okChunk = [{ type: 'text-delta', text: '意见' }, { type: 'finish', reason: { kind: 'stop' } }]
    const failChunk = [{ type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'X' } } }]
    const mkCtx = (chunks: unknown[]) => ({ llm: { stream: async function* () { for (const c of chunks) yield c } } }) as never
    const req = { flowId: 'review', flow: DEFAULT_FLOWS().review as never, turn: 1, userText: 'u', output: 'o' }
    expect(await createReviewRunner(mkCtx(okChunk))(req)).toMatchObject({ ok: true, reviewText: '意见', turn: 1 })
    expect(await createReviewRunner(mkCtx(failChunk))(req)).toMatchObject({ ok: false })
    expect((await createReviewRunner(mkCtx([]))(req)).ok).toBe(false) // 空输出=失败
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-flow.test.ts`
Expected: FAIL——`../src/review.js` 不存在。

- [ ] **Step 3: 实现 src/review.ts**

```ts
/** Review flow 1.1.0（spec §6）：评审输入构造 + 评审调用 runner。
 *  纯文本无图、不设 purpose（auxRewriteTarget 不触及）、不带 effort（M7）、
 *  AbortSignal.timeout(60s) 有界——评审发生于轮关闭后，不复用 turn signal
 *  （spec §5.4）。类型导入沿 router.ts 现有头部（Context/ContentBlock 等）。 */
export const REVIEW_INPUT_LIMIT = 12_000
const REVIEW_TIMEOUT_MS = 60_000
const USER_TEXT_DIGEST_LIMIT = 200

export interface ReviewRequest {
  flowId: string
  flow: import('./config.js').ReviewFlow
  turn: number
  userText: string
  output: string
}

export interface ReviewEventPayload {
  flowId: string
  reviewer: { provider: string; model: string }
  turn: number
  userText: string
  reviewText: string
  ok: boolean
  error?: string
  durationMs: number
  at: string
}

export function truncate(text: string, limit: number = REVIEW_INPUT_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…（已截断）`
}

const REVIEW_INSTRUCTION =
  '你是资深技术评审。请对「主模型回答」做交叉评审：先列问题（含严重度：阻塞/建议/可选），' +
  '再给改进建议，最后一行结论（通过/有条件通过/不通过）。只评内容质量与需求贴合度，' +
  '不重述需求；无实质问题时直说「未发现实质问题」。'

export function buildReviewInput(req: ReviewRequest): string {
  return [
    REVIEW_INSTRUCTION,
    '',
    '[本轮用户需求]',
    truncate(req.userText),
    '',
    '[主模型本轮产出]',
    truncate(req.output),
  ].join('\n')
}

export function createReviewRunner(ctx: {
  llm: { stream: (options: unknown) => AsyncIterable<{ type: string; text?: string; reason?: { kind: string; failure?: { message: string; code: string } } }> }
}) {
  return async (req: ReviewRequest): Promise<ReviewEventPayload> => {
    const startedAt = Date.now()
    const base = {
      flowId: req.flowId,
      reviewer: { provider: req.flow.reviewer.provider, model: req.flow.reviewer.model },
      turn: req.turn,
      userText: req.userText.slice(0, USER_TEXT_DIGEST_LIMIT),
    }
    try {
      let text = ''
      for await (const chunk of ctx.llm.stream({
        provider: req.flow.reviewer.provider,
        model: req.flow.reviewer.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: buildReviewInput(req) }] }],
        signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
      })) {
        if (chunk.type === 'text-delta') text += chunk.text ?? ''
        else if (chunk.type === 'finish' && chunk.reason !== undefined && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
          throw new Error(`review ${chunk.reason.kind}: ${chunk.reason.failure?.message} (${chunk.reason.failure?.code})`)
        }
      }
      if (text.trim() === '') throw new Error('review empty output')
      return { ...base, reviewText: text, ok: true, durationMs: Date.now() - startedAt, at: new Date().toISOString() }
    } catch (error) {
      return { ...base, reviewText: '', ok: false, error: (error as Error).message, durationMs: Date.now() - startedAt, at: new Date().toISOString() }
    }
  }
}
```

（实现时把结构化类型对齐宿主真实 `GenerateOptions`/chunk 类型——以 `router.ts` createStreamVisionCaller 同款导入为准；runner 内的 chunk 判别保持与 :406-415 一致。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-flow.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/review.ts packages/dsh-kimi-tide/test/review-flow.test.ts
git commit -m "feat(review-flow): 输入构造 + 评审 runner（spec §6，12000 截断/60s 有界/空输出=失败）"
```

---

### Task 4: kimi-tide/review 投影 unit + 事件类型注册扩展

**Files:**
- Modify: `packages/dsh-kimi-tide/src/types.ts`（新增 `ReviewRecord`/`KimiReviewProjection` 类型）
- Modify: `packages/dsh-kimi-tide/src/projection.ts`（新 unit 定义，镜像 panel 模式 :17-119）
- Modify: `packages/dsh-kimi-tide/src/index.ts:255-292`（`registerPanelEventType` 扩展为注册两类型）
- Test: `packages/dsh-kimi-tide/test/review-flow.test.ts`（追加）

**Interfaces:**
- Consumes: Task 3 `ReviewEventPayload`；panel unit 的 `ProjectionDefinition`/bridge 惯例（projection.ts:84-99 zod v3→v4 bridge 注释）。
- Produces:
  - `KIMI_TIDE_REVIEW_EVENT = 'kimi-tide/review'`（session 事件类型）与 `KIMI_TIDE_REVIEW_KEY`（投影 key，同值）；
  - `kimiReviewProjectionDefinition: ProjectionDefinition<'kimi-tide/review', KimiReviewProjection>`（stateVersion 1，wire 必带——panel :99 的 Omit+wire 注解形状）；
  - `KimiReviewProjection = { records: ReviewRecord[] }`（新到旧，≤20；`ReviewRecord = ReviewEventPayload & { seq?: never }`——直接复用 payload 形状，不另造字段）；
  - `SessionEventMap`/`SessionProjectionMap`/`SessionProjectionStateMap` 三处 declare module 合并（照抄 panel :21-35 双块）。
- 消费方：Task 5（append + KNOWN 注册）、Task 8（客户端 useProjection）。

- [ ] **Step 1: 写失败测试**（追加）

```ts
import { kimiReviewProjectionDefinition, KIMI_TIDE_REVIEW_EVENT } from '../src/projection.js'
import type { ReviewEventPayload } from '../src/review.js'

const record = (turn: number): ReviewEventPayload => ({
  flowId: 'review', reviewer: { provider: 'kimi-coding', model: 'k3' }, turn,
  userText: 'u', reviewText: `r${turn}`, ok: true, durationMs: 1, at: '2026-09-04T00:00:00Z',
})

describe('kimi-tide/review 投影', () => {
  it('fold：新到旧、保留最近 20 条、忽略其他事件', () => {
    let state = kimiReviewProjectionDefinition.init()
    for (let turn = 1; turn <= 25; turn++) {
      state = kimiReviewProjectionDefinition.apply(state, { type: KIMI_TIDE_REVIEW_EVENT, data: record(turn) } as never)
    }
    state = kimiReviewProjectionDefinition.apply(state, { type: 'other/event', data: {} } as never)
    const records = (state as { records: Array<{ turn: number }> }).records
    expect(records).toHaveLength(20)
    expect(records[0].turn).toBe(25)
    expect(records[19].turn).toBe(6)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-flow.test.ts`
Expected: FAIL——projection.ts 无 `kimiReviewProjectionDefinition` 导出。

- [ ] **Step 3: 实现 types.ts + projection.ts**

types.ts 追加：

```ts
import type { ReviewEventPayload } from './review.js'
export type ReviewRecord = ReviewEventPayload
/** kimi-tide/review 投影（1.1.0 §7）：每会话最近 20 条评审记录（新到旧）。 */
export interface KimiReviewProjection { records: ReviewRecord[] }
```

projection.ts 追加（镜像 panel :17-119 全套：常量、三处 declare module、zod schema、bridge、definition）：

```ts
export const KIMI_TIDE_REVIEW_KEY = 'kimi-tide/review' as const
export const KIMI_TIDE_REVIEW_EVENT = 'kimi-tide/review' as const

// declare module '@deepseek-ai/dsh-session'：SessionEventMap 增
//   'kimi-tide/review': ReviewRecord
// declare module '@deepseek-ai/dsh-session-projection/types'：两 Map 增
//   'kimi-tide/review': KimiReviewProjection

const reviewRecordSchema = z.object({
  flowId: z.string(),
  reviewer: z.object({ provider: z.string(), model: z.string() }),
  turn: z.number().int(),
  userText: z.string().max(200),
  reviewText: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  durationMs: z.number(),
  at: z.string(),
})
const reviewProjectionSchema = z.object({ records: z.array(reviewRecordSchema).max(20) }).nullable()

const REVIEW_KEEP = 20
export const kimiReviewProjectionDefinition:
  Omit<ProjectionDefinition<typeof KIMI_TIDE_REVIEW_KEY, KimiReviewProjection>, 'wire'> & { wire: NonNullable<ProjectionDefinition<typeof KIMI_TIDE_REVIEW_KEY, KimiReviewProjection>['wire']> } = {
  key: KIMI_TIDE_REVIEW_KEY,
  stateSchema: reviewProjectionSchema as unknown as ProjectionDefinition<typeof KIMI_TIDE_REVIEW_KEY, KimiReviewProjection>['stateSchema'],
  stateVersion: 1,
  init: () => null,
  apply: (state, event) => {
    if ((event as { type: string }).type !== KIMI_TIDE_REVIEW_EVENT) return state
    const incoming = (event as { data: ReviewRecord }).data
    const previous = state?.records ?? []
    return { records: [incoming, ...previous].slice(0, REVIEW_KEEP) }
  },
  wire: {
    viewSchema: reviewProjectionSchema as unknown as NonNullable<ProjectionDefinition<typeof KIMI_TIDE_REVIEW_KEY, KimiReviewProjection>['wire']>['viewSchema'],
    view: (state) => state,
  },
}
```

- [ ] **Step 4: index.ts 注册扩展**（:255-272 `registerPanelEventType` + :288 日志）

```ts
// :270 处 known.add(KIMI_TIDE_PANEL_EVENT) 改为：
known.add(KIMI_TIDE_PANEL_EVENT)
known.add(KIMI_TIDE_REVIEW_EVENT)
```

（import 行补 `KIMI_TIDE_REVIEW_EVENT`；:289/:291 两行日志文案中 panel 表述扩为「panel/review」。）

- [ ] **Step 5: 跑测试确认通过 + 回归**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-flow.test.ts && npm test && npm run typecheck`
Expected: PASS（panel 既有投影用例不破）。

- [ ] **Step 6: Commit**

```bash
git add packages/dsh-kimi-tide/src/types.ts packages/dsh-kimi-tide/src/projection.ts packages/dsh-kimi-tide/src/index.ts packages/dsh-kimi-tide/test/review-flow.test.ts
git commit -m "feat(review-flow): kimi-tide/review 投影 unit（20 条新到旧）+ 安装级事件目录双类型注册（spec §7）"
```

---

### Task 5: 编排层——armed/累计/turn-stopping 异步评审/手动评审钩子

**Files:**
- Modify: `packages/dsh-kimi-tide/src/router.ts`（installRouter 内 :544 `ctx.effect` 块新增监听与槽；`RouterOrchestrationDeps` :328 增两个可选依赖）
- Modify: `packages/dsh-kimi-tide/src/index.ts:441-452`（mountRouter deps 接线 `onReviewEvent`/`onManualReview`）+ `:461-474`（latestFlowEvents 更新）
- Test: `packages/dsh-kimi-tide/test/review-orchestration.test.ts`（新建，fake ctx 沿用 integration.test.ts:47-87 makeCtx 模式）

**Interfaces:**
- Consumes: Task 2 `reviewTriggerHit`、Task 3 runner、Task 4 事件常量；`rules.ts` 的 `latestUserText`（router.ts 已导入）。
- Produces（deps 面变化）:
  - `RouterOrchestrationDeps.onReviewEvent?: (agent: Agent, event: ReviewEventPayload) => void`——index.ts 更新 lastFlowEvent + pushPanel（spec §7 dock 行）；
  - `RouterOrchestrationDeps.onManualReview?: (fn: ((agent: Agent) => Promise<{ ok: boolean; message: string }>) | null) => void`——install/uninstall 时登记手动评审实现（Task 6 命令消费）。

- [ ] **Step 1: 写失败测试**（test/review-orchestration.test.ts 新建）

测试要点（每条一个 it，全部走 fake ctx listeners 直呼，模式=integration.test.ts makeCtx）：

```ts
// 夹具：v5Claimed 同 Task 1；fake agent = { ctx: { on: capture }, session: { append: vi.fn() } }
// fake ctx.on 把监听器存进 listeners Map（同 makeCtx），并支持 dispatch(name, payload)。

// 1) armed→累计→turn-stopping：pre-step(step=1, turn=7, messages=评审词) →
//    session/event assistant/message(turn=7) 两条 → turn-stopping(turn=7) →
//    断言 fake llm.stream 被调（载荷含需求+产出）且 session.append 收到
//    kimi-tide/review ok:true；断言 turn-stopping handler 同步返回（先返回后
//    append：handler 调用返回时 append 未被调，await microtask 后被调）。
// 2) 产出为空（无 assistant/message）→ 不发起评审（llm.stream 零调用）。
// 3) 评审流事件回灌（type='kimi-tide/review'）→ 不累计、不评审（防环）。
// 4) 显式 @ 轮（'@kimi 评审'）→ 不 armed（turn-stopping 后零调用）。
// 5) turn 不匹配（armed turn=7，turn-stopping turn=8）→ 不发起评审。
// 6) interrupted:true 的 assistant/message 不计入产出。
// 7) append 抛错 → 不向上抛、ctx.logger.warn 收到（评审修复 M4）。
// 8) 第二轮 pre-step 覆盖 armed（turn 7→8），两轮评审互相独立、各自 append。
// 9) onManualReview 收到非 null 函数；effect dispose 后收到 null（重挂载语义）。
// 10) 手动评审路径：调 onManualReview 收到的 fn(agent) → lastTurn 缓存评审
//     （先 pre-step+turn-stopping 造一轮 lastTurn）；无缓存 agent 返 ok:false。
// 11) 产出累计超 REVIEW_INPUT_LIMIT 停收（输出 12000+500 字符 → llm.stream
//     收到的 input 里 output 段以「…（已截断）」收尾且不超限）（评审修复 L5）。
// 12) 无 turn-stopping 的关闭路径容忍锁定（评审修复 L2）：armed 后只发
//     turn-stopping(turn=8)（≠armed.turn）→ 本轮不评审；下一轮 pre-step
//     (turn=8) 正常覆盖 armed——静默跳过语义有断言。
```

（用例 1-10 逐条实现；llm.stream 的 fake 用 Task 3 的 async generator 形状。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-orchestration.test.ts`
Expected: FAIL——deps 无新钩子、turn-stopping 无监听、评审零发起。

- [ ] **Step 3: 实现 RouterOrchestrationDeps 扩展（router.ts:328）**

```ts
export interface RouterOrchestrationDeps {
  images: ImageStateStore
  transcriber: Transcriber
  resolveImages: (messages: readonly UserMessage[]) => ResolvedImage[]
  onDecision: (agent: Agent, decision: RouteDecision, extra?: { flowId?: string; flowDigest?: string }) => void
  transcribeTimeoutMs?: number
  /** 1.1.0 §7：评审完成回调（dock 流事件行 + 面板刷新由 index.ts 实现）。 */
  onReviewEvent?: (agent: Agent, event: ReviewEventPayload) => void
  /** 1.1.0 §8：手动评审实现登记（install 传 fn / dispose 传 null）。 */
  onManualReview?: (fn: ((agent: Agent) => Promise<{ ok: boolean; message: string }>) | null) => void
}
```

- [ ] **Step 4: 实现 installRouter 编排（ctx.effect 块内，现有四监听器之后）**

```ts
// ---- Review flow 1.1.0（spec §5）----
const armed = new WeakMap<Agent, { turn: number; flowId: string; flow: ReviewFlow; userText: string }>()
const outputs = new WeakMap<Agent, { turn: number; text: string }>()
const lastTurns = new WeakMap<Agent, { userText: string; output: string }>()
const sessionWired = new WeakSet<Agent>()
const runReview = createReviewRunner(ctx)

const reviewerAvailable = (target: RouteTarget): boolean =>
  router.metas.some((m) => m.provider === target.provider && m.model === target.model && m.available)

const finishReview = (agent: Agent, req: ReviewRequest): void => {
  void runReview(req)
    .then((event) => {
      try {
        agent.session.append(KIMI_TIDE_REVIEW_EVENT, event)
      } catch (error) {
        ctx.logger?.warn?.(`kimi-router: review append failed: ${(error as Error).message}`)
      }
      deps.onReviewEvent?.(agent, event)
    })
    .catch((error: unknown) => {
      ctx.logger?.warn?.(`kimi-router: review failed: ${(error as Error).message}`)
    })
}

// session/event 监听：注册在 agent.ctx（agent 作用域——插件级 ctx 收全量会话
// 且无 agent 反查，无法键入 armed；spec §5.2 注册机制评审修复 M2）。首次
// pre-step 拿到 agent 时登记一次，随 agent dispose 卸载。
const wireSessionFeed = (agent: Agent): void => {
  if (sessionWired.has(agent)) return
  const agentCtx = (agent as { ctx?: { on?: (name: string, listener: (payload: unknown) => void) => () => void } }).ctx
  if (agentCtx?.on === undefined) return
  sessionWired.add(agent)
  agentCtx.on('session/event', (raw: unknown) => {
    const event = raw as { type?: string; turn?: number; interrupted?: boolean; message?: { role?: string; content?: ReadonlyArray<{ type?: string; text?: unknown }> } }
    if (event.type !== 'assistant/message' && event.type !== 'user/message') return
    if (event.type === 'user/message') {
      // L3：lastTurn.userText 仅收人类输入（synthetic 注入/goal 续轮不计）——
      // source 字段值以 dsh-session types 实读为准，实施时锚定过滤条件。
      const current = lastTurns.get(agent)
      if (current !== undefined) current.userText = '' // 占位：实现时替换为「人类输入 → text 块拼接」
      return
    }
    if (event.interrupted === true) return
    const turnText = (event.message?.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => String(b.text ?? ''))
      .join('')
    const tracked = outputs.get(agent)
    if (tracked === undefined || tracked.turn !== event.turn) {
      outputs.set(agent, { turn: event.turn ?? -1, text: turnText.slice(0, REVIEW_INPUT_LIMIT) })
    } else if (tracked.text.length < REVIEW_INPUT_LIMIT) {
      tracked.text = `${tracked.text}${turnText}`.slice(0, REVIEW_INPUT_LIMIT)
    }
    const armedEntry = armed.get(agent)
    if (armedEntry !== undefined && event.turn === armedEntry.turn) {
      const out = outputs.get(agent)
      if (out !== undefined && out.turn === armedEntry.turn) {
        lastTurns.set(agent, { userText: armedEntry.userText, output: out.text })
      }
    }
  })
}

// turn-stopping：serial 派发且被 loop await（agent-loop :570）——handler 必须
// 同步返回（评审异步跑，轮零阻塞，spec §2 派生事实）。
const disposeStop = ctx.on('agent/turn-stopping', (raw: unknown) => {
  const payload = raw as { agent: Agent; turn: number }
  const entry = armed.get(payload.agent)
  if (entry === undefined || entry.turn !== payload.turn) return
  armed.delete(payload.agent)
  const out = outputs.get(payload.agent)
  if (out === undefined || out.turn !== payload.turn || out.text.trim() === '') return
  finishReview(payload.agent, { flowId: entry.flowId, flow: entry.flow, turn: payload.turn, userText: entry.userText, output: out.text })
})

// 手动评审实现（spec §8）：取 lastTurn 缓存；无缓存返回可呈现文案。
deps.onManualReview?.(async (agent: Agent) => {
  const last = lastTurns.get(agent)
  if (last === undefined || (last.userText === '' && last.output === '')) {
    return { ok: false, message: '无可评审的上一轮' }
  }
  const flows = router.config.version === 5 ? router.config.flows : {}
  const manual = Object.entries(flows).find(([, f]) => f.type === 'review' && reviewerAvailable(f.reviewer))
  if (manual === undefined) return { ok: false, message: '没有可用的评审流（reviewer 不可用）' }
  finishReview(agent, { flowId: manual[0], flow: manual[1] as ReviewFlow, turn: -1, userText: last.userText, output: last.output })
  return { ok: true, message: '评审已发起' }
})
```

pre-step handler 内（现有 decide/转述块之后追加，:617 区域后）：

```ts
// 6. 评审流武装（1.1.0 §5.1）：显式 @ 由 reviewTriggerHit 内部抑制（含未知
// @）；armed 每轮重置/覆盖。router off 时 installRouter 整体未挂载，天然关闭。
const turnText = latestUserText(payload.messages)
const hit = reviewTriggerHit(router.config, turnText, reviewerAvailable)
if (hit !== null) {
  armed.set(agent, { turn: payload.turn, flowId: hit.flowId, flow: hit.flow, userText: turnText })
  wireSessionFeed(agent)
} else {
  armed.delete(agent)
}
```

effect 返回的 dispose 序列追加 `disposeStop()` 与 `deps.onManualReview?.(null)`。

（实施注意：①`session/event` 的 user/message→lastTurn.userText 的 source 过滤是 L3 锚点——实施时读 `dsh-session lib/types/types.d.ts` user/message 载荷的 source 字段实值后把占位行替换为真实判定，并在测试 10 的夹具里同时覆盖「注入上下文不覆盖 userText」；②armed 轮同时是 lastTurn 产出轮——lastTurns 在 session feed 内更新，手动命令依赖它而不依赖 armed。）

- [ ] **Step 5: index.ts 接线**（mountRouter deps :445-450 + latestFlowEvents :461-474）

```ts
disposeRouter = installRouter(ctx, new KimiRouter(routerConfig, candidateMetas, log), {
  images: imageStates,
  transcriber,
  resolveImages: extractResolvedImages,
  onDecision,
  onReviewEvent: (agent, event) => {
    // spec §7 dock 行：评审执行完成记一条流事件（lastFlowEvent 同款通道）。
    latestFlowEvents.set(agent, `review:${event.flowId} ${event.ok ? 'ok' : '失败'} · ${event.reviewer.model}`.slice(0, 120))
    pushPanel(agent)
  },
  onManualReview: (fn) => { manualReviewFn = fn },
})
```

（apply 作用域声明 `let manualReviewFn: ((agent: Agent) => Promise<{ ok: boolean; message: string }>) | null = null`；Task 6 的命令 deps 消费它。）

- [ ] **Step 6: 跑测试确认通过 + 全量回归**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-orchestration.test.ts && npm test && npm run typecheck`
Expected: 10 用例全 PASS；存量集成/index-wiring 全绿。

- [ ] **Step 7: Commit**

```bash
git add packages/dsh-kimi-tide/src/router.ts packages/dsh-kimi-tide/src/index.ts packages/dsh-kimi-tide/test/review-orchestration.test.ts
git commit -m "feat(review-flow): 编排层——armed/累计/turn-stopping 异步评审/手动钩子（spec §5，防环+零阻塞+append 兜底）"
```

---

### Task 6: /kimi-tide review 命令 + show 认领行

**Files:**
- Modify: `packages/dsh-kimi-tide/src/commands.ts`（parse 新增 `review` 子命令；apply 新增 review 分支；show 输出补认领行；`KimiTideCommandDeps` 增 `manualReview?` 与 `claimedGroups?`）
- Modify: `packages/dsh-kimi-tide/src/index.ts`（registerKimiTideCommands 的 deps 构造处接线 Task 5 的 `manualReviewFn` 与 `claimedReviewGroups(routerConfig)`）
- Test: `packages/dsh-kimi-tide/test/review-flow.test.ts`（追加 parse/apply 用例；apply 用例仿 integration.test.ts 对 applyKimiTideCommand 的既有调用法）

**Interfaces:**
- Consumes: Task 1 `claimedReviewGroups`；Task 5 `manualReviewFn`。
- Produces: parse 层 `'/kimi-tide review'` → `{ kind: 'review' }`（幂等：连发两次各产生一条评审事件——不去重，用户显式行为）；show 输出追加一行「评审流认领组：review」（`claimedGroups` 非空时）。

- [ ] **Step 1: 写失败测试**（追加）

```ts
import { applyKimiTideCommand, parseKimiTideCommand } from '../src/commands.js'

describe('/kimi-tide review 命令', () => {
  it('parse：review 子命令；大小写与空白容忍与既有子命令一致', () => {
    expect(parseKimiTideCommand('/kimi-tide review')).toMatchObject({ kind: 'review' })
    expect(parseKimiTideCommand('/kimi-tide show')).not.toMatchObject({ kind: 'review' })
  })
  it('apply：deps.manualReview 返回值透传为回显', async () => {
    const result = await applyKimiTideCommand({ kind: 'review' } as never, {
      /* …既有 deps 形状按 integration.test.ts 既有 apply 用例补齐… */
      manualReview: async () => ({ ok: true, message: '评审已发起' }),
    } as never)
    expect(result).toContain('评审已发起')
  })
})

describe('/kimi-tide show 认领行', () => {
  it('claimedGroups 非空 → 输出含认领组名', async () => {
    const result = await applyKimiTideCommand({ kind: 'show' } as never, {
      /* …既有 deps… */ claimedGroups: new Set(['review']),
    } as never)
    expect(result).toContain('review')
    expect(result).toContain('认领')
  })
  it('claimedGroups 空 → 不出现认领行', async () => {
    const result = await applyKimiTideCommand({ kind: 'show' } as never, {
      /* …既有 deps… */ claimedGroups: new Set(),
    } as never)
    expect(result).not.toContain('认领')
  })
})
```

（测试补 deps 时以 integration.test.ts 现有 applyKimiTideCommand 用例的 deps 夹具为基——先读该文件对应 it 再抄齐必填键，防止形状漂移。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-flow.test.ts`
Expected: FAIL——parse 无 review 枝；deps 无新键。

- [ ] **Step 3: 实现 commands.ts + index.ts 接线**

- parse：在既有子命令 switch（show/help/…）并列加 `'review'` 分支 → `{ kind: 'review' } as const`（命令 union 类型同步扩）。
- apply：review 分支 → `const r = await deps.manualReview?.() ?? { ok: false, message: '评审流未挂载（路由关闭中）' }`，回显 `r.message`。
- show：输出组装处（现 config/preset 段之后）追加：

```ts
if (deps.claimedGroups !== undefined && deps.claimedGroups.size > 0) {
  lines.push(`评审流认领组：${[...deps.claimedGroups].join('、')}（命中词不再整轮切模型，轮末自动评审）`)
}
```

- index.ts：registerKimiTideCommands 的 deps 对象补 `manualReview: () => manualReviewFn?.(agentFromCommandContext)` 与 `claimedGroups: claimedReviewGroups(routerConfig)`（agent 解析沿用 commands.ts 现有会话/agent 定位惯例——先读 commands.ts 的 show 分支如何拿当前会话再复用同一路径）。

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-flow.test.ts && npm test && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/commands.ts packages/dsh-kimi-tide/src/index.ts packages/dsh-kimi-tide/test/review-flow.test.ts
git commit -m "feat(review-flow): /kimi-tide review 手动命令 + show 认领提示行（spec §8）"
```

---

### Task 7: validateRouterConfig 拒绝 reviewer.effort（L7）+ 设置页认领提示

**Files:**
- Modify: `packages/dsh-kimi-tide/src/settings-schema.ts`（validateRouterConfig review 流分支 :164-170 区域补一条校验）
- Modify: `packages/dsh-kimi-tide/src/client/SettingsCard.tsx`（规则行渲染：`when.group` 被认领 → 该行禁用灰态 + 文案）
- Modify: `packages/dsh-kimi-tide/src/client/styles.ts`（灰态样式类）
- Test: `packages/dsh-kimi-tide/test/review-flow.test.ts`（追加 validate 用例）

**Interfaces:**
- Consumes: Task 1 `claimedReviewGroups`（客户端 import 同一纯函数——esbuild bundle 已含 src 共享模块，client 既有 `configKey` 等 config.ts 导入先例）。
- Produces: validate 拒绝文案「评审流 reviewer 不支持 effort（M7）」；SettingsCard 规则行新增 prop `claimedGroups: Set<string>`（由卡片内 `claimedReviewGroups(config)` 现算，不加新通道）。

- [ ] **Step 1: 写失败测试**（追加）

```ts
import { validateRouterConfig } from '../src/settings-schema.js'

describe('validateRouterConfig reviewer.effort（评审修复 L7）', () => {
  it('review 流 reviewer 带 effort → 拒绝', () => {
    const config = v5Claimed()
    ;(config.flows.review as { reviewer: { effort?: string } }).reviewer.effort = 'high'
    expect(() => validateRouterConfig(config as never)).toThrow(/effort/)
  })
  it('无 effort → 通过', () => {
    expect(() => validateRouterConfig(v5Claimed() as never)).not.toThrow()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-flow.test.ts`
Expected: 第一条 FAIL（现 validate 不查 reviewer.effort）。

- [ ] **Step 3: 实现 settings-schema 校验 + SettingsCard 灰态**

settings-schema.ts review 分支（:164-170 区域现有 rounds/keywordGroup 校验旁）：

```ts
if (flow.type === 'review' && flow.reviewer.effort !== undefined) {
  throw new Error('评审流 reviewer 不支持 effort（M7）：评审调用恒不带推理等级')
}
```

SettingsCard.tsx 规则行渲染处（现 minHits/条件摘要行渲染区域）：

```tsx
const claimed = claimedReviewGroups(config) // import { claimedReviewGroups } from '../rules.js'
// 规则行：rule.when.kind === 'keywords' && claimed.has(rule.when.group) 时
//   className 加 'kt-rule-claimed'，行尾追加提示 <span className="kt-claimed-hint">该组已被评审流认领，不再参与路由</span>
```

**试一句 outcome 渲染（A5 载体，预检裁定 R2）**：T2 已给 `RoutePreview['outcome']` 扩 `review-flow` 枝——SettingsCard 试一句的 outcome 渲染 switch 必须处理新枝（TS 收敛面强制），显示文案 = `本轮路由到 <routed 摘要> + <outcome.label>`（routed 摘要：rule → 规则 label；default → 「预设默认」；label 已含盲区标注语义）。

styles.ts 追加 `.kt-rule-claimed { opacity: .55 } .kt-claimed-hint { color: var(--dsh-text-muted, #888); font-size: 11px; margin-left: 6px }`（类名前缀沿用该文件现有 kt- 惯例）。

共存允许保存（抑制是自然结果，不加保存拦截——spec §3）。

- [ ] **Step 4: 跑测试确认通过 + 全量回归 + 构建**

Run: `cd packages/dsh-kimi-tide && npx vitest run test/review-flow.test.ts && npm test && npm run typecheck && npm run build`
Expected: 全绿 + 双端构建过。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/settings-schema.ts packages/dsh-kimi-tide/src/client/SettingsCard.tsx packages/dsh-kimi-tide/src/client/styles.ts packages/dsh-kimi-tide/test/review-flow.test.ts
git commit -m "feat(review-flow): validateRouterConfig 拒绝 reviewer.effort（L7）+ 设置页认领灰态提示（spec §3）"
```

---

### Task 8: 客户端评审卡（会话流渲染 + dock 流事件行消费）

**Files:**
- Create: `packages/dsh-kimi-tide/src/client/ReviewCard.tsx`（评审卡组件 + ConversationNodeDefinition）
- Modify: `packages/dsh-kimi-tide/src/client/index.ts`（注册：`ctx.uiConversation.events.register(reviewNodeDefinition)`；`inject` 补 `'uiConversation'`）
- Modify: `packages/dsh-kimi-tide/src/client/TideDock.tsx` / `ReasonPanel.tsx`（无需改——lastFlowEvent 通道已存在，Task 5 已写入 `review:…` 文案；本任务只核对渲染不为空）
- Test: 无组件测试（客户端惯例=typecheck+build+A6 实机目检门禁）；`npm run build` 为本任务机器门禁

**Interfaces:**
- Consumes: 宿主渲染缝（spec §7 锚点，2026-09-04 实读）：`ctx.uiConversation.events.register(ConversationNodeDefinition)`（dsh-client-ui-chat lib/client.js:4545 全量卡片同款；契约 dsh-client-ui-conversation lib/types/client/contract/conversation.d.ts:157-208）+ `conversation.chat.node` 槽 / `ChatNodeDataMap` 声明合并（client.js:3582 起）+ unknown 兜底（:5639/6929——未注册也不隐身）；投影 `useProjection('kimi-tide/review')`（TideDock.tsx:25 `useProjection` 先例）。
- Produces: `reviewNodeDefinition: ConversationNodeDefinition`——`match`: `event.type === 'kimi-tide/review'`；`start`: 取 event data 建 state；`buildViewNode`: 输出 `{ target: 'chat', kind: 'kimi-tide-review', data: { record } }` 形状节点（kind/data 按 ChatNodeDataMap 合并键名定名 `kimi-tide-review`）。卡片渲染：徽标 = 评审模型 + flowId；正文 = reviewText（markdown 纯文本渲染沿用宿主文本惯例，v1 先 `<pre>` 折叠样式）；`ok:false` 失败卡标灰并显 error。

- [ ] **Step 1: 实现 ReviewCard.tsx + 注册**

组件骨架（React 18，函数组件；实施时以 ConversationNodeDefinition 实读契约为准对齐 start/buildViewNode 签名——**先读 dsh-client-ui-conversation conversation.d.ts:157-208 与 dsh-client-ui-chat 中任一简单 definition（如 commandDefinition client.js:5563 附近）的实做样例再落笔**）：

```tsx
export function ReviewCard(props: { record: ReviewRecord }): JSX.Element {
  const { record } = props
  return (
    <div className={`kt-review-card${record.ok ? '' : ' kt-review-card-failed'}`}>
      <div className="kt-review-head">
        <span className="kt-review-badge">评审 · {record.reviewer.model}</span>
        <span className="kt-review-flow">{record.flowId}</span>
        <span className="kt-review-time">{record.at}</span>
      </div>
      {record.ok ? (
        <pre className="kt-review-body">{record.reviewText}</pre>
      ) : (
        <div className="kt-review-error">评审失败：{record.error}</div>
      )}
    </div>
  )
}
```

client/index.ts 注册（uiConversation 缺席不得阻塞激活——沿用 locale 的守卫惯例）：

```ts
ctx.effect(() => {
  const ui = ctx.get('uiConversation') as { events?: { register: (d: unknown) => () => void } } | undefined
  if (ui?.events?.register === undefined) return
  return ui.events.register(reviewNodeDefinition)
})
```

（`inject` 数组是否补 `'uiConversation'` 以实机为准：若该服务在客户端 inject 面可用则补入；守卫路径保证缺席安全。样式入 styles.ts，kt- 前缀。）

- [ ] **Step 2: 机器门禁**

Run: `cd packages/dsh-kimi-tide && npm run typecheck && npm run build && npm test`
Expected: typecheck 0 + 双端 build 过 + 全量测试绿（本任务零宿主改动，测试数不变）。

- [ ] **Step 3: Commit**

```bash
git add packages/dsh-kimi-tide/src/client/ReviewCard.tsx packages/dsh-kimi-tide/src/client/index.ts packages/dsh-kimi-tide/src/client/styles.ts
git commit -m "feat(review-flow): 客户端评审卡——uiConversation.events 注册 + 失败卡灰态（spec §7，A6 门禁载体）"
```

---

### Task 9: 文档面 + version 1.1.0 + A1–A8 验收清单

**Files:**
- Modify: `packages/dsh-kimi-tide/package.json`（version 1.0.1 → 1.1.0）
- Modify: `CHANGELOG.md`（新条目 1.1.0，用户视角）
- Modify: `README.md` / `README.en.md`（路线图/特性/测试数如有变化处镜像同步）
- Modify: `docs/router.md`（配置单一落点：review 流 trigger=keywords 认领语义 + 认领抑制 + 盲区提示 + 手动命令）
- Modify: 本计划文档末节（验收记录回填位）

- [ ] **Step 1: 版本三方对齐**（package.json / CHANGELOG / README 当前版本行——沿 8af50dd 惯例逐处改）
- [ ] **Step 2: 文档面**——router.md 补「评审流认领」节：认领语义、静态抑制、盲区可见性、`/kimi-tide review`、设置页灰态；CHANGELOG 条目含双端交付与 A1–A8 门禁说明。
- [ ] **Step 3: 验收清单落本计划末节**（下方 A1–A8 原文拷入，验收时逐项勾选）
- [ ] **Step 4: 全量机器门禁**

Run: `cd packages/dsh-kimi-tide && npm test && npm run typecheck && npm run build && cd ../.. && npm pack packages/dsh-kimi-tide --dry-run`
Expected: 全绿 + pack 体检 0 异常。

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "chore(release): 1.1.0 文档面与版本对齐——review flow 认领语义入库 + A1-A8 验收清单"
git push
```

---

## 实机验收门禁（A1–A8，用户重启 dsh web 后逐项过，全绿方发布）

- [x] **A1** 「这个做完做交叉评审」→ 面板决策原因**不**含 review 组命中（本轮落预设默认/执行模型）
- [x] **A2** 轮末数秒内评审卡上屏，徽标=评审模型，内容含「问题/建议/结论」结构
- [x] **A3** 评审卡之后的普通消息不触发评审（防环实机证）
- [x] **A4** 设置页：review 流 trigger=manual 时无认领提示；切 keywords 后 `review-k3` 规则行标灰 + 提示文案
- [x] **A5** 「试一句」输入「帮我评审一下这个方案」→ outcome 显示「轮末触发评审流 review」（routed=默认）
- [x] **A6** 评审卡 Host/Client 双端目检（投影帧 + 会话流卡片渲染；dock 流事件行 `review:review ok · k3`）
- [x] **A7** `/kimi-tide review` 手动触发 → 评审卡上屏；无缓存会话报「无可评审的上一轮」
- [x] **A8** 盲区可见性：配置「组认领 + 评审模型不可用」→ 试一句仍显示 review-flow 并标注「评审模型不可用」 ✅ **2026-09-05 实机全绿（修复 `7f42d0f`+`f8d236e`+`e99de4a` 后续）**

## 验收记录（实机验收后回填）

- **执行时间**：2026-09-04 23:13–23:55（DSH 会话 `2026-09-04-175700`；dsh web 22:53 重启，插件运行码 = `9051b1b` 构建 lib/ 17:21，A6 修复在线）；A8 修复+复测 2026-09-05 13:0x–15:1x（`7f42d0f`/`f8d236e` 推送，dsh web 15:00 重启装载最终构建）
- **逐项结果**：
  - **A1 ✅** 探针入站后 dock 芯片 = 省钱 → glm-5.3-flash（预设默认），决策弹窗无 review 组命中；加强对照：「请审查这段代码并给出意见」review 2 词命中仍被抑制、code 1 词胜出——认领组完全不参与路由
  - **A2 ✅** 轮停即触发（`at=23:32:33` 与轮末同刻），k3 评审耗时 28.8s，卡头「评审 · k3」徽标 + 问题清单/改进建议/结论结构（截图 + DOM 双证）
  - **A3 ✅** 评审卡后普通消息「好的，收到」正常回复（21s），评审记录数保持 1，防环实证
  - **A4 ✅** keywords 触发 → review→k3 规则行灰态 + 「该组已被评审流认领，不再参与路由」；切 manual → 提示消失、行恢复常态，且「触发关键词组」下拉随 manual 隐藏（语义正确）；已切回 keywords 还原
  - **A5 ✅** 试一句「帮我评审一下这个方案」→「未命中任何规则；最终路由：本轮路由到 预设默认 + 轮末触发评审流 review」——认领抑制在预演中同步生效
  - **A6 ✅** Host 投影行 `kimi-tide/review` 记录 + dock 决策弹窗「最近流事件：review:review ok · k3」+ 会话流卡片渲染（深紫卡、markdown 正文），`9051b1b` 修复实测通过
  - **A7 ✅** 有缓存会话：命令响应「评审已发起」→ 新评审卡上屏（对上一轮的新评审）；全新会话两次命令均返回「kimi-tide: 无可评审的上一轮」（会话日志解码实锤，服务端评审缓存会话级隔离）
  - **A8 ✅（2026-09-05 15:0x 实机全绿）** ghost reviewer（热加载确认）+ 组认领 → 试一句「**评审流已认领但评审模型不可用**」标注上屏（截图 + DOM 双证）；还原 reviewer k3 → 恢复「轮末触发评审流 review」普通 label——标注条件性与可用性联动正确
- **缺陷与修复**：
  - A6 评审卡注册晚到 → `9051b1b`（uiConversation 缺席改 ctx.inject 延迟驱动 + 5 测试用例），本次实机验证通过
  - **A8 缺陷（两层根因，均已修复）**：
    - ① tester reviewer 判定缺真实挂载表真相源 → `7f42d0f`：`kimi-tide-catalog` 命名空间新增 `mounted` 键（`buildMountedModels`，decide 侧同源），reviewer 判定对齐 decide（`remote.settings` loopback + inject 逐级声明）；555/555 绿
    - ② 实机复测发现宿主 `0.1.2-rc.1` 摘除 connection `api.*` 便利面（describe/llm.models/mutate 全打 undefined，B5 efforts 功能同证失效）→ `f8d236e`：connection 面经 **loopback typed remote**（`ctx.remote.settings/llm`，inject 逐级声明 `remote.settings`/`remote.llm`）重接 + efforts/mounted 取数改零参 loopback describe（严格 arity 教训同款）；effort 下拉灰态降级为已知限制（llm 命名空间懒挂载）
  - **候选缺陷 F-A4b**：协作流页切换无关字段（触发方式 keywords→manual→keywords）后 `settings.yaml` 的 `autoRevise: true` 被静默写为 `false`，而页内复选框仍显示 on——设置回写疑似丢字段，待复现修复；验收后已手工还原 `true`
- **宿主平台回归（2026-09-05 01:2x 发现，`f8d236e` 已绕开）**：dsh 宿主 09-03 21:15 升级 `0.1.2-rc.1` 后，插件设置卡经 api-remotes connection 的 `api.settings.describe` / `api.llm.models` 便利面被移除（connection 只剩低层 rpc/generation）。kimi-tide 已改走 loopback typed remote；effort 下拉的灰态/选项在 llm 命名空间懒挂载完成前仍可能降级（已知限制，不阻塞门禁）。上游 face 摘除是否有意，建议随发版后跟进确认
- **观察项（非阻塞）**：新建会话的 `kimi-tide/review` 投影行出现其他会话的评审记录展示态（服务端评审缓存本身会话级隔离，A7 已证）；发版前核实该展示面口径
- **环境注**：验收中 bsk 守护进程自动升级 0.1.11→0.2.0 致一次 browser_session start 被中止（瞬时，重试通过）；browser-skill-dsh-plugin 0.1.2→0.2.0（可访问性输出噪音消失）
- **技术门禁**：555/555 测试绿 + typecheck 0 错（`f8d236e` 后探针移除工作树，2026-09-05 15:1x）；实机 A1–A8 全绿
- **用户裁定**：方案 1 已授权（2026-09-05）——A8 全绿后 tag v1.1.0 发版
