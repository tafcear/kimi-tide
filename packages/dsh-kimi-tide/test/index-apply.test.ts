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

function makeCtx(agents: FakeAgent[], providers?: Array<{ id: string }>) {
  const listeners = new Map<string, Array<(payload: unknown) => unknown>>()
  let commandDef: { name: string; handler: (invocation: { rawInput: string }) => Promise<unknown> } | undefined
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
    on: (name: string, listener: (payload: unknown) => unknown, options?: { prepend?: boolean }) => {
      const arr = listeners.get(name) ?? []
      options?.prepend ? arr.unshift(listener) : arr.push(listener)
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

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })

    // Seeded on apply: the live agent got the initial panel snapshot.
    expect(agent.session.append).toHaveBeenCalledWith('kimi-tide/panel', expect.objectContaining({
      router: expect.objectContaining({ activePreset: null }),
    }))

    // A settings save (the loader would now re-apply us; the roster must
    // already be functional on THIS instance) pushes the new preset.
    const command = getCommand()
    expect(command).toBeDefined()
    agent.session.append.mockClear()
    await command!.handler({ rawInput: 'preset saving' })
    expect(agent.session.append).toHaveBeenCalledWith('kimi-tide/panel', expect.objectContaining({
      router: expect.objectContaining({ activePreset: 'saving' }),
    }))
  })

  it('still tracks agents created after apply', async () => {
    const { ctx, listeners } = makeCtx([])
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    const late: FakeAgent = { session: { append: vi.fn() } }
    for (const listener of listeners.get('agent/created') ?? []) listener({ agent: late })
    expect(late.session.append).toHaveBeenCalled()
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

  it('pushes a snapshot with configSource and enumerated candidates (no whitelist)', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    // Candidate enumeration is async (llm.listModels/resolveModelInfo).
    await new Promise((resolve) => setTimeout(resolve, 20))

    const snapshot = agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>
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
    const { ctx } = makeCtx([agent])
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const snapshot = agent.session.append.mock.calls.at(-1)?.[1] as { models?: { kimi: string[] } }
    expect(snapshot.models?.kimi).toEqual(['kimi-for-coding'])
  })

  it('reports configSource patch when the legacy patch router block is the only config', async () => {
    writeFileSync(
      patchFile,
      '- insert:\n    - id: dsh-kimi-tide\n      config:\n        router:\n          mode: cost\n          primary: { provider: deepseek-official, model: deepseek-v4-flash }\n          premium: { provider: kimi-coding, model: kimi-for-coding }\n',
      'utf8',
    )
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })

    const snapshot = agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(snapshot.configSource).toBe('patch')
    expect(snapshot.router).toMatchObject({ activePreset: 'saving' })   // mode cost → saving preset
  })

  it('save writes the sidecar file and the second push carries the new preset', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, getCommand } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    expect(existsSync(sidecarFile)).toBe(false)

    agent.session.append.mockClear()
    const command = getCommand()
    await command!.handler({ rawInput: 'preset capability' })

    expect(existsSync(sidecarFile)).toBe(true)
    const snapshot = agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(snapshot.router).toMatchObject({ activePreset: 'capability' })
    expect(snapshot.configSource).toBe('sidecar')
  })
})

describe('apply() kimi 二态 change-gate（0.4.x 终审跟进：二态变化才推面板）', () => {
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

  it('二态未变：快照零变化 → 一次都不增推（2026-08-23 语义去重后，配额 refresh 的空推也被闸掉）', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners } = makeCtx([agent])
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 25))
    agent.session.append.mockClear()

    // 无 key 的测试环境：refresh() 只把 quota 维持 null——快照与初始帧逐字段
    // 相同，语义去重签名一致 → 不追加（修复前这里恒 append 一条纯膨胀事件）
    for (const listener of listeners.get('credentials/reference-updated') ?? []) listener()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(agent.session.append).not.toHaveBeenCalled()

    for (const listener of listeners.get('credentials/reference-updated') ?? []) listener()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(agent.session.append).not.toHaveBeenCalled()
  })

  it('二态翻转：恰好补推一次且快照 kimi.route=false', async () => {
    const providers = [
      { id: 'kimi-coding', name: 'Kimi' },
      { id: 'deepseek-official', name: 'DeepSeek' },
    ]
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners } = makeCtx([agent], providers)
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 25))
    for (const listener of listeners.get('credentials/reference-updated') ?? []) listener()
    await new Promise((resolve) => setTimeout(resolve, 10))
    agent.session.append.mockClear()

    providers.length = 0 // kimi-coding 路由消失 → route true→false
    for (const listener of listeners.get('credentials/reference-updated') ?? []) listener()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(agent.session.append).toHaveBeenCalledTimes(1)
    const snapshot = agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(snapshot.kimi).toMatchObject({ route: false })
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

  function lastSnapshot(agent: FakeAgent): Record<string, unknown> {
    return agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>
  }

  it('无图会话不写 imageContext 字段（三零计数 ≠ 缺席）', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent])
    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(lastSnapshot(agent)).not.toHaveProperty('imageContext')
  })

  it('带图会话推送按图三态计数（图像规则命中 → native=1）', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners } = makeCtx([agent])
    apply(ctx as never, { patchFile, sidecarFile, ...CAPABILITY, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))

    // pre-step 的 payload.agent 与面板 roster 是同一 Agent 实例（状态表按 agent 隔离）
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

    const snapshot = lastSnapshot(agent)
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

  function lastSnapshot(agent: FakeAgent): Record<string, unknown> {
    return agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>
  }

  it('capability route → decision present with chosen/reason (no scoreDelta)', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, ...CAPABILITY, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await dispatchStep(listeners, agent, '请审查这段代码 review')).toBe(true)

    const decision = lastSnapshot(agent).decision as { chosen: { provider: string; model: string }; reason: string } | null
    expect(decision).not.toBeNull()
    expect(decision!.chosen).toEqual({ provider: 'kimi-coding', model: 'kimi-for-coding' })
    expect(decision!.reason).toContain('code')
  })

  it('a default-miss decision clears a previous rule summary (no stale leak)', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, ...CAPABILITY, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await dispatchStep(listeners, agent, '请审查这段代码 review')
    expect(lastSnapshot(agent).decision).not.toBeNull()

    await dispatchStep(listeners, agent, '帮我写一首诗')
    expect(lastSnapshot(agent).decision).toBeNull()
  })

  it('activePreset null → no decision is ever surfaced', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, usagePollOnStart: false })
    expect(await dispatchStep(listeners, agent, '请审查这段代码 review')).toBe(true) // 守卫监听器恒在；无路由器 → 不产生决策
    expect(lastSnapshot(agent).decision).toBeNull()
    expect(lastSnapshot(agent).router).toMatchObject({ activePreset: null })
  })

  it('onSaved clears the stale decision (config change invalidates it)', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners, getCommand } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, ...CAPABILITY, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await dispatchStep(listeners, agent, '请审查这段代码 review')
    expect(lastSnapshot(agent).decision).not.toBeNull()

    await getCommand()!.handler({ rawInput: 'preset off' })
    const after = lastSnapshot(agent)
    expect(after.decision).toBeNull()
    expect(after.router).toMatchObject({ activePreset: null })
  })

  it('决策观测按会话隔离（评审修复 2026-08-23）：A 会话的决策不串进 B 会话面板', async () => {
    const agentA: FakeAgent = { session: { append: vi.fn() } }
    const agentB: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners } = makeCtx([agentA, agentB])

    apply(ctx as never, { patchFile, sidecarFile, ...CAPABILITY, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    agentA.session.append.mockClear()
    agentB.session.append.mockClear()

    await dispatchStep(listeners, agentA, '请审查这段代码 review')

    // A 看到自己的决策；B 既看不到 A 的决策，也不被这次决策推送打扰
    expect(lastSnapshot(agentA).decision).not.toBeNull()
    expect(agentB.session.append).not.toHaveBeenCalled()
  })

  it('语义去重（评审修复 2026-08-23）：快照无实质变化不追加会话日志（60s 配额轮询风暴防线）', async () => {
    const agent: FakeAgent = { session: { append: vi.fn() } }
    const { ctx, listeners } = makeCtx([agent])

    apply(ctx as never, { patchFile, sidecarFile, ...CAPABILITY, usagePollOnStart: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await dispatchStep(listeners, agent, '请审查这段代码 review')
    agent.session.append.mockClear()

    // 同一输入再决策一轮：快照逐字段相同——fold 只取最新，重复 append 是纯膨胀
    await dispatchStep(listeners, agent, '请审查这段代码 review')
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
