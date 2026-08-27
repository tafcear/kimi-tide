// src/effort-catalog.ts — effort 档位目录通道（0.8.0，spike 2026-08-27 实证）：
// 插件自有 Host→Client JSON 通道。宿主把候选枚举得到的 per-model
// reasoningEfforts 打成表，经 Typert remote（手工 contribution，src-json
// 编解码）供设置卡片读取；客户端经 ctx.remote.$mount 同名贡献获得
// kimiTide.effortCatalog() 调用面（评审 S1：panel 投影通道证伪后的正选）。
// 无装饰器、无生成器依赖：bindTypertRemote 形状以普通对象字面量复刻。
import type { CandidateMeta } from './config.js'

/** 服务键（wire namespace 与之一致，见 EFFORT_CATALOG_DESCRIPTOR）。 */
export const EFFORT_CATALOG_SERVICE = 'kimi-tide.catalog'

/** 档位表：'provider/model' → 支持的 reasoningEffort id 列表。 */
export type EffortCatalog = Record<string, string[]>

/** 从候选池建档位表（纯函数）：只收带 reasoningEfforts 的条目，返回副本。 */
export function buildEffortCatalog(metas: readonly CandidateMeta[]): EffortCatalog {
  const out: EffortCatalog = {}
  for (const meta of metas) {
    if (meta.reasoningEfforts === undefined || meta.reasoningEfforts.length === 0) continue
    out[`${meta.provider}/${meta.model}`] = [...meta.reasoningEfforts]
  }
  return out
}

/** 宿主/客户端共享的手工 InvocationDescriptor（两端逐字段一致）。 */
export const EFFORT_CATALOG_DESCRIPTOR = {
  id: 'dsh-kimi-tide#effortCatalog',
  service: EFFORT_CATALOG_SERVICE,
  namespace: 'kimiTide',
  method: 'effortCatalog',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'src-json' },
} as const

/** 宿主侧注册贡献（ctx.typert.register 的形状）。 */
export const EFFORT_CATALOG_CONTRIBUTION = {
  package: 'dsh-kimi-tide',
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [EFFORT_CATALOG_DESCRIPTOR],
} as const
