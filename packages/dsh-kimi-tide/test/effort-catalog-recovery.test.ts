/**
 * 2.2.5 回归（2026-10-19 桌面端实机）：DSH 0.2.1-rc.2 上「档位表又不可选」的真身。
 *
 * 现场证据（desktop profile）：插件挂载时 `llm.listProviders()` 已有 4 个路由，但
 * `listModels` 在挂载窗口内全部回空——宿主的模型目录/凭据解析是异步就绪的（本机
 * 实测 3s 后才回模型）。修前这段空池被写成 `efforts: {}` + `mounted: []`，而
 * `planEmptyCatalogRetry` 以「挂载表为空」判为「等宿主事件即可」⇒ **不重试**，
 * 档位表永久为空（16:54 凭据更新触发的重载把 profile patch 覆盖成空表）。
 *
 * 本文件钉三件事：
 *   ① 冷启动空池 ⇒ 不把空池当终局：排有界重试，5s 后目录回填即发布；
 *   ② 重载时读回上一轮已发布目录 ⇒ 首帧不覆盖成空（seed 保住设置页可用）；
 *   ③ 已发布后再遇空池（适配器/凭据抖动）⇒ 不回写空表，重试恢复。
 *
 * harness 复用生产形状：apply 第二参的 `router`/`efforts`/`mounted` 是带 `.get()`
 * 的 volatile；`configEditor.edit` 收整份 raw config 并写回 doc（settings-port 语义）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'
import { DEFAULT_CONFIG_V5 } from '../src/config.js'

const WRITE_OPTS = () => ({ patchFile: '', sidecarFile: '', usagePollOnStart: false })

const TABLE = {
  'kimi-coding/k3': ['low', 'high', 'max'],
  'deepseek-official/deepseek-flash': ['off', 'low', 'high', 'max'],
}
const MOUNTED = ['kimi-coding/k3', 'deepseek-official/deepseek-flash']

interface Catalog {
  efforts: Record<string, string[]>
  mounted: string[]
}

interface FakeHostOptions {
  /** 已持久化的运行面目录（模拟插件重载前 profile patch 里的 volatile 值）。 */
  seedCatalog?: Catalog
  /** 模型目录是否“已就绪”：false ⇒ listModels 回空（宿主异步就绪窗口）。 */
  modelsReady?: boolean
}

function makeHost() {
  const listeners = new Map<string, Array<(payload: unknown) => unknown>>()
  const effects: Array<() => void> = []
  const warnMessages: string[] = []
  /** 每次 setCatalog 落盘的内容（含首帧），用于断言「从未把好表写成空表」。 */
  const writes: Catalog[] = []
  const listModelsCalls: string[] = []
  let modelsReady = false
  // 条目原始 config（= profile patch 原文；volatile 字段就落在这里）。
  let doc: Record<string, unknown> = {}
  let routerSnapshot: unknown = {}
  const snap = (value: unknown) => ({
    get: () => value,
  })

  const modelsOf = (provider: string) =>
    provider === 'kimi-coding' ? [{ id: 'k3' }] : [{ id: 'deepseek-flash' }]

  let commandDef: { name: string; handler: (invocation: { rawInput: string; agent?: unknown }) => Promise<unknown> } | undefined
  const effect = (execute: () => unknown) => {
    const cleanup = execute()
    if (typeof cleanup === 'function') effects.push(cleanup as () => void)
    return () => { void cleanup }
  }
  const entry = { options: { id: 'dsh-kimi-tide', config: doc } }

  const applyConfig = () => ({
    ...WRITE_OPTS(),
    router: snap(routerSnapshot),
    efforts: snap(doc.efforts),
    mounted: snap(doc.mounted),
  })

  const ctx: Record<string, unknown> = {
    logger: { info: () => {}, warn: (m: string) => { warnMessages.push(String(m)) }, error: () => {} },
    fiber: { entry },
    llm: {
      registerAdapter: () => {},
      listProviders: () => [
        { id: 'kimi-coding', name: 'Kimi' },
        { id: 'deepseek-official', name: 'DeepSeek' },
      ],
      listModels: async (provider: string) => {
        listModelsCalls.push(provider)
        return modelsReady ? modelsOf(provider) : []
      },
      resolveModelInfo: async (provider: string, model: string) => ({
        provider,
        id: model,
        name: model,
        inputModalities: ['text'],
        reasoning: { efforts: ['low', 'high', 'max'].map((id) => ({ id })) },
      }),
    },
    commands: { register: (def: never) => { commandDef = def as never; return () => {} } },
    sessionProjections: { register: () => () => {} },
    setInterval: () => () => {},
    effect,
    inject: () => {},
    on: (name: string, listener: (payload: unknown) => unknown) => {
      const arr = listeners.get(name) ?? []
      arr.push(listener)
      listeners.set(name, arr)
      return () => {}
    },
    get: (name: string) => {
      if (name === 'configEditor') {
        return {
          edit: async (_entry: unknown, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>) => {
            const next = change(structuredClone(doc), {})
            doc = next
            writes.push(structuredClone({ efforts: (next.efforts ?? {}) as Record<string, string[]>, mounted: (next.mounted ?? []) as string[] }))
            if (next.router !== undefined) routerSnapshot = next.router
            for (const listener of listeners.get('loader/volatile-update') ?? []) listener([])
          },
        }
      }
      return undefined
    },
  }

  return {
    ctx,
    entry,
    get doc() { return doc },
    writes,
    warnMessages,
    listModelsCalls,
    listeners,
    applyConfig,
    setModelsReady: (value: boolean) => { modelsReady = value },
    setSeed: (seed: { router?: unknown; catalog?: Catalog }) => {
      doc = {
        ...(seed.router === undefined ? {} : { router: seed.router }),
        ...(seed.catalog === undefined ? {} : { efforts: seed.catalog.efforts, mounted: seed.catalog.mounted }),
      }
      routerSnapshot = seed.router ?? {}
      // entry.options.config 必须与 doc 同一引用：插件重载时会先读它。
      entry.options.config = doc
    },
    emit: (name: string) => { for (const listener of listeners.get(name) ?? []) listener(undefined) },
  }
}

/** 让 apply 的异步枚举链（listModels/resolveModelInfo/syncCatalog）跑完。 */
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(0)
}

describe('2.2.5 空池瞬态：档位表不被写成空（DSH 0.2.1-rc.2 实机回归）', () => {
  let dir: string
  let patchFile: string
  let sidecarFile: string
  const originalDshHome = process.env.DSH_HOME

  beforeEach(() => {
    vi.useFakeTimers()
    dir = mkdtempSync(join(tmpdir(), 'kimi-tide-catalog-recovery-'))
    process.env.DSH_HOME = dir
    writeFileSync(join(dir, 'cordis.patch.yml'), '- insert: []\n', 'utf8')
    patchFile = join(dir, 'cordis.patch.yml')
    sidecarFile = join(dir, 'kimi-tide-router.yml')
  })
  afterEach(() => {
    vi.useRealTimers()
    if (originalDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalDshHome
    rmSync(dir, { recursive: true, force: true })
  })

  const seedRouter = () => ({ ...DEFAULT_CONFIG_V5(), activePreset: 'capability' })

  it('冷启动空池 ⇒ 保留兜底挂载表、排 5s 重试；目录回填后发布真档位表', async () => {
    const host = makeHost()
    host.setSeed({ router: seedRouter() })
    host.setModelsReady(false)
    apply(host.ctx as never, { ...host.applyConfig(), patchFile, sidecarFile })
    await flush()

    // 首帧发布的是「配置目标兜底表」：档位表空（宿主还没回模型），但 mounted 不能是 []。
    expect(host.writes.length).toBeGreaterThan(0)
    expect(host.writes[0]!.mounted.length).toBeGreaterThan(0)
    // Fails if: 空池停机（修前行为：mounted 被写成 []，且不重试 ⇒ 永久空表）。
    expect(host.warnMessages.some((m) => m.includes('本轮候选枚举为空'))).toBe(true)
    expect(host.doc.mounted).not.toEqual([])

    // 宿主目录/凭据几秒后就绪（实机 3s 内回模型）⇒ 5s 重试必须发布真档位表。
    host.setModelsReady(true)
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(host.doc.efforts).toEqual({
      'kimi-coding/k3': ['low', 'high', 'max'],
      'deepseek-official/deepseek-flash': ['low', 'high', 'max'],
    })
    expect(host.doc.mounted).toEqual(MOUNTED)
  })

  it('重载保留上一轮已发布目录 ⇒ 首帧不覆盖成空（16:54 现场）', async () => {
    const host = makeHost()
    host.setSeed({ router: seedRouter(), catalog: { efforts: TABLE, mounted: MOUNTED } })
    host.setModelsReady(false)
    apply(host.ctx as never, { ...host.applyConfig(), patchFile, sidecarFile })
    await flush()

    // Fails if: 重载首帧按空目录发布（修前：mounted: [] + efforts: {}，设置页全部禁用）。
    expect(host.doc.efforts).toEqual(TABLE)
    // 空池两轮重试（5s/20s）都用尽也不得回写空表。
    await vi.advanceTimersByTimeAsync(25_000)
    await flush()
    expect(host.doc.efforts).toEqual(TABLE)
    expect(host.doc.mounted).toEqual(MOUNTED)
    // 首帧之后的每次写入都必须带着非空档位表（不存在「好表被覆盖成空」的中间态）。
    for (const write of host.writes.slice(1)) {
      expect(Object.keys(write.efforts).length).toBeGreaterThan(0)
    }
  })

  it('已发布后适配器/凭据抖动 ⇒ 不回写空表；事件触发重枚举后恢复', async () => {
    const host = makeHost()
    host.setSeed({ router: seedRouter() })
    host.setModelsReady(true)
    apply(host.ctx as never, { ...host.applyConfig(), patchFile, sidecarFile })
    await flush()
    expect(host.doc.efforts).not.toEqual({})

    // 模拟 16:54：凭据/适配器更新后枚举窗口内 listModels 回空（llm/adapters-updated）。
    host.setModelsReady(false)
    host.emit('llm/adapters-updated')
    await flush()
    expect(host.doc.efforts).not.toEqual({})   // Fails if: 空池把已发布目录写成空表

    host.setModelsReady(true)
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(host.doc.efforts['kimi-coding/k3']).toEqual(['low', 'high', 'max'])
  })
})
