/**
 * ReviewCard — 评审卡（会话流渲染，review flow 1.1.0 spec §7，A6 验收载体）。
 *
 * 两个贡献（渲染缝 2026-09-04 实读锚定，宿主 checkout 只读）：
 * 1. `reviewNodeDefinition` — ConversationNodeDefinition 实现，把
 *    `kimi-tide/review` 会话事件（Task 5 `agent.session.append` 落日志）折叠成
 *    一张 chat 节点卡。契约：dsh-client-ui-conversation
 *    lib/types/client/contract/conversation.d.ts:157-208（五方法）；简单实做
 *    样例：dsh-client-ui-chat lib/client.js compactionDefinition :5576-5604 /
 *    unknownFallbackDefinition :5615-5634（后者 start 直取 event.data 为
 *    state——本文件同款）。
 * 2. `ReviewCard` — keyed 渲染器组件，经 `conversation.chat.node` 槽按
 *    kind = 'kimi-tide-review' 分发（槽注入样例 client.js:3582-3665；分发点
 *    client.js:1542 按 entryKey=node.kind 路由，未注册时落 JsonBlock 载荷兜底）。
 *
 * 类型策略：ui-chat / ui-conversation 均不在本包依赖面（esbuild externals 亦
 * 无），按 client/index.ts LocaleFace 先例只做最小结构面（各成员注释附锚点）；
 * ChatNodeDataMap 经宿主公共合并面声明合并（dsh-client-ui-chat
 * lib/types/client/index.d.ts:28-35 "Public merge surface for Chat renderer
 * payloads contributed by other plugins"——外部插件的合并路径，非包内
 * '../contract/chat-nodes.js' 路径）。
 */
import type { ReviewRecord } from '../types.js'

/** 评审卡 chat 渲染器 kind（ChatNodeDataMap 键；宿主按此值分发 keyed 槽）。 */
export const REVIEW_NODE_KIND = 'kimi-tide-review' as const

/**
 * ChatNodeDataMap 声明合并（文档级：客户端不在 typecheck 面，esbuild 擦除）。
 * 宿主合并面实读：dsh-client-ui-chat lib/types/client/index.d.ts:29-35。
 */
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** 评审卡载荷：record = 评审事件 data（ReviewRecord，spec §7）。 */
    'kimi-tide-review': { record: ReviewRecord }
  }
}

// ---- 宿主契约最小结构面（LocaleFace 先例：只取本文件用到的字段）----

/** SessionEventLike 最小面（conversation.d.ts:163 match 入参；字段见 fallback 样例 :5625-5631）。 */
interface EventLike {
  readonly type: string
  readonly seq: number
  readonly data: unknown
}

/** ConversationMatchResult（conversation.d.ts:4-7）：Definition 局部身份 + 生命周期角色。 */
interface MatchResult {
  readonly id: string
  readonly role: 'start' | 'update'
}

/** ConversationStartMatch 最小面（conversation.d.ts:98-106：event + role + location）。 */
interface StartMatch {
  readonly event: EventLike
  readonly location: unknown
}

/** ConversationNodeContext 最小面（conversation.d.ts:124-132：key/kind/id/start/matches）。 */
interface NodeContext {
  readonly key: string
  readonly kind: string
  readonly id: string
  readonly start: StartMatch | undefined
  readonly matches: readonly { readonly location: unknown }[]
}

/**
 * reviewNodeDefinition — 每条 `kimi-tide/review` 事件 = 一张独立评审卡。
 *
 * - match 唯一性：id = String(event.seq)（宿主 unknownFallbackDefinition 同款
 *   client.js:5621——事件序天然唯一，同 flowId 多轮评审/手动连发各成一张卡，
 *   重放同一事件幂等收敛到同一 context key，零碰撞）。
 * - 幂等 state：start 直取 event.data（ReviewRecord），事件数据的纯函数，
 *   不引用 context/reader；本 Definition 每事件皆 start，无 update 语义
 *   （契约必填，透传 state 即可——compactionDefinition :5596 同款保底）。
 * - buildViewNode：按宿主 chatNode() 助手（client.js:3977-3988）的实做形状
 *   产出 Chat 目标节点——ChatConversationViewNode（chat-nodes.d.ts:3-8）在
 *   基础五字段外必填 anchorSeq（事件序，可排序渲染位）/location（start→首
 *   match→unresolved 回落链）/visibility。
 */
export const reviewNodeDefinition = {
  kind: REVIEW_NODE_KIND,
  target: 'chat',
  match: (event: EventLike): MatchResult | null => {
    if (event.type !== 'kimi-tide/review') return null
    // 载荷非对象 = 畸形事件，不认领（compactionDefinition :5588 对 id 源同款守门）。
    if (typeof event.data !== 'object' || event.data === null) return null
    return { id: String(event.seq), role: 'start' }
  },
  start: (_context: unknown, match: { event: EventLike }): ReviewRecord =>
    match.event.data as ReviewRecord,
  update: (context: { state: ReviewRecord }): ReviewRecord => context.state,
  buildViewNode: (context: NodeContext) => {
    const record = contextStartRecord(context)
    if (record === null) return null
    return {
      key: context.key,
      kind: REVIEW_NODE_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? 0,
      location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: { record },
    }
  },
}

/** state 回落：context.state（引擎持有）→ start match 原始 data（fallbackState 样例 :5599）。 */
function contextStartRecord(context: NodeContext): ReviewRecord | null {
  const state = (context as { state?: unknown }).state
  if (state !== undefined) return state as ReviewRecord
  const fromStart = context.start?.event.data
  return typeof fromStart === 'object' && fromStart !== null ? fromStart as ReviewRecord : null
}

// ---- keyed 渲染器（conversation.chat.node 槽，client.js:1542 分发）----

/** keyed Chat 渲染器 PropsRuntime 最小面（client.js:1506-1542：owner 货币 + node）。 */
export interface ReviewCardProps {
  node: { kind: string; data: { record: ReviewRecord } }
}

/** `at`（ISO）→ 本地 HH:MM；解析失败回退原串（dock fmtClock 的字符串版惯例）。 */
function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 评审卡（spec §7）：徽标 = 评审模型 + flowId；正文 = reviewText；
 * `ok:false` 失败卡标灰（kt-review-card-failed）并显 error。
 */
export function ReviewCard(props: ReviewCardProps): JSX.Element {
  const record = props.node?.data?.record
  if (record === undefined) return <></>
  return (
    <div className={`kt-review-card${record.ok ? '' : ' kt-review-card-failed'}`}>
      <div className="kt-review-head">
        <span className="kt-review-badge">评审 · {record.reviewer.model}</span>
        <span className="kt-review-flow">{record.flowId}</span>
        <span className="kt-review-time" title={record.at}>{fmtTime(record.at)}</span>
      </div>
      {record.ok ? (
        <pre className="kt-review-body">{record.reviewText}</pre>
      ) : (
        <div className="kt-review-error">评审失败：{record.error ?? '未知错误'}</div>
      )}
    </div>
  )
}
