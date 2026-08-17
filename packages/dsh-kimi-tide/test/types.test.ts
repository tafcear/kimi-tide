import { describe, expect, it } from 'vitest'
import { parseQuotaSnapshot } from '../src/types.js'

describe('parseQuotaSnapshot', () => {
  it('parses a full usages response (numeric fields)', () => {
    const snap = parseQuotaSnapshot({
      usage: { used: 9, limit: 100, resetTime: '2026-08-24T00:00:00Z' },
      limits: [{ used: 10, limit: 100, resetTime: '2026-08-17T18:00:00Z', windowMinutes: 300 }],
      user: { membership: { level: 'LEVEL_INTERMEDIATE' } },
    }, 1724000000000)
    expect(snap).not.toBeNull()
    expect(snap!.weekly).toEqual({ used: 9, limit: 100, resetTime: '2026-08-24T00:00:00Z' })
    expect(snap!.fiveHour.used).toBe(10)
    expect(snap!.membershipLevel).toBe('LEVEL_INTERMEDIATE')
    expect(snap!.stale).toBe(false)
    expect(snap!.fetchedAt).toBe(1724000000000)
  })

  it('tolerates string numbers ("used":"9")', () => {
    const snap = parseQuotaSnapshot({
      usage: { used: '9', limit: '100', resetTime: 'x' },
      limits: [{ used: '10', limit: '100', resetTime: 'y' }],
      user: { membership: { level: 'L' } },
    }, 0)
    expect(snap!.weekly.used).toBe(9)
    expect(snap!.fiveHour.used).toBe(10)
  })

  it('returns null when usage section is missing', () => {
    expect(parseQuotaSnapshot({}, 0)).toBeNull()
    expect(parseQuotaSnapshot(null, 0)).toBeNull()
  })

  it('degrades gracefully when limits[] is empty (fiveHour zeroed)', () => {
    const snap = parseQuotaSnapshot({
      usage: { used: 1, limit: 100, resetTime: 'x' },
      limits: [],
      user: {},
    }, 0)
    expect(snap!.fiveHour).toEqual({ used: 0, limit: 0, resetTime: '' })
    expect(snap!.membershipLevel).toBe('')
  })
})
