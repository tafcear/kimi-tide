import { DEFAULT_CONFIG_V3, DEFAULT_CONFIG_V4, KIMI_PROVIDER, type RouterConfigV3, type RouterConfigV4, type RouteTarget } from './config.js'

function target(v: unknown): RouteTarget | null {
  const r = (v ?? {}) as Record<string, unknown>
  if (typeof r.provider !== 'string' || typeof r.model !== 'string') return null
  return { provider: r.provider, model: r.model }
}

/** provider 值改名：'kimi-tide' → KIMI_PROVIDER，其余原样（空串表示缺失）。 */
function renameProvider(p: unknown): string {
  return p === 'kimi-tide' ? KIMI_PROVIDER : typeof p === 'string' ? p : ''
}
/** 'kimi-tide/xxx' 键前缀改名 → 'kimi-coding/xxx'。 */
function renameKey(k: string): string {
  return k.startsWith('kimi-tide/') ? `${KIMI_PROVIDER}/${k.slice('kimi-tide/'.length)}` : k
}

/**
 * v2 → v3 迁移（spec §3.3）：把 default/candidates/allowedProviders 中的
 * provider 'kimi-tide' 改写为 'kimi-coding'，scores/costTiers 键前缀同步改写，
 * 其余字段原样；version 置 3。幂等：已是 v3 且无 kimi-tide 残留 → 原引用返回。
 * 输入假定为结构合格的 v2 形（调用方已做结构校验，见 sidecar.validate /
 * commands.parseImportedFile / 命名空间 scope.get()）。
 */
export function migrateV2(raw: unknown): RouterConfigV3 {
  const base = DEFAULT_CONFIG_V3()
  const r = (raw ?? {}) as Record<string, unknown>
  const residue = JSON.stringify([r.default, r.candidates, r.allowedProviders, r.scores, r.costTiers]).includes('kimi-tide')
  if (r.version === 3 && !residue) return raw as RouterConfigV3
  const d = (r.default ?? {}) as Record<string, unknown>
  const candidates = Array.isArray(r.candidates) ? r.candidates : base.candidates
  const allowed = Array.isArray(r.allowedProviders) ? r.allowedProviders : base.allowedProviders
  const scores: Record<string, unknown> = {}
  for (const [k, v] of Object.entries((r.scores ?? {}) as Record<string, unknown>)) scores[renameKey(k)] = v
  const costTiers: Record<string, unknown> = {}
  for (const [k, v] of Object.entries((r.costTiers ?? {}) as Record<string, unknown>)) costTiers[renameKey(k)] = v
  return {
    version: 3,
    mode: r.mode === 'off' || r.mode === 'cost' || r.mode === 'capability' ? r.mode : base.mode,
    default: { provider: renameProvider(d.provider) || base.default.provider, model: typeof d.model === 'string' ? d.model : base.default.model },
    candidates: candidates.map((c) => {
      const t = (c ?? {}) as Record<string, unknown>
      return { provider: renameProvider(t.provider) || base.candidates[0].provider, model: typeof t.model === 'string' ? t.model : base.candidates[0].model }
    }),
    scores: scores as RouterConfigV3['scores'],
    classify: (r.classify ?? base.classify) as RouterConfigV3['classify'],
    allowedProviders: allowed.map((p) => renameProvider(p) || KIMI_PROVIDER),
    costTiers: costTiers as RouterConfigV3['costTiers'],
    routeThreshold: typeof r.routeThreshold === 'number' ? r.routeThreshold : base.routeThreshold,
    lambda: typeof r.lambda === 'number' ? r.lambda : base.lambda,
    premiumBudget: typeof r.premiumBudget === 'number' ? r.premiumBudget : base.premiumBudget,
    budgetWindow: typeof r.budgetWindow === 'number' ? r.budgetWindow : base.budgetWindow,
    charsPerToken: typeof r.charsPerToken === 'number' ? r.charsPerToken : base.charsPerToken,
  }
}

/** v1（0.2.x）→ v3：旧逻辑产出 v2 形（base 已 v3），再过 migrateV2 收尾改名。 */
export function migrateV1(raw: unknown, warn: (m: string) => void): RouterConfigV3 {
  const base = DEFAULT_CONFIG_V3()
  const r = (raw ?? {}) as Record<string, unknown>
  const primary = target(r.primary)
  const premium = target(r.premium)
  if (primary === null && premium === null) return base
  if (r.premiumLong !== undefined) warn('dsh-kimi-tide: premiumLong 已废弃（0.3.0），迁移时丢弃')
  return migrateV2({
    version: 2,
    mode: r.mode === 'cost' || r.mode === 'capability' ? r.mode : 'off',
    default: primary ?? base.default,
    candidates: premium !== null ? [premium] : base.candidates,
    premiumBudget: typeof r.premiumBudget === 'number' ? r.premiumBudget : base.premiumBudget,
    budgetWindow: typeof r.budgetWindow === 'number' ? r.budgetWindow : base.budgetWindow,
    charsPerToken: typeof r.charsPerToken === 'number' ? r.charsPerToken : base.charsPerToken,
  })
}

/** 版本分派迁移入口：3 → 直通；2 → migrateV2；其余 → v1 链。 */
export function coerceRouterConfig(raw: unknown, warn: (m: string) => void): RouterConfigV3 {
  const v = (raw as { version?: unknown } | null)?.version
  if (v === 3) return raw as RouterConfigV3
  if (v === 2) return migrateV2(raw)
  return migrateV1(raw, warn)
}

/** v3 → v4 语义映射（spec §6.1）：mode→预设选择；default 与内置不同则写入该预设；
 *  scores/candidates/classify/预算参数一律不迁移。v4 直通幂等。 */
export function migrateV3(raw: unknown): RouterConfigV4 {
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.version === 4) return raw as RouterConfigV4
  const v4 = DEFAULT_CONFIG_V4()
  const presetId = r.mode === 'cost' ? 'saving' : r.mode === 'capability' ? 'capability' : null
  if (presetId !== null) {
    v4.activePreset = presetId
    const d = target(r.default)
    if (d !== null) {
      const builtin = v4.presets[presetId]
      if (d.provider !== builtin.default.provider || d.model !== builtin.default.model) {
        v4.presets[presetId] = { ...builtin, default: d }
      }
    }
  }
  return v4
}

/** 版本分派到 v4：4 直通；其余走 v1/v2→v3 链后 migrateV3。 */
export function coerceRouterConfigV4(raw: unknown, warn: (m: string) => void): RouterConfigV4 {
  const v = (raw as { version?: unknown } | null)?.version
  if (v === 4) return raw as RouterConfigV4
  return migrateV3(coerceRouterConfig(raw, warn))
}

/** 命名空间用户层残留检测（Task 5）：version≠4 或序列化含 'kimi-tide'。 */
export function hasKimiTideResidue(config: unknown): boolean {
  const v = (config as { version?: unknown } | null)?.version
  if (v !== 4) return true
  return JSON.stringify(config).includes('kimi-tide')
}
