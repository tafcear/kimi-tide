/**
 * kimi-tide: panel projection — key 'kimi-tide/panel', whole-value push.
 * quota/router/models/configSource 是进程级字段；decision/imageContext/
 * lastFlowEvent 是按 agent 字段（2026-08-23 评审修复：决策观测不再跨会话
 * 串台）。宿主为每个存活会话组装并追加该会话自己的快照（语义签名去重，
 * 配额轮询的空帧不再膨胀会话日志），框架 fold 后推送。v3 payload: quota
 * + router + kimi 二态接入指示 + candidates + decision. v6 (0.6.0 协作编排)
 * adds optional imageContext（按图三态计数快照）+ lastFlowEvent（流执行摘要）
 * ——新字段可选，对存量读取端向后兼容。Pure unit functions + the
 * SessionProjectionMap merge that types both ends (host register / client
 * useProjection).
 *
 * **v1.2.0 会话事件解耦（2026-09-10）——本 unit 自此只读存量**：插件不再写
 * `kimi-tide/panel` 事件（全库 120,705 条 / 203.7 MB / 占会话事件体积 27.9%，
 * 且是 09-10 格式迁移整卷拒载的主因），面板数据改由 `/kimi-tide panel --json`
 * 命令通道按需供给（dock 拉模型）。注册保留的理由：08-25 之前的历史会话日志
 * 里仍有这些事件，投影不注册就再也折不出来（旧载荷容忍见下方
 * `normalizePanelPayload`）。新会话该 key 恒为 null，dock 走命令通道。
 */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { KimiReviewProjection, KimiTidePanelProjection, ReviewRecord } from './types.js'

export const KIMI_TIDE_PANEL_KEY = 'kimi-tide/panel' as const
/** Session event type carrying the whole panel payload (log + fold input). */
export const KIMI_TIDE_PANEL_EVENT = 'kimi-tide/panel' as const

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Whole panel snapshot (quota + router + kimi 二态 + candidates + decision). */
    'kimi-tide/panel': KimiTidePanelProjection
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'kimi-tide/panel': KimiTidePanelProjection | null
  }
  interface SessionProjectionStateMap {
    'kimi-tide/panel': KimiTidePanelProjection | null
  }
}

/** Wire-payload guard. Structural (passthrough) — the payload crosses one process boundary only. */
const quotaSnapshotSchema = z.object({
  weekly: z.object({ used: z.number(), limit: z.number(), resetTime: z.string() }),
  fiveHour: z.object({ used: z.number(), limit: z.number(), resetTime: z.string() }),
  membershipLevel: z.string(),
  fetchedAt: z.number(),
  stale: z.boolean(),
})

const panelSchema = z.object({
  quota: quotaSnapshotSchema.nullable(),
  // 0.8.x⑨：配额数据来源 provider（dock 限额区按当前路由目标门控渲染）。
  // 可选——缺席 = 旧载荷（历史唯一来源视同 kimi-coding）。
  quotaProvider: z.string().optional(),
  // 多 plan 配额（2026-08-29 用户裁定）：provider → 快照 | null（null = 已知源
  // 本轮无数据）。可选——旧载荷无该字段照常通过（向后兼容）。
  quotas: z.record(z.string(), quotaSnapshotSchema.nullable()).optional(),
  // projection v3 (0.4.x): 二态接入指示（spec §3.5/验收 5）——路由已注册 + key
  // 可解析，绝不携带 key 值。
  kimi: z.object({ route: z.boolean(), key: z.boolean() }),
  router: z.record(z.string(), z.unknown()),
  reasoning: z.object({ enabled: z.literal(true) }),
  models: z.object({ kimi: z.array(z.string()), deepseek: z.array(z.string()) }).optional(),
  // projection v2 (0.3.0): config source observability + candidate pool
  // summary + decision digest (spec §2.7; full score tables stay host-side).
  configSource: z.union([z.literal('settings'), z.literal('sidecar'), z.literal('patch'), z.literal('default')]),
  candidates: z.array(z.object({
    provider: z.string(),
    model: z.string(),
    available: z.boolean(),
  })),
  decision: z.object({
    chosen: z.object({ provider: z.string(), model: z.string() }),
    reason: z.string().max(120),
  }).nullable(),
  // projection v6 (0.6.0 协作编排)：图像上下文行 + 流执行事件。两者均可选——
  // imageContext 缺席 = 无图会话（投影不写该字段）；lastFlowEvent 沿用
  // decision 摘要的 ≤120 截断惯例（推送侧截断，schema 拒超长）。
  imageContext: z.object({
    // 0.6.x池#6：计数语义 = 非负整数（wire 面拒绝负数与小数）。
    native: z.number().int().nonnegative(),
    transcribed: z.number().int().nonnegative(),
    blind: z.number().int().nonnegative(),
  }).optional(),
  lastFlowEvent: z.string().max(120).optional(),
})

/**
 * 旧载荷容忍（2026-09-04 → 09-10 交接单，第一优先项）。
 *
 * 0.6.0 之前的面板载荷缺 `kimi`/`configSource`/`candidates`/`decision` 四个后加
 * 字段，必填 schema 一抛错，宿主投影 fold 即整卷拒载（`failed to project
 * session`）——09-10 全量统计 176 个会话（含 50 个顶层对话，均 08-25 之前）。
 * 实测形状两种：pre-0.4 `{quota,local,router,reasoning,models}`；0.4–0.5 只缺
 * `kimi`（`session-6ca2f899` 53 条、`session-c01dab3c` 616 条同形）。
 *
 * 为什么是 preprocess 而不是 `.optional()`（09-10 修法纠偏）：消费端读的是
 * `panel.decision !== null`（`client/TideDock.tsx:232/237/261`），`.optional()`
 * 让缺席成为 `undefined`，`undefined !== null` 为真 → 进分支后读
 * `.chosen.provider` 直接崩。preprocess 在 parse 前补齐默认值，
 * **输出形状与现行 schema 逐字相同**（客户端零改动，stateVersion 不必递升）。
 *
 * 只补 `undefined`（真缺席）；显式 null 或类型不符一律留给 schema 拒绝——
 * 容忍旧载荷不等于纵容损坏载荷。旧版标记（`router.mode` 或
 * `local`）缺席且四字段有缺 → 视为现代载荷半损坏，照旧抛错。
 */
function normalizePanelPayload(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  const legacyMarker = 'local' in record || (typeof record.router === 'object' && record.router !== null
    && 'mode' in (record.router as Record<string, unknown>))
  const missingModern = record.kimi === undefined || record.configSource === undefined
    || record.candidates === undefined || record.decision === undefined
  if (!legacyMarker || !missingModern) return value
  return {
    // 历史会话早于二态接入指示（0.4.x）：无记录即视为未接入，导出 dock 的
    // 「未见接入」文案，不臆测当时是否真的接了。
    kimi: { route: false, key: false },
    // 早于配置来源可观测（0.4.x）：视同内置默认（SOURCE_LABELS.default='内置默认'）。
    configSource: 'default',
    candidates: [],
    decision: null,
    ...record,
  }
}

/** parse 前补齐旧载荷默认值；输出形状与 {@link panelSchema} 一致。 */
const panelPayloadSchema = z.preprocess(normalizePanelPayload, panelSchema.nullable())

/** This unit's definition shape (rc.2 contract) — shared by the bridges and the export annotation. */
type PanelProjectionDefinition = ProjectionDefinition<typeof KIMI_TIDE_PANEL_KEY, KimiTidePanelProjection | null>

// dsh-session-projection depends on zod v4 while this package uses zod v3;
// the schema is structurally compatible at runtime (both validate plain JSON),
// so we bridge the type gap through unknown.
const bridgedStateSchema = panelPayloadSchema as unknown as PanelProjectionDefinition['stateSchema']

const bridgedViewSchema = panelPayloadSchema as unknown as
  NonNullable<PanelProjectionDefinition['wire']>['viewSchema']

// Annotated with the registry's wire-required shape (register overload 1:
// Omit<Def,'wire'> & { wire: NonNullable<Def['wire']> }) so the register call
// needs no cast — and dropping `wire` here becomes a compile error instead of
// a silently host-only unit.
export const kimiTideProjectionDefinition:
  Omit<PanelProjectionDefinition, 'wire'> & { wire: NonNullable<PanelProjectionDefinition['wire']> } = {
  key: KIMI_TIDE_PANEL_KEY,
  stateSchema: bridgedStateSchema,
  // v5 → v6（0.6.0）：形状变更即弃旧缓存（rc.2 迁移惯例——stateVersion 递升
  // 使持久化的 v5 行整体作废，无需逐字段迁移）。
  stateVersion: 6,
  init: () => null,
  apply: (state, event) => {
    // Custom event types are not in the SessionEvent discriminated union;
    // compare via widened string check.
    if ((event as { type: string }).type === KIMI_TIDE_PANEL_EVENT) {
      return (event as { data: unknown }).data as KimiTidePanelProjection
    }
    return state
  },
  wire: {
    viewSchema: bridgedViewSchema,
    view: (state) => state,
  },
}

/**
 * kimi-tide: review projection — key 'kimi-tide/review' (1.1.0 spec §7).
 * 独立 unit，不并入 panel（2026-09-04 评审修复 L4 裁定：panel 快照签名被 60s
 * 配额轮询驱动、语义去重面向整值快照，评审记录混入会污染签名并膨胀事件流）。
 * 每条评审事件 = 一条 ReviewRecord（Task 5 逐条 append）；fold 每会话保留
 * 最近 REVIEW_KEEP 条（新到旧）。stateVersion 1；wire 必带（register 重载 1
 * 注解与 panel 同款——掉 wire=host-only 的静默错误在编译期报）。
 */
export const KIMI_TIDE_REVIEW_KEY = 'kimi-tide/review' as const
/** Session event type carrying one review record (log + fold input). */
export const KIMI_TIDE_REVIEW_EVENT = 'kimi-tide/review' as const

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** 一条评审记录载荷（spec §7）——fold 侧逐条前置进 records。 */
    'kimi-tide/review': ReviewRecord
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'kimi-tide/review': KimiReviewProjection | null
  }
  interface SessionProjectionStateMap {
    'kimi-tide/review': KimiReviewProjection | null
  }
}

/**
 * 记录形状守门（spec §7 载荷字段；userText ≤200 摘要上限入 schema，wire 面
 * 拒绝超长——review.ts 推送侧同款截断，双端防御）。error 可选（失败载荷）。
 */
const reviewRecordSchema = z.object({
  flowId: z.string(),
  reviewer: z.object({ provider: z.string(), model: z.string() }),
  turn: z.number().int(),
  userText: z.string().max(200),
  reviewText: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  durationMs: z.number(),
  at: z.string(),
})
/** Fold 状态 = 最近 ≤20 条记录（新到旧）或 null（空日志，init 惯例）。 */
const reviewProjectionSchema = z.object({ records: z.array(reviewRecordSchema).max(20) }).nullable()

/** This unit's definition shape (rc.2 contract) — shared by the bridges and the export annotation. */
type ReviewProjectionDefinition = ProjectionDefinition<typeof KIMI_TIDE_REVIEW_KEY, KimiReviewProjection | null>

// zod v3→v4 bridge 惯例与 panel :87-93 一致（dsh-session-projection 依赖 zod v4，
// 本包用 zod v3——运行时结构兼容，类型经 unknown 桥接）。
const bridgedReviewStateSchema = reviewProjectionSchema as unknown as ReviewProjectionDefinition['stateSchema']

const bridgedReviewViewSchema = reviewProjectionSchema as unknown as
  NonNullable<ReviewProjectionDefinition['wire']>['viewSchema']

// 同 panel :95-98 注解——掉 `wire` 在此变成编译错误而非静默 host-only unit。
/** fold 保留条数（spec §7：每会话最近 20 条）。 */
const REVIEW_KEEP = 20
export const kimiReviewProjectionDefinition:
  Omit<ReviewProjectionDefinition, 'wire'> & { wire: NonNullable<ReviewProjectionDefinition['wire']> } = {
  key: KIMI_TIDE_REVIEW_KEY,
  stateSchema: bridgedReviewStateSchema,
  stateVersion: 1,
  init: () => null,
  apply: (state, event) => {
    // Custom event types are not in the SessionEvent discriminated union;
    // compare via widened string check. 无关事件返回同一引用（零下游工作）。
    if ((event as { type: string }).type !== KIMI_TIDE_REVIEW_EVENT) return state
    const incoming = (event as { data: ReviewRecord }).data
    const previous = state?.records ?? []
    return { records: [incoming, ...previous].slice(0, REVIEW_KEEP) }
  },
  wire: {
    viewSchema: bridgedReviewViewSchema,
    view: (state) => state,
  },
}
