export interface RouteTarget { provider: string; model: string; effort?: string }
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
  | { kind: 'keywords'; group: string; minHits?: number }  // 命名关键词组命中；minHits 缺省=1（0.7.0）

export interface RouterRule {
  id: string
  when: RuleCondition
  target: RuleTarget
}

export interface RouterPreset {
  name: string
  default: RouteTarget
  rules: RouterRule[]   // 特异度排序匹配：命中词数 desc、平手按列表序、带图恒优先；目标不可用跳过降级
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
  /**
   * 0.8.x⑧：非 agent-loop 辅助请求改道表（envelope `purpose` → 模型目标，
   * 如 `session-title`）。缺省/空表/无该键 = 该类请求不改道（向后兼容）；
   * 目标在候选目录不可用时保守放行（与规则目标降级同向）。语义校验见
   * validateRouterConfig（键非空/目标完整/不收流引用/effort 形状）。
   */
  auxTargets?: Record<string, RouteTarget>
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

/** 内置关键词组（用户可增删改；内置预设引用全部 7 组）。
 *  0.7.0：code 词表 8→17 词（消除「词表过薄」——覆盖调试/联调/部署/性能/
 *  报错/日志/编译/命令/脚本九类高频编码场景）。
 *  0.8.0（D1）覆盖面补全：内置 7 组——新增 review/writing/translate/longdoc/
 *  math；chitchat 瘦身为纯寒暄 6 词（「翻译」「总结」分别迁入 translate/
 *  writing 组）。 */
export const DEFAULT_KEYWORD_GROUPS: Record<string, string[]> = {
  code: ['代码', 'code', 'bug', '重构', 'refactor', '实现', '函数', '测试', '接口', '联调', '部署', '性能', '报错', '日志', '编译', '命令', '脚本'],
  chitchat: ['你好', '谢谢', '怎么样', '随便', '聊聊', '天气'],
  review: ['审查', 'review', '评审', '挑毛病', '复检', '检查', 'audit', '意见', '打分'],
  writing: ['写作', '文案', '润色', '改写', '扩写', '标题', '推文', '周报', '演讲稿', '总结'],
  translate: ['翻译', '译成', '中译英', '英译中', 'translate', '本地化'],
  longdoc: ['长文档', '通读', '逐段', '全文', '上万字', '大文档'],
  math: ['数学', '证明', '推导', '求解', '公式', '数论', '概率', '逻辑题'],
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
          { id: 'translate-v4f', when: { kind: 'keywords', group: 'translate' }, target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
        ],
      },
      capability: {
        name: '能力',
        default: { provider: KIMI_PROVIDER, model: 'k3' },
        // 0.8.0（D1）覆盖面补全：image → review → code → math → longdoc →
        // writing → translate → chitchat。review 在 code 前（用户裁定 2026-08-27：
        // 审查意图优先于泛 code 词，平手时落 review）；canonical 模型对 =
        // kimi-coding × deepseek-official，不假设 qwen/glm 存在。
        rules: [
          { id: 'image-k3', when: { kind: 'image' }, target: { provider: KIMI_PROVIDER, model: 'k3' } },
          { id: 'review-k3', when: { kind: 'keywords', group: 'review' }, target: { provider: KIMI_PROVIDER, model: 'k3' } },
          { id: 'code-kfc', when: { kind: 'keywords', group: 'code' }, target: { provider: KIMI_PROVIDER, model: 'kimi-for-coding' } },
          { id: 'math-v4p', when: { kind: 'keywords', group: 'math' }, target: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } },
          { id: 'longdoc-k3', when: { kind: 'keywords', group: 'longdoc' }, target: { provider: KIMI_PROVIDER, model: 'k3' } },
          { id: 'writing-v4p', when: { kind: 'keywords', group: 'writing' }, target: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } },
          { id: 'translate-v4f', when: { kind: 'keywords', group: 'translate' }, target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
          { id: 'chitchat-flash', when: { kind: 'keywords', group: 'chitchat' }, target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
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
    auxTargets: {},
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
