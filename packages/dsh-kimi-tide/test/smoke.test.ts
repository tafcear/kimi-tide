import { describe, expect, it } from 'vitest'
import { latestUserText, messagesContainImage } from '../src/router.js'

describe('scaffold smoke', () => {
  it('router.ts compiles and re-exports message helpers', () => {
    expect(latestUserText([])).toBe('')
    expect(messagesContainImage([])).toBe(false)
  })
})
