// @vitest-environment jsdom
/**
 * P3：useCopy() 语言切换即时生效回归。
 *
 * 假 locale 服务（register/bind/subscribe/getSnapshot，active 可控、subscribe
 * 记住回调）经 attachLocaleService 接线后挂载组件 ⇒ 中文；把 active 改成
 * 'en-US' 并在 act() 里触发订阅回调 ⇒ **不重新挂载**（同一 DOM 节点），
 * 界面文案变英文。负控：组件内把 useCopy() 换回模块级 copy 后本条必须变红
 * （已实测，见 _locale-work 报告；负控后已还原）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReasonPanel } from '../src/client/ReasonPanel.js'
import { attachLocaleService } from '../src/client/locale.js'
import { formatCopy } from '../src/locales/index.js'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

/** 可控假 locale 服务：bind 闭包按当前 active 取 zh/en 表；subscribe 记住回调供测试手动触发。 */
function makeFakeLocale() {
  const state = {
    active: 'zh-CN',
    dicts: { zh: {} as Record<string, string>, en: {} as Record<string, string> },
    listeners: [] as Array<() => void>,
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
    getSnapshot: () => ({ active: state.active }),
  }
  const ctx = {
    get: (name: string) => (name === 'locale' ? service : undefined),
    effect: (fn: () => unknown) => {
      fn()
      return () => {}
    },
    inject: () => {},
  }
  return { state, ctx }
}

describe('P3：useCopy() 语言切换即时生效（不重挂载）', () => {
  let root: Root | undefined

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (root !== undefined) {
      const current = root
      root = undefined
      await act(async () => { current.unmount() })
    }
  })

  it('active 从 zh-CN 切到 en-US 并触发订阅 ⇒ 同一 DOM 节点上文案由中文变英文', () => {
    const fake = makeFakeLocale()
    attachLocaleService(fake.ctx as never)

    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(createElement(ReasonPanel, { configSource: 'settings', decision: null, presetName: 'main' }))
    })

    // 接线时为 zh-CN：渲染中文。
    expect(container.textContent).toContain('决策可观测')
    expect(container.textContent).not.toContain('Decision observability')
    const nodeBefore = container.firstElementChild

    // 切换语言并触发订阅回调（包在 act 里冲刷）。
    fake.state.active = 'en-US'
    act(() => {
      for (const cb of [...fake.state.listeners]) cb()
    })

    // Fails if: 组件仍用模块级 copy（不订阅 locale 变化）——文案停留在中文。
    expect(container.textContent).toContain('Decision observability')
    expect(container.textContent).not.toContain('决策可观测')
    // Fails if: 切换靠重新挂载实现——DOM 节点必须还是同一个。
    expect(container.firstElementChild).toBe(nodeBefore)
  })
})
