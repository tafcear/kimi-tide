import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, buildDecisionSummary, defaultSidecarFile, defaultPatchFile, panelSignature } from '../src/index.js'

/**
 * Regression: saving router settings rewrites the watched cordis.patch.yml,
 * which makes the loader RE-APPLY the plugin; agent/created does not re-fire
 * for already-live agents, so a re-applied instance used to push panel
 * updates to an empty roster (mode-button desync). apply() must seed its
 * roster from the live agent registry (ctx.agents.list()).
 *
 * 0.5.0: the panel snapshot is projection v4 — RouterPanelView, candidates
 * enumerated provider-agnostically (no whitelist), decision via semantics.
 */

interface FakeAgent { session: { append: ReturnType<typeof vi.fn> } }

/**
 * v1.2.0 会话事件解耦（2026-09-10）：面板快照不再经
 * `agent.session.append('kimi-tide/panel', …)` 落会话日志，改由
 * `/kimi-tide panel --json` 命令通道按需供给（dock 拉模型取数）。
 * 断言语义不变——读的仍是同一份 `KimiTidePanelProjection`，只是换了出口。
 */
async function readPanel(
  getCommand: () => { handler: (invocation: { rawInput: string; agent?: unknown }) => Promise<unknown> } | undefined,
  agent?: FakeAgent,
): Promise<Record<string, unknown>> {
  const command = getCommand()
  expect(command).toBeDefined()
  const result = await command!.handler({ rawInput: 'panel --json', agent }) as { kind: string; text: string }
  return JSON.parse(result.text) as Record<string, unknown>
}

function makeCtx(agents: FakeAgent[], providers?: Array<{ id: string }>) {
  const listeners = new Map<string, Array<(payload: unknown) => unknown>>()
  let commandDef: { name: string; handler: (invocation: { rawInput: string; agent?: unknown }) => Promise<unknown> } | undefined
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    llm: {
      registerAdapter: () => {},
      // Provider-agnostic catalog: no whitelist — every provider becomes a candidate.
      listProviders: () => providers ?? [
        { id: 'kimi-coding', name: 'Kimi' },
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'other-provider', name: 'Other' },
      ],
      listModels: async (provider: string) =>
        provider === 'kimi-coding'
          ? [{ id: 'kimi-for-coding' }]
          : provider === 'deepseek-official'
            ? [{ id: 'deepseek-v4-flash' }]
            : [{ id: 'other-model' }],
      resolveModelInfo: async (provider: string, model: string) => ({
        provider,
        id: model,
        name: model,
        inputModalities: provider === 'kimi-coding' ? ['text', 'image'] : ['text'],
      }),
    },
    commands: { register: (def: never) => { commandDef = def as never; return () => {} } },
    sessionProjections: { register: () => () => {} },
    setInterval: () => () => {},
    // No settings service on this host: cordis never runs an inject callback
    // whose dependency is absent, so the sidecar store stays in charge.
    inject: () => {},
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

  it('seeds the roster from ctx.agents on (re)apply and serves their panel over the command channel', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })

    // Seeded on apply: the live agent's panel is available on demand.
    expect(await readPanel(getCommand, agent)).toMatchObject({
      router: expect.objectContaining({ activePreset: null }),
    })

    // A settings save (the loader would now re-apply us; the roster must
    // already be functional on THIS instance) serves the new preset.
    const command = getCommand()
    expect(command).toBeDefined()
    await command!.handler({ rawInput: 'preset saving', agent })
    expect(await readPanel(getCommand, agent)).toMatchObject({
      router: expect.objectContaining({ activePreset: 'saving' }),
    })
  })

  it('still tracks agents created after apply', async () => {
    const { ctx, listeners, getCommand } = makeCtx([])
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    const late: FakeAgent = { session: { append: vi.fn() } }
    for (const listener of listeners.get('agent/created') ?? []) listener({ agent: late })
    expect((await readPanel(getCommand, late)).router).toBeDefined()
  })
})

describe('apply() projection v4 + sidecar wiring', () => {
  let dir: string
  let patchFile: string
  let sidecarFile: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kimi-tide-v4-'))
    patchFile = join(dir, 'cordis.patch.yml')
    sidecarFile = join(dir, 'kimi-tide-router.yml')
    writeFileSync(patchFile, '- insert:\n    - id: some-other\n      config: { foo: 1 }\n', 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('serves a snapshot with configSource and enumerated candidates (no whitelist)', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    // Candidate enumeration is async (llm.listModels/resolveModelInfo).
    await new Promise((resolve) => setTimeout(resolve, 20))

    const snapshot = await readPanel(getCommand, agent)
    expect(snapshot.configSource).toBe('default')
    expect(snapshot.kimi).toMatchObject({ route: true })
    expect(snapshot.router).toMatchObject({ activePreset: null })
    const candidates = snapshot.candidates as Array<{ provider: string; model: string; available: boolean }>
    expect(candidates).toContainEqual(expect.objectContaining({ provider: 'kimi-coding', model: 'kimi-for-coding' }))
    expect(candidates).toContainEqual(expect.objectContaining({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }))
    // No whitelist: a provider that enumerates is in the pool even if unlisted.
    expect(candidates).toContainEqual(expect.objectContaining({ provider: 'other-provider', model: 'other-model' }))
    // Regression: a configured target that also exists in the live catalog must
    // appear exactly once (enumerateCandidates must not duplicate it).
    const keys = candidates.map((c) => `${c.provider}/${c.model}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('面板 models.kimi 来自 ctx.llm.listModels("kimi-coding")（异步枚举，无 adapter）', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent])
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const snapshot = await readPanel(getCommand, agent) as { models?: { kimi: string[] } }
    expect(snapshot.models?.kimi).toEqual(['kimi-for-coding'])
  })

  it('reports configSource patch when the legacy patch router block is the only config', async () => {
    writeFileSync(
      patchFile,
      '- insert:\n    - id: dsh-kimi-tide\n      config:\n        router:\n          mode: cost\n          primary: { provider: deepseek-official, model: deepseek-v4-flash }\n          premium: { provider: kimi-coding, model: kimi-for-coding }\n',
      'utf8',
    )
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })

    const snapshot = await readPanel(getCommand, agent)
    expect(snapshot.configSource).toBe('patch')
    expect(snapshot.router).toMatchObject({ activePreset: 'saving' })   // mode cost → saving preset
  })

  it('save writes the sidecar file and the next取数 carries the new preset', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    expect(existsSync(sidecarFile)).toBe(false)

    const command = getCommand()
    await command!.handler({ rawInput: 'preset capability', agent })

    expect(existsSync(sidecarFile)).toBe(true)
    const snapshot = await readPanel(getCommand, agent)
    expect(snapshot.router).toMatchObject({ activePreset: 'capability' })
    expect(snapshot.configSource).toBe('sidecar')
  })
})

describe('apply() 二态 + 取数口径（v1.2.0：面板走命令通道，不再写会话日志）', () => {
  let dir: string
  let patchFile: string
  let sidecarFile: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kimi-tide-gate-'))
    patchFile = join(dir, 'cordis.patch.yml')
    sidecarFile = join(dir, 'kimi-tide-router.yml')
    writeFileSync(patchFile, '- insert:\n    - id: some-other\n      config: { foo: 1 }\n', 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('凭据刷新风暴零写入：面板事件一次都不进会话日志（解耦前每 60s 必追加一条）', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners, getCommand } = makeCtx([agent])
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 25))

    // 无 key 的测试环境 + 两次凭据刷新：旧口径下这里会靠签名闸掉「无变化」的追加；
    // 新口径下通道本身不存在，一次都不该写。
    for (const listener of listeners.get('credentials/reference-updated') ?? []) listener()
    await new Promise((resolve) => setTimeout(resolve, 10))
    for (const listener of listeners.get('credentials/reference-updated') ?? []) listener()
    await new Promise((resolve) => setTimeout(resolve, 10))
    // Fails if: 面板重新有了并行写回会话日志的路径（203.7 MB / 27.9% 体积的元凶）。
    expect(agent.session.append).not.toHaveBeenCalled()

    // 取数面照常可用（数据不过日志也能到 dock）。
    expect((await readPanel(getCommand, agent)).kimi).toMatchObject({ key: false })
  })

  it('二态翻转：kimi.route 立刻反映为 false（现算，无「等下一次推送」窗口）', async () => {
    const providers = [
      { id: 'kimi-coding', name: 'Kimi' },
      { id: 'deepseek-official', name: 'DeepSeek' },
    ]
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners, getCommand } = makeCtx([agent], providers)
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 25))
    for (const listener of listeners.get('credentials/reference-updated') ?? []) listener()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await readPanel(getCommand, agent)).kimi).toMatchObject({ route: true })

    providers.length = 0 // kimi-coding 路由消失 → route true→false
    for (const listener of listeners.get('credentials/reference-updated') ?? []) listener()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await readPanel(getCommand, agent)).kimi).toMatchObject({ route: false })
    // 旧口径的「恰好补推一次」随之消失：无推送，只有按需取数。
    expect(agent.session.append).not.toHaveBeenCalled()
  })
})

describe('apply() 面板 v6 推送接线（0.6.0：imageContext 三态计数）', () => {
  let dir: string
  let patchFile: string
  let sidecarFile: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kimi-tide-v6-'))
    patchFile = join(dir, 'cordis.patch.yml')
    sidecarFile = join(dir, 'kimi-tide-router.yml')
    writeFileSync(patchFile, '- insert:\n    - id: some-other\n      config: { foo: 1 }\n', 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const CAPABILITY: Parameters<typeof apply>[1] = {
    router: {
      mode: 'capability',
      primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      premium: { provider: 'kimi-coding', model: 'kimi-for-coding' },
    },
  }

  it('无图会话不写 imageContext 字段（三零计数 ≠ 缺席）', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent])
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await readPanel(getCommand, agent)).not.toHaveProperty('imageContext')
  })

  it('带图会话取数按图三态计数（图像规则命中 → native=1）', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners, getCommand } = makeCtx([agent])
    apply(ctx as never, { patchFile, sidecarFile, ...CAPABILITY, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))

    // pre-step 的 payload.agent 与取数传入的 agent 是同一实例（状态表按 agent 隔离）
    const step = listeners.get('agent/pre-step')?.[0]
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

    const snapshot = await readPanel(getCommand, agent)
    expect(snapshot.imageContext).toEqual({ native: 1, transcribed: 0, blind: 0 })
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

describe('buildDecisionSummary (spec §2.7 gating + truncation)', () => {
  const route = {
    kind: 'route' as const,
    target: { provider: 'kimi-coding', model: 'kimi-for-coding' },
    reason: '规则「code」命中',
    via: 'rule' as const,
  }

  it('summarizes a non-default route decision (via rule/explicit)', () => {
    expect(buildDecisionSummary(route)).toEqual({
      chosen: { provider: 'kimi-coding', model: 'kimi-for-coding' },
      reason: '规则「code」命中',
    })
  })

  it('returns null for keep and default-miss decisions (nothing stale leaks)', () => {
    expect(buildDecisionSummary({ kind: 'keep', reason: 'router off' })).toBeNull()
    expect(buildDecisionSummary({ ...route, via: 'default' as const })).toBeNull()
  })

  it('truncates the reason to 120 characters', () => {
    const summary = buildDecisionSummary({ ...route, reason: 'x'.repeat(200) })
    expect(summary?.reason).toBe('x'.repeat(120))
  })

  it('summarizes a flow decision with flow:{flowId} semantics (Task 9 wiring)', () => {
    const summary = buildDecisionSummary({
      kind: 'flow',
      flowId: 'transcribe',
      flow: {
        type: 'transcribe',
        visionModel: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' },
        failurePolicy: 'latch-image',
      },
      reason: '规则「带图」命中（协作流 transcribe）',
      via: 'rule',
    })
    expect(summary).toEqual({
      chosen: { provider: 'flow', model: 'transcribe' },
      reason: '规则「带图」命中（协作流 transcribe）',
    })
  })

  it('buildDecisionSummary：0.8.0 原因含命中词数；flow 决策与 via:default 语义不变', () => {
    expect(buildDecisionSummary({
      kind: 'route', target: { provider: 'kimi-coding', model: 'kimi-for-coding' },
      reason: '规则「code」命中 2 词（特异度最高）', via: 'rule',
    })?.reason).toBe('规则「code」命中 2 词（特异度最高）')
    expect(buildDecisionSummary({
      kind: 'route', target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      reason: '预设「省钱」默认', via: 'default',
    })).toBeNull()  // 打底不上 chip（既有语义）
    expect(buildDecisionSummary({
      kind: 'flow', flowId: 'transcribe', flow: { type: 'transcribe', visionModel: { provider: 'x', model: 'y' }, failurePolicy: 'blind' },
      reason: '规则「带图」命中（协作流 transcribe）', via: 'rule',
    })).toMatchObject({ chosen: { provider: 'flow', model: 'transcribe' } })
  })
})

describe('apply() decision lifecycle (0.5.0 via semantics)', () => {
  let dir: string
  let patchFile: string
  let sidecarFile: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kimi-tide-dec-'))
    patchFile = join(dir, 'cordis.patch.yml')
    sidecarFile = join(dir, 'kimi-tide-router.yml')
    writeFileSync(patchFile, '- insert:\n    - id: some-other\n      config: { foo: 1 }\n', 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const CAPABILITY: Parameters<typeof apply>[1] = {
    router: {
      mode: 'capability',
      primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      premium: { provider: 'kimi-coding', model: 'kimi-for-coding' },
    },
  }

  /** Run the first registered agent/pre-step listener (installRouter's). */
  async function dispatchStep(
    listeners: Map<string, Array<(payload: unknown) => unknown>>,
    agent: FakeAgent,
    text: string,
  ): Promise<boolean> {
    const listener = listeners.get('agent/pre-step')?.[0]
    if (listener === undefined) return false
    const payload = {
      agent,
      messages: [{ role: 'user', content: [{ type: 'text', text }] } as never],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }
    await (listener as (p: unknown, next: () => Promise<unknown>) => Promise<unknown>)(
      payload,
      () => Promise.resolve({ kind: 'enter' }),
    )
    return true
  }

  it('capability route → decision present with chosen/reason (no scoreDelta)', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners, getCommand } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, ...CAPABILITY, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await dispatchStep(listeners, agent, '请审查这段代码 review')).toBe(true)

    const decision = (await readPanel(getCommand, agent)).decision as { chosen: { provider: string; model: string }; reason: string } | null
    expect(decision).not.toBeNull()
    // 0.8.0：review 组命中 2 词（审查+review）> code 1 词（代码）→ 特异度序 review-k3 首中
    expect(decision!.chosen).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(decision!.reason).toContain('review')
  })

  it('a default-miss decision clears a previous rule summary (no stale leak)', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners, getCommand } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, ...CAPABILITY, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await dispatchStep(listeners, agent, '请审查这段代码 review')
    expect((await readPanel(getCommand, agent)).decision).not.toBeNull()

    await dispatchStep(listeners, agent, '帮我写一首诗')
    expect((await readPanel(getCommand, agent)).decision).toBeNull()
  })

  it('activePreset null → no decision is ever surfaced', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners, getCommand } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    expect(await dispatchStep(listeners, agent, '请审查这段代码 review')).toBe(false) // no router mounted
    const snapshot = await readPanel(getCommand, agent)
    expect(snapshot.decision).toBeNull()
    expect(snapshot.router).toMatchObject({ activePreset: null })
  })

  it('onSaved clears the stale decision (config change invalidates it)', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners, getCommand } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, ...CAPABILITY, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await dispatchStep(listeners, agent, '请审查这段代码 review')
    expect((await readPanel(getCommand, agent)).decision).not.toBeNull()

    await getCommand()!.handler({ rawInput: 'preset off', agent })
    const after = await readPanel(getCommand, agent)
    expect(after.decision).toBeNull()
    expect(after.router).toMatchObject({ activePreset: null })
  })

  it('决策观测按会话隔离（评审修复 2026-08-23）：A 会话的决策不串进 B 会话面板', async () => {
    const agentA: FakeAgent = { session: { append: vi.fn() } }
    const agentB: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners, getCommand } = makeCtx([agentA, agentB])

    apply(ctx as never, { patchFile, sidecarFile, ...CAPABILITY, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))

    await dispatchStep(listeners, agentA, '请审查这段代码 review')

    // A 看到自己的决策；B 面板不被 A 的决策污染（按 agent 隔离的取数）
    expect((await readPanel(getCommand, agentA)).decision).not.toBeNull()
    expect((await readPanel(getCommand, agentB)).decision).toBeNull()
  })

  it('取数零副作用：反复取面板不产生任何会话日志写入（60s 轮询风暴防线）', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners, getCommand } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, ...CAPABILITY, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await dispatchStep(listeners, agent, '请审查这段代码 review')
    agent.session.append.mockClear()

    // 同一输入再决策一轮 + 连取三次：面板数据是现算的只读出口，不落任何日志。
    await dispatchStep(listeners, agent, '请审查这段代码 review')
    await readPanel(getCommand, agent)
    await readPanel(getCommand, agent)
    await readPanel(getCommand, agent)
    expect(agent.session.append).not.toHaveBeenCalled()
  })
})

describe('panelSignature（面板推送语义去重签名，评审修复 2026-08-23）', () => {
  const base = {
    quota: {
      weekly: { used: 9, limit: 100, resetTime: 'w' },
      fiveHour: { used: 10, limit: 100, resetTime: 'f' },
      membershipLevel: 'LEVEL_INTERMEDIATE',
      fetchedAt: 1000,
      stale: false,
    },
    kimi: { route: true, key: true },
    router: { activePreset: 'capability', presetName: '能力', defaultTarget: { provider: 'kimi-coding', model: 'k3' }, ruleCount: 2 },
    reasoning: { enabled: true as const },
    configSource: 'settings' as const,
    candidates: [{ provider: 'kimi-coding', model: 'k3', available: true }],
    decision: null,
  }

  it('仅 fetchedAt 不同的两帧签名相同（配额值未变 = 无新信息）', () => {
    const later = { ...base, quota: { ...base.quota, fetchedAt: 61000 } }
    expect(panelSignature(later)).toBe(panelSignature(base))
  })

  it('quota 值变化 / quota 置 null → 签名不同', () => {
    const usedUp = { ...base, quota: { ...base.quota, weekly: { ...base.quota.weekly, used: 10 } } }
    expect(panelSignature(usedUp)).not.toBe(panelSignature(base))
    expect(panelSignature({ ...base, quota: null })).not.toBe(panelSignature(base))
  })

  it('stale 翻转 / decision 出现 / imageContext 变化 → 签名不同', () => {
    expect(panelSignature({ ...base, quota: { ...base.quota, stale: true } })).not.toBe(panelSignature(base))
    const withDecision = { ...base, decision: { chosen: { provider: 'kimi-coding', model: 'k3' }, reason: '规则「code」命中' } }
    expect(panelSignature(withDecision)).not.toBe(panelSignature(base))
    const withImages = { ...base, imageContext: { native: 1, transcribed: 0, blind: 0 } }
    expect(panelSignature(withImages)).not.toBe(panelSignature(base))
  })
})
