// src/settings-schema.ts
import Schema from 'schemastery'
import { DIMS, DEFAULT_CONFIG_V2, type Dim, type RouterConfigV2 } from './config.js'

const dimSchema = Schema.object(Object.fromEntries(DIMS.map((d: Dim) => [d, Schema.number().min(0).max(1)])))
export const routerConfigSchema = Schema.object({
  version: Schema.const(2).default(2),
  mode: Schema.union([Schema.const('off'), Schema.const('cost'), Schema.const('capability')]).default('off'),
  default: Schema.object({ provider: Schema.string(), model: Schema.string() }).default({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
  candidates: Schema.array(Schema.object({ provider: Schema.string(), model: Schema.string() })).default([{ provider: 'kimi-tide', model: 'kimi-for-coding' }]),
  scores: Schema.dict(dimSchema).default({}),
  classify: Schema.object({}).default({}),
  allowedProviders: Schema.array(Schema.string()).default(['kimi-tide', 'deepseek-official']),
  costTiers: Schema.dict(Schema.union([Schema.const('cheap'), Schema.const('mid'), Schema.const('expensive')])).default({}),
  routeThreshold: Schema.number().default(0.75),
  lambda: Schema.number().default(0.5),
  premiumBudget: Schema.number().default(0.2),
  budgetWindow: Schema.number().default(20),
  charsPerToken: Schema.number().default(2),
})

export function validateRouterConfig(raw: RouterConfigV2): string | undefined {
  const key = (t: { provider: string; model: string }) => `${t.provider}/${t.model}`
  const knownProviders = new Set(raw.allowedProviders)
  if (!knownProviders.has(raw.default.provider)) return `default target ${key(raw.default)} is not in candidates`
  for (const [name, range] of [['routeThreshold', 1], ['lambda', 1], ['premiumBudget', 1]] as const) {
    const v = raw[name]
    if (!Number.isFinite(v) || v < 0 || v > range) return `${name} out of range 0..${range}`
  }
  if (!Number.isInteger(raw.budgetWindow) || raw.budgetWindow <= 0) return 'budgetWindow must be a positive integer'
  if (raw.candidates.length === 0) return 'candidates must not be empty'
  return undefined
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return structuredClone(patch)
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = deepMerge(out[k], v)
  return out
}

export function mergeResolved(entry: unknown, providerName: string): RouterConfigV2 {
  const defaults = DEFAULT_CONFIG_V2(providerName)
  const resolved = deepMerge(defaults, entry) as RouterConfigV2
  return routerConfigSchema(resolved) as RouterConfigV2
}
