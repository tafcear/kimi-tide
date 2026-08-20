// src/settings-schema.ts
import Schema from 'schemastery'
import { DEFAULT_CONFIG_V4, type RouterConfigV4 } from './config.js'

// 单一真相源：schema 默认值全部从 DEFAULT_CONFIG_V4 派生，不另抄一份（防漂移）。
const D4 = DEFAULT_CONFIG_V4()

const targetSchema = Schema.object({ provider: Schema.string(), model: Schema.string() })
const ruleSchema = Schema.object({
  id: Schema.string(),
  when: Schema.union([
    Schema.object({ kind: Schema.const('image') }),
    Schema.object({ kind: Schema.const('keywords'), group: Schema.string() }),
  ]),
  target: targetSchema,
})
const presetSchema = Schema.object({
  name: Schema.string(),
  default: targetSchema,
  rules: Schema.array(ruleSchema),
})

// 兼容层行为锚点（2026-08-20 本包 node_modules 实测，承接 Task 1 Ruling 8）：
// - 非 strict 直接调用下 schema 外未知键**透传保留**（不剥离、不拒绝）；
// - 标量/联合字段无 default 时：缺失省略、存在即校验（非法值抛错）；
// - 对象/字典/数组型字段：缺失即注入 {}/[]（与是否带 default 无关）。
// 因此 v3 遗留字段的处理只能是：
// - mode 入 schema 但不带 default —— v4 往返不注入；v3 存量存在即校验存活；
// - default 不入 schema —— 它是对象型，入则 v4 往返被注入 default:{} 破坏
//   「v4 默认往返相等」；v3 存量的 default 靠透传保活（migrateV3 的 target()
//   对畸形输入有兜底）；
// - 其余 v3 遗留字段（scores/classify/candidates/allowedProviders/costTiers/
//   routeThreshold/lambda/premiumBudget/budgetWindow/charsPerToken）透传保留，
//   随对象交给 migrateV3（其只读 version/mode/default，忽略其余）。
// 本 schema 一律非 strict 直接调用，不经 intersect/config 包装。
export const routerConfigSchema = Schema.object({
  // 宽松读取存量 v2/v3 用户层（dsh-settings 契约：存量节校验失败会拒绝整个
  // 命名空间注册）；迁移后整段 replace 覆盖为纯 v4。
  version: Schema.union([Schema.const(2), Schema.const(3), Schema.const(4)]).default(4),
  activePreset: Schema.union([Schema.string(), Schema.const(null)]).default(D4.activePreset),
  presets: Schema.dict(presetSchema).default(D4.presets),
  keywordGroups: Schema.dict(Schema.array(Schema.string())).default(D4.keywordGroups),
  // v3 存量兼容（注册期不被拒；migrateV3 需要 mode 存活）：
  mode: Schema.union([Schema.const('off'), Schema.const('cost'), Schema.const('capability')]),
})

/** v4 语义校验：activePreset 存在性 / 规则引用组存在 / target 完整 / 预设名非空。
 *  legacy version（≠4）直通返回 undefined（迁移兜底，注册期不做 v4 语义校验）。 */
export function validateRouterConfig(raw: RouterConfigV4): string | undefined {
  if ((raw as { version?: unknown }).version !== 4) return undefined
  if (raw.activePreset !== null && !(raw.activePreset in raw.presets)) {
    return `activePreset '${raw.activePreset}' 不在 presets 中`
  }
  for (const [key, preset] of Object.entries(raw.presets)) {
    if (typeof preset.name !== 'string' || preset.name.trim() === '') {
      return `预设 '${key}' 的名称不能为空`
    }
    for (const rule of preset.rules) {
      const t = (rule.target ?? {}) as { provider?: unknown; model?: unknown }
      if (typeof t.provider !== 'string' || t.provider === '' || typeof t.model !== 'string' || t.model === '') {
        return `规则 '${rule.id}' 的 target 不完整（provider/model 必须为非空字符串）`
      }
      if (rule.when?.kind === 'keywords' && !(rule.when.group in raw.keywordGroups)) {
        return `规则 '${rule.id}' 引用的关键词组 '${rule.when.group}' 不存在于 keywordGroups`
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

export function mergeResolved(entry: unknown): RouterConfigV4 {
  const defaults = DEFAULT_CONFIG_V4()
  const resolved = deepMerge(defaults, entry ?? {}) as RouterConfigV4
  return routerConfigSchema(resolved) as RouterConfigV4
}
