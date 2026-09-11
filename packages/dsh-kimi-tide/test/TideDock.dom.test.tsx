// @vitest-environment jsdom
/**
 * TideDock — 命令反馈形态回归（0.6.x 池#d）。
 *
 * dock 的命令执行结果判定原先只认 `ok in result && ok === false`：
 * RPC resolve 出「无 ok 字段但带 error」的形态时按成功静默吞掉。
 * renderToString 单遍渲染覆盖不到异步交互，故本文件用
 * react-dom/client + jsdom 真实挂载 → 点击 → act 冲刷。
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

const panel: KimiTidePanelProjection = {
  quota: {
    weekly: { used: 10, limit: 100, resetTime: 'w' },
    fiveHour: { used: 5, limit: 100, resetTime: 'f' },
    membershipLevel: 'L1',
    fetchedAt: 1,
    stale: false,
  },
  quotaProvider: 'kimi-coding',
  kimi: { route: true, key: true },
  router: {
    activePreset: 'saving',
    presetName: '省钱',
    defaultTarget: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    ruleCount: 2,
  },
  reasoning: { enabled: true },
  configSource: 'settings',
  candidates: [],
  // 决策目标 kimi → 与配额来源一致 → 限额区/刷新按钮渲染（⑨ 门控前提）
  decision: { chosen: { provider: 'kimi-coding', model: 'k3' }, reason: '规则「code」命中' },
}

describe('TideDock 命令反馈（0.6.x池#d：error-only 形态）', () => {
  let container: HTMLDivElement
  let root: Root | undefined
  const execute = vi.fn<(line: string) => Promise<unknown>>()

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    tideDockBridge.execute = (line) => execute(line)
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
    vi.restoreAllMocks()
  })

  const mount = async (): Promise<void> => {
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(TideDock, { sessionId: 's', useProjection: () => panel }))
    })
  }

  it('命令返回 error-only（无 ok 字段）→ 上浮失败提示不静默吞掉', async () => {
    execute.mockResolvedValue({ error: { message: 'boom' } })
    await mount()
    const btn = container.querySelector<HTMLButtonElement>('button.kt-refresh')
    expect(btn).not.toBeNull()
    await act(async () => {
      btn!.click()
    })
    // Fails if: 仅认 ok:false 判失败——error-only 形态按成功静默吞掉。
    expect(container.textContent).toContain('命令执行失败：boom')
  })

  it('命令成功（ok:true）→ 不出现失败提示', async () => {
    execute.mockResolvedValue({ ok: true, message: 'kimi-tide: quota refreshed' })
    await mount()
    const btn = container.querySelector<HTMLButtonElement>('button.kt-refresh')
    await act(async () => {
      btn!.click()
    })
    expect(container.textContent).not.toContain('命令执行失败')
  })
})

/**
 * v1.2.0 会话事件解耦：面板数据改由命令通道按需拉取（`fetchPanel`）。
 * dock 的取数优先级 = 现算（fetchPanel）> 投影（历史会话）> 空。
 */
describe('TideDock 取数（1.2.0：拉模型优先于投影）', () => {
  let container: HTMLDivElement
  let root: Root | undefined

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(async () => {
    if (root !== undefined) {
      await act(async () => { root!.unmount() })
      root = undefined
    }
    container.remove()
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
    vi.restoreAllMocks()
  })

  const mountWith = async (props: Parameters<typeof TideDock>[0]): Promise<void> => {
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(TideDock, props))
    })
  }

  it('fetchPanel 现算优先：新会话（投影 null）也能渲染出面板', async () => {
    const fetchPanel = vi.fn(async () => panel)
    await mountWith({ sessionId: 's', useProjection: () => null, fetchPanel })
    // Fails if: 仍以投影为唯一数据源——解耦后面板事件不再写日志，新会话恒空。
    expect(container.textContent).toContain('省钱')
    expect(container.textContent).toContain('k3')
    expect(fetchPanel).toHaveBeenCalledWith('s')
  })

  it('fetchPanel 无数据（路由关闭/通道不可用）→ 回退投影（历史会话照常可读）', async () => {
    const fetchPanel = vi.fn(async () => null)
    await mountWith({ sessionId: 's', useProjection: () => panel, fetchPanel })
    expect(container.textContent).toContain('省钱')
  })

  it('fetchPanel 抛错 → 静默回退投影（不把通道故障渲染成错误态）', async () => {
    const fetchPanel = vi.fn(async () => { throw new Error('rpc down') })
    await mountWith({ sessionId: 's', useProjection: () => panel, fetchPanel })
    expect(container.textContent).toContain('省钱')
    expect(container.textContent).not.toContain('rpc down')
  })

  it('两者都无数据 → 取数落定后给降级文案（不崩、不永远卡「加载中」）', async () => {
    // Fails if: 取数落定后仍渲染「加载中」——2026-09-10 实机故障形态
    // （通道解析失败 → fetched 恒 null → 面板数据加载中… 永不消失）。
    await mountWith({ sessionId: 's', useProjection: () => null, fetchPanel: async () => null })
    expect(container.textContent).toContain('暂无面板数据')
    expect(container.textContent).not.toContain('面板数据加载中')
  })

  it('取数失败带原因 → 降级文案显示原因（不让人猜）', async () => {
    await mountWith({
      sessionId: 's',
      useProjection: () => null,
      fetchPanel: async () => { throw new Error('HTTP 401') },
    })
    expect(container.textContent).toContain('暂无面板数据（HTTP 401）')
  })

  it('取数未落定（挂起的 promise）→ 保持加载中占位', async () => {
    await mountWith({ sessionId: 's', useProjection: () => null, fetchPanel: () => new Promise(() => {}) })
    expect(container.textContent).toContain('面板数据加载中')
    expect(container.textContent).not.toContain('暂无面板数据')
  })
})
