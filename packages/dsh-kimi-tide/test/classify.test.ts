import { describe, expect, it } from 'vitest'
import { classify, explicitProvider } from '../src/classify.js'
import type { UserMessage } from '@deepseek-ai/dsh-session'

const msg = (text: string, image = false): UserMessage => ({
  role: 'user',
  content: [{ type: 'text', text }, ...(image ? [{ type: 'image' }] : [])],
} as unknown as UserMessage)

describe('classify', () => {
  it('code keywords raise code+reasoning weights', () => {
    const r = classify([msg('帮我 review 这段代码，有个 bug')], { charsPerToken: 2 })
    expect(r.weights.code).toBeGreaterThanOrEqual(2)
  })
  it('image block sets vision and explicit provider wins', () => {
    const r = classify([msg('看图', true)], { charsPerToken: 2 })
    expect(r.vision).toBe(true)
    expect(explicitProvider('用 @ollama 回答')).toBe('ollama')
    expect(explicitProvider('用 @kimi 回答')).toBe('kimi-coding')
    expect(explicitProvider('用 @kimi-tide 回答')).toBe('kimi-coding')
  })
  it('long context raises longctx', () => {
    const r = classify([msg('x'.repeat(200000))], { charsPerToken: 2 })
    expect(r.weights.longctx).toBeGreaterThanOrEqual(1)
    expect(r.estTokens).toBeGreaterThan(60000)
  })
})
