// src/rules.ts
/**
 * kimi-tide 0.5.0 规则引擎（纯函数，无 ctx/agent 依赖）：
 * 显式 @指令提取、消息工具、预设规则匹配。决策组装（可用性过滤/打底/护栏）
 * 在 router.ts。匹配语义（0.7.0）：命中规则按（特异度 desc，列表序 asc）稳定
 * 排序返回（由路由层取第一个目标可用者）；纯 ASCII 关键词带词边界邻接守卫，
 * 中文/混合/短语关键词为大小写不敏感子串匹配。
 */
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { KIMI_PROVIDER, type RouterPreset, type RouterRule } from './config.js'

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
 * 返回全部命中规则，按（命中特异度 desc，列表序 asc）稳定排序（0.7.0 设计
 * 决策 B2；含目标不可用者，可用性过滤在路由层——路由层现有「首条目标可用者
 * 生效」循环不变，排序即选优）。
 */
export function matchingRules(config: RuleMatchConfig, text: string, hasImage: boolean): RouterRule[] {
  if (config.activePreset === null) return []
  const preset = config.presets[config.activePreset]
  if (preset === undefined) return []
  const lower = text.toLowerCase()
  const hits: Array<{ rule: RouterRule; score: number }> = []
  for (const rule of preset.rules) {
    if (rule.when.kind === 'image') {
      // 带图轮 image 规则恒优先（设计决策 B2）
      if (hasImage) hits.push({ rule, score: Number.POSITIVE_INFINITY })
      continue
    }
    const words = config.keywordGroups[rule.when.group]
    if (words === undefined) continue
    let matched = 0
    for (const k of words) {
      if (k.length > 0 && compileKeyword(k).matches(lower)) matched += 1
    }
    // score = 命中关键词种数（同一词多次出现只计一次）
    if (matched > 0) hits.push({ rule, score: matched })
  }
  // ES2019+ 稳定排序：平手（含双 image 规则 ∞−∞=NaN 视同 0）保持列表序。
  hits.sort((a, b) => b.score - a.score)
  return hits.map((h) => h.rule)
}

/** 决策摘要/UI 用的条件名：image→带图；keywords→组名。 */
export function ruleLabel(rule: RouterRule): string {
  return rule.when.kind === 'image' ? '带图' : rule.when.group
}
