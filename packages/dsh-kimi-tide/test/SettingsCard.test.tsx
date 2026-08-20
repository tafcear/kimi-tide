/**
 * SettingsCard — 设置页「月汐」卡片：0.5.0 预设管理器（Task 8，RouterConfigV4）。
 *
 * 沿用 panel-v3 的 render-to-string 习惯（无 @testing-library/jsdom）：渲染
 * 断言走 renderToString + toContain，storeFactory 缝注入预制快照（renderToString
 * 不跑 effect，异步 load 只能靠预制快照覆盖渲染断言）；store 写路径断言直接调
 * store 方法（它们是卡片唯一的写通道，组件只是把 onClick/onChange 路由到这些
 * 函数）。每个用例注释标注「会使其失败的生产改动」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createCardStore } from '../src/client/card-store.js'
import type { CardSnapshot, CardStore, ConnectionLike, SettingsScopeLike } from '../src/client/card-store.js'
import { presetSlug, SettingsCard } from '../src/client/SettingsCard.js'
import { apply } from '../src/client/index.js'
import { DEFAULT_CONFIG_V4, type RouterConfigV4 } from '../src/config.js'

/** brief 夹具：v4 配置工厂（activePreset 注入到内置默认配置）。 */
const v4cfg = (active: string | null): RouterConfigV4 => ({ ...DEFAULT_CONFIG_V4(), activePreset: active })

/** 宿主模型全量目录夹具（下拉数据源；k3/kimi-for-coding/flash 均在目录内）。 */
const CATALOG = [
  { provider: 'kimi-coding', models: ['k3', 'kimi-for-coding'] },
  { provider: 'deepseek-official', models: ['deepseek-v4-flash'] },
]

/** 预制快照的 CardStore 夹具（方法全空操作；渲染断言只读 getSnapshot）。 */
function makeStore(snapshot: CardSnapshot): CardStore {
  return {
    load: async () => {},
    saveTop: async () => {},
    saveActivePreset: async () => {},
    savePreset: async () => {},
    createPreset: async () => {},
    deletePreset: async () => {},
    saveKeywordGroups: async () => {},
    resetField: async () => {},
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  }
}

const baseSnapshot = (config: RouterConfigV4, overrides: Partial<CardSnapshot> = {}): CardSnapshot => ({
  status: 'ready',
  config,
  base: null,
  user: null,
  writable: true,
  error: null,
  catalog: CATALOG,
  availability: null,
  ...overrides,
})

/** brief 夹具：storeWith(config) → storeFactory（ready + 全量目录 + 无灰态）。 */
const storeWith = (config: RouterConfigV4) => () => makeStore(baseSnapshot(config))

/** brief 夹具：storeWithAvailability(config, availability) → storeFactory（带灰态映射）。 */
const storeWithAvailability = (config: RouterConfigV4, availability: Record<string, boolean>) => () =>
  makeStore(baseSnapshot(config, { availability }))

/** 一个 settingsScope.bind(...) 返回的 scope 结构面 mock（store 写路径用例用）。 */
function makeScope(snapshotOverrides: Record<string, unknown> = {}) {
  let snapshot = {
    status: 'ready' as const,
    value: DEFAULT_CONFIG_V4(),
    base: undefined as unknown,
    user: undefined as unknown,
    writable: true,
    ...snapshotOverrides,
  }
  const scope: SettingsScopeLike = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: vi.fn(async (_field: string, _value: unknown) => {}),
    unset: vi.fn(async (_field: string) => {}),
  }
  return {
    scope,
    set: scope.set,
    unset: scope.unset,
    setSnapshot: (next: Record<string, unknown>) => {
      snapshot = { ...snapshot, ...next }
    },
  }
}

/** 一个 connection 服务结构面 mock（api.settings.describe/mutate + 可选 api.llm.models）。 */
function makeConnection(
  namespaces: Array<{ ns: string; value: unknown; base?: unknown; user?: unknown; revision?: number }> = [],
  llmGroups?: Array<{ id: string; models: Array<{ id: string }> }>,
  llmError?: Error,
) {
  const mutate = vi.fn(async (_req: unknown) => ({ result: { ok: true, value: {} } }))
  const describe = vi.fn(async () => ({
    result: { ok: true, value: { writable: true, namespaces: namespaces.map((n) => ({ revision: 0, ...n })) } },
  }))
  const models = vi.fn(async () => {
    if (llmError !== undefined) throw llmError
    return { result: { ok: true, value: { groups: llmGroups ?? [], failures: [] } } }
  })
  const connection = {
    api: {
      settings: { describe, mutate },
      ...(llmGroups !== undefined || llmError !== undefined ? { llm: { models } } : {}),
    },
  } as unknown as ConnectionLike
  return { connection, mutate, describe, models }
}

describe('SettingsCard 预设管理器（render，brief Task 8 Step 1）', () => {
  it('预设选择行：关闭/省钱/能力 + 激活态 aria-pressed', () => {
    const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v4cfg('saving')) }))
    // Fails if: 预设选择行缺任一枚（关闭/各预设名），或激活预设的 aria-pressed 不再落在「省钱」上。
    expect(html).toContain('关闭')
    expect(html).toContain('省钱')
    expect(html).toContain('能力')
    expect(html).toMatch(/aria-pressed="true"[^>]*>[^<]*省钱|省钱[^]*aria-pressed="true"/)
  })
  it('当前预设编辑器：默认模型下拉 + 规则表行（条件/目标/上移下移删除）+ 新增规则', () => {
    const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v4cfg('saving')) }))
    // Fails if: 编辑器缺默认模型下拉、规则条件「带图」选项、规则目标 option 或新增规则按钮。
    expect(html).toContain('默认模型')
    expect(html).toContain('带图')
    expect(html).toContain('kimi-coding/k3')
    expect(html).toContain('新增规则')
  })
  it('不可用目标标灰（kt-unavailable）', () => {
    const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWithAvailability(v4cfg('saving'), { 'kimi-coding/kimi-for-coding': false }) }))
    // Fails if: availability===false 的规则目标丢失 kt-unavailable 灰态类。
    expect(html).toMatch(/kt-unavailable[^]*kimi-for-coding|kimi-for-coding[^]*kt-unavailable/)
  })
  it('关闭态：只显示预设行，不显示编辑器', () => {
    const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v4cfg(null)) }))
    // Fails if: activePreset===null 时仍渲染当前预设编辑器（新增规则按钮泄漏）。
    expect(html).toContain('关闭')
    expect(html).not.toContain('新增规则')
  })
  it('关键词组管理区：组名 + 词表 textarea + 新建/删除组', () => {
    const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v4cfg('saving')) }))
    // Fails if: 关键词组管理区消失，或内置 chitchat 组不再列出。
    expect(html).toContain('关键词组')
    expect(html).toContain('chitchat')
  })
  it('预设操作：新建/复制/删除按钮在', () => {
    const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v4cfg('saving')) }))
    // Fails if: 预设操作行缺新建/复制/删除任一按钮。
    expect(html).toContain('新建预设').toContain('复制').toContain('删除')
  })
  it('未就绪（status≠ready）时新建/复制/删除按钮 disabled（T7 延期 Minor 门控）', () => {
    // createPreset 在未就绪时会整段覆盖 presets、deletePreset 双写非原子——
    // UI 层门控（仅 status==='ready' && config!==null 可用）是既定缓解。
    const html = renderToString(createElement(SettingsCard, {
      scope: null,
      connection: null,
      storeFactory: () => makeStore(baseSnapshot(v4cfg('saving'), { status: 'loading' })),
    }))
    // Fails if: 未就绪快照下三个预设写操作按钮任一枚仍可点击。
    expect(html).toMatch(/<button[^>]*disabled[^>]*>新建预设</)
    expect(html).toMatch(/<button[^>]*disabled[^>]*>复制</)
    expect(html).toMatch(/<button[^>]*disabled[^>]*>删除</)
  })
})

describe('presetSlug（brief Task 8 Step 3 规则）', () => {
  it('小写 + 非 [a-z0-9 一-鿿] 折叠为 -', () => {
    // Fails if: slug 化不再小写/折叠非法字符/保留中文。
    expect(presetSlug('My Preset', {})).toBe('my-preset')
    expect(presetSlug('代码 专用', {})).toBe('代码-专用')
  })
  it('空名 → preset-<时间戳>', () => {
    // Fails if: 空/全空白名不再落到 preset-<number> 兜底。
    expect(presetSlug('   ', {})).toMatch(/^preset-\d+$/)
  })
  it('冲突 → -2/-3 后缀', () => {
    // Fails if: id 冲突时不再追加递增后缀（store.createPreset 的 error 通道是兜底，
    // UI 先自行避让）。
    expect(presetSlug('saving', { saving: {}, 'saving-2': {} })).toBe('saving-3')
  })
})

describe('createCardStore write paths（v4 配置夹具）', () => {
  it('saveTop writes through scope.set for top-level scalar fields', async () => {
    const { scope, set } = makeScope()
    const store = createCardStore(scope, null)

    await store.saveTop('activePreset', 'saving')

    // Fails if: saveTop stops routing top-level scalars through scope.set.
    expect(set).toHaveBeenCalledWith('activePreset', 'saving')
  })

  it('resetField clears a top-level field so it re-inherits', async () => {
    const { scope, unset } = makeScope()
    const store = createCardStore(scope, null)

    await store.resetField('activePreset')

    // Fails if: resetField stops routing through scope.unset.
    expect(unset).toHaveBeenCalledWith('activePreset')
  })

  it('passes the describe revision as expectedRevision on connection mutate', async () => {
    const { connection, mutate } = makeConnection([{ ns: 'kimi-tide-router', value: DEFAULT_CONFIG_V4(), revision: 7 }])
    const store = createCardStore(null, connection)

    await store.load()
    await store.saveTop('activePreset', 'saving')

    // Fails if: the connection/mutate write drops the optimistic-concurrency fence.
    expect(mutate).toHaveBeenCalledWith({
      ns: 'kimi-tide-router',
      ops: [{ op: 'set', path: ['activePreset'], value: 'saving' }],
      expectedRevision: 7,
    })
  })

  it('publishes an error state when a write fails', async () => {
    const { scope, set } = makeScope()
    set.mockRejectedValueOnce(new Error('settings provider is read-only'))
    const store = createCardStore(scope, null)

    await store.saveTop('activePreset', 'saving')

    // Fails if: a rejected write does not surface an error on the snapshot.
    expect(store.getSnapshot().error).toContain('read-only')
  })
})

describe('createCardStore availability 降级（connection.api.llm.models）', () => {
  it('degrades to no grey-state (not an error) when the llm channel fails', async () => {
    const { connection } = makeConnection(
      [{ ns: 'kimi-tide-router', value: DEFAULT_CONFIG_V4() }],
      undefined,
      new Error('rpc down'),
    )
    const store = createCardStore(null, connection)

    await store.load()

    // Fails if: an llm catalog failure surfaces as a card error instead of silent no-grey.
    expect(store.getSnapshot().availability).toBeNull()
    expect(store.getSnapshot().error).toBeNull()
  })

  it('has no grey-state without a connection channel (scope-only)', async () => {
    const { scope } = makeScope()
    const store = createCardStore(scope, null)

    await store.load()

    // Fails if: a scope-only store invents availability data.
    expect(store.getSnapshot().availability).toBeNull()
  })
})

describe('settings.section registration', () => {
  const originalDocument = globalThis.document
  beforeEach(() => {
    globalThis.document = {
      createElement: () => ({ dataset: {}, textContent: '', remove: () => {} }),
      head: { appendChild: () => {} },
    } as unknown as Document
  })
  afterEach(() => {
    if (originalDocument === undefined) delete (globalThis as Record<string, unknown>).document
    else globalThis.document = originalDocument
  })

  it('registers a settings.section with id kimi-tide-router and order 100', () => {
    const injects: Array<{ name: string; factory: () => void }> = []
    const registers: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const ctx = {
      slots: {
        inject: (name: string, factory: () => void) => {
          injects.push({ name, factory })
        },
        register: (options: Record<string, unknown>, component: unknown) => {
          registers.push({ options, component })
          return options
        },
      },
      remote: { commands: { execute: async () => ({ ok: true }) } },
      get: () => undefined,
      effect: () => () => {},
    }

    apply(ctx as never)

    const section = injects.find((i) => i.name === 'settings.section')
    expect(section).toBeDefined()
    section!.factory()

    const reg = registers.find((r) => r.options.name === 'settings.section')
    expect(reg).toBeDefined()
    // Fails if: the section id/order/label drifts from the plan's contract.
    expect(reg!.options.id).toBe('kimi-tide-router')
    expect(reg!.options.order).toBe(100)
    expect((reg!.options.label as () => string)()).toBe('月汐')
    expect(reg!.component).toBe(SettingsCard)
  })

  it('binds the section label through the locale service when present', () => {
    const registered: Array<[string, Record<string, Record<string, string>>]> = []
    const t = vi.fn((key: string) => `译:${key}`)
    const locale = {
      register: (ns: string, dicts: Record<string, Record<string, string>>) => {
        registered.push([ns, dicts])
        return () => {}
      },
      bind: () => t,
    }
    const injects: Array<{ name: string; factory: () => void }> = []
    const registers: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const ctx = {
      slots: {
        inject: (name: string, factory: () => void) => {
          injects.push({ name, factory })
        },
        register: (options: Record<string, unknown>, component: unknown) => {
          registers.push({ options, component })
          return options
        },
      },
      remote: { commands: { execute: async () => ({ ok: true }) } },
      get: (name: string) => (name === 'locale' ? locale : undefined),
      effect: (execute: () => unknown) => {
        execute()
        return () => {}
      },
    }

    apply(ctx as never)

    const section = injects.find((i) => i.name === 'settings.section')
    expect(section).toBeDefined()
    section!.factory()
    const reg = registers.find((r) => r.options.name === 'settings.section')
    // Fails if: the label stops routing through the locale service's t('nav').
    expect((reg!.options.label as () => string)()).toBe('译:nav')
    expect(t).toHaveBeenCalledWith('nav')
    // Fails if: the plugin's dictionary is not registered under its namespace.
    expect(registered).toHaveLength(1)
    expect(registered[0][0]).toBe('settings.kimi-tide')
    expect(registered[0][1].zh.nav).toBe('月汐')
  })
})
