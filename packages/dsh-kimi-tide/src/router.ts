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
}

export type RouteDecision =
  | { kind: 'route'; target: RouteTarget; reason: string }
  | { kind: 'keep'; reason: string }

const DEFAULT_ESCALATE_PATTERNS = ['审查', 'review', 'critique', '复检', '挑毛病', 'audit', '审计', '代码审查']

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
    private readonly config: RouterConfig,
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
  const slots = new WeakMap<Agent, RouteDecision>()
  return ctx.effect(() => {
    const disposePre = ctx.on('agent/pre-step', async (payload, next) => {
      const result = await next()
      // 只对将要发起模型请求的步骤做决策（step === 0 是最新用户消息的进入点；
      // 工具循环内保持稳定，避免中途换模型破坏上下文一致性）。
      if (payload.step === 0) {
        const decision = router.decide(payload.messages, payload.step)
        slots.set(payload.agent, decision)
        onDecision?.(payload.agent, decision)
      }
      return result
    })
    const disposeRequest = ctx.on('agent/request', async (payload, next) => {
      const resolved = await next()
      const decision = slots.get(payload.agent)
      if (decision !== undefined) {
        slots.delete(payload.agent)
        const replaced = router.applyTo(resolved, decision)
        if (replaced !== resolved) {
          ctx.logger?.info?.(`kimi-router: agent request → ${replaced.provider}/${replaced.model} (${decision.kind === 'route' ? decision.reason : 'kept'})`)
        }
        return replaced
      }
      return resolved
    })
    return () => {
      disposePre()
      disposeRequest()
    }
  })
}
