import { describe, expect, it } from 'vitest'
import { estimateTokens, latestUserText } from '../src/router.js'

describe('scaffold smoke', () => {
  it('router.ts now compiles and is importable', () => {
    expect(estimateTokens('abcd', 2)).toBe(2)
    expect(latestUserText([])).toBe('')
  })
})
