export type Dim = 'code' | 'reasoning' | 'writing' | 'tooluse' | 'vision' | 'longctx'
export const DIMS: Dim[] = ['code', 'reasoning', 'writing', 'tooluse', 'vision', 'longctx']
export interface RouteTarget { provider: string; model: string }
export interface CandidateMeta extends RouteTarget {
  modalities: string[]
  costTier: 'cheap' | 'mid' | 'expensive'
  available: boolean
}
export interface RouterConfigV2 {
  version: 2
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
export function DEFAULT_CONFIG_V2(providerName: string): RouterConfigV2 {
  return {
    version: 2, mode: 'off',
    default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    candidates: [{ provider: providerName, model: 'kimi-for-coding' }],
    scores: {}, classify: {}, allowedProviders: [providerName, 'deepseek-official'],
    costTiers: {}, routeThreshold: 0.75, lambda: 0.5,
    premiumBudget: 0.2, budgetWindow: 20, charsPerToken: 2,
  }
}
