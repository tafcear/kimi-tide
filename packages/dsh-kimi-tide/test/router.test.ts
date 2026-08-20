import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import {
  applyImageGuard,
  canClaimImageAdmission,
  KimiRouter,
  messagesContainImage,
  type RouterConfigV1,
} from '../src/router.js'
import { DEFAULT_CONFIG_V3, type CandidateMeta, type RouterConfigV3 } from '../src/config.js'

/**
 * Real capability matrix (verified in @earendil-works/pi-ai provider data,
 * 2026-08-18): deepseek-v4-flash/pro declare `input: ["text"]` (text-only),
 * the Kimi k3 family declares `input: ["text","image"]` (multimodal). The
 * v1 assumption was inverted — the image guard must move image-bearing
 * steps OFF the text-only primary ONTO multimodal Kimi, never the reverse.
 *
 * KimiRouter v2 (0.3.0) takes (RouterConfigV3, CandidateMeta[], log); the
 * guard/admission helpers keep their v1 config vocabulary but resolve the
 * text-only provider set from candidate modalities instead of a hard-coded
 * provider set. `shimMetas` below derives the candidate metadata a 0.2.x
 * config implied, so these pre-v2 assertions keep their original semantics.
 */
const BASE: RouterConfigV1 = {
  mode: 'capability',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-coding', model: 'kimi-for-coding' },
  premiumLong: { provider: 'kimi-coding', model: 'k3' },
}

function userMessage(blocks: Array<{ type: string; text?: string }>): UserMessage {
  return { role: 'user', content: blocks } as unknown as UserMessage
}

/** Derive the candidate metadata a v1 config implied (real capability matrix). */
function shimMetas(config: RouterConfigV1): CandidateMeta[] {
  const targets = [config.primary, config.premium, config.premiumLong].filter(
    (t): t is NonNullable<typeof t> => t !== undefined,
  )
  return targets.map((t) => ({
    ...t,
    modalities: t.provider === config.primary.provider ? ['text'] : ['text', 'image'],
    costTier: t.provider === config.primary.provider ? ('cheap' as const) : ('mid' as const),
    available: true,
  }))
}

/** A v2 KimiRouter reproducing a v1 config's routing surface (same semantics). */
function shimRouter(config: RouterConfigV1): KimiRouter {
  const v2 = DEFAULT_CONFIG_V3()
  v2.mode = config.mode
  v2.default = config.primary
  if (config.premiumBudget !== undefined) v2.premiumBudget = config.premiumBudget
  if (config.budgetWindow !== undefined) v2.budgetWindow = config.budgetWindow
  return new KimiRouter(v2, shimMetas(config), { info: () => {} })
}

describe('messagesContainImage', () => {
  it('detects image blocks in user messages', () => {
    expect(messagesContainImage([userMessage([{ type: 'text', text: 'hi' }, { type: 'image' }])])).toBe(true)
  })

  it('ignores text-only batches', () => {
    expect(messagesContainImage([userMessage([{ type: 'text', text: 'hi' }])])).toBe(false)
  })
})

describe('image guard (direction: text-only route → multimodal Kimi; text-only set from metas)', () => {
  it('reroutes an image-bearing step from the text-only primary to the multimodal premium', () => {
    const guard = applyImageGuard({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, BASE, true, shimMetas(BASE))
    expect(guard).not.toBeNull()
    expect(guard!.target).toEqual(BASE.premium)
  })

  it('guards keep decisions too: cost mode keeps the primary, image still escalates to Kimi', () => {
    const router = shimRouter({ ...BASE, mode: 'cost' })
    const decision = router.decide([userMessage([{ type: 'image' }])], 1)
    expect(decision.kind).toBe('keep')
    const guard = router.guardImage({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, true)
    expect(guard?.target.provider).toBe('kimi-coding')
  })

  it('leaves multimodal Kimi targets alone', () => {
    expect(applyImageGuard({ provider: 'kimi-coding', model: 'k3' }, BASE, true, shimMetas(BASE))).toBeNull()
    expect(applyImageGuard({ provider: 'kimi-coding', model: 'kimi-for-coding' }, BASE, true, shimMetas(BASE))).toBeNull()
  })

  it('leaves image-free steps alone', () => {
    expect(applyImageGuard({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, BASE, false, shimMetas(BASE))).toBeNull()
  })

  it('does not touch providers outside the text-only set', () => {
    expect(applyImageGuard({ provider: 'other', model: 'x' }, BASE, true, shimMetas(BASE))).toBeNull()
  })

  it('bails out when the whole enumerated pool is text-only (degraded metas; host keeps the friendly rejection)', () => {
    // 8784f19 曾在此情形按 premium 身份强行改道，但那在生产 v2 形态（sidecar
    // default=kimi-coding/k3 → legacyConfig.premium=deepseek-flash）下会把图片
    // ping-pong 到真文本-only 的 deepseek。正确语义：池里没有任何可验证的多模态
    // 候选时，不声明/不改道 —— 宿主以「当前模型不支持图片」友好拒绝，而不是让
    // 适配器抛 UNSUPPORTED_CONTENT（2026-08-19 实机复测回归即此症状）。
    const degraded: CandidateMeta[] = [
      { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], costTier: 'cheap', available: true },
      { provider: 'kimi-coding', model: 'kimi-for-coding', modalities: ['text'], costTier: 'mid', available: true },
    ]
    expect(applyImageGuard({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, BASE, true, degraded)).toBeNull()
  })

  it('bails out when the premium route is itself text-only (no safe multimodal reroute)', () => {
    // A premium on a genuinely text-only provider (here deepseek) cannot serve
    // the image, so the guard must not ping-pong onto it.
    const config: RouterConfigV1 = { ...BASE, premium: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } }
    const textOnlyMetas: CandidateMeta[] = [
      { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], costTier: 'cheap', available: true },
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', modalities: ['text'], costTier: 'mid', available: true },
    ]
    expect(applyImageGuard({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, config, true, textOnlyMetas)).toBeNull()
  })
})

describe('KimiRouter.decide', () => {
  it('routes explicit @kimi directives to premium regardless of escalation config', () => {
    const router = shimRouter({ ...BASE, mode: 'cost' })
    const decision = router.decide([userMessage([{ type: 'text', text: '@kimi 帮我看看这个' }])], 1)
    expect(decision.kind).toBe('route')
    if (decision.kind === 'route') expect(decision.target).toEqual(BASE.premium)
  })

  it('cost mode keeps the primary when no escalation condition matches', () => {
    const router = shimRouter({ ...BASE, mode: 'cost' })
    const decision = router.decide([userMessage([{ type: 'text', text: '普通任务' }])], 1)
    expect(decision.kind).toBe('keep')
  })

  it('cost mode exhausts the premium budget window and falls back to keep', () => {
    const router = shimRouter({ ...BASE, mode: 'cost', premiumBudget: 0.2, budgetWindow: 5 })
    const messages = [userMessage([{ type: 'text', text: '请审查这段代码' }])]
    for (let i = 0; i < 5; i++) {
      expect(router.decide(messages, 1).kind).toBe('route')
    }
    const exhausted = router.decide(messages, 1)
    expect(exhausted.kind).toBe('keep')
    // The exhaustion decision records 'primary', sliding one premium out of
    // the 5-slot window: 4 premium + 1 primary.
    expect(router.budgetUsage()).toMatchObject({ premium: 4, window: 5 })
  })
})

describe('canClaimImageAdmission (host prompt pre-check deferral)', () => {
  // The host (dsh-host-apiproxy prompt RPC) rejects image prompts whose
  // CURRENT model selection is text-only BEFORE the agent loop runs — the
  // per-step image guard never gets a chance on a fresh session (default
  // model = text-only deepseek). The host patch defers via the agent-scoped
  // serial event `agent/image-admission`: a listener returning a truthy
  // value claims the image will be rerouted. Claim only when this router is
  // active AND the premium route is multimodal (a text-only premium cannot
  // serve the image — mirror of applyImageGuard's anti-ping-pong rule).

  it('claims when the router is active and the premium route is multimodal', () => {
    expect(canClaimImageAdmission({ ...BASE, mode: 'cost' }, shimMetas(BASE))).toBe(true)
    expect(canClaimImageAdmission(BASE, shimMetas(BASE))).toBe(true) // capability mode
  })

  it('does not claim when the router is off (host keeps its friendly rejection)', () => {
    expect(canClaimImageAdmission({ ...BASE, mode: 'off' }, shimMetas(BASE))).toBe(false)
  })

  it('does not claim when the premium route is itself text-only (no safe reroute)', () => {
    // A premium on the text-only primary provider cannot serve the image, so
    // the host keeps its friendly rejection. (A kimi premium is the multimodal
    // rail and is never treated as text-only, even if enumeration degrades.)
    const config: RouterConfigV1 = { ...BASE, mode: 'cost', premium: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } }
    const textOnlyMetas: CandidateMeta[] = [
      { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], costTier: 'cheap', available: true },
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', modalities: ['text'], costTier: 'mid', available: true },
    ]
    expect(canClaimImageAdmission(config, textOnlyMetas)).toBe(false)
  })

  it('honors an explicit textOnlyProviders override listing the premium provider', () => {
    const config: RouterConfigV1 = { ...BASE, mode: 'cost', textOnlyProviders: ['kimi-coding'] }
    expect(canClaimImageAdmission(config, shimMetas(config))).toBe(false)
  })

  it('claims when the text-only set does not include the premium provider', () => {
    const config: RouterConfigV1 = { ...BASE, mode: 'cost', textOnlyProviders: ['deepseek-official'] }
    expect(canClaimImageAdmission(config, shimMetas(config))).toBe(true)
  })
})

const msg = (text: string): UserMessage => ({ role: 'user', content: [{ type: 'text', text }] } as unknown as UserMessage)
// 模态元数据按 pi-ai 目录实读修正（2026-08-18，见 development-plan-router.md §1.1）：
// deepseek-v4-flash 文本-only、k3 多模态——早期版本此处为反向假设（deepseek 带图 / k3 纯文本），
// 与真实能力矩阵相反，0.3.0 实施时不得沿用。step 参数按 dsh-agent-loop 已验证契约取 1（每轮首个模型步）。
const metas: CandidateMeta[] = [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], costTier: 'cheap', available: true },
  { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], costTier: 'mid', available: true },
]

describe('KimiRouter v2', () => {
  it('capability routes code task to k3', () => {
    const r = new KimiRouter({ ...DEFAULT_CONFIG_V3(), mode: 'capability' }, metas, { info: () => {} })
    expect(r.decide([msg('审查这段代码 review')], 1).kind).toBe('route')
  })
  it('image step lands on the multimodal candidate, never a vision=0 one', () => {
    const r = new KimiRouter({ ...DEFAULT_CONFIG_V3(), mode: 'capability' }, metas, { info: () => {} })
    const d = r.decide([msg('看图 @kimi-coding')], 1)
    const target = d.kind === 'route' ? d.target : null
    expect(target?.model).toBe('k3')   // deepseek-v4-flash 文本-only（vision=0）被排除；k3 多模态承接
  })
  it('single eligible candidate degrades to keep', () => {
    const r = new KimiRouter({ ...DEFAULT_CONFIG_V3(), mode: 'capability' }, metas.slice(0, 1), { info: () => {} })
    expect(r.decide([msg('审查代码')], 1).kind).toBe('keep')
  })
})

describe('KimiRouter v2 review fixes (round 1)', () => {
  it('capability keep decisions do not pollute the premium budget window', () => {
    const r = new KimiRouter({ ...DEFAULT_CONFIG_V3(), mode: 'capability' }, metas, { info: () => {} })
    expect(r.decide([msg('审查这段代码 review')], 1).kind).toBe('route')
    // No weighted dims match → keep (default stays). 0.2.x semantics: only
    // cost-mode keep decisions record 'primary'; a capability keep records
    // nothing, so the window still holds just the one premium route sample.
    expect(r.decide([msg('普通任务')], 1).kind).toBe('keep')
    expect(r.budgetUsage()).toMatchObject({ premium: 1, ratio: 1 })
  })
  it('explicit directive picks the highest-scored candidate of that provider', () => {
    const multi: CandidateMeta[] = [
      { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], costTier: 'cheap', available: true },
      { provider: 'kimi-coding', model: 'kimi-for-coding', modalities: ['text', 'image'], costTier: 'mid', available: true },
      { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], costTier: 'mid', available: true },
    ]
    const r = new KimiRouter({ ...DEFAULT_CONFIG_V3(), mode: 'capability' }, multi, { info: () => {} })
    const d = r.decide([msg('@kimi-coding 写代码')], 1)
    // k3 code 4.5 > kimi-for-coding code 4.0 (scores.ts baseline) → k3 wins,
    // not the metas-array-first kimi-for-coding.
    expect(d.kind).toBe('route')
    if (d.kind === 'route') expect(d.target.model).toBe('k3')
  })
})

// 生产 v2 sidecar 形态（2026-08-19 实机回归复现）：sidecar default = kimi-coding/k3
// （面板验收保存），会话基础模型 = deepseek-v4-pro（settings.yaml agent-default-model）
// —— 文本-only 目标是一个「候选」而非 v1「primary」。护栏必须按候选模态而非
// primary 身份判定文本-only，否则图片留在 deepseek 上抛 UNSUPPORTED_CONTENT。
describe('image guard under the production v2 sidecar shape (default = kimi-coding/k3)', () => {
  const productionMetas: CandidateMeta[] = [
    { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], costTier: 'cheap', available: true },
    { provider: 'deepseek-official', model: 'deepseek-v4-pro', modalities: ['text'], costTier: 'mid', available: true },
    { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], costTier: 'mid', available: true },
    { provider: 'kimi-coding', model: 'k3-256k', modalities: ['text', 'image'], costTier: 'mid', available: true },
    { provider: 'kimi-coding', model: 'kimi-for-coding', modalities: ['text', 'image'], costTier: 'mid', available: true },
    { provider: 'kimi-coding', model: 'kimi-for-coding-highspeed', modalities: ['text', 'image'], costTier: 'mid', available: true },
  ]
  const productionConfig: RouterConfigV3 = {
    version: 2,
    mode: 'capability',
    default: { provider: 'kimi-coding', model: 'k3' },
    candidates: productionMetas.map(({ provider, model }) => ({ provider, model })),
    scores: { 'kimi-coding/k3': { code: 4.7, reasoning: 4.5, writing: 2.5, tooluse: 2.5, vision: 5, longctx: 2.5 } },
    classify: {},
    allowedProviders: ['kimi-coding', 'deepseek-official'],
    costTiers: {},
    routeThreshold: 0.75,
    lambda: 0.5,
    premiumBudget: 0.2,
    budgetWindow: 20,
    charsPerToken: 2,
  }
  const productionRouter = () => new KimiRouter(productionConfig, productionMetas, { info: () => {} })

  it('reroutes the text-only session base model (deepseek-v4-pro) to a kimi multimodal candidate', () => {
    // 2026-08-19 实机回归：图 → 会话基础模型 deepseek-v4-pro 被护栏放过 → 适配器 UNSUPPORTED_CONTENT。
    const guard = productionRouter().guardImage({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }, true)
    expect(guard).not.toBeNull()
    if (guard !== null) expect(guard.target.provider).toBe('kimi-coding')
  })

  it('applyImageGuard reroutes a text-only candidate target that is not the v1 primary', () => {
    const guard = applyImageGuard(
      { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      productionRouter().legacyConfig,
      true,
      productionMetas,
    )
    expect(guard).not.toBeNull()
    if (guard !== null) expect(guard.target.model).toBe('k3')
  })

  it('claims host image admission under the production shape', () => {
    expect(canClaimImageAdmission(productionRouter().legacyConfig, productionMetas)).toBe(true)
  })

  it('latch: a text step after an image turn scores vision and routes to k3 even without an image in the current batch', () => {
    // 2026-08-19 实机回归（turn 4）：图片轮之后的历史包含图片块，deepseek 适配器
    // 序列化全量会话时抛 UNSUPPORTED_CONTENT（dsh-llm-deepseek serializeMessages →
    // assertTextOnly）；agent/pre-step 只携带本轮消息（dsh-agent-loop preStep:
    // `messages: claimed`），路由器必须用会话锁存把后续文本轮当作 vision 步骤评分，
    // 而不是依赖当前消息里看得见的图片块。
    const r = new KimiRouter(
      { ...productionConfig, default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
      productionMetas,
      { info: () => {} },
    )
    const d = r.decide([msg('继续')], 1, true)
    expect(d.kind).toBe('route')
    if (d.kind === 'route') {
      expect(d.target.model).toBe('k3')
      expect(d.reason).toBe('capability:vision')
    }
  })
})
