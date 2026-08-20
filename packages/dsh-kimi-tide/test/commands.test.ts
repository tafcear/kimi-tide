import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { applyKimiTideCommand, parseKimiTideCommand, type KimiTideCommandDeps, type SettingsNamespacePort } from '../src/commands.js'
import { DEFAULT_CONFIG_V3, type RouterConfigV3 } from '../src/config.js'
import { RouterSidecarStore } from '../src/sidecar.js'
import type { UsageMonitor } from '../src/usage.js'

const dir = mkdtempSync(join(tmpdir(), 'kt-commands-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function makeConfig(): RouterConfigV3 {
  return { ...DEFAULT_CONFIG_V3(), premiumBudget: 0.5 }
}

function makeDeps(opts: { saved?: RouterConfigV3[]; file?: string; settings?: SettingsNamespacePort | null } = {}) {
  const saved = opts.saved ?? []
  let current = makeConfig()
  const file = opts.file ?? join(dir, `sidecar-${Math.random().toString(36).slice(2)}.yml`)
  const sidecar = new RouterSidecarStore({ file, onError: () => {} })
  const deps: KimiTideCommandDeps = {
    sidecar,
    settings: opts.settings ?? null,
    monitor: { refresh: vi.fn(async () => {}) } as unknown as UsageMonitor,
    current: () => current,
    onSaved: vi.fn((next: RouterConfigV3) => {
      saved.push(next)
      current = next
    }),
  }
  return { deps, saved, file, sidecar, readCurrent: () => current }
}

describe('parseKimiTideCommand', () => {
  it('parses mode subcommand', () => {
    expect(parseKimiTideCommand('mode cost')).toEqual({ kind: 'mode', mode: 'cost' })
    expect(parseKimiTideCommand('mode off')).toEqual({ kind: 'mode', mode: 'off' })
  })
  it('rejects invalid mode', () => {
    expect(parseKimiTideCommand('mode bogus').kind).toBe('error')
  })
  it('parses set subcommand with number coercion on v2 keys', () => {
    expect(parseKimiTideCommand('set lambda 0.3')).toEqual({ kind: 'set', key: 'lambda', value: 0.3 })
    expect(parseKimiTideCommand('set routeThreshold 0.8')).toEqual({ kind: 'set', key: 'routeThreshold', value: 0.8 })
    expect(parseKimiTideCommand('set premiumBudget 0.3')).toEqual({ kind: 'set', key: 'premiumBudget', value: 0.3 })
  })
  it('parses default.model as a string key', () => {
    expect(parseKimiTideCommand('set default.model kimi-for-coding')).toEqual({
      kind: 'set', key: 'default.model', value: 'kimi-for-coding',
    })
  })
  it('rejects v1-only keys and reports the v2 key table', () => {
    const cmd = parseKimiTideCommand('set escalateWhen.explicit false')
    expect(cmd.kind).toBe('error')
    if (cmd.kind !== 'error') return
    expect(cmd.message).toMatch(/unknown/)
    for (const key of ['lambda', 'routeThreshold', 'premiumBudget', 'budgetWindow', 'charsPerToken', 'default.model']) {
      expect(cmd.message).toContain(key)
    }
  })
  it('parses refresh and empty/help', () => {
    expect(parseKimiTideCommand('refresh')).toEqual({ kind: 'refresh' })
    expect(parseKimiTideCommand('')).toEqual({ kind: 'help' })
    expect(parseKimiTideCommand('help')).toEqual({ kind: 'help' })
  })
  it('parses export-config and import-config', () => {
    expect(parseKimiTideCommand('export-config')).toEqual({ kind: 'export-config' })
    expect(parseKimiTideCommand('import-config C:/tmp/cfg.yml')).toEqual({ kind: 'import-config', path: 'C:/tmp/cfg.yml' })
  })
  it('parse: import-config keeps the full inline YAML (newlines/indent intact)', () => {
    const text = 'version: 2\nscores:\n  "kimi-coding/kimi-for-coding":\n    code: 4.5'
    const cmd = parseKimiTideCommand(`import-config ${text}`)
    expect(cmd).toEqual({ kind: 'import-config', path: text })
  })
  it('errors on unknown subcommand', () => {
    expect(parseKimiTideCommand('frobnicate').kind).toBe('error')
  })
})

describe('applyKimiTideCommand', () => {
  it('mode: merges into current config, saves to sidecar, fires onSaved', async () => {
    const { deps, saved, sidecar } = makeDeps()
    const reply = await applyKimiTideCommand({ kind: 'mode', mode: 'cost' }, deps)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toEqual({ ...makeConfig(), mode: 'cost' })
    expect(deps.onSaved).toHaveBeenCalledWith(saved[0])
    expect(reply).toContain('cost')
    expect(sidecar.load().config!.mode).toBe('cost')
  })

  it('set lambda 0.3: persists to the sidecar and survives a reload', async () => {
    const { deps, saved, sidecar } = makeDeps()
    await applyKimiTideCommand({ kind: 'set', key: 'lambda', value: 0.3 }, deps)
    expect(saved[0].lambda).toBe(0.3)
    const reloaded = sidecar.load()
    expect(reloaded.source).toBe('sidecar')
    expect(reloaded.config!.lambda).toBe(0.3)
  })

  it('set default.model: writes the dotted v2 key', async () => {
    const { deps, saved } = makeDeps()
    await applyKimiTideCommand({ kind: 'set', key: 'default.model', value: 'deepseek-v4-pro' }, deps)
    expect(saved[0].default.model).toBe('deepseek-v4-pro')
  })

  it('set: rejects unknown keys at parse time (error kind reaches apply as message)', async () => {
    const { deps } = makeDeps()
    const cmd = parseKimiTideCommand('set hacker 1')
    expect(cmd.kind).toBe('error')
    const reply = await applyKimiTideCommand(cmd, deps)
    expect(reply).toMatch(/unknown/i)
    expect(reply).toContain('lambda')
    expect(deps.onSaved).not.toHaveBeenCalled()
  })

  it('export-config: returns the sidecar YAML text, parseable back to RouterConfigV3', async () => {
    const { deps, sidecar } = makeDeps()
    sidecar.save(makeConfig())
    const text = await applyKimiTideCommand({ kind: 'export-config' }, deps)
    const parsed = YAML.parse(text) as RouterConfigV3
    expect(parsed.version).toBe(3)
    expect(parsed.premiumBudget).toBe(0.5)
    expect(parsed.candidates[0].model).toBe('kimi-for-coding')
  })

  it('export-config: explains when no sidecar file exists yet', async () => {
    const { deps } = makeDeps()
    const reply = await applyKimiTideCommand({ kind: 'export-config' }, deps)
    expect(reply).toMatch(/not found|不存在|尚未/)
    expect(deps.onSaved).not.toHaveBeenCalled()
  })

  it('import-config: reads a YAML file, saves the sidecar, and the config takes effect', async () => {
    const { deps, saved, sidecar, readCurrent } = makeDeps()
    const incoming: RouterConfigV3 = { ...makeConfig(), mode: 'capability', lambda: 0.9 }
    const src = join(dir, 'import-src.yml')
    writeFileSync(src, YAML.stringify(incoming), 'utf8')
    const reply = await applyKimiTideCommand({ kind: 'import-config', path: src }, deps)
    expect(reply).toMatch(/import/i)
    expect(saved[0].lambda).toBe(0.9)
    expect(readCurrent().mode).toBe('capability')
    expect(sidecar.load().config!.lambda).toBe(0.9)
  })

  it('import-config: surfaces a missing file as a reply, not a throw', async () => {
    const { deps } = makeDeps()
    const reply = await applyKimiTideCommand({ kind: 'import-config', path: join(dir, 'nope.yml') }, deps)
    expect(reply).toMatch(/import failed|失败/)
    expect(deps.onSaved).not.toHaveBeenCalled()
  })

  it('import-config: accepts inline YAML text (panel v3 save path), saves, and takes effect', async () => {
    const { deps, saved, sidecar, readCurrent } = makeDeps()
    const text = YAML.stringify({ ...makeConfig(), mode: 'capability', lambda: 0.7 })
    const reply = await applyKimiTideCommand({ kind: 'import-config', path: text }, deps)
    expect(reply).toMatch(/import/i)
    expect(saved[0].lambda).toBe(0.7)
    expect(saved[0].mode).toBe('capability')
    expect(readCurrent().mode).toBe('capability')
    expect(sidecar.load().config!.lambda).toBe(0.7)
  })

  it('import-config: inline section patch (scores only) merges into current config, keeping untouched fields', async () => {
    const { deps, saved, sidecar } = makeDeps()
    const text = [
      'version: 2',
      'scores:',
      '  "kimi-coding/kimi-for-coding":',
      '    code: 4.5',
      '    vision: 3',
    ].join('\n')
    const reply = await applyKimiTideCommand({ kind: 'import-config', path: text }, deps)
    expect(reply).toMatch(/import/i)
    const cfg = saved[0]
    expect(cfg.scores['kimi-coding/kimi-for-coding']).toEqual({ code: 4.5, vision: 3 })
    expect(cfg.premiumBudget).toBe(0.5)
    expect(cfg.candidates[0].model).toBe('kimi-for-coding')
    expect(sidecar.load().config!.scores['kimi-coding/kimi-for-coding']).toEqual({ code: 4.5, vision: 3 })
  })

  it('import-config: inline candidates text replaces the candidate table but keeps other fields', async () => {
    const { deps, saved } = makeDeps()
    const text = [
      'version: 2',
      'default:',
      '  provider: kimi-coding',
      '  model: k3',
      'candidates:',
      '  - provider: kimi-coding',
      '    model: k3',
    ].join('\n')
    const reply = await applyKimiTideCommand({ kind: 'import-config', path: text }, deps)
    expect(reply).toMatch(/import/i)
    expect(saved[0].default.model).toBe('k3')
    expect(saved[0].candidates).toEqual([{ provider: 'kimi-coding', model: 'k3' }])
    expect(saved[0].premiumBudget).toBe(0.5)
  })

  it('refresh: triggers monitor.refresh and replies', async () => {
    const { deps } = makeDeps()
    const reply = await applyKimiTideCommand({ kind: 'refresh' }, deps)
    expect(deps.monitor.refresh).toHaveBeenCalledOnce()
    expect(reply).toMatch(/refresh/i)
  })

  it('surfaces sidecar save errors as a reply, not a throw', async () => {
    const { deps } = makeDeps()
    deps.sidecar.save = vi.fn(() => { throw new Error('schema rejected') }) as RouterSidecarStore['save']
    const reply = await applyKimiTideCommand({ kind: 'mode', mode: 'cost' }, deps)
    expect(reply).toContain('schema rejected')
    expect(deps.onSaved).not.toHaveBeenCalled()
  })
})

describe('applyKimiTideCommand with settings namespace', () => {
  it('mode writes through scope.update, not the sidecar', async () => {
    const writes: object[] = []
    const { deps } = makeDeps({
      settings: {
        get: () => makeConfig(),
        update: async (p) => { writes.push(p) },
        replace: async () => {},
      },
    })
    const saveSpy = vi.fn()
    deps.sidecar.save = saveSpy as RouterSidecarStore['save']
    const out = await applyKimiTideCommand({ kind: 'mode', mode: 'capability' }, deps)
    expect(writes).toEqual([{ ...makeConfig(), mode: 'capability' }])
    expect(saveSpy).not.toHaveBeenCalled()
    expect(out).toContain('saved')
  })

  it('export-config prints the resolved namespace value as YAML', async () => {
    const { deps } = makeDeps({
      settings: {
        get: () => ({ ...DEFAULT_CONFIG_V3(), mode: 'cost' }),
        update: async () => {},
        replace: async () => {},
      },
    })
    const out = await applyKimiTideCommand({ kind: 'export-config' }, deps)
    expect(out).toContain('mode: cost')
  })

  it('export-config surfaces a settings.get() error as a reply, not a throw', async () => {
    const { deps } = makeDeps({
      settings: {
        get: () => { throw new Error('scope unreadable') },
        update: async () => {},
        replace: async () => {},
      },
    })
    const out = await applyKimiTideCommand({ kind: 'export-config' }, deps)
    expect(out).toContain('export failed')
    expect(out).toContain('scope unreadable')
  })

  it('import-config (file) replaces the namespace section', async () => {
    const replaces: object[] = []
    const { deps } = makeDeps({
      settings: {
        get: () => makeConfig(),
        update: async () => {},
        replace: async (s) => { replaces.push(s) },
      },
    })
    const incoming: RouterConfigV3 = { ...makeConfig(), mode: 'capability', lambda: 0.9 }
    const src = join(dir, 'import-src-ns.yml')
    writeFileSync(src, YAML.stringify(incoming), 'utf8')
    const out = await applyKimiTideCommand({ kind: 'import-config', path: src }, deps)
    expect(replaces).toEqual([incoming])
    expect(deps.onSaved).toHaveBeenCalledWith(incoming)
    expect(out).toMatch(/import/i)
  })

  it('import-config (inline) merges into current and replaces the namespace, not the sidecar', async () => {
    const replaces: object[] = []
    const { deps } = makeDeps({
      settings: {
        get: () => makeConfig(),
        update: async () => {},
        replace: async (s) => { replaces.push(s) },
      },
    })
    const saveSpy = vi.fn()
    deps.sidecar.save = saveSpy as RouterSidecarStore['save']
    const text = [
      'version: 2',
      'scores:',
      '  "kimi-coding/kimi-for-coding":',
      '    code: 4.5',
      '    vision: 3',
    ].join('\n')
    const out = await applyKimiTideCommand({ kind: 'import-config', path: text }, deps)
    expect(replaces).toHaveLength(1)
    const merged = replaces[0] as RouterConfigV3
    // patch 字段生效
    expect(merged.scores['kimi-coding/kimi-for-coding']).toEqual({ code: 4.5, vision: 3 })
    // 未提及字段保留 current() 的值
    expect(merged.premiumBudget).toBe(0.5)
    expect(merged.routeThreshold).toBe(0.75)
    expect(merged.candidates[0].model).toBe('kimi-for-coding')
    expect(saveSpy).not.toHaveBeenCalled()
    expect(deps.onSaved).toHaveBeenCalledWith(merged)
    expect(out).toMatch(/import/i)
  })

  it('falls back to sidecar when settings is null', async () => {
    const { deps } = makeDeps({ settings: null })
    const saveSpy = vi.fn()
    deps.sidecar.save = saveSpy as RouterSidecarStore['save']
    const out = await applyKimiTideCommand({ kind: 'mode', mode: 'off' }, deps)
    expect(saveSpy).toHaveBeenCalled()
    expect(out).toContain('saved')
  })
})
