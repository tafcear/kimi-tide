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
 */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { KimiTidePanelProjection } from './types.js'

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
const panelSchema = z.object({
  quota: z.object({
    weekly: z.object({ used: z.number(), limit: z.number(), resetTime: z.string() }),
    fiveHour: z.object({ used: z.number(), limit: z.number(), resetTime: z.string() }),
    membershipLevel: z.string(),
    fetchedAt: z.number(),
    stale: z.boolean(),
  }).nullable(),
  // 0.8.x⑨：配额数据来源 provider（dock 限额区按当前路由目标门控渲染）。
  // 可选——缺席 = 旧载荷（历史唯一来源视同 kimi-coding）。
  quotaProvider: z.string().optional(),
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
    native: z.number(),
    transcribed: z.number(),
    blind: z.number(),
  }).optional(),
  lastFlowEvent: z.string().max(120).optional(),
}).nullable()

/** This unit's definition shape (rc.2 contract) — shared by the bridges and the export annotation. */
type PanelProjectionDefinition = ProjectionDefinition<typeof KIMI_TIDE_PANEL_KEY, KimiTidePanelProjection | null>

// dsh-session-projection depends on zod v4 while this package uses zod v3;
// the schema is structurally compatible at runtime (both validate plain JSON),
// so we bridge the type gap through unknown.
const bridgedStateSchema = panelSchema as unknown as PanelProjectionDefinition['stateSchema']

const bridgedViewSchema = panelSchema as unknown as
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
