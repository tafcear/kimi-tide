// test/review-verdict.test.ts（v1.4.0 评审闭环 T1：结论解析纯函数表驱动）
//
// 验收判据（spec §5 单测 1）：通过／有条件通过／不通过／无结论／英文变体／
// 结论出现在正文而非末行。口径来源 = spec §3.3（保守优先：只看最后一条非空行，
// 解析不出＝不触发）。
import { describe, expect, it } from 'vitest'
import {
  isRevisableVerdict,
  lastVerdictLine,
  parseReviewVerdict,
  verdictLabel,
} from '../src/review-verdict.js'

describe('parseReviewVerdict', () => {
  it.each([
    ['结论：通过', 'pass'],
    ['结论：有条件通过', 'conditional'],
    ['结论：不通过', 'fail'],
    ['结论：未通过', 'fail'],
    ['结论：需要修改', 'fail'],
    ['结论：建议合并后再看', 'unknown'],
    ['', 'unknown'],
  ])('中文结论 %j → %s', (text, expected) => {
    expect(parseReviewVerdict(text)).toBe(expected)
  })

  it.each([
    ['Verdict: pass', 'pass'],
    ['Verdict: PASSED', 'pass'],
    ['Verdict: conditional', 'conditional'],
    ['Verdict: conditionally approved', 'conditional'],
    ['Verdict: fail', 'fail'],
    ['Verdict: FAIL', 'fail'],
    ['Verdict: rejected — three blocking issues', 'fail'],
  ])('英文变体 %j → %s', (text, expected) => {
    expect(parseReviewVerdict(text)).toBe(expected)
  })

  it('正文里的结论词不算：只认最后一条非空行', () => {
    const text = [
      '一、问题清单',
      '- 这段实现不通过验收（阻塞）',
      '',
      '二、建议',
      '补一个回归测试',
      '以上供参考',
    ].join('\n')
    expect(parseReviewVerdict(text)).toBe('unknown')
  })

  it('尾随空行/空白不影响末行定位', () => {
    expect(parseReviewVerdict('结论：不通过\n\n   \n')).toBe('fail')
    expect(lastVerdictLine('a\n\n  \n')).toBe('a')
  })

  it('否定结论优先于「通过」（子串陷阱：不通过/未通过都以「通过」结尾）', () => {
    expect(parseReviewVerdict('结论：不通过（有 2 处阻塞）')).toBe('fail')
    expect(parseReviewVerdict('结论：未通过')).toBe('fail')
    expect(parseReviewVerdict('结论：有条件通过')).toBe('conditional')
  })

  it('failure 不误中 fail 词边界', () => {
    expect(parseReviewVerdict('结论：no failure found')).toBe('unknown')
  })
})

/** v1.4.0 复核补：否定包裹「通过」的写法必须判 fail（否则「无法通过」被读成通过 = 该退不退）。 */
describe('parseReviewVerdict：否定包裹与英文变体补全（复核 F-§3.3）', () => {
  it.each([
    ['结论：本方案无法通过', 'fail'],
    ['结论：当前实现不能通过验收', 'fail'],
    ['结论：尚未通过，需补测试', 'fail'],
    ['结论：暂不通过', 'fail'],
  ])('否定包裹「通过」%j → %s', (text, expected) => {
    expect(parseReviewVerdict(text)).toBe(expected)
  })

  it.each([
    ['Verdict: not approved', 'fail'],
    ['Verdict: needs work', 'fail'],
    ['Verdict: request changes', 'fail'],
    ['Verdict: changes requested', 'fail'],
  ])('英文否定变体 %j → %s', (text, expected) => {
    expect(parseReviewVerdict(text)).toBe(expected)
  })

  it('对比用例：正文一种判词、末行另一种 ⇒ 只认末行（能证伪「扫全文」实现）', () => {
    // 正文说「不通过」，末行结论是「通过」——若实现改成扫全文任意行，这条立刻红。
    const text = '- 这段实现不通过验收（阻塞）\n二、复评后\n结论：通过'
    expect(parseReviewVerdict(text)).toBe('pass')
    // 反向：正文说通过、末行不通过
    const inverse = '- 主体已通过检查\n结论：不通过（补测试）'
    expect(parseReviewVerdict(inverse)).toBe('fail')
  })
})

describe('触发判据与标签', () => {
  it('触发判据与标签', () => {
    expect(isRevisableVerdict('fail')).toBe(true)
    expect(isRevisableVerdict('conditional')).toBe(true)
    expect(isRevisableVerdict('pass')).toBe(false)
    expect(isRevisableVerdict('unknown')).toBe(false)
    expect(verdictLabel('fail')).toBe('不通过')
    expect(verdictLabel('conditional')).toBe('有条件通过')
    expect(verdictLabel('pass')).toBe('通过')
    expect(verdictLabel('unknown')).toBe('无明确结论')
  })
})
