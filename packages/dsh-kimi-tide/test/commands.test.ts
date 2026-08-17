import { describe, expect, it, vi } from 'vitest'
import { applyKimiTideCommand, parseKimiTideCommand, type KimiTideCommandDeps } from '../src/commands.js'
import type { RouterConfig } from '../src/router.js'
import type { RouterSettingsStore } from '../src/settings.js'
import type { UsageMonitor } from '../src/usage.js'

const BASE: RouterConfig = {
  mode: 'off',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
}

function makeDeps(saved: RouterConfig[] = []): KimiTideCommandDeps {
  return {
    store: { save: vi.fn((c: RouterConfig) => saved.push(c)) } as unknown as RouterSettingsStore,
    monitor: { refresh: vi.fn(async () => {}) } as unknown as UsageMonitor,
    current: () => BASE,
    onSaved: vi.fn(),
  }
}

describe('parseKimiTideCommand', () => {
  it('parses mode subcommand', () => {
    expect(parseKimiTideCommand('mode cost')).toEqual({ kind: 'mode', mode: 'cost' })
    expect(parseKimiTideCommand('mode off')).toEqual({ kind: 'mode', mode: 'off' })
  })
  it('rejects invalid mode', () => {
    expect(parseKimiTideCommand('mode bogus').kind).toBe('error')
  })
  it('parses set subcommand with number/boolean coercion', () => {
    expect(parseKimiTideCommand('set premiumBudget 0.3')).toEqual({ kind: 'set', key: 'premiumBudget', value: 0.3 })
    expect(parseKimiTideCommand('set escalateWhen.estimatedTokensGt 90000')).toEqual({ kind: 'set', key: 'escalateWhen.estimatedTokensGt', value: 90000 })
    expect(parseKimiTideCommand('set escalateWhen.explicit false')).toEqual({ kind: 'set', key: 'escalateWhen.explicit', value: false })
  })
  it('parses refresh and empty/help', () => {
    expect(parseKimiTideCommand('refresh')).toEqual({ kind: 'refresh' })
    expect(parseKimiTideCommand('')).toEqual({ kind: 'help' })
    expect(parseKimiTideCommand('help')).toEqual({ kind: 'help' })
  })
  it('errors on unknown subcommand', () => {
    expect(parseKimiTideCommand('frobnicate').kind).toBe('error')
  })
})

describe('applyKimiTideCommand', () => {
  it('mode: merges into current config, saves, fires onSaved', async () => {
    const saved: RouterConfig[] = []
    const deps = makeDeps(saved)
    const reply = await applyKimiTideCommand({ kind: 'mode', mode: 'cost' }, deps)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toEqual({ ...BASE, mode: 'cost' })
    expect(deps.onSaved).toHaveBeenCalledWith(saved[0])
    expect(reply).toContain('cost')
  })

  it('set: applies dotted key and persists', async () => {
    const saved: RouterConfig[] = []
    const deps = makeDeps(saved)
    await applyKimiTideCommand({ kind: 'set', key: 'premiumBudget', value: 0.5 }, deps)
    expect(saved[0].premiumBudget).toBe(0.5)
  })

  it('set: rejects unknown keys at parse time (error kind reaches apply as message)', async () => {
    const deps = makeDeps()
    const cmd = parseKimiTideCommand('set hacker 1')
    expect(cmd.kind).toBe('error')
    const reply = await applyKimiTideCommand(cmd, deps)
    expect(reply).toMatch(/unknown/i)
    expect(deps.store.save).not.toHaveBeenCalled()
  })

  it('refresh: triggers monitor.refresh and replies', async () => {
    const deps = makeDeps()
    const reply = await applyKimiTideCommand({ kind: 'refresh' }, deps)
    expect(deps.monitor.refresh).toHaveBeenCalledOnce()
    expect(reply).toMatch(/refresh/i)
  })

  it('surfaces store validation errors as a reply, not a throw', async () => {
    const deps = makeDeps()
    deps.store.save = vi.fn(() => { throw new Error('schema rejected') }) as unknown as RouterSettingsStore['save']
    const reply = await applyKimiTideCommand({ kind: 'mode', mode: 'cost' }, deps)
    expect(reply).toContain('schema rejected')
    expect(deps.onSaved).not.toHaveBeenCalled()
  })
})
