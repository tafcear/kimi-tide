// test/locales.test.ts
// 阶段 P（基础设施 + 冻结接口）：locales 合并表、formatCopy/makeCopy 语义、
// routing-view 经 copy 注入产出英文（默认缺省 = 改动前中文逐字一致）。
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_KEYWORD_GROUPS, type RouteRowV7, type RouteTarget, type RouterConfigV6, type RouterConfigV7, type RouterPreset, type RouterRule } from '../src/config.js'
import { LOCALE_NS, en, formatCopy, makeCopy, zh, type CopyKey } from '../src/locales/index.js'
import { buildRoutingView, describeRouting } from '../src/routing-view.js'

const t = (provider: string, model: string): RouteTarget => ({ provider, model })
const K3 = t('kimi-coding', 'k3')
const FLASH = t('deepseek-official', 'deepseek-v4-flash')
const GLM = t('zai-coding-cn', 'glm-5.3')

const rule = (id: string, group: string, target: RouteTarget): RouterRule => ({
  id, when: { kind: 'keywords', group }, target,
})

const v6 = (over: Partial<RouterConfigV6> = {}): RouterConfigV6 => ({
  version: 6,
  activePreset: 'main',
  presets: { main: { name: '主力', default: FLASH, rules: [] } satisfies RouterPreset },
  flows: {},
  keywordGroups: { ...DEFAULT_KEYWORD_GROUPS },
  roles: {},
  ...over,
})

const noHan = (s: string): void => {
  // 本机 Node 正则引擎不吃 \p{Han} 属性转义，用显式 CJK 码位范围代替。
  expect(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(s)).toBe(false)
}

describe('P：locales 合并表', () => {
  it('LOCALE_NS 冻结为 settings.kimi-tide；zh/en 键集完全相等', () => {
    expect(LOCALE_NS).toBe('settings.kimi-tide')
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('shared.nav = 现行导航标签（月汐 / Kimi Tide）', () => {
    expect(zh['shared.nav']).toBe('月汐')
    expect(en['shared.nav']).toBe('Kimi Tide')
  })

  it('formatCopy：{0}/{name} 占位替换；缺参原样保留、不抛错', () => {
    expect(formatCopy('HTTP {0}', { 0: 409 })).toBe('HTTP 409')
    expect(formatCopy('{name}→{0}', { name: 'a', 0: 'b' })).toBe('a→b')
    expect(formatCopy('a {0} b {1}', { 0: 'x' })).toBe('a x b {1}')
    expect(formatCopy('无占位')).toBe('无占位')
  })

  it('makeCopy：缺 key 回落 zh，再缺返回 key 本身并 console.warn 一次（不抛错）', () => {
    expect(makeCopy('zh')('shared.nav')).toBe('月汐')
    expect(makeCopy('en')('shared.nav')).toBe('Kimi Tide')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(makeCopy('en')('view.notAKey' as CopyKey)).toBe('view.notAKey')
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('P2：拼接层标点与诊断文案（键值钉住 + 逐字形态）', () => {
  it('连接符与档 5 detail 模板键值逐字钉住（含空格/全角括号）', () => {
    expect(zh['view.join.list']).toBe('、')
    expect(zh['view.join.chunk']).toBe(' ｜ ')
    expect(zh['view.tier.fallback.detail']).toBe('{0}（{1}）')
    expect(en['view.join.list']).toBe(', ')
    expect(en['view.join.chunk']).toBe(' · ')
    expect(en['view.tier.fallback.detail']).toBe('{0} ({1})')
  })

  it('三条连接通道诊断文案键值逐字钉住（含全角括号）', () => {
    expect(zh['shared.diag.describeUnavailable']).toBe('settings.describe 通道不可用（connection api 面缺席且 loopback 未挂载）')
    expect(zh['shared.diag.mutateUnavailable']).toBe('settings.mutate 通道不可用（connection api 面缺席且 loopback 未挂载）')
    expect(zh['shared.diag.modelsUnavailable']).toBe('模型目录通道不可用（session/llm loopback 与 connection api 均缺席）')
  })

  it('describeRouting 缺省中文输出逐字不变：覆盖 、/｜/（） 三种拼接形态', () => {
    const cfg = v6({
      presets: {
        main: {
          name: '主力', default: FLASH,
          rules: [rule('code-kfc', 'code', K3), rule('math-glm', 'math', GLM)],
        } satisfies RouterPreset,
      },
      roles: { frontend: { id: 'frontend', label: '前端', target: K3 } },
    })
    expect(describeRouting(cfg)).toBe(
      '主会话以 deepseek-official/deepseek-v4-flash 为默认目标，命中「code」时改用 kimi-coding/k3、命中「math」时改用 zai-coding-cn/glm-5.3 ｜ 派发：前端→kimi-coding/k3 ｜ 带图：锁存视觉模型',
    )
    expect(buildRoutingView(cfg).precedence[4]!.detail).toBe('deepseek-official/deepseek-v4-flash（预设「主力」默认）')
  })
})

describe('P：routing-view copy 注入', () => {
  it('缺省 copy（不给 deps）⇒ 中文输出与改动前逐字一致', () => {
    const cfg = v6({
      presets: { main: { name: '主力', default: FLASH, rules: [rule('code-kfc', 'code', K3)] satisfies RouterPreset } },
      roles: { frontend: { id: 'frontend', label: '前端', target: K3 } },
    })
    expect(describeRouting(cfg)).toBe(
      '主会话以 deepseek-official/deepseek-v4-flash 为默认目标，命中「code」时改用 kimi-coding/k3 ｜ 派发：前端→kimi-coding/k3 ｜ 带图：锁存视觉模型',
    )
    expect(describeRouting(v6({ activePreset: null }))).toBe('路由已关闭：所有请求保持宿主当前模型。')
  })

  it('copy = makeCopy(\'en\') ⇒ v6 真实配置的 summary/五档文案确实英文（不含汉字）', () => {
    const cfg = v6({
      presets: { main: { name: 'Main', default: FLASH, rules: [rule('code-kfc', 'code', K3)] satisfies RouterPreset } },
      roles: { frontend: { id: 'frontend', label: 'Frontend', target: K3 } },
    })
    const view = buildRoutingView(cfg, { copy: makeCopy('en') })
    noHan(view.summary)
    expect(view.summary).toContain('Dispatch: Frontend→kimi-coding/k3')
    noHan(view.fallback.reason)
    for (const tier of view.precedence) {
      noHan(tier.title)
      noHan(tier.detail)
    }
    expect(view.precedence.map((p) => p.title)).toEqual([
      'Explicit @mention', 'Caller-named model', 'Assignment table roles', 'Keyword rules', 'Default target',
    ])
  })

  it('copy = makeCopy(\'en\') ⇒ v7 统一路由表配置同样产出英文摘要', () => {
    const cfg: RouterConfigV7 = {
      ...v6({
        presets: { main: { name: 'Main', default: FLASH, rules: [] } },
      }),
      version: 7,
      routes: [
        { id: 'code-kfc', scope: 'session', when: { kind: 'keywords', group: 'code' }, target: K3, preset: 'main' },
        { id: 'backend', scope: 'dispatch', when: { kind: 'role' }, target: GLM, label: 'Backend' },
      ] satisfies RouteRowV7[],
    }
    const view = buildRoutingView(cfg, { copy: makeCopy('en') })
    noHan(view.summary)
    expect(view.summary).toContain('main session')
    expect(view.summary).toContain('Dispatch: Backend→zai-coding-cn/glm-5.3')
    expect(view.summary).toContain('latch vision model')
    noHan(view.precedence[2]!.detail)
    expect(view.precedence[2]!.detail).toBe('1 role(s) participate in dispatch rerouting')
  })

  it('路由关闭 + 有分工表 ⇒ 英文 detail 如实表达不发生改道', () => {
    const cfg = v6({
      activePreset: null,
      presets: { main: { name: 'Main', default: FLASH, rules: [] } },
      roles: { backend: { id: 'backend', label: 'Backend', target: GLM } },
    })
    const view = buildRoutingView(cfg, { copy: makeCopy('en') })
    noHan(view.summary)
    noHan(view.precedence[2]!.detail)
    expect(view.precedence[2]!.detail).toContain('Routing is off')
  })
})

describe('W6：shared.* 共享模块文案（键值逐字钉住，防搬运期润色）', () => {
  it('rules/roles/verdict/diag 抽样键值逐字（含全角括号/「」/占位符）', () => {
    expect(zh['shared.rules.off']).toBe('路由已关闭')
    expect(zh['shared.rules.ruleHit']).toBe('规则「{0}」命中 {1} 词')
    expect(formatCopy(zh['shared.rules.ruleHit'], { 0: 'code', 1: 2 })).toBe('规则「code」命中 2 词')
    expect(zh['shared.rules.explicit.fallback']).toBe('显式 @{0}{1} 指令（不可用 → 回落）')
    expect(formatCopy(zh['shared.rules.explicit.configured'], { 0: 'kimi-coding' })).toBe('显式 @kimi-coding 指令 → 预设内已配置目标')
    expect(zh['shared.rules.reviewFlowUnavailable']).toBe('评审流已认领但评审模型不可用')
    expect(zh['shared.roles.claimConflict']).toBe('认领名「{0}」同时属于角色「{1}」与「{2}」')
    expect(zh['shared.roles.listJoin']).toBe('、')
    expect(en['shared.roles.listJoin']).toBe(', ')
    expect(zh['shared.roles.effortSuffix']).toBe('（effort {0}）')
    expect(zh['shared.verdict.unknown']).toBe('无明确结论')
    expect(zh['shared.diag.routesNotArray']).toBe('dsh-kimi-tide: routes 非数组（读路径视为缺失，回落 presets[*].rules / roles 投影）')
    expect(zh['shared.config.preset.saving']).toBe('省钱')
    expect(zh['shared.config.preset.capability']).toBe('能力')
  })

  it('默认关键词组 7 组键值逐字（\\n 分隔还原后 = 原数组，code 17 词）', () => {
    expect(zh['shared.config.kw.code'].split('\n')).toEqual(['代码', 'code', 'bug', '重构', 'refactor', '实现', '函数', '测试', '接口', '联调', '部署', '性能', '报错', '日志', '编译', '命令', '脚本'])
    expect(zh['shared.config.kw.chitchat'].split('\n')).toEqual(['你好', '谢谢', '怎么样', '随便', '聊聊', '天气'])
    expect(zh['shared.config.kw.review'].split('\n')).toEqual(['审查', 'review', '评审', '挑毛病', '复检', '检查', 'audit', '意见', '打分'])
    expect(zh['shared.config.kw.writing'].split('\n')).toEqual(['写作', '文案', '润色', '改写', '扩写', '标题', '推文', '周报', '演讲稿', '总结'])
    expect(zh['shared.config.kw.translate'].split('\n')).toEqual(['翻译', '译成', '中译英', '英译中', 'translate', '本地化'])
    expect(zh['shared.config.kw.longdoc'].split('\n')).toEqual(['长文档', '通读', '逐段', '全文', '上万字', '大文档'])
    expect(zh['shared.config.kw.math'].split('\n')).toEqual(['数学', '证明', '推导', '求解', '公式', '数论', '概率', '逻辑题'])
    // DEFAULT_KEYWORD_GROUPS 快照与表同源（config.test.ts 另钉数组形态）
    expect(DEFAULT_KEYWORD_GROUPS.code).toEqual(zh['shared.config.kw.code'].split('\n'))
  })
})
