// src/settings-schema.ts
import Schema from 'schemastery'
import { DEFAULT_CONFIG_V5, isFlowTarget, type RouterConfigV5, type RuleTarget } from './config.js'

// 单一真相源：schema 默认值全部从 DEFAULT_CONFIG_V5 派生，不另抄一份（防漂移）。
const D5 = DEFAULT_CONFIG_V5()

const targetSchema = Schema.object({ provider: Schema.string(), model: Schema.string(), effort: Schema.string() })
// 0.8.0（评审 M7）：review.reviewer 不接收 effort——flowSchema review 分支
// 内联一份无 effort 的 target schema，尊重用户圈定范围（评审执行层不消费）。
const reviewerTargetSchema = Schema.object({ provider: Schema.string(), model: Schema.string() })
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
export const routerConfigSchema = Schema.object({
  // 宽松读取存量 v2/v3/v4 用户层（dsh-settings 契约：存量节校验失败会拒绝整个
  // 命名空间注册）；迁移后整段 replace 覆盖为纯 v5。
  version: Schema.union([Schema.const(2), Schema.const(3), Schema.const(4), Schema.const(5)]).default(5),
  activePreset: Schema.union([Schema.string(), Schema.const(null)]).default(D5.activePreset),
  // schemastery ObjectT 输出形把运行期可缺省字段（imageFallback/imageFallbackFlow）
  // 标为必选，与 RouterPreset 存在类型差——仅以 ReturnType 收窄 .default() 入参，
  // 无行为影响（替代 Task 3 的 SchemaPresetV4 桥接，target 已对齐 RuleTarget union）。
  presets: Schema.dict(presetSchema).default(D5.presets as Record<string, ReturnType<typeof presetSchema>>),
  flows: Schema.dict(flowSchema),
  keywordGroups: Schema.dict(Schema.array(Schema.string())).default(D5.keywordGroups),
  // v3 存量兼容（注册期不被拒；migrateV3 需要 mode 存活）：
  mode: Schema.union([Schema.const('off'), Schema.const('cost'), Schema.const('capability')]),
})

/** v5 语义校验：activePreset 存在性 / 预设名非空 / 规则引用组存在 / 模型 target 完整 /
 *  规则流引用存在且为 transcribe 型（P1 仅 transcribe 可作规则目标）/ imageFallback
 *  级联（transcribe-lazy 的 imageFallbackFlow 缺省解析到预置 transcribe，显式引用须
 *  存在且为 transcribe 型）/ review 流 rounds 1..3 / trigger=keywords 必填 keywordGroup。
 *  legacy version（≤4）直通返回 undefined（迁移兜底，注册期不做语义校验）。 */
export function validateRouterConfig(raw: RouterConfigV5): string | undefined {
  if ((raw as { version?: unknown }).version !== 5) return undefined
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
    for (const rule of preset.rules) {
      const t = (rule.target ?? {}) as RuleTarget
      if (isFlowTarget(t)) {
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
    if (!Number.isInteger(flow.rounds) || flow.rounds < 1 || flow.rounds > 3) {
      return `评审流 '${fid}' 的 rounds 越界（须为 1..3 的整数）`
    }
    if (flow.trigger === 'keywords' && (typeof flow.keywordGroup !== 'string' || flow.keywordGroup === '')) {
      return `评审流 '${fid}' 的 trigger=keywords 但未提供 keywordGroup`
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

export function mergeResolved(entry: unknown): RouterConfigV5 {
  const defaults = DEFAULT_CONFIG_V5()
  const e = (entry ?? {}) as Record<string, unknown>
  const resolved = deepMerge(defaults, e) as Record<string, unknown>
  // 显式 legacy 节（version ≤4 且无 flows 键）不供给 flows 预置默认：命名空间
  // schema 解析存量节时 dict 只注 {}，若此处 deepMerge 注入 DEFAULT_FLOWS，
  // settings-migration 的 clean 谓词（deepEqualJson(scope.get(), mergeResolved(entry))，
  // entry=v4 形 base）会误判 dirty 而跳过 sidecar 导入——index-wiring 两条迁移
  // 测试实证。空 entry/无 version 视为新装（v5 默认全量供给）；Task 12 v5 接线后
  // base 自带 flows，两式恒等，本收窄保持 v4 存量迁移行为逐字节不变。
  if (typeof e.version === 'number' && e.version !== 5 && !('flows' in e)) delete resolved.flows
  // ObjectT 输出形与 RouterConfigV5 的类型差同上（version union 宽于 5、可缺省字段
  // 被标必选）——schema 输出在运行期即 RouterConfigV5 形，仅类型层需 unknown 过渡。
  return routerConfigSchema(resolved) as unknown as RouterConfigV5
}
