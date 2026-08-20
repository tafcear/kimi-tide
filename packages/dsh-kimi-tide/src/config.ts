export type Dim = 'code' | 'reasoning' | 'writing' | 'tooluse' | 'vision' | 'longctx'
export const DIMS: Dim[] = ['code', 'reasoning', 'writing', 'tooluse', 'vision', 'longctx']
export interface RouteTarget { provider: string; model: string }
export interface CandidateMeta extends RouteTarget {
  modalities: string[]
  costTier: 'cheap' | 'mid' | 'expensive'
  available: boolean
}
/** 0.4.x：插件固定的 Kimi provider 路由（pi-ai catalog 原生名）。 */
export const KIMI_PROVIDER = 'kimi-coding'
export interface RouterConfigV3 {
  version: 3
  mode: 'off' | 'cost' | 'capability'
  default: RouteTarget
  candidates: RouteTarget[]
  scores: Record<string, Partial<Record<Dim, number>>>
  classify: { patterns?: Record<string, string[]> }
  allowedProviders: string[]
  costTiers: Record<string, 'cheap' | 'mid' | 'expensive'>
  routeThreshold: number
  lambda: number
  premiumBudget: number
  budgetWindow: number
  charsPerToken: number
}
export const configKey = (t: RouteTarget): string => `${t.provider}/${t.model}`
export function DEFAULT_CONFIG_V3(): RouterConfigV3 {
  return {
    version: 3, mode: 'off',
    default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    candidates: [{ provider: KIMI_PROVIDER, model: 'kimi-for-coding' }],
    scores: {}, classify: {}, allowedProviders: [KIMI_PROVIDER, 'deepseek-official'],
    costTiers: {}, routeThreshold: 0.75, lambda: 0.5,
    premiumBudget: 0.2, budgetWindow: 20, charsPerToken: 2,
  }
}
