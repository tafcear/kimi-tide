import { describe, expect, it, vi } from 'vitest'
import { migrateV1 } from '../src/migrate.js'

const V1 = {
  mode: 'cost',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
  premiumLong: { provider: 'kimi-tide', model: 'k3' },
  premiumBudget: 0.3,
}

describe('migrateV1', () => {
  it('maps primary→default, premium→candidates[0], drops premiumLong with one warn', () => {
    const warn = vi.fn()
    const out = migrateV1(V1, warn)
    expect(out.version).toBe(2)
    expect(out.default).toEqual(V1.primary)
    expect(out.candidates[0]).toEqual(V1.premium)
    expect(out.premiumBudget).toBe(0.3)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('premiumLong')
  })
  it('non-v1 input falls back to defaults without throwing', () => {
    expect(migrateV1({ nonsense: 1 }, () => {}).version).toBe(2)
    expect(migrateV1(null, () => {}).version).toBe(2)
  })
})
