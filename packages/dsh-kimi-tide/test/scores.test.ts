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
