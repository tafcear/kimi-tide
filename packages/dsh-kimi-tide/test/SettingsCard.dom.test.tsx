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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SettingsCard } from '../src/client/SettingsCard.js'
import type { CardSnapshot, CardStore } from '../src/client/card-store.js'
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5 } from '../src/config.js'

declare global {
  // React 18 act 环境开关（react-dom/client 在非测试构建下需要）。
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

/** 可手动推进快照的 store：首帧 loading（config=null），publish 后 ready。 */
function makeDeferredStore(overrides: Partial<CardStore> = {}) {
  let snapshot: CardSnapshot = {
    status: 'loading',
    config: null,
    base: null,
    user: null,
    writable: false,
    error: null,
    catalog: null,
    availability: null,
    efforts: null,
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
    saveFlows: async () => {},
    deleteFlow: async () => {},
    resetField: async () => {},
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    ...overrides,
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
  efforts: null,
})

/** Task 11 夹具：v5 就绪快照（含预置流注册表），激活省钱预设。 */
const readyV5Snapshot = (overrides: Partial<CardSnapshot> = {}): CardSnapshot => ({
  status: 'ready',
  config: { ...DEFAULT_CONFIG_V5(), activePreset: 'saving' },
  base: null,
  user: null,
  writable: true,
  error: null,
  catalog: null,
  availability: null,
  efforts: null,
  ...overrides,
})

/** React 受控 select 的变更触发：原生 setter 绕过 value tracker 后派发 change。 */
function fireSelectChange(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  setter?.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

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

describe('SettingsCard 协作流（v5）DOM lifecycle + 交互落盘（Task 11 Step 1）', () => {
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

  const mount = async (store: CardStore): Promise<void> => {
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
  }

  it('survives loading → ready with v5 config（协作流区 + 带图兜底行渲染，hooks 置顶）', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    expect(container.textContent).toContain('路由设置不可用')

    await act(async () => {
      publish(readyV5Snapshot())
    })

    // Fails if: v5 新增 UI（协作流手风琴/带图兜底行）的 hook 落在 config===null 提前
    // 返回之后——loading→ready 重渲染 hook 数变化，React 卸载整卡（2026-08-20 事故同型）。
    expect(container.textContent).toContain('协作流')
    expect(container.textContent).toContain('带图兜底')
  })

  it('imageFallback 三态选择落盘：改选盲答 → savePreset 收到 imageFallback', async () => {
    const savePreset = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ savePreset })
    await mount(store)
    await act(async () => {
      publish(readyV5Snapshot())
    })

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="带图兜底"]')
    expect(select).not.toBeNull()
    await act(async () => {
      fireSelectChange(select!, 'blind')
    })

    // Fails if: 带图兜底改选不经 savePreset 落盘，或落盘值偏离所选三态。
    expect(savePreset).toHaveBeenCalledWith('saving', expect.objectContaining({ imageFallback: 'blind' }))
  })

  it('规则目标改选协作流 → savePreset 收到 { flow } 引用目标', async () => {
    const savePreset = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ savePreset })
    await mount(store)
    await act(async () => {
      publish(readyV5Snapshot())
    })

    const select = container.querySelectorAll<HTMLSelectElement>('select[aria-label="目标"]')[0]
    expect(select).toBeDefined()
    await act(async () => {
      fireSelectChange(select, 'flow:transcribe')
    })

    // Fails if: 规则目标的协作流选项不落盘为 { flow: '<id>' } 引用（而被 parseTarget
    // 误拆成 provider/model）。
    expect(savePreset).toHaveBeenCalledWith('saving', expect.objectContaining({
      rules: expect.arrayContaining([expect.objectContaining({ target: { flow: 'transcribe' } })]),
    }))
  })

  it('自建流删除按钮路由到 store.deleteFlow；预置流无删除按钮', async () => {
    const deleteFlow = vi.fn(async () => {})
    const config = { ...DEFAULT_CONFIG_V5(), activePreset: 'saving' }
    config.flows = {
      ...config.flows,
      my: { type: 'transcribe', visionModel: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, failurePolicy: 'blind' },
    }
    const { store, publish } = makeDeferredStore({ deleteFlow })
    await mount(store)
    await act(async () => {
      publish(readyV5Snapshot({ config }))
    })

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="删除流 my"]')
    // Fails if: 自建流缺删除按钮，或预置流渲染出删除按钮。
    expect(button).not.toBeNull()
    expect(container.querySelector('button[aria-label="删除流 transcribe"]')).toBeNull()
    await act(async () => {
      button!.click()
    })

    // Fails if: 删除按钮不路由到 store.deleteFlow（引用守卫在 store 内）。
    expect(deleteFlow).toHaveBeenCalledWith('my')
  })
})

describe('SettingsCard 0.8.0 可解释性 + effort 下拉 + 试一句', () => {
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

  const mount = async (store: CardStore): Promise<void> => {
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
  }

  it('规则区标题真语义文案 + minHits 可见标签 + 行级条件摘要渲染', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => { publish(readyV5Snapshot()) })
    // Fails if: 标题仍为 0.5.0 时代「有序，首条命中生效」
    expect(container.textContent).toContain('规则（命中词数多者优先，平手按列表序，带图恒第一）')
    // Fails if: minHits 缺可见标签（0.7.0 只有 aria-label）
    expect(container.textContent).toContain('最少命中词数')
    // Fails if: 规则行缺自动条件摘要（code-kfc 行 = 「命中 code 组 ≥1 词」）
    expect(container.textContent).toContain('命中 code 组 ≥1 词')
  })

  it('effort 下拉：有档位表 → 显示档位选项；模型未声明档位 → 禁用「跟随默认」', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => {
      publish(readyV5Snapshot({ efforts: { 'kimi-coding/k3': ['low', 'high', 'max'] } }))
    })
    // saving 预设默认模型 deepseek-v4-flash：未在档位表 → 只渲染禁用「跟随默认」
    const disabled = container.querySelectorAll<HTMLSelectElement>('select[aria-label="effort 默认模型"]')
    expect(disabled.length).toBe(1)
    expect(disabled[0].disabled).toBe(true)
    // 规则 image-k3 目标 k3：在档位表 → 可选 low/high/max + 跟随默认
    const k3 = container.querySelector<HTMLSelectElement>('select[aria-label="effort image-k3"]')
    expect(k3).not.toBeNull()
    expect([...k3!.options].map((o) => o.value)).toEqual(['', 'low', 'high', 'max'])
  })

  it('试一句：输入文本 → 实时显示命中规则词数与最终目标；标注按当前激活预设', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => { publish(readyV5Snapshot()) })
    const input = container.querySelector<HTMLInputElement>('input[aria-label="试一句"]')
    expect(input).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '帮我重构这个函数')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // Fails if: 测试器不显示命中规则（词数）与最终路由目标
    expect(container.textContent).toContain('code')
    expect(container.textContent).toContain('kimi-for-coding')
    // 词数钉桩：'帮我重构这个函数' 在 saving 预设命中 code 组 重构+函数 2 词
    expect(container.textContent).toContain('2 词')
    expect(container.textContent).toContain('按当前激活预设')
    expect(container.textContent).toContain('仅文本探针')
  })
})
