/**
 * 语义命中确认闸（v1.3.0，spec v2 §3）：判官输入的构造/解析、闸门缓存与失败退化。
 *
 * 关键不变量（评审对应项）：
 * - 失败/超时/解析失败 ⇒ **fail-open**（omitRuleId = null，不过闸）；
 * - 只有**有结论**的结果进缓存（一次抖动不许被缓存 N 条）；
 * - 缓存键含**判官身份**（评审 L3：换预设不沿用旧判词）；
 * - 判词只接受候选表内的规则 id（评审未覆盖面①：表内非链首一律 null）。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildConfirmInput,
  CONFIRM_TEXT_LIMIT,
  HitConfirmGate,
  parseConfirmVerdict,
  type ConfirmCandidate,
} from '../src/hit-confirm.js'

const judge = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const candidates: ConfirmCandidate[] = [{ ruleId: 'code-kfc', group: 'code', targetKey: 'zai-coding-cn/glm-5.3' }]

describe('buildConfirmInput', () => {
  it('含指令、文本与候选规则表；不含词表（控 token）', () => {
    const input = buildConfirmInput('帮我看看这段代码', candidates)
    expect(input).toContain('"verdict"')
    expect(input).toContain('帮我看看这段代码')
    expect(input).toContain('code-kfc｜组 code｜目标 zai-coding-cn/glm-5.3')
  })

  it('超长文本截断并标注', () => {
    const input = buildConfirmInput('代'.repeat(CONFIRM_TEXT_LIMIT + 50), candidates)
    expect(input).toContain('（已截断）')
    expect(input).not.toContain('代'.repeat(CONFIRM_TEXT_LIMIT + 1))
  })
})

describe('parseConfirmVerdict：容错与边界', () => {
  const ok = '{"verdict":"hit","rule":"code-kfc","why":"真意图"}'

  it('合法 hit / omit 各自解析', () => {
    expect(parseConfirmVerdict(ok, candidates)?.verdict).toBe('hit')
    expect(parseConfirmVerdict('{"verdict":"omit","rule":"code-kfc","why":"引用语境"}', candidates)?.verdict).toBe('omit')
  })

  it('容忍 ```json 围栏与前后杂文本、大小写', () => {
    const raw = '```json\n{"verdict":"HIT","rule":"code-kfc","why":"ok"}\n```\n（完）'
    expect(parseConfirmVerdict(raw, candidates)?.verdict).toBe('hit')
  })

  it('坏 JSON / 非法 verdict / 缺 rule / 规则不在候选表 → 一律 null（保守通过）', () => {
    expect(parseConfirmVerdict('不是 JSON', candidates)).toBeNull()
    expect(parseConfirmVerdict('{"verdict":"maybe","rule":"code-kfc"}', candidates)).toBeNull()
    expect(parseConfirmVerdict('{"verdict":"omit"}', candidates)).toBeNull()
    // 评审未覆盖面①：指向候选表外的规则（含表内非链首）→ null
    expect(parseConfirmVerdict('{"verdict":"omit","rule":"review-k3"}', candidates)).toBeNull()
  })
})

describe('HitConfirmGate：结论、缓存与失败退化', () => {
  it('hit → 不跳规则；omit → 返回被否规则 id（含 outcome 供观测）', async () => {
    const hitGate = new HitConfirmGate({ call: async () => '{"verdict":"hit","rule":"code-kfc","why":"ok"}' })
    await expect(hitGate.review('代码', candidates, judge)).resolves.toMatchObject({ omitRuleId: null, outcome: 'hit' })

    const omitGate = new HitConfirmGate({ call: async () => '{"verdict":"omit","rule":"code-kfc","why":"引用"}' })
    await expect(omitGate.review('代码', candidates, judge)).resolves.toMatchObject({ omitRuleId: 'code-kfc', outcome: 'omit' })
  })

  it('judge 调用返回 null（失败）→ fail-open 且不写缓存（下次仍重试）', async () => {
    const call = vi.fn(async () => null)
    const gate = new HitConfirmGate({ call })
    const first = await gate.review('代码', candidates, judge)
    expect(first).toMatchObject({ omitRuleId: null, outcome: 'fail' })
    await gate.review('代码', candidates, judge)
    // Fails if: 失败被缓存（一次抖动导致该句永远不过闸）
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('解析失败（坏 JSON）→ fail-open', async () => {
    const gate = new HitConfirmGate({ call: async () => '我拒绝输出 JSON' })
    await expect(gate.review('代码', candidates, judge)).resolves.toMatchObject({ omitRuleId: null, outcome: 'fail' })
  })

  it('同文本同判官：第二次命中缓存（不重复调用）', async () => {
    const call = vi.fn(async () => '{"verdict":"omit","rule":"code-kfc","why":"引用"}')
    const gate = new HitConfirmGate({ call })
    await gate.review('代码', candidates, judge)
    const second = await gate.review('代码', candidates, judge)
    expect(call).toHaveBeenCalledTimes(1)
    expect(second.outcome).toBe('cached-omit')
    expect(second.omitRuleId).toBe('code-kfc')
  })

  it('缓存键含判官身份（评审 L3）：换判官必须重新判', async () => {
    const call = vi.fn(async () => '{"verdict":"hit","rule":"code-kfc","why":"ok"}')
    const gate = new HitConfirmGate({ call })
    await gate.review('代码', candidates, judge)
    await gate.review('代码', candidates, { provider: 'kimi-coding', model: 'k3' })
    // Fails if: 换预设（判官变）后沿用旧判词
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('超时 → 中止视同无结论（fail-open），且不写缓存', async () => {
    const call = vi.fn(({ signal }: { signal: AbortSignal | undefined }) => new Promise<string | null>((resolve) => {
      if (signal === undefined) return
      signal.addEventListener('abort', () => resolve(null))
    }))
    const gate = new HitConfirmGate({ call })
    const result = await gate.review('代码', candidates, judge, { timeoutMs: 5 })
    expect(result).toMatchObject({ omitRuleId: null, outcome: 'fail' })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('maxTokens 透传给判官调用（评审 L2：缺省 64，可在预设上覆盖）', async () => {
    const seen: number[] = []
    const gate = new HitConfirmGate({
      call: async ({ maxTokens }) => { seen.push(maxTokens); return '{"verdict":"hit","rule":"code-kfc","why":"ok"}' },
    })
    await gate.review('a', candidates, judge)
    await gate.review('b', candidates, judge, { maxTokens: 16 })
    expect(seen).toEqual([64, 16])
  })
})
