// @vitest-environment jsdom
/**
 * ReviewCard / ReviewReviseCard — v1.4.0 评审闭环卡片回归。
 *
 * 覆盖三件事（spec §3.1/§3.7）：
 * 1) 「让它重做」按钮走 reviewReviseBridge → 命令通道，回显落卡片页脚；
 * 2) 会话身份缺席（旧宿主/单测）时按钮禁用——不假装能点；
 * 3) 失败卡没有退回入口（没有结论可依据），退回卡按 stopped 分「已退回/已停」。
 *
 * 异步交互用 react-dom/client + jsdom 真实挂载 → 点击 → act 冲刷
 * （TideDock.dom.test.tsx 同款；renderToString 覆盖不到）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReviewCard, ReviewReviseCard, reviewReviseBridge } from '../src/client/ReviewCard.js'
import type { ReviewRecord, ReviewReviseRecord } from '../src/types.js'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const record = (over: Partial<ReviewRecord> = {}): ReviewRecord => ({
  flowId: 'review',
  reviewer: { provider: 'kimi-coding', model: 'k3' },
  turn: 7,
  userText: '帮我审查这个方案',
  reviewText: '一、[阻塞] 空指针未处理\n结论：不通过',
  ok: true,
  durationMs: 12,
  at: '2026-10-03T10:00:00.000Z',
  verdict: 'fail',
  ...over,
})

function mount(element: ReturnType<typeof createElement>): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(element) })
  return { container, root }
}

describe('ReviewCard：让它重做', () => {
  let roots: Root[] = []
  const revise = vi.fn<(sessionId: string, line: string) => Promise<unknown>>()

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    roots = []
    revise.mockReset()
    reviewReviseBridge.revise = (sessionId, line) => revise(sessionId, line)
  })

  afterEach(async () => {
    for (const root of roots) {
      await act(async () => { root.unmount() })
    }
  })

  const render = (props: Parameters<typeof ReviewCard>[0]): HTMLDivElement => {
    const { container, root } = mount(createElement(ReviewCard, props))
    roots.push(root)
    return container
  }

  it('结论标签按载荷显示（旧记录无该字段则不显示）', () => {
    const withVerdict = render({ node: { kind: 'kimi-tide-review', data: { record: record() } }, sessionId: 's1' })
    expect(withVerdict.textContent).toContain('不通过')
    const legacy = render({ node: { kind: 'kimi-tide-review', data: { record: record({ verdict: undefined as never }) } }, sessionId: 's1' })
    expect(legacy.querySelector('.kt-review-verdict')).toBeNull()
  })

  it('点击 → 命令通道收到 /kimi-tide revise，回显落页脚', async () => {
    // 回包按宿主真实线形：{ ok, value: CommandExecution{ result: { kind, text } } }
    revise.mockResolvedValue({ ok: true, value: { commandId: 'c1', result: { kind: 'success', text: '已按评审意见退回重做（第 1 次）' } } })
    const container = render({ node: { kind: 'kimi-tide-review', data: { record: record() } }, sessionId: 's1' })
    const button = container.querySelector('button.kt-review-revise') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.textContent).toContain('让它重做')

    await act(async () => { button.click() })
    expect(revise).toHaveBeenCalledWith('s1', '/kimi-tide revise')
    expect(container.querySelector('.kt-review-note')?.textContent).toContain('第 1 次')
  })

  it('命令失败 → 页脚显示失败原文（不静默）', async () => {
    revise.mockResolvedValue({ ok: false, error: { message: '已达修订上限（每轮会话最多 1 次）' } })
    const container = render({ node: { kind: 'kimi-tide-review', data: { record: record() } }, sessionId: 's1' })
    const button = container.querySelector('button.kt-review-revise') as HTMLButtonElement
    await act(async () => { button.click() })
    expect(container.querySelector('.kt-review-note')?.textContent).toContain('上限')
  })

  it('sessionId 缺席 → 按钮禁用且不发起命令', async () => {
    const container = render({ node: { kind: 'kimi-tide-review', data: { record: record() } } })
    const button = container.querySelector('button.kt-review-revise') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await act(async () => { button.click() })
    expect(revise).not.toHaveBeenCalled()
  })

  it('失败卡不渲染退回入口（没有结论可依据）', () => {
    const container = render({
      node: { kind: 'kimi-tide-review', data: { record: record({ ok: false, error: 'review timeout', verdict: 'unknown' as never }) } },
      sessionId: 's1',
    })
    expect(container.querySelector('button.kt-review-revise')).toBeNull()
    expect(container.textContent).toContain('review timeout')
  })
})

describe('ReviewReviseCard：退回留痕', () => {
  const reviseRecord = (over: Partial<ReviewReviseRecord> = {}): ReviewReviseRecord => ({
    flowId: 'review',
    turn: 7,
    reason: 'auto',
    verdict: 'fail',
    reviseIndex: 1,
    at: '2026-10-03T10:00:00.000Z',
    ...over,
  })

  it('已退回：第 k 次 + 依据结论', () => {
    const { container, root } = mount(createElement(ReviewReviseCard, {
      node: { kind: 'kimi-tide-review-revise', data: { record: reviseRecord() } },
    }))
    void root
    expect(container.textContent).toContain('已按评审意见退回重做（第 1 次）')
    expect(container.textContent).toContain('不通过')
    expect(container.textContent).toContain('自动')
  })

  it('stopped=limit：标「已停（达上限）」并说明不再自动重做', () => {
    const { container } = mount(createElement(ReviewReviseCard, {
      node: { kind: 'kimi-tide-review-revise', data: { record: reviseRecord({ stopped: 'limit', reviseIndex: 1 }) } },
    }))
    expect(container.textContent).toContain('已停（达上限）')
    expect(container.textContent).toContain('不再自动重做')
  })
})
