/**
 * hit-confirm — 语义命中确认闸（语义闸 spec v2 §3）。
 *
 * 语义：关键词命中时，先让**当前预设的打底模型**判断这次命中是不是本轮真实意图。
 * 判否 ⇒ 该规则视同不存在（跳过、继续后续规则）；**问不到**（超时/不可用/解析失败）
 * ⇒ 一律 fail-open（不过闸），语义层永不制造比现状更坏的结果。
 *
 * 边界（v2 登记）：只判**路由链首条**关键词命中；显式 @ 轮与「首位是 image/flow 命中」
 * 的轮**零调用**（结果不可能生效，见 §7 前置短路）；次条及以后不经确认。
 *
 * 纯函数可单测；`call` 是注入缝（生产 = ctx.llm.stream 直调判官，不经 decide）。
 */
import type { RouteTarget } from './config.js'

/** 判官输入的文本截断上限（字符）。 */
export const CONFIRM_TEXT_LIMIT = 600
/** 候选表上限（超出按路由链序截断；当前实现只传链首一条）。 */
export const MAX_CONFIRM_CANDIDATES = 8
/** 判官调用有界超时（§3.5）。 */
export const DEFAULT_CONFIRM_TIMEOUT_MS = 1200
/** 输出上限：20 个 CJK 字 + JSON 结构在常见 tokenizer 下可能超 32 token（评审 L2）。 */
export const DEFAULT_CONFIRM_MAX_TOKENS = 64
const DEFAULT_CACHE_CAP = 64

/** 候选规则（判官只能在这几条里选）。 */
export interface ConfirmCandidate {
  ruleId: string
  group: string
  targetKey: string
}

/** 判词：hit（真意图）/ omit（不是本轮意图，跳过该规则）。 */
export interface ConfirmVerdict {
  verdict: 'hit' | 'omit'
  ruleId: string
  why: string
}

/** 判官一次调用的结果（供观测与验收指标：无结论率）。 */
export type ConfirmOutcome = 'hit' | 'omit' | 'fail' | 'cached-hit' | 'cached-omit'

const INSTRUCTION = [
  '你是路由确认器。判断下列关键词在用户这句话里，是不是本轮真要执行的意图。',
  '只输出一行 JSON：{"verdict":"hit"|"omit","rule":"<规则id>","why":"不超过20字"}',
  '只有当这些词属于引用、转述、延后语境（如「这个做完再做X」「你上次说的X」）时才判 omit；',
  '不确定一律 hit。不要解释，不要多余文本。',
].join('\n')

/** 判官输入：指令 + 本轮文本（截断）+ 候选规则表（不含词表，控 token）。 */
export function buildConfirmInput(text: string, candidates: readonly ConfirmCandidate[]): string {
  const clipped = text.length <= CONFIRM_TEXT_LIMIT ? text : `${text.slice(0, CONFIRM_TEXT_LIMIT)}…（已截断）`
  const rows = candidates
    .slice(0, MAX_CONFIRM_CANDIDATES)
    .map((c) => `- ${c.ruleId}｜组 ${c.group}｜目标 ${c.targetKey}`)
  return [INSTRUCTION, '', '[用户本轮文本]', clipped, '', '[候选规则]', ...rows].join('\n')
}

/**
 * 解析判词（容错）：剥 ``` 围栏、取首个 {...}、容忍前后空白与大小写。
 * **只有** `verdict` 合法且 `rule` 命中候选表（链首）时才有结论；
 * 其余（含指向表内非链首、坏 JSON、字段缺失）一律 null = 保守通过。
 */
export function parseConfirmVerdict(raw: string, candidates: readonly ConfirmCandidate[]): ConfirmVerdict | null {
  const fenced = raw.replace(/```[a-zA-Z]*/g, '')
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fenced.slice(start, end + 1))
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  const verdict = typeof record.verdict === 'string' ? record.verdict.toLowerCase() : ''
  if (verdict !== 'hit' && verdict !== 'omit') return null
  const ruleId = typeof record.rule === 'string' ? record.rule : ''
  // v2 §3.4：只接受候选表内的规则 id（当前实现 = 路由链首条）。
  if (!candidates.some((c) => c.ruleId === ruleId)) return null
  const why = typeof record.why === 'string' ? record.why.slice(0, 40) : ''
  return { verdict, ruleId, why }
}

export interface ConfirmGateDeps {
  /** 判官调用（注入缝）：返回原始文本，失败/超时返回 null。 */
  call: (req: ConfirmCallRequest) => Promise<string | null>
  cacheCap?: number
  /** 观测缝（生产 = ctx.logger.info）。 */
  log?: (message: string) => void
}

/** 判官调用请求（目标随预设变化，故逐次传入）。 */
export interface ConfirmCallRequest {
  input: string
  judge: RouteTarget
  maxTokens: number
  signal: AbortSignal | undefined
}

/** 判官的可配置项（来自 preset.hitConfirm）。 */
export interface ConfirmOptions {
  timeoutMs?: number
  maxTokens?: number
  signal?: AbortSignal
}

/**
 * 确认闸：带 LRU 与有界超时的判官调用封装。
 * 缓存只存**有结论**的结果（失败/超时不写，免得一次抖动被缓存 N 条）；
 * 键含判官身份（评审 L3）——换预设（判官变）不沿用旧判词。
 */
export class HitConfirmGate {
  private readonly cache = new Map<string, ConfirmVerdict>()
  private readonly cacheCap: number

  constructor(private readonly deps: ConfirmGateDeps) {
    this.cacheCap = deps.cacheCap ?? DEFAULT_CACHE_CAP
  }

  private keyOf(text: string, candidates: readonly ConfirmCandidate[], judgeKey: string): string {
    const norm = text.trim().replace(/\s+/g, ' ')
    const rules = candidates.map((c) => `${c.ruleId}:${c.group}:${c.targetKey}`).join(',')
    return `${norm}\u0000${rules}\u0000${judgeKey}`
  }

  private remember(key: string, verdict: ConfirmVerdict): void {
    this.cache.delete(key)
    this.cache.set(key, verdict)
    while (this.cache.size > this.cacheCap) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }

  /**
   * 判一次。返回 omitRuleId = 该规则应被跳过；null = 照常（含 hit、无结论、失败）。
   * 中止视同无结论（评审未覆盖面②），且不写缓存。
   */
  async review(
    text: string,
    candidates: readonly ConfirmCandidate[],
    judge: RouteTarget,
    options: ConfirmOptions = {},
  ): Promise<{ omitRuleId: string | null; outcome: ConfirmOutcome; durationMs: number }> {
    const started = Date.now()
    const judgeKey = `${judge.provider}/${judge.model}`
    const key = this.keyOf(text, candidates, judgeKey)
    const cached = this.cache.get(key)
    if (cached !== undefined) {
      this.deps.log?.(`kimi-router: 语义确认命中缓存 → ${cached.verdict}`)
      return {
        omitRuleId: cached.verdict === 'omit' ? cached.ruleId : null,
        outcome: cached.verdict === 'omit' ? 'cached-omit' : 'cached-hit',
        durationMs: 0,
      }
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS
    const timeout = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
    const base = options.signal
    const combined = base === undefined
      ? timeout
      : timeout === undefined
        ? base
        : (typeof AbortSignal.any === 'function' ? AbortSignal.any([base, timeout]) : base)
    let raw: string | null = null
    try {
      raw = await this.deps.call({
        input: buildConfirmInput(text, candidates),
        judge,
        maxTokens: options.maxTokens ?? DEFAULT_CONFIRM_MAX_TOKENS,
        signal: combined,
      })
    } catch {
      raw = null
    }
    const durationMs = Date.now() - started
    if (raw === null) {
      this.deps.log?.(`kimi-router: 语义确认 无结论(${durationMs}ms) → 不过闸`)
      return { omitRuleId: null, outcome: 'fail', durationMs }
    }
    const verdict = parseConfirmVerdict(raw, candidates)
    if (verdict === null) {
      this.deps.log?.(`kimi-router: 语义确认 解析失败(${durationMs}ms) → 不过闸`)
      return { omitRuleId: null, outcome: 'fail', durationMs }
    }
    this.remember(key, verdict)
    this.deps.log?.(`kimi-router: 语义确认 ${verdict.verdict} ${verdict.ruleId} ${durationMs}ms`)
    return {
      omitRuleId: verdict.verdict === 'omit' ? verdict.ruleId : null,
      outcome: verdict.verdict,
      durationMs,
    }
  }
}
