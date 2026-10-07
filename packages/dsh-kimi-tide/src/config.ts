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
  /**
   * 预设级语义命中确认闸（v1.3.0）：关键词命中时先让**本预设的打底模型**
   * 判定真伪，判否则跳过该规则继续后续规则。缺省/`enabled !== true` = 关闭
   * （存量行为零突变）。
   *
   * **不入 settings schema**（2026-09-15 评审 S1）：对象型字段一旦进
   * `presetSchema`，schemastery 会在解析时给每个预设注入 `hitConfirm: {}`，
   * 破坏 `settings-schema.test.ts` 的「默认往返相等」红线。靠 schema 的
   * 「未知键透传保留」保活，形状与界校验在 `validateRouterConfig`（与 v3
   * `default` 同款先例）。
   */
  hitConfirm?: HitConfirm
}

/** 语义命中确认闸配置（全部可选；缺省 = 关闭）。 */
export interface HitConfirm {
  enabled?: boolean
  /** 判官调用有界超时，1..10000ms，缺省 1200。 */
  timeoutMs?: number
  /** 判官输出上限，1..256 token，缺省 64。 */
  maxTokens?: number
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
  rounds: number            // 1..3；同时是**每会话修订次数上限**（v1.4.0）
  autoRevise: boolean
  /**
   * 修订后再评一轮（v1.4.0 spec §4；用户 2026-10-02 裁定默认开）。
   * 缺省/`undefined` = **开**（`!== false` 语义——存量配置不写该键也享受复检，
   * 与「默认开」的裁定一致）；显式 `false` 才关闭。每次修订因此多一次评审调用，
   * 开销同样受 `rounds` 上限约束。
   */
  recheck?: boolean
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

/** 分工表条目（设计稿 D2）：一个角色 = 一个领域 → 一个模型目标。 */
export interface RoleEntry {
  /** 稳定 id（配置键；同时是默认认领的队友名，须满足 lower-kebab-case）。 */
  id: string
  /** 显示名，如「前端」。 */
  label: string
  /** 该角色的路由目标（复用 RouteTarget 与既有降级语义）。 */
  target: RouteTarget
  /** 额外认领的队友名（与 id 合并成认领集合；不得与他 role 冲突）。 */
  teammate?: string[]
  /** 供模型识别的别名（进分工表 skill 正文）。 */
  aliases?: string[]
  /** 给模型的补充说明。 */
  note?: string
}

/** v6 配置：v5 之上新增分工层（driver / driverSticky / rulesApplyToChildren / roles）。 */
export interface RouterConfigV6 {
  version: 6
  activePreset: string | null
  presets: Record<string, RouterPreset>
  flows: Record<string, CollaborationFlow>
  keywordGroups: Record<string, string[]>
  auxTargets?: Record<string, RouteTarget>
  /** 主驱动目标；null / 缺失 = 跟随宿主 agent-default-model（设计稿 D1）。 */
  driver?: RouteTarget | null
  /** true 时主会话打底 = driver（新装默认 true；存量迁移显式 false）。 */
  driverSticky?: boolean
  /** 子代理是否参与关键词规则；缺失/false = 不参与（设计稿 D6，v2.0.0 行为变更）。 */
  rulesApplyToChildren?: boolean
  /** 分工表；键即 role.id。 */
  roles: Record<string, RoleEntry>
}

export type RouterConfigV5Plus = RouterConfigV5 | RouterConfigV6

/* ---- v7（C2 统一路由表，设计稿 2026-10-07 §6）：关键词规则与分工表合成一张带 scope 的路由表 ---- */

/** v7 统一路由表的一行：scope 区分主会话规则（session）与分工表派发（dispatch）。 */
export interface RouteRowV7 {
  id: string
  scope: 'session' | 'dispatch'
  when: { kind: 'image' } | { kind: 'keywords'; group: string; minHits?: number } | { kind: 'role' }
  target: RuleTarget
  /** session 行必填：归属预设 id。 */
  preset?: string
  /** dispatch 行专用（= v6 RoleEntry 元数据：显示名/额外认领队友/别名/备注）。 */
  label?: string
  teammate?: string[]
  aliases?: string[]
  note?: string
}

/**
 * v7 配置：v6 之上新增 routes（**唯一真源**）。旧字段（presets[*].rules / roles）
 * 迁移后**保留原值不删**（可回退、可 diff）；运行期读取按字段判据
 * `config.routes ?? 旧字段投影`（rowsFromConfig），**禁止版本号门控**（R2 裁定）。
 * 运行期写只写 routes（本任务只立形状；写通道切换由 A/B/D2 接管）。
 */
export interface RouterConfigV7 {
  version: 7
  activePreset: string | null
  presets: Record<string, RouterPreset>
  flows: Record<string, CollaborationFlow>
  keywordGroups: Record<string, string[]>
  auxTargets?: Record<string, RouteTarget>
  driver?: RouteTarget | null
  driverSticky?: boolean
  rulesApplyToChildren?: boolean
  /** 旧字段镜像（迁移保留；新装为空表——不预置模型判断，D2 裁定）。 */
  roles: Record<string, RoleEntry>
  /** 统一路由表（唯一真源）。 */
  routes: RouteRowV7[]
}

/**
 * v7 内置真相源（新装 / 「重置为默认」路径）：routes = 内置预设的 session 行
 * （保序，先 saving 后 capability）；dispatch 行空（不预置模型判断，D2 裁定）。
 * presets 的 rules 迁出为空（§6.1：v7 形状下规则只活在 routes）。
 */
export function DEFAULT_CONFIG_V7(): RouterConfigV7 {
  const v6 = DEFAULT_CONFIG_V6()
  const presets: Record<string, RouterPreset> = {}
  for (const [key, preset] of Object.entries(v6.presets)) presets[key] = { ...preset, rules: [] }
  return { ...v6, version: 7, presets, roles: DEFAULT_ROLES(), routes: rowsFromLegacy(v6) }
}

/**
 * 运行期行集投影（**字段判据，禁止版本号门控**——R2 裁定，沿用 v6 分工层同款
 * 形态）：config.routes 存在 ⇒ 直接采用（唯一真源）；否则从旧字段
 * （presets[*].rules → session 行、roles → dispatch 行）投影。v6 与 v7 都必须
 * 投影出正确行集。
 *
 * S1 防御（2026-10-07 复核）：读路径不经过写入期 validateRoutes 校验，而本项目的
 * 用户正是手改 cordis.patch.yml 的人——YAML 里 `routes:` 后跟空项（解析为 null）
 * 等畸形行不得让读边界崩溃。口径：非对象 / scope 非法（∉ session|dispatch）的行
 * **保守丢弃**并 warn（沿用「悬空 preset 行保守丢弃」的既有口径）；干净数组仍
 * **原引用返回**（既有零开销路径不变）；routes 非数组（如误写成映射）⇒ 回落
 * 旧字段投影（字段判据的失败面不吞掉合法配置）。
 */
export function rowsFromConfig(
  config: RouterConfigV4 | RouterConfigV5Plus | RouterConfigV7,
  warn: (message: string) => void = () => {},
): RouteRowV7[] {
  const routes = (config as { routes?: unknown }).routes
  if (routes !== undefined) {
    if (Array.isArray(routes)) {
      const firstBad = routes.findIndex((row) => !isWellFormedRouteRow(row))
      if (firstBad === -1) return routes as RouteRowV7[]
      warn(`dsh-kimi-tide: routes 第 ${firstBad + 1} 行畸形（非对象或 scope 非法），读路径保守丢弃该行`)
      return routes.filter(isWellFormedRouteRow) as RouteRowV7[]
    }
    warn('dsh-kimi-tide: routes 非数组（读路径视为缺失，回落 presets[*].rules / roles 投影）')
  }
  return rowsFromLegacy(config)
}

/** 读边界畸形行判据：普通对象且 scope ∈ session|dispatch（写入期校验见 validateRoutes）。 */
function isWellFormedRouteRow(row: unknown): row is RouteRowV7 {
  return row !== null && typeof row === 'object' && !Array.isArray(row)
    && ((row as { scope?: unknown }).scope === 'session' || (row as { scope?: unknown }).scope === 'dispatch')
}

/** 旧字段 → v7 行集投影（rowsFromConfig 的 legacy 支路，迁移 migrateV6 共用；
 *  B 项写通道双写亦由本函数从「将要写入的 presets/roles」推出同源 routes 行集
 *  ——读写两侧同一实现，防两处投影逻辑漂移）：
 *  预设序 × 规则序保序填 preset；roles 键序保序搬 label/teammate/aliases/note。
 *  when/target 直接共享原引用（纯投影，不改写不克隆）。 */
export function rowsFromLegacy(config: { presets: Record<string, RouterPreset>; roles?: Record<string, RoleEntry> }): RouteRowV7[] {
  const rows: RouteRowV7[] = []
  for (const [presetId, preset] of Object.entries(config.presets)) {
    for (const rule of preset.rules) {
      rows.push({ id: rule.id, scope: 'session', when: rule.when, target: rule.target, preset: presetId })
    }
  }
  const roles = config.roles ?? {}
  for (const role of Object.values(roles)) {
    rows.push({
      id: role.id,
      scope: 'dispatch',
      when: { kind: 'role' },
      target: role.target,
      label: role.label,
      ...(role.teammate === undefined ? {} : { teammate: role.teammate }),
      ...(role.aliases === undefined ? {} : { aliases: role.aliases }),
      ...(role.note === undefined ? {} : { note: role.note }),
    })
  }
  return rows
}

/**
 * routes → 旧字段反投影（C2b 运行期接线，设计稿 §6.4）：routes 存在且非空时按其
 * 重建 `presets[*].rules`（session 行，按**在本数组中的相对顺序**落回所属 preset）
 * 与 `roles`（dispatch 行 → v6 RoleEntry），使只读旧字段的下游（matchingRules /
 * roleClaimSet / renderTeamSkill / 台账）不改一行即按 routes 走——routes 是唯一
 * 真源，重建结果**覆盖**陈旧的旧字段。
 *
 * 不变量：
 * - routes 缺失或空数组 ⇒ **原引用返回**（v6 及更早配置零开销、零行为变更）；
 * - 不修改入参：浅拷贝 config，只重建 presets 与 roles 两处；其余字段
 *   （flows / keywordGroups / driver / … 及 routes 自身）原引用保留；
 * - presets 逐项浅拷贝（name / default / imageFallback 等原引用保留），仅 rules 重建；
 * - session 行的 when / target 与行内共享原引用（与 rowsFromLegacy 投影方向互逆，
 *   「routes ≡ 旧字段」的迁移产物因此逐字节还原）；
 * - dispatch 行还原 id / label / target / teammate / aliases / note 逐字段等价，
 *   缺省字段**不落键**；label 缺省回落 id（RoleEntry.label 必填）；
 * - 悬空 preset 引用的 session 行保守丢弃（写入期 validateRoutes 已拒，读边界不抛错）；
 * - 畸形行（null / 非对象 / scope 非法——手改 YAML 的常见产物）同样保守丢弃并
 *   warn，读路径不因畸形行崩溃（S1，2026-10-07 复核；读边界不经过写入期校验）。
 */
export function projectRoutesToLegacy<T extends RouterConfigV4 | RouterConfigV5Plus | RouterConfigV7>(
  config: T,
  warn: (message: string) => void = () => {},
): T {
  const routes = (config as { routes?: unknown }).routes
  if (!Array.isArray(routes) || routes.length === 0) return config
  const source = config as unknown as RouterConfigV7
  const presets: Record<string, RouterPreset> = {}
  for (const [presetId, preset] of Object.entries(source.presets)) {
    presets[presetId] = { ...preset, rules: [] }
  }
  const roles: Record<string, RoleEntry> = {}
  for (const [index, entry] of routes.entries()) {
    if (!isWellFormedRouteRow(entry)) {
      warn(`dsh-kimi-tide: routes 第 ${index + 1} 行畸形（非对象或 scope 非法），投影时保守丢弃该行`)
      continue
    }
    const row = entry
    if (row.scope === 'session') {
      const preset = typeof row.preset === 'string' ? presets[row.preset] : undefined
      if (preset === undefined) continue
      preset.rules.push({ id: row.id, when: row.when as RouterRule['when'], target: row.target })
    } else {
      roles[row.id] = {
        id: row.id,
        label: row.label ?? row.id,
        target: row.target as RouteTarget,
        ...(row.teammate === undefined ? {} : { teammate: row.teammate }),
        ...(row.aliases === undefined ? {} : { aliases: row.aliases }),
        ...(row.note === undefined ? {} : { note: row.note }),
      }
    }
  }
  return { ...source, presets, roles } as T
}

/** v5 及以上（flows 等字段可用）；版本落点统一的加宽判据。 */
export function isV5Plus(config: { version: number }): config is RouterConfigV5Plus {
  return config.version >= 5
}

/** 内置分工表：空表（不替用户做能力判断；设置页提供三条可一键填入的示例）。 */
export function DEFAULT_ROLES(): Record<string, RoleEntry> {
  return {}
}

/**
 * v6 内置真相源（新装 / 「重置为默认」路径）。
 * driverSticky: true = 主驱动恒定（用户 2026-10-05 裁定"开"）；
 * 存量配置由 migrateV5 显式写 false，保持 v1.4.1 行为。
 * rulesApplyToChildren 故意缺席：运行期缺省 false 即新语义，迁移不写（评审阻塞 B2）。
 */
export function DEFAULT_CONFIG_V6(): RouterConfigV6 {
  const v5 = DEFAULT_CONFIG_V5()
  return {
    version: 6,
    activePreset: v5.activePreset,
    presets: v5.presets,
    flows: v5.flows,
    keywordGroups: v5.keywordGroups,
    ...(v5.auxTargets === undefined ? {} : { auxTargets: v5.auxTargets }),
    driver: null,
    driverSticky: true,
    roles: DEFAULT_ROLES(),
  }
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
      // v1.4.0：复检默认开（用户 2026-10-02 裁定）。预置流显式写出该键，
      // 「默认往返相等」的 schema 往返测试因此逐字成立。
      recheck: true,
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
