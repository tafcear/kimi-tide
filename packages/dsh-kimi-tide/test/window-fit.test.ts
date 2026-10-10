// test/window-fit.test.ts（issue #13：上下文窗口装得下判定——纯函数边界值）
import { describe, expect, it } from 'vitest'
import { CONTEXT_RESERVE_TOKENS, windowFit } from '../src/window-fit.js'

/**
 * 判据：目标窗口须容纳「会话占用 + 预留（CONTEXT_RESERVE_TOKENS）」。
 * 边界取实机形态（issue #13）：目标 256k 窗口、会话占用 ≈ 224k——加预留 32k 后
 * 恰在装下/装不下交界，两侧各取一值钉住 `available >= 0` 的判据。
 */
describe('windowFit（issue #13）', () => {
  it('预留常量 CONTEXT_RESERVE_TOKENS = 32000', () => {
    expect(CONTEXT_RESERVE_TOKENS).toBe(32000)
  })

  it('256,000 × 224,134（+预留 32,000 ⇒ 溢出 134）→ 不装且带诊断串', () => {
    expect(windowFit(256_000, { tokens: 224_134 })).toEqual({
      fits: false,
      available: -134,
      reason: '窗口容不下：目标 256,000 < 224,134 + 预留 32,000',
    })
  })

  it('256,000 × 224,000 → 恰好装下（available = 0 算装得下，无诊断串）', () => {
    expect(windowFit(256_000, { tokens: 224_000 })).toEqual({ fits: true, available: 0 })
  })

  it('判定按占用原值、诊断串的占用取整（224,133.5 → available -133.5 / 「224,134」）', () => {
    expect(windowFit(256_000, { tokens: 224_133.5 })).toEqual({
      fits: false,
      available: -133.5,
      reason: '窗口容不下：目标 256,000 < 224,134 + 预留 32,000',
    })
  })

  it('上下文窗口未知（undefined / 0 / 负数 / NaN / 非有限）→ 一律放行，available = ∞', () => {
    for (const window of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(windowFit(window, { tokens: 10_000_000 })).toEqual({ fits: true, available: Number.POSITIVE_INFINITY })
    }
  })

  it('占用未知（occupancy undefined）→ 放行（度量缺席不拦路由）', () => {
    expect(windowFit(256_000, undefined)).toEqual({ fits: true, available: Number.POSITIVE_INFINITY })
  })
})
