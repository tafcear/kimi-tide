/**
 * 派发护栏在岗状态（issue #9，A+B：在岗可见 ＋ fail-closed）——全仓唯一事实源。
 *
 * 三态语义：
 * - `installed`：护栏已注册到宿主 `ctx.tools.guard`，在岗；
 * - `off`：用户意图（无激活预设 / 开关未开）——行为与无护栏逐字节一致，
 *   面板照常读回但**不告警、不写日志**（issue #9 判据①：前两种仍静默）；
 * - `unavailable`：开关已开（enforce）而环境给不出护栏——**失败状态**，
 *   必须可见：进投影 / dock 警示态 / 命令读回，日志写明「未在岗」与原因。
 *   三类原因分开：`no-tools`（tools 服务缺席）、`no-guard`（tools.guard
 *   注册面不可用）、`register-failed`（注册抛错，detail 取错误消息并截断）。
 *
 * 硬约束（issue #9 红线）：采集状态**绝不抛异常**——探测异常按 `no-tools`
 * 归类（与 probeTools 同款「cordis 代理下属性访问必抛 ⇒ 吞成缺席」），注册
 * 异常归入 `register-failed`；插件挂载与工具调用都不得因护栏状态而失败。
 */
import type { ToolGuardFn } from './index.js'

export type GuardStatus =
  | { state: 'installed' }
  | { state: 'off'; reason: 'no-preset' | 'switch-off' }
  | { state: 'unavailable'; reason: 'no-tools' | 'no-guard' | 'register-failed'; detail?: string }

/** register-failed 的 detail 截断上限（字符）；投影 schema 的 wire 面同款上限，双端防御。 */
export const GUARD_DETAIL_MAX = 200

/** 取错误消息并截断到 ≤{@link GUARD_DETAIL_MAX} 字符（纯函数，绝不抛）。 */
export function guardDetailOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= GUARD_DETAIL_MAX ? message : message.slice(0, GUARD_DETAIL_MAX)
}

/**
 * 宿主工具执行面探测（三态分开，绝不抛）：
 * `ctx.get('tools')` 缺席 ⇒ `no-tools`；tools 在但 `guard` 不是函数 ⇒ `no-guard`；
 * 两者皆备 ⇒ `ready`（guard 面以**绑定接收者的调用器**带出，调用方注册——
 * 宿主 guard 是用 this 的方法，裸引用会丢接收者，见函数内注释）。
 * 必须经 `ctx.get`（probeTools 同款理由：cordis 代理下属性访问必抛，被 catch
 * 吞成 `no-tools` 归类为服务缺席——探测失败绝不让插件挂载失败）。
 */
export type GuardFace =
  | { state: 'ready'; guard: (check: ToolGuardFn) => () => void }
  | { state: 'no-tools' }
  | { state: 'no-guard' }

export function probeGuardFace(ctx: unknown): GuardFace {
  try {
    const tools = (ctx as { get?: (name: string) => unknown }).get?.('tools') as { guard?: unknown } | undefined | null
    if (tools === undefined || tools === null) return { state: 'no-tools' }
    if (typeof tools.guard !== 'function') return { state: 'no-guard' }
    // 接收者必须保住：宿主 tools.guard 是**用 this 的方法**（dsh-tools
    // lib/index.js:2921 内读 this.ctx / this.layers.effect），裸方法引用摘出来
    // 再调会丢 this ⇒ TypeError ⇒ 注册抛错归 register-failed、护栏静默装不上
    // （d749c4c 引入的回归）。快照到局部常量后走**方法调用**（与 index.ts
    // teamLookup 的 `(agent) => teams.tryMembership?.(agent)` 同款范式）。
    const toolsService = tools as { guard: (check: ToolGuardFn) => () => void }
    return { state: 'ready', guard: (check) => toolsService.guard(check) }
  } catch {
    return { state: 'no-tools' }
  }
}
