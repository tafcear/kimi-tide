import { describe, expect, it, vi } from 'vitest'
import type { StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { tapUsageChunk } from '../src/adapter.js'

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
