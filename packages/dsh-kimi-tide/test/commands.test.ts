import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { applyKimiTideCommand, parseKimiTideCommand, type KimiTideCommandDeps, type SettingsNamespacePort } from '../src/commands.js'
import { DEFAULT_CONFIG_V4, type RouterConfigV4 } from '../src/config.js'
import { RouterSidecarStore } from '../src/sidecar.js'
import type { UsageMonitor } from '../src/usage.js'

const dir = mkdtempSync(join(tmpdir(), 'kt-commands-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function v4cfg(activePreset: string | null): RouterConfigV4 {
  return { ...DEFAULT_CONFIG_V4(), activePreset }
}

function makeDeps(
  config: RouterConfigV4 = v4cfg(null),
  onSaved?: (c: RouterConfigV4) => void,
  opts: { file?: string; settings?: SettingsNamespacePort | null } = {},
): KimiTideCommandDeps {
  let current = config
  const file = opts.file ?? join(dir, `sidecar-${Math.random().toString(36).slice(2)}.yml`)
  const sidecar = new RouterSidecarStore({ file, onError: () => {} })
  return {
    sidecar,
    settings: opts.settings ?? null,
    monitor: { refresh: vi.fn(async () => {}) } as unknown as UsageMonitor,
    current: () => current,
    onSaved: (next: RouterConfigV4) => {
      onSaved?.(next)
      current = next
    },
  }
}

describe('parseKimiTideCommand', () => {
  it('parses preset subcommand (off → null)', () => {
    expect(parseKimiTideCommand('preset saving')).toEqual({ kind: 'preset', preset: 'saving' })
    expect(parseKimiTideCommand('preset off')).toEqual({ kind: 'preset', preset: null })
  })
  it('rejects preset without an id', () => {
    expect(parseKimiTideCommand('preset').kind).toBe('error')
  })
  it('mode subcommand is retired → error pointing at preset', () => {
    const cmd = parseKimiTideCommand('mode cost')
    expect(cmd.kind).toBe('error')
    if (cmd.kind !== 'error') return
    expect(cmd.message).toContain('preset')
  })
  it('parses set activePreset', () => {
    expect(parseKimiTideCommand('set activePreset saving')).toEqual({ kind: 'set', key: 'activePreset', value: 'saving' })
    expect(parseKimiTideCommand('set activePreset off')).toEqual({ kind: 'set', key: 'activePreset', value: 'off' })
  })
  it('rejects unknown settable keys and reports the activePreset table', () => {
    const cmd = parseKimiTideCommand('set lambda 0.3')
    expect(cmd.kind).toBe('error')
    if (cmd.kind !== 'error') return
    expect(cmd.message).toMatch(/unknown/)
    expect(cmd.message).toContain('activePreset')
  })
  it('parses show', () => {
    expect(parseKimiTideCommand('show')).toEqual({ kind: 'show' })
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
    const text = 'version: 4\nactivePreset: saving'
    const cmd = parseKimiTideCommand(`import-config ${text}`)
    expect(cmd).toEqual({ kind: 'import-config', path: text })
  })
  it('errors on unknown subcommand', () => {
    expect(parseKimiTideCommand('frobnicate').kind).toBe('error')
  })
})

describe('applyKimiTideCommand', () => {
  it('/kimi-tide preset saving → activePreset=saving 持久化', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const out = await applyKimiTideCommand(parseKimiTideCommand('preset saving'), deps)
    expect(saved[0].activePreset).toBe('saving')
    expect(out).toContain('saving')
  })

  it('/kimi-tide preset off → activePreset=null', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg('saving'), (c) => saved.push(c))
    const out = await applyKimiTideCommand(parseKimiTideCommand('preset off'), deps)
    expect(saved[0].activePreset).toBeNull()
    expect(out).toContain('off')
  })

  it('/kimi-tide preset ghost → error 且不落盘', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const out = await applyKimiTideCommand(parseKimiTideCommand('preset ghost'), deps)
    expect(out).toContain('不存在')
    expect(saved).toHaveLength(0)
  })

  it('/kimi-tide show → 输出当前预设/默认/规则数', async () => {
    const deps = makeDeps(v4cfg('saving'))
    const out = await applyKimiTideCommand(parseKimiTideCommand('show'), deps)
    expect(out).toContain('省钱')
    expect(out).toContain('deepseek-v4-flash')
    expect(out).toContain('2')
  })

  it('/kimi-tide mode … 子命令已退役 → error 提示 preset', async () => {
    const deps = makeDeps(v4cfg(null))
    expect(await applyKimiTideCommand(parseKimiTideCommand('mode cost'), deps)).toContain('preset')
  })

  it('set activePreset saving persists (off → null)', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const out = await applyKimiTideCommand(parseKimiTideCommand('set activePreset saving'), deps)
    expect(saved[0].activePreset).toBe('saving')
    expect(out).toContain('saved')

    const off = await applyKimiTideCommand(parseKimiTideCommand('set activePreset off'), deps)
    expect(saved[1].activePreset).toBeNull()
    expect(off).toContain('saved')
  })

  it('set activePreset ghost → error 且不落盘', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const out = await applyKimiTideCommand(parseKimiTideCommand('set activePreset ghost'), deps)
    expect(out).toContain('不存在')
    expect(saved).toHaveLength(0)
  })

  it('export-config: returns the sidecar YAML text, parseable back to RouterConfigV4', async () => {
    const deps = makeDeps(v4cfg('saving'))
    deps.sidecar.save(v4cfg('saving'))
    const text = await applyKimiTideCommand({ kind: 'export-config' }, deps)
    const parsed = YAML.parse(text) as RouterConfigV4
    expect(parsed.version).toBe(4)
    expect(parsed.activePreset).toBe('saving')
    expect(parsed.presets.saving.default.model).toBe('deepseek-v4-flash')
  })

  it('export-config: explains when no sidecar file exists yet', async () => {
    const deps = makeDeps(v4cfg(null))
    const reply = await applyKimiTideCommand({ kind: 'export-config' }, deps)
    expect(reply).toMatch(/不可读|不存在|尚未|not found/)
  })

  it('import-config: 文件形态走 v4 结构校验并直通', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const incoming = v4cfg('capability')
    const src = join(dir, 'import-src.yml')
    writeFileSync(src, YAML.stringify(incoming), 'utf8')
    const reply = await applyKimiTideCommand({ kind: 'import-config', path: src }, deps)
    expect(reply).toMatch(/import/i)
    expect(saved[0].activePreset).toBe('capability')
    expect(deps.current().activePreset).toBe('capability')
    expect(deps.sidecar.load().config!.activePreset).toBe('capability')
  })

  it('import-config: v4 文件结构不合格（presets 非对象）报错', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const src = join(dir, 'import-bad.yml')
    writeFileSync(src, 'version: 4\npresets: [1, 2]\n', 'utf8')
    const reply = await applyKimiTideCommand({ kind: 'import-config', path: src }, deps)
    expect(reply).toMatch(/import failed|失败/)
    expect(saved).toHaveLength(0)
  })

  it('import-config: 内联 YAML 合并 version 置 4', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const text = 'activePreset: saving'
    const reply = await applyKimiTideCommand({ kind: 'import-config', path: text }, deps)
    expect(reply).toMatch(/import/i)
    expect(saved[0].version).toBe(4)
    expect(saved[0].activePreset).toBe('saving')
    expect(deps.current().version).toBe(4)
  })

  it('refresh: triggers monitor.refresh and replies', async () => {
    const deps = makeDeps(v4cfg(null))
    const reply = await applyKimiTideCommand({ kind: 'refresh' }, deps)
    expect(deps.monitor.refresh).toHaveBeenCalledOnce()
    expect(reply).toMatch(/refresh/i)
  })

  it('surfaces sidecar save errors as a reply, not a throw', async () => {
    const deps = makeDeps(v4cfg(null))
    deps.sidecar.save = vi.fn(() => { throw new Error('schema rejected') }) as RouterSidecarStore['save']
    const reply = await applyKimiTideCommand(parseKimiTideCommand('preset saving'), deps)
    expect(reply).toContain('schema rejected')
  })
})

describe('applyKimiTideCommand with settings namespace', () => {
  it('preset writes through scope.update, not the sidecar', async () => {
    const writes: object[] = []
    const deps = makeDeps(v4cfg(null), undefined, {
      settings: {
        get: () => v4cfg(null),
        update: async (p) => { writes.push(p) },
        replace: async () => {},
      },
    })
    const saveSpy = vi.fn()
    deps.sidecar.save = saveSpy as RouterSidecarStore['save']
    const out = await applyKimiTideCommand(parseKimiTideCommand('preset capability'), deps)
    expect(writes).toEqual([{ ...v4cfg(null), activePreset: 'capability' }])
    expect(saveSpy).not.toHaveBeenCalled()
    expect(out).toContain('saved')
  })

  it('export-config prints the resolved namespace value as YAML', async () => {
    const deps = makeDeps(v4cfg(null), undefined, {
      settings: {
        get: () => v4cfg('saving'),
        update: async () => {},
        replace: async () => {},
      },
    })
    const out = await applyKimiTideCommand({ kind: 'export-config' }, deps)
    expect(out).toContain('activePreset: saving')
  })

  it('import-config (file) replaces the namespace section', async () => {
    const replaces: object[] = []
    const deps = makeDeps(v4cfg(null), undefined, {
      settings: {
        get: () => v4cfg(null),
        update: async () => {},
        replace: async (s) => { replaces.push(s) },
      },
    })
    const incoming = v4cfg('capability')
    const src = join(dir, 'import-src-ns.yml')
    writeFileSync(src, YAML.stringify(incoming), 'utf8')
    const out = await applyKimiTideCommand({ kind: 'import-config', path: src }, deps)
    expect(replaces).toEqual([incoming])
    expect(out).toMatch(/import/i)
  })

  it('falls back to sidecar when settings is null', async () => {
    const deps = makeDeps(v4cfg(null))
    const saveSpy = vi.fn()
    deps.sidecar.save = saveSpy as RouterSidecarStore['save']
    const out = await applyKimiTideCommand(parseKimiTideCommand('preset saving'), deps)
    expect(saveSpy).toHaveBeenCalled()
    expect(out).toContain('saved')
  })
})
