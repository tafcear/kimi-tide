// test/rules.test.ts
import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, type RouterRule } from '../src/config.js'
import {
  configuredProviders,
  duplicateRuleIds,
  effectiveExplicitDirective,
  explicitDirective,
  explicitProvider,
  latestUserText,
  matchingRules,
  matchingScored,
  messagesContainImage,
  previewRoute,
  ruleConditionSummary,
  ruleLabel,
} from '../src/rules.js'
import type { RoutePreviewDeps } from '../src/rules.js'

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

describe('effectiveExplicitDirective（Q6：已知 provider 门控）', () => {
  const known = new Set(['kimi-coding', 'deepseek-official'])

  it('known 含该 provider ⇒ 返回指令（provider 简写与 @provider/model 两种形态）', () => {
    expect(effectiveExplicitDirective('@kimi 帮我看这段代码', known)).toEqual({ provider: 'kimi-coding' })
    expect(effectiveExplicitDirective('@kimi/k3 来', known)).toEqual({ provider: 'kimi-coding', model: 'k3' })
  })

  it('known 不含 ⇒ null —— scoped 包名 / @文件 / 路径片段不再当指令', () => {
    // Fails if: 词法命中即当指令 ⇒ @deepseek-ai 无候选即短路规则链（2026-09-15 事件根因）
    expect(effectiveExplicitDirective('请读 node_modules/@deepseek-ai/dsh-session 的导出', known)).toBeNull()
    expect(effectiveExplicitDirective('见 @README.md 的说明', known)).toBeNull()
    expect(effectiveExplicitDirective('npm i @scope/pkg@1.2.3', known)).toBeNull()
  })

  it('known === null ⇒ 退化为词法结果（取不到目录时不误伤真指令）', () => {
    expect(effectiveExplicitDirective('@kimi 你好', null)).toEqual({ provider: 'kimi-coding' })
    // 降级路径行为与 0.5.x 一致：无法判定时宁可从宽
    expect(effectiveExplicitDirective('@README.md 你好', null)).toEqual({ provider: 'README' })
  })

  it('无 @ / 邮箱 ⇒ null', () => {
    expect(effectiveExplicitDirective('今天天气不错', known)).toBeNull()
    expect(effectiveExplicitDirective('联系 user@example.com', known)).toBeNull()
  })

  it('取首个「已知」匹配——前面的误判不吞掉后面的真指令', () => {
    expect(effectiveExplicitDirective('见 @deepseek-ai/x，另 @kimi 帮我看', known)).toEqual({ provider: 'kimi-coding' })
  })
})

describe('configuredProviders（Q6：「认识」的口径之一）', () => {
  it('取 default + 非流转规则目标；流转目标不计入', () => {
    const c = DEFAULT_CONFIG_V5()
    c.activePreset = 'saving'
    c.presets.saving.rules.unshift({ id: 'flow-first', when: { kind: 'image' }, target: { flow: 'transcribe' } })
    const names = configuredProviders(c.presets.saving)
    expect(names).toContain('deepseek-official')
    expect(names).toContain('kimi-coding')
    expect(names).not.toContain('transcribe')
  })
})

describe('previewRoute：@ 误判面（Q6，与 decide 同款语义）', () => {
  const depsWith = (providers: string[]) => ({
    catalog: providers.map((p) => ({ provider: p, models: ['kimi-for-coding'] })),
    availability: null as Record<string, boolean> | null,
  })
  const savingV4 = () => { const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'; return c }

  it('scoped 包名 / @文件 不再判为显式 @：落规则 outcome', () => {
    const p = previewRoute(savingV4(), '见 @README.md 的说明，帮我重构这个函数', depsWith(['deepseek-official', 'kimi-coding']) as never)
    // Fails if: 词法命中即出 explicit 分支 ⇒ 「试一句」显示与 decide 不符
    expect(p.outcome.kind).toBe('rule')
  })

  it('真指令不变：@kimi 仍是 explicit', () => {
    const p = previewRoute(savingV4(), '@kimi 帮我看代码', depsWith(['deepseek-official', 'kimi-coding']) as never)
    expect(p.outcome.kind).toBe('explicit')
  })

  it('目录取不到（catalog: null）⇒ 退化为词法结果，不误杀真指令', () => {
    const p = previewRoute(savingV4(), '@kimi 帮我看代码', { catalog: null, availability: null } as never)
    expect(p.outcome.kind).toBe('explicit')
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
    // 0.7.0 词表含 脚本——换不含 code 组词的说法验证 barcode 子串不误中
    expect(matchingRules(c, '生成 barcode 的工具', false).map((r) => r.id)).not.toContain('code-kfc')
    expect(matchingRules(c, 'please refactor this function', false).map((r) => r.id)).toContain('code-kfc')
    expect(matchingRules(c, '这段代码有 bug', false).map((r) => r.id)).toContain('code-kfc')
    expect(matchingRules(c, '帮忙重构一下', false).map((r) => r.id)).toContain('code-kfc')
  })
  it('0.7.0 minHits：命中数不足阈值不触发；缺省=1；达标触发', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    c.presets.saving.rules.unshift({
      id: 'plan-2',
      when: { kind: 'keywords', group: 'plan', minHits: 2 },
      target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
    c.keywordGroups.plan = ['plan', '计划', '方案']
    expect(matchingRules(c, '帮我做个方案', false).map((r) => r.id)).not.toContain('plan-2')
    expect(matchingRules(c, 'plan：帮我做个方案', false).map((r) => r.id)).toContain('plan-2')
    const d = DEFAULT_CONFIG_V4(); d.activePreset = 'saving'
    d.presets.saving.rules.unshift({
      id: 'plan-1',
      when: { kind: 'keywords', group: 'plan' },
      target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
    d.keywordGroups.plan = ['方案']
    expect(matchingRules(d, '帮我做个方案', false).map((r) => r.id)).toContain('plan-1')
  })

  it('0.7.0 特异度：命中词数多者优先；平手保持列表序；带图轮 image 规则恒优先', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'capability'
    // code 2 词（重构+测试） vs writing 1 词（总结）→ code 反超列表序在前的 writing
    // （0.8.0：「总结」自 chitchat 迁入 writing，chitchat 瘦身后不再命中）
    expect(matchingRules(c, '帮我总结这次重构，顺便写个测试', false).map((r) => r.id))
      .toEqual(['code-kfc', 'writing-v4p'])
    // 各命中 1 词 → 平手按列表序（0.8.0 内置序 code 在 chitchat 前）
    expect(matchingRules(c, '你好，帮我重构一下', false).map((r) => r.id))
      .toEqual(['code-kfc', 'chitchat-flash'])
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

describe('matchingScored（0.8.0）', () => {
  it('返回 {rule, score} 计分排序（与 matchingRules 同序）；matchingRules 为薄封装', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'capability'
    const scored = matchingScored(c, '帮我总结这次重构，顺便写个测试', false)
    expect(scored.map((h) => h.rule.id)).toEqual(['code-kfc', 'writing-v4p'])
    expect(scored.map((h) => h.score)).toEqual([2, 1])
    expect(matchingRules(c, '帮我总结这次重构，顺便写个测试', false).map((r) => r.id))
      .toEqual(scored.map((h) => h.rule.id))
  })
  it('带图轮 image 规则 score = +∞ 恒首位', () => {
    const s = DEFAULT_CONFIG_V4(); s.activePreset = 'saving'
    expect(matchingScored(s, '翻译这句话', true)[0]).toMatchObject({ rule: { id: 'image-k3' }, score: Number.POSITIVE_INFINITY })
  })
})

describe('ruleConditionSummary（0.8.0）', () => {
  it('image→带图；keywords→「命中 <组> 组 ≥N 词」（minHits 缺省 1）', () => {
    const c = DEFAULT_CONFIG_V4()
    expect(ruleConditionSummary(c.presets.saving.rules[0], c)).toBe('带图')
    expect(ruleConditionSummary(c.presets.saving.rules[1], c)).toBe('命中 code 组 ≥1 词')
    const s = DEFAULT_CONFIG_V4(); s.activePreset = 'saving'
    s.presets.saving.rules.unshift({ id: 'plan-2', when: { kind: 'keywords', group: 'plan', minHits: 2 }, target: { provider: 'x', model: 'y' } })
    s.keywordGroups.plan = ['plan', '计划']
    expect(ruleConditionSummary(s.presets.saving.rules[0], s)).toBe('命中 plan 组 ≥2 词')
  })
})

describe('previewRoute（0.8.0 试一句纯函数）', () => {
  const CATALOG: RoutePreviewDeps['catalog'] = [
    { provider: 'kimi-coding', models: ['k3', 'kimi-for-coding'] },
    { provider: 'deepseek-official', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
  ]
  const DEPS: RoutePreviewDeps = { catalog: CATALOG, availability: null }
  it('off：activePreset null', () => {
    expect(previewRoute(DEFAULT_CONFIG_V4(), '随便一句', DEPS).outcome).toEqual({ kind: 'off', reason: '路由已关闭' })
  })
  it('rule：命中并显示词数；未命中 → default', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'capability'
    // 夹具更正（T4，报告备案）：计划原文「帮我重构这个函数」命中 code 组 重构+函数 2 词，
    // 与本块断言 score 1 / 下块「落 writing-v4p」不兼容；改等义句（重构×1 + 周报×1）。
    const hit = previewRoute(c, '帮我重构这段周报', DEPS)
    expect(hit.hits[0]).toMatchObject({ rule: { id: 'code-kfc' }, score: 1 })
    expect(hit.outcome).toEqual({ kind: 'rule', ruleId: 'code-kfc', label: 'code', score: 1, target: { provider: 'kimi-coding', model: 'kimi-for-coding' }, reason: '规则「code」命中 1 词' })
    // 夹具更正（T4）：原文「今天天气不错」命中 chitchat「天气」（capability 含 chitchat 规则）；改零命中句
    expect(previewRoute(c, '今天降温了', DEPS).outcome).toMatchObject({ kind: 'default', target: { provider: 'kimi-coding', model: 'k3' } })
  })
  it('rule：目标不可用（availability false）→ 跳过落下一命中', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'capability'
    const deps: RoutePreviewDeps = { catalog: CATALOG, availability: { 'kimi-coding/kimi-for-coding': false } }
    expect(previewRoute(c, '帮我重构这段周报', deps).outcome).toMatchObject({ kind: 'rule', ruleId: 'writing-v4p' })
  })
  it('explicit：@kimi → 该 provider 目录首个模型；目录缺失 → target 空 + 提示', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    expect(previewRoute(c, '@kimi 帮我看代码', DEPS).outcome).toMatchObject({ kind: 'explicit', provider: 'kimi-coding', target: { provider: 'kimi-coding', model: 'k3' } })
    expect(previewRoute(c, '@kimi 你好', { catalog: null, availability: null }).outcome).toMatchObject({ kind: 'explicit', target: null })
  })
  it('flow 目标（v5）：flow 存在且 transcribe → outcome 标注 flowId', () => {
    const c = DEFAULT_CONFIG_V5(); c.activePreset = 'saving'
    c.presets.saving.rules.unshift({ id: 'flow-first', when: { kind: 'image' }, target: { flow: 'transcribe' } })
    // previewRoute 纯文本调用：带图规则不命中（无 hasImage 参数——文本探针语义）
    const out = previewRoute(c, '帮我重构这个函数', { catalog: CATALOG, availability: null, flows: c.flows })
    expect(out.outcome).toMatchObject({ kind: 'rule', ruleId: 'code-kfc' })
  })
})

describe('duplicateRuleIds（⑥-B 打磨三 2026-08-29: 规则条件互斥约束）', () => {
  const img = (id: string): RouterRule => ({ id, when: { kind: 'image' }, target: { provider: 'p', model: 'm' } })
  const kw = (id: string, group: string, minHits?: number): RouterRule => ({
    id,
    when: { kind: 'keywords', group, ...(minHits === undefined ? {} : { minHits }) },
    target: { provider: 'p', model: 'm' },
  })

  it('两条带图 → 后者入列（首条保留）', () => {
    expect(duplicateRuleIds([img('a'), img('b')])).toEqual(['b'])
  })
  it('三连同条件 → 后两条都入列（保持顺序）', () => {
    expect(duplicateRuleIds([img('a'), img('b'), img('c')])).toEqual(['b', 'c'])
  })
  it('同组同 minHits → 重复；同组不同 minHits → 不算（特异性不同，词数优先可区分）', () => {
    expect(duplicateRuleIds([kw('a', 'code', 1), kw('b', 'code', 1)])).toEqual(['b'])
    expect(duplicateRuleIds([kw('a', 'code', 1), kw('b', 'code', 2)])).toEqual([])
  })
  it('不同组不算重复；空表/单条 → 空', () => {
    expect(duplicateRuleIds([kw('a', 'code'), kw('b', 'plan')])).toEqual([])
    expect(duplicateRuleIds([])).toEqual([])
    expect(duplicateRuleIds([img('a')])).toEqual([])
  })
})

describe('explicitDirective：@provider 与 @provider/model（v1.3.0 Q3）', () => {
  it('provider 简写；@kimi / @kimi-tide 解析为 kimi-coding 别名', () => {
    expect(explicitDirective('@kimi 你好')).toEqual({ provider: 'kimi-coding' })
    expect(explicitDirective('@kimi-tide 你好')).toEqual({ provider: 'kimi-coding' })
    expect(explicitDirective('@zai-coding-cn 你好')).toEqual({ provider: 'zai-coding-cn' })
  })

  it('精确寻址：@provider/model（含点号与连字符的模型名）', () => {
    expect(explicitDirective('@qwen-token-plan-cn/qwen3.8-max 评审')).toEqual({ provider: 'qwen-token-plan-cn', model: 'qwen3.8-max' })
    expect(explicitDirective('@kimi/k3')).toEqual({ provider: 'kimi-coding', model: 'k3' })
    expect(explicitDirective('@zai-coding-cn/glm-5.3-flash 干活')).toEqual({ provider: 'zai-coding-cn', model: 'glm-5.3-flash' })
  })

  it('词法边界保持：邮箱/句中引用不误判（前导锚定 2026-08-23 语义不变）', () => {
    expect(explicitDirective('mail me at user@example.com')).toBeNull()
    expect(explicitDirective('见 foo@bar/baz 那段')).toBeNull()
    // 行首或空白/标点/中文之后才算指令
    expect(explicitDirective('帮我 @kimi 一下')).toEqual({ provider: 'kimi-coding' })
    expect(explicitDirective('（@kimi）')).toEqual({ provider: 'kimi-coding' })
  })
})
