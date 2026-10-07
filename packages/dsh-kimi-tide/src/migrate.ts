import { DEFAULT_CONFIG_V3, DEFAULT_CONFIG_V4, DEFAULT_FLOWS, KIMI_PROVIDER, rowsFromConfig, type RouterConfigV3, type RouterConfigV4, type RouterConfigV5, type RouterConfigV6, type RouterConfigV7, type RouteTarget } from './config.js'

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

/** v3 → v4 语义映射（spec §6.1 + Ruling 11）：mode→预设选择；default 的覆盖规则——
 *  cost→saving 无条件覆盖（v3.default 的「便宜默认」语义与省钱预设的默认目标天然对应）；
 *  capability 只覆盖当 v3.default 为 kimi 模型（provider===KIMI_PROVIDER，用户刻意把
 *  默认设成贵模型=能力偏好信号），deepseek 默认=遗留便宜默认 → 保留内置 k3 默认目标
 *  （2026-08-21 实机缺陷：本机 v3.default=deepseek-v4-flash 曾把能力预设的默认目标覆盖成 flash）；
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
      const isPremiumDefault = d.provider === KIMI_PROVIDER
      const shouldCopy = presetId === 'saving' || isPremiumDefault
      if (shouldCopy && (d.provider !== builtin.default.provider || d.model !== builtin.default.model)) {
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

/** v4 → v5 行为保持迁移（0.6.0 协作编排）：presets/keywordGroups/activePreset 原样展开，
 *  flows=DEFAULT_FLOWS()——预置流注册但不绑定（无任何规则引用 flows 键）；
 *  不注入 imageFallback/imageFallbackFlow（字段缺省 = 维持 0.5.x 行为）。
 *  v5 直通幂等（原引用返回）；其余版本先经 coerceRouterConfigV4 链收敛到 v4。 */
export function migrateV4(raw: unknown): RouterConfigV5 {
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.version === 5) return raw as RouterConfigV5
  const v4 = coerceRouterConfigV4(raw, () => {})
  return {
    version: 5,
    activePreset: v4.activePreset,
    presets: v4.presets,
    flows: DEFAULT_FLOWS(),
    keywordGroups: v4.keywordGroups,
  }
}

/** 版本分派到 v5：5 直通；其余走 v1/v2/v3→v4 链后 migrateV4。 */
export function coerceRouterConfigV5(raw: unknown, warn: (m: string) => void): RouterConfigV5 {
  const v = (raw as { version?: unknown } | null)?.version
  if (v === 5) return raw as RouterConfigV5
  return migrateV4(coerceRouterConfigV4(raw, warn))
}

/** 命名空间用户层残留检测（v5 版）：version≠5 或序列化含 'kimi-tide'。 */
export function hasKimiTideResidueV5(config: unknown): boolean {
  const v = (config as { version?: unknown } | null)?.version
  if (v !== 5) return true
  return JSON.stringify(config).includes('kimi-tide')
}

/**
 * v5 → v6：只新增字段，存量行为保持。
 * driverSticky 显式 false —— 新装走 DEFAULT_CONFIG_V6()（true），存量留旧行为；
 * driver / rulesApplyToChildren 不写：前者缺失＝跟随宿主默认，后者缺失＝运行期缺省 false（新语义）。
 *
 * 终审 I3（2026-10-06 修复波）：**输入已存在**的 v6 分工层字段一律透传保留——
 * R2 字段判据后「version:5 文档携带 roles/driver/driverSticky」是合法常态
 * （存量升级用户经设置卡写分工层后正是此形态，export-config 原样产出），
 * 逐字段重建会把 roles 重置 {}、driver/driverSticky 静默丢弃（export→import
 * 往返丢分工表）。只有缺失时才给默认（driverSticky 缺席 ⇒ 存量口径显式 false，
 * 见终审 F4：未迁移文档不得被读成新装默认 true）。形状 sanity 仅防垃圾流入
 * （语义校验在 validateRouterConfig，import-config 落盘前强制执行）。
 */
export function migrateV5(raw: unknown): RouterConfigV6 {
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.version === 6) return raw as RouterConfigV6
  const v5 = coerceRouterConfigV5(raw, () => {})
  return {
    version: 6,
    activePreset: v5.activePreset,
    presets: v5.presets,
    flows: v5.flows,
    keywordGroups: v5.keywordGroups,
    ...(v5.auxTargets === undefined ? {} : { auxTargets: v5.auxTargets }),
    ...(isPlainObject(r.roles) ? { roles: r.roles as RouterConfigV6['roles'] } : { roles: {} }),
    // M2（2026-10-07 复核）：routes（v7 统一路由表）同款 Array.isArray 直通——
    // 「version:5 文档携带 v6/v7 字段」是 R2 字段判据后的合法常态，逐字段重建
    // 会在校验之前把 routes 抹掉（10-06 migrateV5 丢分工表的同型事故），纯静默。
    ...(Array.isArray(r.routes) ? { routes: r.routes } : {}),
    ...(r.driver === null || isPlainObject(r.driver) ? { driver: r.driver as RouterConfigV6['driver'] } : {}),
    ...(typeof r.rulesApplyToChildren === 'boolean' ? { rulesApplyToChildren: r.rulesApplyToChildren } : {}),
    driverSticky: typeof r.driverSticky === 'boolean' ? r.driverSticky : false,
  }
}

/** 透传前的最小形状闸：非 null 非数组的普通对象。 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function coerceRouterConfigV6(raw: unknown, warn: (message: string) => void): RouterConfigV6 {
  const r = (raw ?? {}) as Record<string, unknown>
  // C2（2026-10-07）：v7 是 v6 的超集（只多 routes），字段判据消费——直通保住
  // routes/roles 不被下面 v5→v6 链的 v1 兜底摧毁（10-06「迁移丢分工表」同型事故）。
  if (r.version === 6 || r.version === 7) return raw as RouterConfigV6
  return migrateV5(coerceRouterConfigV5(raw, warn))
}

/** v6 残留判据（照 hasKimiTideResidueV5）。v7 与 v6 同列现行（C2 后现行版本），
 *  不算残留——否则每次启动都空转一条死迁移路径（复核⑦，2026-10-07）。 */
export function hasKimiTideResidueV6(config: unknown): boolean {
  const version = (config as { version?: unknown } | null | undefined)?.version
  if (version !== 6 && version !== 7) return true
  try {
    return JSON.stringify(config).includes('kimi-tide')
  } catch {
    return true
  }
}

/**
 * v6 → v7（C2 统一路由表，设计稿 §6.2）：投影迁移——presets[*].rules → session
 * 行（保序，填 preset）；roles → dispatch 行（保序，搬 label/teammate/aliases/note）。
 *
 * 不变量（10-06 事故的写法级防复发）：
 * - **浅拷贝 + 只改需要改的字段**（version / routes）——presets / roles / flows 等
 *   一律原引用保留，绝不逐字段重建（migrateV5 丢分工表事故即此因）；
 * - **旧字段保留原值不删**（presets[*].rules / roles 原样在档：可回退、可 diff）；
 * - 幂等：v7 输入原引用直通。
 */
export function migrateV6(raw: unknown): RouterConfigV7 {
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.version === 7) return raw as RouterConfigV7
  const v6 = coerceRouterConfigV6(raw, () => {})
  return { ...v6, version: 7, routes: rowsFromConfig(v6) }
}

/** 版本分派到 v7：7 直通；其余走 v1…v5→v6 链后 migrateV6。 */
export function coerceRouterConfigV7(raw: unknown, warn: (message: string) => void): RouterConfigV7 {
  const v = (raw as { version?: unknown } | null)?.version
  if (v === 7) return raw as RouterConfigV7
  const warned = warn
  return migrateV6(coerceRouterConfigV6(raw, warned))
}
