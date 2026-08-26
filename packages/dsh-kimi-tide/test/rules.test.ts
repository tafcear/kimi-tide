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

  it('@ 前紧邻词字符（邮箱等）不误判为指令（评审修复 2026-08-23）；空白/行首/中文前导仍是指令', () => {
    expect(explicitProvider('联系 user@example.com 讨论方案')).toBeNull()
    expect(explicitProvider('发邮件到 admin@kimi-coding.org')).toBeNull() // 域名面即使像 provider 也不算
    expect(explicitProvider('请 @kimi 审查这段代码')).toBe('kimi-coding')
    expect(explicitProvider('用@kimi-tide 看图')).toBe('kimi-coding') // 中文前导（非 \w）仍是指令
    expect(explicitProvider('@kimi 行首')).toBe('kimi-coding')
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
  it('0.7.0 词边界：decode/unicode/barcode/planning 不误中英文词；纯词与中文邻接仍命中', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'capability'
    expect(matchingRules(c, '帮我 decode 这段 base64', false).map((r) => r.id)).not.toContain('code-kfc')
    expect(matchingRules(c, 'unicode 转义问题', false).map((r) => r.id)).not.toContain('code-kfc')
    expect(matchingRules(c, '生成 barcode 的脚本', false).map((r) => r.id)).not.toContain('code-kfc')
    expect(matchingRules(c, 'please refactor this function', false).map((r) => r.id)).toContain('code-kfc')
    expect(matchingRules(c, '这段代码有 bug', false).map((r) => r.id)).toContain('code-kfc')
    expect(matchingRules(c, '帮忙重构一下', false).map((r) => r.id)).toContain('code-kfc')
  })
  it('0.7.0 特异度：命中词数多者优先；平手保持列表序；带图轮 image 规则恒优先', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'capability'
    // code 2 词（重构+测试） vs chitchat 1 词（总结）→ code 反超列表序在前的 chitchat
    expect(matchingRules(c, '帮我总结这次重构，顺便写个测试', false).map((r) => r.id))
      .toEqual(['code-kfc', 'chitchat-flash'])
    // 各命中 1 词 → 平手按列表序（当前内置序 chitchat 在前；Task 4 将调序）
    expect(matchingRules(c, '你好，帮我重构一下', false).map((r) => r.id))
      .toEqual(['chitchat-flash', 'code-kfc'])
    // 带图轮 image 规则分 = +∞：即使关键词规则列表序在前也恒被 image 压过
    const s = DEFAULT_CONFIG_V4(); s.activePreset = 'saving'
    s.presets.saving.rules = [
      { id: 'code-kfc', when: { kind: 'keywords', group: 'code' }, target: { provider: 'kimi-coding', model: 'kimi-for-coding' } },
      { id: 'image-k3', when: { kind: 'image' }, target: { provider: 'kimi-coding', model: 'k3' } },
    ]
    expect(matchingRules(s, '看这个 bug 截图', true).map((r) => r.id)).toEqual(['image-k3', 'code-kfc'])
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
