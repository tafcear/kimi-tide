// @vitest-environment jsdom
/**
 * SettingsCard — DOM 重渲染回归（2026-08-20 BUG：设置页「月汐」卡片空白）。
 *
 * 事故根因：候选手风琴（a45d722）把 useState(expandedKeys) 放在了
 * `if (config === null) return …` 提前返回之后。真实浏览器里首帧快照
 * loading（config=null）→ store.load() 完成后 ready（config≠null）的
 * 重渲染多出一个 hook，React 抛「Rendered more hooks than during the
 * previous render」，整个设置内容区崩溃为空白。0.5.0 预设管理器重做后
 * 本钉继续生效：所有 useState 必须先于 config===null 提前返回。
 *
 * renderToString 单遍渲染永远不会暴露 hook 数变化，故本文件用
 * react-dom/client + jsdom 做真实挂载→发布→重渲染。每个用例注释标注
 * 「会使其失败的生产改动」。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SettingsCard } from '../src/client/SettingsCard.js'
import type { CardSnapshot, CardStore } from '../src/client/card-store.js'
import { DEFAULT_CONFIG_V4 } from '../src/config.js'

declare global {
  // React 18 act 环境开关（react-dom/client 在非测试构建下需要）。
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

/** 可手动推进快照的 store：首帧 loading（config=null），publish 后 ready。 */
function makeDeferredStore() {
  let snapshot: CardSnapshot = {
    status: 'loading',
    config: null,
    base: null,
    user: null,
    writable: false,
    error: null,
    catalog: null,
    availability: null,
  }
  const listeners = new Set<() => void>()
  const store: CardStore = {
    load: async () => {},
    saveTop: async () => {},
    saveActivePreset: async () => {},
    savePreset: async () => {},
    createPreset: async () => {},
    deletePreset: async () => {},
    saveKeywordGroups: async () => {},
    resetField: async () => {},
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const publish = (next: CardSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  return { store, publish }
}

/** v4 就绪快照：激活省钱预设（编辑器路径一并渲染，回归覆盖更全）。 */
const readySnapshot = (): CardSnapshot => ({
  status: 'ready',
  config: { ...DEFAULT_CONFIG_V4(), activePreset: 'saving' },
  base: null,
  user: null,
  writable: true,
  error: null,
  catalog: null,
  availability: null,
})

describe('SettingsCard DOM lifecycle', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
  })

  it('survives the loading → ready snapshot transition without crashing', async () => {
    const { store, publish } = makeDeferredStore()

    await act(async () => {
      root = createRoot(container)
      root.render(
        createElement(SettingsCard, {
          scope: null,
          connection: null,
          close: () => {},
          storeFactory: () => store,
        }),
      )
    })
    expect(container.textContent).toContain('路由设置不可用')

    await act(async () => {
      publish(readySnapshot())
    })

    // Fails if: a hook (useState/useEffect/…) is added after the
    // `config === null` early return — the loading → ready re-render then
    // runs a different number of hooks and React unmounts the whole card
    // (生产事故 2026-08-20：设置页「月汐」卡片空白).
    expect(container.textContent).toContain('关闭')
    expect(container.textContent).toContain('新增规则')
  })

  it('keeps rendering stable across config republishes', async () => {
    const { store, publish } = makeDeferredStore()

    await act(async () => {
      root = createRoot(container)
      root.render(
        createElement(SettingsCard, {
          scope: null,
          connection: null,
          close: () => {},
          storeFactory: () => store,
        }),
      )
    })
    await act(async () => {
      publish(readySnapshot())
    })

    // 再发布一次同形快照（document-updated 推送路径）：组件不得因重渲染崩溃。
    await act(async () => {
      publish({ ...readySnapshot(), availability: { 'kimi-coding/kimi-for-coding': false } })
    })

    // Fails if: republish-driven re-renders change hook order or throw.
    expect(container.textContent).toContain('新增规则')
    // Fails if: availability 灰态不再到达规则目标（kt-unavailable 类出现在 DOM 上）。
    expect(container.querySelector('.kt-unavailable')).not.toBeNull()
  })
})
