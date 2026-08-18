import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { Dim } from './config.js'

const DEFAULT_PATTERNS: Record<string, string[]> = {
  code: ['代码', 'code', 'bug', '重构', 'refactor', '实现', '函数', '测试'],
  reasoning: ['审查', 'review', '推理', '证明', '分析', '为什么', '审计'],
  writing: ['文档', '总结', '翻译', '写一', '文章', 'report'],
  tooluse: [],
}
export interface ClassifyResult {
  weights: Partial<Record<Dim, number>>
  vision: boolean
  estTokens: number
  explicit?: string
}
export function explicitProvider(text: string): string | null {
  const m = /@([\w-]{2,20})\b/.exec(text)
  if (m === null || m[1] === 'kimi') return m?.[1] === 'kimi' ? 'kimi-tide' : null
  return m[1]
}
export function classify(messages: readonly UserMessage[], opts: { charsPerToken: number; patterns?: Record<string, string[]> }): ClassifyResult {
  const patterns = { ...DEFAULT_PATTERNS, ...(opts.patterns ?? {}) }
  let text = '', chars = 0, vision = false
  for (const m of messages) {
    if (m.role !== 'user') continue
    for (const b of m.content as Array<{ type?: string; text?: unknown }>) {
      if (b.type === 'image') vision = true
      if (b.type === 'text' && typeof b.text === 'string') { text += b.text; chars += b.text.length }
    }
  }
  const estTokens = Math.ceil(chars / Math.max(1, opts.charsPerToken))
  const weights: Partial<Record<Dim, number>> = {}
  for (const [dim, keys] of Object.entries(patterns)) {
    if (keys.some((k) => text.toLowerCase().includes(k.toLowerCase()))) weights[dim as Dim] = (weights[dim as Dim] ?? 0) + 2
  }
  if (estTokens > 60000) weights.longctx = (weights.longctx ?? 0) + 1
  if (vision) weights.vision = 3
  return { weights, vision, estTokens, explicit: explicitProvider(text) ?? undefined }
}
