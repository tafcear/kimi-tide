export interface RouteTarget { provider: string; model: string }
/** 候选元数据（0.5.0：costTier 随评分面退役，Task 9 删除）。 */
export interface CandidateMeta extends RouteTarget {
  modalities: string[]
  available: boolean
  /**
   * 目标模型支持的推理等级（llm.resolveModelInfo → reasoning.efforts 的 id
   * 列表，如 ['low','high','max']）。undefined = 能力未知（候选枚举未完成或
   * 适配器未暴露）——路由时不携带会话级 reasoningEffort，维持 0.5.x 行为。
   */
  reasoningEfforts?: string[]
}
/** 0.4.x：插件固定的 Kimi provider 路由（pi-ai catalog 原生名）。 */
export const KIMI_PROVIDER = 'kimi-coding'

export type RuleCondition =
  | { kind: 'image' }                    // 带图（本轮或历史含图，锁存后恒真）
  | { kind: 'keywords'; group: string }  // 命名关键词组命中（大小写不敏感子串）

export interface RouterRule {
  id: string
  when: RuleCondition
  target: RouteTarget
}

export interface RouterPreset {
  name: string
  default: RouteTarget
  rules: RouterRule[]   // 有序；首条命中生效
}

export interface RouterConfigV4 {
  version: 4
  /** null = 关闭（逃生舱）；否则为 presets 的键。 */
  activePreset: string | null
  presets: Record<string, RouterPreset>
  keywordGroups: Record<string, string[]>
}

export const configKey = (t: RouteTarget): string => `${t.provider}/${t.model}`

/** 内置关键词组（用户可增删改；内置预设引用 code/chitchat）。 */
export const DEFAULT_KEYWORD_GROUPS: Record<string, string[]> = {
  code: ['代码', 'code', 'bug', '重构', 'refactor', '实现', '函数', '测试'],
  chitchat: ['你好', '谢谢', '怎么样', '随便', '聊聊', '翻译', '总结', '天气'],
}

export function DEFAULT_CONFIG_V4(): RouterConfigV4 {
  return {
    version: 4,
    activePreset: null,
    presets: {
      saving: {
        name: '省钱',
        default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        rules: [
          { id: 'image-k3', when: { kind: 'image' }, target: { provider: KIMI_PROVIDER, model: 'k3' } },
          { id: 'code-kfc', when: { kind: 'keywords', group: 'code' }, target: { provider: KIMI_PROVIDER, model: 'kimi-for-coding' } },
        ],
      },
      capability: {
        name: '能力',
        default: { provider: KIMI_PROVIDER, model: 'k3' },
        rules: [
          { id: 'chitchat-flash', when: { kind: 'keywords', group: 'chitchat' }, target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
          { id: 'code-kfc', when: { kind: 'keywords', group: 'code' }, target: { provider: KIMI_PROVIDER, model: 'kimi-for-coding' } },
        ],
      },
    },
    keywordGroups: { ...DEFAULT_KEYWORD_GROUPS },
  }
}

/* ---- @legacy v3（0.4.x）形状：迁移输入专用（migrate.ts/settings-schema.ts），新代码禁止消费 ---- */
export type Dim = 'code' | 'reasoning' | 'writing' | 'tooluse' | 'vision' | 'longctx'
/** @legacy v3 维度表：仅 migrateV2 改名与 settings-schema 兼容层使用。 */
export const DIMS: Dim[] = ['code', 'reasoning', 'writing', 'tooluse', 'vision', 'longctx']
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
/** @legacy v3 默认配置：仅 migrateV1/migrateV2 的 base 使用。 */
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
