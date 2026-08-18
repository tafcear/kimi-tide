import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RouterSidecarStore } from '../src/sidecar.js'
import { DEFAULT_CONFIG_V2 } from '../src/config.js'

describe('RouterSidecarStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-sidecar-'))
  const file = join(dir, 'kimi-tide-router.yml')

  it('save→load round-trips and reports source sidecar', () => {
    const store = new RouterSidecarStore({ file, onError: () => {} })
    const cfg = { ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'capability' as const }
    store.save(cfg)
    const out = store.load()
    expect(out.source).toBe('sidecar')
    expect(out.config!.mode).toBe('capability')
    expect(out.config!.candidates[0].model).toBe('kimi-for-coding')
  })

  it('corrupt sidecar → .corrupt kept, warn fired, falls back to patch fallback', () => {
    writeFileSync(file, 'version: [unclosed', 'utf8')
    const errors: string[] = []
    const store = new RouterSidecarStore({
      file, onError: (m) => errors.push(m),
      patchFallback: () => ({ mode: 'cost', primary: { provider: 'p', model: 'm' }, premium: { provider: 'k', model: 'x' } }),
    })
    const out = store.load()
    expect(out.source).toBe('patch')
    expect(out.config!.default.provider).toBe('p')
    expect(errors.some((e) => e.includes('.corrupt'))).toBe(true)
  })

  it('missing file → source none', () => {
    const store = new RouterSidecarStore({ file: join(dir, 'nope.yml'), onError: () => {} })
    expect(store.load().source).toBe('none')
  })
})
