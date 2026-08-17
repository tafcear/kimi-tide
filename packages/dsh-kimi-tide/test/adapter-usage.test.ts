import { describe, expect, it, vi } from 'vitest'
import type { StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { ensureAccessToken, tapUsageChunk } from '../src/adapter.js'
import type { KimiOAuthManager } from '../src/oauth.js'

describe('tapUsageChunk', () => {
  it('invokes onUsage for usage chunks and returns the chunk unchanged', () => {
    const onUsage = vi.fn()
    const chunk: StreamChunk = { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    const out = tapUsageChunk(chunk, onUsage)
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 5 })
    expect(out).toBe(chunk)
  })

  it('ignores non-usage chunks', () => {
    const onUsage = vi.fn()
    const chunk: StreamChunk = { type: 'text-delta', index: 0, text: 'hi' }
    tapUsageChunk(chunk, onUsage)
    expect(onUsage).not.toHaveBeenCalled()
  })

  it('works without a callback (zero overhead path)', () => {
    const chunk: StreamChunk = { type: 'usage', usage: {} as TokenUsage }
    expect(tapUsageChunk(chunk, undefined)).toBe(chunk)
  })
})

describe('ensureAccessToken', () => {
  it('returns immediately when a token is already present (no refresh)', async () => {
    let calls = 0
    const oauth = {
      getAccessToken: () => 'tok',
      refresh: async () => { calls++; return true },
    } as unknown as KimiOAuthManager
    await ensureAccessToken(oauth, { retries: 3, delayMs: 0 })
    expect(calls).toBe(0)
  })

  it('retries refresh until a token appears (startup window: first refresh loses the lock race)', async () => {
    let token = ''
    let calls = 0
    const oauth = {
      getAccessToken: () => token,
      refresh: async () => { calls++; if (calls === 2) { token = 'tok'; return true } return false },
    } as unknown as KimiOAuthManager
    await ensureAccessToken(oauth, { retries: 3, delayMs: 0 })
    expect(calls).toBe(2)
    expect(oauth.getAccessToken()).toBe('tok')
  })

  it('throws AUTH after exhausting retries when refresh never yields a token', async () => {
    const oauth = {
      getAccessToken: () => '',
      refresh: async () => false,
    } as unknown as KimiOAuthManager
    await expect(ensureAccessToken(oauth, { retries: 3, delayMs: 0 })).rejects.toMatchObject({ code: 'AUTH' })
  })
})
