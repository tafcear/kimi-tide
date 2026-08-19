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
import { toPiContext, type ImageAttachmentReader } from './context.js'
import { KimiOAuthManager } from './oauth.js'
import { toStreamChunks } from './stream.js'

export interface KimiAdapterOptions {
  /** Route name this adapter owns (default 'kimi-tide'). */
  providerName: string
  /** Optional tap for usage chunks (feeds UsageMonitor local stats). */
  onUsage?: (usage: TokenUsage) => void
  /**
   * Resolve the durable attachment store on demand (mirrors the official
   * dsh-llm-pi-ai `resolveAttachments: () => ctx.get('attachments')`).
   * Needed only for image-bearing requests; text paths never call it.
   */
  resolveAttachments?: () => ImageAttachmentReader | undefined
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

  /** Model ids from the pi-ai kimi-coding catalog (panel dropdown options). */
  listModelIds(): string[] {
    return this.models.getModels('kimi-coding').map((model) => model.id)
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
    if (this.oauth.getAccessToken().length === 0 || this.oauth.remainingMs() < 60_000) {
      await ensureAccessToken(this.oauth)
    }
    const containsImage = options.messages.some((message) =>
      (message.content as readonly { type?: string }[]).some((block) => block.type === 'image'),
    )
    const context = await toPiContext(options, containsImage ? this.options.resolveAttachments?.() : undefined)
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

export interface EnsureTokenOptions {
  /** Max refresh attempts (default 4: covers the dsh web startup window where
   * the scheduled first refresh is still in flight or holds the credential lock). */
  retries?: number
  /** Delay between attempts in ms (default 2000). */
  delayMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Guarantee an access token before streaming, or throw AUTH.
 *
 * Regression: after a dsh web restart the in-memory token is empty until the
 * first scheduled OAuth refresh lands (observed ~2-3 min on a cold start). A
 * request arriving in that window used to do ONE inline refresh(); when that
 * attempt lost the shared-lock race to the in-flight scheduled refresh (or hit
 * a slow network), the adapter threw AUTH immediately — surfaced in the GUI as
 * "API key is invalid". Retry a few times with a short delay so the startup
 * window resolves itself instead of failing the user's turn.
 */
export async function ensureAccessToken(oauth: KimiOAuthManager, options: EnsureTokenOptions = {}): Promise<void> {
  const retries = options.retries ?? 4
  const delayMs = options.delayMs ?? 2000
  if (oauth.getAccessToken().length > 0 && oauth.remainingMs() >= 60_000) return
  for (let attempt = 0; attempt < retries; attempt++) {
    await oauth.refresh().catch(() => false)
    if (oauth.getAccessToken().length > 0) return
    if (attempt < retries - 1 && delayMs > 0) await sleep(delayMs)
  }
  throw new LlmError('dsh-kimi-tide: no kimi access token available — run "kimi login" first', 'AUTH')
}
