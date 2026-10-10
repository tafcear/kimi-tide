/**
 * 上下文窗口装得下判定（issue #13，纯函数）。
 *
 * 来由（GitHub issue #13，real-geekfan，2026-10-10）：规则命中的目标模型上下文
 * 窗口小于会话当前占用时，整轮请求以 400 INVALID_REQUEST 失败且 message 为空串
 * ——插件此前全仓不读 contextWindow，decide() 的规则链只有「目标可用」与「图像
 * 模态」两项可用性判定，装不下会话的目标照常被路由。本模块给出装得下判据：
 * 目标窗口须容纳「会话占用 + 预留（CONTEXT_RESERVE_TOKENS）」。
 *
 * 未知一律放行：窗口非有限正数、或占用未知（度量缺席/失败）时返回 fits:true
 * ——不伪造窗口值、不因能力未知拦路由（行为与修前一致）。纯函数，无副作用。
 */

/** 会话当前占用（token 数；来源 = 宿主 tokenMeter 的度量，见 index.ts）。 */
export interface ContextOccupancy { tokens: number }

/** 会话占用度量函数形状（index.ts 侧实现：度量缺席/失败一律返回 undefined）。 */
export type ContextOccupancyFn = (session: unknown) => ContextOccupancy | undefined

/** 判定结果：available = 窗口 −（占用 + 预留）；装不下时 reason 为诊断串。 */
export interface WindowFitVerdict { fits: boolean; available: number; reason?: string }

/** 窗口预留（响应与系统开销；负值 available 视为装不下）。 */
export const CONTEXT_RESERVE_TOKENS = 32000

export function windowFit(contextWindow: number | undefined, occupancy: ContextOccupancy | undefined): WindowFitVerdict {
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return { fits: true, available: Number.POSITIVE_INFINITY }
  }
  if (occupancy === undefined) return { fits: true, available: Number.POSITIVE_INFINITY }
  const available = contextWindow - (occupancy.tokens + CONTEXT_RESERVE_TOKENS)
  if (available >= 0) return { fits: true, available }
  return {
    fits: false,
    available,
    reason: `窗口容不下：目标 ${contextWindow.toLocaleString('en-US')} < ${Math.round(occupancy.tokens).toLocaleString('en-US')} + 预留 ${CONTEXT_RESERVE_TOKENS.toLocaleString('en-US')}`,
  }
}
