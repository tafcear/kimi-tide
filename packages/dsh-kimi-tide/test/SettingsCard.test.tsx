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
import type { ConnectionLike, SettingsScopeLike } from '../src/client/card-store.js'
import { SettingsCard } from '../src/client/SettingsCard.js'
import { apply } from '../src/client/index.js'
import { DEFAULT_CONFIG_V2 } from '../src/config.js'

const noop = () => {}

/** 一个 settingsScope.bind(...) 返回的 scope 结构面 mock。 */
function makeScope(snapshotOverrides: Record<string, unknown> = {}) {
  let snapshot = {
    status: 'ready' as const,
    value: DEFAULT_CONFIG_V2('kimi-tide'),
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

/** 一个 connection 服务结构面 mock（api.settings.describe/mutate）。 */
function makeConnection(namespaces: Array<{ ns: string; value: unknown; base?: unknown; user?: unknown }> = []) {
  const mutate = vi.fn(async (_req: unknown) => ({ result: { ok: true, value: {} } }))
  const describe = vi.fn(async () => ({ result: { ok: true, value: { writable: true, namespaces } } }))
  const connection = {
    api: { settings: { describe, mutate } },
  } as unknown as ConnectionLike
  return { connection, mutate, describe }
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
    const { connection, mutate } = makeConnection([{ ns: 'kimi-tide-router', value: DEFAULT_CONFIG_V2('kimi-tide') }])
    const store = createCardStore(null, connection)

    await store.saveScores('kimi-tide/k3', 'code', 4.7)

    // Fails if: the nested scores write stops being a multi-segment path op.
    expect(mutate).toHaveBeenCalledWith({
      ns: 'kimi-tide-router',
      ops: [{ op: 'set', path: ['scores', 'kimi-tide/k3', 'code'], value: 4.7 }],
    })
  })

  it('resetField clears a top-level field so it re-inherits', async () => {
    const { scope, unset } = makeScope()
    const store = createCardStore(scope, null)

    await store.resetField('lambda')

    // Fails if: resetField stops routing through scope.unset.
    expect(unset).toHaveBeenCalledWith('lambda')
  })
})

describe('SettingsCard render', () => {
  it('renders the mode segmented control bound to the snapshot', () => {
    const config = { ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'capability' as const }
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

  it('shows inherited vs overridden score values from the base/user layers', () => {
    const overriddenScores = { 'kimi-tide/kimi-for-coding': { code: 4.5 } }

    // base 有值、user 无 → 继承。
    const inherited = { ...DEFAULT_CONFIG_V2('kimi-tide'), scores: overriddenScores }
    const inheritedHtml = renderToString(createElement(SettingsCard, {
      scope: makeScope({ value: inherited, base: { scores: overriddenScores }, user: undefined }).scope,
      connection: null,
      close: noop,
    }))
    expect(inheritedHtml).toContain('继承')

    // user 有 → 覆盖。
    const overridden = { ...DEFAULT_CONFIG_V2('kimi-tide'), scores: overriddenScores }
    const overriddenHtml = renderToString(createElement(SettingsCard, {
      scope: makeScope({ value: overridden, base: undefined, user: { scores: overriddenScores } }).scope,
      connection: null,
      close: noop,
    }))
    expect(overriddenHtml).toContain('覆盖')
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
})
