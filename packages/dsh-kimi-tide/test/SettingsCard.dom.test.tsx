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
import { EXAMPLE_ROLE_GROUPS, SettingsCard } from '../src/client/SettingsCard.js'
import type { CardSnapshot, CardStore } from '../src/client/card-store.js'
import { attachLocaleService } from '../src/client/locale.js'
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, DEFAULT_CONFIG_V6, type RouterConfigV4 } from '../src/config.js'
import { formatCopy } from '../src/locales/index.js'
import { claimConflict } from '../src/roles.js'

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
    saveRoles: async () => {},
    saveDriver: async () => {},
    saveDriverSticky: async () => {},
    saveRulesApplyToChildren: async () => {},
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
    // 真实定时器等待（fake timers 与 React 调度器相互冲突，2026-08-29 实测）：
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

  it('1.4.1 状态位在 .kt-status-slot 里（绝对定位槽 = 闪现不再顶动下方内容）', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => { publish(readySnapshot()) })
    await act(async () => { buttonByText('省钱').click() })
    // Fails if: 「已保存」退回文档流（每次落盘都把设置页内容顶下去再弹回——实机反馈）
    expect(container.querySelector('.kt-status-slot .kt-saved')).not.toBeNull()
    await act(async () => { publish({ ...readySnapshot(), error: 'boom' }) })
    // 错误横幅同槽：两者都在槽内并排，且槽本身不参与流布局（CSS 侧见 ClientStyles 钉）
    expect(container.querySelector('.kt-status-slot .kt-error')).not.toBeNull()
    expect(container.querySelectorAll('.kt-status-slot').length).toBe(1)
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

  it('A8 盲区可见性（1.1.0）：组认领 + reviewer 不在挂载表 → 试一句标注「评审模型不可用」', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    // 评审流 keywords 触发 + 认领 review 组（review-flow.test v5Claimed 同款形状）；
    // mounted 表缺 reviewer（kimi-coding/k3）——复刻实机 ghost-reviewer 形态
    // （availability 对自挂 provider 不落键，三态判定判不出不可用）。
    const snapshot = readyV5Snapshot({ mounted: ['kimi-coding/kimi-for-coding'] })
    const config = snapshot.config as RouterConfigV4 & { version: number; flows: Record<string, { trigger: string; keywordGroup?: string }> }
    config.flows = { ...config.flows, review: { ...config.flows.review, trigger: 'keywords', keywordGroup: 'review' } }
    await act(async () => { publish(snapshot) })
    const input = container.querySelector<HTMLInputElement>('input[aria-label="试一句"]')
    expect(input).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '帮我评审一下这个方案')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // Fails if: review-flow outcome 照常显示但盲区无标注（2026-09-04 实机缺陷）
    expect(container.textContent).toContain('评审流已认领但评审模型不可用')
  })

  it('A8 对照：reviewer 在挂载表 → 试一句不误标「不可用」', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    const snapshot = readyV5Snapshot({ mounted: ['kimi-coding/k3'] })
    const config = snapshot.config as RouterConfigV4 & { version: number; flows: Record<string, { trigger: string; keywordGroup?: string }> }
    config.flows = { ...config.flows, review: { ...config.flows.review, trigger: 'keywords', keywordGroup: 'review' } }
    await act(async () => { publish(snapshot) })
    const input = container.querySelector<HTMLInputElement>('input[aria-label="试一句"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '帮我评审一下这个方案')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // 断言作用域收窄到「试一句」结果区：说明页签恒挂载（设计要求：区块不卸载），
    // 其正文里合法地会出现「评审模型不可用」等字样，整卡断言不再成立。
    const trial = container.querySelector('.kt-trial-result')!
    expect(trial.textContent).toContain('轮末触发评审流')
    expect(trial.textContent).not.toContain('不可用')
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

  /** 复选框点击（React 的 change 事件由 click 触发）。 */
  function fireInputCheck(input: HTMLInputElement, checked: boolean): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set
    setter?.call(input, checked)
    input.dispatchEvent(new Event('click', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
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

  /**
   * 候选缺陷 F-A4b 复现（2026-09-04 实机验收记录）：协作流页里切换**无关字段**
   * （触发方式 keywords→manual→keywords）后 `settings.yaml` 的 `autoRevise: true`
   * 被静默写成 `false`，而页内复选框仍显示 on。
   *
   * 本用例钉**客户端这一半**：两次切换的 payload 都必须带上 `autoRevise: true`
   * ——`onChange` 用的是 `{ ...flow, trigger }` spread，若哪天改成只挑字段构造，
   * 这里立刻红。若本用例绿而实机仍丢，则说明丢在 store/schema 落盘链，排查方向
   * 随之收窄（这正是先钉这半的价值）。
   */
  it('F-A4b：切触发方式不改 autoRevise（两次切换 payload 都带 true）', async () => {
    const saveFlows = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveFlows })
    const base = readyV5Snapshot()
    const flows = {
      ...base.config!.flows,
      review: { ...base.config!.flows.review, trigger: 'keywords' as const, keywordGroup: 'review', autoRevise: true },
    }
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
    await act(async () => {
      publish({ ...base, config: { ...base.config!, flows } })
    })
    const trigger = container.querySelector<HTMLSelectElement>('select[aria-label="review 触发方式"]')
    expect(trigger).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>('input[aria-label="review 自动修订"]')!.checked).toBe(true)

    await act(async () => { fireSelectChange(trigger!, 'manual') })
    await act(async () => { fireSelectChange(trigger!, 'keywords') })

    // Fails if: 切换无关字段把 autoRevise 丢了（payload 里缺席或变 false）
    expect(saveFlows).toHaveBeenCalledTimes(2)
    for (const call of saveFlows.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({
        review: expect.objectContaining({ autoRevise: true }),
      }))
    }
  })

  /**
   * v1.4.0 评审闭环（spec §3.5/§4）：`recheck` 默认开——存量配置**没有这个键**
   * 也要显示为勾选（语义 `!== false`），取消勾选显式落盘 `false`；同时页面上
   * 必须写清代价（多一轮评审 + 修订次数上限）。
   */
  it('v1.4.0：复检默认勾选（缺键亦然）、取消勾选落盘 false、配额提示在页内', async () => {
    const saveFlows = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveFlows })
    const base = readyV5Snapshot()
    const flows = {
      ...base.config!.flows,
      review: { ...base.config!.flows.review, trigger: 'keywords' as const, keywordGroup: 'review', autoRevise: true },
    }
    // 存量形态：显式删掉 recheck 键（模拟升级前写下的配置）
    delete (flows.review as { recheck?: boolean }).recheck
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
    await act(async () => {
      publish({ ...base, config: { ...base.config!, flows } })
    })

    const recheck = container.querySelector<HTMLInputElement>('input[aria-label="review 复检"]')
    expect(recheck).not.toBeNull()
    expect(recheck!.checked).toBe(true) // Fails if: 缺键被当成关（默认开是用户裁定）

    await act(async () => { fireInputCheck(recheck!, false) })
    expect(saveFlows).toHaveBeenCalledWith(expect.objectContaining({
      review: expect.objectContaining({ recheck: false }),
    }))
    // 配额护栏（spec §3.5）：设置页必须明示「多花调用 + 上限」（上限口径 = 每会话，复核 F4）
    expect(container.textContent).toContain('本会话该流最多修订')
  })

  /**
   * 1.4.1（2026-10-03 桌面端实机缺陷）：「模型能力没法设置」——路由页的档位下拉
   * 在宿主未声明档位时是禁用的，但唯一项的文案只说「跟随默认」，用户只能猜。
   * 现在文案自解释；声明了档位的模型照旧可选、可写。
   */
  it('1.4.1：档位下拉——未声明档位时禁用且文案自解释；声明后可改', async () => {
    const savePreset = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ savePreset })
    const base = readyV5Snapshot({ efforts: {} })
    const dft = base.config!.presets[base.config!.activePreset!]!.default
    const key = `${dft.provider}/${dft.model}`
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
    await act(async () => { publish(base) })

    let effort = container.querySelector<HTMLSelectElement>('select[aria-label="默认模型 · 档位"]')
    expect(effort).not.toBeNull()
    // Fails if: 空表被当成「有档位表但该模型没声明」以外的语义 / 文案退回裸「跟随默认」
    expect(effort!.disabled).toBe(true)
    expect(effort!.options[0]!.textContent).toBe('跟随默认（该模型未声明档位）')

    await act(async () => { publish(readyV5Snapshot({ efforts: { [key]: ['low', 'high', 'max'] } })) })
    effort = container.querySelector<HTMLSelectElement>('select[aria-label="默认模型 · 档位"]')
    expect(effort!.disabled).toBe(false)
    expect([...effort!.options].map((o) => o.textContent)).toEqual(['跟随默认', 'low', 'high', 'max'])
    await act(async () => { fireSelectChange(effort!, 'high') })
    // Fails if: 选了档位不落盘（D3 写路径断链）
    expect(savePreset).toHaveBeenCalledWith(base.config!.activePreset, expect.objectContaining({
      default: { provider: dft.provider, model: dft.model, effort: 'high' },
    }))
  })

  /**
   * 1.4.1：评审行补档位下拉（撤销 M7）——与转述行同款；改选经 saveFlows 整段落盘到
   * flows.review.reviewer.effort，且不丢 reviewer 其余字段。
   */
  it('1.4.1：评审行档位下拉（宿主声明 low/high/max）→ 改选落盘 reviewer.effort', async () => {
    const saveFlows = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveFlows })
    const base = readyV5Snapshot({ efforts: { 'kimi-coding/k3': ['low', 'high', 'max'] } })
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
    await act(async () => { publish(base) })

    // 1.4.1 顺带修的可访问性缺陷：模型下拉与档位下拉此前共用 aria-label
    // （「review 评审模型」），读屏/选择器都分不出两个控件——档位一律带「· 档位」后缀。
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="review 评审模型 · 档位"]')
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="review 评审模型"]')).not.toBeNull()
    // Fails if: 评审行不渲染档位控件（M7 撤销未落到 UI）
    expect(select).not.toBeNull()
    expect([...select!.options].map((o) => o.value)).toEqual(['', 'low', 'high', 'max'])
    await act(async () => { fireSelectChange(select!, 'high') })
    expect(saveFlows).toHaveBeenCalledWith(expect.objectContaining({
      review: expect.objectContaining({
        reviewer: { provider: 'kimi-coding', model: 'k3', effort: 'high' },
      }),
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

describe('SettingsCard ⑥-B 页签（四页签 + tabpanel 语义）', () => {
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
    expect(container.querySelectorAll('button.kt-tab')).toHaveLength(4)
    // Fails if: 页签点击不切换 data-tab（可见性切换失效）。
    await act(async () => {
      ;[...container.querySelectorAll('button.kt-tab')].find((b) => b.textContent === '协作流')!.click()
    })
    expect(card.getAttribute('data-tab')).toBe('flows')
    // 区块保持挂载：hidden 切换，DOM 不卸载（既有测试选择器兼容）。
    expect(container.querySelector('details.kt-flows')).not.toBeNull()
    await act(async () => {
      ;[...container.querySelectorAll('button.kt-tab')].find((b) => b.textContent === '测试场')!.click()
    })
    expect(card.getAttribute('data-tab')).toBe('trial')
    expect(container.querySelector('details.kt-trial')).not.toBeNull()
    await act(async () => {
      ;[...container.querySelectorAll('button.kt-tab')].find((b) => b.textContent === '说明')!.click()
    })
    expect(card.getAttribute('data-tab')).toBe('help')
    expect(container.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1)
  })

  it('四页签完整 tab/tabpanel 语义 + 键盘 ←/→/Home/End（2026-09-15 还 UI 评审 C11/N5 债）', async () => {
    const { store, publish } = makeDeferredStore()
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
    await act(async () => {
      publish(readyV5Snapshot())
    })
    const card = container.querySelector('.kimi-tide-settings')!
    const tabs = [...container.querySelectorAll('button.kt-tab')]
    expect(tabs.map((b) => b.textContent)).toEqual(['路由', '协作流', '测试场', '说明'])
    // Fails if: 页签只有 role=tab 而无 tabpanel/aria-controls/aria-labelledby（读屏无法定位面板）
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(4)
    for (const tab of tabs) {
      const id = tab.getAttribute('id')
      const controls = tab.getAttribute('aria-controls')
      expect(id).not.toBeNull()
      expect(controls).not.toBeNull()
      const panel = container.querySelector(`[id="${controls}"]`)!
      expect(panel).not.toBeNull()
      expect(panel.getAttribute('role')).toBe('tabpanel')
      expect(panel.getAttribute('aria-labelledby')).toBe(id)
    }
    // 非活动面板 hidden：保持挂载但不进无障碍树
    // id 是实例级（useId 产出 `:rN:` 前缀），故用属性选择器而不是 `#id` 选择器
    // ——jsdom 的 dom-selector 对 `#:r0:…` 报 Invalid selector。
    const panelOf = (tab: Element): HTMLElement =>
      container.querySelector<HTMLElement>(`[id="${tab.getAttribute('aria-controls')!}"]`)!
    expect(panelOf(tabs[0]!).hidden).toBe(false)
    expect(panelOf(tabs[3]!).hidden).toBe(true)
    // Fails if: 方向键不切换页签（只能鼠标点）
    await act(async () => {
      tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(card.getAttribute('data-tab')).toBe('flows')
    await act(async () => {
      tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    expect(card.getAttribute('data-tab')).toBe('help')
    // roving tabindex（评审 #6）：选中项 tabIndex=0、其余 -1，aria-selected 同步
    const atHelp = [...container.querySelectorAll('button.kt-tab')]
    expect(atHelp.map((b) => b.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'true'])
    expect(atHelp.map((b) => b.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '0'])
    await act(async () => {
      tabs[3]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(card.getAttribute('data-tab')).toBe('route')
    // 循环回路由页后 roving 跟着回位
    expect([...container.querySelectorAll('button.kt-tab')].map((b) => b.getAttribute('tabindex')))
      .toEqual(['0', '-1', '-1', '-1'])
    // 修饰键不吞（评审 #7）：Alt+→ 不改页签（浏览器历史导航等系统行为不该被 preventDefault）
    await act(async () => {
      ;[...container.querySelectorAll('button.kt-tab')][0]!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }),
      )
    })
    expect(card.getAttribute('data-tab')).toBe('route')
  })

  it('说明页签渲染八个分区（症状表靠前）且只读（无按钮/表单控件）', async () => {
    const { store, publish } = makeDeferredStore()
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
    await act(async () => {
      publish(readyV5Snapshot())
    })
    await act(async () => {
      ;[...container.querySelectorAll('button.kt-tab')].find((b) => b.textContent === '说明')!.click()
    })
    const panel = container.querySelector('[role="tabpanel"]:not([hidden])')!
    // 八分区标题齐
    for (const title of ['面板速览', '常见疑问', '路由语义', '关键词与匹配', '协作流', '用量与余额', '术语表', '命令清单']) {
      expect(panel.textContent).toContain(title)
    }
    // Fails if: 说明页长出可写控件（出现第二个写入口）
    expect(panel.querySelectorAll('button')).toHaveLength(0)
    expect(panel.querySelectorAll('input, select, textarea')).toHaveLength(0)
  })

  // 评审遗留（2026-09-15 UI 评审 #8，本次修）：页签 id 原为静态 `kt-tab-<key>` /
  // `kt-panel-<key>`，同页挂两张卡（设置页 + 测试场/多入口）即 id 撞车：`aria-controls`
  // 变成指向**另一张卡**的面板（读屏定位到错的面板），`#kt-panel-help` 这类选择器也
  // 只命中第一张。改法 = useId 生成实例级 id，页签键改走 `data-kt-tab`（不再从 id 反推）。
  it('同页挂两张卡：页签/面板 id 不撞车，aria-controls 各自指向本卡面板（UI 评审 #8）', async () => {
    const a = makeDeferredStore()
    const b = makeDeferredStore()
    const cardA = document.createElement('div')
    const cardB = document.createElement('div')
    document.body.appendChild(cardA)
    document.body.appendChild(cardB)
    const rootA = createRoot(cardA)
    const rootB = createRoot(cardB)
    try {
      await act(async () => {
        rootA.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => a.store }))
        rootB.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => b.store }))
      })
      await act(async () => {
        a.publish(readyV5Snapshot())
        b.publish(readyV5Snapshot())
      })

      const idsOf = (host: HTMLElement): string[] =>
        [...host.querySelectorAll('[role="tab"], [role="tabpanel"]')].map((el) => el.id).filter((id) => id !== '')
      const all = [...idsOf(cardA), ...idsOf(cardB)]
      // Fails if: id 仍是静态串（两张卡产出同一批 id）
      expect(new Set(all).size).toBe(all.length)
      expect(all.length).toBeGreaterThanOrEqual(8)

      // Fails if: aria-controls 指向另一张卡的面板（跨卡串味）
      for (const [host, other] of [[cardA, cardB], [cardB, cardA]] as const) {
        for (const tab of [...host.querySelectorAll('[role="tab"]')]) {
          const id = tab.getAttribute('aria-controls')!
          expect(host.querySelector(`[id="${id}"]`)).not.toBeNull()
          expect(other.querySelector(`[id="${id}"]`)).toBeNull()
        }
      }
    } finally {
      await act(async () => {
        rootA.unmount()
        rootB.unmount()
      })
      cardA.remove()
      cardB.remove()
    }
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

  it('2026-09-20 回归钉住：评审流认领某组 ⇒ 在改 trigger 那一行列出将被抑制的预设规则', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    // 实机形态：把评审流从 manual 改成 keywords（出厂默认的 review-k3 规则此刻起被
    // 静态抑制、永不生效，而规则列表里它照常显示）。
    const snapshot = readyV5Snapshot()
    const config = snapshot.config as typeof snapshot.config & {
      flows: Record<string, { trigger: string; keywordGroup?: string }>
    }
    config.flows = { ...config.flows, review: { ...config.flows.review, trigger: 'keywords', keywordGroup: 'review' } }
    await act(async () => { publish(snapshot) })

    // Fails if: 代价只在规则列表里给一句小字（用户不翻到那一页就永远看不见），
    // 或冲突列表漏掉规则所属预设（多预设同名规则时无法定位）。
    expect(container.textContent).toContain('下列预设规则将不再参与路由')
    expect(container.textContent).toContain('review-k3（能力）')
  })
})

describe('SettingsCard 分工表卡（Task 7：角色编辑器 + 示例一键填入）', () => {
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
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
  })

  const mount = async (store: CardStore): Promise<void> => {
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
  }

  /** Task 7 夹具：v6 就绪快照（含分工层默认：roles={} / driverSticky=true），激活省钱预设。 */
  const readyV6Snapshot = (overrides: Partial<CardSnapshot> = {}): CardSnapshot => ({
    status: 'ready',
    config: { ...DEFAULT_CONFIG_V6(), activePreset: 'saving' },
    base: null,
    user: null,
    writable: true,
    error: null,
    catalog: null,
    availability: null,
    efforts: null,
    ...overrides,
  })

  it('分工表卡渲染在「路由」页；点「填入工程示例」/「填入业务示例」→ saveRoles 各收到本组 6 个角色，目标兜底 = 激活预设默认模型', async () => {
    // 钉住的占位策略（brief 步骤 6 二选一）：宿主 validate 要求 role.target 完整
    // （provider/model 非空），空串占位必被拒写——示例目标取「激活预设 default」
    // 兜底（无激活预设时取候选池首个），用户可再在下拉里改。
    const saveRoles = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveRoles })
    await mount(store)
    await act(async () => { publish(readyV6Snapshot()) })
    expect(container.textContent).toContain('分工表')
    await act(async () => {
      ;[...container.querySelectorAll('button')].find((b) => b.textContent === '填入工程示例')!.click()
    })
    expect(saveRoles).toHaveBeenCalledTimes(1)
    const engineering = saveRoles.mock.calls[0][0] as Record<string, { id: string; label: string; target: { provider: string; model: string } }>
    expect(Object.keys(engineering)).toEqual(['frontend', 'backend', 'devops', 'qa', 'data', 'security'])
    expect(engineering.frontend).toEqual({ id: 'frontend', label: '前端', target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    expect(engineering.backend!.label).toBe('后端')
    expect(engineering.devops!.label).toBe('运维部署')
    expect(engineering.qa!.label).toBe('测试')
    expect(engineering.data!.label).toBe('数据')
    expect(engineering.security!.label).toBe('安全')
    for (const role of Object.values(engineering)) {
      expect(role.target).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    }
    await act(async () => {
      ;[...container.querySelectorAll('button')].find((b) => b.textContent === '填入业务示例')!.click()
    })
    expect(saveRoles).toHaveBeenCalledTimes(2)
    const business = saveRoles.mock.calls[1][0] as Record<string, { id: string; label: string; target: { provider: string; model: string } }>
    expect(Object.keys(business)).toEqual(['writer', 'marketing', 'sales', 'support', 'finance', 'legal'])
    expect(business.writer!.label).toBe('写作')
    expect(business.marketing!.label).toBe('市场')
    expect(business.sales!.label).toBe('销售')
    expect(business.support!.label).toBe('客服')
    expect(business.finance!.label).toBe('财务')
    expect(business.legal!.label).toBe('法务')
    for (const role of Object.values(business)) {
      expect(role.target).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    }
    // 回读渲染：发布含示例分工表的快照 → 工程组六条角色行（角色显示名输入框逐行可见）
    await act(async () => {
      publish(readyV6Snapshot({ config: { ...DEFAULT_CONFIG_V6(), activePreset: 'saving', roles: engineering } }))
    })
    const labels = [...container.querySelectorAll('input[aria-label="角色显示名"]')] as HTMLInputElement[]
    expect(labels.map((i) => i.value)).toEqual(['前端', '后端', '运维部署', '测试', '数据', '安全'])
    const ids = [...container.querySelectorAll('input[aria-label="角色 id"]')] as HTMLInputElement[]
    expect(ids.map((i) => i.value)).toEqual(['frontend', 'backend', 'devops', 'qa', 'data', 'security'])
  })

  it('W8 示例集合自身无认领冲突：12 个 id 互不相同，claimConflict 返回 undefined', () => {
    // 防后人加示例时撞名——claimConflict 的语义：任一认领名（含 role.id）不得被他 role 认领。
    const groups = EXAMPLE_ROLE_GROUPS({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(Object.keys(groups).sort()).toEqual(['business', 'engineering'])
    const merged = { ...groups.engineering, ...groups.business }
    const keys = Object.keys(merged)
    expect(keys).toHaveLength(12)
    // 键与 id 不脱节（claimConflict 只认 role.id，键只是存储形式）。
    for (const key of keys) expect(merged[key]!.id).toBe(key)
    expect(new Set(keys.map((key) => merged[key]!.id)).size).toBe(12)
    expect(claimConflict(merged)).toBeUndefined()
  })

  it('W8 合并语义：已有同名角色时点示例按钮 ⇒ 该角色不被示例覆盖（保留用户已填的 label/target）', async () => {
    const saveRoles = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveRoles })
    await mount(store)
    const cfg = { ...DEFAULT_CONFIG_V6(), activePreset: 'saving' as string | null }
    cfg.roles = { frontend: { id: 'frontend', label: '我的前端', target: { provider: 'kimi-coding', model: 'k3' } } }
    await act(async () => { publish(readyV6Snapshot({ config: cfg })) })
    await act(async () => {
      ;[...container.querySelectorAll('button')].find((b) => b.textContent === '填入工程示例')!.click()
    })
    expect(saveRoles).toHaveBeenCalledTimes(1)
    const record = saveRoles.mock.calls[0][0] as Record<string, { id: string; label: string; target: { provider: string; model: string } }>
    // Fails if: 示例覆盖了用户已有的同名角色（合并方向写反）。
    expect(Object.keys(record)).toEqual(['frontend', 'backend', 'devops', 'qa', 'data', 'security'])
    expect(record.frontend).toEqual({ id: 'frontend', label: '我的前端', target: { provider: 'kimi-coding', model: 'k3' } })
    expect(record.devops).toEqual({ id: 'devops', label: '运维部署', target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
  })

  it('「新增角色」→ saveRoles 合并一条新角色（kebab id、目标兜底 = 激活预设默认）', async () => {
    const saveRoles = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveRoles })
    await mount(store)
    await act(async () => { publish(readyV6Snapshot()) })
    await act(async () => {
      ;[...container.querySelectorAll('button')].find((b) => b.textContent === '新增角色')!.click()
    })
    expect(saveRoles).toHaveBeenCalledTimes(1)
    const record = saveRoles.mock.calls[0][0] as Record<string, { id: string; target: { provider: string; model: string } }>
    const newIds = Object.keys(record)
    expect(newIds).toHaveLength(1)
    expect(newIds[0]).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(record[newIds[0]]!.target).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })
})

describe('SettingsCard 主驱动卡（Task 7 修复轮 1：driver / driverSticky / rulesApplyToChildren 控件）', () => {
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

  /** 修复轮 1 夹具：v6 就绪快照（driver=null / driverSticky=true / rulesApplyToChildren 缺省），激活省钱预设。 */
  const readyV6Snapshot = (overrides: Partial<CardSnapshot> = {}): CardSnapshot => ({
    status: 'ready',
    config: { ...DEFAULT_CONFIG_V6(), activePreset: 'saving' },
    base: null,
    user: null,
    writable: true,
    error: null,
    catalog: null,
    availability: null,
    efforts: null,
    ...overrides,
  })

  it('主驱动卡渲染在「路由」页：driver 选择器含「跟随宿主默认」档（缺省选中），两开关按字段判据回显', async () => {
    // Fails if: 主驱动卡未渲染 / driver 选择器没有 null 档——v6 三键回到「只有帮助
    // 条目、没有编辑器」的状态（设计稿 §8-1「设置页可一键打开」的承诺落空）。
    const { store, publish } = makeDeferredStore()
    await mount(store)
    await act(async () => { publish(readyV6Snapshot()) })
    expect(container.textContent).toContain('主驱动')
    const select = container.querySelector('select[aria-label="主驱动目标"]') as HTMLSelectElement | null
    expect(select).not.toBeNull()
    const optionTexts = [...select!.options].map((o) => o.textContent)
    expect(optionTexts).toContain('跟随宿主默认')
    expect(select!.value).toBe('')  // driver null/缺省 = 跟随宿主默认档
    const sticky = container.querySelector('input[aria-label="主驱动恒定"]') as HTMLInputElement
    expect(sticky.checked).toBe(true)  // DEFAULT_CONFIG_V6 新装默认 true
    const children = container.querySelector('input[aria-label="子代理参与关键词规则"]') as HTMLInputElement
    expect(children.checked).toBe(false)  // 缺省 = false（v2.0.0 新语义：子代理不参与关键词规则）
  })

  it('driver 选择器改选：模型档 → saveDriver(RouteTarget)；「跟随宿主默认」档 → saveDriver(null)', async () => {
    const saveDriver = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveDriver })
    await mount(store)
    await act(async () => {
      publish(readyV6Snapshot({
        config: { ...DEFAULT_CONFIG_V6(), activePreset: 'saving', driver: { provider: 'kimi-coding', model: 'k3' } },
      }))
    })
    const select = container.querySelector('select[aria-label="主驱动目标"]') as HTMLSelectElement
    expect(select.value).toBe('kimi-coding/k3')  // 存量 driver 回显（k3 在内置预设目标池里）
    await act(async () => { fireSelectChange(select, '') })
    expect(saveDriver).toHaveBeenCalledWith(null)
    await act(async () => { fireSelectChange(select, 'deepseek-official/deepseek-v4-flash') })
    expect(saveDriver).toHaveBeenLastCalledWith({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('两开关切换 → saveDriverSticky / saveRulesApplyToChildren 按勾选态写布尔；回读快照勾选态跟随', async () => {
    const saveDriverSticky = vi.fn(async () => {})
    const saveRulesApplyToChildren = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveDriverSticky, saveRulesApplyToChildren })
    await mount(store)
    await act(async () => { publish(readyV6Snapshot()) })
    const sticky = container.querySelector('input[aria-label="主驱动恒定"]') as HTMLInputElement
    await act(async () => { sticky.click() })
    expect(saveDriverSticky).toHaveBeenCalledWith(false)  // 默认 true → 点击 = 关
    const children = container.querySelector('input[aria-label="子代理参与关键词规则"]') as HTMLInputElement
    await act(async () => { children.click() })
    expect(saveRulesApplyToChildren).toHaveBeenCalledWith(true)  // 缺省 false → 点击 = 开
    // 回读：发布写入后的快照 → 勾选态跟随权威配置
    await act(async () => {
      publish(readyV6Snapshot({
        config: { ...DEFAULT_CONFIG_V6(), activePreset: 'saving', driverSticky: false, rulesApplyToChildren: true },
      }))
    })
    expect((container.querySelector('input[aria-label="主驱动恒定"]') as HTMLInputElement).checked).toBe(false)
    expect((container.querySelector('input[aria-label="子代理参与关键词规则"]') as HTMLInputElement).checked).toBe(true)
  })
})

describe('SettingsCard B 项交互（2026-10-07 设计稿 §5：重叠动作 / 派发预览 / 词表生成角色）', () => {
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

  /** B 项夹具：v6 就绪快照（分工层默认），激活省钱预设。 */
  const readyV6 = (overrides: Partial<CardSnapshot> = {}): CardSnapshot => ({
    status: 'ready',
    config: { ...DEFAULT_CONFIG_V6(), activePreset: 'saving' },
    base: null,
    user: null,
    writable: true,
    error: null,
    catalog: null,
    availability: null,
    efforts: null,
    ...overrides,
  })

  function fireInput(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('B3 一键动作：点「规则跟随该角色」→ savePreset 把引用该组的规则目标改为角色目标（既有写通道）', async () => {
    const savePreset = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ savePreset })
    await mount(store)
    const cfg = { ...DEFAULT_CONFIG_V6(), activePreset: 'saving' as string | null }
    cfg.roles = { coder: { id: 'coder', label: '代码工', target: { provider: 'zai-coding-cn', model: 'glm-5.3' }, aliases: ['代码'] } }
    await act(async () => { publish(readyV6({ config: cfg })) })
    // 词表侧 + 角色侧各一条解释条（§5.2 两侧各挂一条）
    expect(container.querySelectorAll('.kt-overlap').length).toBe(2)
    const btn = [...container.querySelectorAll<HTMLButtonElement>('.kt-overlap button')]
      .find((b) => b.textContent === '规则跟随该角色')!
    await act(async () => { btn.click() })
    // Fails if: 动作不走 storeWriter 既有写通道，或改的不是引用该词表组的规则目标。
    expect(savePreset).toHaveBeenCalledTimes(1)
    expect(savePreset).toHaveBeenCalledWith('saving', expect.objectContaining({
      rules: expect.arrayContaining([
        expect.objectContaining({ id: 'code-kfc', target: { provider: 'zai-coding-cn', model: 'glm-5.3' } }),
      ]),
    }))
  })

  it('B4「派给谁」：输入认领名 ⇒ 改道目标 + 依据 role + 角色 label；未认领 ⇒ unclaimed', async () => {
    const { store, publish } = makeDeferredStore()
    await mount(store)
    const cfg = { ...DEFAULT_CONFIG_V6(), activePreset: 'saving' as string | null }
    cfg.roles = { frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'k3' } } }
    await act(async () => { publish(readyV6({ config: cfg })) })
    const input = container.querySelector<HTMLInputElement>('input[aria-label="派给谁"]')
    expect(input).not.toBeNull()
    await act(async () => { fireInput(input!, 'frontend') })
    // Fails if: 命中分工表不显示改道目标 / 依据枚举 / 角色 label（§5.3）。
    expect(container.textContent).toContain('改道到 kimi-coding/k3')
    expect(container.textContent).toContain('依据：role')
    expect(container.textContent).toContain('「前端」')
    await act(async () => { fireInput(input!, 'nobody') })
    // Fails if: 未认领队友不按 unclaimed 口径展示（与派发台账依据枚举对齐）。
    expect(container.textContent).toContain('未被分工表认领')
    expect(container.textContent).toContain('依据：unclaimed')
  })

  it('B5「从词表生成角色」：未接入词表组批量生成角色（目标 = 激活预设默认模型，同示例填入按钮兜底）', async () => {
    const saveRoles = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveRoles })
    await mount(store)
    const cfg = { ...DEFAULT_CONFIG_V6(), activePreset: 'saving' as string | null }
    cfg.keywordGroups = { ...cfg.keywordGroups, spare: ['闲置词'], idle: ['另一词'] }
    await act(async () => { publish(readyV6({ config: cfg })) })
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === '从词表生成角色')! as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    await act(async () => { btn.click() })
    // Fails if: ① 生成不经 saveRoles 守卫通道（认领冲突失去拒写保护）；② 目标
    // 不是激活预设默认模型（§5.4 与示例填入按钮同款兜底）；③ 把非未接入组
    // （已被规则引用的内置 7 组）也生成了角色。
    expect(saveRoles).toHaveBeenCalledTimes(1)
    const record = saveRoles.mock.calls[0]![0] as Record<string, { id: string; label: string; target: { provider: string; model: string } }>
    expect(Object.keys(record).sort()).toEqual(['idle', 'spare'])
    expect(record['spare']).toEqual({ id: 'spare', label: 'spare', target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    expect(record['idle']!.label).toBe('idle')
  })

  it('B3 第二个一键动作：点「词并入该角色别名」→ saveRoles 把重叠词追加进该角色 aliases（守卫式写通道）', async () => {
    const saveRoles = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveRoles })
    await mount(store)
    const cfg = { ...DEFAULT_CONFIG_V6(), activePreset: 'saving' as string | null }
    // 重叠词经角色 label『代码』命中（aliases 为空）——验证「追加」路径。
    cfg.roles = { coder: { id: 'coder', label: '代码', target: { provider: 'zai-coding-cn', model: 'glm-5.3' } } }
    await act(async () => { publish(readyV6({ config: cfg })) })
    const btn = [...container.querySelectorAll<HTMLButtonElement>('.kt-overlap button')]
      .find((b) => b.textContent === '词并入该角色别名')!
    await act(async () => { btn.click() })
    // Fails if: ① 动作不经 saveRoles 守卫通道（认领冲突失去拒写保护，失败也不上浮）；
    // ② 追加的不是重叠词本身；③ 整段覆盖而非追加（既有别名被吃掉）。
    expect(saveRoles).toHaveBeenCalledTimes(1)
    const record = saveRoles.mock.calls[0]![0] as Record<string, { id: string; aliases?: string[] }>
    expect(record['coder']).toEqual(expect.objectContaining({ id: 'coder', aliases: ['代码'] }))
  })

  it('B3 别名去重：重叠词已在 aliases ⇒ 点击不落笔（空写防护）', async () => {
    const saveRoles = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveRoles })
    await mount(store)
    const cfg = { ...DEFAULT_CONFIG_V6(), activePreset: 'saving' as string | null }
    // 重叠词『代码』已在 aliases——重复点击不得产生重复别名，也不得空写一笔。
    cfg.roles = { coder: { id: 'coder', label: '代码工', target: { provider: 'zai-coding-cn', model: 'glm-5.3' }, aliases: ['代码'] } }
    await act(async () => { publish(readyV6({ config: cfg })) })
    const btn = [...container.querySelectorAll<HTMLButtonElement>('.kt-overlap button')]
      .find((b) => b.textContent === '词并入该角色别名')!
    await act(async () => { btn.click() })
    // Fails if: 已在别名中的词仍触发写盘（无去重守卫，aliases 会越点越长）。
    expect(saveRoles).not.toHaveBeenCalled()
  })
})

/**
 * W6：试一句测试场走英文——共享模块（rules.ts previewRoute outcome）经
 * src/copy.ts 的 copyNow 跟随宿主语言。假 locale 服务（active='en-US'，bind 按
 * 当前 active 取 zh/en 表）经 attachLocaleService 接线后，路由关闭的 trial 原因
 * 必须是英文。
 * 模块态无复位口：假服务 active 可切，finally 切回 zh-CN 并触发订阅回调恢复；
 * 本 describe 置于文件末尾（文件内用例顺序执行），不污染既有中文断言。
 * 负控：wire() 里去掉 setCopyResolver 调用后本条变红（红/绿原始输出见 W6 报告）。
 */
describe('W6：试一句测试场英文（共享模块 copyNow 跟随语言）', () => {
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
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
  })

  it('假 locale 服务 active=en-US ⇒ 试一句 off 原因显示英文（不含中文原句）', async () => {
    // 可控假 locale 服务（useCopy.switch.test.tsx 同款：bind 按调用期 active 取值）。
    const state = {
      active: 'en-US',
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
    attachLocaleService(ctx as never)
    try {
      const { store, publish } = makeDeferredStore()
      await act(async () => {
        root = createRoot(container)
        root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
      })
      const snapshot = readySnapshot()
      ;(snapshot.config as unknown as { activePreset: string | null }).activePreset = null
      await act(async () => { publish(snapshot) })
      const input = container.querySelector<HTMLInputElement>('.kt-trial input')
      expect(input).not.toBeNull()
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, '随便一句')
        input!.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const trial = container.querySelector('.kt-trial-result')!
      // Fails if: wire() 不再调用 setCopyResolver——copyNow 停在 zh 回落（负控即此）。
      expect(trial.textContent).toContain('Routing is off')
      expect(trial.textContent).not.toContain('路由已关闭')
    } finally {
      // 恢复中文模块态（bound 闭包按调用期 active 取值；订阅回调同步 React 侧快照）。
      state.active = 'zh-CN'
      await act(async () => {
        for (const cb of [...state.listeners]) cb()
      })
    }
  })
})

/**
 * 显示名密钥闸（dracpet UX#3，2026-08-21 回访）：预设显示名与角色 label
 * 共用 preset-name.ts 的同一判据——疑似密钥/超过 40 字符 ⇒ 零落盘 +
 * 字段下 role=alert 报错；正常名照常走既有写通道（回归钉）。
 */
describe('SettingsCard 显示名密钥闸（dracpet UX#3）', () => {
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

  const mount = async (store: CardStore): Promise<void> => {
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(SettingsCard, { scope: null, connection: null, close: () => {}, storeFactory: () => store }))
    })
  }

  const fireInput = (input: HTMLInputElement, value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const presetNameInput = (): HTMLInputElement =>
    container.querySelector<HTMLInputElement>('input[aria-label="新预设名"]')!
  const createButton = (): HTMLButtonElement =>
    [...container.querySelectorAll<HTMLButtonElement>('.kt-preset-ops button')].find((b) => b.textContent === '新建预设')!

  it('预设名贴 sk- 密钥 ⇒ createPreset 零调用 + 字段下报错（输入保留待改）', async () => {
    const createPreset = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ createPreset })
    await mount(store)
    await act(async () => { publish(readyV5Snapshot()) })

    await act(async () => { fireInput(presetNameInput(), 'sk-proj-AbC123') })
    await act(async () => { createButton().click() })

    // Fails if: 密钥被当显示名落盘（dracpet UX#3 原缺陷：name 逐字进配置）。
    expect(createPreset).not.toHaveBeenCalled()
    const alert = container.querySelector('.kt-preset-ops [role="alert"]')
    // Fails if: 拒绝但无可见提示（静默吞掉，用户以为已创建）。
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toContain('密钥')
    // 输入保留（不清空），用户知道自己贴了什么并可改正；aria-invalid 标出。
    expect(presetNameInput().value).toBe('sk-proj-AbC123')
    expect(presetNameInput().getAttribute('aria-invalid')).toBe('true')
  })

  it('预设名 41 字符 ⇒ 拒绝并提示长度上限 40', async () => {
    const createPreset = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ createPreset })
    await mount(store)
    await act(async () => { publish(readyV5Snapshot()) })

    // 41 个 CJK 字符：不碰密钥判据（不在令牌字符集），专钉长度闸。
    await act(async () => { fireInput(presetNameInput(), `${'预设'.repeat(20)}x`) })
    await act(async () => { createButton().click() })

    // Fails if: 长度闸缺席（整条剪贴板原文落盘）。
    expect(createPreset).not.toHaveBeenCalled()
    expect(container.querySelector('.kt-preset-ops [role="alert"]')!.textContent).toContain('40')
  })

  it('预设名正常 ⇒ 照常创建并清空输入（回归：合法名不被误伤）', async () => {
    const createPreset = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ createPreset })
    await mount(store)
    await act(async () => { publish(readyV5Snapshot()) })

    await act(async () => { fireInput(presetNameInput(), '我的预设') })
    await act(async () => { createButton().click() })

    // Fails if: 正常名被密钥闸/长度闸误伤（假阳性）。
    expect(createPreset).toHaveBeenCalledTimes(1)
    expect(createPreset).toHaveBeenCalledWith('我的预设', expect.objectContaining({ name: '我的预设', rules: [] }))
    expect(presetNameInput().value).toBe('')
    expect(container.querySelector('.kt-preset-ops [role="alert"]')).toBeNull()
  })

  /** v6 就绪快照夹具：单角色 frontend（label 通道的挂载前提）。 */
  const readyV6WithRole = (): CardSnapshot => ({
    status: 'ready',
    config: {
      ...DEFAULT_CONFIG_V6(),
      activePreset: 'saving',
      roles: { frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'k3' } } },
    },
    base: null,
    user: null,
    writable: true,
    error: null,
    catalog: null,
    availability: null,
    efforts: null,
  })

  const roleLabelInput = (): HTMLInputElement =>
    container.querySelector<HTMLInputElement>('.kt-role-row input[aria-label="角色显示名"]')!

  it('角色 label 贴 ghp_ 密钥 ⇒ saveRoles 零调用 + 行内报错（同一判据）', async () => {
    const saveRoles = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveRoles })
    await mount(store)
    await act(async () => { publish(readyV6WithRole()) })

    const input = roleLabelInput()
    await act(async () => { fireInput(input, 'ghp_0123456789abcdef') })
    await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })

    // Fails if: 角色 label 通道漏接同一判据（判据被复制两份/只接了预设侧）。
    expect(saveRoles).not.toHaveBeenCalled()
    const alert = container.querySelector('.kt-role-row [role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toContain('密钥')
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('角色 label 正常改名 ⇒ 照旧经 saveRoles 落盘（回归）', async () => {
    const saveRoles = vi.fn(async () => {})
    const { store, publish } = makeDeferredStore({ saveRoles })
    await mount(store)
    await act(async () => { publish(readyV6WithRole()) })

    const input = roleLabelInput()
    await act(async () => { fireInput(input, '前端组') })
    await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })

    // Fails if: 合法 label 被误伤，或改名不再走 saveRoles 守卫通道。
    expect(saveRoles).toHaveBeenCalledTimes(1)
    const record = saveRoles.mock.calls[0]![0] as Record<string, { label: string }>
    expect(record.frontend!.label).toBe('前端组')
    expect(container.querySelector('.kt-role-row [role="alert"]')).toBeNull()
  })
})
