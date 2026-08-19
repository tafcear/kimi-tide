/**
 * kimi-tide: automatic model router — 月汐双模型互补的决策核心。
 *
 * Two strategies over the official agent lifecycle:
 *   - `cost`       性价比：默认走便宜主力（DeepSeek），仅在满足升级条件
 *                  （显式指令 / 长上下文 / 命中规则）且未超预算时用 Kimi。
 *   - `capability` 能力最优：按任务类型路由——审查类任务与超长上下文走
 *                  Kimi，工具密集与日常执行走 DeepSeek。
 *
 * 事件流（DSH 官方机制）：
 *   agent/pre-step（携带本步消息）→ classify() 计算决策存入 per-agent 槽位
 *   agent/request（携带该步的 callConfig）→ 消费槽位，返回替换路由
 */
import type { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { CandidateMeta, Dim, RouteTarget, RouterConfigV2 } from './config.js'
import { classify, explicitProvider, type ClassifyResult } from './classify.js'
import { scoreCandidate, selectCandidate } from './scoring.js'
import { scoreFor } from './scores.js'

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

export type { RouteTarget }

/**
 * v1 (0.2.x) router config shape. Retained as the on-disk/panel schema while
 * the v2 engine is being wired in: settings.ts, commands.ts, types.ts,
 * index.ts and the wiring tests still operate on this shape; the v2 engine
 * itself is configured with RouterConfigV2 (config.ts).
 */
export interface RouterConfigV1 {
  /** off 关闭（默认，向后兼容）；cost 性价比；capability 能力最优。 */
  mode: 'off' | 'cost' | 'capability'
  /** 默认主力路由（便宜/快）。 */
  primary: RouteTarget
  /** Kimi 路由（贵/强）。 */
  premium: RouteTarget
  /** 超长上下文的 Kimi 路由（capability 模式可换 1M 窗模型）。 */
  premiumLong?: RouteTarget
  /** cost 模式升级条件（任一命中即升级，受预算约束）。 */
  escalateWhen?: {
    /** 用户显式 @kimi 指令。 */
    explicit?: boolean
    /** 估算 token 阈值。 */
    estimatedTokensGt?: number
    /** 关键词规则。 */
    patterns?: string[]
  }
  /** cost 模式 Kimi 调用占比上限（滑动窗口内，0-1）。 */
  premiumBudget?: number
  /** capability 模式规则表（顺序匹配，首个命中生效）。 */
  rules?: { match: MatchRule; route: RouteTarget }[]
  /** 估算 token 的字符折算比率（token ≈ chars / ratio）。 */
  charsPerToken?: number
  /** 预算滑动窗口大小（决策次数）。 */
  budgetWindow?: number
  /**
   * Providers that cannot accept image input. Defaults to the primary
   * provider only — the real capability matrix (pi-ai catalog, verified
   * 2026-08-18) is deepseek-v4-* text-only, Kimi k3 family multimodal.
   */
  textOnlyProviders?: string[]
}

export interface MatchRule {
  /** 正则关键词（对最新用户消息全文匹配）。 */
  patterns?: string[]
  /** 消息文本估算 token 数超过该值时命中（中英混合保守估算）。 */
  estimatedTokensGt?: number
}

/**
 * Back-compat alias (0.2.x name) for the v1 router config shape. New code
 * should use RouterConfigV1 (v1 panel/settings shape) or RouterConfigV2
 * (0.3.0 engine config, config.ts).
 */
export type RouterConfig = RouterConfigV1

export type RouteDecision =
  | { kind: 'route'; target: RouteTarget; reason: string; scoreDelta: number | null }
  | { kind: 'keep'; reason: string }

/** True when any user message in the batch carries an image block. */
export function messagesContainImage(messages: readonly UserMessage[]): boolean {
  return messages.some(
    (m) => m.role === 'user' && m.content.some((b) => (b as { type?: string }).type === 'image'),
  )
}

/**
 * Providers that cannot accept image input, derived from the candidate
 * metadata modalities (0.3.0: replaces the hard-coded provider set). A
 * v1-style override (`textOnlyProviders`) still wins when supplied; without
 * metas the legacy default (primary provider only) applies.
 */
export function textOnlyProviders(
  config: RouterConfigV1,
  metas?: readonly CandidateMeta[],
): Set<string> {
  if (config.textOnlyProviders !== undefined) return new Set(config.textOnlyProviders)
  if (metas !== undefined) {
    // Modality-based and identity-independent: a provider is text-only when
    // NONE of its candidate metas can carry an image. Keying on the v1
    // primary identity inverts under the v2 sidecar shape, where the default
    // can be kimi-tide/k3 while the session base model is a deepseek candidate
    // (2026-08-19 regression: image steps stayed on deepseek and the adapter
    // threw UNSUPPORTED_CONTENT because the guard thought deepseek multimodal).
    const imageCapable = new Set(metas.filter((m) => m.modalities.includes('image')).map((m) => m.provider))
    const providers = new Set(metas.map((m) => m.provider))
    return new Set([...providers].filter((p) => !imageCapable.has(p)))
  }
  return new Set([config.primary.provider])
}

/**
 * Candidates that can serve an image under this config (modality-driven).
 * An explicit textOnlyProviders override removes providers from the pool.
 * When enumeration degraded the whole pool to text-only, the configured
 * premium route is trusted as a multimodal rail ONLY when the metadata does
 * not itself mark its provider text-only — a premium on a genuinely
 * text-only provider must never be picked (anti-ping-pong), and a fully
 * degraded pool means the host's friendly rejection applies instead of an
 * unverifiable reroute.
 */
function imageCapablePicks(config: RouterConfigV1, metas?: readonly CandidateMeta[]): CandidateMeta[] {
  const override = config.textOnlyProviders
  let pool = (metas ?? []).filter((m) => m.modalities.includes('image') && m.available)
  if (override !== undefined) pool = pool.filter((m) => !override.includes(m.provider))
  if (pool.length === 0 && override === undefined) {
    const premium = config.premium
    if (premium !== undefined && premium.provider !== config.primary.provider) {
      const metaTextOnly =
        metas === undefined
          ? new Set<string>()
          : new Set(metas.filter((m) => !m.modalities.includes('image')).map((m) => m.provider))
      if (!metaTextOnly.has(premium.provider)) {
        pool = [{ ...premium, modalities: ['text', 'image'], costTier: 'mid', available: true }]
      }
    }
  }
  return pool
}

/**
 * Image guard: when the step carries an image and the resolved target is a
 * text-only route, swap to a multimodal candidate instead of letting the
 * adapter throw UNSUPPORTED_CONTENT mid-turn. The guard is a correctness
 * rail, not a budget decision: guard-driven escalations are not recorded in
 * the premium budget window. The reroute target prefers the configured
 * premium route, then the primary (v2 default) route, then any multimodal
 * candidate — all by modality, never by role identity.
 */
export function applyImageGuard(
  target: RouteTarget,
  config: RouterConfigV1,
  hasImage: boolean,
  metas?: readonly CandidateMeta[],
): { target: RouteTarget; reason: string } | null {
  if (!hasImage) return null
  const textOnly = textOnlyProviders(config, metas)
  if (!textOnly.has(target.provider)) return null
  const picks = imageCapablePicks(config, metas)
  if (picks.length === 0) return null
  const pick =
    picks.find((m) => m.provider === config.premium?.provider && m.model === config.premium?.model) ??
    picks.find((m) => m.provider === config.primary.provider && m.model === config.primary.model) ??
    picks.find((m) => m.provider === config.premium?.provider) ??
    picks[0]
  return { target: { provider: pick.provider, model: pick.model }, reason: 'image input: rerouted to multimodal candidate' }
}

/**
 * Whether this router can claim an image prompt at host admission time.
 *
 * The host image-admission gate (dsh-host-apiproxy prompt RPC) rejects image
 * prompts whose CURRENT model selection is text-only BEFORE the agent loop
 * runs — on a fresh session the default selection is the text-only base
 * model, so the per-step image guard never gets a chance. The host defers
 * via the agent-scoped serial event `agent/image-admission`: a listener
 * returning a truthy value claims the message will be rerouted. Claim only
 * when this router is active AND some candidate can actually serve the image
 * (mirror of applyImageGuard's bail rule) — otherwise the host's friendly
 * rejection stays in charge.
 */
export function canClaimImageAdmission(config: RouterConfigV1, metas?: readonly CandidateMeta[]): boolean {
  if (config.mode === 'off') return false
  return imageCapablePicks(config, metas).length > 0
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

/** 中英混合保守估算：token ≈ ceil(chars / ratio)，ratio 默认 2。 */
export function estimateTokens(text: string, charsPerToken = 2): number {
  return Math.ceil(text.length / Math.max(1, charsPerToken))
}

/** 组合消息批次（本步消息 + 可选历史）的总估算。 */
export function estimateContextTokens(messages: readonly UserMessage[], charsPerToken = 2): number {
  let chars = 0
  for (const message of messages) {
    for (const block of message.content) {
      const b = block as { type?: string; text?: unknown }
      if (b?.type === 'text' && typeof b.text === 'string') chars += b.text.length
    }
  }
  return Math.ceil(chars / Math.max(1, charsPerToken))
}

export function matchesPatterns(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern))
}

export interface RouterLog {
  info: (message: string) => void
}

/**
 * Scoring-based router engine (0.3.0). The rule-table decide() of 0.2.x is
 * replaced by: classify(messages) → explicit @provider forced pick →
 * selectCandidate over capability scores, with the premium budget window
 * carried over from 0.2.x (cost mode).
 *
 * The 0.2.x construction shape `new KimiRouter(v1Config, log)` is still
 * accepted (production wiring / panel settings are v1-shaped until the v2
 * sidecar lands): the v1 config is bridged to RouterConfigV2 with candidate
 * metadata derived from the real capability matrix (pi-ai catalog,
 * 2026-08-18: deepseek-v4-* text-only/cheap, Kimi k3 family multimodal/mid).
 */
export class KimiRouter {
  private readonly budgetHistory: string[] = []

  readonly config: RouterConfigV2
  /** Candidate metadata (modalities/costTier/availability); drives scoring and the image guard. */
  readonly metas: CandidateMeta[]
  private readonly log: RouterLog
  /** Present only when constructed with the legacy v1 config shape. */
  private readonly v1Config?: RouterConfigV1

  constructor(config: RouterConfigV2, metas: CandidateMeta[], log: RouterLog)
  constructor(config: RouterConfigV1, log: RouterLog)
  constructor(config: RouterConfigV2 | RouterConfigV1, metasOrLog: CandidateMeta[] | RouterLog, log?: RouterLog) {
    if (Array.isArray(metasOrLog)) {
      this.config = config as RouterConfigV2
      this.metas = metasOrLog
      this.log = log as RouterLog
    } else {
      const v1 = config as RouterConfigV1
      this.v1Config = v1
      this.config = legacyConfigToV2(v1)
      this.metas = legacyMetasFromConfig(v1)
      this.log = metasOrLog
    }
  }

  /**
   * 基于本步消息批次做决策；显式 @provider 指令直接生效（先 explicit 再评分）。
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
    if (this.config.mode === 'off') return { kind: 'keep', reason: 'router off' }
    const text = latestUserText(messages)
    const hasImage = hasImageOverride ?? messagesContainImage(messages)

    // 1. 显式指令：最高优先级——在该 provider 的候选里选最优（available 且
    //    带图时模态匹配），无可用候选才保持当前路由。
    const explicit = explicitProvider(text)
    if (explicit !== null) {
      const pool = this.metas.filter(
        (m) => m.provider === explicit && m.available && (!hasImage || m.modalities.includes('image')),
      )
      if (pool.length === 0) {
        return { kind: 'keep', reason: `explicit @${explicit}: no available candidate` }
      }
      const v1 = this.v1Config
      if (v1 !== undefined) {
        // Legacy-constructed routers keep the v1 explicit semantics: prefer
        // the configured premium, then premiumLong (migration tests pin this).
        const preferred = [v1.premium, v1.premiumLong]
          .filter((t): t is NonNullable<typeof t> => t !== undefined)
          .filter((t) => t.provider === explicit && (!hasImage || pool.some((m) => m.model === t.model)))
        const target = preferred[0] ?? { provider: pool[0].provider, model: pool[0].model }
        // Explicit picks are user-forced, not score comparisons: no delta.
        return { kind: 'route', target, reason: `explicit @${explicit} directive`, scoreDelta: null }
      }
      // v2: pick the provider's best candidate by the same scoring formula as
      // selectCandidate (weighted capability score minus lambda × cost tier).
      const weights = classify(messages, {
        charsPerToken: this.config.charsPerToken,
        patterns: this.config.classify.patterns,
      }).weights
      const best = pool
        .map((m) => ({ m, s: scoreCandidate(m, weights, this.config.lambda, (x) => scoreFor(this.config, x)) }))
        .sort((a, b) => b.s - a.s)[0]
      // Explicit picks are user-forced, not score comparisons: no delta.
      return { kind: 'route', target: { provider: best.m.provider, model: best.m.model }, reason: `explicit @${explicit} directive`, scoreDelta: null }
    }

    // 2. 评分选择：classify → selectCandidate 已覆盖 keep 语义（best==default /
    //    eligible 空 / cost 阈值与预算不足 → null → keep）。
    const c = classify(messages, { charsPerToken: this.config.charsPerToken, patterns: this.config.classify.patterns })
    // 会话锁存：当前批次无图但历史含图（hasImageOverride）时，强制按 vision 评分
    // （vision 权重 × 多模态候选的 vision 分），让 selectCandidate 的 eligible
    // 过滤与评分都只会落在能承接图片块的候选上。
    if (hasImage && !c.vision) {
      c.vision = true
      c.weights.vision = 3
    }
    const v1 = this.v1Config
    const weights = v1 === undefined ? c.weights : legacyWeights(c, v1)
    const budget = this.config.premiumBudget
    const window = this.config.budgetWindow
    const premiumCount = this.budgetHistory.filter((id) => id === 'premium').length
    const budgetExhausted = this.budgetHistory.length >= window && premiumCount / this.budgetHistory.length >= budget
    if (budgetExhausted) {
      this.log.info(`kimi-router: premium budget exhausted (${premiumCount}/${this.budgetHistory.length} ≥ ${budget}), keeping primary`)
    }
    const sel = selectCandidate(this.metas, weights, {
      lambda: this.config.lambda,
      defaultTarget: this.config.default,
      mode: this.config.mode,
      hasImage: c.vision,
      budgetExhausted,
      routeThreshold: v1 === undefined ? this.config.routeThreshold : 0,
      scoresOf: (m) => scoreFor(this.config, m),
    })
    if (sel === null) {
      // 0.2.x budget semantics: only cost-mode keep decisions record a
      // 'primary' sample; capability keeps leave the window untouched.
      if (this.config.mode === 'cost') this.record('primary')
      return { kind: 'keep', reason: budgetExhausted ? 'cost: premium budget exhausted' : `${this.config.mode}: default primary` }
    }
    const targetIsDefault = sel.target.provider === this.config.default.provider && sel.target.model === this.config.default.model
    this.record(targetIsDefault ? 'primary' : 'premium')
    return { kind: 'route', target: sel.target, reason: sel.reason, scoreDelta: sel.scoreDelta }
  }

  /** agent/request 钩子：消费决策，返回替换后的 callConfig。 */
  applyTo(config: LlmCallConfig, decision: RouteDecision | undefined): LlmCallConfig {
    if (decision === undefined || decision.kind !== 'route') return config
    const { reasoningEffort: _inherited, ...rest } = config
    return {
      ...rest,
      provider: decision.target.provider,
      model: decision.target.model,
    }
  }

  /** Image guard bound to this router's candidates (see applyImageGuard). */
  guardImage(target: RouteTarget, hasImage: boolean): { target: RouteTarget; reason: string } | null {
    return applyImageGuard(target, this.legacyConfig, hasImage, this.metas)
  }

  /**
   * Legacy v1 view of this router (primary/premium/mode) for the guard and
   * admission helpers that still speak the v1 vocabulary: the exact v1 config
   * when legacy-constructed, otherwise derived from the v2 config +
   * candidates (premium = first candidate on a non-default provider).
   */
  get legacyConfig(): RouterConfigV1 {
    if (this.v1Config !== undefined) return this.v1Config
    return {
      mode: this.config.mode,
      primary: this.config.default,
      premium: this.metas.find((m) => m.provider !== this.config.default.provider)
        ?? this.metas[0]
        ?? this.config.default,
    }
  }

  private record(kind: 'primary' | 'premium'): void {
    const window = this.config.budgetWindow
    this.budgetHistory.push(kind)
    while (this.budgetHistory.length > window) this.budgetHistory.shift()
  }

  /** 当前预算占用（诊断用）。 */
  budgetUsage(): { premium: number; window: number; ratio: number } {
    const window = this.config.budgetWindow
    const premium = this.budgetHistory.filter((id) => id === 'premium').length
    return { premium, window, ratio: this.budgetHistory.length > 0 ? premium / this.budgetHistory.length : 0 }
  }
}

/** Bridge a v1 (0.2.x) config to RouterConfigV2 (see KimiRouter overload). */
function legacyConfigToV2(v1: RouterConfigV1): RouterConfigV2 {
  return {
    version: 2,
    mode: v1.mode,
    default: v1.primary,
    candidates: [v1.premium, v1.premiumLong].filter((t): t is NonNullable<typeof t> => t !== undefined),
    scores: {},
    classify: { patterns: v1.escalateWhen?.patterns !== undefined ? { reasoning: v1.escalateWhen.patterns } : {} },
    allowedProviders: [...new Set([v1.primary.provider, v1.premium.provider])],
    costTiers: {},
    routeThreshold: 0.75,
    lambda: 0.5,
    premiumBudget: v1.premiumBudget ?? 0.2,
    budgetWindow: v1.budgetWindow ?? 20,
    charsPerToken: v1.charsPerToken ?? 2,
  }
}

/**
 * Candidate metadata implied by a v1 config. Per the real capability matrix
 * (pi-ai catalog, 2026-08-18): deepseek-v4-* text-only/cheap, Kimi k3 family
 * multimodal/mid.
 */
function legacyMetasFromConfig(v1: RouterConfigV1): CandidateMeta[] {
  const targets = [v1.primary, v1.premium, v1.premiumLong].filter(
    (t): t is NonNullable<typeof t> => t !== undefined,
  )
  const textOnly = new Set(v1.textOnlyProviders ?? [v1.primary.provider])
  return targets.map((t) => ({
    ...t,
    modalities: textOnly.has(t.provider) ? ['text'] : ['text', 'image'],
    costTier: t.provider === 'deepseek-official' ? ('cheap' as const) : ('mid' as const),
    available: true,
  }))
}

/**
 * Legacy-constructed routers: restrict the scoring weights to the dims the
 * v1 escalateWhen config actually opted into (patterns → reasoning, token
 * threshold → longctx). Capability-mode v1 carried no opt-ins (rules
 * table was dropped), so no weights → no route, matching the default-rules
 * v1 behavior.
 */
function legacyWeights(c: ClassifyResult, v1: RouterConfigV1): Partial<Record<Dim, number>> {
  const out: Partial<Record<Dim, number>> = {}
  const esc = v1.escalateWhen ?? {}
  if (esc.patterns !== undefined && esc.patterns.length > 0 && c.weights.reasoning !== undefined) out.reasoning = c.weights.reasoning
  if (esc.estimatedTokensGt !== undefined && c.weights.longctx !== undefined) out.longctx = c.weights.longctx
  return out
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
        const { reasoningEffort: _inherited, ...rest } = replaced
        replaced = { ...rest, provider: guard.target.provider, model: guard.target.model }
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
      if (!canClaimImageAdmission(router.legacyConfig, router.metas)) return undefined
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
