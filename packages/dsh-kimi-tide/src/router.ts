/**
 * kimi-tide: automatic model router — 月汐规则驱动路由的决策核心（0.6.0）。
 *
 * 决策语义（spec §5.1）：显式 @指令（最高优先级）→ 预设规则链（列表顺序，
 * 首条目标可用者生效；目标不可用跳过该规则降级）→ 未命中路由到预设默认
 * 模型（打底，非 keep）。规则目标是模型或协作流引用（0.6.0）：流目标须
 * flow 存在 + transcribe 型 + visionModel 可用，任一不满足按同样的降级
 * 语义跳过。
 *
 * 事件流（DSH 官方机制，与 0.4.x 相同）：
 *   agent/pre-step（携带本步消息）→ decide() 计算决策存入 per-agent 槽位
 *   agent/request（携带该步的 callConfig）→ 消费槽位，返回替换路由
 *
 * 0.6.0（Task 9）编排执行层：pre-step 按 spec §5.1/5.2/5.6 执行序接线
 * eager/lazy 转述（按图状态表替代布尔锁存）；llm/stream 智能投影拦截器
 * 把 text-only 目标请求中已转述的图块替换为转述文字（S4c 缝，spike 实证）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ContentBlock,
  GenerateOptions,
  ImageBlock,
  LlmCallConfig,
  Message,
  ReasoningEffortId,
  ToolResultBlock,
} from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type {
  CandidateMeta, CollaborationFlow, RouteTarget, RouterConfigV4, RouterConfigV5, RouterPreset, TranscribeFlow,
} from './config.js'
import { isFlowTarget } from './config.js'
import type { ImageStateEntry, ImageStateStore } from './image-state.js'
import type { ResolvedImage, Transcriber, VisionCaller } from './transcribe.js'
import { explicitProvider, latestUserText, matchingScored, messagesContainImage, ruleLabel } from './rules.js'
export { latestUserText, messagesContainImage } from './rules.js'
export type { RouteTarget }

/**
 * Host prompt image-admission probe (dsh-host-apiproxy hotfix, 2026-08-18;
 * upstream master identical to rc.7). Dispatched with the agent scope carrier
 * BEFORE the prompt RPC admits an image whose current model selection is
 * text-only — the per-step image guard cannot run because the message never
 * enters the loop. Serial semantics: the first bail value (truthy non-false)
 * wins; `undefined`/`false` leaves the host's rejection in charge; no
 * listeners → rejection (upstream-identical behavior on unpatched hosts).
 */
declare module '@deepseek-ai/cordis' {
  interface Events {
    'agent/image-admission'(this: unknown, payload: {
      provider: string
      model: string
    }): boolean | undefined
  }
}

export type RouteDecision =
  | { kind: 'route'; target: RouteTarget; reason: string; via: 'explicit' | 'rule' | 'default' }
  | { kind: 'flow'; flowId: string; flow: TranscribeFlow; reason: string; via: 'rule' }
  | { kind: 'keep'; reason: string }

/**
 * 路由器配置的过渡形（Task 8）：v4 存量与 v5 协作编排配置皆可挂载。
 * v4 无 flows 注册表——flow 规则目标按「flow 不存在」跳过，与 0.5.x 行为
 * 逐字节一致；settings/index 面的全量 V5 迁移已交付（0.6.0，spec §6：
 * 命名空间 v5 存储 + 一次性迁移 + sidecar 写回留档）。
 */
export type RouterConfigAny = RouterConfigV4 | RouterConfigV5

/** v5 配置取 flows 注册表；v4 无注册表 → 空表（flow 目标恒按「不存在」降级，行为保持）。 */
function flowsOf(config: RouterConfigAny): Record<string, CollaborationFlow> {
  return config.version === 5 ? config.flows : {}
}

/**
 * 预设级带图兜底判定（0.6.0，纯函数）：native 列表为空 → null（无图可处理，
 * 各策略一致短路）；imageFallback 缺席 → 按 latch（维持 0.5.x 锁存行为）；
 * latch → 取 native 列表末位（最近）的 latchTarget，缺席则 null；blind →
 * 当无图；transcribe-lazy → 懒转写，flowId = imageFallbackFlow ?? 'transcribe'，
 * flow 须存在且为 transcribe 型，否则 null。
 */
export function resolveImageFallback(
  preset: RouterPreset,
  flows: Record<string, CollaborationFlow>,
  native: ReadonlyArray<readonly [string, ImageStateEntry]>,
): { kind: 'latch'; target: RouteTarget } | { kind: 'blind' } | { kind: 'lazy'; flowId: string; flow: TranscribeFlow } | null {
  if (native.length === 0) return null
  const mode = preset.imageFallback ?? 'latch'
  if (mode === 'blind') return { kind: 'blind' }
  if (mode === 'transcribe-lazy') {
    const flowId = preset.imageFallbackFlow ?? 'transcribe'
    const flow = flows[flowId]
    if (flow === undefined || flow.type !== 'transcribe') return null
    return { kind: 'lazy', flowId, flow }
  }
  const last = native[native.length - 1][1]
  const target = last.latchTarget
  return target === undefined ? null : { kind: 'latch', target }
}

/** Providers that cannot accept image input, derived from candidate modalities. */
export function textOnlyProviders(metas: readonly CandidateMeta[]): Set<string> {
  const imageCapable = new Set(metas.filter((m) => m.modalities.includes('image')).map((m) => m.provider))
  return new Set([...new Set(metas.map((m) => m.provider))].filter((p) => !imageCapable.has(p)))
}

function imageCapablePicks(metas: readonly CandidateMeta[]): CandidateMeta[] {
  return metas.filter((m) => m.modalities.includes('image') && m.available)
}

/**
 * 图像护栏（模型级判定）。rc.2 起 deepseek 目录混入 vision 模型
 * （deepseek-v4-flash-vision-exp），provider 级判定会把文本模型目标放行进
 * 宿主 projectImagesForTextModel 的 hash 占位投影——判定必须落到目标模型自身。
 * 改道目标按用户意图序选择：预设默认 → 规则目标序 → 目录序首个多模态可用候选，
 * 未声明过的模型（如目录自带的试验性 vision 模型）不主动改道过去。
 */
export function applyImageGuard(
  target: RouteTarget,
  hasImage: boolean,
  metas: readonly CandidateMeta[],
  intent?: readonly RouteTarget[],
): { target: RouteTarget; reason: string } | null {
  if (!hasImage) return null
  const targetMeta = metas.find((m) => m.provider === target.provider && m.model === target.model)
  // 目录读不到的目标保持历史宽容，绝不劫持读不准能力的路由。
  if (targetMeta === undefined) return null
  if (targetMeta.modalities.includes('image')) return null
  const picks = imageCapablePicks(metas)
  if (picks.length === 0) return null
  const chosen = intent === undefined
    ? picks[0]
    : picks.find((pick) => intent.some((t) => t.provider === pick.provider && t.model === pick.model)) ?? picks[0]
  return { target: { provider: chosen.provider, model: chosen.model }, reason: 'image input: rerouted to multimodal candidate' }
}

export function canClaimImageAdmission(config: RouterConfigAny, metas: readonly CandidateMeta[]): boolean {
  if (config.activePreset === null) return false
  return imageCapablePicks(metas).length > 0
}

/** 推理等级升级序（与 pi-ai THINKING_LEVELS 一致），供钳制降级使用。 */
const REASONING_LEVELS: readonly string[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * 决定路由目标携带的推理等级（2026-08-25：会话级 effort 从主力模型继承，
 * 不能原样透传——目标不支持时 dsh-llm-pi-ai 的 resolveReasoningLevel 会抛
 * UNSUPPORTED_REASONING_EFFORT 使整轮失败）。
 *
 * 语义：能力已知且支持 → 原样保留；支持但等级更高 → 向下钳制到不高于继承
 * 等级的最高支持等级；能力未知（枚举未完成/适配器未暴露）或目标仅支持 off
 * → 剥离（维持 0.5.x 行为，交给目标自身的默认/自适应策略）。
 *
 * @returns 应写入 callConfig 的 effort；undefined = 剥离。
 */
export function reasoningEffortFor(
  metas: readonly CandidateMeta[],
  target: RouteTarget,
  inherited: ReasoningEffortId | undefined,
): ReasoningEffortId | undefined {
  if (inherited === undefined) return undefined
  const meta = metas.find((m) => m.provider === target.provider && m.model === target.model)
  const supported = meta?.reasoningEfforts
  if (supported === undefined || supported.length === 0) return undefined
  if (supported.includes(inherited)) return inherited
  const idx = REASONING_LEVELS.indexOf(inherited)
  // 自继承等级向下钳制；'off' 不显式下发（对非推理模型等效，且语义一致）。
  for (let i = idx; i > 0; i--) {
    if (supported.includes(REASONING_LEVELS[i])) return REASONING_LEVELS[i] as ReasoningEffortId
  }
  return undefined
}

/**
 * 目标 effort 判定（0.8.0，spec D3/M5）：explicit（target.effort）覆盖会话继承
 * 值后再过支持集判定——支持 → 原样；不支持/能力未知/仅 off → 剥离（模型默认），
 * 不做越级钳制（用户显式指定的语义；dsh-llm 对不支持显式档位抛
 * UNSUPPORTED_REASONING_EFFORT，第二保险）。explicit 缺省 → 继承语义与
 * reasoningEffortFor 逐字节一致（护栏二次改道 target 无 effort 即走此路，
 * 保证规则 effort 不泄漏给视觉模型——M5 用户裁定）。
 */
export function effortForTarget(
  metas: readonly CandidateMeta[],
  target: RouteTarget,
  inherited: ReasoningEffortId | undefined,
  explicit: string | undefined,
): ReasoningEffortId | undefined {
  const meta = metas.find((m) => m.provider === target.provider && m.model === target.model)
  const supported = meta?.reasoningEfforts
  if (explicit !== undefined) {
    if (supported !== undefined && supported.length > 0 && supported.includes(explicit)) return explicit as ReasoningEffortId
    return undefined
  }
  return reasoningEffortFor(metas, target, inherited)
}

export interface RouterLog {
  info: (message: string) => void
}

/**
 * Rule-driven router engine (0.5.0). The scoring engine of 0.3.x/0.4.x is
 * replaced by: explicit @provider directive → preset rule chain (first hit
 * with an available target wins; unavailable targets are skipped) → preset
 * default (miss ≠ keep).
 */
export class KimiRouter {
  readonly config: RouterConfigAny
  readonly metas: CandidateMeta[]
  private readonly log: RouterLog
  constructor(config: RouterConfigAny, metas: CandidateMeta[], log: RouterLog) {
    this.config = config; this.metas = metas; this.log = log
  }

  /**
   * 基于本步消息批次做决策。
   * `step` 为契约占位：每轮只在首个模型步判定的语义由 installRouter
   * （payload.step === 1 门控）完成，decide 本身不使用该参数。
   *
   * `hasImageOverride`（0.6.0：本轮未转述图语义）：agent/pre-step 的
   * payload.messages 只携带本轮 claimed 消息（dsh-agent-loop preStep()：
   * `messages: claimed`）。0.6.0 起 hasImage 由 installRouter 按「本轮图块中
   * 无转述缓存者非空」计算传入；历史 native 图的跨轮锁存改由按图状态表 +
   * imageFallback（resolveImageFallback）在 pre-step 内完成，decide 不再承担
   * 布尔锁存。（历史锚点：2026-08-19 实机回归——deepseek 适配器序列化全量
   * 会话时图块曾抛 UNSUPPORTED_CONTENT，rc.2 起改原生占位投影。）
   */
  decide(messages: readonly UserMessage[], step: number, hasImageOverride?: boolean): RouteDecision {
    if (this.config.activePreset === null) return { kind: 'keep', reason: 'router off' }
    const text = latestUserText(messages)
    const hasImage = hasImageOverride ?? messagesContainImage(messages)
    // 1. 显式 @指令（最高优先级）：只锁 provider 层，模型=该 provider 枚举序首个可用候选（带图限定多模态）。
    const explicit = explicitProvider(text)
    if (explicit !== null) {
      const pool = this.metas.filter(
        (m) => m.provider === explicit && m.available && (!hasImage || m.modalities.includes('image')),
      )
      if (pool.length === 0) return { kind: 'keep', reason: `explicit @${explicit}: no available candidate` }
      return { kind: 'route', target: { provider: pool[0].provider, model: pool[0].model }, reason: `显式 @${explicit} 指令`, via: 'explicit' }
    }
    // 2. 预设规则链（首条目标可用者生效；目标不可用 → 跳过该规则，降级）。
    const preset = this.config.presets[this.config.activePreset]
    if (preset === undefined) {
      this.log.info(`kimi-router: active preset '${this.config.activePreset}' not found, keeping current route`)
      return { kind: 'keep', reason: 'active preset not found' }
    }
    const flows = flowsOf(this.config)
    const hits = matchingScored(this.config, text, hasImage)
    for (const [index, { rule, score }] of hits.entries()) {
      const target = rule.target
      // 0.8.0 原因升级：携带命中词数；多命中且为排序后首命中时加（特异度最高）
      // 标注（image=∞ 不带）。0.8.x①：标注只属于首命中——首命中目标不可用
      // 降级到后续命中时不得误标（后续命中并非特异度最高）。
      const note = score === Number.POSITIVE_INFINITY
        ? ''
        : ` ${score} 词${hits.length > 1 && index === 0 ? '（特异度最高）' : ''}`
      // 协作流目标（0.6.0，spec §5.1）：flow 存在 + transcribe 型 + visionModel
      // 在候选目录中可用 → flow 决策；任一不满足 → 跳过该规则（与模型目标不可
      // 用的降级语义一致）。v4 存量 flows 为空表，flow 目标恒按「不存在」降级。
      if (isFlowTarget(target)) {
        const flowId = target.flow
        const flow = flows[flowId]
        if (flow === undefined || flow.type !== 'transcribe') continue
        const vision = this.metas.find(
          (m) => m.provider === flow.visionModel.provider && m.model === flow.visionModel.model && m.available,
        )
        if (vision === undefined) continue
        return { kind: 'flow', flowId, flow, reason: `规则「${ruleLabel(rule)}」命中${note}（协作流 ${flowId}）`, via: 'rule' }
      }
      const meta = this.metas.find((m) => m.provider === target.provider && m.model === target.model && m.available)
      if (meta === undefined) continue
      return { kind: 'route', target: { ...target }, reason: `规则「${ruleLabel(rule)}」命中${note}`, via: 'rule' }
    }
    // 3. 打底：未命中 ≠ keep——路由到预设默认模型（0.5.0 语义，spec §5.1）。
    return { kind: 'route', target: { ...preset.default }, reason: `预设「${preset.name}」默认`, via: 'default' }
  }

  /** agent/request 钩子：消费决策，返回替换后的 callConfig。 */
  applyTo(config: LlmCallConfig, decision: RouteDecision | undefined): LlmCallConfig {
    if (decision === undefined || decision.kind !== 'route') return config
    return this.replaceRoute(config, decision.target)
  }

  /**
   * 把一轮请求替换到目标 provider/model，并把 effort 映射到目标支持集
   * （effortForTarget：显式 target.effort 覆盖→支持集判定/不支持剥离；缺省
   * → 继承语义 reasoningEffortFor 支持保留/越级钳制/未知剥离）。路由与图像
   * 护栏共用这一条写路径，保证两条替换路径的 effort 语义一致。
   */
  replaceRoute(config: LlmCallConfig, target: RouteTarget): LlmCallConfig {
    const { reasoningEffort: inherited, ...rest } = config
    const effort = effortForTarget(this.metas, target, inherited, target.effort)
    if (effort !== (target.effort ?? inherited)) {
      this.log.info(`kimi-router: reasoning effort ${target.effort ?? inherited ?? '∅'} → ${effort ?? '∅'} on ${target.provider}/${target.model}`)
    }
    return {
      ...rest,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
      provider: target.provider,
      model: target.model,
    }
  }

  /** Image guard bound to this router's candidates (see applyImageGuard). */
  guardImage(target: RouteTarget, hasImage: boolean): { target: RouteTarget; reason: string } | null {
    const preset = this.config.activePreset === null ? undefined : this.config.presets[this.config.activePreset]
    // intent 只收模型目标：flow 引用非图像护栏意图（0.6.0 既定语义，护栏不改道进流）。
    const intent = preset === undefined ? undefined : [preset.default, ...preset.rules.map((r) => r.target).filter((t): t is RouteTarget => !isFlowTarget(t))]
    return applyImageGuard(target, hasImage, this.metas, intent)
  }
}

/**
 * installRouter 的协作编排依赖（0.6.0，Task 9）。
 * - `images`：按 agent 隔离的按图状态表（替代布尔锁存）。
 * - `transcriber`：转述器（peek 命中成功缓存；text 失败返回 null 且不重打）。
 * - `resolveImages`：从本轮消息提取图块持久引用（生产实现 = extractResolvedImages）。
 * - `onDecision`：决策观测回调；extra.flowId 标记本轮执行过的协作流。
 * - `transcribeTimeoutMs`（I-2，可选）：单次转述调用的有界超时，缺省 30s；
 *   与 pre-step payload.signal 组合成中止信号传入 VisionCaller，视觉端黑洞
 *   不再挂死整轮。测试注入小值。
 */
export interface RouterOrchestrationDeps {
  images: ImageStateStore
  transcriber: Transcriber
  resolveImages: (messages: readonly UserMessage[]) => ResolvedImage[]
  onDecision?: (agent: Agent, decision: RouteDecision, extra?: { flowId?: string }) => void
  transcribeTimeoutMs?: number
}

/** 转述调用默认有界超时（I-2）。 */
const DEFAULT_TRANSCRIBE_TIMEOUT_MS = 30_000

/**
 * pre-step 转述调用的有界信号（I-2）：turn 级 payload.signal 与超时信号组合，
 * 任一触发即中止 VisionCaller。AbortSignal.timeout/any 为 Node 20+ API；
 * 缺席的宿主环境退化为可达的子集（宁缺超时，不缺 turn 中止）。
 */
function boundedSignal(base: AbortSignal | undefined, timeoutMs: number): AbortSignal | undefined {
  const timeout = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
  if (base === undefined) return timeout
  if (timeout === undefined) return base
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([base, timeout]) : base
}

/**
 * 从消息批次提取图块的持久引用（spike S1 实证线形：ImageBlock.attachment =
 * ImageAttachmentRef，提取即得 ref，无需 readImage 读字节）。tool-result 嵌套
 * 图块递归同款提取；无 attachmentId 的图块（非 rc.2 线形）忽略。
 */
export function extractResolvedImages(messages: readonly UserMessage[]): ResolvedImage[] {
  const out: ResolvedImage[] = []
  const walk = (blocks: readonly ContentBlock[]): void => {
    for (const block of blocks) {
      if (block.type === 'image') {
        const ref = (block as ImageBlock).attachment
        if (typeof ref?.attachmentId === 'string') out.push({ attachmentId: ref.attachmentId, ref })
      } else if (block.type === 'tool-result') {
        walk((block as ToolResultBlock).content)
      }
    }
  }
  for (const message of messages) walk(message.content)
  return out
}

/** 目标能力的档位查询缝（M6）：metas 池注入，供「visionModel.effort 不支持则降级」。 */
export type EffortResolver = (target: RouteTarget) => string[] | undefined

/**
 * 生产 VisionCaller（Task 9 组装，S1 实证链路）：ctx.llm.stream 直调视觉模型，
 * 图块按持久引用线形构造 `{ type:'image', attachment: ref }`（字节解析由适配器
 * 完成）；text-delta 手工累计成转述文字；finish reason.kind 为 error/aborted
 * 时抛错（Transcriber 记入失败集，同图不重打）。usage  chunk 随流穿过不累计
 * （S5 账单复核另案）。0.8.0（D3）：visionModel.effort 经 EffortResolver
 * 支持集判定后显式下发，不支持/未配置不携带（Ruling 2 的 adapter 默认语义
 * 保持）。I-2：调用方 signal 透传进 GenerateOptions——pre-step 中止/有界超时
 * 由此到达视觉端，abort 的流以 finish aborted（或 reject）收尾，视同转述失败。
 */
export function createStreamVisionCaller(ctx: Context, resolveEfforts: EffortResolver): VisionCaller {
  return async (target, prompt, images, signal) => {
    const content = [
      { type: 'text', text: prompt },
      ...images.map((img) => ({ type: 'image', attachment: img.ref })),
    ] as unknown as ContentBlock[]
    const options: GenerateOptions = {
      provider: target.provider,
      model: target.model,
      messages: [{ role: 'user', content }] as unknown as Message[],
      ...(signal === undefined ? {} : { signal }),
    }
    // 0.8.0 D3：visionModel.effort 经支持集判定后显式下发；不支持/未配置 →
    // 不携带（Ruling 2 的 adapter 默认语义保持）。
    if (target.effort !== undefined) {
      const supported = resolveEfforts(target)
      if (supported !== undefined && supported.includes(target.effort)) {
        options.reasoningEffort = target.effort as ReasoningEffortId
      }
    }
    let text = ''
    for await (const chunk of ctx.llm.stream(options)) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
      } else if (chunk.type === 'finish') {
        const reason = chunk.reason
        if (reason.kind === 'error' || reason.kind === 'aborted') {
          throw new Error(`vision transcribe ${reason.kind}: ${reason.failure.message} (${reason.failure.code})`)
        }
      }
    }
    return text
  }
}

/** 块级替换结果；changed=false 时 out 为原引用（零分配直放）。 */
interface Rewrite<T> { out: T; changed: boolean }

/**
 * 把命中转述缓存的图块替换为 `{ type:'text', text: 转述文字 }`；无缓存图块保留
 * （rc.2 原生占位投影兜底）；tool-result 嵌套图块递归同款处理。绝不原地
 * mutation——loop 请求深冻结（dsh-llm deepFreeze），一律构造新块/新数组。
 */
function rewriteBlocksForText(
  blocks: readonly ContentBlock[],
  peek: (attachmentId: string) => string | undefined,
): Rewrite<ContentBlock[]> {
  let out: ContentBlock[] | null = null
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    let next = block
    if (block.type === 'image') {
      const ref = (block as ImageBlock).attachment
      const text = typeof ref?.attachmentId === 'string' ? peek(ref.attachmentId) : undefined
      if (text !== undefined) next = { type: 'text', text }
    } else if (block.type === 'tool-result') {
      const inner = rewriteBlocksForText((block as ToolResultBlock).content, peek)
      if (inner.changed) next = { ...block, content: inner.out } as ContentBlock
    }
    if (next !== block) {
      if (out === null) out = blocks.slice(0, i) as ContentBlock[]
      out.push(next)
    } else if (out !== null) {
      out.push(block)
    }
  }
  return out === null ? { out: blocks as ContentBlock[], changed: false } : { out, changed: true }
}

/** 消息级同款替换（新消息数组 + 新消息对象；无命中时原引用返回）。 */
function rewriteMessagesForText(
  messages: readonly Message[],
  peek: (attachmentId: string) => string | undefined,
): Rewrite<Message[]> {
  let out: Message[] | null = null
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    const inner = rewriteBlocksForText(message.content, peek)
    if (inner.changed) {
      if (out === null) out = messages.slice(0, i)
      out.push({ ...message, content: inner.out })
    } else if (out !== null) {
      out.push(message)
    }
  }
  return out === null ? { out: messages as Message[], changed: false } : { out, changed: true }
}

/**
 * latchTarget = 本轮决策的「有效视觉候选」（brief 三取值的统一实现）：
 * flow 决策 → flow.visionModel；route 决策 → 以 hasImage=true 过一遍图像护栏
 * 的改道结果（未改道即该目标本身——规则命中的多模态模型目标 / 预设默认即
 * 多模态时均在此落地）；keep → undefined（无有效目标可记）。护栏调整使
 * latchTarget 恒等于本轮原生作答的实际视觉目标，与 0.5.0 后续轮 guard 重选的
 * 结果逐轮一致（目录读不到 modalities 的目标按 84773e2 宽容条款直取该目标）。
 */
function effectiveVisionTarget(router: KimiRouter, decision: RouteDecision): RouteTarget | undefined {
  if (decision.kind === 'flow') return { ...decision.flow.visionModel }
  if (decision.kind !== 'route') return undefined
  const guard = router.guardImage(decision.target, true)
  return guard === null ? { ...decision.target } : guard.target
}

/**
 * 把路由器挂到 agent 生命周期：pre-step 分类入槽，request 消费出槽。
 * 0.6.0（Task 9）pre-step 执行序（step===1，spec §5.1/5.2/5.6）：
 *   1. resolveImages 提取本轮图块（持久引用，无需读字节）
 *   2. 新图登记状态表 native（latchTarget 决策后补记——mark 整体替换条目）
 *   3. 未转述图 = 本轮图块无转述缓存者；hasImage = 其非空（替代布尔锁存）
 *   4. decide
 *   5. flow 决策 → eager 转述：全成 → 标 transcribed + 以 hasImage=false 重跑
 *      decide；有败 → latch-image 败图保持 native 且本轮落 flow.visionModel，
 *      blind 则标 blind 继续
 *   6. 非 flow 终决策 + text-only 目标 + native 历史 → resolveImageFallback：
 *      latch 改道 / blind 不动 / lazy 先补转述再放行
 *   7. 槽位 + onDecision（extra.flowId 标记本轮执行过的流）
 * 另注册 llm/stream 智能投影拦截器（S4c）。@returns disposer。
 */
export function installRouter(ctx: Context, router: KimiRouter, deps: RouterOrchestrationDeps): () => void {
  const { images, transcriber, resolveImages, onDecision, transcribeTimeoutMs } = deps
  const slots = new WeakMap<Agent, { decision: RouteDecision; hasImage: boolean }>()
  // attachmentId → ResolvedImage：跨轮回取 lazy 转述所需的持久引用。图不可变、
  // attachmentId 全局唯一，进程内一致；插件重挂载前进入会话的历史图无 ref 可
  // 查，按转述失败同等处置（failurePolicy 兜底）。
  const imageRefs = new Map<string, ResolvedImage>()
  const peek = (attachmentId: string): string | undefined => transcriber.peek(attachmentId)

  const activePreset = (): RouterPreset | undefined => {
    const config = router.config
    if (config.activePreset === null) return undefined
    return config.presets[config.activePreset]
  }

  return ctx.effect(() => {
    // 2026-08-23 回归修复：全部监听器 {prepend:true}——宿主 rc.2
    // dsh-host-apiproxy 在 agent 创建时安装 installModelSelection（agent
    // 作用域 agent/request 覆盖监听器，selectionFor→installModelSelection，
    // lib/index.js:1692-1715）。cordis waterfall 结果 = 最外层监听器返回值；
    // 本插件配置变更重挂载（applyConfig → mountRouter → 注销+重注册）会把
    // 监听器 push 到链尾（内层），路由返回值被外层覆盖丢弃（实机：
    // 面板决策=vision-exp 而 assistant/message.source 恒 session 模型）。
    // prepend 保证无论重挂载多少次，kimi-tide 恒为最外层，路由返回值生效；
    // 宿主 selection.current 回退链读取会话 request/header，会跟随路由结果
    // 自愈（下一轮 selection 即上一轮路由目标）。
    const disposePre = ctx.on('agent/pre-step', async (payload, next) => {
      const result = await next()
      // Decide once per turn, on its FIRST model step. Verified contract
      // (dsh-agent-loop rc.6/rc.7, turn()): `step = phase.step + 1` is
      // computed before preStep() and every turn starts at phase.step 0, so
      // the first step of every turn arrives as payload.step === 1 — never 0
      // (the original === 0 gate never matched and idled the whole router).
      // Tool-loop steps (step > 1) keep the logged header config, so the
      // model never switches mid-loop.
      if (payload.step !== 1) return result
      const agent = payload.agent
      // I-2：转述调用的有界信号 = turn 级中止 ⊕ 超时（默认 30s，deps 可注入小值）
      const transcribeSignal = boundedSignal(payload.signal, transcribeTimeoutMs ?? DEFAULT_TRANSCRIBE_TIMEOUT_MS)
      // 1. 本轮图块提取
      const batch = resolveImages(payload.messages)
      // 2. 新图登记状态表（native；latchTarget 待决策后按有效视觉候选补记）
      const fresh: ResolvedImage[] = []
      for (const img of batch) {
        imageRefs.set(img.attachmentId, img)
        if (images.get(agent, img.attachmentId) === undefined) {
          images.mark(agent, img.attachmentId, 'native')
          fresh.push(img)
        }
      }
      // 2.5 转述缓存逐出对账（评审修复 2026-08-23）：进程级 LRU 逐出后
      // transcribed 条目的投影 peek 落空（图块会原样进 text-only 请求）。
      // 降级回 native，由 lazy/latch 既有回退路径重新接管（重转述或改道）。
      for (const id of images.demoteUnbackedTranscribed(agent, (entryId) => peek(entryId) !== undefined)) {
        ctx.logger?.info?.(`kimi-router: 转述缓存已逐出 attachmentId=${id}，状态降级回 native（按 imageFallback 重处理）`)
      }
      // 3. 未转述图（本轮）→ hasImage
      const untranscribed = batch.filter((img) => peek(img.attachmentId) === undefined)
      let hasImage = untranscribed.length > 0
      // 4. 决策
      let decision = router.decide(payload.messages, payload.step, hasImage)
      let flowId: string | undefined
      const latchTarget = effectiveVisionTarget(router, decision)
      // 5. eager 转述（规则目标 = transcribe 流）
      if (decision.kind === 'flow') {
        flowId = decision.flowId
        const flow = decision.flow
        // 并发转述（评审修复 2026-08-23）：图间无依赖，串行 await 会把视觉调用
        // 延迟按图数叠加在 pre-step 这个整轮阻塞点上。Transcriber 的失败集/LRU
        // 均按 attachmentId 隔离，text() 内部不抛（null=失败），Promise.all
        // 无拒绝短路风险；结果按提交序回收，标记/日志语义与串行一致。
        const texts = await Promise.all(untranscribed.map((img) => transcriber.text(flow, img, transcribeSignal)))
        const failed: ResolvedImage[] = []
        for (let i = 0; i < untranscribed.length; i++) {
          const img = untranscribed[i]
          const text = texts[i]
          if (text === null) failed.push(img)
          // latchTarget 随 transcribed 标记保留（评审修复）：缓存逐出降级回
          // native 时条目自带改道目标（latch 不回溯更早条目）。
          else images.mark(agent, img.attachmentId, 'transcribed', images.get(agent, img.attachmentId)?.latchTarget)
          ctx.logger?.info?.(`kimi-router: flow:${flowId} 转述 attachmentId=${img.attachmentId} ${text === null ? '失败' : '成功'}`)
        }
        if (failed.length === 0) {
          hasImage = false
          decision = router.decide(payload.messages, payload.step, false)
        } else if (flow.failurePolicy === 'latch-image') {
          decision = {
            kind: 'route',
            target: { ...flow.visionModel },
            reason: `flow:${flowId} 转述失败（latch-image）→ 原生视觉作答`,
            via: 'rule',
          }
          hasImage = true
        } else {
          for (const img of failed) images.mark(agent, img.attachmentId, 'blind')
          hasImage = false
          decision = router.decide(payload.messages, payload.step, false)
        }
      }
      // 仍 native 的本轮新图补记 latchTarget（后续轮 latch 改道的目标）
      if (latchTarget !== undefined) {
        for (const img of fresh) {
          if (images.get(agent, img.attachmentId)?.state === 'native') {
            images.mark(agent, img.attachmentId, 'native', latchTarget)
          }
        }
      }
      // 6. imageFallback：终决策 route + text-only 目标 + native 历史
      if (decision.kind === 'route') {
        const routeTarget = decision.target
        const targetMeta = router.metas.find(
          (m) => m.provider === routeTarget.provider && m.model === routeTarget.model,
        )
        // 目录读不到的目标保持宽容（84773e2 既有条款），不套用 fallback。
        if (targetMeta !== undefined && !targetMeta.modalities.includes('image')) {
          const preset = activePreset()
          const native = images.native(agent)
          const fallback = preset === undefined ? null : resolveImageFallback(preset, flowsOf(router.config), native)
          if (fallback?.kind === 'latch') {
            decision = {
              kind: 'route',
              target: { ...fallback.target },
              reason: `带图锁存改道（${decision.reason}）`,
              via: 'rule',
            }
          } else if (fallback?.kind === 'lazy') {
            flowId = fallback.flowId
            const flow = fallback.flow
            // 并发补转述（评审修复 2026-08-23，同 eager 循环的并发依据）：
            // imageRefs 查不到 ref 的图视同失败（插件重挂载前的历史图）。
            const texts = await Promise.all(native.map(([id]) => {
              const img = imageRefs.get(id)
              return img === undefined ? Promise.resolve(null) : transcriber.text(flow, img, transcribeSignal)
            }))
            const failed: string[] = []
            for (let i = 0; i < native.length; i++) {
              const id = native[i][0]
              const text = texts[i]
              if (text === null) failed.push(id)
              // latchTarget 保留（同 eager 循环，评审修复）
              else images.mark(agent, id, 'transcribed', native[i][1].latchTarget)
              ctx.logger?.info?.(`kimi-router: flow:${flowId} lazy 转述 attachmentId=${id} ${text === null ? '失败' : '成功'}`)
            }
            if (failed.length > 0) {
              if (flow.failurePolicy === 'latch-image') {
                // 败图保持 native，本轮落 flow.visionModel 原生视觉作答
                decision = {
                  kind: 'route',
                  target: { ...flow.visionModel },
                  reason: `flow:${flowId} lazy 转述失败（latch-image）→ 原生视觉作答`,
                  via: 'rule',
                }
              } else {
                for (const id of failed) images.mark(agent, id, 'blind')
              }
            }
            // 全成（或 blind 放行）：decision 不变——放行文本目标，投影缝供转述文字
          }
          // blind → 不动（rc.2 原生占位投影兜底）
        }
      }
      // 7. 槽位 + 观测回调
      slots.set(agent, { decision, hasImage })
      onDecision?.(agent, decision, flowId === undefined ? undefined : { flowId })
      return result
    }, { prepend: true })
    const disposeRequest = ctx.on('agent/request', async (payload, next) => {
      const resolved = await next()
      const slot = slots.get(payload.agent)
      if (slot === undefined) return resolved
      slots.delete(payload.agent)
      let replaced = router.applyTo(resolved, slot.decision)
      // Image guard runs AFTER routing: an image-bearing step must never hit
      // a text-only route (typically the deepseek primary), whether it came
      // from a route decision or from the session's base model selection.
      // 0.6.0：护栏输入 = 槽位 hasImage（本轮未转述图语义）——flow 已消费的图
      // 不触发（hasImage 已 false）；replaceRoute/effort 映射逻辑不动。
      const guard = router.guardImage({ provider: replaced.provider, model: replaced.model }, slot.hasImage)
      if (guard !== null) {
        replaced = router.replaceRoute(replaced, guard.target)
        ctx.logger?.info?.(`kimi-router: ${guard.reason} → ${replaced.provider}/${replaced.model}`)
        return replaced
      }
      if (replaced !== resolved) {
        const label = slot.decision.kind === 'route'
          ? slot.decision.reason
          : slot.decision.kind === 'flow' ? `flow:${slot.decision.flowId}` : 'kept'
        ctx.logger?.info?.(`kimi-router: agent request → ${replaced.provider}/${replaced.model} (${label})`)
      }
      return replaced
    }, { prepend: true })
    // llm/stream 智能投影拦截器（S4c，spike 实证生产范式）：仅当 metas 查得目标
    // 存在且 modalities 不含 image（text-only 目标）时介入，视觉目标与目录读不
    // 到的目标直放。cordis waterfall 的 next() 固定回放原始载荷（cordis
    // lib:317-325），不支持 next(改后载荷)——改写须经重入守卫 + 自调
    // ctx.llm.stream(opts2) 短路。守卫同时保证转述自身的 VisionCaller 调用不递归
    // （其目标为视觉模型且图块彼时无缓存，双重不命中）。
    const inFlight = new WeakSet<object>()
    const disposeStream = ctx.on('llm/stream', (options, next) => {
      if (inFlight.has(options)) return next()
      const meta = router.metas.find((m) => m.provider === options.provider && m.model === options.model)
      if (meta === undefined || meta.modalities.includes('image')) return next()
      const rewritten = rewriteMessagesForText(options.messages, peek)
      if (!rewritten.changed) return next()
      const opts2 = { ...options, messages: rewritten.out }
      inFlight.add(opts2)
      return ctx.llm.stream(opts2)
    }, { prepend: true })
    // Host prompt pre-check deferral (see canClaimImageAdmission): the host
    // rejects image prompts whose current model selection is text-only
    // BEFORE the loop runs; claim the image here so the guard gets its turn.
    // Cordis `serial` bail semantics: a truthy return claims; undefined lets
    // the host's rejection through.
    const disposeAdmission = ctx.on('agent/image-admission', () => {
      if (!canClaimImageAdmission(router.config, router.metas)) return undefined
      ctx.logger?.info?.('kimi-router: claimed image admission (premium multimodal)')
      return true
    }, { prepend: true })
    return () => {
      disposePre()
      disposeRequest()
      disposeStream()
      disposeAdmission()
    }
  })
}
