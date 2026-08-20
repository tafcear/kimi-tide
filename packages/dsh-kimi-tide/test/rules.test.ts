// test/rules.test.ts
import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { DEFAULT_CONFIG_V4 } from '../src/config.js'
import { explicitProvider, latestUserText, matchingRules, messagesContainImage, ruleLabel } from '../src/rules.js'

const textMsg = (text: string): UserMessage => ({ role: 'user', content: [{ type: 'text', text }] }) as unknown as UserMessage
const imageMsg = (): UserMessage => ({ role: 'user', content: [{ type: 'image', attachment: 'a1' }] }) as unknown as UserMessage

describe('explicitProvider', () => {
  it('@kimi / @kimi-tide → kimi-coding；@deepseek-official 按字面；无 @ → null', () => {
    expect(explicitProvider('@kimi 帮我看这段代码')).toBe('kimi-coding')
    expect(explicitProvider('@kimi-tide 来')).toBe('kimi-coding')
    expect(explicitProvider('@deepseek-official 你好')).toBe('deepseek-official')
    expect(explicitProvider('没有指令')).toBeNull()
  })
})

describe('matchingRules', () => {
  it('activePreset null → 空', () => {
    expect(matchingRules(DEFAULT_CONFIG_V4(), '代码', false)).toEqual([])
  })
  it('规则顺序首命中在前；未命中为空', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    expect(matchingRules(c, '帮我重构这个函数', false).map((r) => r.id)).toEqual(['code-kfc'])
    expect(matchingRules(c, '今天天气怎么样', false)).toEqual([])  // 省钱预设无闲聊规则
  })
  it('带图消息命中 image 规则（与文本无关）', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    expect(matchingRules(c, '', true).map((r) => r.id)).toEqual(['image-k3'])
  })
  it('带图+代码词同时满足时按列表顺序全部返回（首命中=image-k3）', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    expect(matchingRules(c, '看这个 bug 截图', true).map((r) => r.id)).toEqual(['image-k3', 'code-kfc'])
  })
  it('关键词大小写不敏感子串匹配', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'capability'
    expect(matchingRules(c, 'please REFACTOR this', false).map((r) => r.id)).toEqual(['code-kfc'])
  })
  it('引用不存在关键词组的规则不命中', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    delete c.keywordGroups.code
    expect(matchingRules(c, '重构函数', false)).toEqual([])
  })
  it('activePreset 指向不存在的预设 → 空', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'nope'
    expect(matchingRules(c, '代码', true)).toEqual([])
  })
})

describe('ruleLabel / 消息工具', () => {
  it('ruleLabel：image→带图；keywords→组名', () => {
    const c = DEFAULT_CONFIG_V4()
    expect(ruleLabel(c.presets.saving.rules[0])).toBe('带图')
    expect(ruleLabel(c.presets.saving.rules[1])).toBe('code')
  })
  it('latestUserText 取最后一条非空用户文本；messagesContainImage 识别图片块', () => {
    expect(latestUserText([textMsg('第一句'), textMsg('第二句')])).toBe('第二句')
    expect(latestUserText([])).toBe('')
    expect(messagesContainImage([textMsg('x'), imageMsg()])).toBe(true)
    expect(messagesContainImage([textMsg('x')])).toBe(false)
  })
})
