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
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, type RouterConfigV4 } from '../src/config.js'

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
    // 评审 P3/C6：⚙️ emoji 退役（文字自明）
    expect(container.textContent).not.toContain('⚙️')

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

describe('SettingsCard 评审修复批次2（2026-08-29）', () => {
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

  const buttonByText = (text: string): HTMLButtonElement =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === text)!

  it('P2-2 删除预设两步确认：首击仅武装提示，再击才落盘', async () => {
    const deletePreset = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ deletePreset })
    await mount(store)
    await act(async () => { publish(readySnapshot()) })
    // 规则行删除按钮可见文本同样是「删除」——限定预设操作行容器
    const del = [...container.querySelectorAll('.kt-preset-ops button')].find((b) => b.textContent === '删除')!
    await act(async () => { del.click() })
    // Fails if: 一击即删（删除预设连全部规则，零确认）
    expect(deletePreset).not.toHaveBeenCalled()
    expect(del.textContent).toContain('确认删除')
    await act(async () => { del.click() })
    expect(deletePreset).toHaveBeenCalledTimes(1)
    expect(deletePreset).toHaveBeenCalledWith('saving')
  })

  it('P2-2 武装态 3 秒自动解除（误击窗口有限）', async () => {
    // 真实定时器等待（fake timers 与 React 调度器相互打架，2026-08-29 实测）：
    // 3.2 秒 > 3 秒解除阈值，确定性换速度。
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => { publish(readySnapshot()) })
    const del = [...container.querySelectorAll('.kt-preset-ops button')].find((b) => b.textContent === '删除')!
    await act(async () => { del.click() })
    expect(del.textContent).toContain('确认删除')
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 3200) })
    })
    // Fails if: 武装态无超时解除
    expect(del.textContent).toBe('删除')
  })

  it('P2-3 改动落盘后出现「已保存」反馈', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => { publish(readySnapshot()) })
    await act(async () => { buttonByText('省钱').click() })
    // Fails if: 即改即存仍无任何可见反馈（误改不可感知）
    expect(container.textContent).toContain('已保存')
  })

  it('P2-4 关键词组外部推送重同步草稿（未聚焦时）；聚焦中不打断编辑', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    const snap = readyV5Snapshot()
    snap.config = { ...snap.config, keywordGroups: { alpha: ['a1'], beta: ['b1'] } }
    await act(async () => { publish(snap) })
    const ta = container.querySelector('textarea') as HTMLTextAreaElement
    expect(ta.value).toContain('a1')
    const republish = (groups: Record<string, string[]>) => {
      const next = readyV5Snapshot()
      next.config = { ...next.config, keywordGroups: groups }
      return act(async () => { publish(next) })
    }
    await republish({ alpha: ['a1', 'a2'], beta: ['b1'] })
    // Fails if: draft 恢复仅挂载初始化（外部新值会被旧草稿覆盖丢失）
    expect(ta.value).toContain('a2')
    ta.focus()
    await republish({ alpha: ['a9'], beta: ['b1'] })
    // 聚焦中 → 不打断编辑
    expect(ta.value).toContain('a2')
    expect(ta.value).not.toContain('a9')
  })

  it('P2-5 错误横幅带 kt-error 类（协作流页签白名单豁免的结构锚点）', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => { publish({ ...readySnapshot(), error: 'boom' }) })
    const err = container.querySelector('.kt-error')
    // Fails if: 错误横幅不加 kt-error 类（协作流页签 display:none 藏住错误）
    expect(err).not.toBeNull()
    expect(err!.textContent).toContain('boom')
    // 评审 P3/C6：错误横幅 ⚠️ emoji 退役（与「emoji 全量退役」裁定一致）
    expect(container.textContent).not.toContain('⚠️')
  })
})

describe('SettingsCard a11y 批次3（2026-08-29 评审 P2-6/7/8）', () => {
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

  /** 两条例子规则（带图 + 关键词组 minHits=2），覆盖全部行控件形态。 */
  const readyWithRules = () => {
    const snap = readySnapshot()
    snap.config = {
      ...snap.config,
      keywordGroups: { code: ['pytest'] },
      presets: {
        ...snap.config.presets,
        saving: {
          ...snap.config.presets.saving,
          rules: [
            { id: 'rule-1', when: { kind: 'image' }, target: { provider: 'zai-coding-cn', model: 'glm-5.3-flash' } },
            { id: 'rule-2', when: { kind: 'keywords', group: 'code', minHits: 2 }, target: { provider: 'kimi-coding', model: 'k3' } },
          ],
        },
      },
    } as typeof snap.config
    return snap
  }

  const mountReady = async (): Promise<void> => {
    const { store, publish } = makeDeferredStore()
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
    await act(async () => { publish(readyWithRules()) })
  }

  it('P2-6 表头不再 aria-hidden（列头进入可访问树）', async () => {
    await mountReady()
    const head = container.querySelector('.kt-rule-head')!
    expect(head).not.toBeNull()
    // Fails if: 表头恢复 aria-hidden="true"（读屏听不到列头，行列关系全靠猜）
    expect(head.getAttribute('aria-hidden')).toBeNull()
    expect(head.textContent).toContain('条件')
  })

  it('P2-7/8 行控件可访问名带序号，effort 不再泄漏内部规则 id', async () => {
    await mountReady()
    // Fails if: accName 退回裸「条件/目标」或「effort rule-2」（9 行同名/内部 id 行话）
    expect(container.querySelector('select[aria-label="第 1 条 · 条件"]')).not.toBeNull()
    expect(container.querySelector('select[aria-label="第 2 条 · 目标"]')).not.toBeNull()
    expect(container.querySelector('input[aria-label="第 2 条 · 最少命中词数"]')).not.toBeNull()
    expect(container.querySelector('select[aria-label="第 2 条 · 档位"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="第 2 条 · 删除规则"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="第 1 条 · 上移"]')).not.toBeNull()
    expect(container.querySelector('select[aria-label="effort rule-2"]')).toBeNull()
  })

  it('E-13 规则区块标题为 heading 语义（读屏可按标题跳转）', async () => {
    await mountReady()
    const title = container.querySelector('.kt-card-title') as HTMLElement
    // Fails if: 标题退回裸 span（无 heading 层级）
    expect(title.tagName).toBe('H4')
  })

  it('C12 行内冲突提示措辞指向「上方规则」（「前列」歧义）', async () => {
    const { store, publish } = makeDeferredStore()
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
    const snap = readySnapshot()
    const dupRule = { id: 'rule-dup', when: { kind: 'image' }, target: { provider: 'zai-coding-cn', model: 'glm-5.3-flash' } }
    snap.config = {
      ...snap.config,
      presets: {
        ...snap.config.presets,
        saving: { ...snap.config.presets.saving, rules: [dupRule, { ...dupRule, id: 'rule-dup-2' }] },
      },
    } as typeof snap.config
    await act(async () => { publish(snap) })
    expect(container.textContent).toContain('与上方')
    // Fails if: 措辞退回「与前列相同」（列？排名？歧义）
    expect(container.textContent).not.toContain('与前列')
  })

  it('视觉升级 DOM 钩子：新增规则主按钮 kt-btn-primary；带图规则行 kt-row-image', async () => {
    await mountReady()
    // Fails if: 新增规则退回幽灵按钮 / 带图行无强调类
    expect(container.querySelector('button.kt-btn-primary')?.textContent).toBe('新增规则')
    expect(container.querySelector('.kt-rule-row.kt-row-image')).not.toBeNull()
    expect(container.querySelectorAll('.kt-rule-row.kt-row-image').length).toBe(1)
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

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="第 1 条 · 目标"]')
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

  it('规则区标题真语义文案 + 规则表格化（列头/行网格/minHits 输入）', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => { publish(readyV5Snapshot()) })
    // Fails if: 标题仍为 0.5.0 时代「有序，首条命中生效」
    expect(container.textContent).toContain('命中词数多者优先')
    // ⑥-B 打磨三（2026-08-29）：规则区表格化——列头 + 行网格
    // Fails if: 回退手风琴堆叠行（无列结构）
    expect(container.querySelector('.kt-rule-head')).not.toBeNull()
    expect(container.querySelectorAll('.kt-rule-grid').length).toBeGreaterThanOrEqual(2)
    // minHits 输入（aria 钩子）仍在条件列（批次3 起可访问名带行号，后缀匹配）
    expect(container.querySelector('input[aria-label$="最少命中词数"]')).not.toBeNull()
    // 行级「命中 code 组 ≥1 词」摘要随表格化退役（条件列所见即所得，原钉退役）
    expect(container.textContent).not.toContain('命中 code 组 ≥1 词')
  })

  it('⑥-B 打磨三修订: 列轨共享——全部行网格收进单一 kt-rule-table（表头与数据列对齐）', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => { publish(readyV5Snapshot()) })
    const table = container.querySelector('.kt-rule-table')
    // Fails if: 行仍是独立 grid 容器（fr 列宽按各自内容计算，表头对不齐数据列——2026-08-29 用户截图）
    expect(table).not.toBeNull()
    const gridsInTable = table!.querySelectorAll('.kt-rule-grid').length
    expect(gridsInTable).toBeGreaterThanOrEqual(2)
    expect(container.querySelectorAll('.kt-rule-grid').length).toBe(gridsInTable)
  })

  it('effort 下拉：有档位表 → 显示档位选项；模型未声明档位 → 禁用「跟随默认」', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => {
      publish(readyV5Snapshot({ efforts: { 'kimi-coding/k3': ['low', 'high', 'max'] } }))
    })
    // saving 预设默认模型 deepseek-v4-flash：未在档位表 → 只渲染禁用「跟随默认」
    const disabled = container.querySelectorAll<HTMLSelectElement>('select[aria-label="默认模型 · 档位"]')
    expect(disabled.length).toBe(1)
    expect(disabled[0].disabled).toBe(true)
    // 规则 image-k3 目标 k3：在档位表 → 可选 low/high/max + 跟随默认
    const k3 = [...container.querySelectorAll<HTMLSelectElement>('select[aria-label$="· 档位"]')]
      .find((s) => [...s.options].some((o) => o.value === 'max'))
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

describe('SettingsCard 0.8.x④⑤ effort 显示如实 + catalogScope 刷新', () => {
  let container: HTMLDivElement
  let root: Root | undefined

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(async () => {
    if (root !== undefined) {
      await act(async () => {
        root!.unmount()
      })
      root = undefined
    }
    container.remove()
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
  })

  /** 存了 effort 的省钱预设快照：默认模型追加 effort: 'high'（其余同 v5 就绪快照）。 */
  const snapshotWithStoredEffort = (efforts: CardSnapshot['efforts']): CardSnapshot => {
    const base = readyV5Snapshot({ efforts })
    const saving = base.config.presets.saving
    return {
      ...base,
      config: {
        ...base.config,
        presets: {
          ...base.config.presets,
          saving: { ...saving, default: { ...saving.default, effort: 'high' } },
        },
      },
    }
  }

  const mount = async (store: CardStore, extra: Record<string, unknown> = {}): Promise<void> => {
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, {
        scope: null,
        connection: null,
        close: () => {},
        storeFactory: () => store,
        ...extra,
      }))
    })
  }

  it('⑤ 档位表 null（取数失败）：存量 effort 仍如实显示，不谎报「跟随默认」', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => {
      publish(snapshotWithStoredEffort(null))
    })
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="默认模型 · 档位"]')
    expect(select).not.toBeNull()
    // Fails if: EffortSelect 把已存 effort 显示成「跟随默认」——运行期由
    // 支持集判定（effortForTarget），显示层必须如实反映存量值。
    expect(select!.value).toBe('high')
    expect([...select!.options].some((o) => o.value === 'high')).toBe(true)
    // 无选项集仍保持禁用（不可改选），但显示不撒谎。
    expect(select!.disabled).toBe(true)
  })

  it('⑤ 档位表存在但存量值不在支持集（漂移）：以额外选项如实显示且可选', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => {
      publish(snapshotWithStoredEffort({ 'deepseek-official/deepseek-v4-flash': ['off'] }))
    })
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="默认模型 · 档位"]')
    expect(select).not.toBeNull()
    // Fails if: 存量 effort 不在档位表选项集时被显示层静默吞成「跟随默认」。
    expect(select!.value).toBe('high')
    expect(select!.disabled).toBe(false)
    expect([...select!.options].map((o) => o.value)).toEqual(['', 'high', 'off'])
  })

  it('④ catalogScope 变更通知 → 重取档位表；卸载退订', async () => {
    const listeners = new Set<() => void>()
    const catalogScope = {
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    }
    const loadEfforts = vi.fn(async () => {})
    const { store } = makeDeferredStore({ loadEfforts })
    await mount(store, { fetchEfforts: async () => ({}), catalogScope })
    // 挂载即首取（既有行为）+ 订阅恰好一次。
    expect(loadEfforts).toHaveBeenCalledTimes(1)
    // Fails if: 卡片不订阅 catalogScope（kimi-tide-catalog 命名空间推送缝）。
    expect(listeners.size).toBe(1)
    await act(async () => {
      for (const listener of [...listeners]) listener()
    })
    // Fails if: 档位表不随命名空间更新重取（④：efforts 表挂载时取一次，adapters 后更新不刷新）。
    expect(loadEfforts).toHaveBeenCalledTimes(2)
    await act(async () => {
      root!.unmount()
    })
    root = undefined
    // Fails if: 订阅未随卡片卸载解除（副作用必须可逆）。
    expect(listeners.size).toBe(0)
  })
})

describe('SettingsCard 0.6.x池#c/#7 界外输入钳制 + 新建流', () => {
  let container: HTMLDivElement
  let root: Root | undefined

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(async () => {
    if (root !== undefined) {
      await act(async () => {
        root!.unmount()
      })
      root = undefined
    }
    container.remove()
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
  })

  function fireInput(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('#c 评审轮次界外输入回显钳制值：9 → 落盘 3', async () => {
    const saveFlows = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveFlows })
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
    await act(async () => {
      publish(readyV5Snapshot())
    })
    const input = container.querySelector<HTMLInputElement>('input[aria-label="review 评审轮次"]')
    expect(input).not.toBeNull()
    await act(async () => {
      fireInput(input!, '9')
    })
    // Fails if: 界外输入被静默忽略（显示与落盘分叉——池#c）。
    expect(saveFlows).toHaveBeenCalledWith(expect.objectContaining({
      review: expect.objectContaining({ rounds: 3 }),
    }))
  })

  it('#c 最少命中词数 0 → 钳制为 1 落盘', async () => {
    const savePreset = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ savePreset })
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
    await act(async () => {
      publish(readyV5Snapshot())
    })
    const input = container.querySelector<HTMLInputElement>('input[aria-label$="最少命中词数"]')
    expect(input).not.toBeNull()
    await act(async () => {
      fireInput(input!, '0')
    })
    expect(savePreset).toHaveBeenCalledWith('saving', expect.objectContaining({
      rules: expect.arrayContaining([expect.objectContaining({ when: expect.objectContaining({ minHits: 1 }) })]),
    }))
  })

  it('#7 新建流：id + 类型 → saveFlows 合并新流（预置模板）', async () => {
    const saveFlows = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveFlows })
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
    await act(async () => {
      publish(readyV5Snapshot())
    })
    const idInput = container.querySelector<HTMLInputElement>('input[aria-label="新建流 id"]')
    // Fails if: 协作流手风琴无新建入口（自建流只能手写配置文件）。
    expect(idInput).not.toBeNull()
    await act(async () => {
      fireInput(idInput!, 'my')
    })
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="新建流"]')
    expect(btn).not.toBeNull()
    expect(btn!.disabled).toBe(false)
    await act(async () => {
      btn!.click()
    })
    expect(saveFlows).toHaveBeenCalledWith(expect.objectContaining({
      my: expect.objectContaining({ type: 'transcribe' }),
    }))
  })

  it('#7 空 id → 新建按钮禁用；id 与预置冲突 → 自动 -2 后缀', async () => {
    const saveFlows = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveFlows })
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
    await act(async () => {
      publish(readyV5Snapshot())
    })
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="新建流"]')
    expect(btn!.disabled).toBe(true)
    await act(async () => {
      fireInput(container.querySelector<HTMLInputElement>('input[aria-label="新建流 id"]')!, 'transcribe')
    })
    expect(btn!.disabled).toBe(false)
    await act(async () => {
      btn!.click()
    })
    expect(saveFlows).toHaveBeenCalledWith(expect.objectContaining({
      transcribe: expect.anything(),
      'transcribe-2': expect.objectContaining({ type: 'transcribe' }),
    }))
  })
})

describe('SettingsCard ⑥-B 三页签', () => {
  let container: HTMLDivElement
  let root: Root | undefined

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(async () => {
    if (root !== undefined) {
      await act(async () => {
        root!.unmount()
      })
      root = undefined
    }
    container.remove()
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
  })

  it('默认路由页；切协作流/测试场仅 CSS 可见性切换（区块保持挂载，既有选择器零改动）', async () => {
    const { store, publish } = makeDeferredStore()
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
    await act(async () => {
      publish(readyV5Snapshot())
    })
    const card = container.querySelector('.kimi-tide-settings')!
    // Fails if: 页签导航缺失（默认路由页）。
    expect(card.getAttribute('data-tab')).toBe('route')
    expect(container.querySelectorAll('button.kt-tab')).toHaveLength(3)
    // Fails if: 页签点击不切换 data-tab（CSS 可见性切换失效）。
    await act(async () => {
      ;[...container.querySelectorAll('button.kt-tab')].find((b) => b.textContent === '协作流')!.click()
    })
    expect(card.getAttribute('data-tab')).toBe('flows')
    // 区块保持挂载：CSS display:none 切换，DOM 不卸载（既有测试选择器兼容）。
    expect(container.querySelector('details.kt-flows')).not.toBeNull()
    await act(async () => {
      ;[...container.querySelectorAll('button.kt-tab')].find((b) => b.textContent === '测试场')!.click()
    })
    expect(card.getAttribute('data-tab')).toBe('trial')
    expect(container.querySelector('details.kt-trial')).not.toBeNull()
  })
})

describe('SettingsCard 规则条件互斥（⑥-B 打磨三 2026-08-29）', () => {
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

  /** 重复条件夹具：saving 预设两条同条件带图规则（用户截图死规则形态）。 */
  const dupImageConfig = (): RouterConfigV4 => {
    const cfg: RouterConfigV4 = { ...DEFAULT_CONFIG_V4(), activePreset: 'saving' }
    const saving = cfg.presets.saving
    const img = saving.rules.find((r) => r.when.kind === 'image')!
    return { ...cfg, presets: { ...cfg.presets, saving: { ...saving, rules: [img, { ...img, id: 'image-dup' }] } } }
  }

  it('存量重复 → 警示条 + 涉事行标记 + 「删除重复项」一键去重落盘', async () => {
    const saves: Array<{ id: string; count: number }> = []
    const { store, publish } = makeDeferredStore({
      savePreset: async (id, preset) => {
        saves.push({ id, count: preset.rules.length })
      },
    })
    await mount(store)
    await act(async () => {
      publish({ ...readySnapshot(), config: dupImageConfig() })
    })
    // Fails if: 重复条件零提示（死规则不可见——2026-08-29 用户裁定互斥约束）
    expect(container.textContent).toContain('检测到重复条件')
    expect(container.querySelectorAll('.kt-conflict').length).toBe(1)
    const cleanup = [...container.querySelectorAll('button')].find((b) => b.textContent === '删除重复项')
    expect(cleanup).not.toBeUndefined()
    await act(async () => {
      cleanup!.click()
    })
    // Fails if: 一键清理缺失（用户须手删死规则）
    expect(saves).toEqual([{ id: 'saving', count: 1 }])
  })

  it('带图已占用 → 新增自动选未占用条件落盘（修订「不能新增」）', async () => {
    const saves: Array<{ id: string; rules: Array<{ when: { kind: string; group?: string; minHits?: number } }> }> = []
    const { store, publish } = makeDeferredStore({
      savePreset: async (id, preset) => {
        saves.push({ id, rules: preset.rules })
      },
    })
    await mount(store)
    await act(async () => {
      publish(readySnapshot())
    })
    const add = [...container.querySelectorAll('button')].find((b) => b.textContent === '新增规则')
    expect(add).not.toBeUndefined()
    await act(async () => {
      add!.click()
    })
    // Fails if: 新增被一刀切阻止（带图占用时永远加不了规则——用户实测 2026-08-29）
    expect(saves.length).toBe(1)
    expect(saves[0].rules.length).toBe(4)  // readySnapshot 默认 3 条 + 新增 1 条
    // 新条件不与既有重复（互斥守卫在自动选条件后仍成立）
    const keys = saves[0].rules.map((r) => (r.when.kind === 'image' ? 'image' : `${r.when.group}:${r.when.minHits ?? 1}`))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('所有条件占满（无关键词组可进档）→ 阻止 + 提示', async () => {
    const saveSpy = vi.fn()
    const { store, publish } = makeDeferredStore({ savePreset: saveSpy })
    await mount(store)
    const cfg: RouterConfigV4 = { ...DEFAULT_CONFIG_V4(), activePreset: 'saving', keywordGroups: {} }
    cfg.presets.saving = {
      ...cfg.presets.saving,
      rules: [{ id: 'only-image', when: { kind: 'image' }, target: { provider: 'p', model: 'm' } }],
    }
    await act(async () => {
      publish({ ...readySnapshot(), config: cfg })
    })
    const add = [...container.querySelectorAll('button')].find((b) => b.textContent === '新增规则')
    expect(add).not.toBeUndefined()
    await act(async () => {
      add!.click()
    })
    // Fails if: 无可用条件时静默无反馈
    expect(saveSpy).not.toHaveBeenCalled()
    expect(container.textContent).toContain('没有可用条件')
  })
})
