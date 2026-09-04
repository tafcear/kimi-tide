// test/review-flow.test.ts（1.1.0 review flow 专属；Task 2 起在同文件追加 describe）
// 消息夹具的 text() helper 写法沿用 test/integration.test.ts。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { applyKimiTideCommand, parseKimiTideCommand, type KimiTideCommandDeps } from '../src/commands.js'
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, DEFAULT_FLOWS, KIMI_PROVIDER } from '../src/config.js'
import { claimedReviewGroups, previewRoute, reviewTriggerHit } from '../src/rules.js'
import { KimiRouter } from '../src/router.js'
import { RouterSidecarStore } from '../src/sidecar.js'
import { validateRouterConfig } from '../src/settings-schema.js'
import { buildReviewInput, createReviewRunner, REVIEW_INPUT_LIMIT, truncate } from '../src/review.js'
import { kimiReviewProjectionDefinition, KIMI_TIDE_REVIEW_EVENT } from '../src/projection.js'
import type { ReviewEventPayload } from '../src/review.js'

const text = (t: string): UserMessage =>
  ({ role: 'user', content: [{ type: 'text', text: t }] }) as unknown as UserMessage

// 候选池须含断言涉及的规则目标（router.test.ts METAS 同款惯例）：
// code-kfc → kimi-for-coding、image-k3/打底 → k3——缺 kimi-for-coding 时
// decide 按目标不可用降级到默认，测不到「他组规则照常」。
const metas = (available = true) => [
  { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available },
  { provider: 'kimi-coding', model: 'kimi-for-coding', modalities: ['text', 'image'], available },
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], available },
]

const v5Claimed = () => {
  const config = DEFAULT_CONFIG_V5()
  config.activePreset = 'capability'
  config.flows = {
    ...DEFAULT_FLOWS(),
    review: { ...DEFAULT_FLOWS().review, trigger: 'keywords', keywordGroup: 'review' },
  }
  return config
}

describe('claimedReviewGroups', () => {
  it('v4 形状 → 空集', () => {
    expect(claimedReviewGroups(DEFAULT_CONFIG_V4())).toEqual(new Set())
  })
  it('v5 收集 trigger=keywords 且 keywordGroup 非空的 review 流', () => {
    expect(claimedReviewGroups(v5Claimed())).toEqual(new Set(['review']))
  })
  it('trigger=manual 不收；keywordGroup 缺省不收', () => {
    const config = DEFAULT_CONFIG_V5()
    config.flows = {
      manual: { ...DEFAULT_FLOWS().review }, // trigger 默认 manual
      noGroup: { ...DEFAULT_FLOWS().review, trigger: 'keywords' }, // 缺 keywordGroup
    }
    expect(claimedReviewGroups(config)).toEqual(new Set())
  })
})

describe('decide 静态抑制', () => {
  it('被认领组规则跳过：纯评审词落预设默认（via=default，非 review-k3 的 rule）', () => {
    const router = new KimiRouter(v5Claimed(), metas(), { info: () => {} })
    const decision = router.decide([text('帮我评审一下这个方案')], 1)
    expect(decision).toMatchObject({ kind: 'route', via: 'default', target: { provider: KIMI_PROVIDER, model: 'k3' } })
  })
  it('他组规则照常：code 词不受 review 认领影响', () => {
    const router = new KimiRouter(v5Claimed(), metas(), { info: () => {} })
    const decision = router.decide([text('修复这个 bug')], 1)
    expect(decision).toMatchObject({ via: 'rule', target: { provider: KIMI_PROVIDER, model: 'kimi-for-coding' } })
  })
  it('认领不抑制 image 条件规则', () => {
    const router = new KimiRouter(v5Claimed(), metas(), { info: () => {} })
    const decision = router.decide([text('看看这张图')], 1, true)
    expect(decision).toMatchObject({ via: 'rule' })
  })
  it('R6：高特异度命中被认领抑制、次命中保留 → 保留规则 reason 不带（特异度最高）', () => {
    const router = new KimiRouter(v5Claimed(), metas(), { info: () => {} })
    // review 组 2 词（审查+评审）为特异度最高命中，但整条被认领抑制；code 组
    // 1 词保留——过滤后 routable 仅剩一条，保留命中不得继承首命中标注。
    const decision = router.decide([text('帮我审查评审这段代码')], 1)
    expect(decision).toMatchObject({ via: 'rule', target: { provider: KIMI_PROVIDER, model: 'kimi-for-coding' } })
    if (decision.kind !== 'route') throw new Error(`expected route decision, got ${decision.kind}`)
    expect(decision.reason).toBe('规则「code」命中 1 词')
  })
})

describe('reviewTriggerHit', () => {
  it('命中取 flows 注册表序首个', () => {
    const config = v5Claimed()
    config.flows.review2 = { ...config.flows.review, keywordGroup: 'review' }
    const hit = reviewTriggerHit(config, '帮我评审一下', () => true)
    expect(hit?.flowId).toBe('review')
  })
  it('reviewer 不可用返 null；未命中返 null', () => {
    expect(reviewTriggerHit(v5Claimed(), '帮我评审一下', () => false)).toBeNull()
    expect(reviewTriggerHit(v5Claimed(), '今天天气不错', () => true)).toBeNull()
  })
  it('显式 @ 抑制：已知与未知 provider 都返 null', () => {
    expect(reviewTriggerHit(v5Claimed(), '@kimi 帮我评审', () => true)).toBeNull()
    expect(reviewTriggerHit(v5Claimed(), '@unknown-provider 帮我评审', () => true)).toBeNull()
  })
})

describe('previewRoute review-flow outcome', () => {
  const deps = { catalog: undefined, availability: null as Record<string, boolean> | null }
  it('命中认领组 → review-flow outcome，routed 携带过滤后路由，hits 剔除被认领组', () => {
    const preview = previewRoute(v5Claimed(), '帮我评审一下', deps as never)
    expect(preview.outcome).toMatchObject({ kind: 'review-flow', flowId: 'review' })
    expect((preview.outcome as { routed: { kind: string } }).routed.kind).toBe('default')
    expect(preview.hits.some((h) => h.rule.when.kind === 'keywords' && h.rule.when.group === 'review')).toBe(false)
  })
  it('可用性盲区：组认领 + reviewer 不可用 → 仍 review-flow 且 label 标注不可用', () => {
    const preview = previewRoute(v5Claimed(), '帮我评审一下', { ...deps, availability: { 'kimi-coding/k3': false } } as never)
    expect(preview.outcome).toMatchObject({ kind: 'review-flow' })
    expect((preview.outcome as { label: string }).label).toContain('不可用')
  })
  it('A8 盲区（真实挂载表口径）：availability 不落键 + mounted 缺 reviewer → label 标注不可用', () => {
    // 实机形态（2026-09-04 A8）：kimi-coding 系自挂 provider，llm.models 目录
    // 列不出 → availability 对 reviewer 目标永不落键，availability===false 分支
    // 实机死路。mounted（kimi-tide-catalog 命名空间发布的路由器真实挂载表）
    // 缺 reviewer 键 = decide 侧 metas 判定不可用 → 必须标注，不做静默。
    const preview = previewRoute(v5Claimed(), '帮我评审一下', {
      ...deps, availability: null, mounted: ['deepseek-official/deepseek-v4-flash'],
    } as never)
    expect(preview.outcome).toMatchObject({ kind: 'review-flow' })
    expect((preview.outcome as { label: string }).label).toContain('不可用')
  })
  it('A8 非盲区：mounted 含 reviewer → 普通 label（自挂 provider 不误伤）', () => {
    const preview = previewRoute(v5Claimed(), '帮我评审一下', {
      ...deps, availability: null, mounted: ['kimi-coding/k3', 'kimi-coding/kimi-for-coding'],
    } as never)
    expect(preview.outcome).toMatchObject({ kind: 'review-flow' })
    expect((preview.outcome as { label: string }).label).toContain('轮末触发评审流')
    expect((preview.outcome as { label: string }).label).not.toContain('不可用')
  })
  it('mounted 未提供（旧宿主）→ 行为不变（退化为三态，不回归）', () => {
    const preview = previewRoute(v5Claimed(), '帮我评审一下', { ...deps } as never)
    expect(preview.outcome).toMatchObject({ kind: 'review-flow' })
    expect((preview.outcome as { label: string }).label).toContain('轮末触发评审流')
  })
})

describe('buildReviewInput / truncate', () => {
  it('三段模板齐备', () => {
    const input = buildReviewInput({ flowId: 'review', flow: DEFAULT_FLOWS().review as never, turn: 3, userText: '需求X', output: '产出Y' })
    expect(input).toContain('资深技术评审')
    expect(input).toContain('[本轮用户需求]')
    expect(input).toContain('需求X')
    expect(input).toContain('[主模型本轮产出]')
    expect(input).toContain('产出Y')
  })
  it(`双段截断：${REVIEW_INPUT_LIMIT + 1} 字符触发标注`, () => {
    const input = buildReviewInput({ flowId: 'r', flow: DEFAULT_FLOWS().review as never, turn: 1, userText: 'a'.repeat(REVIEW_INPUT_LIMIT + 1), output: 'ok' })
    expect(input).toContain('…（已截断）')
    expect(truncate('abc')).toBe('abc')
  })
})

describe('createReviewRunner', () => {
  it('流成功 → ok:true 载荷；流失败 → ok:false + error，均不抛出', async () => {
    const okChunk = [{ type: 'text-delta', text: '意见' }, { type: 'finish', reason: { kind: 'stop' } }]
    const failChunk = [{ type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'X' } } }]
    const mkCtx = (chunks: unknown[]) => ({ llm: { stream: async function* () { for (const c of chunks) yield c } } }) as never
    const req = { flowId: 'review', flow: DEFAULT_FLOWS().review as never, turn: 1, userText: 'u', output: 'o' }
    expect(await createReviewRunner(mkCtx(okChunk))(req)).toMatchObject({ ok: true, reviewText: '意见', turn: 1 })
    expect(await createReviewRunner(mkCtx(failChunk))(req)).toMatchObject({ ok: false })
    expect((await createReviewRunner(mkCtx([]))(req)).ok).toBe(false) // 空输出=失败
  })
})

// Task 4（2026-09-04）：kimi-tide/review 投影 unit（spec §7）——fold 保留最近 20 条
// （新到旧）+ stateSchema 形状守门。brief 测试逐字。
const record = (turn: number): ReviewEventPayload => ({
  flowId: 'review', reviewer: { provider: 'kimi-coding', model: 'k3' }, turn,
  userText: 'u', reviewText: `r${turn}`, ok: true, durationMs: 1, at: '2026-09-04T00:00:00Z',
})

describe('kimi-tide/review 投影', () => {
  it('fold：新到旧、保留最近 20 条、忽略其他事件', () => {
    let state = kimiReviewProjectionDefinition.init()
    for (let turn = 1; turn <= 25; turn++) {
      state = kimiReviewProjectionDefinition.apply(state, { type: KIMI_TIDE_REVIEW_EVENT, data: record(turn) } as never)
    }
    state = kimiReviewProjectionDefinition.apply(state, { type: 'other/event', data: {} } as never)
    const records = (state as { records: Array<{ turn: number }> }).records
    expect(records).toHaveLength(20)
    expect(records[0].turn).toBe(25)
    expect(records[19].turn).toBe(6)
  })
  it('reviewRecordSchema 形状守门：拒绝缺字段与超长 userText（T3 评审移交的加固）', () => {
    const bad = { flowId: 'r', reviewer: { provider: 'p', model: 'm' }, turn: 1, userText: 'x'.repeat(201), reviewText: 'r', ok: true, durationMs: 1, at: 't' }
    expect(() => (kimiReviewProjectionDefinition as unknown as { stateSchema: { parse: (v: unknown) => unknown } }).stateSchema.parse({ records: [bad] })).toThrow()
    expect(() => (kimiReviewProjectionDefinition as unknown as { stateSchema: { parse: (v: unknown) => unknown } }).stateSchema.parse({ records: [record(1)] })).not.toThrow()
  })
})

// Task 6（2026-09-04）：/kimi-tide review 手动命令 + show 认领行（spec §8）——命令层
// 用例；deps 夹具必填键以 integration.test.ts:150 的 applyKimiTideCommand 用例为基
// （sidecar/monitor/current/onSaved），新键 manualReview/claimedGroups 按需给出。
// 命令 union 的新 apply 分支需要接收 agent（dsh-commands handler 的 invocation.agent
// 是唯一 agent 载体——commands.ts 无其他会话/agent 惯例可循），故 apply 第三参为
// agent；review 用例传占位 agent（夹具 manualReview 不消费它）。
const rfDir = mkdtempSync(join(tmpdir(), 'kt-rf-cmd-'))
afterAll(() => rmSync(rfDir, { recursive: true, force: true }))

function commandDeps(overrides: {
  claimedGroups?: Set<string>
  manualReview?: (agent: unknown) => Promise<{ ok: boolean; message: string }>
} = {}): KimiTideCommandDeps {
  const cfg = { ...DEFAULT_CONFIG_V5(), activePreset: 'saving' }
  const sidecar = new RouterSidecarStore({ file: join(rfDir, `sidecar-${Math.random().toString(36).slice(2)}.yml`), onError: () => {} })
  const deps: KimiTideCommandDeps = {
    sidecar,
    settings: null,
    monitor: { refresh: async () => {} } as never,
    current: () => cfg,
    onSaved: () => {},
  }
  if (overrides.claimedGroups !== undefined) deps.claimedGroups = overrides.claimedGroups
  if (overrides.manualReview !== undefined) deps.manualReview = overrides.manualReview
  return deps
}

const NO_AGENT_YET = {} as never

describe('/kimi-tide review 命令', () => {
  it('parse：review 子命令', () => {
    expect(parseKimiTideCommand('review')).toMatchObject({ kind: 'review' })
    expect(parseKimiTideCommand('show')).not.toMatchObject({ kind: 'review' })
  })
  it('apply：deps.manualReview 收到命令的 agent、返回值透传为回显', async () => {
    const seen: unknown[] = []
    const agent = { label: 'agent-x' }
    const result = await applyKimiTideCommand({ kind: 'review' } as never, commandDeps({
      manualReview: async (a) => { seen.push(a); return { ok: true, message: '评审已发起' } },
    }), agent as never)
    expect(seen).toEqual([agent])
    expect(result).toContain('评审已发起')
  })
  it('apply：manualReview 缺省（宿主未接线/路由关闭）→ 未挂载文案回显', async () => {
    const result = await applyKimiTideCommand({ kind: 'review' } as never, commandDeps(), NO_AGENT_YET)
    expect(result).toContain('评审流未挂载（路由关闭中）')
  })
})

describe('/kimi-tide show 认领行', () => {
  it('claimedGroups 非空 → 输出含认领组名', async () => {
    const result = await applyKimiTideCommand({ kind: 'show' } as never, commandDeps({ claimedGroups: new Set(['review']) }))
    expect(result).toContain('review')
    expect(result).toContain('认领')
  })
  it('claimedGroups 空 → 不出现认领行', async () => {
    const result = await applyKimiTideCommand({ kind: 'show' } as never, commandDeps({ claimedGroups: new Set() }))
    expect(result).not.toContain('认领')
  })
})

// Task 7（2026-09-04）：validateRouterConfig review 流分支拒 reviewer.effort（L7）。
// 断言式与 settings-schema.test.ts 既有惯例一致——validateRouterConfig 收集错误为
// 返回串不抛错（宿主 set 前查 message、card-store C1 模拟宿主 !== undefined），
// brief 的 toThrow 形按此实读收编为 toContain/toBeUndefined。
describe('validateRouterConfig reviewer.effort（评审修复 L7）', () => {
  it('review 流 reviewer 带 effort → 拒绝', () => {
    const config = v5Claimed()
    ;(config.flows.review as { reviewer: { effort?: string } }).reviewer.effort = 'high'
    expect(validateRouterConfig(config as never)).toContain('effort')
  })
  it('无 effort → 通过', () => {
    expect(validateRouterConfig(v5Claimed() as never)).toBeUndefined()
  })
})
