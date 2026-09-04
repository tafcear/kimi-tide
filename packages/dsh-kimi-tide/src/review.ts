/**
 * Review flow 1.1.0（spec §6）：评审输入构造 + 评审调用 runner。
 * 纯文本无图、不设 purpose（auxRewriteTarget 不触及）、不带 effort（M7）、
 * AbortSignal.timeout(60s) 有界——评审发生于轮关闭后，不复用 turn signal
 * （spec §5.4）。runner 内 chunk 判别与 createStreamVisionCaller
 * （router.ts:406-415）一致：text-delta 累积、finish reason.kind 为
 * error/aborted 时抛错（失败落 ok:false 载荷，不向外抛）。产物接口由
 * Task 5（编排 runner）与 Task 4（投影 payload = ReviewEventPayload）消费。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { ReviewFlow } from './config.js'

/** 评审输入单段截断上限（字符，spec §6；Task 5 累计侧将共用此常量）。 */
export const REVIEW_INPUT_LIMIT = 12_000
/** 评审调用有界超时：评审发生于轮关闭后，轮 signal 已不可用（spec §5.4）。 */
const REVIEW_TIMEOUT_MS = 60_000
/** 事件载荷 userText 摘要上限（spec §7：≤200 字符）。 */
const USER_TEXT_DIGEST_LIMIT = 200

/** 评审请求：一轮已关闭的「用户需求 + 主模型产出」快照。 */
export interface ReviewRequest {
  flowId: string
  flow: ReviewFlow
  turn: number
  userText: string
  output: string
}

/** 评审事件载荷（= 投影 payload / 事件卡载荷，spec §7）。 */
export interface ReviewEventPayload {
  flowId: string
  reviewer: { provider: string; model: string }
  turn: number
  userText: string
  reviewText: string
  ok: boolean
  error?: string
  durationMs: number
  at: string
}

/** 超限截断并加标注；未超限原样返回。 */
export function truncate(text: string, limit: number = REVIEW_INPUT_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…（已截断）`
}

const REVIEW_INSTRUCTION =
  '你是资深技术评审。请对「主模型回答」做交叉评审：先列问题（含严重度：阻塞/建议/可选），' +
  '再给改进建议，最后一行结论（通过/有条件通过/不通过）。只评内容质量与需求贴合度，' +
  '不重述需求；无实质问题时直说「未发现实质问题」。'

/** spec §6 三段式评审输入：内建指令 + 本轮用户需求 + 主模型本轮产出（双段截断）。 */
export function buildReviewInput(req: ReviewRequest): string {
  return [
    REVIEW_INSTRUCTION,
    '',
    '[本轮用户需求]',
    truncate(req.userText),
    '',
    '[主模型本轮产出]',
    truncate(req.output),
  ].join('\n')
}

/**
 * 评审调用 runner（Task 5 编排 / Task 6 手动命令共用）：ctx.llm.stream 直调
 * reviewer，单条 user 消息（buildReviewInput）；流成功 → ok:true 载荷，
 * 流失败/空输出 → ok:false + error 载荷——任何情形都不向外抛。
 */
export function createReviewRunner(ctx: Context): (req: ReviewRequest) => Promise<ReviewEventPayload> {
  return async (req: ReviewRequest): Promise<ReviewEventPayload> => {
    const startedAt = Date.now()
    const base = {
      flowId: req.flowId,
      reviewer: { provider: req.flow.reviewer.provider, model: req.flow.reviewer.model },
      turn: req.turn,
      userText: req.userText.slice(0, USER_TEXT_DIGEST_LIMIT),
    }
    try {
      const options: GenerateOptions = {
        provider: req.flow.reviewer.provider,
        model: req.flow.reviewer.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: buildReviewInput(req) }] }] as unknown as Message[],
        signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
      }
      let text = ''
      for await (const chunk of ctx.llm.stream(options)) {
        if (chunk.type === 'text-delta') {
          text += chunk.text
        } else if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
          throw new Error(`review ${chunk.reason.kind}: ${chunk.reason.failure.message} (${chunk.reason.failure.code})`)
        }
      }
      if (text.trim() === '') throw new Error('review empty output')
      return { ...base, reviewText: text, ok: true, durationMs: Date.now() - startedAt, at: new Date().toISOString() }
    } catch (error) {
      return { ...base, reviewText: '', ok: false, error: (error as Error).message, durationMs: Date.now() - startedAt, at: new Date().toISOString() }
    }
  }
}
