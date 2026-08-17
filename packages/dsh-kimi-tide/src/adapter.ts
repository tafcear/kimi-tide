/**
 * kimi-tide: LlmAdapter implementation backed by pi-ai's kimi-coding
 * catalog, authenticated with the live OAuth access token.
 */
import {
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  attributionHeaders,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { createModels, getSupportedThinkingLevels, type MutableModels } from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { toPiContext } from './context.js'
import { KimiOAuthManager } from './oauth.js'
import { toStreamChunks } from './stream.js'

export interface KimiAdapterOptions {
  /** Route name this adapter owns (default 'kimi-tide'). */
  providerName: string
  /** Optional tap for usage chunks (feeds UsageMonitor local stats). */
  onUsage?: (usage: TokenUsage) => void
}

export class KimiAdapter extends LlmAdapter {
  private readonly models: MutableModels
  private readonly providerName: string

  constructor(
    private readonly oauth: KimiOAuthManager,
    private readonly options: KimiAdapterOptions,
  ) {
    super()
    this.providerName = options.providerName
    this.models = createModels()
    const provider = builtinProviders().find((p) => p.id === 'kimi-coding')
    if (provider === undefined) {
      throw new Error('dsh-kimi-tide: pi-ai catalog is missing the kimi-coding provider')
    }
    this.models.setProvider(provider)
  }

  override providerInfo(provider: string) {
    return { id: provider, name: 'Kimi Code (kimi-tide)' }
  }

  override listModels(_provider: string): Promise<LlmModelInfo[]> {
    // 未登录（无凭据文件）时不投放任何模型：模型选择器会把空分组整个丢弃，
    // 避免显示一个必然认证失败的死分组。登录后下一次打开选择器即恢复。
    if (!this.oauth.hasCredential()) {
      return Promise.resolve([])
    }
    return Promise.resolve(
      this.models.getModels('kimi-coding').map((model) => ({
        provider: this.providerName,
        id: model.id,
        name: model.name,
      })),
    )
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const piModel = this.models.getModel('kimi-coding', model)
    if (piModel === undefined) {
      throw new LlmError(`dsh-kimi-tide: unknown model "${model}"`, 'UNKNOWN_MODEL')
    }
    const levels = getSupportedThinkingLevels(piModel)
    return {
      provider,
      id: model,
      name: piModel.name,
      inputModalities: [...piModel.input],
      context: { contextWindow: piModel.contextWindow },
      ...(levels.length > 0
        ? { reasoning: { efforts: levels.map((level) => ({ id: ReasoningEffortId(level), name: level })) } }
        : {}),
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.stop !== undefined) {
      throw new LlmError('dsh-kimi-tide does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
    }
    const model = this.models.getModel('kimi-coding', options.model)
    if (model === undefined) {
      throw new LlmError(`dsh-kimi-tide: unknown model "${options.model}"`, 'UNKNOWN_MODEL')
    }
    if (this.oauth.getAccessToken().length === 0) {
      const refreshed = await this.oauth.refresh()
      if (!refreshed || this.oauth.getAccessToken().length === 0) {
        throw new LlmError('dsh-kimi-tide: no kimi access token available — run "kimi login" first', 'AUTH')
      }
    }
    const context = toPiContext(options)
    const events = this.models.streamSimple(model, context, {
      apiKey: this.oauth.getAccessToken(),
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
      signal: options.signal,
      headers: attributionHeaders(),
    })
    for await (const chunk of toStreamChunks(events, model.contextWindow)) {
      yield tapUsageChunk(chunk, this.options.onUsage)
    }
  }
}

/** Pass through a chunk; invoke the usage tap on usage chunks. */
export function tapUsageChunk(chunk: StreamChunk, onUsage: ((usage: TokenUsage) => void) | undefined): StreamChunk {
  if (onUsage !== undefined && chunk.type === 'usage') onUsage(chunk.usage)
  return chunk
}
