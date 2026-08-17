import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import {
  applyImageGuard,
  KimiRouter,
  messagesContainImage,
  textOnlyProviders,
  type RouterConfig,
} from '../src/router.js'

const BASE: RouterConfig = {
  mode: 'capability',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
  premiumLong: { provider: 'kimi-tide', model: 'k3' },
}

function userMessage(blocks: Array<{ type: string; text?: string }>): UserMessage {
  return { role: 'user', content: blocks } as unknown as UserMessage
}

describe('messagesContainImage', () => {
  it('detects image blocks in user messages', () => {
    expect(messagesContainImage([userMessage([{ type: 'text', text: 'hi' }, { type: 'image' }])])).toBe(true)
  })

  it('ignores text-only batches', () => {
    expect(messagesContainImage([userMessage([{ type: 'text', text: 'hi' }])])).toBe(false)
  })
})

describe('image guard', () => {
  it('reroutes a text-only Kimi target to the multimodal primary when the step has an image', () => {
    const guard = applyImageGuard({ provider: 'kimi-tide', model: 'kimi-for-coding' }, BASE, true)
    expect(guard).not.toBeNull()
    expect(guard!.target).toEqual(BASE.primary)
  })

  it('guards the session base model too (keep decisions), not only route decisions', () => {
    // capability mode with no rules keeps the base config; when the base is
    // kimi-tide and the message carries an image, the guard must still swap.
    const router = new KimiRouter({ ...BASE, rules: [] }, { info: () => {} })
    const decision = router.decide([userMessage([{ type: 'image' }])], 0)
    expect(decision.kind).toBe('keep')
    const guard = router.guardImage({ provider: 'kimi-tide', model: 'k3' }, true)
    expect(guard?.target.provider).toBe('deepseek-official')
  })

  it('leaves multimodal targets alone', () => {
    expect(applyImageGuard({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, BASE, true)).toBeNull()
  })

  it('leaves text-only steps alone', () => {
    expect(applyImageGuard({ provider: 'kimi-tide', model: 'k3' }, BASE, false)).toBeNull()
  })

  it('does not touch providers outside the kimi route set', () => {
    expect(applyImageGuard({ provider: 'other', model: 'x' }, BASE, true)).toBeNull()
  })

  it('textOnlyProviders covers premium, premiumLong and rule routes', () => {
    const withRule: RouterConfig = {
      ...BASE,
      rules: [{ match: { patterns: ['审查'] }, route: { provider: 'kimi-tide', model: 'k3' } }],
    }
    expect([...textOnlyProviders(withRule)]).toEqual(['kimi-tide'])
  })
})
