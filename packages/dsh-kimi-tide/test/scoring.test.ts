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
