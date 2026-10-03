// test/review-revise-message.test.ts（v1.4.0 评审闭环 T1b：修订注入面）
//
// 口径（spec §3.2）：修订 = 注入一条 **user 消息**（〔评审意见摘要〕＋〔修订指令〕），
// 由宿主轮循环正常起下一轮；消息自带**本插件专属 source.kind**——这是「修订轮」
// 与「人类轮」在编排层的唯一判别依据（评审武装跳过、lastTurn 不刷新都靠它）。
import { describe, expect, it } from 'vitest'
import { buildReviseInput, createReviseMessage, isReviseMessage, REVISE_SOURCE_KIND } from '../src/review.js'
import { REVIEW_INPUT_LIMIT } from '../src/review.js'

describe('buildReviseInput', () => {
  it('含结论标签 + 评审正文 + 只改被指出问题的指令', () => {
    const text = buildReviseInput({ reviewText: '一、[阻塞] 空指针未处理\n结论：不通过', verdict: 'fail' })
    expect(text).toContain('不通过')
    expect(text).toContain('[阻塞] 空指针未处理')
    expect(text).toContain('只修改')
  })

  it('超长评审正文按 REVIEW_INPUT_LIMIT 截断并带标注', () => {
    const text = buildReviseInput({ reviewText: 'x'.repeat(REVIEW_INPUT_LIMIT + 500), verdict: 'conditional' })
    expect(text).toContain('（已截断）')
    expect(text.length).toBeLessThanOrEqual(REVIEW_INPUT_LIMIT + 400)
  })
})

describe('createReviseMessage', () => {
  it('user 角色 + 本插件暴露源 + notice 摘要', () => {
    const message = createReviseMessage({ reviewText: '结论：不通过', verdict: 'fail' })
    expect(message.role).toBe('user')
    expect(message.source).toMatchObject({ kind: REVISE_SOURCE_KIND, form: 'notice' })
    expect((message.source as { summary: string }).summary.length).toBeLessThanOrEqual(120)
    expect(message.content[0]).toMatchObject({ type: 'text' })
    expect(typeof message.id).toBe('string')
  })

  it('每条约修消息 id 唯一（宿主 user/message 事件按 id 认领）', () => {
    const a = createReviseMessage({ reviewText: '结论：不通过', verdict: 'fail' })
    const b = createReviseMessage({ reviewText: '结论：不通过', verdict: 'fail' })
    expect(a.id).not.toBe(b.id)
  })
})

describe('isReviseMessage', () => {
  it('只认本插件 source.kind（人类输入、注入上下文一律 false）', () => {
    expect(isReviseMessage(createReviseMessage({ reviewText: '结论：不通过', verdict: 'fail' }))).toBe(true)
    expect(isReviseMessage({ source: { kind: 'user' } })).toBe(false)
    expect(isReviseMessage({ source: { kind: 'model-selection' } })).toBe(false)
    expect(isReviseMessage(undefined)).toBe(false)
    expect(isReviseMessage({})).toBe(false)
  })
})
