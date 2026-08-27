import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG_V4,
  DEFAULT_CONFIG_V5,
  DEFAULT_FLOWS,
  DEFAULT_KEYWORD_GROUPS,
  configKey,
  isFlowTarget,
} from '../src/config.js'
import type { RuleTarget } from '../src/config.js'

describe('DEFAULT_CONFIG_V4', () => {
  it('version 4、默认关闭、内置两预设七关键词组（0.8.0）', () => {
    const c = DEFAULT_CONFIG_V4()
    expect(c.version).toBe(4)
    expect(c.activePreset).toBeNull()
    expect(Object.keys(c.presets).sort()).toEqual(['capability', 'saving'])
    expect(Object.keys(c.keywordGroups).sort()).toEqual(['chitchat', 'code', 'longdoc', 'math', 'review', 'translate', 'writing'])
  })
  it('省钱预设：flash 打底 + 带图→k3 + 代码→kimi-for-coding（0.8.0 追加 翻译→flash 见下方钉桩）', () => {
    const p = DEFAULT_CONFIG_V4().presets.saving
    expect(p.name).toBe('省钱')
    expect(p.default).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(p.rules.map((r) => r.when)).toEqual([
      { kind: 'image' },
      { kind: 'keywords', group: 'code' },
      { kind: 'keywords', group: 'translate' },
    ])
    expect(p.rules[0].target).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(p.rules[1].target).toEqual({ provider: 'kimi-coding', model: 'kimi-for-coding' })
  })
  it('0.8.0 内置预设接线：capability 序 image→review→code→math→longdoc→writing→translate→chitchat', () => {
    const p = DEFAULT_CONFIG_V4().presets.capability
    expect(p.rules.map((r) => r.id)).toEqual([
      'image-k3', 'review-k3', 'code-kfc', 'math-v4p', 'longdoc-k3', 'writing-v4p', 'translate-v4f', 'chitchat-flash',
    ])
    expect(p.rules[1]).toEqual({
      id: 'review-k3', when: { kind: 'keywords', group: 'review' },
      target: { provider: 'kimi-coding', model: 'k3' },
    })
    expect(p.rules[3].target).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(p.rules[5].target).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(p.rules[6].target).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })
  it('0.8.0 内置预设接线：saving 只加 translate→flash（其余不动）', () => {
    const p = DEFAULT_CONFIG_V4().presets.saving
    expect(p.rules.map((r) => r.id)).toEqual(['image-k3', 'code-kfc', 'translate-v4f'])
    expect(p.rules[2]).toEqual({
      id: 'translate-v4f', when: { kind: 'keywords', group: 'translate' },
      target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
  })
  it('每次调用返回新对象（内置真相源不被意外共享改写）', () => {
    const a = DEFAULT_CONFIG_V4()
    a.presets.saving.rules.pop()
    expect(DEFAULT_CONFIG_V4().presets.saving.rules).toHaveLength(3)
  })
  it('configKey 不变', () => {
    expect(configKey({ provider: 'kimi-coding', model: 'k3' })).toBe('kimi-coding/k3')
  })
  it('关键词组内置词表（钉桩；0.7.0 code 17 词）', () => {
    expect(DEFAULT_KEYWORD_GROUPS.code).toEqual(['代码', 'code', 'bug', '重构', 'refactor', '实现', '函数', '测试', '接口', '联调', '部署', '性能', '报错', '日志', '编译', '命令', '脚本'])
    expect(DEFAULT_KEYWORD_GROUPS.chitchat).toEqual(['你好', '谢谢', '怎么样', '随便', '聊聊', '天气'])
  })
  it('0.8.0 关键词组：内置 7 组；chitchat 瘦身迁出翻译/总结', () => {
    expect(Object.keys(DEFAULT_KEYWORD_GROUPS).sort()).toEqual(['chitchat', 'code', 'longdoc', 'math', 'review', 'translate', 'writing'])
    expect(DEFAULT_KEYWORD_GROUPS.chitchat).toEqual(['你好', '谢谢', '怎么样', '随便', '聊聊', '天气'])
    expect(DEFAULT_KEYWORD_GROUPS.review).toEqual(['审查', 'review', '评审', '挑毛病', '复检', '检查', 'audit', '意见', '打分'])
    expect(DEFAULT_KEYWORD_GROUPS.writing).toEqual(['写作', '文案', '润色', '改写', '扩写', '标题', '推文', '周报', '演讲稿', '总结'])
    expect(DEFAULT_KEYWORD_GROUPS.translate).toEqual(['翻译', '译成', '中译英', '英译中', 'translate', '本地化'])
    expect(DEFAULT_KEYWORD_GROUPS.longdoc).toEqual(['长文档', '通读', '逐段', '全文', '上万字', '大文档'])
    expect(DEFAULT_KEYWORD_GROUPS.math).toEqual(['数学', '证明', '推导', '求解', '公式', '数论', '概率', '逻辑题'])
    expect(DEFAULT_KEYWORD_GROUPS.code).toHaveLength(17)  // code 17 词不动
  })
})

describe('DEFAULT_CONFIG_V5', () => {
  it('version 5、默认关闭、预置流注册表含 transcribe/review', () => {
    const c = DEFAULT_CONFIG_V5()
    expect(c.version).toBe(5)
    expect(c.activePreset).toBeNull()
    expect(Object.keys(c.presets).sort()).toEqual(['capability', 'saving'])
    expect(Object.keys(c.flows).sort()).toEqual(['review', 'transcribe'])
    expect(Object.keys(c.keywordGroups).sort()).toEqual(['chitchat', 'code', 'longdoc', 'math', 'review', 'translate', 'writing'])
  })
  it('预置 transcribe 流：vision-exp 视觉模型 + latch-image 失败策略', () => {
    expect(DEFAULT_CONFIG_V5().flows.transcribe).toEqual({
      type: 'transcribe',
      visionModel: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' },
      failurePolicy: 'latch-image',
    })
  })
  it('预置 review 流：k3 评审 + manual 触发 + rounds 1 + autoRevise false', () => {
    expect(DEFAULT_CONFIG_V5().flows.review).toEqual({
      type: 'review',
      reviewer: { provider: 'kimi-coding', model: 'k3' },
      trigger: 'manual',
      rounds: 1,
      autoRevise: false,
    })
  })
  it('预设与关键词组同 V4 逐项相等（迁移行为保持：预置流注册但不绑定）', () => {
    const v4 = DEFAULT_CONFIG_V4()
    const v5 = DEFAULT_CONFIG_V5()
    expect(v5.activePreset).toBe(v4.activePreset)
    expect(v5.presets).toEqual(v4.presets)
    expect(v5.keywordGroups).toEqual(v4.keywordGroups)
    // 预置不绑定：v5 预设与 v4 一样不带 imageFallback/imageFallbackFlow
    for (const p of Object.values(v5.presets)) {
      expect(p.imageFallback).toBeUndefined()
      expect(p.imageFallbackFlow).toBeUndefined()
    }
  })
  it('每次调用返回新对象（含预置流，不被意外共享改写）', () => {
    const a = DEFAULT_CONFIG_V5()
    a.presets.saving.rules.pop()
    ;(a.flows.review as { rounds: number }).rounds = 99
    const fresh = DEFAULT_CONFIG_V5()
    expect(fresh.presets.saving.rules).toHaveLength(3)
    expect(fresh.flows.review).toEqual({
      type: 'review',
      reviewer: { provider: 'kimi-coding', model: 'k3' },
      trigger: 'manual',
      rounds: 1,
      autoRevise: false,
    })
  })
})

describe('DEFAULT_FLOWS', () => {
  it('两预置流与 DEFAULT_CONFIG_V5.flows 一致，且每次调用返回新对象', () => {
    expect(DEFAULT_FLOWS()).toEqual(DEFAULT_CONFIG_V5().flows)
    const a = DEFAULT_FLOWS()
    ;(a.transcribe as { failurePolicy: string }).failurePolicy = 'blind'
    expect((DEFAULT_FLOWS().transcribe as { failurePolicy: string }).failurePolicy).toBe('latch-image')
  })
})

describe('isFlowTarget', () => {
  it('flow 引用窄化为 true', () => {
    const t: RuleTarget = { flow: 'transcribe' }
    expect(isFlowTarget(t)).toBe(true)
    if (isFlowTarget(t)) {
      expect(t.flow).toBe('transcribe')
    }
  })
  it('纯模型目标窄化为 false', () => {
    const t: RuleTarget = { provider: 'kimi-coding', model: 'k3' }
    expect(isFlowTarget(t)).toBe(false)
    if (!isFlowTarget(t)) {
      expect(t.provider).toBe('kimi-coding')
    }
  })
})
