import { describe, expect, it } from 'vitest'
import { mergeResolved, routerConfigSchema, validateRouterConfig } from '../src/settings-schema.js'
import { DEFAULT_CONFIG_V3, type RouterConfigV3 } from '../src/config.js'

describe('routerConfigSchema', () => {
  it('resolves a full valid config unchanged', () => {
    const cfg = DEFAULT_CONFIG_V3()
    const out = routerConfigSchema(cfg) as RouterConfigV3
    expect(out).toEqual(cfg)
  })

  it('injects defaults for a bare section', () => {
    const out = routerConfigSchema({}) as RouterConfigV3
    expect(out.mode).toBe('off')
    expect(out.routeThreshold).toBe(0.75)
    expect(out.candidates).toEqual([{ provider: 'kimi-coding', model: 'kimi-for-coding' }])
  })

  it('rejects an invalid mode', () => {
    expect(() => routerConfigSchema({ ...DEFAULT_CONFIG_V3(), mode: 'nope' })).toThrow()
  })

  it('rejects a malformed scores entry', () => {
    expect(() => routerConfigSchema({ ...DEFAULT_CONFIG_V3(), scores: { 'kimi-coding/k3': { code: 7 } } })).toThrow()
  })
})

describe('validateRouterConfig', () => {
  const valid = () => validateRouterConfig({ ...DEFAULT_CONFIG_V3(), mode: 'capability' })
  it('passes a well-formed config', () => { expect(valid()).toBeUndefined() })
  it('rejects a default target missing from candidates', () => {
    expect(validateRouterConfig({ ...DEFAULT_CONFIG_V3(), default: { provider: 'x', model: 'y' } })).toMatch(/default/)
  })
  it('rejects out-of-range routeThreshold', () => {
    expect(validateRouterConfig({ ...DEFAULT_CONFIG_V3(), routeThreshold: 5 })).toMatch(/routeThreshold/)
  })
})

describe('mergeResolved', () => {
  it('merges schema defaults under a patch entry (base layer)', () => {
    const entry = { mode: 'capability' }
    const out = mergeResolved(entry)
    expect(out.mode).toBe('capability')
    expect(out.routeThreshold).toBe(0.75)  // schema default fills the rest
  })
})
