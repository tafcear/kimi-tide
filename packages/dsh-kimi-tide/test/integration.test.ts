/**
 * kimi-tide 0.3.0 集成验证（Task 11）：临时目录（DSH_HOME 形态）下的端到端
 * 行为，真实 RouterSidecarStore + KimiRouter + 命令层，不 mock 核心——唯一
 * stub 的是 llm 枚举面（沿用 index-apply.test.ts 惯例的 fake ctx）。
 *
 * 覆盖（task-11-brief Step 1）：
 *   1. sidecar 生命周期：save → load（source 'sidecar'）→ 损坏（.corrupt
 *      保留 + 回退 patch）→ import（文件整表替换 / 内联 YAML 文本合并补丁）
 *   2. 双源优先级：sidecar 与 patch 静态块并存时 sidecar 胜出
 *   3. modality 护栏端到端：带图消息路由到多模态候选、text-only 候选被排除
 *   4. cost 预算窗口序列：连续调用耗尽窗口 → 回到 keep
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import YAML from 'yaml'
import {
  applyKimiTideCommand,
  parseKimiTideCommand,
  type KimiTideCommandDeps,
} from '../src/commands.js'
import {
  DEFAULT_CONFIG_V2,
  type CandidateMeta,
  type RouterConfigV2,
} from '../src/config.js'
import { apply, buildRouter, defaultPatchFile, defaultSidecarFile } from '../src/index.js'
import type { KimiRouter, RouterLog } from '../src/router.js'
import { RouterSidecarStore } from '../src/sidecar.js'

const text = (t: string): UserMessage =>
  ({ role: 'user', content: [{ type: 'text', text: t }] }) as unknown as UserMessage
const image = (t: string): UserMessage =>
  ({
    role: 'user',
    content: [{ type: 'image', url: 'data:image/png;base64,AAAA' }, { type: 'text', text: t }],
  }) as unknown as UserMessage

const silentLog: RouterLog = { info: () => {} }

function capabilityConfig(): RouterConfigV2 {
  return { ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'capability' }
}

/** 与 index-apply.test.ts 相同的 fake ctx（llm 枚举面 stub，kimi-tide 多模态）。 */
function makeCtx(agents: Array<{ session: { append: ReturnType<typeof vi.fn> } }> = []) {
  const listeners = new Map<string, Array<(payload: unknown) => unknown>>()
  return {
    ctx: {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      llm: {
        registerAdapter: () => {},
        listProviders: () => [
          { id: 'kimi-tide', name: 'Kimi' },
          { id: 'deepseek-official', name: 'DeepSeek' },
        ],
        listModels: async (provider: string) =>
          provider === 'kimi-tide' ? [{ id: 'kimi-for-coding' }] : [{ id: 'deepseek-v4-flash' }],
        resolveModelInfo: async (provider: string, model: string) => ({
          provider,
          id: model,
          name: model,
          inputModalities: provider === 'kimi-tide' ? ['text', 'image'] : ['text'],
        }),
      },
      commands: { register: () => () => {} },
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
    },
    listeners,
  }
}

describe('integration: 临时 DSH_HOME 下的 sidecar 生命周期', () => {
  let dshHome: string
  let patchFile: string
  let sidecarFile: string
  const originalDshHome = process.env.DSH_HOME
  beforeEach(() => {
    dshHome = mkdtempSync(join(tmpdir(), 'kimi-tide-int-'))
    mkdirSync(join(dshHome, 'profiles', 'web'), { recursive: true })
    process.env.DSH_HOME = dshHome
    patchFile = defaultPatchFile()
    sidecarFile = defaultSidecarFile()
  })
  afterEach(() => {
    if (originalDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalDshHome
    rmSync(dshHome, { recursive: true, force: true })
  })

  it('默认路径解析到 $DSH_HOME/profiles/web 且互邻', () => {
    expect(patchFile).toBe(join(dshHome, 'profiles', 'web', 'cordis.patch.yml'))
    expect(sidecarFile).toBe(join(dshHome, 'profiles', 'web', 'kimi-tide-router.yml'))
  })

  it('save → load：source sidecar，内容逐字段回环', () => {
    const store = new RouterSidecarStore({ file: sidecarFile, onError: () => {} })
    const cfg = capabilityConfig()
    cfg.lambda = 0.7
    cfg.scores = { 'kimi-tide/kimi-for-coding': { code: 5 } }
    store.save(cfg)

    const out = store.load()
    expect(out.source).toBe('sidecar')
    expect(out.config!.mode).toBe('capability')
    expect(out.config!.lambda).toBe(0.7)
    expect(out.config!.scores['kimi-tide/kimi-for-coding']).toEqual({ code: 5 })
  })

  it('corrupt：.corrupt 副本保留、警告触发、回退 patch 静态块', () => {
    writeFileSync(sidecarFile, 'version: [unclosed', 'utf8')
    const errors: string[] = []
    const store = new RouterSidecarStore({
      file: sidecarFile,
      onError: (m) => errors.push(m),
      patchFallback: () => ({
        mode: 'cost',
        primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
      }),
    })

    const out = store.load()
    expect(out.source).toBe('patch')
    expect(out.config!.mode).toBe('cost')
    expect(existsSync(sidecarFile + '.corrupt')).toBe(true)
    expect(readFileSync(sidecarFile + '.corrupt', 'utf8')).toContain('version: [unclosed')
    expect(errors.some((e) => e.includes('.corrupt'))).toBe(true)
  })

  it('import-config 文件形态：整表替换并落盘 sidecar', async () => {
    const store = new RouterSidecarStore({ file: sidecarFile, onError: () => {} })
    const imported: RouterConfigV2 = {
      ...capabilityConfig(),
      lambda: 0.9,
      default: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    }
    const importPath = join(dshHome, 'import.yml')
    // 文件形态是整表替换：导入文档必须是结构完整的 v2（sidecar validate
    // 浅校验 default/candidates），稀疏 YAML 只走内联合并补丁形态。
    writeFileSync(importPath, YAML.stringify({
      ...capabilityConfig(),
      lambda: 0.9,
      default: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    }), 'utf8')

    let current: RouterConfigV2 = capabilityConfig()
    const deps: KimiTideCommandDeps = {
      sidecar: store,
      monitor: { refresh: async () => {} } as never,
      current: () => current,
      onSaved: (next) => { current = next },
    }
    const result = await applyKimiTideCommand(parseKimiTideCommand(`import-config ${importPath}`), deps)
    expect(result).toContain('imported')
    expect(existsSync(sidecarFile)).toBe(true)
    const loaded = store.load()
    expect(loaded.config!.lambda).toBe(0.9)
    expect(loaded.config!.default.model).toBe('deepseek-v4-pro')
    void imported
  })

  it('import-config 内联 YAML 文本形态：合并补丁，多行换行保真，未投影字段保留', async () => {
    const store = new RouterSidecarStore({ file: sidecarFile, onError: () => {} })
    const base = capabilityConfig()
    base.routeThreshold = 0.8 // 未出现在补丁里的字段必须保留
    store.save(base)
    let current: RouterConfigV2 = base
    const deps: KimiTideCommandDeps = {
      sidecar: store,
      monitor: { refresh: async () => {} } as never,
      current: () => current,
      onSaved: (next) => { current = next },
    }
    // 面板「保存评分」通道：多行 YAML 原样经 rawInput 送达（Task 10 修复点）。
    const inlineYaml = [
      'mode: capability',
      'scores:',
      '  kimi-tide/kimi-for-coding:',
      '    code: 5',
      '    reasoning: 5',
    ].join('\n')
    const cmd = parseKimiTideCommand(`import-config ${inlineYaml}`)
    expect(cmd).toEqual({ kind: 'import-config', path: inlineYaml })

    const result = await applyKimiTideCommand(cmd, deps)
    expect(result).toContain('inline YAML')
    const loaded = store.load()
    expect(loaded.source).toBe('sidecar')
    expect(loaded.config!.scores['kimi-tide/kimi-for-coding']).toEqual({ code: 5, reasoning: 5 })
    expect(loaded.config!.routeThreshold).toBe(0.8)
    expect(loaded.config!.version).toBe(2)
  })
})

describe('integration: 双源优先级（sidecar > patch）', () => {
  let dir: string
  let patchFile: string
  let sidecarFile: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kimi-tide-prio-'))
    patchFile = join(dir, 'cordis.patch.yml')
    sidecarFile = join(dir, 'kimi-tide-router.yml')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('patchFallback 与 sidecar 并存时 load() 返回 sidecar 内容', () => {
    const store = new RouterSidecarStore({
      file: sidecarFile,
      patchFallback: () => ({
        mode: 'cost',
        primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
      }),
      onError: () => {},
    })
    store.save(capabilityConfig())
    const out = store.load()
    expect(out.source).toBe('sidecar')
    expect(out.config!.mode).toBe('capability') // patch 里是 cost，sidecar 胜出
  })

  it('apply() 端到端：patch 静态块写 cost + sidecar 写 capability → capability 生效（有判别力）', async () => {
    writeFileSync(
      patchFile,
      '- id: dsh-kimi-tide\n  config:\n    router:\n      mode: cost\n      primary: { provider: deepseek-official, model: deepseek-v4-flash }\n      premium: { provider: kimi-tide, model: kimi-for-coding }\n',
      'utf8',
    )
    const pre = new RouterSidecarStore({ file: sidecarFile, onError: () => {} })
    pre.save(capabilityConfig())

    const agent = { session: { append: vi.fn() } }
    const { ctx, listeners } = makeCtx([agent])
    apply(ctx as never, {
      patchFile,
      sidecarFile,
      usagePollOnStart: false,
      refreshOnStart: false,
    })
    // 等候选枚举完成（kimi-tide 变多模态；fallback 种子池全部 text-only，
    // 带图消息会因 eligible 空而 keep——必须先等枚举替换候选池）。
    await new Promise((resolve) => setTimeout(resolve, 20))

    // 直接判别：快照必须来自 sidecar 且 mode=capability（若优先级反转——
    // patch cost 胜出——这里会得到 configSource 'patch' / mode 'cost'）。
    const snapshot = agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(snapshot.configSource).toBe('sidecar')
    expect(snapshot.router).toMatchObject({ mode: 'capability' })

    // 端到端判别：走已挂载的 pre-step listener 喂带图消息——deepseek
    // （text-only）被 eligible 排除，capability 无阈值直接 route；若 patch
    // cost 胜出，delta 0 < routeThreshold 0.75 → keep。两种模式的决策摘要
    // 必然不同，断言 route 即证明 capability 生效。
    const listener = listeners.get('agent/pre-step')?.at(-1) // 枚举后的当前挂载
    expect(listener).toBeDefined()
    const payload = {
      agent: {},
      messages: [image('看看这张图')],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }
    await (listener as (p: unknown, next: () => Promise<unknown>) => Promise<unknown>)(
      payload,
      () => Promise.resolve({ kind: 'enter' }),
    )
    const decision = (agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>)
      .decision as { chosen: { provider: string; model: string } } | null
    expect(decision).not.toBeNull()
    expect(decision!.chosen).toEqual({ provider: 'kimi-tide', model: 'kimi-for-coding' })
  })

  it('负向对照：仅 patch 静态块（cost）时同一带图消息 keep——判别器有效', async () => {
    // 无 sidecar：优先级退化为 patch，mode=cost。同一判别序列必须得到
    // configSource 'patch' + 决策 null（cost 对 delta 0 < 0.75 判 keep）。
    writeFileSync(
      patchFile,
      '- id: dsh-kimi-tide\n  config:\n    router:\n      mode: cost\n      primary: { provider: deepseek-official, model: deepseek-v4-flash }\n      premium: { provider: kimi-tide, model: kimi-for-coding }\n',
      'utf8',
    )
    const agent = { session: { append: vi.fn() } }
    const { ctx, listeners } = makeCtx([agent])
    apply(ctx as never, {
      patchFile,
      sidecarFile,
      usagePollOnStart: false,
      refreshOnStart: false,
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const snapshot = agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(snapshot.configSource).toBe('patch')
    expect(snapshot.router).toMatchObject({ mode: 'cost' })

    const listener = listeners.get('agent/pre-step')?.at(-1)
    expect(listener).toBeDefined()
    const payload = {
      agent: {},
      messages: [image('看看这张图')],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }
    await (listener as (p: unknown, next: () => Promise<unknown>) => Promise<unknown>)(
      payload,
      () => Promise.resolve({ kind: 'enter' }),
    )
    const decision = (agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>).decision
    expect(decision).toBeNull()
  })
})

describe('integration: modality 护栏端到端（decide 级）', () => {
  const metas: CandidateMeta[] = [
    {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      modalities: ['text'],
      costTier: 'cheap',
      available: true,
    },
    {
      provider: 'kimi-tide',
      model: 'kimi-for-coding',
      modalities: ['text', 'image'],
      costTier: 'mid',
      available: true,
    },
  ]

  it('带图消息 → 路由到多模态 kimi 候选，text-only deepseek 被排除', () => {
    const router: KimiRouter = buildRouter(
      {
        mode: 'capability',
        primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
      },
      silentLog,
    )
    const decision = router.decide([image('看看这张图')], 1)
    expect(decision.kind).toBe('route')
    if (decision.kind === 'route') {
      expect(decision.target).toEqual({ provider: 'kimi-tide', model: 'kimi-for-coding' })
      expect(decision.reason).toContain('capability')
    }
  })

  it('多模态候选不可用时带图消息不再改道（无 eligible → keep）', () => {
    const router = buildRouter(
      {
        mode: 'capability',
        primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
        textOnlyProviders: ['deepseek-official', 'kimi-tide'],
      },
      silentLog,
    )
    const decision = router.decide([image('看看这张图')], 1)
    expect(decision.kind).toBe('keep')
  })

  it('纯文本消息走常规评分，不因模态被强制改道', () => {
    const router = buildRouter(
      {
        mode: 'capability',
        primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
      },
      silentLog,
    )
    const decision = router.decide([text('今天天气不错')], 1)
    // 无命中维度 → 默认路由保持
    expect(decision.kind).toBe('keep')
  })
  void metas
})

describe('integration: cost 预算窗口序列', () => {
  it('连续调用耗尽窗口后 premium 升级被抑制（keep）', () => {
    const router = buildRouter(
      {
        mode: 'cost',
        primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
        premiumBudget: 0.4,
        budgetWindow: 4,
        escalateWhen: { patterns: ['审查'] },
      },
      silentLog,
    )

    // 窗口未满时逐次升级（budgetExhausted 门控要求 history.length ≥ window）。
    for (let i = 0; i < 4; i++) {
      const d = router.decide([text('请审查这段代码')], 1)
      expect(d.kind).toBe('route')
      if (d.kind === 'route') expect(d.target.provider).toBe('kimi-tide')
    }
    expect(router.budgetUsage()).toEqual({ premium: 4, window: 4, ratio: 1 })

    // 第 5 次：窗口满且 premium 占比 4/4 ≥ 0.4 → 预算耗尽，回到 keep。
    const exhausted = router.decide([text('请审查这段代码')], 1)
    expect(exhausted.kind).toBe('keep')
    expect(exhausted.reason).toContain('budget')
    // keep 在 cost 模式记 primary 样本，窗口滑动。
    expect(router.budgetUsage()).toEqual({ premium: 3, window: 4, ratio: 0.75 })
  })

  it('窗口滑动后预算恢复（旧样本被挤出）', () => {
    const router = buildRouter(
      {
        mode: 'cost',
        primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
        premiumBudget: 0.4,
        budgetWindow: 4,
        escalateWhen: { patterns: ['审查'] },
      },
      silentLog,
    )
    for (let i = 0; i < 4; i++) router.decide([text('请审查这段代码')], 1)
    expect(router.decide([text('请审查这段代码')], 1).kind).toBe('keep')
    // 窗口 [P, P, P, p] → 3/4 ≥ 0.4 → 仍 keep。
    expect(router.decide([text('请审查这段代码')], 1).kind).toBe('keep')
    // 窗口 [P, P, p, p] → 2/4 ≥ 0.4 → 仍 keep。
    expect(router.decide([text('请审查这段代码')], 1).kind).toBe('keep')
    // 窗口 [P, p, p, p] → 1/4 < 0.4 → 预算恢复，重新升级。
    const recovered = router.decide([text('请审查这段代码')], 1)
    expect(recovered.kind).toBe('route')
    if (recovered.kind === 'route') expect(recovered.target.provider).toBe('kimi-tide')
  })
})
