import { describe, expect, it } from 'vitest'
import { configKey, DEFAULT_CONFIG_V2 } from '../src/config.js'

describe('RouterConfigV2 defaults', () => {
  it('dynamic whitelist contains the actual providerName plus deepseek-official', () => {
    const cfg = DEFAULT_CONFIG_V2('moonshot-code')
    expect(cfg.allowedProviders).toEqual(['moonshot-code', 'deepseek-official'])
    expect(cfg.version).toBe(2)
    expect(cfg.mode).toBe('off')
  })
  it('configKey joins provider and model', () => {
    expect(configKey({ provider: 'kimi-tide', model: 'k3' })).toBe('kimi-tide/k3')
  })
})
