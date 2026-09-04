// src/rules.ts
/**
 * kimi-tide 0.5.0 规则引擎（纯函数，无 ctx/agent 依赖）：
 * 显式 @指令提取、消息工具、预设规则匹配。决策组装（可用性过滤/打底/护栏）
 * 在 router.ts。匹配语义（0.7.0）：命中规则按（特异度 desc，列表序 asc）稳定
 * 排序返回（由路由层取第一个目标可用者）；纯 ASCII 关键词带词边界邻接守卫，
 * 中文/混合/短语关键词为大小写不敏感子串匹配。
 */
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { KIMI_PROVIDER, isFlowTarget, type CollaborationFlow, type ReviewFlow, type RouteTarget, type RuleTarget, type RouterPreset, type RouterRule } from './config.js'
import type { RouterConfigAny } from './router.js'

export function explicitProvider(text: string): string | null {
  // 前导锚定（评审修复 2026-08-23）：@ 前紧邻词字符（\w 或 @）则不是指令——
  // 邮箱 user@example.com、句中引用等不误判。指令语义要求 @ 出现在行首或
  // 空白/标点/中文之后。行首装饰器（@Component）与指令在词法上不可区分，
  // 仍会命中 → 未知 provider 走 keep + 日志的既有宽容语义（decide 层钉桩）。
  const m = /(?:^|[^\w@])@([\w-]{2,20})\b/.exec(text)
  if (m === null) return null
  if (m[1] === 'kimi' || m[1] === 'kimi-tide') return KIMI_PROVIDER
  return m[1]
}

/** 从消息批次提取最新一条用户文本。 */
export function latestUserText(messages: readonly UserMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue
    let out = ''
    for (const block of message.content) {
      const b = block as { type?: string; text?: unknown }
      if (b?.type === 'text' && typeof b.text === 'string') out += b.text
    }
    if (out.trim().length > 0) return out
  }
  return ''
}

/** True when any user message in the batch carries an image block. */
export function messagesContainImage(messages: readonly UserMessage[]): boolean {
  return messages.some(
    (m) => m.role === 'user' && m.content.some((b) => (b as { type?: string }).type === 'image'),
  )
}

/**
 * matchingRules 消费的配置面（v4/v5 共有：activePreset/presets/keywordGroups）。
 * 结构化子集而非具体版本类型——规则匹配不读 version/flows，v4 存量与 v5 协作
 * 编排配置皆可传入（Task 8 路由器配置过渡形的接缝）。
 */
export interface RuleMatchConfig {
  activePreset: string | null
  presets: Record<string, RouterPreset>
  keywordGroups: Record<string, string[]>
}

/** 转义正则元字符。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface KeywordMatcher {
  matches(text: string): boolean
}

/**
 * 编译关键词为匹配器（0.7.0 词边界语义，设计决策 B1）：
 * - 纯 ASCII 词（^[a-z0-9_]+$，大小写不敏感）→ 邻接守卫正则
 *   (?<![a-z0-9_])词(?![a-z0-9_])——decode/unicode/barcode 不误中 code；
 *   CJK 邻接不阻断（「3d」仍命中「3d打印」）。
 * - 其余（中文/混合/多词短语）→ 子串匹配（0.5.x 语义，逐字节兼容）。
 */
function compileKeyword(keyword: string): KeywordMatcher {
  const lowered = keyword.toLowerCase()
  if (/^[a-z0-9_]+$/.test(lowered)) {
    const re = new RegExp(`(?<![a-z0-9_])${escapeRegExp(lowered)}(?![a-z0-9_])`)
    return { matches: (text) => re.test(text) }
  }
  return { matches: (text) => text.includes(lowered) }
}

/**
 * 单组词命中计数（matchingScored 的词匹配内循环助手；1.1.0 §5 起导出供
 * reviewTriggerHit 复用——词边界/子串语义与 matchingScored 完全一致，单一
 * 实现不复制）：文本内部 toLowerCase（ASCII 词大小写不敏感），空词不计。
 */
export function countGroupHits(words: readonly string[], text: string): number {
  const lower = text.toLowerCase()
  let matched = 0
  for (const k of words) {
    if (k.length > 0 && compileKeyword(k).matches(lower)) matched += 1
  }
  return matched
}

/** 单条命中：规则 + 命中词数（image 规则 = +∞）。 */
export interface RuleMatch { rule: RouterRule; score: number }

/**
 * 返回全部命中规则及计分，按（命中特异度 desc，列表序 asc）稳定排序
 * （0.7.0 设计决策 B2；0.8.0 起 score 随结果带出供决策原因/试一句消费——
 * 评审 M3）。含目标不可用者，可用性过滤在路由层。
 */
export function matchingScored(config: RuleMatchConfig, text: string, hasImage: boolean): RuleMatch[] {
  if (config.activePreset === null) return []
  const preset = config.presets[config.activePreset]
  if (preset === undefined) return []
  const hits: RuleMatch[] = []
  for (const rule of preset.rules) {
    if (rule.when.kind === 'image') {
      // 带图轮 image 规则恒优先（设计决策 B2）
      if (hasImage) hits.push({ rule, score: Number.POSITIVE_INFINITY })
      continue
    }
    const words = config.keywordGroups[rule.when.group]
    if (words === undefined) continue
    const matched = countGroupHits(words, text)
    const minHits = rule.when.minHits ?? 1
    if (matched >= minHits) hits.push({ rule, score: matched })
  }
  // ES2019+ 稳定排序：平手（含双 image 规则 ∞−∞=NaN 视同 0）保持列表序。
  hits.sort((a, b) => b.score - a.score)
  return hits
}

/** 薄封装：只取规则序列，保 0.7.0 契约（router/试一句之外的所有消费方不动）。 */
export function matchingRules(config: RuleMatchConfig, text: string, hasImage: boolean): RouterRule[] {
  return matchingScored(config, text, hasImage).map((h) => h.rule)
}

/** 决策摘要/UI 用的条件名：image→带图；keywords→组名。 */
export function ruleLabel(rule: RouterRule): string {
  return rule.when.kind === 'image' ? '带图' : rule.when.group
}

/** 规则行条件摘要（0.8.0 D2）：「带图」/「命中 code 组 ≥1 词」/「命中 plan 组 ≥2 词」。 */
export function ruleConditionSummary(rule: RouterRule, config: RuleMatchConfig): string {
  if (rule.when.kind === 'image') return '带图'
  return `命中 ${rule.when.group} 组 ≥${rule.when.minHits ?? 1} 词`
}

/**
 * 规则条件互斥键（⑥-B 打磨三 2026-08-29）：image → 'image'；
 * keywords → `组:minHits`。同键规则在后永不优先（带图同分 ∞ 按列表序；
 * 关键词同分按列表序）——设置界面以此禁存新重复/警示存量重复。
 * 同组不同 minHits 键不同：特异性不同，词数优先语义可区分，不算重复。
 */
export function ruleConditionKey(when: RouterRule['when']): string {
  return when.kind === 'image' ? 'image' : `kw:${when.group}:${when.minHits ?? 1}`
}

/**
 * 条件重复的被遮蔽规则 id（首条保留，其后即重复，保持出现顺序）。纯函数，
 * 设置界面查重共用：保存前比对数量（新增重复才阻止），加载后标警示。
 */
export function duplicateRuleIds(rules: readonly RouterRule[]): string[] {
  const seen = new Set<string>()
  const shadowed: string[] = []
  for (const rule of rules) {
    const key = ruleConditionKey(rule.when)
    if (seen.has(key)) shadowed.push(rule.id)
    else seen.add(key)
  }
  return shadowed
}

/** 认领中的关键词组（1.1.0 §4）：review 流 trigger=keywords 且 keywordGroup
 *  非空 → 该组被流认领。v4 无 flows → 空集（行为逐字节保持）。 */
export function claimedReviewGroups(config: RouterConfigAny): Set<string> {
  const claimed = new Set<string>()
  if (config.version !== 5) return claimed
  for (const flow of Object.values(config.flows)) {
    if (flow.type === 'review' && flow.trigger === 'keywords' && flow.keywordGroup) {
      claimed.add(flow.keywordGroup)
    }
  }
  return claimed
}

/** 评审流触发判定（1.1.0 §5）：flows 注册表序首个「文本命中认领组（≥1 词）
 *  且 reviewer 可用」的 review 流。显式 @（含未知 provider，rules.ts:20 对
 *  未知 @ 返回非空）一律返 null——评审武装对一切显式 @ 关闭。
 *  isReviewerAvailable 缺省恒真（纯函数默认路径）；decide 侧传 metas 判定、
 *  previewRoute 传 availability 判定（spec §4 盲区语义：此处 false 只影响
 *  武装，不影响抑制）。 */
export function reviewTriggerHit(
  config: RouterConfigAny,
  text: string,
  isReviewerAvailable: (target: RouteTarget) => boolean = () => true,
): { flowId: string; flow: ReviewFlow } | null {
  if (explicitProvider(text) !== null) return null
  if (config.version !== 5) return null
  for (const [flowId, flow] of Object.entries(config.flows)) {
    if (flow.type !== 'review' || flow.trigger !== 'keywords' || !flow.keywordGroup) continue
    const words = config.keywordGroups[flow.keywordGroup] ?? []
    if (words.length === 0) continue
    // 复用 matchingScored 同一款词匹配助手（countGroupHits——词边界/子串
    // 语义一致，单一实现不复制）。
    if (countGroupHits(words, text) < 1) continue
    if (!isReviewerAvailable(flow.reviewer)) continue
    return { flowId, flow }
  }
  return null
}

/** 试一句测试器依赖（0.8.0 D2）：候选目录与已配置目标可用性（浏览器侧无 modalities）。 */
export interface RoutePreviewDeps {
  catalog: Array<{ provider: string; models: string[] }> | null
  availability: Record<string, boolean> | null
  flows?: Record<string, CollaborationFlow>
}

/** 试一句预测结果（纯文本语义；带图偏差见 SettingsCard 固定声明）。 */
export interface RoutePreview {
  hits: RuleMatch[]
  outcome:
    | { kind: 'off'; reason: string }
    | { kind: 'explicit'; provider: string; target: RouteTarget | null; reason: string }
    | { kind: 'rule'; ruleId: string; label: string; score: number; target: RuleTarget | null; reason: string }
    | { kind: 'default'; target: RouteTarget; reason: string }
    /** 1.1.0 §4（M1 裁定）：routed 为「本轮路由到 X」的类型化载体（UI 不从
     *  hits 反推）——被认领组命中过滤后的实际路由（规则链首条，无命中即预设
     *  默认）。组认领但 reviewer 不可用时 outcome 仍为本枝，label 标注盲区。 */
    | {
        kind: 'review-flow'
        flowId: string
        label: string
        score: number
        routed: { kind: 'rule'; ruleId: string; label: string } | { kind: 'default'; target: RouteTarget }
      }
}

/**
 * 「试一句」预测（0.8.0 D2）：浏览器侧复刻 decide 的文本语义——显式 @ →
 * 规则链（首个目标可用者；availability===false 即不可用，null 全可用；
 * flow 目标须存在且 transcribe 型且 visionModel 可用，否则跳过）→ 默认打底。
 * 不模拟图像护栏/flow 降级路径（无 modalities，带图偏差声明在卡片）。
 * 1.1.0 §4：规则链与返回 hits 均剔除被认领组（decide 同款静态抑制）；评审
 * 流触发（先于过滤、基于全量命中）时 outcome 改为 review-flow 枝，routed
 * 携带过滤后路由；reviewer 不可用仍出本枝并经 label 标注（盲区可见性）。
 * 参数自 RuleMatchConfig 放宽为 RouterConfigAny：需读 version/flows 做
 * 认领与触发判定（v4 无 flows → 空集，行为保持）。
 */
export function previewRoute(config: RouterConfigAny, text: string, deps: RoutePreviewDeps): RoutePreview {
  const availability = deps.availability
  const available = (target: RouteTarget): boolean =>
    availability === null || availability[`${target.provider}/${target.model}`] !== false
  const hits = matchingScored(config, text, false)
  if (config.activePreset === null) return { hits, outcome: { kind: 'off', reason: '路由已关闭' } }
  const preset = config.presets[config.activePreset]
  if (preset === undefined) return { hits, outcome: { kind: 'off', reason: '激活预设不存在' } }
  const explicit = explicitProvider(text)
  if (explicit !== null) {
    const models = deps.catalog?.find((group) => group.provider === explicit)?.models
    const target = models !== undefined && models.length > 0
      ? { provider: explicit, model: models[0] }
      : null
    return {
      hits,
      outcome: {
        kind: 'explicit', provider: explicit, target,
        reason: target === null ? `显式 @${explicit} 指令（候选目录不可判）` : `显式 @${explicit} 指令`,
      },
    }
  }
  const flows = deps.flows ?? {}
  // 1.1.0 §4 静态抑制：被认领组规则不入路由链（decide 同款过滤）；返回 hits
  // 同步剔除（与路由链一致，UI 不从 hits 看到被抑制规则）。
  const claimed = claimedReviewGroups(config)
  const routable = claimed.size === 0
    ? hits
    : hits.filter(({ rule }) => !(rule.when.kind === 'keywords' && claimed.has(rule.when.group)))
  // 过滤后路由链（首条目标可用者）：既产 review-flow 的 routed 载体（首条命中
  // {kind:'rule'}，无命中即预设默认 {kind:'default'}），也保留无评审触发时
  // 的规则 outcome。
  let routedSummary: { kind: 'rule'; ruleId: string; label: string } | { kind: 'default'; target: RouteTarget } | undefined
  let ruleOutcome: { kind: 'rule'; ruleId: string; label: string; score: number; target: RuleTarget | null; reason: string } | undefined
  for (const { rule, score } of routable) {
    if (isFlowTarget(rule.target)) {
      const flow = flows[rule.target.flow]
      if (flow === undefined || flow.type !== 'transcribe') continue
      if (!available(flow.visionModel)) continue
      routedSummary = { kind: 'rule', ruleId: rule.id, label: ruleLabel(rule) }
      ruleOutcome = {
        kind: 'rule', ruleId: rule.id, label: ruleLabel(rule), score,
        target: { flow: rule.target.flow },
        reason: `规则「${ruleLabel(rule)}」命中 ${score} 词（协作流 ${rule.target.flow}）`,
      }
      break
    }
    if (!available(rule.target)) continue
    routedSummary = { kind: 'rule', ruleId: rule.id, label: ruleLabel(rule) }
    ruleOutcome = {
      kind: 'rule', ruleId: rule.id, label: ruleLabel(rule), score, target: { ...rule.target },
      reason: `规则「${ruleLabel(rule)}」命中 ${score} 词`,
    }
    break
  }
  if (routedSummary === undefined) routedSummary = { kind: 'default', target: { ...preset.default } }
  // 1.1.0 §4/§5：评审流触发判定先于过滤、基于全量命中（reviewTriggerHit 独立
  // 于路由链）。主判定传 availability（与 decide 侧武装语义一致）；组认领但
  // reviewer 不可用时回查不传——outcome 仍须为 review-flow 并经 label 显式
  // 标注盲区（spec §4：此处 false 只影响武装，不影响抑制）。
  const armed = reviewTriggerHit(config, text, (t) => available(t)) ?? reviewTriggerHit(config, text)
  if (armed !== null) {
    const reviewerOk = available(armed.flow.reviewer)
    return {
      hits: routable,
      outcome: {
        kind: 'review-flow',
        flowId: armed.flowId,
        label: reviewerOk ? `轮末触发评审流 ${armed.flowId}` : `评审流已认领但评审模型不可用`,
        score: 0,
        routed: routedSummary,
      },
    }
  }
  if (ruleOutcome !== undefined) return { hits: routable, outcome: ruleOutcome }
  return { hits: routable, outcome: { kind: 'default', target: { ...preset.default }, reason: `预设「${preset.name}」默认` } }
}
