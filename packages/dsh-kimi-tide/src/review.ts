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
import { CONTEXT_SUMMARY_MAX_CHARS, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, GenerateOptions, Message, UserMessage } from '@deepseek-ai/dsh-llm'
import type { ReviewFlow } from './config.js'
import { parseReviewVerdict, verdictLabel, type ReviewVerdict } from './review-verdict.js'

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
  /**
   * 结论解析结果（v1.4.0 spec §3.3：解析结果写入事件载荷，便于事后对账）。
   * 失败载荷恒 `unknown`。旧日志里的评审记录没有这个字段 ⇒ 读侧必须容忍缺席。
   */
  verdict: ReviewVerdict
}

/**
 * 退回留痕载荷（v1.4.0 spec §3.6）：`kimi-tide/review-revise` 事件的数据。
 * `stopped: 'limit'` = 命中修订上限，只留痕不 steer（spec §3.4「达上限即停，
 * 事件卡标已停」）——此时 reviseIndex 为已用掉的修订次数。
 */
export interface ReviewRevisePayload {
  flowId: string
  /** 被修订的那一轮（手动评审路径为 -1，同评审载荷语义）。 */
  turn: number
  reason: 'auto' | 'manual'
  verdict: ReviewVerdict
  /** 第几次修订（1 起；`stopped` 时 = 已用尽的上限值）。 */
  reviseIndex: number
  stopped?: 'limit'
  at: string
}

/**
 * 修订注入消息的 producer 标识（v1.4.0 评审闭环 spec §3.2）。
 *
 * 本轮修订走 `agent.steer(createUserMessage(...))`：宿主的轮循环把这条 user 消息
 * 落成 `user/message` 会话事件并起下一轮（dsh-agent-loop `step()`：
 * `session.append('user/message', message)`）。消息的 `source.kind` 是本插件自
 * 己声明的值（MessageSourceMap 是 merge-extensible 的 sum type，每个 producer
 * 声明自己的 kind——dsh-agent 的 'model-selection' 是同款先例），因此：
 * - 编排侧据此识别「本轮由修订发起」⇒ 跳过评审武装（否则注入文本里的「意见」
 *   等词会命中评审词组，一次修订触发两次评审）；
 * - session feed 的人类枝判据 (`source.kind === 'user'`) 天然忽略它 ⇒ 修订文本
 *   不会覆盖 lastTurn.userText（评审需求恒人类）。
 */
export const REVISE_SOURCE_KIND = 'kimi-tide-revise' as const

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** 一条由 kimi-tide 评审闭环发起的修订请求（`notice` 形态一句话摘要）。 */
    'kimi-tide-revise': ContextFormed & { kind: 'kimi-tide-revise' }
  }
}

/** 是否为本插件发起的修订注入消息（编排层判别；未知/人类/注入一律 false）。 */
export function isReviseMessage(message: unknown): boolean {
  const source = (message as { source?: { kind?: unknown } } | null | undefined)?.source
  return source?.kind === REVISE_SOURCE_KIND
}

const REVISE_INSTRUCTION =
  '〔月汐 · 按意见修订〕上一轮产出被判为「{VERDICT}」。请只修改下面指出的问题，' +
  '不要重写无关部分，也不要顺手引入新的大改；改完用一两句说明改了什么。'

/** 修订输入构造入参（结论 + 评审正文）。 */
export interface ReviseInput {
  reviewText: string
  verdict: ReviewVerdict
}

/**
 * 修订注入文本（spec §3.2）：〔评审意见摘要〕＋〔修订指令〕。评审正文按
 * REVIEW_INPUT_LIMIT 单段截断（与评审输入同源上限——**上限只约束评审正文那一段**，
 * 指令头另计，整条注入文本因此略长于 LIMIT）。
 */
export function buildReviseInput(input: ReviseInput): string {
  return [
    REVISE_INSTRUCTION.replace('{VERDICT}', verdictLabel(input.verdict)),
    '',
    '[评审意见]',
    truncate(input.reviewText),
  ].join('\n')
}

/** 修订消息的 source（notice 形态：宿主 chat 渲染一行摘要，不展开整段）。 */
export function reviseMessageSource(verdict: ReviewVerdict): {
  kind: typeof REVISE_SOURCE_KIND
  form: 'notice'
  summary: string
} {
  const summary = `月汐：按意见修订（${verdictLabel(verdict)}）`
  return {
    kind: REVISE_SOURCE_KIND,
    form: 'notice',
    summary: summary.length <= CONTEXT_SUMMARY_MAX_CHARS ? summary : `${summary.slice(0, CONTEXT_SUMMARY_MAX_CHARS - 1)}…`,
  }
}

/** 构造一条修订注入消息（宿主 steer 入参形状 = UserMessage）。 */
export function createReviseMessage(input: ReviseInput): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: buildReviseInput(input) }],
    source: reviseMessageSource(input.verdict),
  }) as unknown as UserMessage
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
      // 结论解析在**推送侧**做一次（spec §3.3：解析结果写入事件载荷）——客户端与
      // 编排层读同一份判定，避免两处各解析一次而口径漂移。
      return {
        ...base,
        reviewText: text,
        ok: true,
        verdict: parseReviewVerdict(text),
        durationMs: Date.now() - startedAt,
        at: new Date().toISOString(),
      }
    } catch (error) {
      return {
        ...base,
        reviewText: '',
        ok: false,
        verdict: 'unknown' as ReviewVerdict,
        error: (error as Error).message,
        durationMs: Date.now() - startedAt,
        at: new Date().toISOString(),
      }
    }
  }
}
