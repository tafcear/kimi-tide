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
  RequestUserInput,
} from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type {
  CandidateMeta, CollaborationFlow, ReviewFlow, RoleEntry, RouteTarget, RouterConfigV4, RouterConfigV5, RouterConfigV6, RouterPreset, TranscribeFlow,
} from './config.js'
import { configKey, isFlowTarget, isV5Plus, KIMI_PROVIDER } from './config.js'
import { dispatchMetaOf, resolveRoleDecision, type DispatchMeta } from './roles.js'
import type { DispatchEntry } from './dispatch-ledger.js'
import type { ImageStateEntry, ImageStateStore } from './image-state.js'
import { KIMI_TIDE_REVIEW_EVENT, KIMI_TIDE_REVISE_EVENT } from './projection.js'
import {
  createReviewRunner, createReviseMessage, isReviseMessage, REVIEW_INPUT_LIMIT,
  type ReviewEventPayload, type ReviewRequest, type ReviewRevisePayload,
} from './review.js'
import { isRevisableVerdict, verdictLabel, type ReviewVerdict } from './review-verdict.js'
import type { ResolvedImage, Transcriber, VisionCaller } from './transcribe.js'
import { type ConfirmReviewResult, type HitConfirmGate } from './hit-confirm.js'
import { configuredProviders, effectiveExplicitDirective, explicitDirective, latestUserMessage, latestUserText, matchingScored, messagesContainImage, reviewTriggerHit, routableHits, ruleLabel } from './rules.js'
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
  | { kind: 'route'; target: RouteTarget; reason: string; via: 'explicit' | 'rule' | 'default' | 'role'; confirmNote?: string }
  | { kind: 'flow'; flowId: string; flow: TranscribeFlow; reason: string; via: 'rule'; confirmNote?: string }
  | { kind: 'keep'; reason: string; confirmNote?: string }

/**
 * 语义闸注记（v1.3.0 可观测性补链）：把判词结论前置拼进决策原因串，并留下
 * `confirmNote` 供 `buildDecisionSummary` 判别。判否 ⇒ 规则被过滤 ⇒ 最终必然
 * 落打底（`via: 'default'`），而打底按既有语义**不上报面板**——不特殊处理的话，
 * 「判否」这个最需要被看见的结果恰恰完全不可见（A7 实机失效即由此被掩盖）。
 *
 * 注记必须短：`buildDecisionSummary` 对 reason 截断 120 字符，故前置以保证不被截掉。
 * 传 `undefined` 时原样返回同一引用，既有决策逐字节不变。
 */
export function withConfirmNote<T extends RouteDecision>(decision: T, note: string | undefined): T {
  if (note === undefined) return decision
  // 断言是刻意的：spread 保住判别式（kind/via）与全部既有字段，仅追加注记与前置 reason。
  return { ...decision, confirmNote: note, reason: `${note} · ${decision.reason}` } as T
}

/**
 * 判词 → 决策原因串注记（v1.3.0 可观测性补链，纯函数）。
 *
 * 两种失败形态**措辞与耗时都分开**：`no-answer`（无结论/超时，耗时会顶到 timeoutMs）与
 * `parse`（判词不可解析，提前返回）。实机据此一眼区分 (a) 超时 / (b) 解析两条根因，
 * 不必再去翻易失的 stdout——A7 实机失效正是因为没有这个面才被掩盖。
 */
export function confirmNoteOf(ruleId: string, result: ConfirmReviewResult): string {
  if (result.outcome === 'fail') {
    if (result.failDetail === 'parse') {
      // v1.3.0 A7 定向修复：把判官原文摘要一并带上——只报「不可解析」的话，
      // 修提示词还是修解析器只能靠猜（实机第一次取证就是这么卡住的）。
      const sample = result.rawSample
      const tail = sample === undefined || sample === '' ? '' : `· 原文「${sample}」`
      return `语义闸判词不可解析 ${result.durationMs}ms（${ruleId}）${tail}`
    }
    return `语义闸无结论 ${result.durationMs}ms（${ruleId}）`
  }
  const why = result.why?.trim()
  if (result.outcome === 'omit' || result.outcome === 'cached-omit') {
    return why === undefined || why === '' ? '语义闸判否' : `语义闸判否「${why}」`
  }
  return why === undefined || why === '' ? '语义闸确认' : `语义闸确认「${why}」`
}

/**
 * 分工表改道（v2.0.0 团队派发，优先级链第 3 档，纯函数）：队友身份命中分工表时，
 * 把路由决策改道到该角色的目标模型，via 记 'role'。
 *
 * 不覆盖两档：**显式 @**（via === 'explicit'，优先级链 1 > 3——用户点名最大）与
 * **flow 决策**（kind === 'flow'，图像正确性通道，改道会把带图轮送进 text-only
 * 目标）。keep 决策（router off / 预设缺失）同样不动。roleHit 缺席（主会话、
 * 未认领队友、lead）原引用返回，既有路径逐字节不变。confirmNote 随覆盖保留——
 * 判词注记不被 role 改道抹掉（与 withConfirmNote 的可观测性补链同向）。
 */
export function applyRoleDecision(
  decision: RouteDecision,
  roleHit: { role: RoleEntry; name: string } | undefined,
): RouteDecision {
  if (roleHit === undefined || decision.kind !== 'route' || decision.via === 'explicit') return decision
  const { role, name } = roleHit
  return {
    kind: 'route',
    target: role.target,
    reason: `分工表「${role.label}」→ ${role.target.provider}/${role.target.model}（队友 ${name}）`,
    via: 'role',
    ...(decision.confirmNote === undefined ? {} : { confirmNote: decision.confirmNote }),
  }
}

/**
 * 主驱动恒定（v2.0.0 D1，优先级链第 5 档「打底」，纯函数）：仅作用于**主会话**
 * （delegationDepth === 0，调用方以 isChild 传入）且仅作用于**打底**决策
 * （via === 'default'）——规则/显式/role/flow/keep 一律原引用返回。
 *
 * sticky !== true 原引用返回（存量迁移显式 false ⇒ 与 v1.4.1 逐字节一致）。
 * driver 为 null / 缺失 → keep「主驱动跟随宿主默认」（applyTo 对 keep 不改写，
 * 请求落宿主 agent-default-model）；driver 非空 → 打底目标换成 driver。
 */
export function applyDriverSticky(
  decision: RouteDecision,
  isChild: boolean,
  driver: RouteTarget | null | undefined,
  driverSticky: boolean | undefined,
): RouteDecision {
  if (isChild || driverSticky !== true || decision.kind !== 'route' || decision.via !== 'default') return decision
  if (driver == null) return { kind: 'keep', reason: '主驱动跟随宿主默认' }
  return { ...decision, target: driver, reason: `${decision.reason}（主驱动）` }
}

/**
 * 路由器配置的过渡形（Task 8）：v4 存量与 v5+ 协作编排配置皆可挂载。
 * v4 无 flows 注册表——flow 规则目标按「flow 不存在」跳过，与 0.5.x 行为
 * 逐字节一致；settings/index 面的全量 V5 迁移已交付（0.6.0，spec §6：
 * 命名空间 v5 存储 + 一次性迁移 + sidecar 写回留档）。v6（团队派发）并入：
 * 分工层字段不影响本文件决策逻辑，flows 判据统一走 isV5Plus。
 */
export type RouterConfigAny = RouterConfigV4 | RouterConfigV5 | RouterConfigV6

/** v5+ 配置取 flows 注册表；v4 无注册表 → 空表（flow 目标恒按「不存在」降级，行为保持）。 */
function flowsOf(config: RouterConfigAny): Record<string, CollaborationFlow> {
  return isV5Plus(config) ? config.flows : {}
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
   * 「本路由器认识的 provider」全集（v1.3.0 Q6）——显式 @ 指令的有效性判据。
   *
   * = 候选目录全部 provider（**含 available:false 者**）∪ 预设已配置目标 ∪ 内置
   *   kimi 别名（`KIMI_PROVIDER`）。
   *
   * 含不可用者是有意的：`@zai-coding-cn` 在 key 缺失时应保持 Q3 的 `keep`（用户
   * 点了名就不静默改道），而不是被当成误判丢进规则链。加 `KIMI_PROVIDER` 是因为
   * `@kimi`/`@kimi-tide` 是插件定义的常量别名，不是目录事实——目录枚举失败导致
   * metas 为空时别名仍应可用。
   */
  knownProviders(): ReadonlySet<string> {
    const names = new Set<string>(this.metas.map((m) => m.provider))
    names.add(KIMI_PROVIDER)
    const preset = this.config.activePreset === null ? undefined : this.config.presets[this.config.activePreset]
    if (preset !== undefined) for (const provider of configuredProviders(preset)) names.add(provider)
    return names
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
   *
   * `opts.skipKeywordRules`（v2.0.0 D6）：子代理跳过关键词规则、保留图像规则
   * （图像正确性通道不随关键词一起跳）。主会话路径不传 opts，行为逐字节不变。
   */
  decide(
    messages: readonly UserMessage[],
    step: number,
    hasImageOverride?: boolean,
    omittedRuleIds?: ReadonlySet<string>,
    opts?: { skipKeywordRules?: boolean },
  ): RouteDecision {
    if (this.config.activePreset === null) return { kind: 'keep', reason: 'router off' }
    const text = latestUserText(messages)
    const hasImage = hasImageOverride ?? messagesContainImage(messages)
    // 1. 显式 @指令（最高优先级）。v1.3.0 Q3 两项升级：
    //    a) **精确寻址** `@provider/model`——模型在候选池且可用（带图还须多模态）就直接用；
    //       否则回落确定化选择，并把「不可用」写进原因（不静默改道）。
    //    b) provider 简写的池内选择**确定化 + 可解释**——优先「本预设已配置过的目标」
    //       （default → 规则序），其次目录枚举序首个；原因串写出实际模型与依据。
    //       （实机教训：`@qwen-token-plan-cn` 曾落到池内首个 MiniMax-M2.5 = 未购买 → 403。）
    const explicit = effectiveExplicitDirective(text, this.knownProviders())
    // Q6 可解释性：词法上像指令但被判为非指令时，原因串里交代一句（不静默）。
    const lexExplicit = explicit === null ? explicitDirective(text) : null
    const noteHead = lexExplicit === null ? '' : `@${lexExplicit.provider} 非本路由器已知 provider（已忽略）· `
    if (explicit !== null) {
      const pool = this.metas.filter(
        (m) => m.provider === explicit.provider && m.available && (!hasImage || m.modalities.includes('image')),
      )
      if (pool.length === 0) {
        // Q6：走到这里说明 provider **是认识的**（unknown 已被上面挡掉）——保持 Q3
        // 的「点了名就不静默改道」，只把原因写清楚（原文案中英混杂且不含"为何 keep"）。
        return { kind: 'keep', reason: `显式 @${explicit.provider} 无可用候选（provider 已知但当前无可路由模型）` }
      }
      if (explicit.model !== undefined) {
        const exact = pool.find((m) => m.model === explicit.model)
        if (exact !== undefined) {
          return {
            kind: 'route',
            target: { provider: exact.provider, model: exact.model },
            reason: `显式 @${explicit.provider}/${explicit.model} 指令`,
            via: 'explicit',
          }
        }
        const fallback = this.pickExplicitTarget(pool)
        return {
          kind: 'route',
          target: { provider: fallback.meta.provider, model: fallback.meta.model },
          reason: `显式 @${explicit.provider}/${explicit.model} 不可用 → ${fallback.meta.model}（${fallback.why}）`,
          via: 'explicit',
        }
      }
      const picked = this.pickExplicitTarget(pool)
      return {
        kind: 'route',
        target: { provider: picked.meta.provider, model: picked.meta.model },
        reason: `显式 @${explicit.provider} 指令 → ${picked.meta.model}（${picked.why}）`,
        via: 'explicit',
      }
    }
    // 2. 预设规则链（首条目标可用者生效；目标不可用 → 跳过该规则，降级）。
    const preset = this.config.presets[this.config.activePreset]
    if (preset === undefined) {
      this.log.info(`kimi-router: active preset '${this.config.activePreset}' not found, keeping current route`)
      return { kind: 'keep', reason: 'active preset not found' }
    }
    const flows = flowsOf(this.config)
    const hits = matchingScored(this.config, text, hasImage)
    // v2.0.0（D6）：子代理跳关键词规则——命中集在进路由链前按 when.kind === 'image'
    // 过滤，图像规则保留（带图轮的改道正确性不依赖关键词）。过滤发生在 noteBase
    // 之前，标注基准（routableHits）与被否过滤语义不漂移。
    const effective = opts?.skipKeywordRules === true
      ? hits.filter(({ rule }) => rule.when.kind === 'image')
      : hits
    // 1.1.0 §4 静态抑制 + v2 语义判否：路由链 = 认领过滤 → 判否过滤（两步共用
    // routableHits，避免与 pre-step 的闸各自过滤而漂移）。
    // **noteBase 与路由链解耦**（v2 评审 M3）：标注基准是「认领过滤后、判否过滤**前**」
    // 的列表——被否规则**视同不存在于路由链，但仍占标注位**，故次条不会误标
    // 「特异度最高」（与 0.8.x①「降级不误标」同款不变量）。
    const noteBase = routableHits(this.config, effective)
    const routable = omittedRuleIds === undefined || omittedRuleIds.size === 0
      ? noteBase
      : noteBase.filter(({ rule }) => !omittedRuleIds.has(rule.id))
    const headId = noteBase.length > 1 ? noteBase[0]?.rule.id : undefined
    for (const [index, { rule, score }] of routable.entries()) {
      const target = rule.target
      // 0.8.0 原因升级：携带命中词数；多命中且为排序后首命中时加（特异度最高）
      // 标注（image=∞ 不带）。0.8.x①：标注只属于首命中——首命中目标不可用
      // 降级到后续命中时不得误标（后续命中并非特异度最高）。R6（1.1.0）：
      // index 与 length 均基于过滤后 routable（T1 后 hits 原文保留、routable
      // 为路由链）——被认领组抑制的首命中不得使次命中误标特异度最高。
      // v2：判否过滤同理——只有 noteBase 首条**实际生效**时才标注。
      const annotated = headId !== undefined && rule.id === headId && index === 0
      const note = score === Number.POSITIVE_INFINITY
        ? ''
        : ` ${score} 词${annotated ? '（特异度最高）' : ''}`
      // 协作流目标（0.6.0，spec §5.1）：flow 存在 + transcribe 型 + visionModel
      // 在候选目录中可用 → flow 决策；任一不满足 → 跳过该规则（与模型目标不可
      // 用的降级语义一致）。v4 存量 flows 为空表，flow 目标恒按「不存在」降级。
      if (isFlowTarget(target)) {
        // 0.6.x池#3（M-3）运行期兜底：流目标仅在带图轮有意义——纯文本轮跳过
        // 该规则（写入期校验拒新配置；本守卫对存量手改配置防「静默保持会话
        // 模型」。带图条件的流规则 hasImage=false 本就不命中，不受影响）。
        if (!hasImage) continue
        const flowId = target.flow
        const flow = flows[flowId]
        if (flow === undefined || flow.type !== 'transcribe') continue
        const vision = this.metas.find(
          (m) => m.provider === flow.visionModel.provider && m.model === flow.visionModel.model && m.available,
        )
        if (vision === undefined) continue
        return { kind: 'flow', flowId, flow, reason: `${noteHead}规则「${ruleLabel(rule)}」命中${note}（协作流 ${flowId}）`, via: 'rule' }
      }
      const meta = this.metas.find((m) => m.provider === target.provider && m.model === target.model && m.available)
      if (meta === undefined) continue
      return { kind: 'route', target: { ...target }, reason: `${noteHead}规则「${ruleLabel(rule)}」命中${note}`, via: 'rule' }
    }
    // 3. 打底：未命中 ≠ keep——路由到预设默认模型（0.5.0 语义，spec §5.1）。
    // 被认领组命中不入链——全部命中被抑制时同样落此打底（1.1.0 §4）。
    return { kind: 'route', target: { ...preset.default }, reason: `${noteHead}预设「${preset.name}」默认`, via: 'default' }
  }

  /**
   * 池内确定化选择（Q3 方向 C）：优先「本预设已配置过的目标」（default → 规则序），
   * 其次目录枚举序首个。返回选中 meta 与人类可读依据（进决策原因，可解释）。
   */
  private pickExplicitTarget(pool: readonly CandidateMeta[]): { meta: CandidateMeta; why: string } {
    const preset = this.config.activePreset === null ? undefined : this.config.presets[this.config.activePreset]
    if (preset !== undefined) {
      const configured: RouteTarget[] = [
        preset.default,
        ...preset.rules.map((r) => r.target).filter((t): t is RouteTarget => !isFlowTarget(t)),
      ]
      for (const target of configured) {
        const hit = pool.find((m) => m.provider === target.provider && m.model === target.model)
        if (hit !== undefined) return { meta: hit, why: '预设内已配置目标' }
      }
    }
    return { meta: pool[0]!, why: '目录序首个可用' }
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
  resolveImages: (messages: readonly Message[]) => ResolvedImage[]
  onDecision?: (agent: Agent, decision: RouteDecision, extra?: { flowId?: string; flowDigest?: string }) => void
  transcribeTimeoutMs?: number
  /** 1.1.0 §7：评审完成回调（dock 流事件行 + 面板刷新由 index.ts 实现）。 */
  onReviewEvent?: (agent: Agent, event: ReviewEventPayload) => void
  /**
   * v1.2.0 会话事件解耦（2026-09-10）：评审事件是否可安全写入会话日志。
   * 宿主会话目录（KNOWN_SESSION_EVENT_TYPES）未命中时为 false → **拒绝写入**
   * （fail closed）。理由：`Session.append` 写不了 `ignorable` 标记，宿主读路径
   * 会整卷拒收它不认识的 required 事件——写一条谁都读不出的日志，比丢一条评审
   * 记录糟得多（09-10 的故障模式正是「注入没打中却照写」）。评审正文仍在
   * `onReviewEvent` 里交付，UI 不受影响。缺省 true（单测与旧宿主直通）。
   */
  reviewEventWritable?: boolean
  /** 1.1.0 §8：手动评审实现登记（install 传 fn / dispose 传 null）。 */
  onManualReview?: (fn: ((agent: Agent) => Promise<{ ok: boolean; message: string }>) | null) => void
  /**
   * v1.4.0 §3.1：**手动退回**实现登记（install 传 fn / dispose 传 null）。
   * 与 onManualReview 同款通道（客户端「让它重做」按钮 → `/kimi-tide revise`
   * 命令 → 这里登记的实现），不新造 RPC。
   */
  onManualRevise?: (fn: ((agent: Agent) => Promise<{ ok: boolean; message: string }>) | null) => void
  /** v1.4.0 §3.6：退回留痕回调（dock 流事件行；与会话事件同批交付）。 */
  onReviewRevise?: (agent: Agent, event: ReviewRevisePayload) => void
  /**
   * v1.3.0 语义命中确认闸（语义闸 spec v2 §7）：关键词命中时先让预设打底模型
   * 判定真伪；判否 ⇒ 该规则视同不存在（跳过继续后续规则）。缺省 = 不过闸。
   */
  hitConfirm?: HitConfirmGate
  /**
   * 队友身份查询（v2.0.0 团队派发）：index.ts 从 ctx.agentTeams 探测注入；
   * 服务缺席即 undefined ⇒ role 分支自然不命中（与主会话同形，逐字节不变）。
   */
  teamLookup?: (agent: Agent) => { role: string; name: string } | undefined
  /**
   * 派发台账记账回调（v2.0.0 Task 5，设计稿 D7）：请求层在图像护栏之后、槽位
   * 带 dispatch 元信息（= 子代理轮，pre-step 仅 isChild 写入）时记一条；
   * index.ts 注入 DispatchLedger.record。缺席 = 不记账（单测与旧宿主直通）。
   */
  onDispatch?: (agent: Agent, entry: DispatchEntry) => void
}

/**
 * 委派深度（宿主子会话 header 的 `delegationDepth`；根 agent 与旧夹具缺省 0）。
 *
 * B-1a（2026-09-20 缺陷修复）判定用。防御性读取是刻意的：宿主类型面没把
 * `session.header` 纳入 `Agent`，而本仓测试夹具是空对象 ⇒ 深度 0 ⇒ 主会话与
 * 全部存量夹具的行为逐字节不变（只有真子会话才走新分支）。
 * 实机形（2026-09-20 探针会话 `e1e2d348-…` 第 0 帧）：
 * `{"origin":"subagent","delegationDepth":1,"parentSession":"session-…"}`。
 */
export function delegationDepthOf(agent: Agent): number {
  const header = (agent as unknown as { session?: { header?: { delegationDepth?: unknown } } }).session?.header
  const depth = header?.delegationDepth
  return typeof depth === 'number' && Number.isFinite(depth) && depth > 0 ? depth : 0
}

/**
 * B-1a 让位判据（纯函数）：**打底**决策 ∧ 该 agent 是委派子代理 ∧ 传入目标与打底
 * 目标不同 ⇒ true（保持传入目标，不改道）。其余一律 false（交给 `applyTo`）。
 *
 * 为什么只保护子代理：子代理的 provider/model 是调用方对**具体任务**的点名
 * （`workflow` 的 `agent(prompt,{provider,model})` → `subagents.start` 的
 * `agentOptions`，spawn provider 声明 `agentOptions: true` 并在创建窗口合并）；
 * 主会话的模型选择则是预设**本来就要覆盖**的对象（spec §5.1「未命中⇒预设默认」，
 * v0.5.0 以来的核心语义）——一并保护会把打底整体废掉。
 */
export function shouldKeepExternalTarget(decision: RouteDecision, incoming: RouteTarget, agent: Agent): boolean {
  if (decision.kind !== 'route' || decision.via !== 'default') return false
  if (delegationDepthOf(agent) === 0) return false
  return incoming.provider !== decision.target.provider || incoming.model !== decision.target.model
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
 * ImageAttachmentRef，提取即得 ref，无需 readImage 读字节）。无 attachmentId
 * 的图块（非 rc.2 线形）忽略。
 *
 * 0.1.7 线形变更：工具结果从「user 消息里的 `tool-result` 嵌套块」升格为独立的
 * `tool` 角色消息（`ToolResultMessage.content: [ToolResultBlock]`），其内层图块
 * 现在是**消息级**而非块级嵌套 ⇒ 遍历“消息 → content”即自然覆盖主轮图块与工具
 * 产生的图块，原先对嵌套块的递归在新宿主上已无对应结构（0.1.1 的
 * `ContentBlockMap['tool-result']` 在 0.1.7 已从块族移除）。
 */
export function extractResolvedImages(messages: readonly Message[]): ResolvedImage[] {
  const out: ResolvedImage[] = []
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'image') continue
      const ref = (block as ImageBlock).attachment
      if (typeof ref?.attachmentId === 'string') out.push({ attachmentId: ref.attachmentId, ref })
    }
  }
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
    // 0.1.7 语义纠错：手工构造的 `{role:'user', content}` 恰好就是 RequestUserInput
    // （一次性输入，无持久身份）——旧写法 `as unknown as Message[]` 是欺骗性断言，
    // 而 GenerateOptions.messages 收的正是 RequestMessage[]（= Message |
    // RequestUserInput），直接按 RequestUserInput 声明即可，零断言。
    const message: RequestUserInput = { role: 'user', content }
    const options: GenerateOptions = {
      provider: target.provider,
      model: target.model,
      messages: [message],
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
 * （rc.2 原生占位投影兜底）。绝不原地 mutation——loop 请求深冻结（dsh-llm
 * deepFreeze），一律构造新块/新数组。
 *
 * 0.1.7 线形变更：`tool-result` 不再是块类型，工具结果已是独立的 `tool` 角色
 * 消息，其内层图块由 rewriteMessagesForText 的消息级遍历覆盖 ⇒ 块级函数不需要
 * （也无法）再递归嵌套块。
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

/**
 * 消息级同款替换（新消息数组 + 新消息对象；无命中时原引用返回）。
 *
 * 0.1.7 线形变更：请求消息不再是窄化的 `Message`——`RequestMessage = Message |
 * RequestUserInput`（一次性输入无 id/source，见 dsh-llm types.d.ts）。故本函数对
 * 消息类型泛型化（只要求「有 content」），返回值与入参同型，调用方（llm/stream
 * 投影拦截器）的载荷形状得以零改动穿过。
 */
function rewriteMessagesForText<T extends { readonly content: readonly ContentBlock[] }>(
  messages: readonly T[],
  peek: (attachmentId: string) => string | undefined,
): Rewrite<T[]> {
  let out: T[] | null = null
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
  return out === null ? { out: messages as T[], changed: false } : { out, changed: true }
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
  // v2.0.0（Task 4）：槽位增 dispatch——子代理派发的元信息（role/unclaimed/explicit/keep），
  // 请求层记账（dispatch-ledger，Task 5）消费；主会话恒 undefined（不占位）。
  const slots = new WeakMap<Agent, { decision: RouteDecision; hasImage: boolean; dispatch?: DispatchMeta }>()
  // attachmentId → ResolvedImage：跨轮回取 lazy 转述所需的持久引用。图不可变、
  // attachmentId 全局唯一，进程内一致；插件重挂载前进入会话的历史图无 ref 可
  // 查，按转述失败同等处置（failurePolicy 兜底）。
  const imageRefs = new Map<string, ResolvedImage>()
  const peek = (attachmentId: string): string | undefined => transcriber.peek(attachmentId)

  /**
   * 0.6.x池#4：eager/lazy 共用转述批处理——并发转述 + transcribed 标记
   * （latchTarget 随条目保留，评审修复语义）+ 逐图日志 + 失败 id 回收。
   * 盲答标记与 failurePolicy 两态分支仍归调用方（eager/lazy 语义各异）。
   */
  const transcribeBatch = async (
    flowId: string,
    flow: TranscribeFlow,
    imgs: readonly ResolvedImage[],
    signal: AbortSignal | undefined,
    agent: Agent,
  ): Promise<{ failedIds: string[]; okCount: number; total: number }> => {
    const texts = await Promise.all(imgs.map((img) => transcriber.text(flow, img, signal)))
    const failedIds: string[] = []
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i]
      const text = texts[i]
      if (text === null) failedIds.push(img.attachmentId)
      // latchTarget 随 transcribed 标记保留（评审修复）：缓存逐出降级回
      // native 时条目自带改道目标（latch 不回溯更早条目）。
      else images.mark(agent, img.attachmentId, 'transcribed', images.get(agent, img.attachmentId)?.latchTarget)
      ctx.logger?.info?.(`kimi-router: flow:${flowId} 转述 attachmentId=${img.attachmentId} ${text === null ? '失败' : '成功'}`)
    }
    return { failedIds, okCount: texts.length - failedIds.length, total: imgs.length }
  }

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
      // v2.0.0 团队派发（Task 4）：子代理判定与跳规则开关（D6）。rulesApplyToChildren
      // 缺失/false = 子代理不参与关键词规则（v2.0.0 行为变更，评审阻塞 B2 裁定迁移不写）。
      const isChild = delegationDepthOf(agent) > 0
      // R2 字段判据：分工层字段只认字段本身（?? / === true），**不以 version 门控**——
      // 线上 profile patch 与存量配置常显式写 version: 5，版本号门控会让用户写入的
      // 分工表与开关静默失效（与 index.ts rolesOf 同款形态）。
      const teamCfg = router.config as {
        roles?: Record<string, RoleEntry>
        driver?: RouteTarget | null
        driverSticky?: boolean
        rulesApplyToChildren?: boolean
      }
      const skipKeywordRules = isChild && teamCfg.rulesApplyToChildren !== true
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
      // 3.5 语义命中确认闸（v1.3.0；v2 评审 M1/M2 落地）：关键词命中时先问本预设的
      //     打底模型「这是本轮真意图吗」。**前置短路**（M2）：显式 @ 轮（decide 在
      //     规则链之前就返回）与「首位是 image/flow 命中」的轮（关键词规则根本轮不到）
      //     一律零调用——避免白花 1.2s 且结果必然被丢弃。
      let omitted: ReadonlySet<string> | undefined
      // v1.3.0 可观测性补链：判词结论以注记进决策原因串（前置，避免被 120 字截断吃掉）。
      let confirmNote: string | undefined
      const gatePreset = activePreset()
      const gateCfg = gatePreset?.hitConfirm
      // v2.0.0（评审 S7）：子代理零判官调用——关键词规则都不参与，语义闸更无理由点火。
      if (!skipKeywordRules && deps.hitConfirm !== undefined && gatePreset !== undefined && gateCfg?.enabled === true) {
        const turnText = latestUserText(payload.messages)
        // v1.3.0 A7 定向修复：判官（= 本预设的 default）的档位支持集，供闸门判定是否
        // 钉 off。取不到（枚举未完成 / 适配器未暴露）即不下发——绝不猜。
        const judgeSupportedEfforts = router.metas.find(
          (m) => m.provider === gatePreset.default.provider && m.model === gatePreset.default.model,
        )?.reasoningEfforts
        // Q6：判据与 decide 同源——`@README.md` / `@deepseek-ai/…` 这类误判不再
        // 跳过语义闸（原来词法命中即短路，该问判官的一轮不问）。
        if (effectiveExplicitDirective(turnText, router.knownProviders()) === null) {
          const head = routableHits(router.config, matchingScored(router.config, turnText, hasImage))[0]
          if (head !== undefined && head.rule.when.kind === 'keywords' && !isFlowTarget(head.rule.target)) {
            const verdict = await deps.hitConfirm.review(
              turnText,
              [{ ruleId: head.rule.id, group: head.rule.when.group, targetKey: configKey(head.rule.target) }],
              gatePreset.default,
              {
                ...(gateCfg.timeoutMs === undefined ? {} : { timeoutMs: gateCfg.timeoutMs }),
                ...(gateCfg.maxTokens === undefined ? {} : { maxTokens: gateCfg.maxTokens }),
                // v1.3.0 A7 定向修复：判官的档位支持集取自**运行期候选池**（与
                // effortForTarget 同源），闸门据此决定是否钉 off——判官是推理模型，
                // 不钉档位时 64 token 会被 reasoning 吃光、正文恒为空（实机实证）。
                ...(judgeSupportedEfforts === undefined ? {} : { efforts: judgeSupportedEfforts }),
                signal: payload.signal,
              },
            )
            // 判否 ⇒ 该规则不进路由链（decide 内按 omittedRuleIds 过滤）；无结论 ⇒ 不过闸。
            if (verdict.omitRuleId !== null) omitted = new Set([verdict.omitRuleId])
            confirmNote = confirmNoteOf(head.rule.id, verdict)
          }
        }
      }
      // 分工表命中（v2.0.0，优先级链第 3 档）：仅队友查身份（主会话恒 undefined ⇒
      // role 分支不点火）；R2 字段判据 roles ?? {}（不以 version 门控，同上 teamCfg 注）。
      const membership = isChild ? deps.teamLookup?.(agent) : undefined
      const roleHit = resolveRoleDecision(teamCfg.roles ?? {}, membership)
      // §8-6 可用性护栏（R7）：role 目标须在候选池中且可用（available !== false）
      // 才改道。不可用 ⇒ 不套用 role 决策——走既有决策路径（子代理通常落打底，
      // 再由 B-1a 让位保持继承值），不静默换人；面板由派发元信息
      // （basis=keep + roleLabel/teammate，见下方槽位写入）提示。
      const roleTargetUsable = roleHit === undefined || router.metas.some(
        (m) => m.provider === roleHit.role.target.provider && m.model === roleHit.role.target.model && m.available !== false,
      )
      const effectiveRoleHit = roleTargetUsable ? roleHit : undefined
      // 决策后处理链（顺序不可变）：role 覆盖（不覆盖显式 @ 与 flow；目标不可用
      // 时不套用）→ 主驱动恒定（仅主会话、仅打底）。三处 decide 调用点**同带**
      // ——转述后的重跑若不过链，终决策会丢 role 改道与 sticky（与判否集合/注记
      // 三处同传同款理由）。注意在 withConfirmNote **之前**过链：注记须前置拼进
      // 最终原因串。
      const postProcess = (d: RouteDecision): RouteDecision =>
        applyDriverSticky(applyRoleDecision(d, effectiveRoleHit), isChild, teamCfg.driver, teamCfg.driverSticky)
      // 4. 决策（三处调用**同带判否集合**——转述后的重跑若不传，被判否的规则会复活；
      //    注记同样三处同带，否则重跑会把判词从原因串里抹掉）
      let decision = withConfirmNote(postProcess(router.decide(payload.messages, payload.step, hasImage, omitted, { skipKeywordRules })), confirmNote)
      let flowId: string | undefined
      // 0.6.x池#a：转述成败摘要（ok/total + 败图 id + visionModel）——onDecision
      // extra 透传给投影 lastFlowEvent（≤120 截断在推送侧）。
      let flowDigest: string | undefined
      const latchTarget = effectiveVisionTarget(router, decision)
      // 5. eager 转述（规则目标 = transcribe 流）
      if (decision.kind === 'flow') {
        flowId = decision.flowId
        const flow = decision.flow
        // 并发转述（评审修复 2026-08-23）：图间无依赖，串行 await 会把视觉调用
        // 延迟按图数叠加在 pre-step 这个整轮阻塞点上。Transcriber 的失败集/LRU
        // 均按 attachmentId 隔离，text() 内部不抛（null=失败），Promise.all
        // 无拒绝短路风险；结果按提交序回收，标记/日志语义与串行一致。
        const { failedIds, okCount, total } = await transcribeBatch(flowId, flow, untranscribed, transcribeSignal, agent)
        flowDigest = flowDigestOf(okCount, total, failedIds, flow.visionModel)
        if (failedIds.length === 0) {
          hasImage = false
          decision = withConfirmNote(postProcess(router.decide(payload.messages, payload.step, false, omitted, { skipKeywordRules })), confirmNote)
        } else if (flow.failurePolicy === 'latch-image') {
          decision = {
            kind: 'route',
            target: { ...flow.visionModel },
            reason: `flow:${flowId} 转述失败（latch-image）→ 原生视觉作答`,
            via: 'rule',
          }
          hasImage = true
        } else {
          for (const id of failedIds) images.mark(agent, id, 'blind')
          hasImage = false
          decision = withConfirmNote(postProcess(router.decide(payload.messages, payload.step, false, omitted, { skipKeywordRules })), confirmNote)
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
            // 缺 ref 的历史图视同失败（插件重挂载前进入会话，无 ref 可查）。
            const missingIds: string[] = []
            const imgs: ResolvedImage[] = []
            for (const [id] of native) {
              const img = imageRefs.get(id)
              if (img === undefined) missingIds.push(id)
              else imgs.push(img)
            }
            const { failedIds, okCount } = await transcribeBatch(flowId, flow, imgs, transcribeSignal, agent)
            const allFailed = [...missingIds, ...failedIds]
            flowDigest = flowDigestOf(okCount, imgs.length + missingIds.length, allFailed, flow.visionModel)
            if (allFailed.length > 0) {
              if (flow.failurePolicy === 'latch-image') {
                // 败图保持 native，本轮落 flow.visionModel 原生视觉作答
                decision = {
                  kind: 'route',
                  target: { ...flow.visionModel },
                  reason: `flow:${flowId} lazy 转述失败（latch-image）→ 原生视觉作答`,
                  via: 'rule',
                }
              } else {
                for (const id of allFailed) images.mark(agent, id, 'blind')
              }
            }
            // 全成（或 blind 放行）：decision 不变——放行文本目标，投影缝供转述文字
          }
          // blind → 不动（rc.2 原生占位投影兜底）
        }
      }
      // 6.5 评审流武装（1.1.0 §5.1，gated 形式——R7 裁定：运行期武装尊重
      // reviewer 可用性，无谓词 fallback 仅属 previewRoute）：显式 @ 由
      // reviewTriggerHit 内部抑制（Q6 后只认**已知 provider** 的显式 @——`@README.md`
      // 这类误判不再静默关掉武装）；armed 每轮 step-1 重置/覆盖
      // （L2：无 turn-stopping 的关闭路径残留至下一轮覆盖，静默跳过）。router
      // off 时 installRouter 整体未挂载，天然关闭。
      const turnText = latestUserText(payload.messages)
      // v1.4.0 评审闭环：**修订轮不重新武装**——注入文本里天然带「意见/评审」等
      // 认领词，若照常武装，一次修订会在轮末再触发一次评审（配额翻倍，且与复检
      // 重复）。判据是消息 source（本插件签名），不是文本内容。
      const hit = isReviseMessage(latestUserMessage(payload.messages))
        ? null
        : reviewTriggerHit(router.config, turnText, reviewerAvailable, router.knownProviders())
      // fix round 1 F1（R10）：feed 常挂（每 agent 一次，首个 step-1 即登记）——
      // lastTurn 滚动维护「不依赖 armed」（spec §5.2），trigger=manual（预置
      // 默认态）用户的手动命令才有上一轮可评；武装命中只决定 turn-stopping
      // 侧本轮是否评审，不决定 feed 挂载。
      wireSessionFeed(agent)
      if (hit !== null) {
        armed.set(agent, { turn: payload.turn, flowId: hit.flowId, flow: hit.flow, userText: turnText })
      } else {
        armed.delete(agent)
      }
      // 7. 槽位 + 观测回调（dispatch：子代理派发元信息，请求层记账消费；主会话 undefined）
      slots.set(agent, {
        decision,
        hasImage,
        // §8-6：role 命中但目标不可用 ⇒ 记 basis='keep'（不新增枚举值）并带上
        // roleLabel/teammate——面板据此显示「分工表「前端」目标不可用 → 保持继承」。
        dispatch: isChild
          ? roleHit !== undefined && !roleTargetUsable
            ? { basis: 'keep', teammate: roleHit.name, roleLabel: roleHit.role.label }
            : dispatchMetaOf(membership, roleHit, decision)
          : undefined,
      })
      onDecision?.(agent, decision, flowId === undefined
        ? undefined
        : { flowId, ...(flowDigest === undefined ? {} : { flowDigest }) })
      return result
    }, { prepend: true })
    const disposeRequest = ctx.on('agent/request', async (payload, next) => {
      const resolved = await next()
      const slot = slots.get(payload.agent)
      if (slot === undefined) return resolved
      slots.delete(payload.agent)
      // 记账（设计稿 D7，Task 5）：只在槽位带 dispatch 元信息时记一条——pre-step
      // 仅 isChild（delegationDepth > 0）写入 dispatch，主会话轮槽位该字段恒
      // undefined，天然不记。目标取**图像护栏之后**的最终值（护栏可能二次改道），
      // 故在护栏后的两个 return 路径上各调一次；键相关 id 只取字符串
      // （parentSession/agentId），不持 Agent 引用。
      const recordDispatch = (applied: LlmCallConfig): void => {
        if (slot.dispatch === undefined || deps.onDispatch === undefined) return
        const header = (payload.agent as unknown as { session?: { header?: { parentSession?: string } } }).session?.header
        deps.onDispatch(payload.agent, {
          ...slot.dispatch,
          target: {
            provider: applied.provider,
            model: applied.model,
            ...(applied.reasoningEffort === undefined ? {} : { effort: applied.reasoningEffort }),
          },
          at: Date.now(),
          parentSession: header?.parentSession,
          agentId: (payload.agent as unknown as { id?: string }).id,
        })
      }
      // B-1a（2026-09-20 缺陷修复，docs/audit/2026-09-20-defect-explicit-model-pin-
      // overridden-by-preset-default.md）：打底让位于**委派子代理**的外部显式目标。
      // 打底之前的语义是「未命中 ≠ keep → 预设默认」，但它只看消息文本；子代理被
      // 点名的 kimi-coding/k3 因此被静默改写成预设默认（实机两次对照探针坐实）。
      // 让位后仍走图像护栏与后续日志，只是不再改写 provider/model。
      const yieldToExternal = shouldKeepExternalTarget(slot.decision, resolved, payload.agent)
      let replaced = yieldToExternal ? resolved : router.applyTo(resolved, slot.decision)
      if (yieldToExternal && slot.decision.kind === 'route') {
        // 留痕（沿用 v1.3.0 confirmNote 模式）：打底按既有语义不上报面板，不特殊
        // 处理的话「这轮为什么没走省钱默认」同样不可见。
        const note = `打底让位：外部显式目标 ${resolved.provider}/${resolved.model}（≠预设默认 ${slot.decision.target.provider}/${slot.decision.target.model}）`
        deps.onDecision?.(payload.agent, withConfirmNote(slot.decision, note))
        ctx.logger?.info?.(`kimi-router: ${note}`)
      }
      // Image guard runs AFTER routing: an image-bearing step must never hit
      // a text-only route (typically the deepseek primary), whether it came
      // from a route decision or from the session's base model selection.
      // 0.6.0：护栏输入 = 槽位 hasImage（本轮未转述图语义）——flow 已消费的图
      // 不触发（hasImage 已 false）；replaceRoute/effort 映射逻辑不动。
      const guard = router.guardImage({ provider: replaced.provider, model: replaced.model }, slot.hasImage)
      if (guard !== null) {
        replaced = router.replaceRoute(replaced, guard.target)
        ctx.logger?.info?.(`kimi-router: ${guard.reason} → ${replaced.provider}/${replaced.model}`)
        recordDispatch(replaced)
        return replaced
      }
      if (replaced !== resolved) {
        const label = slot.decision.kind === 'route'
          ? slot.decision.reason
          : slot.decision.kind === 'flow' ? `flow:${slot.decision.flowId}` : 'kept'
        // B-1a 留痕（覆盖侧）：打底把一个与预设默认不同的传入目标换掉时，日志里点名
        // 被覆盖者——否则「谁被换掉了」在决策串里是隐去的（面板对打底同样不上报）。
        const overridden = slot.decision.kind === 'route' && slot.decision.via === 'default'
          && (resolved.provider !== slot.decision.target.provider || resolved.model !== slot.decision.target.model)
          ? `（覆盖外部目标 ${resolved.provider}/${resolved.model}）`
          : ''
        ctx.logger?.info?.(`kimi-router: agent request → ${replaced.provider}/${replaced.model} (${label})${overridden}`)
      }
      recordDispatch(replaced)
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
      // 0.8.x⑧：辅助请求改道——非 agent-loop 辅助调用（信封带 purpose，宿主
      // 深冻结）按 auxTargets[purpose] 覆写 provider/model；effort 语义与
      // replaceRoute 一致（继承值对目标支持集判定，不支持即剥离/钳制）。守卫
      // 同款：自派 opts2 再入瀑布时被 inFlight 放行到 next()（下游投影缝照常
      // 消费）。配置缺席/无该 purpose 键/目标不可用 → 原样放行（auxRewriteTarget）。
      const auxTarget = auxRewriteTarget(router.config, router.metas, (options as { purpose?: unknown }).purpose)
      if (auxTarget !== null) {
        // llm/stream 载荷是 GenerateOptions（带 messages），与 agent/request 的
        // LlmCallConfig 不同形——effort 语义经同一条 effortForTarget 写路径内联
        // 对齐 replaceRoute（显式覆盖 → 支持集判定/越级钳制/未知剥离）。显式解构
        // 是刻意的：spread 合并删不掉原载荷已有的 reasoningEffort 键，「剥离」
        // 必须以键不出现的形式落地（标题请求不得携带思考等级）。
        const { reasoningEffort: inherited, ...rest } = options
        const effort = effortForTarget(router.metas, auxTarget, inherited, auxTarget.effort)
        const opts2 = {
          ...rest,
          ...(effort === undefined ? {} : { reasoningEffort: effort }),
          provider: auxTarget.provider,
          model: auxTarget.model,
        }
        ctx.logger?.info?.(`kimi-router: 辅助请求 purpose=${String((options as { purpose?: unknown }).purpose)} → ${auxTarget.provider}/${auxTarget.model}`)
        inFlight.add(opts2)
        return ctx.llm.stream(opts2)
      }
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
    // ---- Review flow 1.1.0 编排（spec §5；armed/累计/turn-stopping 异步评审/手动钩子）----
    // 槽位全部 Weak 键控：条目随 agent GC 回收；installRouter 重挂载=effect 闭包
    // 整体重建（armed/lastTurn/outputs 随之重建，丢最近一轮缓存可接受，spec §10）。
    //   armed——本轮武装（pre-step step-1 命中写、turn-stopping 消费删、每轮覆盖）；
    //   outputs——按轮累计的 assistant 文本（REVIEW_INPUT_LIMIT 停收 + 截断标注）；
    //   lastTurns——每 agent 最近一轮 {turn, userText, output} 滚动缓存（手动命令消费，
    //   spec §5.2「不依赖 armed」——任何产出非空的轮都更新；v1.4.0 起带轮号，
    //   手动评审的 turn:-1 载荷据此拿到复检基准）；
    //   sessionWired——session/event feed 的按 agent 去重。
    const armed = new WeakMap<Agent, { turn: number; flowId: string; flow: ReviewFlow; userText: string }>()
    const outputs = new WeakMap<Agent, { turn: number; text: string }>()
    const lastTurns = new WeakMap<Agent, { turn: number; userText: string; output: string }>()
    const sessionWired = new WeakSet<Agent>()
    // ---- v1.4.0 评审闭环（spec §3.4/§3.6）：按 agent 的修订台账 ----
    //   lastReview——最近一条**已交付**的评审载荷（手动退回的判据来源）；
    //   revisions——{ 最近被修订的轮, 已用修订次数 }（幂等键 + 上限计数，
    //               自动与手动共享同一本账：spec §3.4「手动退回同样计上限」）；
    //   recheckQueue——待复检标记（修订后那一轮的 turn-stopping 消费一次）。
    // 三者皆 Weak 键控，随 agent GC；installRouter 重挂载即整体重建（与 armed 同款）。
    const lastReview = new WeakMap<Agent, ReviewEventPayload>()
    // 修订台账**按流分账**（v1.4.0 修复：单槽会被跨流误判——rounds 是每流配置，
    // A 流的两轮不该吃掉 B 流的额度）：flowId → { 最近被修订的轮, 已用次数 }。
    const revisions = new WeakMap<Agent, Map<string, { turn: number | null; count: number }>>()
    const recheckQueue = new WeakMap<Agent, {
      flowId: string
      flow: ReviewFlow
      afterTurn: number
      /** 复检的**身份闸**：预期被修订的那一轮（afterTurn+1; afterTurn<0 时 null=首轮）。 */
      expectedTurn: number | null
    }>()
    // 修订注入到达标记（复检身份闸的第二重）：feed 见本源 user/message 置位，
    // 紧随其后的 assistant/message 把「这一轮带了修订」落到该轮的轮号上。
    const reviseInjected = new WeakMap<Agent, true>()
    const reviseTurns = new WeakMap<Agent, number>()
    // 1.4.1：评审 runner 接上档位查询缝（与 createStreamVisionCaller 同款：目标
    // 支持集来自同一份 metas 池），reviewer.effort 才能真的下发到适配器。
    const runReview = createReviewRunner(ctx, (target) =>
      router.metas.find((m) => m.provider === target.provider && m.model === target.model)?.reasoningEfforts)
    // 重挂载惰性闸：agent.ctx 上的 feed 无法逐个注销（不强持 agent 引用），dispose
    // 置 false 使旧闭包的 feed 立即停摆（spec §5.2「重挂载 dispose 全部监听」）；
    // 注册本体随 agent dispose 由 Agent.ctx 作用域自动卸载（runtime-types :72）。
    let feedsLive = true

    const reviewerAvailable = (target: RouteTarget): boolean =>
      router.metas.some((m) => m.provider === target.provider && m.model === target.model && m.available)

    // 累计侧截断标注（与 review.ts truncate 标注逐字一致）。预算按标记长度补偿：
    // cap = LIMIT - 标注长（6）→ 截断后总长恰为 REVIEW_INPUT_LIMIT，buildReviewInput
    // 的兜底 truncate 视其 ≤ 上限原样放行，标注得以保留在最终评审输入（L5 二选一
    // 取「预算补偿」枝）。
    const REVIEW_TRUNCATION_MARKER = '…（已截断）'
    const appendCapped = (existing: string, incoming: string): string => {
      if (existing.length >= REVIEW_INPUT_LIMIT) return existing // 已封顶：停收
      const cap = REVIEW_INPUT_LIMIT - REVIEW_TRUNCATION_MARKER.length
      const merged = existing + incoming
      return merged.length <= cap ? merged : merged.slice(0, cap) + REVIEW_TRUNCATION_MARKER
    }
    const textBlocksOf = (blocks: ReadonlyArray<{ type?: string; text?: unknown }>): string =>
      blocks.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('')

    /**
     * 退回事件落盘 + 交付（spec §3.6）。写入闸与评审事件同源（reviewEventWritable
     * ——宿主会话目录里没有这个类型时不写，避免产出宿主读不出的日志）。
     */
    const emitRevise = (agent: Agent, payload: ReviewRevisePayload): void => {
      if (deps.reviewEventWritable === false) {
        // 诚实口径（v1.4.0 复核）：这条路径**只**跑事件回调（index.ts 的内存
        // dock 行），刷新即无——别在告警里承诺"面板仍可见"。
        ctx.logger?.warn?.('kimi-router: 宿主会话目录不含退回事件类型——本次退回不写入会话日志（无回读留痕，仅当次面板行）')
      } else {
        try {
          agent.session.append(KIMI_TIDE_REVISE_EVENT, payload)
        } catch (error) {
          ctx.logger?.warn?.(`kimi-router: revise append failed: ${(error as Error).message}`)
        }
      }
      try {
        deps.onReviewRevise?.(agent, payload)
      } catch (error) {
        ctx.logger?.warn?.(`kimi-router: onReviewRevise callback failed: ${(error as Error).message}`)
      }
    }

    /**
     * 起一次修订（自动/手动**唯一**通道，spec §3.2）：`agent.steer` 注入一条
     * 本插件签名的 user 消息，由宿主轮循环正常起下一轮。
     *
     * 四道护栏在这一次调用里全部落地：幂等（同轮只一次，仅自动支）、上限
     * （`flows.review.rounds` 为本会话修订次数上限，自动/手动共账）、
     * 留痕（`kimi-tide/review-revise`）、终止（超限时只落 stopped 事件不 steer）。
     */
    const issueRevise = (agent: Agent, input: {
      flowId: string
      flow: ReviewFlow
      reason: 'auto' | 'manual'
      turn: number
      verdict: ReviewVerdict
      reviewText: string
      afterTurn: number
    }): { ok: boolean; message: string } => {
      const book = revisions.get(agent) ?? new Map<string, { turn: number | null; count: number }>()
      revisions.set(agent, book)
      const state = book.get(input.flowId) ?? { turn: null, count: 0 }
      book.set(input.flowId, state)
      // 幂等（spec §3.4）：同一轮只允许一次**自动**修订。手动是用户显式行为、不受此限
      // （spec §3.4 明写），但手动**也写** turns 键——否则「手动退过第 N 轮 → 第 N 轮
      // 的自动评审迟到送达」会再退一次同一轮（v1.4.0 修复）。
      if (input.reason === 'auto' && state.turn === input.turn) {
        return { ok: false, message: '本轮已退回过一次（幂等）' }
      }
      const limit = Number.isFinite(input.flow.rounds) && input.flow.rounds >= 1 ? Math.floor(input.flow.rounds) : 1
      const at = new Date().toISOString()
      if (state.count >= limit) {
        emitRevise(agent, {
          flowId: input.flowId, turn: input.turn, reason: input.reason,
          verdict: input.verdict, reviseIndex: state.count, stopped: 'limit', at,
        })
        return { ok: false, message: `已达修订上限（本会话该流最多 ${limit} 次）` }
      }
      try {
        agent.steer(createReviseMessage({ reviewText: input.reviewText, verdict: input.verdict }))
      } catch (error) {
        // 轮已销毁/驱动已停：不落退回事件（没退成就不该留痕），也不向上抛。
        ctx.logger?.warn?.(`kimi-router: revise failed: ${(error as Error).message}`)
        return { ok: false, message: `退回失败：${(error as Error).message}` }
      }
      state.count += 1
      state.turn = input.turn
      emitRevise(agent, {
        flowId: input.flowId, turn: input.turn, reason: input.reason,
        verdict: input.verdict, reviseIndex: state.count, at,
      })
      // 复检（spec §4：`flows.review.recheck` 默认开）——修订轮收官时再评一轮；
      // 该追加评审同样受 rounds 上限约束（复检若再判不通过，退回时要过 issueRevise
      // 的上限闸）。身份闸见 recheckQueue 注释与 turn-stopping 分支。
      if (input.flow.recheck !== false) {
        recheckQueue.set(agent, {
          flowId: input.flowId,
          flow: input.flow,
          afterTurn: input.afterTurn,
          expectedTurn: input.afterTurn >= 0 ? input.afterTurn + 1 : null,
        })
      }
      return { ok: true, message: `已按评审意见退回重做（第 ${state.count} 次）` }
    }

    /**
     * 评审交付后的编排分支（spec §3.1 自动修订）：`autoRevise === true`
     * ∧ 评审成功 ∧ 结论判为「不通过／有条件通过」⇒ 退回重做。
     * 其余一切情形（开关关、评审失败、判「通过」、结论解析不出）都**不**动手。
     */
    const consumeReview = (agent: Agent, req: ReviewRequest, event: ReviewEventPayload): void => {
      lastReview.set(agent, event)
      if (req.flow.autoRevise !== true || event.ok !== true) return
      if (!isRevisableVerdict(event.verdict)) return
      issueRevise(agent, {
        flowId: req.flowId,
        flow: req.flow,
        reason: 'auto',
        turn: req.turn,
        verdict: event.verdict,
        reviewText: event.reviewText,
        afterTurn: req.turn,
      })
    }

    const finishReview = (agent: Agent, req: ReviewRequest): void => {
      void runReview(req)
        .then((event) => {
          // v1.2.0：宿主目录未命中即拒写（fail closed，见 RouterOrchestrationDeps.
          // reviewEventWritable）。拒写只丢「会话日志里的那条记录」，评审正文仍经
          // onReviewEvent 交付给 dock；反过来写进去会让整个会话读不出来。
          if (deps.reviewEventWritable === false) {
            ctx.logger?.warn?.('kimi-router: 宿主会话目录不含评审事件类型——本次评审不写入会话日志（避免产出宿主读不出的日志）；评审结果仍经面板可见')
          } else {
            try {
              agent.session.append(KIMI_TIDE_REVIEW_EVENT, event)
            } catch (error) {
              // M4 兜底：目标 session 已销毁等 append 失败不向上抛，落 warn。
              ctx.logger?.warn?.(`kimi-router: review append failed: ${(error as Error).message}`)
            }
          }
          // fix round 1 F4：评审本体已成功——onReviewEvent 观测回调抛错单独归因
          // 落 warn，不得炸进下方 catch 被「review failed」误归因。
          try {
            deps.onReviewEvent?.(agent, event)
          } catch (error) {
            ctx.logger?.warn?.(`kimi-router: onReviewEvent callback failed: ${(error as Error).message}`)
          }
          // v1.4.0：评审交付后接编排分支（自动退回）。单独 try——编排异常不得
          // 被上面的 catch 误归成「review failed」。
          try {
            consumeReview(agent, req, event)
          } catch (error) {
            ctx.logger?.warn?.(`kimi-router: review consume failed: ${(error as Error).message}`)
          }
        })
        .catch((error: unknown) => {
          ctx.logger?.warn?.(`kimi-router: review failed: ${(error as Error).message}`)
        })
    }

    // session/event 监听：注册在 agent.ctx（agent 作用域——插件级 ctx 收全量会话
    // 且载荷 (session, event) 无 agent 反查，无法键入 armed；spec §5.2 注册机制
    // 评审修复 M2，dsh-scope 作用域过滤=只收该 agent 进入的会话）。首次 pre-step
    // 拿到 agent 时登记一次，随 agent dispose 卸载。事件序锚定（dsh-agent-loop
    // lib/index.js）：pre-step(:506) 先于本轮 user/message 追加(:559)，assistant/
    // message(:639/:680) 其后，turn-stopping(:570) 收尾——armed 先立、人类输入后
    // 到、产出对齐 armed.turn 累计。
    const wireSessionFeed = (agent: Agent): void => {
      if (sessionWired.has(agent)) return
      const agentCtx = (agent as { ctx?: { on?: (name: string, listener: (session: unknown, event: unknown) => void) => () => void } }).ctx
      if (agentCtx?.on === undefined) return
      sessionWired.add(agent)
      agentCtx.on('session/event', (_session: unknown, raw: unknown) => {
        if (!feedsLive) return
        const event = raw as {
          type?: string
          data?: {
            turn?: number
            interrupted?: boolean
            message?: { content?: ReadonlyArray<{ type?: string; text?: unknown }> }
            content?: ReadonlyArray<{ type?: string; text?: unknown }>
            source?: { kind?: string }
          }
        }
        if (event.type === 'user/message') {
          // L3（source 实读锚定）：user/message 载荷 = UserMessage，`source` 区分
          // 人类输入 / synthetic agent.inject() 注入 / goal 续轮（dsh-session
          // lib/types/types.d.ts:255-262 文档契约；dsh-llm lib/types/message.d.ts
          // :94-104 MessageSourceMap 唯一人类枝 kind==='user'，注入/goal 走 plugin
          // 枝——dsh-agent-loop RuntimeContextProjection isOwned 同款判定实证）。
          // 仅人类输入刷新 lastTurn.userText；顺带刷新 armed.userText（本轮人类
          // 文本覆盖 pre-step latestUserText 可能取到的注入文本，评审需求恒人类）。
          // v1.4.0：本插件自己的修订注入先落一个「本轮接过修订」标记（复检归属
          // 的身份闸），它**不是**人类输入，故不刷新 lastTurn/armed。
          if (isReviseMessage(event.data)) {
            reviseInjected.set(agent, true)
            return
          }
          if (event.data?.source?.kind !== 'user') return
          const humanText = appendCapped('', textBlocksOf(event.data.content ?? []))
          if (humanText.trim() === '') return
          const armedEntry = armed.get(agent)
          if (armedEntry !== undefined) armedEntry.userText = humanText
          const prev = lastTurns.get(agent)
          lastTurns.set(agent, { turn: prev?.turn ?? -1, userText: humanText, output: prev?.output ?? '' })
          return
        }
        if (event.type !== 'assistant/message') return // 防环：kimi-tide/review 等其余类型直接忽略
        if (event.data?.interrupted === true) return // 中断前缀不计入产出
        const turn = event.data?.turn
        // 修订注入后的第一轮产出：把「这一轮带了修订」记到轮号上（身份闸落点）。
        if (reviseInjected.get(agent) === true) {
          reviseInjected.delete(agent)
          reviseTurns.set(agent, turn ?? -1)
        }
        const turnText = textBlocksOf(event.data?.message?.content ?? [])
        const tracked = outputs.get(agent)
        if (tracked === undefined || tracked.turn !== turn) {
          outputs.set(agent, { turn: turn ?? -1, text: appendCapped('', turnText) })
        } else {
          tracked.text = appendCapped(tracked.text, turnText)
        }
        const out = outputs.get(agent)
        if (out !== undefined && out.turn === (turn ?? -1) && out.text.trim() !== '') {
          // lastTurn 滚动维护（spec §5.2「不依赖 armed」，fix round 1 F1/R10）：
          // assistant（非 interrupted）轮产出非空即更新；userText 取最近人类输入
          // 的滚动值（user/message 人类枝维护，L3 判定不变）。armed 匹配性只影响
          // turn-stopping 侧「本轮是否评审」，不影响 lastTurn 维护。
          const rolling = lastTurns.get(agent)
          lastTurns.set(agent, { turn: out.turn, userText: rolling?.userText ?? '', output: out.text })
        }
      })
    }

    // turn-stopping：serial 派发且被 loop await（agent-loop :570）——handler 必须
    // 同步返回（评审异步跑，轮零阻塞，spec §2 派生事实）。{prepend:true} 与
    // 其余四监听器注册形态对齐（fix round 1 F3，:560-569 惯例）；serial 监听
    // 无返回值竞争，顺序无行为差异——纯惯例一致。
    const disposeStop = ctx.on('agent/turn-stopping', (raw: unknown) => {
      const payload = raw as { agent?: Agent; turn?: number }
      const agent = payload.agent
      if (agent === undefined) return
      // **身份闸**（v1.4.0 复核 F1 修复）：光看「轮号更大」会把用户插话的那一轮
      // 误当修订轮（评审卡张冠李戴 + lastReview 被无关产出覆盖）。判据收紧为
      // 「feed 确实见过本插件的注入、且它落在这一轮」——注入是宿主写进同一份
      // 会话日志的 user/message，feed 必然看得到；看不到就不评（安全方向）。
      const pending = recheckQueue.get(agent)
      if (pending !== undefined && typeof payload.turn === 'number' && payload.turn > pending.afterTurn) {
        recheckQueue.delete(agent)
        const injectedTurn = reviseTurns.get(agent)
        const onTargetTurn = injectedTurn === payload.turn
        const recheckOut = outputs.get(agent)
        if (onTargetTurn && recheckOut !== undefined && recheckOut.turn === payload.turn && recheckOut.text.trim() !== '') {
          finishReview(agent, {
            flowId: pending.flowId,
            flow: pending.flow,
            turn: payload.turn,
            userText: lastTurns.get(agent)?.userText ?? '',
            output: recheckOut.text,
          })
        } else {
          ctx.logger?.info?.(`kimi-router: 复检跳过——第 ${payload.turn} 轮不是本次修订的承载轮（预期 ${pending.expectedTurn ?? '首轮'}；不把无关产出当修订产出评）`)
        }
        return
      }
      const entry = armed.get(agent)
      if (entry === undefined || entry.turn !== payload.turn) return
      armed.delete(agent)
      const out = outputs.get(agent)
      if (out === undefined || out.turn !== payload.turn || out.text.trim() === '') return
      finishReview(agent, { flowId: entry.flowId, flow: entry.flow, turn: entry.turn, userText: entry.userText, output: out.text })
    }, { prepend: true })

    // 手动评审实现（spec §8）：取 lastTurn 缓存；无缓存返回可呈现文案。
    deps.onManualReview?.(async (agent: Agent) => {
      const last = lastTurns.get(agent)
      if (last === undefined || (last.userText === '' && last.output === '')) {
        return { ok: false, message: '无可评审的上一轮' }
      }
      const flows = isV5Plus(router.config) ? router.config.flows : {}
      const manual = Object.entries(flows).find(([, f]) => f.type === 'review' && reviewerAvailable(f.reviewer))
      if (manual === undefined) return { ok: false, message: '没有可用的评审流（reviewer 不可用）' }
      finishReview(agent, { flowId: manual[0], flow: manual[1] as ReviewFlow, turn: -1, userText: last.userText, output: last.output })
      return { ok: true, message: '评审已发起' }
    })

    /**
     * 手动退回实现（v1.4.0 §3.1）：**不依赖 autoRevise 开关**，任何一次已交付的
     * 评审都能一键退回；同样计 rounds 上限。判据取最近一条评审载荷（含手动评审
     * 的 turn:-1 载荷——复检基准改用 lastTurn 的真实轮号）。
     */
    deps.onManualRevise?.(async (agent: Agent) => {
      const review = lastReview.get(agent)
      if (review === undefined) return { ok: false, message: '还没有可退回的评审结论（先评一轮：/kimi-tide review）' }
      if (review.ok !== true) return { ok: false, message: '最近一次评审失败，没有可退回的结论' }
      const flows = isV5Plus(router.config) ? router.config.flows : {}
      const flow = flows[review.flowId]
      if (flow === undefined || flow.type !== 'review') {
        return { ok: false, message: `评审流 '${review.flowId}' 已不存在（配置改过？）` }
      }
      // 人工退回是用户的显式命令：**不做结论闸**（结论判「通过」也允许重做——
      // 用户比评审更清楚要不要返工），但注入文本如实带上结论标签。
      const afterTurn = review.turn >= 0 ? review.turn : (lastTurns.get(agent)?.turn ?? -1)
      return issueRevise(agent, {
        flowId: review.flowId,
        flow,
        reason: 'manual',
        turn: review.turn,
        verdict: review.verdict,
        reviewText: review.reviewText,
        afterTurn,
      })
    })

    return () => {
      disposePre()
      disposeRequest()
      disposeStream()
      disposeAdmission()
      disposeStop()
      feedsLive = false
      deps.onManualReview?.(null)
      deps.onManualRevise?.(null)
    }
  })
}

/**
 * 0.8.x⑧（池⑧ 辅助请求路由改道）：判定一个 llm/stream 载荷是否为可改道的
 * 辅助请求。宿主非 agent-loop 辅助调用（会话标题等）的信封携带 `purpose`
 * 字段（深冻结，经 llm/stream 拦截器可见——池⑦根因调查实证）；该 purpose
 * 命中 `config.auxTargets` 且目标在候选目录中可用 → 返回改道目标；否则
 * null = 原样放行。缺省/空表/无该键 = 不改道（向后兼容 v4/v5 旧配置）；
 * 目录读不到的目标不强行改道（保守放行，与规则目标不可用跳过同向）。
 */
function auxRewriteTarget(config: RouterConfigAny, metas: CandidateMeta[], purpose: unknown): RouteTarget | null {
  if (typeof purpose !== 'string' || purpose === '') return null
  const auxTargets = (config as { auxTargets?: Record<string, RouteTarget> }).auxTargets
  if (auxTargets === null || typeof auxTargets !== 'object') return null
  const target = auxTargets[purpose]
  if (target === undefined || isFlowTarget(target)) return null
  const meta = metas.find((m) => m.provider === target.provider && m.model === target.model && m.available)
  if (meta === undefined) return null
  return target
}

/** 0.6.x池#4：转述成败摘要（onDecision extra 透传，lastFlowEvent 消费；
 * 败图 id 最多列 3 个防超长，≤120 截断在推送侧兜底）。 */
function flowDigestOf(okCount: number, total: number, failedIds: readonly string[], visionModel: RouteTarget): string {
  return `转述 ${okCount}/${total} 成功`
    + (failedIds.length > 0 ? ` · 败 ${failedIds.slice(0, 3).join(',')}${failedIds.length > 3 ? '…' : ''}` : '')
    + ` · ${visionModel.model}`
}
