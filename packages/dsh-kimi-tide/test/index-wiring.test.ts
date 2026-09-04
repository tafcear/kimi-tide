import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SettingsProvider, { settingsNamespace } from '@deepseek-ai/dsh-settings'
import YAML from 'yaml'
import { apply, defaultPatchFile } from '../src/index.js'
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, DEFAULT_FLOWS, type RouterConfigV4, type RouterConfigV5 } from '../src/config.js'

function v4cfg(activePreset: string | null): RouterConfigV4 {
  return { ...DEFAULT_CONFIG_V4(), activePreset }
}

function v5cfg(activePreset: string | null): RouterConfigV5 {
  return { ...DEFAULT_CONFIG_V5(), activePreset }
}

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

/**
 * Task 4 — settings-namespace wiring (0.5.0 v4).
 *
 * These tests drive apply() against the REAL dsh-settings provider (an
 * in-memory subclass on its own cordis Context), not a hand-written stub.
 */
const NS = settingsNamespace('kimi-tide-router')

function memorySettingsClass(seed: Record<string, unknown> = {}, documentPath?: string) {
  return class MemorySettings extends SettingsProvider {
    readonly writable = true
    // 实机 documentPath（settings.yaml 路径）的内存替身：驱动迁移留档（.pre-v5）落盘断言。
    readonly documentPath = documentPath
    doc: Record<string, unknown> = structuredClone(seed)
    protected async load(): Promise<Record<string, unknown>> { return structuredClone(this.doc) }
    protected async persist(ns: string, section: Record<string, unknown>): Promise<void> {
      this.doc[ns] = structuredClone(section)
    }
  }
}

interface MemoryProvider extends SettingsProvider { doc: Record<string, unknown> }

/** Boot a real settings provider with an optional pre-existing user document. */
async function bootSettings(seed: Record<string, unknown> = {}, documentPath?: string): Promise<MemoryProvider> {
  const root = new Context()
  await root.plugin(memorySettingsClass(seed, documentPath) as never)
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
  let commandDef: { name: string; handler: (invocation: { rawInput: string; agent?: unknown }) => Promise<unknown> } | undefined
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
        // 目录含 rc.2 的 vision-exp（0.6.0 预置转述流的默认视觉模型）。
        return provider === 'kimi-coding'
          ? [{ id: 'kimi-for-coding' }]
          : [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-flash-vision-exp' }]
      },
      resolveModelInfo: async (provider: string, model: string) => ({
        provider, id: model, name: model,
        inputModalities: provider === 'kimi-coding' || model === 'deepseek-v4-flash-vision-exp' ? ['text', 'image'] : ['text'],
      }),
      // 生产 VisionCaller 缝（createStreamVisionCaller）的内存替身：text-delta + finish。
      stream: async function* () {
        yield { type: 'text-delta', index: 0, text: '转述文字' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
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
    expect((descriptor!.value as RouterConfigV5).version).toBe(5)
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
    expect(listeners.get('agent/pre-step') ?? []).toHaveLength(0) // activePreset null: no router mounted
    const enumerationsBeforeSave = listModelsCalls.length

    await getCommand()!.handler({ rawInput: 'preset capability' })
    await tick()

    const stored = settings.doc[NS] as RouterConfigV5
    expect(stored.activePreset).toBe('capability')
    expect(stored.version).toBe(5)
    expect(Object.keys(stored.presets).length).toBeGreaterThan(0)
    expect((settings.get(NS) as RouterConfigV4).activePreset).toBe('capability')
    expect(existsSync(sidecarFile)).toBe(false)
    // applyConfig ran: panel refreshed and the capability router was mounted.
    expect(lastSnapshot(agent).router).toMatchObject({ activePreset: 'capability' })
    expect(lastSnapshot(agent).configSource).toBe('settings')
    expect((listeners.get('agent/pre-step') ?? []).length).toBeGreaterThan(0)
    // One save = one candidate enumeration pass over the two providers.
    // A save reaches applyConfig twice (the command's onSaved and the
    // namespace commit watcher); without the by-value guard both passes would
    // re-enumerate and re-mount.
    expect(listModelsCalls.length - enumerationsBeforeSave).toBe(2)
  })

  /** Ruling 10.2 — current() must track the namespace, not a frozen startup copy. */
  it('current() tracks the namespace so a later save keeps the previous preset change', async () => {
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()

    await getCommand()!.handler({ rawInput: 'preset saving' })
    await getCommand()!.handler({ rawInput: 'preset capability' })

    const resolved = settings.get(NS) as RouterConfigV4
    expect(resolved.activePreset).toBe('capability')   // second save wins
    expect(lastSnapshot(agent).router).toMatchObject({ activePreset: 'capability' })
  })

  /** T2 wiring: a legacy sidecar is imported into the namespace exactly once. */
  it('migrates an existing sidecar into the namespace and archives the file', async () => {
    const legacy: RouterConfigV4 = v4cfg('capability')
    writeFileSync(sidecarFile, YAML.stringify(legacy), 'utf8')
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()

    expect((settings.get(NS) as RouterConfigV4).activePreset).toBe('capability')
    expect(existsSync(sidecarFile)).toBe(false)
    expect(existsSync(sidecarFile + '.legacy-imported')).toBe(true)
    expect(lastSnapshot(agent).router).toMatchObject({ activePreset: 'capability' })
    expect(lastSnapshot(agent).configSource).toBe('settings')
  })

  it('migrates the sidecar even when the composition entry is a v1 router block', async () => {
    const legacy: RouterConfigV4 = v4cfg('capability')
    writeFileSync(sidecarFile, YAML.stringify(legacy), 'utf8')
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)

    apply(ctx as never, {
      patchFile,
      sidecarFile,
      usagePollOnStart: false,
      // v1 composition entry (0.2.x shape).
      router: {
        mode: 'cost',
        primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        premium: { provider: 'kimi-coding', model: 'kimi-for-coding' },
      },
    })
    await tick()

    const resolved = settings.get(NS) as RouterConfigV4
    expect(resolved.activePreset).toBe('capability')
    expect(settings.doc[NS]).toBeDefined()
    expect(existsSync(sidecarFile)).toBe(false)
    expect(existsSync(sidecarFile + '.legacy-imported')).toBe(true)
    expect(lastSnapshot(agent).router).toMatchObject({ activePreset: 'capability' })
    expect(lastSnapshot(agent).configSource).toBe('settings')
  })

  it('keeps a user-edited namespace and leaves the sidecar in place (dirty skip)', async () => {
    writeFileSync(sidecarFile, YAML.stringify(v4cfg('saving')), 'utf8')
    const settings = await bootSettings({ [NS]: { activePreset: 'capability' } })
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()

    const resolved = settings.get(NS) as RouterConfigV4
    expect(resolved.activePreset).toBe('capability')   // user edit kept
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

    const resolved = settings.get(NS) as RouterConfigV4
    expect(resolved.activePreset).toBe('saving')   // mode cost → saving preset
    expect(lastSnapshot(agent).configSource).toBe('settings')
    expect(lastSnapshot(agent).router).toMatchObject({ activePreset: 'saving' })
  })

  it('uses the built-in default presets when there is no composition seed', async () => {
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()
    const resolved = settings.get(NS) as RouterConfigV4
    expect(resolved.activePreset).toBeNull()
    expect(resolved.presets.saving).toBeDefined()
    expect(resolved.presets.capability.default.provider).toBe('kimi-coding')
  })

  it('falls back to the sidecar store when the settings service goes away', async () => {
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand, detachSettings } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()
    detachSettings()

    await getCommand()!.handler({ rawInput: 'preset saving' })

    expect(existsSync(sidecarFile)).toBe(true)
    expect(settings.doc[NS]).toBeUndefined()
    expect(lastSnapshot(agent).configSource).toBe('sidecar')
  })

  it('一次性迁移存量 v2 用户层（kimi-tide → kimi-coding → v5，0.6.0 链）', async () => {
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

    const resolved = settings.get(NS) as RouterConfigV5
    expect(resolved.version).toBe(5)
    expect(resolved.activePreset).toBe('capability')
    expect(resolved.presets.capability.default).toEqual({ provider: 'kimi-coding', model: 'k3' })
    // 预置流注册但不绑定：既有规则目标逐字保持（无 flow 引用，全是模型目标）
    expect(resolved.flows.transcribe?.type).toBe('transcribe')
    expect(resolved.flows.review?.type).toBe('review')
    for (const rule of resolved.presets.capability.rules) expect(rule.target).toHaveProperty('provider')
    // sidecar 不存在 → 无导入行为
    expect(existsSync(sidecarFile)).toBe(false)
  })

  it('无显式 version 的用户层不触发迁移（随 v5 base 解析，无替换写、无留档）', async () => {
    const settings = await bootSettings({ [NS]: { activePreset: 'saving' } })
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()
    const resolved = settings.get(NS) as RouterConfigV5
    expect(resolved.version).toBe(5)
    expect(resolved.activePreset).toBe('saving')
    // 无残留 → 不调 replace → 无写入发生：doc 仍等于预置 seed
    expect(settings.doc[NS]).toEqual({ activePreset: 'saving' })
  })

  it('v4 存量命名空间启动迁移到 v5：行为逐字保持 + 预置流注册不绑定 + .pre-v5 留档', async () => {
    const legacy = v4cfg('saving')
    const docFile = join(dir, 'settings.yaml')
    writeFileSync(docFile, '# 用户设置文档替身（内存 provider 的 documentPath）\n', 'utf8')
    const settings = await bootSettings({ [NS]: legacy }, docFile)
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()

    const resolved = settings.get(NS) as RouterConfigV5
    expect(resolved.version).toBe(5)
    expect(resolved.activePreset).toBe('saving')
    // 行为保持：presets/keywordGroups 逐字保留（不自动改挂流、不注入 imageFallback）
    expect(resolved.presets).toEqual(legacy.presets)
    expect(resolved.keywordGroups).toEqual(legacy.keywordGroups)
    // 预置流注册但不绑定
    expect(resolved.flows.transcribe?.visionModel.model).toBe('deepseek-v4-flash-vision-exp')
    expect(resolved.presets.saving.rules[0].target).toEqual({ provider: 'kimi-coding', model: 'k3' })
    // 持久化替换 + 文档留档 .pre-v5
    expect((settings.doc[NS] as RouterConfigV5).version).toBe(5)
    expect(existsSync(docFile + '.pre-v5')).toBe(true)
  })

  it('v5 流接线：eager 转述成功 → 面板推送 imageContext 三态计数与 lastFlowEvent', async () => {
    // saving 预设的带图规则改挂预置 transcribe 流（用户经设置页操作后的形态）
    const v5 = v5cfg('saving')
    v5.presets.saving.rules[0] = { id: 'image-transcribe', when: { kind: 'image' }, target: { flow: 'transcribe' } }
    const settings = await bootSettings({ [NS]: v5 })
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners } = makeCtx([agent], settings)

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()
    // 无图会话不写 imageContext 字段（三零计数 ≠ 缺席）
    expect(lastSnapshot(agent)).not.toHaveProperty('imageContext')
    expect(lastSnapshot(agent)).not.toHaveProperty('lastFlowEvent')

    // 候选枚举完成后路由器重挂（fake ctx 的 disposer 是空操作，旧监听器仍在
    // map 里）——取末位 = 持全量目录（含 vision-exp）的现行路由器。
    const step = listeners.get('agent/pre-step')?.at(-1)
    expect(step).toBeDefined()
    await (step as (p: unknown, next: () => Promise<unknown>) => Promise<unknown>)(
      {
        agent,
        messages: [{ role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'att-1' } }] } as never],
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
      },
      () => Promise.resolve({ kind: 'enter' }),
    )

    const snapshot = lastSnapshot(agent)
    // eager 转述成功：图标 transcribed，终决策落预设默认文本模型
    expect(snapshot.imageContext).toEqual({ native: 0, transcribed: 1, blind: 0 })
    expect(snapshot.lastFlowEvent).toContain('flow:transcribe')
    expect(snapshot.lastFlowEvent).toContain('deepseek-official/deepseek-v4-flash')
  })
})

describe('review 命令与 show 认领行 wiring（Task 6，spec §8）', () => {
  let dir: string
  let patchFile: string
  let sidecarFile: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kimi-tide-rf-wire-'))
    patchFile = join(dir, 'cordis.patch.yml')
    sidecarFile = join(dir, 'kimi-tide-router.yml')
    writeFileSync(patchFile, '- insert:\n    - id: some-other\n      config: { foo: 1 }\n', 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  /** v5 认领形态：review 流 trigger=keywords 且 keywordGroup='review'（Task 1 夹具同款）。 */
  const claimedCfg = (): RouterConfigV5 => {
    const flows = DEFAULT_FLOWS()
    flows.review = { ...flows.review, trigger: 'keywords', keywordGroup: 'review' }
    const cfg = v5cfg('capability')
    cfg.flows = flows
    return cfg
  }

  it('review 命令：路由开 → invocation.agent 直达 manualReviewFn；路由关 → 未挂载文案', async () => {
    const settings = await bootSettings()
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()
    const command = getCommand()!
    // handler 返回 CommandResult {kind, text}——取 text 断言回显。
    const echo = async (rawInput: string) => {
      const r = await command.handler({ rawInput, agent }) as { kind: string; text?: string }
      return r.text ?? ''
    }

    // 路由关（activePreset=null → installRouter 未挂载 → manualReviewFn=null）：
    // index 兜底文案，非抛错。
    const off = await echo('review')
    expect(off).toContain('评审流未挂载（路由关闭中）')

    // 路由开：manualReviewFn 挂载；该 agent 无 lastTurn 缓存 → Task 5 runner 语义
    // 返回「无可评审的上一轮」（命令回显透传，证明 agent 参数抵达了 per-agent fn）。
    await command.handler({ rawInput: 'preset capability' })
    await tick()
    const on = await echo('review')
    expect(on).toContain('无可评审的上一轮')
  })

  it('show 认领行读实时配置（getter）——解认领后行消失，非注册时快照', async () => {
    const settings = await bootSettings({ [NS]: claimedCfg() })
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await tick()
    const command = getCommand()!
    const show = async () => {
      const r = await command.handler({ rawInput: 'show' }) as { kind: string; text?: string }
      return r.text ?? ''
    }

    const claimed = await show()
    expect(claimed).toContain('评审流认领组：review')
    expect(claimed).toContain('命中词不再整轮切模型，轮末自动评审')

    // 实时性：内联合并补丁把 review 流改回 trigger=manual → 无认领 → 行消失。
    await command.handler({ rawInput: 'import-config flows:\n  review:\n    trigger: manual' })
    await tick()
    expect(await show()).not.toContain('认领')
  })
})
