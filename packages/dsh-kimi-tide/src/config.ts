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
  target: RuleTarget
}

export interface RouterPreset {
  name: string
  default: RouteTarget
  rules: RouterRule[]   // 有序；首条命中生效
  /** 预设级带图兜底策略（0.6.0+；缺省 = 维持 0.5.x 行为，判定语义见 Task 8）。 */
  imageFallback?: ImageFallback
  /** imageFallback 为 'transcribe-lazy' 时引用的 flows 键。 */
  imageFallbackFlow?: string
}

/* ---- v5（0.6.0）协作编排：规则 target 泛化为「模型 | 协作流引用」，新增 flows 注册表 ---- */

/** 预设级带图兜底策略：latch 锁存打图模型 / blind 当无图 / transcribe-lazy 懒转写。 */
export type ImageFallback = 'latch' | 'blind' | 'transcribe-lazy'

/** 转写流：视觉模型把图片转写为文本后交给主模型。 */
export interface TranscribeFlow {
  type: 'transcribe'
  visionModel: RouteTarget
  failurePolicy: 'latch-image' | 'blind'
  prompt?: string
}

/** 评审流：评审模型对主模型产出做 N 轮评审/自动修订。 */
export interface ReviewFlow {
  type: 'review'
  reviewer: RouteTarget
  trigger: 'manual' | 'keywords'
  keywordGroup?: string
  rounds: number            // 1..3
  autoRevise: boolean
}

export type CollaborationFlow = TranscribeFlow | ReviewFlow

/** 规则目标：纯模型 或 协作流引用（flows 注册表的键）。 */
export type RuleTarget = RouteTarget | { flow: string }

export interface RouterConfigV5 {
  version: 5
  /** null = 关闭（逃生舱）；否则为 presets 的键。 */
  activePreset: string | null
  presets: Record<string, RouterPreset>
  /** 协作流注册表（预置 transcribe/review；预置流注册但不绑定）。 */
  flows: Record<string, CollaborationFlow>
  keywordGroups: Record<string, string[]>
}

/* ---- @legacy v4（0.5.x）形状：迁移输入专用（后续迁移任务消费），新代码禁止消费 ---- */
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

/** 预置协作流（0.6.0）：注册但不绑定，用户可增删改。 */
export function DEFAULT_FLOWS(): Record<string, CollaborationFlow> {
  return {
    transcribe: {
      type: 'transcribe',
      visionModel: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' },
      failurePolicy: 'latch-image',
    },
    review: {
      type: 'review',
      reviewer: { provider: KIMI_PROVIDER, model: 'k3' },
      trigger: 'manual',
      rounds: 1,
      autoRevise: false,
    },
  }
}

export function DEFAULT_CONFIG_V5(): RouterConfigV5 {
  const v4 = DEFAULT_CONFIG_V4()
  return {
    version: 5,
    activePreset: v4.activePreset,
    presets: v4.presets,
    flows: DEFAULT_FLOWS(),
    keywordGroups: v4.keywordGroups,
  }
}

/** 规则目标是否协作流引用（类型窄化守卫）。 */
export function isFlowTarget(t: RuleTarget): t is { flow: string } {
  return 'flow' in t
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
