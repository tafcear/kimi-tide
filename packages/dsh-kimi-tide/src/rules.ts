// src/rules.ts
/**
 * kimi-tide 0.5.0 规则引擎（纯函数，无 ctx/agent 依赖）：
 * 显式 @指令提取、消息工具、预设规则匹配。决策组装（可用性过滤/打底/护栏）
 * 在 router.ts。匹配语义：规则列表顺序、首条命中生效（本函数按序返回全部
 * 命中，由路由层取第一个目标可用者）；关键词为大小写不敏感子串匹配。
 */
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { KIMI_PROVIDER, type RouterPreset, type RouterRule } from './config.js'

export function explicitProvider(text: string): string | null {
  const m = /@([\w-]{2,20})\b/.exec(text)
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

/** 按预设规则顺序返回全部命中规则（含目标不可用者；可用性过滤在路由层）。 */
export function matchingRules(config: RuleMatchConfig, text: string, hasImage: boolean): RouterRule[] {
  if (config.activePreset === null) return []
  const preset = config.presets[config.activePreset]
  if (preset === undefined) return []
  const lower = text.toLowerCase()
  const hits: RouterRule[] = []
  for (const rule of preset.rules) {
    if (rule.when.kind === 'image') {
      if (hasImage) hits.push(rule)
      continue
    }
    const words = config.keywordGroups[rule.when.group]
    if (words === undefined) continue
    if (words.some((k) => k.length > 0 && lower.includes(k.toLowerCase()))) hits.push(rule)
  }
  return hits
}

/** 决策摘要/UI 用的条件名：image→带图；keywords→组名。 */
export function ruleLabel(rule: RouterRule): string {
  return rule.when.kind === 'image' ? '带图' : rule.when.group
}
