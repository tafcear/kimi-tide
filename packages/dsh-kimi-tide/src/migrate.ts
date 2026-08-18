import { DEFAULT_CONFIG_V2, type RouterConfigV2, type RouteTarget } from './config.js'

function target(v: unknown): RouteTarget | null {
  const r = (v ?? {}) as Record<string, unknown>
  if (typeof r.provider !== 'string' || typeof r.model !== 'string') return null
  return { provider: r.provider, model: r.model }
}

export function migrateV1(raw: unknown, warn: (m: string) => void): RouterConfigV2 {
  const base = DEFAULT_CONFIG_V2('kimi-tide')
  const r = (raw ?? {}) as Record<string, unknown>
  const primary = target(r.primary)
  const premium = target(r.premium)
  if (primary === null && premium === null) return base
  if (r.premiumLong !== undefined) warn('dsh-kimi-tide: premiumLong 已废弃（0.3.0），迁移时丢弃')
  return {
    ...base,
    mode: r.mode === 'cost' || r.mode === 'capability' ? r.mode : 'off',
    default: primary ?? base.default,
    candidates: premium !== null ? [premium] : base.candidates,
    premiumBudget: typeof r.premiumBudget === 'number' ? r.premiumBudget : base.premiumBudget,
    budgetWindow: typeof r.budgetWindow === 'number' ? r.budgetWindow : base.budgetWindow,
    charsPerToken: typeof r.charsPerToken === 'number' ? r.charsPerToken : base.charsPerToken,
  }
}
