// test/review-flow.test.ts（1.1.0 review flow 专属；Task 2 起在同文件追加 describe）
// 消息夹具的 text() helper 写法沿用 test/integration.test.ts。
import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, DEFAULT_FLOWS, KIMI_PROVIDER } from '../src/config.js'
import { claimedReviewGroups, previewRoute, reviewTriggerHit } from '../src/rules.js'
import { KimiRouter } from '../src/router.js'

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
