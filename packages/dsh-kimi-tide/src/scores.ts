import { configKey, DIMS, type Dim, type RouteTarget, type RouterConfigV2 } from './config.js'
export const SCORES_VERSION = 1
const BASELINE: Record<string, Partial<Record<Dim, number>>> = {
  'kimi-tide/k3': { code: 4.5, reasoning: 4.5, writing: 4, tooluse: 4, longctx: 4 },
  'kimi-tide/kimi-for-coding': { code: 4, reasoning: 4, writing: 3.5, tooluse: 4, longctx: 3 },
  'deepseek-official/deepseek-v4-flash': { code: 3.5, reasoning: 3.5, writing: 3.5, tooluse: 3.5, longctx: 3 },
  'deepseek-official/deepseek-v4-pro': { code: 4.5, reasoning: 4.5, writing: 4, tooluse: 4, longctx: 3.5 },
}
export function scoreFor(cfg: RouterConfigV2, target: RouteTarget): Record<Dim, number> {
  const key = configKey(target)
  const base = BASELINE[key]
  const user = cfg.scores[key]
  const out = {} as Record<Dim, number>
  for (const dim of DIMS) {
    out[dim] = user?.[dim] ?? base?.[dim] ?? (dim === 'vision' ? 0 : 2.5)
  }
  return out
}
