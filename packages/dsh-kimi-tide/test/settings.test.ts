import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RouterSettingsStore, RouterConfigSchema } from '../src/settings.js'
import type { RouterConfig } from '../src/router.js'

const BASE_YML = `# user patch — keep my comments!
- insert:
    - id: some-other-plugin   # unrelated row
      name: some-other-plugin
      config:
        foo: 1
    - id: dsh-kimi-tide
      name: dsh-kimi-tide
      config:
        providerName: kimi-tide   # provider comment stays
        kimiHome: ''
        router:
          mode: off
          primary: { provider: deepseek-official, model: deepseek-v4-flash }
          premium: { provider: kimi-tide, model: kimi-for-coding }
`

const NEW_CONFIG: RouterConfig = {
  mode: 'cost',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
  premiumLong: { provider: 'kimi-tide', model: 'k3' },
  escalateWhen: { explicit: true, estimatedTokensGt: 60000, patterns: ['审查', 'review'] },
  premiumBudget: 0.2,
  budgetWindow: 20,
  charsPerToken: 2,
}

describe('RouterSettingsStore', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kimi-tide-settings-'))
    file = join(dir, 'cordis.patch.yml')
    writeFileSync(file, BASE_YML, 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('load() extracts the router section', () => {
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    const config = store.load()
    expect(config?.mode).toBe('off')
    expect(config?.primary.model).toBe('deepseek-v4-flash')
  })

  it('load() returns null when no router section exists', () => {
    writeFileSync(file, '- insert:\n    - id: dsh-kimi-tide\n      config:\n        providerName: kimi-tide\n', 'utf8')
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    expect(store.load()).toBeNull()
  })

  it('save() replaces the router block and preserves comments and other rows', () => {
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    store.save(NEW_CONFIG)
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('# user patch — keep my comments!')
    expect(text).toContain('providerName: kimi-tide   # provider comment stays')
    expect(text).toContain('some-other-plugin')
    expect(text).toContain('mode: cost')
    expect(text).toContain('estimatedTokensGt: 60000')
    expect(text).not.toContain('mode: off')
    expect(store.load()).toEqual(NEW_CONFIG)
  })

  it('save() appends a router block when the row has none', () => {
    writeFileSync(file, '- insert:\n    - id: dsh-kimi-tide\n      name: dsh-kimi-tide\n      config:\n        providerName: kimi-tide\n', 'utf8')
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    store.save(NEW_CONFIG)
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('router:')
    expect(text).toContain('mode: cost')
    expect(store.load()?.mode).toBe('cost')
  })

  it('save() creates a .bak backup before writing', () => {
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    store.save(NEW_CONFIG)
    expect(existsSync(file + '.bak')).toBe(true)
    expect(readFileSync(file + '.bak', 'utf8')).toBe(BASE_YML)
  })

  it('save() rejects invalid configs (schemastery) without touching the file', () => {
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    const bad = { ...NEW_CONFIG, mode: 'bogus' } as unknown as RouterConfig
    expect(() => store.save(bad)).toThrow()
    expect(readFileSync(file, 'utf8')).toBe(BASE_YML)
  })

  it('load() on missing patch file returns null and reports via onError', () => {
    const errors: string[] = []
    const store = new RouterSettingsStore({ patchFile: join(dir, 'nonexistent.yml'), onError: (m) => errors.push(m) })
    expect(store.load()).toBeNull()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('cannot read patch file')
  })

  it('save() appends an id-targeted override block when the row is absent (bundle-installed plugin)', () => {
    // Regression: a bundle-installed dsh-kimi-tide never appears as
    // `- id: dsh-kimi-tide` in the USER patch file (the row lives in the
    // bundle's own cordis.patch.yml). The loader merges an id-targeted
    // override patch `{ id, config }` onto the bundle row, so save() must
    // be able to create that override block instead of failing.
    writeFileSync(file, '# only unrelated rows\n- insert:\n    - id: some-other-plugin\n      config:\n        foo: 1\n', 'utf8')
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    store.save(NEW_CONFIG)
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('# only unrelated rows')
    expect(text).toContain('some-other-plugin')
    expect(text).toContain('- id: dsh-kimi-tide')
    expect(text).toContain('router:')
    expect(text).toContain('mode: cost')
    expect(store.load()?.mode).toBe('cost')
  })

  it('save() writes into an existing id-targeted override block (bundle-installed plugin, second save)', () => {
    // After the first save() created the override block, subsequent saves
    // must locate that SAME block and splice the router subtree in place,
    // not append a second one.
    writeFileSync(file, '# only unrelated rows\n- insert:\n    - id: some-other-plugin\n      config:\n        foo: 1\n', 'utf8')
    const store = new RouterSettingsStore({ patchFile: file, onError: () => {} })
    store.save(NEW_CONFIG)
    store.save({ ...NEW_CONFIG, mode: 'capability' })
    const text = readFileSync(file, 'utf8')
    expect(text.match(/- id: dsh-kimi-tide/g)).toHaveLength(1)
    expect(text).toContain('mode: capability')
    expect(text).not.toContain('mode: cost')
    expect(store.load()?.mode).toBe('capability')
  })

  it('save() on missing patch file throws with actionable message', () => {
    const store = new RouterSettingsStore({ patchFile: join(dir, 'nonexistent.yml'), onError: () => {} })
    expect(() => store.save(NEW_CONFIG)).toThrow(/cannot read patch file/)
    try {
      store.save(NEW_CONFIG)
    } catch (e) {
      expect((e as Error).message).toContain(join(dir, 'nonexistent.yml'))
    }
  })

  it('RouterConfigSchema validates a minimal config', () => {
    const parsed = RouterConfigSchema({
      mode: 'off',
      primary: { provider: 'a', model: 'b' },
      premium: { provider: 'c', model: 'd' },
    })
    expect(parsed.mode).toBe('off')
  })
})
