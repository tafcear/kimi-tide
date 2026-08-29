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
