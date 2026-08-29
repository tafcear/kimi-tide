/**
 * TideDock render-to-string 钉桩（Task 9 → ⑥-B → ⑥-B 打磨 2026-08-29）。
 *
 * ⑥-B 打磨（用户报告：r2 额度不居中 / 决策面板推挤布局 / 每轮乱跳 / emoji
 * 语义不清）：r1 锁单行（原因只进 title）、r2 槽位恒定（⑨ 由整组隐藏改为
 * 置灰「—」占位）、emoji 全量退役改内联 SVG（icons.tsx）。断言关键文案与
 * 结构标记而非整树快照，对样式微调保持稳健。Portal 行为另见
 * TideDock.portal.dom.test.tsx（renderToString 不渲染 portal）。
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { TideDock } from '../src/client/TideDock.js'
import type { KimiTidePanelProjection } from '../src/types.js'

function makePanel(overrides: Partial<KimiTidePanelProjection> = {}): KimiTidePanelProjection {
  return {
    quota: null,
    kimi: { route: true, key: true },
    router: {
      activePreset: 'saving',
      presetName: '省钱',
      defaultTarget: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      ruleCount: 2,
    },
    reasoning: { enabled: true },
    models: { kimi: ['kimi-for-coding', 'k3'], deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
    configSource: 'settings',
    candidates: [],
    decision: null,
    ...overrides,
  }
}

const kimiQuota = {
  weekly: { used: 10, limit: 100, resetTime: 'w' },
  fiveHour: { used: 80, limit: 100, resetTime: 'f' },
  membershipLevel: 'L1',
  fetchedAt: 1,
  stale: false,
}

const render = (panel: KimiTidePanelProjection): string =>
  renderToString(createElement(TideDock, { sessionId: 's', useProjection: () => panel }))

const count = (html: string, marker: string): number => html.split(marker).length - 1

/** React SSR 在相邻表达式文本间插 `<!-- -->` 注释节点——可见文本断言前剥掉。 */
const visible = (html: string): string => html.replace(/<!-- -->/g, '')

describe('TideDock 基础视图（v4 承继）', () => {
  it('dock 显示当前预设名与默认模型；关闭时显示关闭', () => {
    const html = render(makePanel())
    expect(html).toContain('省钱')
    expect(html).toContain('deepseek-v4-flash')
    const off = render(makePanel({ router: { activePreset: null, presetName: null, defaultTarget: null, ruleCount: 0 } }))
    expect(off).toContain('关闭')
  })

  it('⑥-B 打磨: 决策按钮固定短标签「决策」, 超长原因只进 title 不进 r1 文本（防换行跳动）', () => {
    const long = 'flow:transcribe 转述失败（latch-image）→ 原生视觉作答'
    const html = render(makePanel({ decision: { chosen: { provider: 'kimi-coding', model: 'k3' }, reason: long } }))
    const button = html.match(/<button[^>]*kt-decision-toggle[\s\S]*?<\/button>/)
    expect(button).not.toBeNull()
    // 可见文本以「决策」收尾（原因在 title 属性里，不在文本流）
    expect(button![0]).toMatch(/决策<\/button>$/)
    // 原因全文仍可经悬浮提示查看
    expect(html).toContain('决策可观测：')
    expect(html).toContain('原生视觉作答')
    expect(html).not.toContain('Δ')
  })
})

describe('TideDock 未接入指引文案（评审 P2-11）', () => {
  it('指引指向真实页签名「设置 → 模型」，不再引用不存在的 Models', () => {
    const html = visible(render(makePanel({ kimi: { route: false, key: false } })))
    // Fails if: 文案回退到「设置 → Models」（设置页真实导航按钮叫「模型」，照 Models 找不到）
    expect(html).toContain('Kimi 未接入：设置 → 模型')
    expect(html).not.toContain('Models')
    // title 内的配置指引同步修正
    expect(html).toContain('设置 → 模型 配置')
  })
})

describe('TideDock 决策入口常驻（评审 P2-12）', () => {
  it('无决策时「决策」开关仍渲染（可观测入口不再随 decision===null 消失）', () => {
    const html = render(makePanel())
    // Fails if: 开关恢复 decision!==null 门控（无决策时用户零入口，空态解释成死代码）
    expect(html).toContain('kt-decision-toggle')
  })
})

describe('TideDock ⑥-B 两行布局', () => {
  it('第一行=身份+路由链（预设 → 打底 ⟶ 决策目标）；第二行=可观测条（限额进度条/图像上下文/刷新）', () => {
    const html = render(makePanel({
      quota: kimiQuota,
      quotaProvider: 'kimi-coding',
      decision: { chosen: { provider: 'kimi-coding', model: 'k3' }, reason: '规则「code」命中' },
      imageContext: { native: 0, transcribed: 1, blind: 0 },
    }))
    // Fails if: dock 仍是单行 chip 串（⑥-B 布局重构未落地）。
    expect(html).toContain('kt-dock-r1')
    expect(html).toContain('kt-dock-r2')
    expect(html).toContain('kt-route-arrow')
    expect(html).toContain('kt-quota-bar')
    // 周用量 10/100 → 进度条宽度 10%
    expect(html).toContain('width:10%')
  })
})

describe('TideDock ⑥-B 打磨: 骨架恒定（r2 槽位常驻置灰占位）', () => {
  it('决策目标非 kimi → 额度/时钟槽置灰「—」占位而非整组消失（槽数与 kimi 态一致）', () => {
    const kimiHtml = render(makePanel({
      quota: kimiQuota,
      quotaProvider: 'kimi-coding',
      decision: { chosen: { provider: 'kimi-coding', model: 'k3' }, reason: 'x' },
    }))
    const dimHtml = render(makePanel({
      quota: kimiQuota,
      quotaProvider: 'kimi-coding',
      decision: { chosen: { provider: 'deepseek-official', model: 'deepseek-v4-pro' }, reason: 'x' },
    }))
    // Fails if: ⑨ 仍按整组隐藏实现（r2 结构随目标变动——「每轮乱跳」来源之一）
    expect(count(dimHtml, 'kt-slot')).toBe(count(kimiHtml, 'kt-slot'))
    expect(dimHtml).toContain('kt-dim')
    expect(dimHtml).toContain('—')
    // kimi 态数值点亮（周 10/100 → 剩90）且无置灰
    expect(visible(kimiHtml)).toContain('剩90')
    expect(count(kimiHtml, 'kt-dim')).toBeLessThan(count(dimHtml, 'kt-dim'))
  })

  it('r2 右端组独立成组（时钟/刷新右贴）；刷新按钮常驻不再随异源目标消失', () => {
    const dimHtml = render(makePanel({
      quota: kimiQuota,
      quotaProvider: 'kimi-coding',
      decision: { chosen: { provider: 'deepseek-official', model: 'deepseek-v4-pro' }, reason: 'x' },
    }))
    // Fails if: 时钟/刷新未右贴（对比稿 margin-left:auto 欠账——「不居中」来源）
    expect(dimHtml).toContain('kt-dock-r2-end')
    // Fails if: 刷新按钮仍随 quotaRelevant 消失
    expect(dimHtml).toContain('kt-refresh')
  })

  it('kimi 目标但配额取数失败 → 槽位仍在且置灰, title 注明配额不可用', () => {
    const html = render(makePanel({
      quota: null,
      quotaProvider: 'kimi-coding',
      decision: { chosen: { provider: 'kimi-coding', model: 'k3' }, reason: 'x' },
    }))
    expect(html).toContain('kt-dim')
    expect(html).toContain('配额不可用')
  })

  it('异源目标 + 配额取数失败 → 只显「—」, 不显配额不可用（不误报 kimi 故障）', () => {
    const html = render(makePanel({
      quota: null,
      quotaProvider: 'kimi-coding',
      decision: { chosen: { provider: 'deepseek-official', model: 'deepseek-v4-pro' }, reason: 'x' },
    }))
    expect(html).toContain('—')
    expect(html).not.toContain('配额不可用')
  })
})

describe('TideDock ⑥-B 打磨: emoji 退役 → 内联 SVG 图标', () => {
  it('SVG 图标上线, 全部装饰 emoji 退役', () => {
    const html = render(makePanel({
      quota: kimiQuota,
      quotaProvider: 'kimi-coding',
      decision: { chosen: { provider: 'kimi-coding', model: 'k3' }, reason: '规则「code」命中' },
      imageContext: { native: 1, transcribed: 2, blind: 0 },
    }))
    // Fails if: 图标仍是 emoji（语义不清——2026-08-29 用户裁定换 SVG）
    expect(html).toContain('<svg')
    const retired = ['📊', '⏳', '🖼️', '🕐', '📡', '⚡', '🔄', '🌙', '⚠️', '🧭', '🔭', '🧰', '💡', '🔁', '🌫️', '✨']
    for (const emoji of retired) expect(html).not.toContain(emoji)
  })

  it('⑥-B 打磨二轮: 图标语义色钩子（kt-ic-* 类上色; 告警/品牌色沿用既有 currentColor 链）', () => {
    const html = render(makePanel({
      quota: kimiQuota,
      quotaProvider: 'kimi-coding',
      decision: { chosen: { provider: 'kimi-coding', model: 'k3' }, reason: 'x' },
      imageContext: { native: 1, transcribed: 0, blind: 0 },
    }))
    // Fails if: 图标退回无色灰调（2026-08-29 用户复验「svg 没有色彩一般般」）
    expect(html).toContain('kt-ic-moon')
    expect(html).toContain('kt-ic-route')
    expect(html).toContain('kt-ic-base')
    expect(html).toContain('kt-ic-target')
    expect(html).toContain('kt-ic-compass')
    expect(html).toContain('kt-ic-calendar')
    expect(html).toContain('kt-ic-gauge')
    expect(html).toContain('kt-ic-image')
    expect(html).toContain('kt-ic-clock')
    expect(html).toContain('kt-ic-refresh')
  })
})

describe('TideDock 图像上下文槽（0.6.x池#1 承继 + 新文案）', () => {
  it('三态计数新文案: 图 原/述/盲', () => {
    const html = render(makePanel({ imageContext: { native: 1, transcribed: 2, blind: 0 } }))
    // Fails if: 回退旧「图1/转2/盲0」emoji 文案
    expect(visible(html)).toContain('原1·述2·盲0')
  })

  it('blind>0 → 计数槽警示态（spec §8 承继）', () => {
    const html = render(makePanel({ imageContext: { native: 0, transcribed: 1, blind: 2 } }))
    expect(html).toContain('kt-warn')
    expect(visible(html)).toContain('盲2')
  })

  it('imageContext 缺席（无图会话）→ 不渲染图像槽', () => {
    expect(render(makePanel({}))).not.toContain('述')
  })
})
