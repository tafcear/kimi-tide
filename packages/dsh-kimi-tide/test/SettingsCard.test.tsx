/**
 * SettingsCard — 设置页「月汐」卡片（Task 6）。
 *
 * 沿用 panel-v3 的 render-to-string 习惯（无 @testing-library/jsdom）：渲染
 * 断言走 renderToString + toContain；写路径断言直接调 store 的 saveTop/
 * saveScores/resetField（它们是卡片唯一的写通道，组件只是把 onChange 路由到
 * 这些函数）。每个用例注释标注「会使其失败的生产改动」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createCardStore } from '../src/client/card-store.js'
import type { CardStore, ConnectionLike, SettingsScopeLike } from '../src/client/card-store.js'
import { SettingsCard } from '../src/client/SettingsCard.js'
import { apply } from '../src/client/index.js'
import { DEFAULT_CONFIG_V3 } from '../src/config.js'

const noop = () => {}

/** 一个 settingsScope.bind(...) 返回的 scope 结构面 mock。 */
function makeScope(snapshotOverrides: Record<string, unknown> = {}) {
  let snapshot = {
    status: 'ready' as const,
    value: DEFAULT_CONFIG_V3(),
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

describe('createCardStore write paths', () => {
  it('saveTop writes through scope.set for top-level scalar fields', async () => {
    const { scope, set } = makeScope()
    const store = createCardStore(scope, null)

    await store.saveTop('lambda', 0.6)

    // Fails if: saveTop stops routing top-level scalars through scope.set.
    expect(set).toHaveBeenCalledWith('lambda', 0.6)
  })

  it('saveScores writes through connection.api.settings.mutate with a multi-segment path', async () => {
    const { connection, mutate } = makeConnection([{ ns: 'kimi-tide-router', value: DEFAULT_CONFIG_V3() }])
    const store = createCardStore(null, connection)

    await store.saveScores('kimi-coding/k3', 'code', 4.7)

    // Fails if: the nested scores write stops being a multi-segment path op.
    expect(mutate).toHaveBeenCalledWith({
      ns: 'kimi-tide-router',
      ops: [{ op: 'set', path: ['scores', 'kimi-coding/k3', 'code'], value: 4.7 }],
    })
  })

  it('saveScores degrades loudly when only a scope is present (no connection channel)', async () => {
    const { scope } = makeScope()
    const store = createCardStore(scope, null)

    await store.saveScores('kimi-coding/k3', 'code', 4.7)

    // Fails if: a nested scores write with no connection channel silently drops.
    expect(store.getSnapshot().error).toContain('connection 通道')
  })

  it('resetField clears a top-level field so it re-inherits', async () => {
    const { scope, unset } = makeScope()
    const store = createCardStore(scope, null)

    await store.resetField('lambda')

    // Fails if: resetField stops routing through scope.unset.
    expect(unset).toHaveBeenCalledWith('lambda')
  })

  it('passes the describe revision as expectedRevision on connection mutate', async () => {
    const { connection, mutate } = makeConnection([{ ns: 'kimi-tide-router', value: DEFAULT_CONFIG_V3(), revision: 7 }])
    const store = createCardStore(null, connection)

    await store.load()
    await store.saveTop('lambda', 0.6)

    // Fails if: the connection/mutate write drops the optimistic-concurrency fence.
    expect(mutate).toHaveBeenCalledWith({
      ns: 'kimi-tide-router',
      ops: [{ op: 'set', path: ['lambda'], value: 0.6 }],
      expectedRevision: 7,
    })
  })

  it('publishes an error state when a write fails', async () => {
    const { scope, set } = makeScope()
    set.mockRejectedValueOnce(new Error('settings provider is read-only'))
    const store = createCardStore(scope, null)

    await store.saveTop('lambda', 0.6)

    // Fails if: a rejected write does not surface an error on the snapshot.
    expect(store.getSnapshot().error).toContain('read-only')
  })
})

describe('createCardStore availability（connection.api.llm.models，验收⑥修复）', () => {
  it('marks configured-but-unserved candidates unavailable', async () => {
    // kimi-coding 路由不在宿主目录里（未注册/未声明该模型）→ 配置内候选不可用
    const { connection } = makeConnection(
      [{ ns: 'kimi-tide-router', value: DEFAULT_CONFIG_V3() }],
      [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] }],
    )
    const store = createCardStore(null, connection)

    await store.load()

    const availability = store.getSnapshot().availability
    // Fails if: load() stops fetching the host model catalog into availability.
    expect(availability).not.toBeNull()
    expect(availability!['deepseek-official/deepseek-v4-flash']).toBe(true)
    expect(availability!['kimi-coding/kimi-for-coding']).toBe(false)
  })

  it('marks served-but-disallowed providers unavailable（对齐宿主枚举的 allowedProviders 过滤）', async () => {
    const config = { ...DEFAULT_CONFIG_V3(), allowedProviders: ['deepseek-official'] }
    const { connection } = makeConnection(
      [{ ns: 'kimi-tide-router', value: config }],
      [
        { id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] },
        { id: 'kimi-coding', models: [{ id: 'kimi-for-coding' }] },
      ],
    )
    const store = createCardStore(null, connection)

    await store.load()

    // Fails if: availability stops honoring config.allowedProviders.
    expect(store.getSnapshot().availability!['kimi-coding/kimi-for-coding']).toBe(false)
  })

  it('degrades to no grey-state (not an error) when the llm channel fails', async () => {
    const { connection } = makeConnection(
      [{ ns: 'kimi-tide-router', value: DEFAULT_CONFIG_V3() }],
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

  it('fetches availability on the scope read path too when a connection is present', async () => {
    const { scope } = makeScope()
    const { connection } = makeConnection([], [
      { id: 'kimi-coding', models: [{ id: 'kimi-for-coding' }] },
      { id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] },
    ])
    const store = createCardStore(scope, connection)

    await store.load()

    // Fails if: the scope path's early return skips the availability fetch.
    expect(store.getSnapshot().availability!['kimi-coding/kimi-for-coding']).toBe(true)
  })
})


describe('SettingsCard render', () => {
  it('renders the mode segmented control bound to the snapshot', () => {
    const config = { ...DEFAULT_CONFIG_V3(), mode: 'capability' as const }
    const { scope } = makeScope({ value: config })

    const html = renderToString(createElement(SettingsCard, { scope, connection: null, close: noop }))

    // Fails if: any of the three mode options disappears.
    expect(html).toContain('关闭')
    expect(html).toContain('省钱')
    expect(html).toContain('能力')
    // Fails if: the active (pressed) option stops tracking snapshot.mode —
    // snapshot.mode === 'capability' must press the 能力 option specifically.
    expect(html).toContain('aria-pressed="true">能力')
  })

  it('collapses candidates to summary rows by default (no sliders until expanded)', () => {
    const overridden = { ...DEFAULT_CONFIG_V3(), scores: { 'kimi-coding/kimi-for-coding': { code: 4.5 } } }
    const { scope } = makeScope({ value: overridden })

    const html = renderToString(createElement(SettingsCard, { scope, connection: null, close: noop }))

    // Fails if: collapsed candidates still render score sliders.
    expect(html).not.toContain('type="range"')
    // Summary rows still name every candidate, the default badge, and the
    // override-count summary (覆盖 N 维 / 全继承).
    expect(html).toContain('deepseek-official/deepseek-v4-flash')
    expect(html).toContain('kimi-coding/kimi-for-coding')
    expect(html).toContain('（默认）')
    expect(html).toContain('覆盖 1 维')
    expect(html).toContain('全继承')
  })

  it('renders step-0.1 sliders plus a manual number input once the candidate is expanded', () => {
    const { scope } = makeScope()

    const html = renderToString(createElement(SettingsCard, {
      scope,
      connection: null,
      close: noop,
      initialExpanded: ['kimi-coding/kimi-for-coding'],
    }))

    // Fails if: the slider step regresses to 0.5 or the manual score input disappears.
    expect(html).toContain('type="range"')
    expect(html).toContain('step="0.1"')
    expect(html).toContain('kt-score-input')
  })

  it('shows inherited vs overridden score values from the base/user layers', () => {
    const overriddenScores = { 'kimi-coding/kimi-for-coding': { code: 4.5 } }

    // base 有值、user 无 → 继承。
    const inherited = { ...DEFAULT_CONFIG_V3(), scores: overriddenScores }
    const inheritedHtml = renderToString(createElement(SettingsCard, {
      scope: makeScope({ value: inherited, base: { scores: overriddenScores }, user: undefined }).scope,
      connection: null,
      close: noop,
      initialExpanded: ['kimi-coding/kimi-for-coding'],
    }))
    expect(inheritedHtml).toContain('继承')

    // user 有 → 覆盖。
    const overridden = { ...DEFAULT_CONFIG_V3(), scores: overriddenScores }
    const overriddenHtml = renderToString(createElement(SettingsCard, {
      scope: makeScope({ value: overridden, base: undefined, user: { scores: overriddenScores } }).scope,
      connection: null,
      close: noop,
      initialExpanded: ['kimi-coding/kimi-for-coding'],
    }))
    expect(overriddenHtml).toContain('覆盖')
  })

  it('greys out unavailable candidates from the snapshot availability map', () => {
    const config = DEFAULT_CONFIG_V3()
    // 快照 availability 说 kimi-coding/kimi-for-coding 不可用（configured target 不在宿主目录）。
    const store: CardStore = {
      load: async () => {},
      saveTop: async () => {},
      saveScores: async () => {},
      resetField: async () => {},
      getSnapshot: () => ({
        status: 'ready',
        config,
        base: null,
        user: null,
        writable: true,
        error: null,
        availability: {
          'kimi-coding/kimi-for-coding': false,
          'deepseek-official/deepseek-v4-flash': true,
        },
      }),
      subscribe: () => () => {},
    }

    const html = renderToString(createElement(SettingsCard, {
      scope: null,
      connection: null,
      close: noop,
      storeFactory: () => store,
    }))

    // Fails if: the available:false candidate loses its greyed affordance.
    expect(html).toContain('kt-unavailable')
    expect(html).toContain('不可用')
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
