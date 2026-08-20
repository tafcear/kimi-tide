import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SettingsProvider, { settingsNamespace } from '@deepseek-ai/dsh-settings'
import YAML from 'yaml'
import { DEFAULT_ROUTER_CONFIG, apply, buildRouter, defaultPatchFile } from '../src/index.js'
import { DEFAULT_CONFIG_V3, type RouterConfigV3 } from '../src/config.js'
import { KIMI_TIDE_PANEL_EVENT } from '../src/projection.js'
import { routerConfigSchema } from '../src/settings-schema.js'

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
    expect(DEFAULT_ROUTER_CONFIG.premium.provider).toBe('kimi-coding')
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

/**
 * Task 4 — settings-namespace wiring.
 *
 * These tests drive apply() against the REAL dsh-settings provider (an
 * in-memory subclass on its own cordis Context), not a hand-written stub:
 * `register`/`update`/`replace`/`watch` semantics — including the layered
 * resolution and the merge rules that {@link SettingsNamespacePort} depends
 * on — are the library's, so the assertions lock the real contract instead of
 * a mock's imitation.
 */
const NS = settingsNamespace('kimi-tide-router')

function memorySettingsClass(seed: Record<string, unknown> = {}) {
  return class MemorySettings extends SettingsProvider {
    readonly writable = true
    doc: Record<string, unknown> = structuredClone(seed)
    protected async load(): Promise<Record<string, unknown>> { return structuredClone(this.doc) }
    protected async persist(ns: string, section: Record<string, unknown>): Promise<void> {
      this.doc[ns] = structuredClone(section)
    }
  }
}

interface MemoryProvider extends SettingsProvider { doc: Record<string, unknown> }

/** Boot a real settings provider with an optional pre-existing user document. */
async function bootSettings(seed: Record<string, unknown> = {}): Promise<MemoryProvider> {
  const root = new Context()
  await root.plugin(memorySettingsClass(seed) as never)
  return (root as unknown as { settings: MemoryProvider }).settings
}

interface FakeAgent { session: { append: ReturnType<typeof vi.fn> } }

/**
 * apply()'s host surface. `settings === undefined` reproduces a host with no
 * settings service: cordis never runs an `inject` callback whose dependency is
 * absent, so the sidecar fallback stays in charge.
 */
function makeCtx(agents: FakeAgent[], settings?: SettingsProvider) {
  const listeners = new Map<string, Array<(payload: unknown) => unknown>>()
  const settingsCleanups: Array<() => void> = []
  const listModelsCalls: string[] = []
  let commandDef: { name: string; handler: (invocation: { rawInput: string }) => Promise<unknown> } | undefined
  const effect = (execute: () => unknown) => {
    const cleanup = execute()
    return () => { void cleanup }
  }
  const ctx: Record<string, unknown> = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    llm: {
      registerAdapter: () => {},
      listProviders: () => [
        { id: 'kimi-coding', name: 'Kimi' },
        { id: 'deepseek-official', name: 'DeepSeek' },
      ],
      listModels: async (provider: string) => {
        listModelsCalls.push(provider)
        return provider === 'kimi-coding' ? [{ id: 'kimi-for-coding' }] : [{ id: 'deepseek-v4-flash' }]
      },
      resolveModelInfo: async (provider: string, model: string) => ({
        provider, id: model, name: model,
        inputModalities: provider === 'kimi-coding' ? ['text', 'image'] : ['text'],
      }),
    },
    commands: { register: (def: never) => { commandDef = def as never; return () => {} } },
    sessionProjections: { register: () => () => {} },
    setInterval: () => () => {},
    effect,
    on: (name: string, listener: (payload: unknown) => unknown) => {
      const arr = listeners.get(name) ?? []
      arr.push(listener)
      listeners.set(name, arr)
      return () => {}
    },
    get: (name: string) => (name === 'agents' ? { list: () => agents } : undefined),
  }
  ctx.inject = (_deps: string[], callback: (scoped: unknown) => unknown) => {
    if (settings === undefined) return
    callback({
      ...ctx,
      settings,
      effect: (execute: () => unknown) => {
        const cleanup = execute()
        if (typeof cleanup === 'function') settingsCleanups.push(cleanup as () => void)
        return () => { void cleanup }
      },
    })
  }
  return {
    ctx,
    listeners,
    listModelsCalls,
    getCommand: () => commandDef,
    /** Simulate the settings service going away (provider reload / disposal). */
    detachSettings: () => { for (const cleanup of settingsCleanups.splice(0)) cleanup() },
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('apply() settings namespace wiring (Task 4)', () => {
  let dir: string
  let patchFile: string
  let sidecarFile: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kimi-tide-settings-'))
    patchFile = join(dir, 'cordis.patch.yml')
    sidecarFile = join(dir, 'kimi-tide-router.yml')
    writeFileSync(patchFile, '- insert:\n    - id: some-other\n      config: { foo: 1 }\n', 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const lastSnapshot = (agent: FakeAgent): Record<string, unknown> =>
    agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>

  it('registers the kimi-tide-router namespace and reports configSource "settings"', async () => {
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()

    const descriptor = settings.describe().find((d) => d.ns === NS)
    expect(descriptor).toBeDefined()
    expect(getCommand()!.name).toBe('kimi-tide')
    expect(lastSnapshot(agent).configSource).toBe('settings')
    expect((descriptor!.value as RouterConfigV3).version).toBe(3)
  })

  /**
   * Ruling 10.1 — a save must reach the namespace. Forgetting to hand
   * `deps.settings` to registerKimiTideCommands degrades silently to the
   * sidecar, so this asserts both halves: the namespace received the write AND
   * no sidecar file appeared.
   */
  it('writes a save through the namespace and never falls back to the sidecar file', async () => {
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners, listModelsCalls, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()
    expect(listeners.get('agent/pre-step') ?? []).toHaveLength(0) // mode off: no router mounted
    const enumerationsBeforeSave = listModelsCalls.length

    await getCommand()!.handler({ rawInput: 'mode capability' })
    await tick()

    const stored = settings.doc[NS] as RouterConfigV3
    expect(stored.mode).toBe('capability')
    // Whole-table write (T3 persists deps.current() merged): not just { mode }.
    expect(stored.version).toBe(3)
    expect(stored.candidates.length).toBeGreaterThan(0)
    expect((settings.get(NS) as RouterConfigV3).mode).toBe('capability')
    expect(existsSync(sidecarFile)).toBe(false)
    // applyConfig ran: panel refreshed and the capability router was mounted.
    expect(lastSnapshot(agent).router).toMatchObject({ mode: 'capability' })
    expect(lastSnapshot(agent).configSource).toBe('settings')
    expect((listeners.get('agent/pre-step') ?? []).length).toBeGreaterThan(0)
    // One save = one candidate enumeration pass over the two whitelisted
    // providers. A save reaches applyConfig twice (the command's onSaved and
    // the namespace commit watcher); without the by-value guard both passes
    // would re-enumerate and re-mount.
    expect(listModelsCalls.length - enumerationsBeforeSave).toBe(2)
  })

  /** Ruling 10.2 — current() must track the namespace, not a frozen startup copy. */
  it('current() tracks the namespace so a later save merges over the earlier one', async () => {
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()

    await getCommand()!.handler({ rawInput: 'set lambda 0.7' })
    await getCommand()!.handler({ rawInput: 'mode cost' })

    const resolved = settings.get(NS) as RouterConfigV3
    expect(resolved.lambda).toBe(0.7)   // stale current() would write 0.5 back
    expect(resolved.mode).toBe('cost')
    expect(lastSnapshot(agent).router).toMatchObject({ mode: 'cost' })
  })

  /** T2 wiring: a legacy sidecar is imported into the namespace exactly once. */
  it('migrates an existing sidecar into the namespace and archives the file', async () => {
    const legacy: RouterConfigV3 = { ...DEFAULT_CONFIG_V3(), mode: 'capability', lambda: 0.9 }
    writeFileSync(sidecarFile, YAML.stringify(legacy), 'utf8')
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()

    expect((settings.get(NS) as RouterConfigV3).lambda).toBe(0.9)
    expect(existsSync(sidecarFile)).toBe(false)
    expect(existsSync(sidecarFile + '.legacy-imported')).toBe(true)
    // The migration commit re-applies the config: panel + router follow it.
    expect(lastSnapshot(agent).router).toMatchObject({ mode: 'capability' })
    expect(lastSnapshot(agent).configSource).toBe('settings')
  })

  /**
   * Review Minor (a591a0c6) — the migration's dirty check compares the resolved
   * namespace value against `mergeResolved(entry)`, so `entry` MUST be the same
   * v2-shaped base the namespace was registered with. Handing it the raw v1
   * composition entry (brief Step 3's literal `config.router ?? {}`) drops
   * primary/premium in mergeResolved, makes a clean namespace look dirty, and
   * silently skips the migration forever. This is that exact combination:
   * v1 entry + valid sidecar + clean namespace → 'imported'.
   */
  it('migrates the sidecar even when the composition entry is a v1 router block', async () => {
    const legacy: RouterConfigV3 = { ...DEFAULT_CONFIG_V3(), mode: 'capability', lambda: 0.8 }
    writeFileSync(sidecarFile, YAML.stringify(legacy), 'utf8')
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)

    apply(ctx as never, {
      patchFile,
      sidecarFile,
      usagePollOnStart: false,
      // v1 composition entry (0.2.x shape) — the case a raw `entry` breaks.
      router: {
        mode: 'cost',
        primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        premium: { provider: 'kimi-coding', model: 'kimi-for-coding' },
      },
    })
    await tick()

    // Imported: the sidecar's values won over the v1 seed and the file is archived.
    const resolved = settings.get(NS) as RouterConfigV3
    expect(resolved.lambda).toBe(0.8)
    expect(resolved.mode).toBe('capability')
    expect(settings.doc[NS]).toBeDefined()
    expect(existsSync(sidecarFile)).toBe(false)
    expect(existsSync(sidecarFile + '.legacy-imported')).toBe(true)
    expect(lastSnapshot(agent).router).toMatchObject({ mode: 'capability' })
    expect(lastSnapshot(agent).configSource).toBe('settings')
  })

  it('keeps a user-edited namespace and leaves the sidecar in place (dirty skip)', async () => {
    writeFileSync(sidecarFile, YAML.stringify({ ...DEFAULT_CONFIG_V3(), mode: 'cost' }), 'utf8')
    const settings = await bootSettings({ [NS]: { lambda: 0.31 } })
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()

    const resolved = settings.get(NS) as RouterConfigV3
    expect(resolved.lambda).toBe(0.31)
    expect(resolved.mode).toBe('off')            // sidecar's 'cost' was NOT imported
    expect(existsSync(sidecarFile)).toBe(true)   // left for manual /kimi-tide import-config
  })

  /**
   * The composition seed (entry config or the legacy patch static block) must
   * reach the namespace as its `base` layer, or a host that never touched the
   * panel would silently lose its configured routing targets.
   */
  it('layers the legacy patch static block under the namespace as base', async () => {
    writeFileSync(
      patchFile,
      '- insert:\n    - id: dsh-kimi-tide\n      config:\n        router:\n          mode: cost\n          primary: { provider: deepseek-official, model: deepseek-v4-flash }\n          premium: { provider: kimi-coding, model: kimi-for-coding }\n',
      'utf8',
    )
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()

    const resolved = settings.get(NS) as RouterConfigV3
    expect(resolved.mode).toBe('cost')
    expect(resolved.candidates).toEqual([{ provider: 'kimi-coding', model: 'kimi-for-coding' }])
    expect(lastSnapshot(agent).configSource).toBe('settings')
    expect(lastSnapshot(agent).router).toMatchObject({ mode: 'cost' })
  })

  it('uses the fixed kimi-coding base when there is no composition seed', async () => {
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()
    const resolved = settings.get(NS) as RouterConfigV3
    expect(resolved.candidates[0].provider).toBe('kimi-coding')
    expect(resolved.allowedProviders).toContain('kimi-coding')
  })

  it('falls back to the sidecar store when the settings service goes away', async () => {
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand, detachSettings } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()
    detachSettings()

    await getCommand()!.handler({ rawInput: 'mode cost' })

    expect(existsSync(sidecarFile)).toBe(true)
    expect(settings.doc[NS]).toBeUndefined()
    expect(lastSnapshot(agent).configSource).toBe('sidecar')
  })

  it('一次性迁移存量 v2 用户层（kimi-tide → kimi-coding，version 3，文档 .pre-v3 快照）', async () => {
    // 预置一个「用户编辑过」的 v2 命名空间节（0.3.0 面板写出来的形状）
    const seed = {
      [NS]: {
        version: 2, mode: 'capability',
        default: { provider: 'kimi-tide', model: 'k3' },
        candidates: [{ provider: 'kimi-tide', model: 'k3' }, { provider: 'deepseek-official', model: 'deepseek-v4-flash' }],
        allowedProviders: ['kimi-tide', 'deepseek-official'],
        scores: { 'kimi-tide/k3': { code: 4.7 } },
        classify: {}, costTiers: {}, routeThreshold: 0.75, lambda: 0.5, premiumBudget: 0.2, budgetWindow: 20, charsPerToken: 2,
      },
    }
    const settings = await bootSettings(seed)
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()

    const resolved = settings.get(NS) as RouterConfigV3
    expect(resolved.version).toBe(3)
    expect(resolved.default).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(resolved.allowedProviders).toEqual(['kimi-coding', 'deepseek-official'])
    expect(resolved.scores).toEqual({ 'kimi-coding/k3': { code: 4.7 } })
    // 用户编辑保留（非 dirty 跳过）；sidecar 不存在 → 无导入行为
    expect(existsSync(sidecarFile)).toBe(false)
  })

  it('干净的 v3 用户层不触发迁移（无替换写、无 .pre-v3 快照）', async () => {
    const settings = await bootSettings({ [NS]: { lambda: 0.31 } })
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()
    const resolved = settings.get(NS) as RouterConfigV3
    expect(resolved.version).toBe(3)
    expect(resolved.lambda).toBe(0.31)
  })
})

/**
 * Ruling 10.3 — T3 persists `/kimi-tide mode|set` through `scope.update(whole
 * table)`. dsh-settings' update is a LAYERED merge (plain objects recurse,
 * every other value replaces), so these tests pin the two behaviours the
 * command layer depends on, straight against the real provider.
 */
describe('settings namespace write semantics the command port relies on', () => {
  it('replaces array fields (candidates) wholesale on update', async () => {
    const settings = await bootSettings()
    const scope = settings.register(NS, routerConfigSchema as never, { base: {} })
    const base = DEFAULT_CONFIG_V3()

    await scope.update({
      ...base,
      candidates: [{ provider: 'kimi-coding', model: 'kimi-for-coding' }, { provider: 'deepseek-official', model: 'deepseek-v4-flash' }],
    })
    expect((scope.get() as RouterConfigV3).candidates).toHaveLength(2)

    await scope.update({ ...base, candidates: [{ provider: 'kimi-coding', model: 'kimi-for-coding' }] })
    // Element-wise merge would leave the dropped candidate behind.
    expect((scope.get() as RouterConfigV3).candidates).toEqual([{ provider: 'kimi-coding', model: 'kimi-for-coding' }])
  })

  it('merges dict fields (scores) on update, so removal needs replace', async () => {
    const settings = await bootSettings()
    const scope = settings.register(NS, routerConfigSchema as never, { base: {} })
    const base = DEFAULT_CONFIG_V3()

    await scope.update({ ...base, scores: { 'kimi-coding/kimi-for-coding': { code: 5 } } })
    await scope.update({ ...base, scores: {} })
    expect((scope.get() as RouterConfigV3).scores).toEqual({ 'kimi-coding/kimi-for-coding': { code: 5 } })

    await scope.replace({ ...base, scores: {} })
    expect((scope.get() as RouterConfigV3).scores).toEqual({})
  })
})
