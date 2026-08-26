/**
 * dsh-kimi-tide 连续失败工具守卫（0.7.0 兜底，2026-08-26）。
 *
 * 背景：@kimi 评审子代理失控——被全局技能劫持后连续 160 次 job_output 用
 * 幻觉 job id、每次 `unknown job` 报错、零进展，整轮 220 步直到父级中止。
 * 宿主 dsh-agent-loop 的 turn() 是裸 `while(true)`（无 maxSteps 上限），
 * 失控会被无限放大。社区已有 `dsh-turn-budget` 插件 workaround，本守卫是
 * kimi-tide 自带的等价护栏，挂在公开扩展点 `agent/pre-step`，宿主升级
 * （rc.6→rc.8→rc.2 契约迁移史）不影响。
 *
 * 设计（B 方案，用户裁定）：钝刀步数上限会误伤正常超长单轮任务，故改为
 * 「连续失败检测」——一轮内连续 N 次工具返回 isError 且无任何成功 → 阻断。
 * 正常任务偶发成功即重置连败，绝无误伤；失控循环的 160 连败会立刻被拦。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolResultBlock } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'

/** 连续失败阈值缺省值（B 方案）：本轮内连续 20 次工具 isError 且无成功 → 阻断。 */
export const DEFAULT_TOOL_FAILURE_THRESHOLD = 20

/**
 * 扫描一批 claimed 消息中的工具结果，返回 { errors, progressed }：
 * - errors：isError === true 的工具结果数
 * - progressed：是否存在任何非错误的工具结果（= 连败重置信号）
 * 纯函数，无 ctx/agent 依赖。
 */
export function scanToolResults(messages: readonly UserMessage[]): { errors: number; progressed: boolean } {
  let errors = 0
  let progressed = false
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block.type !== 'tool-result') continue
      const tool = block as ToolResultBlock
      if (tool.isError === true) errors += 1
      else progressed = true
    }
  }
  return { errors, progressed }
}

/**
 * 注册连续失败守卫：agent/pre-step 处，按 agent、按 turn 计数连续 isError
 * 工具结果；一轮内累计到 threshold 即返回 `{kind:'reject'}`（宿主把本轮关成
 * blocked），且短路不调 next()（下游路由转述不再空跑）。任何成功工具结果
 * 或新一轮（payload.turn 递增）都重置连败。
 *
 * threshold <= 0 → 守卫关闭，返回空 disposer（不注册监听器）。
 * @returns disposer（注销该 pre-step 监听器）。
 */
export function installToolFailureGuard(ctx: Context, threshold: number): () => void {
  if (!(Number.isInteger(threshold) && threshold > 0)) return () => {}
  const streaks = new WeakMap<Agent, { turn: number; failures: number }>()
  return ctx.effect(() => {
    const dispose = ctx.on('agent/pre-step', async (payload, next) => {
      const agent = payload.agent
      const turn = payload.turn
      let state = streaks.get(agent)
      if (state === undefined || state.turn !== turn) {
        state = { turn, failures: 0 }
        streaks.set(agent, state)
      }
      const { errors, progressed } = scanToolResults(payload.messages)
      state.failures = progressed ? 0 : state.failures + errors
      if (state.failures >= threshold) {
        ctx.logger?.warn?.(`dsh-kimi-tide: 连续 ${state.failures} 次工具调用失败（无进展），本轮已阻断（阈值 ${threshold}）`)
        return { kind: 'reject' }
      }
      return await next()
    }, { prepend: true })
    return dispose
  })
}
