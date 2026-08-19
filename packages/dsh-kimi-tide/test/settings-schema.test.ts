import { describe, expect, it } from 'vitest'
import { mergeResolved, routerConfigSchema, validateRouterConfig } from '../src/settings-schema.js'
import { DEFAULT_CONFIG_V2, type RouterConfigV2 } from '../src/config.js'

describe('routerConfigSchema', () => {
  it('resolves a full valid config unchanged', () => {
    const cfg = DEFAULT_CONFIG_V2('kimi-tide')
    const out = routerConfigSchema(cfg) as RouterConfigV2
    expect(out).toEqual(cfg)
  })

  it('injects defaults for a bare section', () => {
    const out = routerConfigSchema({}) as RouterConfigV2
    expect(out.mode).toBe('off')
    expect(out.routeThreshold).toBe(0.75)
    expect(out.candidates).toEqual([{ provider: 'kimi-tide', model: 'kimi-for-coding' }])
  })

  it('rejects an invalid mode', () => {
    expect(() => routerConfigSchema({ ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'nope' })).toThrow()
  })

  it('rejects a malformed scores entry', () => {
    expect(() => routerConfigSchema({ ...DEFAULT_CONFIG_V2('kimi-tide'), scores: { 'kimi-tide/k3': { code: 7 } } })).toThrow()
  })
})

describe('validateRouterConfig', () => {
  const valid = () => validateRouterConfig({ ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'capability' })
  it('passes a well-formed config', () => { expect(valid()).toBeUndefined() })
  it('rejects a default target missing from candidates', () => {
    expect(validateRouterConfig({ ...DEFAULT_CONFIG_V2('kimi-tide'), default: { provider: 'x', model: 'y' } })).toMatch(/default/)
  })
  it('rejects out-of-range routeThreshold', () => {
    expect(validateRouterConfig({ ...DEFAULT_CONFIG_V2('kimi-tide'), routeThreshold: 5 })).toMatch(/routeThreshold/)
  })
})

describe('mergeResolved', () => {
  it('merges schema defaults under a patch entry (base layer)', () => {
    const entry = { mode: 'capability' }
    const out = mergeResolved(entry, 'kimi-tide')
    expect(out.mode).toBe('capability')
    expect(out.routeThreshold).toBe(0.75)  // schema default fills the rest
  })
})
