// @vitest-environment jsdom
/**
 * TideDock 决策面板 Portal 悬浮层（⑥-B 打磨 2026-08-29）。
 *
 * 用户报告：内联展开会把输入区推下去（「点击 flow 弹出的界面布局有变动」）。
 * 根治：createPortal(document.body) + fixed 定位 —— 开合零文档流变动。
 * renderToString 不渲染 portal，故本文件用 react-dom/client + jsdom 真实挂载。
 * 每个用例注释标注「会使其失败的生产改动」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TideDock } from '../src/client/TideDock.js'
import type { KimiTidePanelProjection } from '../src/types.js'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

function makePanel(overrides: Partial<KimiTidePanelProjection> = {}): KimiTidePanelProjection {
  return {
    quota: null,
    kimi: { route: true, key: true },
    router: {
      activePreset: 'saving',
      presetName: '省钱',
      defaultTarget: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      ruleCount: 2,
    },
    reasoning: { enabled: true },
    models: { kimi: ['kimi-for-coding', 'k3'], deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
    configSource: 'settings',
    candidates: [],
    decision: {
      chosen: { provider: 'kimi-coding', model: 'k3' },
      reason: 'flow:transcribe 转述失败（latch-image）→ 原生视觉作答',
    },
    lastFlowEvent: 'flow:transcribe 执行 → kimi-coding/k3（转述 0/1 成功）',
    ...overrides,
  }
}

describe('TideDock 决策面板 portal 悬浮层', () => {
  let container: HTMLDivElement
  let root: Root

  const mount = async (panel: KimiTidePanelProjection) => {
    container = document.body.appendChild(document.createElement('div'))
    root = createRoot(container)
    await act(() => { root.render(createElement(TideDock, { sessionId: 's', useProjection: () => panel })) })
  }

  const open = async () => {
    const toggle = container.querySelector('.kt-decision-toggle')!
    await act(() => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(() => { root.unmount() })
    container.remove()
  })

  it('展开: 面板挂 body 层 portal, dock 子树零新增节点（不推挤文档流）', async () => {
    await mount(makePanel())
    expect(document.querySelector('.kt-dock-pop')).toBeNull()
    const dockTopBefore = (container.firstChild as Element).childNodes.length
    await open()
    const pop = document.querySelector('.kt-dock-pop')
    // Fails if: 面板回退内联渲染（推挤输入区——2026-08-29 用户报告「布局有变动」）
    expect(pop).not.toBeNull()
    expect(container.querySelector('.kt-dock-pop')).toBeNull()
    expect(container.querySelector('.kt-reason')).toBeNull()
    expect((container.firstChild as Element).childNodes.length).toBe(dockTopBefore)
    // 面板内容完整：原因 + 流事件
    expect(pop!.textContent).toContain('原生视觉作答')
    expect(pop!.textContent).toContain('最近流事件')
    expect(pop!.textContent).toContain('转述 0/1 成功')
  })

  it('Escape 关闭面板', async () => {
    await mount(makePanel())
    await open()
    expect(document.querySelector('.kt-dock-pop')).not.toBeNull()
    await act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    // Fails if: Esc 关闭监听缺失（悬浮层无法收起）
    expect(document.querySelector('.kt-dock-pop')).toBeNull()
  })

  it('面板外 mousedown 关闭; 面板内点击不关闭', async () => {
    await mount(makePanel())
    await open()
    expect(document.querySelector('.kt-dock-pop')).not.toBeNull()
    // 面板内 mousedown（冒泡到 window）不关闭
    await act(() => { document.querySelector('.kt-dock-pop')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(document.querySelector('.kt-dock-pop')).not.toBeNull()
    // body 级外点关闭
    await act(() => { window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    // Fails if: 外点关闭监听缺失（悬浮层遮内容无法收起）
    expect(document.querySelector('.kt-dock-pop')).toBeNull()
  })

  it('收起: dock 内容回到折叠态（再点开关可复开）', async () => {
    await mount(makePanel())
    await open()
    await open()
    expect(document.querySelector('.kt-dock-pop')).toBeNull()
    await open()
    // Fails if: 开关状态机坏（开→关→开失效）
    expect(document.querySelector('.kt-dock-pop')).not.toBeNull()
  })

  // ---- 定位（2026-08-29 评审 P1-2：placePop 只钳水平不钳垂直，底缘 dock
  //      向下开 430×320 面板几乎整块出屏。修复：下方空间不足且上方更大时
  //      改锚 bottom 向上展开，无需预知面板高度）----

  const mockDockRect = (top: number, bottom: number) => {
    const dock = container.firstChild as HTMLElement
    vi.spyOn(dock, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: top, width: 800, height: bottom - top, top, right: 900, bottom, left: 100,
    } as DOMRect)
  }

  it('dock 贴视口底缘: 面板向上展开（锚 bottom，不设 top）', async () => {
    await mount(makePanel())
    // jsdom innerHeight=768；rect.bottom=760 → 下方仅 8px < maxH(320)，上方 700px 更宽裕
    mockDockRect(700, 760)
    await open()
    const pop = document.querySelector('.kt-dock-pop') as HTMLElement
    // Fails if: placePop 恢复恒向下定位（top=rect.bottom+6 → 面板探出视口）
    expect(pop.style.bottom).toBe('74px') // 768 - 700 + 6
    expect(pop.style.top).toBe('')
  })

  it('dock 靠近视口顶缘: 面板仍向下展开（下方空间充裕时维持原行为）', async () => {
    await mount(makePanel())
    mockDockRect(10, 60)
    await open()
    const pop = document.querySelector('.kt-dock-pop') as HTMLElement
    // Fails if: 一律向上翻（上方仅 10px 时面板顶出视口）
    expect(pop.style.top).toBe('66px') // rect.bottom + 6
    expect(pop.style.bottom).toBe('')
  })
})
