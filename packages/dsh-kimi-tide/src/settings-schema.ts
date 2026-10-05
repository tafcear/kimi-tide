// src/settings-schema.ts
import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_CONFIG_V5, DEFAULT_CONFIG_V6, isFlowTarget, isV5Plus, type RouterConfigV5, type RouterConfigV6, type RuleTarget } from './config.js'
import { claimConflict } from './roles.js'

// 单一真相源：schema 默认值全部从 DEFAULT_CONFIG_V5 派生，不另抄一份（防漂移）。
const D5 = DEFAULT_CONFIG_V5()

// 0.8.0 B5 换道（2026-08-27）：kimi-tide-catalog 命名空间节形状——宿主把
// effort 档位表写进这个自有命名空间，客户端经 settings.describe 读取。
// 松散形状即可：值由宿主 buildEffortCatalog 构造，读取端已做缺省降级。
// 1.1.0 A8（2026-09-04）：新增可选 mounted（路由器真实挂载表，'provider/model'
// 键列表，buildMountedModels 产物）——试一句 reviewer 不可用判定的真相源；
// 缺键（旧宿主遗留节）= 判定退化为三态，行为不变。
export const EFFORT_CATALOG_SECTION_SCHEMA = Schema.object({
  efforts: Schema.dict(Schema.array(Schema.string())),
  mounted: Schema.array(Schema.string()),
})

const targetSchema = Schema.object({ provider: Schema.string(), model: Schema.string(), effort: Schema.string() })
// 1.4.1（2026-10-03）：review.reviewer 与其余目标同形——收可选 effort（撤销 0.8.0
// 的 M7：评审调用改为**消费**推理档位，见 review.ts 的 createReviewRunner 与
// SettingsCard 评审行的档位下拉；语义面校验见 validateRouterConfig）。
const reviewerTargetSchema = targetSchema
const ruleSchema = Schema.object({
  id: Schema.string(),
  when: Schema.union([
    Schema.object({ kind: Schema.const('image') }),
    Schema.object({ kind: Schema.const('keywords'), group: Schema.string(), minHits: Schema.number() }),
  ]),
  // v5：规则目标泛化为「纯模型 | 协作流引用」；流引用的存在性/类型（P1 仅
  // transcribe 可作规则目标）由 validateRouterConfig 语义校验，schema 只管形状。
  // 0.8.0 实证（node_modules schemastery）：union 只在所有分支皆抛时才抛；flow
  // 分支不 required 时对「缺 flow 的任意对象」静默通过（缺省标量省略 + 透传），
  // 吞掉 targetSchema 对 effort 非法类型的拒绝——故 flow 标 required 使分支真正
  // 判别，union 错误消息经 toString/JSON 双通道携带 'effort'。
  target: Schema.union([targetSchema, Schema.object({ flow: Schema.string().required() })]),
})
const presetSchema = Schema.object({
  name: Schema.string(),
  default: targetSchema,
  rules: Schema.array(ruleSchema),
  imageFallback: Schema.union([Schema.const('latch'), Schema.const('blind'), Schema.const('transcribe-lazy')]),
  imageFallbackFlow: Schema.string(),
})
// 协作流注册表项：transcribe | review 判别联合（type const 判别）；rounds 的
// 1..3 整数界与 trigger=keywords 的 keywordGroup 必填由 validateRouterConfig 校验。
const flowSchema = Schema.union([
  Schema.object({
    type: Schema.const('transcribe'),
    visionModel: targetSchema,
    failurePolicy: Schema.union([Schema.const('latch-image'), Schema.const('blind')]),
    prompt: Schema.string(),
  }),
  Schema.object({
    type: Schema.const('review'),
    reviewer: reviewerTargetSchema,
    trigger: Schema.union([Schema.const('manual'), Schema.const('keywords')]),
    keywordGroup: Schema.string(),
    rounds: Schema.number(),
    autoRevise: Schema.boolean(),
    // v1.4.0 评审闭环：修订后是否再评一轮。无 default —— 缺失省略不注入
    // （「默认往返相等」红线），语义默认「开」由消费侧 `!== false` 落地。
    recheck: Schema.boolean(),
  }),
])

// 兼容层行为锚点（2026-08-20 本包 node_modules 实测，承接 Task 1 Ruling 8）：
// - 非 strict 直接调用下 schema 外未知键**透传保留**（不剥离、不拒绝）；
// - 标量/联合字段无 default 时：缺失省略、存在即校验（非法值抛错）；
// - 对象/字典/数组型字段：缺失即注入 {}/[]（与是否带 default 无关）。
// 因此 v3 遗留字段的处理只能是：
// - mode 入 schema 但不带 default —— v4/v5 往返不注入；v3 存量存在即校验存活；
// - default 不入 schema —— 它是对象型，入则 v4/v5 往返被注入 default:{} 破坏
//   「默认往返相等」；v3 存量的 default 靠透传保活（migrateV3 的 target()
//   对畸形输入有兜底）；
// - 其余 v3 遗留字段（scores/classify/candidates/allowedProviders/costTiers/
//   routeThreshold/lambda/premiumBudget/budgetWindow/charsPerToken）透传保留，
//   随对象交给 migrateV3（其只读 version/mode/default，忽略其余）。
// v5（0.6.0 协作编排）新增字段同理：
// - imageFallback/imageFallbackFlow 入 schema 且不带 default —— 缺省省略不注入
//   （缺省 = 维持 0.5.x 行为），存在即校验（非法值注册/写入期拒绝）；
// - flows 是 dict 必注 {} —— 不放 .default()，预置流默认值靠 mergeResolved 的
//   deepMerge(DEFAULT_CONFIG_V5()) 供给。
// 本 schema 一律非 strict 直接调用，不经 intersect/config 包装。
// v6（团队派发）新增顶层字段同理（红线：新增可选字段一律不带 .default()）：
// - driver 用「无默认 union（target | null）」——缺失省略不注入，保住「默认往返相等」；
// - driverSticky/rulesApplyToChildren 标量无 default —— 缺失省略；语义缺省在消费侧
//   （driverSticky 的新装 true / 存量 false 由 DEFAULT_CONFIG_V6 / migrateV5 分别供给）；
// - roles 是 dict 必注 {}（flows 同款）——分工表默认值靠 mergeResolved 的 deepMerge 供给。
const roleSchema = Schema.object({
  id: Schema.string(),
  label: Schema.string(),
  target: targetSchema,
  teammate: Schema.array(Schema.string()),
  aliases: Schema.array(Schema.string()),
  note: Schema.string(),
})
export const routerConfigSchema = Schema.object({
  // 宽松读取存量 v2/v3/v4 用户层（dsh-settings 契约：存量节校验失败会拒绝整个
  // 命名空间注册）；迁移后整段 replace 覆盖为纯 v6。
  version: Schema.union([
    Schema.const(2), Schema.const(3), Schema.const(4), Schema.const(5), Schema.const(6),
  ]).default(6),
  activePreset: Schema.union([Schema.string(), Schema.const(null)]).default(D5.activePreset),
  // schemastery ObjectT 输出形把运行期可缺省字段（imageFallback/imageFallbackFlow）
  // 标为必选，与 RouterPreset 存在类型差——仅以 ReturnType 收窄 .default() 入参，
  // 无行为影响（替代 Task 3 的 SchemaPresetV4 桥接，target 已对齐 RuleTarget union）。
  presets: Schema.dict(presetSchema).default(D5.presets as Record<string, ReturnType<typeof presetSchema>>),
  flows: Schema.dict(flowSchema),
  keywordGroups: Schema.dict(Schema.array(Schema.string())).default(D5.keywordGroups),
  // 0.8.x⑧：辅助请求改道表（purpose → target）。dict 缺失注入 {}（flows 同款）；
  // 语义校验（键非空/目标完整/effort 形状）在 validateRouterConfig。空表 = 不改道。
  auxTargets: Schema.dict(targetSchema),
  // v6（团队派发）分工层：
  driver: Schema.union([targetSchema, Schema.const(null)]),
  driverSticky: Schema.boolean(),
  rulesApplyToChildren: Schema.boolean(),
  roles: Schema.dict(roleSchema),
  // v3 存量兼容（注册期不被拒；migrateV3 需要 mode 存活）：
  mode: Schema.union([Schema.const('off'), Schema.const('cost'), Schema.const('capability')]),
})

/** v5/v6 语义校验：activePreset 存在性 / 预设名非空 / 规则引用组存在 / 模型 target 完整 /
 *  规则流引用存在且为 transcribe 型（P1 仅 transcribe 可作规则目标）/ imageFallback
 *  级联（transcribe-lazy 的 imageFallbackFlow 缺省解析到预置 transcribe，显式引用须
 *  存在且为 transcribe 型）/ review 流 rounds 1..3 / trigger=keywords 必填 keywordGroup /
 *  effort 形状检查（default/规则 target/visionModel/reviewer 四处，非空 string——M4；
 *  reviewer 自 1.4.1 起收 effort，撤销 0.8.0 M7）。
 *  v6 追加：roles 认领冲突 / role.label 与 role.target 完整 / driver 目标完整（下见尾部）。
 *  legacy version（≤4）直通返回 undefined（迁移兜底，注册期不做语义校验）。 */
export function validateRouterConfig(raw: RouterConfigV5 | RouterConfigV6): string | undefined {
  const gateVersion = (raw as { version?: unknown }).version
  if (gateVersion !== 5 && gateVersion !== 6) return undefined
  if (raw.activePreset !== null && !(raw.activePreset in raw.presets)) {
    return `activePreset '${raw.activePreset}' 不在 presets 中`
  }
  for (const [key, preset] of Object.entries(raw.presets)) {
    if (typeof preset.name !== 'string' || preset.name.trim() === '') {
      return `预设 '${key}' 的名称不能为空`
    }
    const dft = (preset.default ?? {}) as { effort?: unknown }
    if (dft.effort !== undefined && (typeof dft.effort !== 'string' || dft.effort.trim() === '')) {
      return `预设 '${key}' 的 default.effort 必须为非空字符串`
    }
    // v1.3.0 语义命中确认闸：**不入 schema**（对象型字段入 schema 会被注入 {}
    // 破坏「默认往返相等」，评审 S1），故形状与界校验只在这里。
    const hc = (preset as { hitConfirm?: unknown }).hitConfirm
    if (hc !== undefined) {
      if (hc === null || typeof hc !== 'object') return `预设 '${key}' 的 hitConfirm 必须是对象`
      const { enabled, timeoutMs, maxTokens } = hc as Record<string, unknown>
      if (enabled !== undefined && typeof enabled !== 'boolean') {
        return `预设 '${key}' 的 hitConfirm.enabled 必须是布尔`
      }
      if (timeoutMs !== undefined
        && (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000)) {
        return `预设 '${key}' 的 hitConfirm.timeoutMs 必须是 1..10000 的整数`
      }
      if (maxTokens !== undefined
        && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 256)) {
        return `预设 '${key}' 的 hitConfirm.maxTokens 必须是 1..256 的整数`
      }
    }
    for (const rule of preset.rules) {
      const t = (rule.target ?? {}) as RuleTarget
      if (isFlowTarget(t)) {
        // 0.6.x池#3（M-3）：流目标仅限带图条件——keywords 命中无图可转述，
        // 运行期会静默保持会话模型（用户意图无声丢失）。
        if (rule.when?.kind !== 'image') {
          return `规则 '${rule.id}' 的流目标仅限带图条件（keywords 规则不能挂协作流）`
        }
        const flow = raw.flows[t.flow]
        if (flow === undefined) {
          return `规则 '${rule.id}' 引用的协作流 '${t.flow}' 不存在于 flows`
        }
        if (flow.type !== 'transcribe') {
          return `规则 '${rule.id}' 引用的协作流 '${t.flow}' 是 ${flow.type} 流（P1 仅 transcribe 可作规则目标）`
        }
      } else if (typeof t.provider !== 'string' || t.provider === '' || typeof t.model !== 'string' || t.model === '') {
        return `规则 '${rule.id}' 的 target 不完整（provider/model 必须为非空字符串）`
      }
      if (typeof (t as { effort?: unknown }).effort !== 'undefined'
        && (typeof (t as { effort?: unknown }).effort !== 'string' || ((t as { effort?: string }).effort as string).trim() === '')) {
        return `规则 '${rule.id}' 的 target.effort 必须为非空字符串`
      }
      if (rule.when?.kind === 'keywords') {
        if (!(rule.when.group in raw.keywordGroups)) {
          return `规则 '${rule.id}' 引用的关键词组 '${rule.when.group}' 不存在于 keywordGroups`
        }
        const minHits = rule.when.minHits
        if (minHits !== undefined && (!Number.isInteger(minHits) || minHits < 1)) {
          return `规则 '${rule.id}' 的 minHits 越界（须为 ≥1 的整数）`
        }
      }
    }
    if (preset.imageFallback === 'transcribe-lazy') {
      const ref = preset.imageFallbackFlow ?? 'transcribe'   // 级联缺省 = 预置 transcribe 流
      const flow = raw.flows[ref]
      if (flow === undefined) {
        return `预设 '${key}' 的 imageFallbackFlow '${ref}' 不存在于 flows`
      }
      if (flow.type !== 'transcribe') {
        return `预设 '${key}' 的 imageFallbackFlow '${ref}' 是 ${flow.type} 流（级联目标必须是 transcribe 流）`
      }
    }
  }
  for (const [fid, flow] of Object.entries(raw.flows)) {
    if (flow.type === 'transcribe') {
      const vm = (flow.visionModel ?? {}) as { effort?: unknown }
      if (vm.effort !== undefined && (typeof vm.effort !== 'string' || vm.effort.trim() === '')) {
        return `转述流 '${fid}' 的 visionModel.effort 必须为非空字符串`
      }
    }
    if (flow.type !== 'review') continue
    // 1.4.1（撤销 0.8.0 M7 / 1.1.0 L7）：评审 reviewer 的 effort 与 visionModel
    // 同款形状校验（非空字符串）；运行期同样按目标支持集判定，不支持即剥离。
    const rv = (flow.reviewer ?? {}) as { effort?: unknown }
    if (rv.effort !== undefined && (typeof rv.effort !== 'string' || rv.effort.trim() === '')) {
      return `评审流 '${fid}' 的 reviewer.effort 必须为非空字符串`
    }
    if (!Number.isInteger(flow.rounds) || flow.rounds < 1 || flow.rounds > 3) {
      return `评审流 '${fid}' 的 rounds 越界（须为 1..3 的整数）`
    }
    if (flow.trigger === 'keywords' && (typeof flow.keywordGroup !== 'string' || flow.keywordGroup === '')) {
      return `评审流 '${fid}' 的 trigger=keywords 但未提供 keywordGroup`
    }
  }
  // 0.8.x⑧：辅助请求改道表——形状（对象）+ 语义（purpose 键非空 / 目标完整
  // provider+model / 不收协作流引用（辅助改道只落模型目标）/ effort 非空字符串）。
  const aux = raw.auxTargets
  if (aux !== undefined && (typeof aux !== 'object' || aux === null || Array.isArray(aux))) {
    return 'auxTargets 必须为对象（purpose → target 映射）'
  }
  for (const [purpose, target] of Object.entries(aux ?? {}) as Array<[string, RuleTarget]>) {
    if (purpose.trim() === '') return 'auxTargets 的 purpose 键不能为空'
    if (isFlowTarget(target)) {
      return `auxTargets['${purpose}'] 不接受协作流引用（辅助请求改道只落模型目标）`
    }
    if (typeof target.provider !== 'string' || target.provider === '' || typeof target.model !== 'string' || target.model === '') {
      return `auxTargets['${purpose}'] 的 target 不完整（provider/model 必须为非空字符串）`
    }
    const e = (target as { effort?: unknown }).effort
    if (e !== undefined && (typeof e !== 'string' || (e as string).trim() === '')) {
      return `auxTargets['${purpose}'] 的 effort 必须为非空字符串`
    }
  }
  // v6 专属校验（团队派发分工层）：认领冲突 → role 字段完整 → driver 目标完整。
  if (raw.version === 6) {
    const roles = raw.roles ?? {}
    const conflict = claimConflict(roles)                     // roles.ts（任务 2 已抽取为 import）
    if (conflict !== undefined) return conflict
    for (const [id, role] of Object.entries(roles)) {
      if (typeof role.label !== 'string' || role.label.length === 0) return `roles.${id}.label 不能为空`
      if (typeof role.target?.provider !== 'string' || role.target.provider.length === 0) return `roles.${id}.target.provider 不能为空`
      if (typeof role.target?.model !== 'string' || role.target.model.length === 0) return `roles.${id}.target.model 不能为空`
    }
    const d = raw.driver
    if (d !== undefined && d !== null && (typeof d.provider !== 'string' || d.provider.length === 0 || typeof d.model !== 'string' || d.model.length === 0)) return 'driver 目标不完整'
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

export function mergeResolved(entry: unknown): RouterConfigV6 {
  const defaults = DEFAULT_CONFIG_V6()
  const e = (entry ?? {}) as Record<string, unknown>
  const resolved = deepMerge(defaults, e) as Record<string, unknown>
  // 显式 legacy 节（version ≤4 且无 flows 键）不供给 flows 预置默认：命名空间
  // schema 解析存量节时 dict 只注 {}，若此处 deepMerge 注入 DEFAULT_FLOWS，
  // settings-migration 的 clean 谓词（deepEqualJson(scope.get(), mergeResolved(entry))，
  // entry=v4 形 base）会误判 dirty 而跳过 sidecar 导入——index-wiring 两条迁移
  // 测试实证。空 entry/无 version 视为新装（v6 默认全量供给）；Task 12 v5 接线后
  // base 自带 flows，两式恒等，本收窄保持 v4 存量迁移行为逐字节不变。
  if (typeof e.version === 'number' && !isV5Plus({ version: e.version }) && !('flows' in e)) delete resolved.flows
  // ObjectT 输出形与 RouterConfigV6 的类型差同上（version union 宽于 6、可缺省字段
  // 被标必选）——schema 输出在运行期即 RouterConfigV6 形，仅类型层需 unknown 过渡。
  return routerConfigSchema(resolved) as unknown as RouterConfigV6
}
