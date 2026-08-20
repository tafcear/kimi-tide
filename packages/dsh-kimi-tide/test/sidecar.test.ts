import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RouterSidecarStore } from '../src/sidecar.js'
import { DEFAULT_CONFIG_V3 } from '../src/config.js'

describe('RouterSidecarStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-sidecar-'))
  const file = join(dir, 'kimi-tide-router.yml')

  it('save→load round-trips and reports source sidecar', () => {
    const store = new RouterSidecarStore({ file, onError: () => {} })
    const cfg = { ...DEFAULT_CONFIG_V3(), mode: 'capability' as const }
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

  it('half-corrupt v2 (missing default) → load never throws, falls back, warns', () => {
    // Fails if: validate() v2 passthrough stops doing the shallow structural check
    // (default provider/model strings + candidates array) — the regression was
    // load() succeeding, then configKey(config.default) throwing TypeError at
    // route time, violating 损坏永不崩.
    writeFileSync(file, 'version: 2\nmode: capability\n', 'utf8')
    const errors: string[] = []
    const store = new RouterSidecarStore({
      file, onError: (m) => errors.push(m),
      patchFallback: () => ({ mode: 'cost', primary: { provider: 'p', model: 'm' }, premium: { provider: 'k', model: 'x' } }),
    })
    const out = store.load()
    expect(out.source).toBe('patch')
    expect(out.config).not.toBeNull()
    expect(out.config!.default.provider).toBe('p')
    expect(errors.some((e) => e.includes('default'))).toBe(true)
  })
})

const V2_YAML = [
  'version: 2',
  'mode: capability',
  'default:',
  '  provider: kimi-tide',
  '  model: k3',
  'candidates:',
  '  - provider: kimi-tide',
  '    model: k3',
  '  - provider: deepseek-official',
  '    model: deepseek-v4-flash',
  'allowedProviders:',
  '  - kimi-tide',
  '  - deepseek-official',
  'scores:',
  '  kimi-tide/k3:',
  '    code: 4.7',
].join('\n')

describe('sidecar v2 → v3 迁移', () => {
  it('loads a v2 sidecar as migrated v3, archives .pre-v3 and rewrites the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kt-sidecar-v3-'))
    try {
      const file = join(dir, 'kimi-tide-router.yml')
      writeFileSync(file, V2_YAML, 'utf8')
      const store = new RouterSidecarStore({ file, onError: () => {} })
      const loaded = store.load()
      expect(loaded.source).toBe('sidecar')
      expect(loaded.config!.version).toBe(3)
      expect(loaded.config!.default).toEqual({ provider: 'kimi-coding', model: 'k3' })
      expect(loaded.config!.allowedProviders).toEqual(['kimi-coding', 'deepseek-official'])
      expect(loaded.config!.scores).toEqual({ 'kimi-coding/k3': { code: 4.7 } })
      expect(existsSync(file + '.pre-v3')).toBe(true)
      // 回写后文件是 v3：再 load 不重复迁移、不留第二份 .pre-v3
      const again = new RouterSidecarStore({ file, onError: () => {} }).load()
      expect(again.config!.version).toBe(3)
      expect(again.config!.default.provider).toBe('kimi-coding')
      expect(readFileSync(file + '.pre-v3', 'utf8')).toContain('provider: kimi-tide')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes a v3 sidecar through untouched (no archive, no rewrite)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kt-sidecar-v3b-'))
    try {
      const file = join(dir, 'kimi-tide-router.yml')
      const v3 = { version: 3, mode: 'off' as const, default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, candidates: [{ provider: 'kimi-coding', model: 'kimi-for-coding' }] }
      const store = new RouterSidecarStore({ file, onError: () => {} })
      store.save(v3)
      const out = store.load()
      expect(out.config!.version).toBe(3)
      expect(existsSync(file + '.pre-v3')).toBe(false)
      expect(out.config!.candidates[0].provider).toBe('kimi-coding')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
