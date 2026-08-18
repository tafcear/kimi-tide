import { configKey, type CandidateMeta, type Dim, type RouteTarget } from './config.js'

export type CostTier = 'cheap' | 'mid' | 'expensive'
const COST_VALUE: Record<CostTier, number> = { cheap: 0, mid: 0.5, expensive: 1 }
export function costTierFromPrice(per1M?: number): CostTier {
  if (per1M === undefined || !Number.isFinite(per1M)) return 'mid'
  if (per1M < 0.5) return 'cheap'
  if (per1M <= 2) return 'mid'
  return 'expensive'
}
export function scoreCandidate(meta: CandidateMeta, weights: Partial<Record<Dim, number>>, lambda: number,
  scoresOf: (m: CandidateMeta) => Record<Dim, number>): number {
  const scores = scoresOf(meta)
  let sum = 0
  for (const [dim, w] of Object.entries(weights)) sum += (w as number) * scores[dim as Dim]
  return sum - lambda * COST_VALUE[meta.costTier]
}
export interface SelectOptions {
  lambda: number; defaultTarget: RouteTarget; mode: 'off' | 'cost' | 'capability'
  hasImage: boolean; budgetExhausted: boolean; routeThreshold?: number
  scoresOf: (m: CandidateMeta) => Record<Dim, number>
}
export function selectCandidate(metas: CandidateMeta[], weights: Partial<Record<Dim, number>>,
  opts: SelectOptions): { target: RouteTarget; reason: string; scoreDelta: number } | null {
  const eligible = metas.filter((m) => m.available && (!opts.hasImage || m.modalities.includes('image')))
  if (eligible.length === 0) return null
  const scored = eligible.map((m) => ({ m, s: scoreCandidate(m, weights, opts.lambda, opts.scoresOf) }))
    .sort((x, y) => y.s - x.s)
  const best = scored[0]
  const def = scored.find((x) => x.m.provider === opts.defaultTarget.provider && x.m.model === opts.defaultTarget.model)
  const base = def?.s ?? scored[scored.length - 1].s
  const delta = best.s - base
  if (eligible.length > 1 && best.m.provider === opts.defaultTarget.provider && best.m.model === opts.defaultTarget.model) return null
  if (opts.mode === 'cost') {
    if (opts.budgetExhausted) return null
    if (delta < (opts.routeThreshold ?? 0.75)) return null
  }
  const dims = Object.keys(weights).join('+') || 'general'
  return { target: { provider: best.m.provider, model: best.m.model }, reason: `${opts.mode}:${dims}`, scoreDelta: Math.round(delta * 100) / 100 }
}
export { configKey }
