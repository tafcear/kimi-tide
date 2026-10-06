import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import YAML from 'yaml'
import { apply, Config, defaultPatchFile } from '../src/index.js'
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
 * 0.1.7 设置通道接线（2026-09-28 换道）。
 *
 * 旧 harness 驱动的是真实 dsh-settings provider（`ctx.settings.register` 命名空间），
 * 该 API 在 0.1.7 已整体移除。现行架构：路由配置是本条目 Config 的 **volatile**
 * `router` 字段（`export const Config` 声明），读 `ctx.config.router.get()`、
 * 写 `configEditor.edit(entry, …)`、变更通知 `loader/volatile-update`。
 *
 * 本 harness 因此改为「宿主侧三件事」的内存替身，并**复用真实 Config schema** 做
 * 解析——这样「默认值从 DEFAULT_CONFIG_V5 派生」「写回再解析幂等」等约束仍被真实
 * 校验，而不是被替身放宽：
 *   1. `doc`：profile patch 里的 raw config（ConfigEditor 的落点）；
 *   2. `resolve()`：Config(schema) 解析 → 冻结快照（模拟 Loader 的解析 + Volatile）；
 *   3. `edit()`：写 doc + 重解析 + 发 `loader/volatile-update`（模拟 ConfigEditor.edit）。
 */
const WRITE_OPTS = () => ({ patchFile: '', sidecarFile: '', usagePollOnStart: false })

interface FakeSettings {
  doc: { router?: unknown }
  /** 兼容旧断言写法：读路由配置快照。 */
  get(): RouterConfigV5
  /** 直接落一份 raw 路由配置（等价于用户在别处改了 profile patch）。 */
  setRouter(next: unknown): void
  documentPath?: string
  writable: boolean
}

/** 解析 raw router → 冻结快照（Config 的真实解析，含默认值填充）。 */
const resolveRouter = (raw: unknown): RouterConfigV5 => {
  const resolved = Config({ router: raw ?? {} }) as { router: { get(): RouterConfigV5 } }
  return structuredClone(resolved.router.get())
}

function makeSettings(seedRouter: unknown, documentPath?: string): FakeSettings {
  const state: FakeSettings = {
    doc: seedRouter === undefined ? {} : { router: seedRouter },
    get: () => resolveRouter(state.doc.router),
    setRouter: (next: unknown) => { state.doc.router = next },
    writable: true,
    ...(documentPath === undefined ? {} : { documentPath }),
  }
  return state
}

/** 条目的**原始** config（= profile patch 里的原文）：脏检查读的正是这里。 */
function entryOptionsFor(router: unknown): { options: { id: string; config?: unknown } } {
  return { options: { id: 'dsh-kimi-tide', ...(router === undefined ? {} : { config: { router } }) } }
}

interface FakeAgent { session: { append: ReturnType<typeof vi.fn> } }

/**
 * apply() 的宿主面替身。设置通道必备的四个面：`fiber.entry`、`get('configEditor')`、
 * `config.router`（volatile）、`on('loader/volatile-update')`。
 * `settings === undefined` ⇒ 不挂 configEditor ⇒ 复现「无设置通道的宿主」，
 * port 为 null、sidecar 回退接管（旧 harness 的 detach 语义）。
 */
function makeCtx(agents: FakeAgent[], settings?: FakeSettings) {
  const listeners = new Map<string, Array<(payload: unknown) => unknown>>()
  const effects: Array<() => void> = []
  const listModelsCalls: string[] = []
  // ctx.skills 替身（Task 3 / R3 门控断言用）：记录注册与释放，不真挂目录。
  const skillDisposers: Array<ReturnType<typeof vi.fn>> = []
  const skillRegister = vi.fn((skill: { name: string }) => {
    const dispose = vi.fn()
    skillDisposers.push(dispose)
    void skill
    return dispose
  })
  let commandDef: { name: string; handler: (invocation: { rawInput: string; agent?: unknown }) => Promise<unknown> } | undefined
  const effect = (execute: () => unknown) => {
    const cleanup = execute()
    if (typeof cleanup === 'function') effects.push(cleanup as () => void)
    return () => { void cleanup }
  }
  // volatile 快照（冻结）+ 每次解析后重绑，模拟 Loader 提交后重新解析。
  // ⚠ 必须是「带 .get() 的 Volatile」形状：生产里 apply(ctx, config) 的 config.router
  // 就是它（干跑树实测 ctor=Object 且带 get），port 的可用性判定读的正是这个形状。
  // 快照取**原始** seed（未解析）：与生产一致——插件自己经 coerce/merge 链解读，
  // 而不是拿宿主解析产物当配置（那会让 readRouterConfig 直接返回解析值，丢掉迁移语义）。
  let snapshot: unknown = settings?.doc.router ?? {}
  const routerVolatile = { get: () => snapshot }
  harnessRouterVolatile = routerVolatile
  const pluginConfig = () => ({ router: routerVolatile })
  const entry = entryOptionsFor(settings?.doc.router)
  const configEditor = settings === undefined
    ? undefined
    : {
        documentPath: settings.documentPath,
        edit: async (_entry: unknown, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>) => {
          const next = change(structuredClone(settings.doc.router ?? {}), {})
          settings.doc.router = next.router
          snapshot = resolveRouter(settings.doc.router)
          for (const listener of listeners.get('loader/volatile-update') ?? []) listener([])
        },
      }
  const ctx: Record<string, unknown> = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    fiber: { entry },
    config: pluginConfig(),
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
    skills: { register: skillRegister },
    sessionProjections: { register: () => () => {} },
    setInterval: () => () => {},
    effect,
    on: (name: string, listener: (payload: unknown) => unknown) => {
      const arr = listeners.get(name) ?? []
      arr.push(listener)
      listeners.set(name, arr)
      return () => {}
    },
    get: (name: string) => {
      if (name === 'agents') return { list: () => agents }
      if (name === 'configEditor') return configEditor
      // 可选宿主服务（acceptance-fix-1）：与生产 cordis 的 ctx.get 同语义——按名
      // 现查 store（调用时读，而非注册时快照），测试可在 apply 前往 ctx 挂
      // agentTeams 替身，或在 apply 后挂以模拟「晚挂载」。
      if (name === 'skills' || name === 'agentTeams') return ctx[name]
      return undefined
    },
  }
  return {
    ctx,
    listeners,
    listModelsCalls,
    skillRegister,
    skillDisposers,
    getCommand: () => commandDef,
    /** 模拟设置通道消失（条目移出 profile / configEditor 卸载）。 */
    detachSettings: () => { for (const cleanup of effects.splice(0)) cleanup() },
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

/**
 * apply() 第二参的构造器：把测试传入的 router 包成 **Volatile**（`.get()` 快照），
 * 与生产一致（干跑树实测：`apply(ctx, config)` 的 `config.router` 是带 get 的 volatile）。
 * 不包的话 port 会判「Config 未声明 volatile router」而整条降级到 sidecar——那是旧宿主
 * 的路径，不是本 harness 要覆盖的场景。
 */
let harnessRouterVolatile: { get: () => unknown } | null = null

function withRouter(base: Record<string, unknown>): Record<string, unknown> {
  // 优先级：base.router 已带 .get（显式 volatile）> base.router 是种子（包一层）>
  // 用 harness 侧 volatile（= ctx.config.router 的同一实例，写入后能看到新快照）。
  const explicit = (base.router as { get?: () => unknown } | undefined)?.get
  const volatile = typeof explicit === 'function'
    ? (base.router as { get: () => unknown })
    : base.router !== undefined
      ? { get: () => base.router }
      : (harnessRouterVolatile ?? { get: () => ({}) })
  return { ...base, router: volatile }
}

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

  /**
   * v1.2.0 会话事件解耦：面板快照不再经
   * `agent.session.append('kimi-tide/panel', …)` 落会话日志，改由
   * `/kimi-tide panel --json` 命令通道按需供给（dock 拉模型取数）。
   * 断言语义不变——读的仍是同一份 `KimiTidePanelProjection`，只是换了出口。
   */
  const lastSnapshot = async (
    getCommand: () => { handler: (invocation: { rawInput: string; agent?: unknown }) => Promise<unknown> } | undefined,
    agent: FakeAgent,
  ): Promise<Record<string, unknown>> => {
    const command = getCommand()
    expect(command).toBeDefined()
    const result = await command!.handler({ rawInput: 'panel --json', agent }) as { kind: string; text: string }
    return JSON.parse(result.text) as Record<string, unknown>
  }

  it('registers the plugin config as the settings channel and reports configSource "settings"', async () => {
    const settings = makeSettings(undefined)
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()

    expect(getCommand()!.name).toBe('kimi-tide')
    expect((await lastSnapshot(getCommand, agent)).configSource).toBe('settings')
    expect(settings.get().version).toBe(6)
  })

  /**
   * Ruling 10.1 — a save must reach the plugin config. Forgetting to hand
   * `deps.settings` to registerKimiTideCommands degrades silently to the
   * sidecar, so this asserts both halves: the config received the write AND
   * no sidecar file appeared.
   */
  it('writes a save through the config and never falls back to the sidecar file', async () => {
    const settings = makeSettings(undefined)
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners, listModelsCalls, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()
    const enumerationsBeforeSave = listModelsCalls.length

    await getCommand()!.handler({ rawInput: 'preset capability' })
    await tick()

    const stored = settings.doc.router as RouterConfigV5
    expect(stored.activePreset).toBe('capability')
    expect(stored.version).toBe(6)
    expect(Object.keys(stored.presets).length).toBeGreaterThan(0)
    expect((settings.get() as RouterConfigV4).activePreset).toBe('capability')
    expect(existsSync(sidecarFile)).toBe(false)
    // applyConfig ran: panel refreshed and the capability router was mounted.
    expect((await lastSnapshot(getCommand, agent)).router).toMatchObject({ activePreset: 'capability' })
    expect((await lastSnapshot(getCommand, agent)).configSource).toBe('settings')
    expect((listeners.get('agent/pre-step') ?? []).length).toBeGreaterThan(0)
    // One save = one candidate enumeration pass over the two providers.
    // 0.1.7：写回是同一次 configEditor.edit（命令 onSaved 与 volatile-update 各触发
    // 一次 applyConfig），by-value 守卫保证只挂载/枚举一次。
    expect(listModelsCalls.length - enumerationsBeforeSave).toBe(2)
  })

  /** Ruling 10.2 — current() must track the config, not a frozen startup copy. */
  it('current() tracks the config so a later save keeps the previous preset change', async () => {
    const settings = makeSettings(undefined)
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()

    await getCommand()!.handler({ rawInput: 'preset saving' })
    await getCommand()!.handler({ rawInput: 'preset capability' })

    const resolved = settings.get() as RouterConfigV4
    expect(resolved.activePreset).toBe('capability')   // second save wins
    expect((await lastSnapshot(getCommand, agent)).router).toMatchObject({ activePreset: 'capability' })
  })

  /** T2 wiring: a legacy sidecar is imported into the config exactly once. */
  it('migrates an existing sidecar into the config and archives the file', async () => {
    const legacy: RouterConfigV4 = v4cfg('capability')
    writeFileSync(sidecarFile, YAML.stringify(legacy), 'utf8')
    const settings = makeSettings(undefined)
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()

    expect((settings.get() as RouterConfigV4).activePreset).toBe('capability')
    expect(existsSync(sidecarFile)).toBe(false)
    expect(existsSync(sidecarFile + '.legacy-imported')).toBe(true)
    expect((await lastSnapshot(getCommand, agent)).router).toMatchObject({ activePreset: 'capability' })
    expect((await lastSnapshot(getCommand, agent)).configSource).toBe('settings')
  })

  it('migrates the sidecar even when the composition entry is a v1 router block', async () => {
    const legacy: RouterConfigV4 = v4cfg('capability')
    writeFileSync(sidecarFile, YAML.stringify(legacy), 'utf8')
    // v1 composition entry（0.2.x 形态）：作为条目原始配置 + volatile 快照起点。
    const settings = makeSettings({
      mode: 'cost',
      primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      premium: { provider: 'kimi-coding', model: 'kimi-for-coding' },
    })
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()

    const resolved = settings.get() as RouterConfigV4
    expect(resolved.activePreset).toBe('capability')
    expect(settings.doc.router).toBeDefined()
    expect(existsSync(sidecarFile)).toBe(false)
    expect(existsSync(sidecarFile + '.legacy-imported')).toBe(true)
    expect((await lastSnapshot(getCommand, agent)).router).toMatchObject({ activePreset: 'capability' })
    expect((await lastSnapshot(getCommand, agent)).configSource).toBe('settings')
  })

  it('keeps a user-edited config and leaves the sidecar in place (dirty skip)', async () => {
    writeFileSync(sidecarFile, YAML.stringify(v4cfg('saving')), 'utf8')
    // 用户已按 v5 语义显式配置（version:5 + activePreset）⇒ 不拿旧 sidecar 覆盖。
    const settings = makeSettings({ version: 5, activePreset: 'capability' })
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()

    const resolved = settings.get() as RouterConfigV4
    expect(resolved.activePreset).toBe('capability')   // user edit kept
    expect(existsSync(sidecarFile)).toBe(true)   // left for manual /kimi-tide import-config
  })

  /**
   * 组合种子（entry config 或 legacy patch 静态块）必须经 coerce 链落进生效配置，
   * 否则从没开过面板的宿主会静默丢掉自己配的路由目标。0.1.7 起种子来自 Config 的
   * router 字段（volatile 快照），解析与迁移在插件启动路径上完成。
   */
  it('carries the legacy static router seed through the v5 coercion chain', async () => {
    writeFileSync(
      patchFile,
      '- insert:\n    - id: dsh-kimi-tide\n      config:\n        router:\n          mode: cost\n          primary: { provider: deepseek-official, model: deepseek-v4-flash }\n          premium: { provider: kimi-coding, model: kimi-for-coding }\n',
      'utf8',
    )
    const settings = makeSettings({
      // 存量：条目里是 v1 词汇（旧写法读 patch 文件同款）⇒ 启动迁移链搬到 v5。
      mode: 'cost',
      primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      premium: { provider: 'kimi-coding', model: 'kimi-for-coding' },
    })
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()

    const resolved = settings.get() as RouterConfigV4
    expect(resolved.activePreset).toBe('saving')   // mode cost → saving preset（迁移落点）
    expect((await lastSnapshot(getCommand, agent)).configSource).toBe('settings')
    expect((await lastSnapshot(getCommand, agent)).router).toMatchObject({ activePreset: 'saving' })
  })

  it('uses the built-in default presets when there is no composition seed', async () => {
    const settings = makeSettings(undefined)
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)
    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()
    const resolved = settings.get() as RouterConfigV4
    // 未配置 ⇒ 不路由（快照里 activePreset 缺席，读取端按 !== string 判定为关）。
    expect(resolved.activePreset).toBeFalsy()
    expect(resolved.presets.saving).toBeDefined()
    expect(resolved.presets.capability.default.provider).toBe('kimi-coding')
  })

  it('falls back to the sidecar store when the settings channel goes away', async () => {
    const settings = makeSettings(undefined)
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand, detachSettings } = makeCtx([agent], settings)

    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()
    detachSettings()

    await getCommand()!.handler({ rawInput: 'preset saving' })

    expect(existsSync(sidecarFile)).toBe(true)
    // 设置通道断开后写回落到 sidecar；条目本身不再被写（doc 里仍是空）。
    expect((settings.doc.router as RouterConfigV4 | undefined)?.activePreset).toBeUndefined()
    expect((await lastSnapshot(getCommand, agent)).configSource).toBe('sidecar')
  })

  it('一次性迁移存量 v2 用户层（kimi-tide → kimi-coding → v6，团队派发链）', async () => {
    // 预置一个「用户编辑过」的 v2 配置节（0.3.0 面板写出来的形状）
    const seed = {
      version: 2, mode: 'capability',
      default: { provider: 'kimi-tide', model: 'k3' },
      candidates: [{ provider: 'kimi-tide', model: 'k3' }, { provider: 'deepseek-official', model: 'deepseek-v4-flash' }],
      allowedProviders: ['kimi-tide', 'deepseek-official'],
      scores: { 'kimi-tide/k3': { code: 4.7 } },
      classify: {}, costTiers: {}, routeThreshold: 0.75, lambda: 0.5, premiumBudget: 0.2, budgetWindow: 20, charsPerToken: 2,
    }
    const settings = makeSettings(seed)
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()

    const resolved = settings.get() as RouterConfigV5
    expect(resolved.version).toBe(6)
    expect(resolved.activePreset).toBe('capability')
    expect(resolved.presets.capability.default).toEqual({ provider: 'kimi-coding', model: 'k3' })
    // 预置流注册但不绑定：既有规则目标逐字保持（无 flow 引用，全是模型目标）
    expect(resolved.flows.transcribe?.type).toBe('transcribe')
    expect(resolved.flows.review?.type).toBe('review')
    for (const rule of resolved.presets.capability.rules) expect(rule.target).toHaveProperty('provider')
    // sidecar 不存在 → 无导入行为
    expect(existsSync(sidecarFile)).toBe(false)
  })

  it('无显式 version 的用户层不触发迁移（随 v6 默认解析，无替换写、无留档）', async () => {
    const settings = makeSettings({ activePreset: 'saving' })
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)
    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()
    const resolved = settings.get() as RouterConfigV5
    expect(resolved.version).toBe(6)
    expect(resolved.activePreset).toBe('saving')
    // 无残留 → 不触发 v6 迁移写：无 .pre-v6 留档，生效值仍是用户写的 saving。
    // （doc 本身会被 volatile 目录写盘刷新——那是 setCatalog 的正常行为，不是迁移。）
    expect((settings.doc.router as RouterConfigV5).activePreset).toBe('saving')
    expect(existsSync(join(dir, 'cordis.patch.yml.pre-v6'))).toBe(false)
  })

  it('v4 存量配置启动迁移到 v6：行为逐字保持 + 预置流注册不绑定 + .pre-v6 留档', async () => {
    const legacy = v4cfg('saving')
    const docFile = join(dir, 'cordis.patch.yml')
    writeFileSync(docFile, '# 用户配置文档替身（configEditor 的 documentPath）\n', 'utf8')
    const settings = makeSettings(legacy, docFile)
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()

    const resolved = settings.get() as RouterConfigV5
    expect(resolved.version).toBe(6)
    expect(resolved.activePreset).toBe('saving')
    // 行为保持：presets/keywordGroups 逐字保留（不自动改挂流、不注入 imageFallback）
    expect(resolved.presets).toEqual(legacy.presets)
    expect(resolved.keywordGroups).toEqual(legacy.keywordGroups)
    // 预置流注册但不绑定
    expect(resolved.flows.transcribe?.visionModel.model).toBe('deepseek-v4-flash-vision-exp')
    expect(resolved.presets.saving.rules[0].target).toEqual({ provider: 'kimi-coding', model: 'k3' })
    // 持久化替换 + 文档留档 .pre-v6
    expect((settings.doc.router as RouterConfigV5).version).toBe(6)
    expect(existsSync(docFile + '.pre-v6')).toBe(true)
  })

  it('v5 流接线：eager 转述成功 → 面板推送 imageContext 三态计数与 lastFlowEvent', async () => {
    // saving 预设的带图规则改挂预置 transcribe 流（用户经设置页操作后的形态）
    const v5 = v5cfg('saving')
    v5.presets.saving.rules[0] = { id: 'image-transcribe', when: { kind: 'image' }, target: { flow: 'transcribe' } }
    const settings = makeSettings(v5)
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners, getCommand } = makeCtx([agent], settings)

    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()
    // 无图会话不写 imageContext 字段（三零计数 ≠ 缺席）
    expect(await lastSnapshot(getCommand, agent)).not.toHaveProperty('imageContext')
    expect(await lastSnapshot(getCommand, agent)).not.toHaveProperty('lastFlowEvent')

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

    const snapshot = await lastSnapshot(getCommand, agent)
    // eager 转述成功：图标 transcribed，终决策落预设默认文本模型
    expect(snapshot.imageContext).toEqual({ native: 0, transcribed: 1, blind: 0 })
    expect(snapshot.lastFlowEvent).toContain('flow:transcribe')
    expect(snapshot.lastFlowEvent).toContain('deepseek-official/deepseek-v4-flash')
  })

  /** 控制器裁决 R3：分工表 skill 的注册门控 = roles 非空 **且** 路由开启。 */
  it('分工表 skill 门控（R3）：路由关不注册；开后注册；由开→关 dispose 且不残留', async () => {
    // roles 非空 + 路由关（activePreset=null）：逃生舱态，skill 不得注入目录。
    const roles = {
      frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'kimi-for-coding' } },
    }
    const settings = makeSettings({ ...v5cfg(null), roles })
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand, skillRegister, skillDisposers } = makeCtx([agent], settings)

    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()
    // 关态静默：不注册、不报错、不提示。
    expect(skillRegister).not.toHaveBeenCalled()

    // 路由开（roles 保留）⇒ 注册一次 runtime skill。
    await getCommand()!.handler({ rawInput: 'preset capability' })
    await tick()
    expect(skillRegister).toHaveBeenCalledTimes(1)
    expect(skillRegister.mock.calls[0]![0] as { name: string }).toMatchObject({ name: 'kimi-tide-team' })

    // 路由由开→关：已注册的 skill 被 dispose，目录里不再注册新的。
    await getCommand()!.handler({ rawInput: 'import-config activePreset: null' })
    await tick()
    expect(skillRegister).toHaveBeenCalledTimes(1)
    expect(skillDisposers[0]).toHaveBeenCalled()
  })

  /**
   * v2.0.0 派发台账（Task 5）：panelSnapshot 带 dispatch —— 子代理派发行按父会话
   * 聚合到 Lead；无派发 = 空数组（非 undefined）；agent/disposed 清掉该 agent 的记账。
   * 请求层「记/不记」的直接断言在 router-wiring.test.ts（onDispatch 组）。
   */
  it('panelSnapshot 带 dispatch：子代理派发行按父会话聚合到 Lead，disposed 后清理', async () => {
    const roles = {
      frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'kimi-for-coding' } },
    }
    const settings = makeSettings({ ...v5cfg('saving'), roles })
    const lead = { id: 'lead-session', session: { append: vi.fn() } }
    const child = {
      id: 'child-1',
      session: { append: vi.fn(), header: { origin: 'subagent', delegationDepth: 1, parentSession: 'lead-session' } },
    }
    const { ctx, listeners, getCommand } = makeCtx([lead as never, child as never], settings)
    // agentTeams 服务替身（probeAgentTeams 经 ctx.get('agentTeams') 现查）：child 是认领队友 frontend。
    ;(ctx as Record<string, unknown>).agentTeams = {
      tryMembership: (a: unknown) => (a === child ? { role: 'teammate', name: 'frontend' } : undefined),
    }

    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()

    // 无派发：dispatch 是空数组（不是 undefined）
    const empty = await lastSnapshot(getCommand, lead as never)
    expect(Array.isArray(empty.dispatch)).toBe(true)
    expect(empty.dispatch).toHaveLength(0)

    // 同一代（候选枚举后重挂的末位监听器）驱动 pre-step → request；pre-step 写槽、
    // request 消费槽并（仅子代理轮）记账。
    const drive = async (agent: unknown, base: object): Promise<unknown> => {
      const preStep = listeners.get('agent/pre-step')?.at(-1) as (p: unknown, next: () => Promise<unknown>) => Promise<unknown>
      const request = listeners.get('agent/request')?.at(-1) as (p: unknown, next: () => Promise<unknown>) => Promise<unknown>
      expect(preStep).toBeDefined()
      expect(request).toBeDefined()
      await preStep(
        { agent, messages: [{ role: 'user', content: [{ type: 'text', text: '普通任务' }] }], turn: 1, step: 1, signal: new AbortController().signal },
        () => Promise.resolve({ kind: 'enter' }),
      )
      return request({ agent, turn: 1, step: 1, signal: new AbortController().signal }, () => Promise.resolve(base))
    }

    // 主会话一轮：不产生记账（槽位无 dispatch 元信息）
    await drive(lead, { provider: 'kimi-coding', model: 'k3' })
    expect((await lastSnapshot(getCommand, lead as never)).dispatch).toHaveLength(0)

    // 子代理一轮（delegationDepth > 0，槽位带 dispatch）→ 一条记账，聚合到 Lead
    const applied = await drive(child, { provider: 'kimi-coding', model: 'k3' })
    expect(applied).toMatchObject({ provider: 'kimi-coding', model: 'kimi-for-coding' })
    const snapshot = await lastSnapshot(getCommand, lead as never)
    const dispatch = snapshot.dispatch as Array<Record<string, unknown>>
    expect(dispatch).toHaveLength(1)
    expect(dispatch[0]).toMatchObject({
      basis: 'role',
      teammate: 'frontend',
      roleLabel: '前端',
      target: { provider: 'kimi-coding', model: 'kimi-for-coding' },
      parentSession: 'lead-session',
    })
    expect(typeof dispatch[0]!.at).toBe('number')

    // agent/disposed：清掉该 agent 的记账（Lead 面板回落空数组）
    for (const listener of listeners.get('agent/disposed') ?? []) listener({ agent: child })
    expect((await lastSnapshot(getCommand, lead as never)).dispatch).toHaveLength(0)
  })

  /**
   * acceptance-fix-1 生产形态 1:1 复现：cordis 上下文代理下，**未声明 inject 的
   * 服务属性访问直接抛错**（cordis/lib/index.js:676），只有 ctx.get 能读到。
   * 用 Proxy 把 makeCtx 的 skills/agentTeams 属性访问变成抛错：探测若仍走属性
   * 访问（旧写法），A4（skill 不注册）与 A2（队友不改道）在这里同时红。
   */
  it('cordis 代理形态（属性访问即抛）：skill 注册 + 认领队友改道仍生效（经 ctx.get）', async () => {
    const roles = {
      frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'kimi-for-coding' } },
    }
    // 路由关起步（与 R3 测试同款）：排除启动期双次 apply 的注册计数干扰，
    // 路由由关→开的那次 applyConfig 恰好注册一次。
    const settings = makeSettings({ ...v5cfg(null), roles })
    const child = {
      id: 'child-1',
      session: { append: vi.fn(), header: { origin: 'subagent', delegationDepth: 1, parentSession: 'lead-session' } },
    }
    const { ctx, listeners, skillRegister, getCommand } = makeCtx([child as never], settings)
    ;(ctx as Record<string, unknown>).agentTeams = {
      tryMembership: (a: unknown) => (a === child ? { role: 'teammate', name: 'frontend' } : undefined),
    }
    // cordis 语义：未 inject 的服务，属性访问抛错；ctx.get 无 inject 要求，照常放行。
    const proxied = new Proxy(ctx as Record<string, unknown>, {
      get(target, prop, receiver) {
        if (prop === 'skills' || prop === 'agentTeams') {
          throw new Error(`cannot get property "${String(prop)}" without inject`)
        }
        return Reflect.get(target, prop, receiver)
      },
    })

    apply(proxied as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()
    // 关态静默：不注册、不报错、不提示。
    expect(skillRegister).not.toHaveBeenCalled()

    // A4：路由开（roles 保留）⇒ 经 ctx.get('skills') 取到服务，分工表 skill 注册成功
    await getCommand()!.handler({ rawInput: 'preset saving' })
    await tick()
    expect(skillRegister).toHaveBeenCalledTimes(1)
    expect(skillRegister.mock.calls[0]![0] as { name: string }).toMatchObject({ name: 'kimi-tide-team' })

    // A2：认领队友 frontend 的子代理 request 被改道到 role 目标
    const preStep = listeners.get('agent/pre-step')?.at(-1) as (p: unknown, next: () => Promise<unknown>) => Promise<unknown>
    const request = listeners.get('agent/request')?.at(-1) as (p: unknown, next: () => Promise<unknown>) => Promise<unknown>
    expect(preStep).toBeDefined()
    expect(request).toBeDefined()
    await preStep(
      { agent: child, messages: [{ role: 'user', content: [{ type: 'text', text: '写个组件' }] }], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' }),
    )
    const applied = await request(
      { agent: child, turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ provider: 'deepseek-official', model: 'deepseek-flash' }),
    )
    expect(applied).toMatchObject({ provider: 'kimi-coding', model: 'kimi-for-coding' })
  })

  /**
   * acceptance-fix-1 晚挂载兜底：agentTeams 在 apply 之后才挂上（cordis 组合包按
   * profile 装配，服务挂载顺序不保证）。applyConfig 是插件的常态重入点——同值
   * 保存也会走到——在那里重探测一次，服务出现即重挂路由器，队友改道随之生效。
   */
  it('晚挂载兜底：apply 后挂上的 agentTeams 在下一次 applyConfig 重探测生效', async () => {
    const roles = {
      frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'kimi-for-coding' } },
    }
    const settings = makeSettings({ ...v5cfg('saving'), roles })
    const child = {
      id: 'child-1',
      session: { append: vi.fn(), header: { origin: 'subagent', delegationDepth: 1, parentSession: 'lead-session' } },
    }
    const { ctx, listeners, getCommand } = makeCtx([child as never], settings)
    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()

    const drive = async (): Promise<unknown> => {
      const preStep = listeners.get('agent/pre-step')?.at(-1) as (p: unknown, next: () => Promise<unknown>) => Promise<unknown>
      const request = listeners.get('agent/request')?.at(-1) as (p: unknown, next: () => Promise<unknown>) => Promise<unknown>
      expect(preStep).toBeDefined()
      expect(request).toBeDefined()
      await preStep(
        { agent: child, messages: [{ role: 'user', content: [{ type: 'text', text: '写个组件' }] }], turn: 1, step: 1, signal: new AbortController().signal },
        () => Promise.resolve({ kind: 'enter' }),
      )
      return request(
        { agent: child, turn: 1, step: 1, signal: new AbortController().signal },
        () => Promise.resolve({ provider: 'deepseek-official', model: 'deepseek-flash' }),
      )
    }

    // 服务未挂：子代理不改道（直通 deepseek-flash）
    expect(await drive()).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-flash' })

    // 宿主晚挂载 agentTeams；随后一次**同值**配置保存（config 无 diff）触发
    // applyConfig ⇒ 重探测发现服务出现 ⇒ 重挂路由器。
    ;(ctx as Record<string, unknown>).agentTeams = {
      tryMembership: (a: unknown) => (a === child ? { role: 'teammate', name: 'frontend' } : undefined),
    }
    await getCommand()!.handler({ rawInput: 'import-config activePreset: saving' })
    await tick()

    // 重挂后：认领队友 frontend 的子代理被改道到 role 目标
    expect(await drive()).toMatchObject({ provider: 'kimi-coding', model: 'kimi-for-coding' })
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
    // 关态前置：显式把 activePreset 置 null（未配置的条目解析出来是 undefined，
    // 与 null 同为「不路由」，但这里要一个确定的起点）。
    const settings = makeSettings({ ...v5cfg(null) })
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)
    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
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

  it('revise 命令（v1.4.0）：路由关 → 未挂载文案；路由开无评审记录 → 明确拒绝文案', async () => {
    const settings = makeSettings({ ...v5cfg(null) })
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)
    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()
    const command = getCommand()!
    const echo = async (rawInput: string) => {
      const r = await command.handler({ rawInput, agent }) as { kind: string; text?: string }
      return r.text ?? ''
    }

    // 路由关：installRouter 未挂载 → index 单源兜底文案（与 review 命令同款降级）。
    const off = await echo('revise')
    expect(off).toContain('退回未挂载（路由关闭中）')

    // 路由开但没有已交付的评审结论：拒绝并指路（不得编一条空意见退回）。
    await command.handler({ rawInput: 'preset capability' })
    await tick()
    const on = await echo('revise')
    expect(on).toContain('还没有可退回的评审结论')
  })

  it('onReviewRevise 接线：手动退回后 /kimi-tide panel 的 lastFlowEvent 出现退回行（复核疑点 6）', async () => {
    // reviewer 换成本 harness 目录里真实可用的目标（kimi-coding 只列了 kimi-for-coding，
    // k3 不在池里 ⇒ reviewerAvailable=false，命令会走「没有可用的评审流」降级）。
    const cfg = claimedCfg()
    ;(cfg.flows.review as { reviewer: { provider: string; model: string } }).reviewer = {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    }
    const settings = makeSettings(cfg)
    // 富 agent：需要 feed（agent.ctx.on）与 steer——退回链路的两个真实接口。
    const sessionListeners: Array<(session: unknown, event: unknown) => void> = []
    const append = vi.fn()
    const steer = vi.fn()
    const agent = {
      session: { append },
      steer,
      ctx: {
        on: (name: string, listener: (session: unknown, event: unknown) => void) => {
          if (name === 'session/event') sessionListeners.push(listener)
          return () => {}
        },
      },
    }
    const { ctx, getCommand, listeners } = makeCtx([agent as never], settings)
    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
    await tick()
    await getCommand()!.handler({ rawInput: 'preset capability' })
    await tick()

    // 一轮活（不含评审关键词 ⇒ 不武装，只填 lastTurn 缓存）
    const preStep = [...(listeners.get('agent/pre-step') ?? [])]
    for (const listener of preStep) {
      await listener({
        agent,
        messages: [{ role: 'user', content: [{ type: 'text', text: '写个函数' }] }],
        turn: 3,
        step: 1,
        signal: new AbortController().signal,
      }, () => Promise.resolve({ kind: 'enter' }))
    }
    for (const listener of sessionListeners) {
      listener({}, { type: 'user/message', seq: 1, time: 0, data: { role: 'user', content: [{ type: 'text', text: '写个函数' }], source: { kind: 'user' }, id: 'u1' } })
    }
    for (const listener of sessionListeners) {
      listener({}, {
        type: 'assistant/message', seq: 2, time: 0,
        data: { turn: 3, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '产出甲' }], source: { kind: 'model', provider: 'kimi-coding', model: 'k3' }, id: 'a1' } },
      })
    }
    for (const listener of [...(listeners.get('agent/turn-stopping') ?? [])]) listener({ agent, turn: 3, signal: new AbortController().signal })

    // 手动评审 → 手动退回（都不经结论闸，正好覆盖 index 的两个登记回调）
    const echo = async (rawInput: string) => {
      const r = await getCommand()!.handler({ rawInput, agent }) as { kind: string; text?: string }
      return r.text ?? ''
    }
    expect(await echo('review')).toContain('评审已发起')
    await tick()
    expect(await echo('revise')).toContain('退回重做')
    expect(steer).toHaveBeenCalledTimes(1)

    // dock 行落到面板快照（lastFlowEvent 是「与评审完成行同款通道」的那条）
    const panel = JSON.parse(await echo('panel')) as { lastFlowEvent?: string }
    expect(panel.lastFlowEvent).toContain('revise:review')
    expect(panel.lastFlowEvent).toContain('第 1 次')
  })

  it('show 认领行读实时配置（getter）——解认领后行消失，非注册时快照', async () => {
    const settings = makeSettings(claimedCfg())
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent], settings)
    apply(ctx as never, withRouter({ patchFile, sidecarFile, usagePollOnStart: false }))
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
