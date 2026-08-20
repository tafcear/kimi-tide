/**
 * kimi-tide 0.5.0 集成验证：临时目录（DSH_HOME 形态）下的端到端
 * 行为，真实 RouterSidecarStore + KimiRouter + 命令层，不 mock 核心——唯一
 * stub 的是 llm 枚举面（沿用 index-apply.test.ts 惯例的 fake ctx）。
 *
 * 覆盖：
 *   1. sidecar 生命周期：save → load（source 'sidecar'）→ 损坏（.corrupt
 *      保留 + 回退 patch）→ import（文件整表替换 / 内联 YAML 合并补丁）
 *   2. 双源优先级：sidecar 与 patch 静态块并存时 sidecar 胜出
 *   3. decide 级：显式 @ / 规则命中 / 打底 / image 规则（via 语义）
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
  DEFAULT_CONFIG_V4,
  type CandidateMeta,
  type RouterConfigV4,
} from '../src/config.js'
import { apply, defaultPatchFile, defaultSidecarFile } from '../src/index.js'
import { KimiRouter, type RouterLog } from '../src/router.js'
import { RouterSidecarStore } from '../src/sidecar.js'

const text = (t: string): UserMessage =>
  ({ role: 'user', content: [{ type: 'text', text: t }] }) as unknown as UserMessage
const image = (t: string): UserMessage =>
  ({
    role: 'user',
    content: [{ type: 'image', url: 'data:image/png;base64,AAAA' }, { type: 'text', text: t }],
  }) as unknown as UserMessage

const silentLog: RouterLog = { info: () => {} }

function v4cfg(activePreset: string | null): RouterConfigV4 {
  return { ...DEFAULT_CONFIG_V4(), activePreset }
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
          { id: 'kimi-coding', name: 'Kimi' },
          { id: 'deepseek-official', name: 'DeepSeek' },
        ],
        listModels: async (provider: string) =>
          provider === 'kimi-coding' ? [{ id: 'kimi-for-coding' }] : [{ id: 'deepseek-v4-flash' }],
        resolveModelInfo: async (provider: string, model: string) => ({
          provider,
          id: model,
          name: model,
          inputModalities: provider === 'kimi-coding' ? ['text', 'image'] : ['text'],
        }),
      },
      commands: { register: () => () => {} },
      sessionProjections: { register: () => () => {} },
      setInterval: () => () => {},
      // 无 settings 服务的宿主：cordis 不会运行依赖缺失的 inject 回调，
      // 路由配置仍走 sidecar > patch > default 链。
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
    const cfg = v4cfg('capability')
    store.save(cfg)

    const out = store.load()
    expect(out.source).toBe('sidecar')
    expect(out.config!.activePreset).toBe('capability')
    expect(out.config!.presets.capability.default.provider).toBe('kimi-coding')
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
        premium: { provider: 'kimi-coding', model: 'kimi-for-coding' },
      }),
    })

    const out = store.load()
    expect(out.source).toBe('patch')
    expect(out.config!.activePreset).toBe('saving')   // mode cost → saving preset
    expect(existsSync(sidecarFile + '.corrupt')).toBe(true)
    expect(readFileSync(sidecarFile + '.corrupt', 'utf8')).toContain('version: [unclosed')
    expect(errors.some((e) => e.includes('.corrupt'))).toBe(true)
  })

  it('import-config 文件形态：整表替换并落盘 sidecar', async () => {
    const store = new RouterSidecarStore({ file: sidecarFile, onError: () => {} })
    const importPath = join(dshHome, 'import.yml')
    writeFileSync(importPath, YAML.stringify(v4cfg('capability')), 'utf8')

    let current: RouterConfigV4 = v4cfg(null)
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
    expect(loaded.config!.activePreset).toBe('capability')
    expect(loaded.config!.version).toBe(4)
  })

  it('import-config 内联 YAML 文本形态：合并补丁，version 置 4', async () => {
    const store = new RouterSidecarStore({ file: sidecarFile, onError: () => {} })
    const base = v4cfg('saving')
    store.save(base)
    let current: RouterConfigV4 = base
    const deps: KimiTideCommandDeps = {
      sidecar: store,
      monitor: { refresh: async () => {} } as never,
      current: () => current,
      onSaved: (next) => { current = next },
    }
    // 面板保存通道：内联 YAML 合并补丁，version 强制置 4。
    const inlineYaml = 'activePreset: capability'
    const cmd = parseKimiTideCommand(`import-config ${inlineYaml}`)
    expect(cmd).toEqual({ kind: 'import-config', path: inlineYaml })

    const result = await applyKimiTideCommand(cmd, deps)
    expect(result).toContain('inline YAML')
    const loaded = store.load()
    expect(loaded.source).toBe('sidecar')
    expect(loaded.config!.activePreset).toBe('capability')
    expect(loaded.config!.version).toBe(4)
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
        premium: { provider: 'kimi-coding', model: 'kimi-for-coding' },
      }),
      onError: () => {},
    })
    store.save(v4cfg('capability'))
    const out = store.load()
    expect(out.source).toBe('sidecar')
    expect(out.config!.activePreset).toBe('capability')   // patch 里是 saving，sidecar 胜出
  })

  it('apply() 端到端：patch 静态块写 cost + sidecar 写 capability → capability 生效（有判别力）', async () => {
    writeFileSync(
      patchFile,
      '- id: dsh-kimi-tide\n  config:\n    router:\n      mode: cost\n      primary: { provider: deepseek-official, model: deepseek-v4-flash }\n      premium: { provider: kimi-coding, model: kimi-for-coding }\n',
      'utf8',
    )
    const pre = new RouterSidecarStore({ file: sidecarFile, onError: () => {} })
    pre.save(v4cfg('capability'))

    const agent = { session: { append: vi.fn() } }
    const { ctx, listeners } = makeCtx([agent])
    apply(ctx as never, {
      patchFile,
      sidecarFile,
      usagePollOnStart: false,
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const snapshot = agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(snapshot.configSource).toBe('sidecar')
    expect(snapshot.router).toMatchObject({ activePreset: 'capability' })

    // 端到端判别：显式 @kimi 指令在已挂载的 router 上路由到 kimi-coding。
    const listener = listeners.get('agent/pre-step')?.at(-1)
    expect(listener).toBeDefined()
    const payload = {
      agent: {},
      messages: [text('@kimi 帮我写代码')],
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
    expect(decision!.chosen).toEqual({ provider: 'kimi-coding', model: 'kimi-for-coding' })
  })

  it('负向对照：仅 patch 静态块（cost）时 activePreset=saving——判别器有效', async () => {
    writeFileSync(
      patchFile,
      '- id: dsh-kimi-tide\n  config:\n    router:\n      mode: cost\n      primary: { provider: deepseek-official, model: deepseek-v4-flash }\n      premium: { provider: kimi-coding, model: kimi-for-coding }\n',
      'utf8',
    )
    const agent = { session: { append: vi.fn() } }
    const { ctx } = makeCtx([agent])
    apply(ctx as never, {
      patchFile,
      sidecarFile,
      usagePollOnStart: false,
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const snapshot = agent.session.append.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(snapshot.configSource).toBe('patch')
    expect(snapshot.router).toMatchObject({ activePreset: 'saving' })   // mode cost → saving
  })
})

describe('integration: decide 级规则路由（via 语义）', () => {
  const metas: CandidateMeta[] = [
    {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      modalities: ['text'],
      available: true,
    },
    {
      provider: 'kimi-coding',
      model: 'kimi-for-coding',
      modalities: ['text', 'image'],
      available: true,
    },
    {
      provider: 'kimi-coding',
      model: 'k3',
      modalities: ['text', 'image'],
      available: true,
    },
  ]

  it('显式 @kimi 指令 → via explicit 路由到 kimi-coding 首个可用候选', () => {
    const router = new KimiRouter(v4cfg('saving'), metas, silentLog)
    const decision = router.decide([text('@kimi 帮我写代码')], 1)
    expect(decision.kind).toBe('route')
    if (decision.kind === 'route') {
      expect(decision.target).toEqual({ provider: 'kimi-coding', model: 'kimi-for-coding' })
      expect(decision.via).toBe('explicit')
    }
  })

  it('关键词组命中 → via rule 路由到规则目标', () => {
    const router = new KimiRouter(v4cfg('saving'), metas, silentLog)
    const decision = router.decide([text('请实现一个函数')], 1)
    expect(decision.kind).toBe('route')
    if (decision.kind === 'route') {
      expect(decision.target).toEqual({ provider: 'kimi-coding', model: 'kimi-for-coding' })
      expect(decision.via).toBe('rule')
    }
  })

  it('未命中规则 → 打底路由到预设默认（via default）', () => {
    const router = new KimiRouter(v4cfg('saving'), metas, silentLog)
    const decision = router.decide([text('今天天气不错')], 1)
    expect(decision.kind).toBe('route')
    if (decision.kind === 'route') {
      expect(decision.target).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
      expect(decision.via).toBe('default')
    }
  })

  it('带图消息 → 命中 saving 的 image 规则路由到 k3（via rule）', () => {
    const router = new KimiRouter(v4cfg('saving'), metas, silentLog)
    const decision = router.decide([image('看看这张图')], 1)
    expect(decision.kind).toBe('route')
    if (decision.kind === 'route') {
      expect(decision.target).toEqual({ provider: 'kimi-coding', model: 'k3' })
      expect(decision.via).toBe('rule')
    }
  })

  it('activePreset null → keep（router off）', () => {
    const router = new KimiRouter(v4cfg(null), metas, silentLog)
    const decision = router.decide([text('请实现一个函数')], 1)
    expect(decision.kind).toBe('keep')
  })
})
