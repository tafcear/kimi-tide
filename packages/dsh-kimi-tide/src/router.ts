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

export interface RouteTarget {
  provider: string
  model: string
}

export interface MatchRule {
  /** 正则关键词（对最新用户消息全文匹配）。 */
  patterns?: string[]
  /** 消息文本估算 token 数超过该值时命中（中英混合保守估算）。 */
  estimatedTokensGt?: number
}

export interface RouterConfig {
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

export type RouteDecision =
  | { kind: 'route'; target: RouteTarget; reason: string }
  | { kind: 'keep'; reason: string }

const DEFAULT_ESCALATE_PATTERNS = ['审查', 'review', 'critique', '复检', '挑毛病', 'audit', '审计', '代码审查']

/** True when any user message in the batch carries an image block. */
export function messagesContainImage(messages: readonly UserMessage[]): boolean {
  return messages.some(
    (m) => m.role === 'user' && m.content.some((b) => (b as { type?: string }).type === 'image'),
  )
}

/**
 * Providers that cannot accept image input. Defaults to the primary provider:
 * the real capability matrix (pi-ai catalog `input` field, verified
 * 2026-08-18) is deepseek-v4-flash/pro text-only, Kimi k3 family multimodal
 * — the v1 "Kimi is text-only" assumption was inverted. Override via
 * `RouterConfig.textOnlyProviders`.
 */
export function textOnlyProviders(config: RouterConfig): Set<string> {
  if (config.textOnlyProviders !== undefined) return new Set(config.textOnlyProviders)
  return new Set([config.primary.provider])
}

/**
 * Image guard: when the step carries an image and the resolved target is a
 * text-only route, swap to the multimodal Kimi premium route instead of
 * letting the adapter throw UNSUPPORTED_CONTENT mid-turn. The guard is a
 * correctness rail, not a budget decision: guard-driven escalations are not
 * recorded in the premium budget window.
 */
export function applyImageGuard(
  target: RouteTarget,
  config: RouterConfig,
  hasImage: boolean,
): { target: RouteTarget; reason: string } | null {
  if (!hasImage) return null
  const textOnly = textOnlyProviders(config)
  if (!textOnly.has(target.provider)) return null
  // No safe reroute when the premium route is itself text-only: leave the
  // step on its resolved target rather than ping-ponging.
  if (textOnly.has(config.premium.provider)) return null
  return { target: config.premium, reason: 'image input: rerouted to multimodal premium' }
}

/**
 * Whether this router can claim an image prompt at host admission time.
 *
 * The host image-admission gate (dsh-host-apiproxy prompt RPC) rejects image
 * prompts whose CURRENT model selection is text-only BEFORE the agent loop
 * runs — on a fresh session the default selection is the text-only primary,
 * so the per-step image guard never gets a chance. The host defers via the
 * agent-scoped serial event `agent/image-admission`: a listener returning a
 * truthy value claims the message will be rerouted. Claim only when this
 * router is active AND the premium route is multimodal — a text-only premium
 * cannot serve the image (mirror of applyImageGuard's anti-ping-pong rule),
 * so the host's friendly rejection stays in charge.
 */
export function canClaimImageAdmission(config: RouterConfig): boolean {
  if (config.mode === 'off') return false
  const textOnly = textOnlyProviders(config)
  return !textOnly.has(config.premium.provider)
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

export class KimiRouter {
  private readonly budgetHistory: string[] = []

  constructor(
    /** Public for capability probes (e.g. the host image-admission claim). */
    readonly config: RouterConfig,
    private readonly log: RouterLog,
  ) {}

  /** 基于本步消息批次做决策；显式 @kimi 指令在两种模式下都直接生效。 */
  decide(messages: readonly UserMessage[], step: number): RouteDecision {
    const text = latestUserText(messages)
    const contextTokens = estimateContextTokens(messages, this.config.charsPerToken ?? 2)

    // 1. 显式指令：最高优先级，任何模式都尊重用户选择
    if (this.config.mode !== 'off' && /@kimi\b|@kimicode\b/i.test(text)) {
      return { kind: 'route', target: this.config.premium, reason: 'explicit @kimi directive' }
    }

    if (this.config.mode === 'cost') {
      const escalate = this.config.escalateWhen ?? {}
      const escalated =
        (escalate.patterns !== undefined && escalate.patterns.length > 0 && matchesPatterns(text, escalate.patterns)) ||
        (escalate.estimatedTokensGt !== undefined && contextTokens > escalate.estimatedTokensGt)
      if (!escalated) {
        return { kind: 'keep', reason: 'cost: default primary' }
      }
      const budget = this.config.premiumBudget ?? 0.2
      const window = this.config.budgetWindow ?? 20
      const premiumCount = this.budgetHistory.filter((id) => id === 'premium').length
      if (this.budgetHistory.length >= window && premiumCount / this.budgetHistory.length >= budget) {
        this.log.info(`kimi-router: premium budget exhausted (${premiumCount}/${this.budgetHistory.length} ≥ ${budget}), keeping primary`)
        this.record('primary')
        return { kind: 'keep', reason: 'cost: premium budget exhausted' }
      }
      const target = this.config.premium
      this.record('premium')
      return { kind: 'route', target, reason: 'cost: escalation rule matched' }
    }

    if (this.config.mode === 'capability') {
      const rules = this.config.rules ?? []
      for (const rule of rules) {
        const matched =
          (rule.match.patterns !== undefined && matchesPatterns(text, rule.match.patterns)) ||
          (rule.match.estimatedTokensGt !== undefined && contextTokens > rule.match.estimatedTokensGt)
        if (matched) {
          this.record('premium')
          return { kind: 'route', target: rule.route, reason: 'capability: rule matched' }
        }
      }
      return { kind: 'keep', reason: 'capability: default primary' }
    }

    return { kind: 'keep', reason: 'router off' }
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

  /** Image guard bound to this router's config (see applyImageGuard). */
  guardImage(target: RouteTarget, hasImage: boolean): { target: RouteTarget; reason: string } | null {
    return applyImageGuard(target, this.config, hasImage)
  }

  private record(kind: 'primary' | 'premium'): void {
    const window = this.config.budgetWindow ?? 20
    this.budgetHistory.push(kind)
    while (this.budgetHistory.length > window) this.budgetHistory.shift()
  }

  /** 当前预算占用（诊断用）。 */
  budgetUsage(): { premium: number; window: number; ratio: number } {
    const window = this.config.budgetWindow ?? 20
    const premium = this.budgetHistory.filter((id) => id === 'premium').length
    return { premium, window, ratio: this.budgetHistory.length > 0 ? premium / this.budgetHistory.length : 0 }
  }
}

/**
 * 把路由器挂到 agent 生命周期：pre-step 分类入槽，request 消费出槽。
 * @returns disposer。
 */
export function installRouter(ctx: Context, router: KimiRouter, onDecision?: (agent: Agent, decision: RouteDecision) => void): () => void {
  const slots = new WeakMap<Agent, { decision: RouteDecision; hasImage: boolean }>()
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
        const decision = router.decide(payload.messages, payload.step)
        slots.set(payload.agent, { decision, hasImage: messagesContainImage(payload.messages) })
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
      if (!canClaimImageAdmission(router.config)) return undefined
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
