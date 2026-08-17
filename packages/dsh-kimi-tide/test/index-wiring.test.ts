import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ROUTER_CONFIG, buildRouter, defaultPatchFile } from '../src/index.js'

describe('defaultPatchFile', () => {
  const original = process.env.DSH_HOME
  afterEach(() => {
    if (original === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = original
  })

  it('uses DSH_HOME when set', () => {
    process.env.DSH_HOME = '/tmp/dsh-test'
    const result = defaultPatchFile().replace(/\\/g, '/')
    expect(result).toBe('/tmp/dsh-test/profiles/web/cordis.patch.yml')
  })

  it('falls back to ~/.dsh', () => {
    delete process.env.DSH_HOME
    expect(defaultPatchFile()).toMatch(/\.dsh[\\/]profiles[\\/]web[\\/]cordis\.patch\.yml$/)
  })
})

describe('buildRouter / DEFAULT_ROUTER_CONFIG', () => {
  it('default config is mode off with deepseek primary and kimi premium', () => {
    expect(DEFAULT_ROUTER_CONFIG.mode).toBe('off')
    expect(DEFAULT_ROUTER_CONFIG.primary.provider).toBe('deepseek-official')
    expect(DEFAULT_ROUTER_CONFIG.premium.provider).toBe('kimi-tide')
  })

  it('buildRouter returns a KimiRouter whose decisions respect the config', () => {
    const logs: string[] = []
    const router = buildRouter(
      { ...DEFAULT_ROUTER_CONFIG, mode: 'cost', escalateWhen: { patterns: ['审查', 'review'] } },
      { info: (m) => logs.push(m) },
    )
    const decision = router.decide([{ role: 'user', content: [{ type: 'text', text: '请审查这段代码 review' }] } as never], 0)
    expect(decision.kind).toBe('route')
  })
})
