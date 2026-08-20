import { describe, expect, it } from 'vitest'
import { configKey, DEFAULT_CONFIG_V3 } from '../src/config.js'

describe('RouterConfigV3 defaults', () => {
  it('whitelist contains kimi-coding plus deepseek-official', () => {
    const cfg = DEFAULT_CONFIG_V3()
    expect(cfg.allowedProviders).toEqual(['kimi-coding', 'deepseek-official'])
    expect(cfg.version).toBe(3)
    expect(cfg.mode).toBe('off')
  })
  it('configKey joins provider and model', () => {
    expect(configKey({ provider: 'kimi-coding', model: 'k3' })).toBe('kimi-coding/k3')
  })
})
