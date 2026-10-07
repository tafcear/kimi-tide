// @vitest-environment jsdom
/**
 * TideDock 紧凑态（v1.5.0 位置调整，2026-10-03 用户裁定「排版位置 → 挪到工具行右端」）。
 *
 * 契约：`variant:'compact'` 时只渲染一行两个小按钮——
 *   ① `.kt-c-main`：预设 → 目标（点开决策面板；kimi 未接入时内嵌 ⚠）
 *   ② `.kt-c-quota`：配额/余额摘要（点开用量总览）
 * 不再渲染 r1/r2 两行（工具行只有一行空间），但两个 portal 面板与完整态完全同款。
 * 每个用例注释标注「会使其失败的生产改动」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TideDock, tideDockBridge } from '../src/client/TideDock.js'
import type { KimiTidePanelProjection } from '../src/types.js'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

/** 面板夹具：预设「省钱」+ 默认目标 deepseek-flash + 本步决策已落到 glm-5.3 + 余额源。 */
const panel = (over: Partial<KimiTidePanelProjection> = {}): KimiTidePanelProjection => ({
  quota: null,
  quotaProvider: 'zai-coding-cn',
  quotas: {},
  kimi: { route: false, key: false },
  router: {
    activePreset: 'saving',
    presetName: '省钱',
    defaultTarget: { provider: 'deepseek-official', model: 'deepseek-flash' },
    ruleCount: 2,
  },
  reasoning: { enabled: true },
  configSource: 'settings',
  candidates: [],
  decision: null,
  ...over,
})

describe('TideDock 紧凑态（工具行右端）', () => {
  let container: HTMLDivElement
  let root: Root | undefined

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    tideDockBridge.execute = async () => ({ ok: true, text: 'done' })
  })

  afterEach(async () => {
    if (root !== undefined) {
      await act(async () => { root!.unmount() })
      root = undefined
    }
    container.remove()
    document.body.querySelectorAll('.kt-dock-pop').forEach((el) => el.remove())
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
    vi.restoreAllMocks()
  })

  const mount = async (p: KimiTidePanelProjection, extra: Record<string, unknown> = {}): Promise<void> => {
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(TideDock, {
        sessionId: 's',
        variant: 'compact',
        useProjection: () => null,
        fetchPanel: async () => p,
        ...extra,
      } as never))
    })
    await act(async () => { await Promise.resolve() })
  }

  it('只渲染一行两个按钮：无 r1/r2 两行，主按钮含「预设 → 目标」', async () => {
    await mount(panel())
    expect(container.querySelector('.kimi-tide-dock.kt-dock-c')).not.toBeNull()
    // Fails if: 紧凑态仍渲染下方两行骨架（会重新占掉一整行）
    expect(container.querySelector('.kt-dock-r1')).toBeNull()
    expect(container.querySelector('.kt-dock-r2')).toBeNull()
    const main = container.querySelector('.kt-c-main')!
    expect(main.textContent).toContain('省钱')
    expect(main.textContent).toContain('deepseek-flash')
    expect(container.querySelectorAll('.kt-c-quota')).toHaveLength(1)
  })

  it('本步决策目标优先于默认目标（与 r1 的 ⟶ 同语义）', async () => {
    await mount(panel({ decision: { chosen: { provider: 'zai-coding-cn', model: 'glm-5.3' }, reason: '规则「code」命中' } }))
    const main = container.querySelector('.kt-c-main')!
    expect(main.textContent).toContain('glm-5.3')
    expect(main.textContent).not.toContain('deepseek-flash')
  })

  it('点主按钮 → 决策面板 portal 出现（空态也渲染，解释「暂无本步决策」）', async () => {
    await mount(panel())
    await act(async () => { (container.querySelector('.kt-c-main') as HTMLButtonElement).click() })
    const pop = document.body.querySelector('.kt-dock-pop')
    expect(pop).not.toBeNull()
    expect((container.querySelector('.kt-c-main') as HTMLButtonElement).getAttribute('aria-expanded')).toBe('true')
  })

  it('配额摘要：余额源给 ¥ 金额，点开用量总览 portal', async () => {
    // 配额跟随**当前路由目标**的 provider（deepseek-official = 预设默认目标）
    await mount(panel({
      quotaProvider: 'deepseek-official',
      quotas: { 'deepseek-official': { kind: 'balance', balances: [{ currency: 'CNY', total: '3.94' }], available: true, fetchedAt: 1, stale: false } },
    }))
    const quotaBtn = container.querySelector('.kt-c-quota') as HTMLButtonElement
    expect(quotaBtn.textContent).toContain('3.94')
    await act(async () => { quotaBtn.click() })
    expect(document.body.querySelector('#kt-quota-overview')).not.toBeNull()
  })

  it('无配额数据 → 退化 ▤ 图标（不显示「—」，避免无意义字符）', async () => {
    await mount(panel())
    expect(container.querySelector('.kt-c-quota')!.textContent?.trim()).toBe('')
  })

  it('kimi 未接入 → 主按钮内嵌 ⚠（接入后消失）', async () => {
    await mount(panel())
    expect(container.querySelector('.kt-c-warn')).not.toBeNull()
    await act(async () => { root!.unmount() })
    root = undefined
    await mount(panel({ kimi: { route: true, key: true } }))
    // Fails if: 告警判据不再读 kimi 二态（接了也报错 = 桌面端误报的旧毛病）
    expect(container.querySelector('.kt-c-warn')).toBeNull()
  })

  it('无面板数据：紧凑态只留「月汐」，状态文案收进 title（不挤工具行）', async () => {
    await mount(panel(), { useProjection: () => null, fetchPanel: async () => null })
    const label = container.querySelector('.kt-c-state') as HTMLElement
    expect(label).not.toBeNull()
    expect(label.textContent).toContain('月汐')
    expect(label.getAttribute('title') ?? '').not.toBe('')
    expect(container.querySelector('.kimi-tide-dock')!.textContent?.trim()).toBe('月汐')
    expect(container.querySelector('.kimi-tide-dock svg')).not.toBeNull()
  })
})
