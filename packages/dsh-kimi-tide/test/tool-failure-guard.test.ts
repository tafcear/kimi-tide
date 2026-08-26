import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { installToolFailureGuard, scanToolResults } from '../src/tool-failure-guard.js'

/**
 * 连续失败工具守卫（B 方案，2026-08-26）：针对「子代理幻觉 job id、连续 160
 * 次 job_output 全部 unknown job 报错、零进展」的失控循环。区别于钝刀步数上限：
 * 只在一轮内「连续 N 次工具返回 isError 且无任何成功」时阻断，正常长任务
 * （偶发成功即重置）绝无误伤。
 *
 * 契约（dsh-agent-loop turn()）：agent/pre-step 返回 {kind:'reject'} →
 * turn/end 记 blocked；payload.step = 轮内 1-based 步号、payload.turn = 轮号、
 * payload.messages = 本步 claimed 消息（含上一步工具结果）。
 */

const agent = {}

function toolResult(isError: boolean): UserMessage {
  return {
    role: 'user',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'c1',
        content: [{ type: 'text', text: isError ? 'Error: unknown job x' : 'ok' }],
        ...(isError ? { isError: true } : {}),
      },
    ],
  } as unknown as UserMessage
}

function textMsg(text: string): UserMessage {
  return { role: 'user', content: [{ type: 'text', text }] } as unknown as UserMessage
}

describe('scanToolResults（纯函数：错误计数 + 是否进展）', () => {
  it('无 tool-result → 0 错误 / 无进展', () => {
    expect(scanToolResults([textMsg('hi')])).toEqual({ errors: 0, progressed: false })
  })

  it('N 个 isError tool-result → errors=N / 无进展', () => {
    expect(scanToolResults([toolResult(true), toolResult(true)])).toEqual({ errors: 2, progressed: false })
  })

  it('混合错误 + 成功 → 有进展（连败重置信号）', () => {
    expect(scanToolResults([toolResult(true), toolResult(false)])).toEqual({ errors: 1, progressed: true })
  })

  it('空消息批 → 0 错误 / 无进展', () => {
    expect(scanToolResults([])).toEqual({ errors: 0, progressed: false })
  })
})

interface Listener {
  (payload: unknown, next: () => Promise<unknown>): Promise<unknown>
}

/** 守卫专用 fake ctx：只暴露 on/effect/logger，瀑布语义与 cordis 一致（外层先执行，next 链到内层）。 */
function makeGuardCtx() {
  const listeners: Array<{ cb: Listener }> = []
  const warns: string[] = []
  const ctx = {
    logger: { warn: (message: string) => warns.push(message) },
    effect: (execute: () => unknown) => {
      const cleanup = execute()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
    on: (name: string, listener: Listener, options?: { prepend?: boolean }) => {
      const record = { cb: listener }
      options?.prepend ? listeners.unshift(record) : listeners.push(record)
      return () => {
        const i = listeners.indexOf(record)
        if (i >= 0) listeners.splice(i, 1)
      }
    },
  }
  const preStep = async (payload: object): Promise<unknown> => {
    const cbs = [...listeners].map((r) => r.cb)
    const inner = () => Promise.resolve({ kind: 'enter' })
    const next = () => (cbs.shift() ?? inner)(payload, next)
    return next()
  }
  return { ctx, preStep, warns }
}

describe('installToolFailureGuard（wiring：连续失败达阈值即阻断本轮）', () => {
  it('连续 3 次工具失败后，下一步返回 reject（阈值 3）', async () => {
    const { ctx, preStep } = makeGuardCtx()
    installToolFailureGuard(ctx as never, 3)

    expect(await preStep({ agent, turn: 1, step: 1, messages: [textMsg('开始')] })).toEqual({ kind: 'enter' })
    expect(await preStep({ agent, turn: 1, step: 2, messages: [toolResult(true)] })).toEqual({ kind: 'enter' }) // 失败 1
    expect(await preStep({ agent, turn: 1, step: 3, messages: [toolResult(true)] })).toEqual({ kind: 'enter' }) // 失败 2
    expect(await preStep({ agent, turn: 1, step: 4, messages: [toolResult(true)] })).toEqual({ kind: 'reject' }) // 失败 3 → 阻断
  })

  it('任何成功工具结果重置连败', async () => {
    const { ctx, preStep } = makeGuardCtx()
    installToolFailureGuard(ctx as never, 3)

    await preStep({ agent, turn: 1, step: 1, messages: [textMsg('开始')] })
    await preStep({ agent, turn: 1, step: 2, messages: [toolResult(true)] }) // 1
    await preStep({ agent, turn: 1, step: 3, messages: [toolResult(true)] }) // 2
    // 成功一次 → 重置
    expect(await preStep({ agent, turn: 1, step: 4, messages: [toolResult(false)] })).toEqual({ kind: 'enter' })
    await preStep({ agent, turn: 1, step: 5, messages: [toolResult(true)] }) // 1
    await preStep({ agent, turn: 1, step: 6, messages: [toolResult(true)] }) // 2
    expect(await preStep({ agent, turn: 1, step: 7, messages: [toolResult(true)] })).toEqual({ kind: 'reject' }) // 3 → 阻断
  })

  it('新一轮（turn 递增）重置连败', async () => {
    const { ctx, preStep } = makeGuardCtx()
    installToolFailureGuard(ctx as never, 3)

    await preStep({ agent, turn: 1, step: 1, messages: [textMsg('开始')] })
    await preStep({ agent, turn: 1, step: 2, messages: [toolResult(true)] }) // 1
    await preStep({ agent, turn: 1, step: 3, messages: [toolResult(true)] }) // 2
    // 新一轮首步（无 tool-result）重置连败——若未重置，turn2 首步后连败=2，
    // 下一步 err 会 3→reject；正确实现应重置为 0，下一步 err 只到 1。
    await preStep({ agent, turn: 2, step: 1, messages: [textMsg('新问题')] })
    expect(await preStep({ agent, turn: 2, step: 2, messages: [toolResult(true)] })).toEqual({ kind: 'enter' }) // 重置后 = 1
  })

  it('阈值 ≤0 → 守卫关闭，永不 reject', async () => {
    const { ctx, preStep } = makeGuardCtx()
    installToolFailureGuard(ctx as never, 0)
    for (let i = 0; i < 10; i++) {
      expect(await preStep({ agent, turn: 1, step: i + 1, messages: [toolResult(true)] })).toEqual({ kind: 'enter' })
    }
  })
})
