import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_V4, DEFAULT_KEYWORD_GROUPS, configKey } from '../src/config.js'

describe('DEFAULT_CONFIG_V4', () => {
  it('version 4、默认关闭、内置两预设两关键词组', () => {
    const c = DEFAULT_CONFIG_V4()
    expect(c.version).toBe(4)
    expect(c.activePreset).toBeNull()
    expect(Object.keys(c.presets).sort()).toEqual(['capability', 'saving'])
    expect(Object.keys(c.keywordGroups).sort()).toEqual(['chitchat', 'code'])
  })
  it('省钱预设：flash 打底 + 带图→k3 + 代码→kimi-for-coding', () => {
    const p = DEFAULT_CONFIG_V4().presets.saving
    expect(p.name).toBe('省钱')
    expect(p.default).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(p.rules.map((r) => r.when)).toEqual([
      { kind: 'image' },
      { kind: 'keywords', group: 'code' },
    ])
    expect(p.rules[0].target).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(p.rules[1].target).toEqual({ provider: 'kimi-coding', model: 'kimi-for-coding' })
  })
  it('能力预设：k3 打底 + 闲聊→flash + 代码→kimi-for-coding', () => {
    const p = DEFAULT_CONFIG_V4().presets.capability
    expect(p.default).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(p.rules[0].when).toEqual({ kind: 'keywords', group: 'chitchat' })
    expect(p.rules[0].target).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(p.rules[1].when).toEqual({ kind: 'keywords', group: 'code' })
  })
  it('每次调用返回新对象（内置真相源不被意外共享改写）', () => {
    const a = DEFAULT_CONFIG_V4()
    a.presets.saving.rules.pop()
    expect(DEFAULT_CONFIG_V4().presets.saving.rules).toHaveLength(2)
  })
  it('configKey 不变', () => {
    expect(configKey({ provider: 'kimi-coding', model: 'k3' })).toBe('kimi-coding/k3')
  })
  it('关键词组内置词表（钉桩）', () => {
    expect(DEFAULT_KEYWORD_GROUPS.code).toEqual(['代码', 'code', 'bug', '重构', 'refactor', '实现', '函数', '测试'])
    expect(DEFAULT_KEYWORD_GROUPS.chitchat).toEqual(['你好', '谢谢', '怎么样', '随便', '聊聊', '翻译', '总结', '天气'])
  })
})
