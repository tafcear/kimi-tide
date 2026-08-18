import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, defaultSidecarFile, defaultPatchFile } from '../src/index.js'
import { KIMI_TIDE_PANEL_EVENT } from '../src/projection.js'

/**
 * Regression: saving router settings rewrites the watched cordis.patch.yml,
 * which makes the loader RE-APPLY the plugin; agent/created does not re-fire
 * for already-live agents, so a re-applied instance used to push panel
 * updates to an empty roster (mode-button desync). apply() must seed its
 * roster from the live agent registry (ctx.agents.list()).
 *
 * 0.3.0 (Task 8): the panel snapshot is projection v2 — configSource,
 * candidates enumerated from the llm service (provider-agnostic), and the
 * router persists to the sidecar file instead of the patch file.
 */

interface FakeAgent { session: { append: ReturnType<typeof vi.fn> } }

function makeCtx(agents: FakeAgent[]) {
  const listeners = new Map<string, Array<(payload: unknown) => unknown>>()
  let commandDef: { name: string; handler: (invocation: { rawInput: string }) => Promise<unknown> } | undefined
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    llm: {
      registerAdapter: () => {},
      // Provider-agnostic catalog: the whitelist decides what becomes a candidate.
      listProviders: () => [
        { id: 'kimi-tide', name: 'Kimi' },
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'other-provider', name: 'Other' },
      ],
      listModels: async (provider: string) =>
        provider === 'kimi-tide'
          ? [{ id: 'kimi-for-coding' }]
          : provider === 'deepseek-official'
            ? [{ id: 'deepseek-v4-flash' }]
            : [{ id: 'other-model' }],
      // Real API name is resolveModelInfo; mirrors the real return shape.
      resolveModelInfo: async (provider: string, model: string) => ({
        provider,
        id: model,
        name: model,
        inputModalities: provider === 'kimi-tide' ? ['text', 'image'] : ['text'],
      }),
    },
    commands: { register: (def: never) => { commandDef = def as never; return () => {} } },
    sessionProjections: { register: () => () => {} },
    setInterval: () => () => {},
    effect: (execute: () => unknown) => {
      const cleanup = execute()
      return () => { void cleanup }
    },
    on: (name: string, listener: (payload: unknown) => unknown) => {
      const arr = listeners.get(name) ?? []
      arr.push(listener)
      listeners.set(name, arr)
      return () => {}
    },
    get: (name: string) => (name === 'agents' ? { list: () => agents } : undefined),
  }
  return { ctx, listeners, getCommand: () => commandDef }
}

describe('apply() panel roster', () => {
  let dir: string
  let patchFile: string
  let sidecarFile: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kimi-tide-apply-'))
    patchFile = join(dir, 'cordis.patch.yml')
    sidecarFile = join(dir, 'kimi-tide-router.yml')
    writeFileSync(patchFile, '- insert:\n    - id: some-other\n      config: { foo: 1 }\n', 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('seeds the roster from ctx.agents on (re)apply and pushes the panel to them', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false, refreshOnStart: false })

    // Seeded on apply: the live agent got the initial panel snapshot.
    expect(agent.session.append).toHaveBeenCalledWith(KIMI_TIDE_PANEL_EVENT, expect.objectContaining({
      router: expect.objectContaining({ mode: 'off' }),
    }))

    // A settings save (the loader would now re-apply us; the roster must
    // already be functional on THIS instance) pushes the new mode.
    const command = getCommand()
    expect(command).toBeDefined()
    agent.session.append.mockClear()
    await command!.handler({ rawInput: 'mode cost' })
    expect(agent.session.append).toHaveBeenCalledWith(KIMI_TIDE_PANEL_EVENT, expect.objectContaining({
      router: expect.objectContaining({ mode: 'cost' }),
    }))
  })

  it('still tracks agents created after apply', async () => {
    const { ctx, listeners } = makeCtx([])
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false, refreshOnStart: false })
    const late: FakeAgent = { session: { append: vi.fn() } }
    for (const listener of listeners.get('agent/created') ?? []) listener({ agent: late })
    expect(late.session.append).toHaveBeenCalled()
  })
})

describe('apply() projection v2 + sidecar wiring (0.3.0)', () => {
  let dir: string
  let patchFile: string
  let sidecarFile: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kimi-tide-v2-'))
    patchFile = join(dir, 'cordis.patch.yml')
    sidecarFile = join(dir, 'kimi-tide-router.yml')
    writeFileSync(patchFile, '- insert:\n    - id: some-other\n      config: { foo: 1 }\n', 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('pushes a snapshot with configSource and enumerated candidates', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false, refreshOnStart: false })
    // Candidate enumeration is async (llm.listModels/resolveModelInfo).
    await new Promise((resolve) => setTimeout(resolve, 20))

    const snapshot = agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(snapshot.configSource).toBe('default')
    const candidates = snapshot.candidates as Array<{ provider: string; model: string; available: boolean }>
    expect(candidates).toContainEqual(expect.objectContaining({ provider: 'kimi-tide', model: 'kimi-for-coding' }))
    expect(candidates).toContainEqual(expect.objectContaining({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }))
    // Whitelist (allowedProviders) excludes unlisted providers.
    expect(candidates.some((c) => c.provider === 'other-provider')).toBe(false)
  })

  it('reports configSource patch when the legacy patch router block is the only config', async () => {
    writeFileSync(
      patchFile,
      '- insert:\n    - id: dsh-kimi-tide\n      config:\n        router:\n          mode: cost\n          primary: { provider: deepseek-official, model: deepseek-v4-flash }\n          premium: { provider: kimi-tide, model: kimi-for-coding }\n',
      'utf8',
    )
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false, refreshOnStart: false })

    const snapshot = agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(snapshot.configSource).toBe('patch')
    expect(snapshot.router).toMatchObject({ mode: 'cost' })
  })

  it('save writes the sidecar file and the second push carries the new mode', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false, refreshOnStart: false })
    expect(existsSync(sidecarFile)).toBe(false)

    agent.session.append.mockClear()
    const command = getCommand()
    await command!.handler({ rawInput: 'mode capability' })

    expect(existsSync(sidecarFile)).toBe(true)
    const snapshot = agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(snapshot.router).toMatchObject({ mode: 'capability' })
    expect(snapshot.configSource).toBe('sidecar')
  })
})

describe('defaultSidecarFile', () => {
  const original = process.env.DSH_HOME
  afterEach(() => {
    if (original === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = original
  })

  it('sits next to the patch file as kimi-tide-router.yml', () => {
    process.env.DSH_HOME = '/tmp/dsh-test'
    expect(defaultSidecarFile()).toBe(join(dirname(defaultPatchFile()), 'kimi-tide-router.yml'))
    expect(defaultSidecarFile().replace(/\\/g, '/')).toBe('/tmp/dsh-test/profiles/web/kimi-tide-router.yml')
  })
})
