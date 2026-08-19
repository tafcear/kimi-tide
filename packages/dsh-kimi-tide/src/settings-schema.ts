// src/settings-schema.ts
import Schema from 'schemastery'
import { DIMS, DEFAULT_CONFIG_V2, type Dim, type RouterConfigV2 } from './config.js'

// 单一真相源：schema 默认值全部从 DEFAULT_CONFIG_V2 派生，不另抄一份（防漂移）。
// 注：candidates/allowedProviders 在 DEFAULT_CONFIG_V2 中按 providerName 参数化，
// schema 无法参数化，固定取生产 provider 'kimi-tide'；mergeResolved 路径不受影响
// （它先以 DEFAULT_CONFIG_V2(providerName) 打底再过 schema，schema 默认值只在
// 裸 section 经 T4 命名空间直接解析时生效，彼时 provider 即本插件自身）。
const D = DEFAULT_CONFIG_V2('kimi-tide')

// 分值域 0..5：归一化规则 score = 基准百分比 / 100 * 5（src/scores.ts），
// 用户覆盖分与基线同槽位同标度。
const dimSchema = Schema.object(Object.fromEntries(DIMS.map((d: Dim) => [d, Schema.number().min(0).max(5)])))
export const routerConfigSchema = Schema.object({
  version: Schema.const(2).default(D.version),
  mode: Schema.union([Schema.const('off'), Schema.const('cost'), Schema.const('capability')]).default(D.mode),
  default: Schema.object({ provider: Schema.string(), model: Schema.string() }).default(D.default),
  candidates: Schema.array(Schema.object({ provider: Schema.string(), model: Schema.string() })).default(D.candidates),
  scores: Schema.dict(dimSchema).default(D.scores),
  // patterns 形状校验不能在 schema 内做：实测 schemastery dict 会把缺失键
  // 解析为 {} 并注入（s({}) → { patterns: {} }），破坏与 DEFAULT_CONFIG_V2
  // classify:{} 的往返相等（审查者「缺失键不写入」的说法实测不成立）。
  // 故 classify 保留任意键透传，patterns 形状由 validateRouterConfig 把关。
  classify: Schema.object({}).default(D.classify),
  allowedProviders: Schema.array(Schema.string()).default(D.allowedProviders),
  costTiers: Schema.dict(Schema.union([Schema.const('cheap'), Schema.const('mid'), Schema.const('expensive')])).default(D.costTiers),
  routeThreshold: Schema.number().default(D.routeThreshold),
  lambda: Schema.number().default(D.lambda),
  premiumBudget: Schema.number().default(D.premiumBudget),
  budgetWindow: Schema.number().default(D.budgetWindow),
  charsPerToken: Schema.number().default(D.charsPerToken),
})

export function validateRouterConfig(raw: RouterConfigV2): string | undefined {
  // 语义裁决（控制器 Ruling 4，2026-08-19）：DEFAULT_CONFIG_V2 的 default
  // （deepseek-official/...）本就不在 candidates（仅 kimi-tide/kimi-for-coding），
  // 计划模板的「default ∈ candidates」与其自带应通过用例互斥；故校验
  // default.provider ∈ allowedProviders。default.model 的存在性无注册表可查
  // （模型清单属 provider 侧），不做校验。
  if (!raw.allowedProviders.includes(raw.default.provider)) {
    return `default provider '${raw.default.provider}' is not in allowedProviders`
  }
  for (const [name, range] of [['routeThreshold', 1], ['lambda', 1], ['premiumBudget', 1]] as const) {
    const v = raw[name]
    if (!Number.isFinite(v) || v < 0 || v > range) return `${name} out of range 0..${range}`
  }
  if (!Number.isInteger(raw.budgetWindow) || raw.budgetWindow <= 0) return 'budgetWindow must be a positive integer'
  if (raw.candidates.length === 0) return 'candidates must not be empty'
  // classify.patterns 形状校验（schema 层无法兼顾「不注入 {}」与形状校验，见上方注释）
  const patterns = (raw.classify as { patterns?: unknown }).patterns
  if (patterns !== undefined) {
    if (patterns === null || typeof patterns !== 'object' || Array.isArray(patterns)) {
      return 'classify.patterns must be a record of string arrays'
    }
    for (const [k, v] of Object.entries(patterns)) {
      if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
        return `classify.patterns['${k}'] must be an array of strings`
      }
    }
  }
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
