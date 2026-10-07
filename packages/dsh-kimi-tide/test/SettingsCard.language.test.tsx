// @vitest-environment jsdom
/**
 * W7：月汐设置卡「界面语言」行验收。
 *
 * 1. 渲染与切换：假 locale 服务（register/bind/subscribe/getSnapshot（含 locales
 *    zh/en 两项）/setLocale spy）⇒ 卡片出现「界面语言」一行、当前选中 zh；
 *    下拉改选 en ⇒ setLocale 被以 'en' 调用。负控：把 locale.ts 的 setLanguage
 *    改成 no-op 后本条必须红（已实测，负控后已还原）。
 * 2. 服务缺席：a) 真缺席（vi.resetModules + 全新模块图，不接任何服务）⇒ 整行不渲染；
 *    b) 服务在场但 getSnapshot 不带 locales ⇒ 整行不渲染，且两条路径都不抛错。
 * 3. 切换即时生效：假服务在 setLocale 后把 active 改 'en' 并触发订阅回调（包 act）
 *    ⇒ 不重新挂载（同一 DOM 节点），卡片文案变英文，该行自身文案也变英文
 *    （复用 P3 的 useCopy() 订阅链路）。
 *
 * 本文件单独成档的原因与 SettingsCard.locale.test.tsx 相同：attachLocaleService 写入
 * 模块态且没有复位口——各用例都显式重接线自己要的假服务，用例间不共享隐含状态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { SettingsCard } from '../src/client/SettingsCard.js'
import { attachLocaleService } from '../src/client/locale.js'
import type { CardSnapshot, CardStore } from '../src/client/card-store.js'
import { DEFAULT_CONFIG_V5, type RouterConfigV5 } from '../src/config.js'
import { formatCopy } from '../src/locales/index.js'

declare global {
  // React 18 act 环境开关（react-dom/client 在非测试构建下需要）。
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

/** 预制快照的 CardStore 夹具（与各 SettingsCard 测试同型：方法全空操作）。
 *  注意：getSnapshot 必须返回**同一个**快照对象（模块级缓存）——本文件用 createRoot
 *  真实挂载，useSyncExternalStore 挂载即比对快照引用，每次新建对象会打成无限重渲染
 *  （renderToString 用例不跑 effect，所以别的文件的对象字面量写法在那里没事）。 */
const storeWith = (config: RouterConfigV5) => (): CardStore => {
  const snapshot: CardSnapshot = {
    status: 'ready',
    config,
    base: null,
    user: null,
    writable: true,
    error: null,
    catalog: null,
    availability: null,
    efforts: null,
  }
  return {
    load: async () => {},
    saveTop: async () => {},
    saveActivePreset: async () => {},
    savePreset: async () => {},
    createPreset: async () => {},
    deletePreset: async () => {},
    saveKeywordGroups: async () => {},
    saveFlows: async () => {},
    deleteFlow: async () => {},
    saveRoles: async () => {},
    saveDriver: async () => {},
    saveDriverSticky: async () => {},
    saveRulesApplyToChildren: async () => {},
    resetField: async () => {},
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  }
}

const v5cfg = (): RouterConfigV5 => ({ ...DEFAULT_CONFIG_V5(), activePreset: 'saving' })

/**
 * 可控假 locale 服务（W7 冻结形状）：register 捕获字典；bind 按当前 active 取
 * zh/en 表（含占位符替换）；subscribe 记住回调供测试手动触发；getSnapshot 带
 * locales（zh/en 两项）与 revision；setLocale 记录调用并按 opts.switchOnSet
 * 决定是否同步拨 active（模拟宿主「写入即生效」）。
 */
function makeFakeLocale(opts: { locales?: Array<{ id: string; label: string }> } = {}) {
  const state = {
    active: 'zh',
    locales: opts.locales === undefined
      ? [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }]
      : opts.locales,
    dicts: { zh: {} as Record<string, string>, en: {} as Record<string, string> },
    listeners: [] as Array<() => void>,
    setLocaleCalls: [] as string[],
  }
  const service = {
    register: (_ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }) => {
      state.dicts = dicts
      return () => {}
    },
    bind: () => (key: string, params?: Record<string, unknown>) => {
      const table = state.active.startsWith('zh') ? state.dicts.zh : state.dicts.en
      return formatCopy(table[key] ?? key, params as Record<string, string | number> | undefined)
    },
    subscribe: (cb: () => void) => {
      state.listeners.push(cb)
      return () => {}
    },
    getSnapshot: () => ({ active: state.active, locales: state.locales, revision: 1 }),
    setLocale: vi.fn((id: string) => {
      state.setLocaleCalls.push(id)
    }),
  }
  const ctx = {
    get: (name: string) => (name === 'locale' ? service : undefined),
    effect: (fn: () => unknown) => {
      fn()
      return () => {}
    },
    inject: () => {
      throw new Error('服务直接在场，不应走 inject 延迟路径')
    },
  }
  return { state, service, ctx }
}

/** 不带 locales 的假服务（服务在场、语言列表缺席——旧宿主形状）。 */
function makeLocaleWithoutLanguages() {
  const fake = makeFakeLocale()
  const service = { ...fake.service, getSnapshot: () => ({ active: 'zh', revision: 1 }) }
  const ctx = {
    get: (name: string) => (name === 'locale' ? service : undefined),
    effect: (fn: () => unknown) => {
      fn()
      return () => {}
    },
    inject: () => {},
  }
  return { ctx }
}

/** React 受控 select 的变更触发：原生 setter 绕过 value tracker 后派发 change。 */
function fireSelectChange(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  setter?.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

/** 「界面语言」下拉的 zh aria-label（与 zh 表 settings.language.ariaLabel 逐字一致）。 */
const LANGUAGE_SELECT_ARIA_ZH = '界面语言（切换整个界面与月汐的语言）'
const LANGUAGE_SELECT_ARIA_EN = 'Interface language (switches the whole interface and Kimi Tide)'

describe('W7 设置卡「界面语言」行', () => {
  let container: HTMLDivElement
  let root: Root | undefined

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(async () => {
    if (root !== undefined) {
      const current = root
      root = undefined
      await act(async () => { current.unmount() })
    }
    container.remove()
  })

  it('1. 渲染与切换：行出现、当前选中 zh；改选 en ⇒ 宿主 setLocale 被以 en 调用', () => {
    const fake = makeFakeLocale()
    attachLocaleService(fake.ctx as never)

    root = createRoot(container)
    act(() => {
      root!.render(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v5cfg()) }))
    })

    // 行渲染：标题 + 说明小字（zh 表 settings.language.*）。
    expect(container.textContent).toContain('界面语言')
    expect(container.textContent).toContain('切换后整个界面立即生效，并由宿主记住；月汐的界面文案跟随同一语言。')

    // 下拉：aria-label 走 locale 键；选项 = 宿主 label（中文 / English，数据不进表）；当前选中 zh。
    const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${LANGUAGE_SELECT_ARIA_ZH}"]`)
    expect(select).not.toBeNull()
    expect(select!.value).toBe('zh')
    expect([...select!.options].map((option) => option.textContent)).toEqual(['中文', 'English'])

    // 改选 en ⇒ 转调宿主 setLocale（不自持 state——真源在宿主）。
    act(() => {
      fireSelectChange(select!, 'en')
    })
    // Fails if: setLanguage 被改成 no-op / 卡片自己吞掉 change（负控实测红在这一行）。
    expect(fake.service.setLocale).toHaveBeenCalledTimes(1)
    expect(fake.service.setLocale).toHaveBeenCalledWith('en')
  })

  it('2a. 服务真缺席（不接任何 locale 服务）：整行不渲染，不抛错', async () => {
    // attachLocaleService 无复位口——用全新模块图拿到「从未接过服务」的干净模块态
    // （react / react-dom / SettingsCard 必须从同一新图取，否则 hook 双实例互踩）。
    vi.resetModules()
    const [freshReact, freshServer, freshCard] = await Promise.all([
      import('react'),
      import('react-dom/server'),
      import('../src/client/SettingsCard.js'),
    ])
    const html = freshServer.renderToString(
      freshReact.createElement(freshCard.SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v5cfg()) }),
    )
    expect(html).not.toContain('界面语言')
    expect(html).not.toContain('kt-language')
    // 回落中文渲染不受影响（既有页签照常）。
    expect(html).toContain('>路由<')
  })

  it('2b. 服务在场但不带 locales（旧宿主形状）：整行不渲染，不抛错', () => {
    const fake = makeLocaleWithoutLanguages()
    attachLocaleService(fake.ctx as never)

    root = createRoot(container)
    act(() => {
      root!.render(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v5cfg()) }))
    })
    expect(container.querySelector('.kt-language')).toBeNull()
    expect(container.textContent).not.toContain('界面语言')
    // 其余渲染照常（中文回落链未被语言行影响）。
    expect(container.textContent).toContain('路由')
  })

  it('3. 切换即时生效：setLocale 拨 active=en 并触发订阅 ⇒ 不重挂载，整卡含本行变英文', () => {
    const fake = makeFakeLocale()
    attachLocaleService(fake.ctx as never)

    root = createRoot(container)
    act(() => {
      root!.render(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v5cfg()) }))
    })
    const nodeBefore = container.firstElementChild
    const selectZh = container.querySelector<HTMLSelectElement>(`select[aria-label="${LANGUAGE_SELECT_ARIA_ZH}"]`)
    expect(selectZh).not.toBeNull()
    expect(container.textContent).toContain('界面语言')

    // 用户在下了里改选 en ⇒ 卡片转调 setLocale；假服务模拟宿主「写入即生效」拨 active，
    // 随后宿主经 subscribe 通知（包 act 冲刷）。
    act(() => {
      fireSelectChange(selectZh!, 'en')
    })
    expect(fake.service.setLocale).toHaveBeenCalledWith('en')
    fake.state.active = 'en'
    act(() => {
      for (const cb of [...fake.state.listeners]) cb()
    })

    // Fails if: 行/卡片不靠订阅链路重渲染（文案停在中文），或切换靠重新挂载实现。
    expect(container.firstElementChild).toBe(nodeBefore)
    expect(container.textContent).not.toContain('界面语言')
    expect(container.textContent).toContain('Interface language')
    expect(container.textContent).toContain('Applies to the whole interface immediately and is remembered by the host')
    // useCopy() 链路同刷：页签标题变英文。
    expect(container.textContent).toContain('Routing')
    expect(container.textContent).not.toContain('>路由<')
    // 下拉当前项随生效语言切换（aria-label 同步换英文）。
    const selectEn = container.querySelector<HTMLSelectElement>(`select[aria-label="${LANGUAGE_SELECT_ARIA_EN}"]`)
    expect(selectEn).not.toBeNull()
    expect(selectEn!.value).toBe('en')
  })
})
