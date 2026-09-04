// test/review-flow.test.ts（1.1.0 review flow 专属；Task 2 起在同文件追加 describe）
// 消息夹具的 text() helper 写法沿用 test/integration.test.ts。
import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, DEFAULT_FLOWS, KIMI_PROVIDER } from '../src/config.js'
import { claimedReviewGroups, previewRoute, reviewTriggerHit } from '../src/rules.js'
import { KimiRouter } from '../src/router.js'
import { buildReviewInput, createReviewRunner, REVIEW_INPUT_LIMIT, truncate } from '../src/review.js'
import { kimiReviewProjectionDefinition, KIMI_TIDE_REVIEW_EVENT } from '../src/projection.js'
import type { ReviewEventPayload } from '../src/review.js'

const text = (t: string): UserMessage =>
  ({ role: 'user', content: [{ type: 'text', text: t }] }) as unknown as UserMessage

// 候选池须含断言涉及的规则目标（router.test.ts METAS 同款惯例）：
// code-kfc → kimi-for-coding、image-k3/打底 → k3——缺 kimi-for-coding 时
// decide 按目标不可用降级到默认，测不到「他组规则照常」。
const metas = (available = true) => [
  { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available },
  { provider: 'kimi-coding', model: 'kimi-for-coding', modalities: ['text', 'image'], available },
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
  it('R6：高特异度命中被认领抑制、次命中保留 → 保留规则 reason 不带（特异度最高）', () => {
    const router = new KimiRouter(v5Claimed(), metas(), { info: () => {} })
    // review 组 2 词（审查+评审）为特异度最高命中，但整条被认领抑制；code 组
    // 1 词保留——过滤后 routable 仅剩一条，保留命中不得继承首命中标注。
    const decision = router.decide([text('帮我审查评审这段代码')], 1)
    expect(decision).toMatchObject({ via: 'rule', target: { provider: KIMI_PROVIDER, model: 'kimi-for-coding' } })
    if (decision.kind !== 'route') throw new Error(`expected route decision, got ${decision.kind}`)
    expect(decision.reason).toBe('规则「code」命中 1 词')
  })
})

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
  const deps = { catalog: undefined, availability: null as Record<string, boolean> | null }
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

// Task 4（2026-09-04）：kimi-tide/review 投影 unit（spec §7）——fold 保留最近 20 条
// （新到旧）+ stateSchema 形状守门。brief 测试逐字。
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
  it('reviewRecordSchema 形状守门：拒绝缺字段与超长 userText（T3 评审移交的加固）', () => {
    const bad = { flowId: 'r', reviewer: { provider: 'p', model: 'm' }, turn: 1, userText: 'x'.repeat(201), reviewText: 'r', ok: true, durationMs: 1, at: 't' }
    expect(() => (kimiReviewProjectionDefinition as unknown as { stateSchema: { parse: (v: unknown) => unknown } }).stateSchema.parse({ records: [bad] })).toThrow()
    expect(() => (kimiReviewProjectionDefinition as unknown as { stateSchema: { parse: (v: unknown) => unknown } }).stateSchema.parse({ records: [record(1)] })).not.toThrow()
  })
})
