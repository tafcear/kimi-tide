/**
 * kimi-tide: automatic model router — 月汐规则驱动路由的决策核心（0.5.0）。
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
 */
import type { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type {
  CandidateMeta, CollaborationFlow, RouteTarget, RouterConfigV4, RouterConfigV5, RouterPreset, TranscribeFlow,
} from './config.js'
import { isFlowTarget } from './config.js'
import type { ImageStateEntry } from './image-state.js'
import { explicitProvider, latestUserText, matchingRules, messagesContainImage, ruleLabel } from './rules.js'
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
 * 逐字节一致；settings/index 面的全量 V5 迁移属后续任务。
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
   * `hasImageOverride`（会话锁存）：agent/pre-step 的 payload.messages 只携带
   * 本轮 claimed 消息（dsh-agent-loop preStep()：`messages: claimed`），而 deepseek
   * 适配器序列化**全量会话**时对任一图片块抛 UNSUPPORTED_CONTENT
   * （dsh-llm-deepseek serializeMessages → assertTextOnly）——一旦图片消息提交进
   * 历史，后续纯文本轮也必须按 vision 步骤处理，否则会选中文本-only 候选导致
   * 整轮失败（2026-08-19 实机回归：turn 3 带图走 k3 后，turn 4 纯文本轮在
   * deepseek-v4-flash 上抛 UNSUPPORTED_CONTENT）。
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
    for (const rule of matchingRules(this.config, text, hasImage)) {
      const target = rule.target
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
        return { kind: 'flow', flowId, flow, reason: `规则「${ruleLabel(rule)}」命中（协作流 ${flowId}）`, via: 'rule' }
      }
      const meta = this.metas.find((m) => m.provider === target.provider && m.model === target.model && m.available)
      if (meta === undefined) continue
      return { kind: 'route', target: { ...target }, reason: `规则「${ruleLabel(rule)}」命中`, via: 'rule' }
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
   * 把一轮请求替换到目标 provider/model，并把会话级推理等级映射到目标支持集
   * （reasoningEffortFor：支持保留 / 越级钳制 / 未知剥离）。路由与图像护栏共用
   * 这一条写路径，保证两条替换路径的 effort 语义一致。
   */
  replaceRoute(config: LlmCallConfig, target: RouteTarget): LlmCallConfig {
    const { reasoningEffort: inherited, ...rest } = config
    const effort = reasoningEffortFor(this.metas, target, inherited)
    if (effort !== inherited) {
      this.log.info(`kimi-router: reasoning effort ${inherited ?? '∅'} → ${effort ?? '∅'} on ${target.provider}/${target.model}`)
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
 * 把路由器挂到 agent 生命周期：pre-step 分类入槽，request 消费出槽。
 * @returns disposer。
 */
export function installRouter(ctx: Context, router: KimiRouter, onDecision?: (agent: Agent, decision: RouteDecision) => void): () => void {
  const slots = new WeakMap<Agent, { decision: RouteDecision; hasImage: boolean }>()
  // 会话图片锁存（2026-08-19 实机回归）：agent/pre-step 的 payload.messages 只含
  // 本轮 claimed 消息，但图片消息一旦提交进会话历史，deepseek 适配器会在序列化
  // 全量会话时抛 UNSUPPORTED_CONTENT（dsh-llm-deepseek serializeMessages →
  // assertTextOnly）——因此任何一轮带图之后，本会话所有后续轮次都必须留在多模态
  // 候选上（图片仍在上下文中，纯文本适配器物理上无法序列化它）。锁存按 agent
  // 隔离：子代理拥有独立上下文，不继承父会话的图片历史，正常按文本路由。
  const imageSeen = new WeakMap<Agent, boolean>()
  return ctx.effect(() => {
    const disposePre = ctx.on('agent/pre-step', async (payload, next) => {
      const result = await next()
      // Decide once per turn, on its FIRST model step. Verified contract
      // (dsh-agent-loop rc.6/rc.7, turn()): `step = phase.step + 1` is
      // computed before preStep() and every turn starts at phase.step 0, so
      // the first step of every turn arrives as payload.step === 1 — never 0
      // (the original === 0 gate never matched and idled the whole router).
      // Tool-loop steps (step > 1) keep the logged header config, so the
      // model never switches mid-loop.
      if (payload.step === 1) {
        const hasImage = messagesContainImage(payload.messages) || imageSeen.get(payload.agent) === true
        if (hasImage) imageSeen.set(payload.agent, true)
        const decision = router.decide(payload.messages, payload.step, hasImage)
        slots.set(payload.agent, { decision, hasImage })
        onDecision?.(payload.agent, decision)
      }
      return result
    })
    const disposeRequest = ctx.on('agent/request', async (payload, next) => {
      const resolved = await next()
      const slot = slots.get(payload.agent)
      if (slot === undefined) return resolved
      slots.delete(payload.agent)
      let replaced = router.applyTo(resolved, slot.decision)
      // Image guard runs AFTER routing: an image-bearing step must never hit
      // a text-only route (typically the deepseek primary), whether it came
      // from a route decision or from the session's base model selection.
      const guard = router.guardImage({ provider: replaced.provider, model: replaced.model }, slot.hasImage)
      if (guard !== null) {
        replaced = router.replaceRoute(replaced, guard.target)
        ctx.logger?.info?.(`kimi-router: ${guard.reason} → ${replaced.provider}/${replaced.model}`)
        return replaced
      }
      if (replaced !== resolved) {
        ctx.logger?.info?.(`kimi-router: agent request → ${replaced.provider}/${replaced.model} (${slot.decision.kind === 'route' ? slot.decision.reason : 'kept'})`)
      }
      return replaced
    })
    // Host prompt pre-check deferral (see canClaimImageAdmission): the host
    // rejects image prompts whose current model selection is text-only
    // BEFORE the loop runs; claim the image here so the guard gets its turn.
    // Cordis `serial` bail semantics: a truthy return claims; undefined lets
    // the host's rejection through.
    const disposeAdmission = ctx.on('agent/image-admission', () => {
      if (!canClaimImageAdmission(router.config, router.metas)) return undefined
      ctx.logger?.info?.('kimi-router: claimed image admission (premium multimodal)')
      return true
    })
    return () => {
      disposePre()
      disposeRequest()
      disposeAdmission()
    }
  })
}
