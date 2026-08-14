/**
 * kimi-tide: harness request-history conversion into pi-ai's Context.
 * Text-only in v1: image blocks raise UNSUPPORTED_CONTENT.
 * Tool-result names are recovered from preceding assistant tool calls,
 * matching the official dsh-llm-pi-ai conversion semantics.
 */
import { LlmError, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {
  AssistantMessage as PiAssistantMessage,
  Context as PiContext,
  Message as PiMessage,
  TextContent as PiTextContent,
  ThinkingContent as PiThinkingContent,
  ToolCall as PiToolCall,
} from '@earendil-works/pi-ai'

type PiAssistantContent = (PiTextContent | PiThinkingContent | PiToolCall)[]

function isTextBlock(block: unknown): block is PiTextContent {
  const b = block as { type?: unknown }
  return b?.type === 'text'
}

function flattenBlocks(blocks: readonly unknown[]): string {
  let out = ''
  for (const block of blocks) {
    const b = block as { type?: string; text?: unknown; thinking?: unknown }
    if (b?.type === 'text' && typeof b.text === 'string') out += b.text
    else if (b?.type === 'reasoning' && typeof b.thinking === 'string') out += b.thinking
  }
  return out
}

function safeParseArgs(argumentsJson: string | undefined): Record<string, unknown> {
  if (!argumentsJson) return {}
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return { _raw: argumentsJson }
  }
}

function toPiAssistantContent(blocks: readonly unknown[]): PiAssistantContent {
  const content: PiAssistantContent = []
  for (const raw of blocks) {
    const b = raw as { type?: string; text?: unknown; thinking?: unknown; id?: string; name?: string; arguments?: string }
    switch (b.type) {
      case 'text':
        content.push({ type: 'text', text: typeof b.text === 'string' ? b.text : '' })
        break
      case 'reasoning':
        content.push({ type: 'thinking', thinking: typeof b.thinking === 'string' ? b.thinking : '' })
        break
      case 'tool-call':
        content.push({
          type: 'toolCall',
          id: b.id ?? 'unknown',
          name: b.name ?? 'unknown',
          arguments: safeParseArgs(b.arguments),
        })
        break
      default:
        break
    }
  }
  return content
}

/**
 * Convert a harness request into a synchronous pi-ai Context (text-only).
 * @throws LlmError('UNSUPPORTED_CONTENT') when any image block is present.
 */
export function toPiContext(options: GenerateOptions): PiContext {
  const toolNames = new Map<string, string>()
  const messages: PiMessage[] = []
  for (const message of options.messages) {
    if (message.role === 'system') {
      messages.push({ role: 'user', content: flattenBlocks(message.content) || '(system)', timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      const content = toPiAssistantContent(message.content)
      for (const block of content) {
        if (block.type === 'toolCall') toolNames.set(block.id, block.name)
      }
      const assistant: PiAssistantMessage = {
        role: 'assistant',
        content,
        api: 'anthropic-messages',
        provider: message.source.kind === 'model' ? message.source.provider : 'kimi-coding',
        model: message.source.kind === 'model' ? message.source.model : 'kimi-for-coding',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: 0,
      }
      messages.push(assistant)
      continue
    }
    // user role: reject images, split inline text from tool results
    const inline: unknown[] = []
    const results: unknown[] = []
    for (const block of message.content) {
      const b = block as { type?: string }
      if (b.type === 'image') {
        throw new LlmError('dsh-kimi-tide v1 supports text only (image input is unsupported)', 'UNSUPPORTED_CONTENT')
      }
      if (b.type === 'tool-result') results.push(block)
      else inline.push(block)
    }
    const inlineText = flattenBlocks(inline)
    if (inlineText.length > 0 || results.length === 0) {
      messages.push({ role: 'user', content: inlineText, timestamp: 0 })
    }
    for (const result of results) {
      const r = result as { toolCallId?: string; content?: readonly unknown[]; isError?: boolean }
      const callId = r.toolCallId ?? 'unknown'
      const resultContent = flattenBlocks(r.content ?? [])
      const text: PiTextContent = { type: 'text', text: resultContent.length > 0 ? resultContent : '(no output)' }
      messages.push({
        role: 'toolResult',
        toolCallId: callId,
        toolName: toolNames.get(callId) ?? 'unknown',
        content: [text],
        isError: r.isError ?? false,
        timestamp: 0,
      })
    }
  }
  const context: PiContext = { messages }
  if (options.system !== undefined && options.system.length > 0) {
    context.systemPrompt = options.system
  }
  if (options.tools !== undefined && options.tools.length > 0) {
    context.tools = options.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }))
  }
  return context
}
