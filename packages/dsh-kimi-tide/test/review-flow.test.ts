// test/review-flow.test.ts（1.1.0 review flow 专属；Task 2 起在同文件追加 describe）
// 消息夹具的 text() helper 写法沿用 test/integration.test.ts。
import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, DEFAULT_FLOWS, KIMI_PROVIDER } from '../src/config.js'
import { claimedReviewGroups, matchingScored } from '../src/rules.js'
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
})
