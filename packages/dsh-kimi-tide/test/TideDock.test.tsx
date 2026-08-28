/**
 * TideDock v4 render-to-string tests（Task 9 / Step 1）。
 *
 * 钉桩 dock v4 视图：预设名/默认模型 chip、关闭态、决策 chip 显示 reason
 * 且无 scoreDelta。断言关键文案而非整树快照，对样式/标记微调保持稳健。
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

describe('TideDock v4', () => {
  it('dock 显示当前预设名与默认模型；关闭时显示关闭', () => {
    const panel = makePanel({ router: { activePreset: 'saving', presetName: '省钱', defaultTarget: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, ruleCount: 2 } })
    const html = renderToString(createElement(TideDock, { sessionId: 's', useProjection: () => panel }))
    expect(html).toContain('省钱')
    expect(html).toContain('deepseek-v4-flash')
    const off = renderToString(createElement(TideDock, { sessionId: 's', useProjection: () => makePanel({ router: { activePreset: null, presetName: null, defaultTarget: null, ruleCount: 0 } }) }))
    expect(off).toContain('关闭')
  })
  it('决策 chip 显示 reason，无 scoreDelta', () => {
    const panel = makePanel({ decision: { chosen: { provider: 'kimi-coding', model: 'kimi-for-coding' }, reason: '规则「code」命中' } })
    const html = renderToString(createElement(TideDock, { sessionId: 's', useProjection: () => panel }))
    expect(html).toContain('规则「code」命中')
    expect(html).not.toContain('Δ')
  })
})

describe('TideDock 0.8.x⑨ 限额区跟随当前路由目标', () => {
  const kimiQuota = {
    weekly: { used: 10, limit: 100, resetTime: 'w' },
    fiveHour: { used: 5, limit: 100, resetTime: 'f' },
    membershipLevel: 'L1',
    fetchedAt: 1,
    stale: false,
  }
  const render = (panel: KimiTidePanelProjection): string =>
    renderToString(createElement(TideDock, { sessionId: 's', useProjection: () => panel }))

  it('决策目标非配额来源 provider → 限额区与刷新按钮隐藏（模型信息保留）', () => {
    const html = render(makePanel({
      quota: kimiQuota,
      quotaProvider: 'kimi-coding',
      decision: { chosen: { provider: 'deepseek-official', model: 'deepseek-v4-pro' }, reason: '预设「省钱」默认' },
    }))
    // Fails if: dock 恒显 kimi 额度（限额区未跟随当前路由目标解绑——池⑨）。
    expect(html).not.toContain('📊')
    expect(html).not.toContain('🔄')
    expect(html).toContain('deepseek-v4-pro')
  })

  it('决策目标 = 配额来源 provider → 限额区照常渲染', () => {
    const html = render(makePanel({
      quota: kimiQuota,
      quotaProvider: 'kimi-coding',
      decision: { chosen: { provider: 'kimi-coding', model: 'k3' }, reason: '规则「code」命中' },
    }))
    expect(html).toContain('📊')
    expect(html).toContain('🔄')
  })

  it('无决策回落激活预设默认 target：deepseek 默认 → 隐藏；kimi 默认 → 显示', () => {
    expect(render(makePanel({ quota: kimiQuota, quotaProvider: 'kimi-coding' }))).not.toContain('📊')
    const kimiDefault = makePanel({
      quota: kimiQuota,
      quotaProvider: 'kimi-coding',
      router: { activePreset: 'capability', presetName: '能力', defaultTarget: { provider: 'kimi-coding', model: 'k3' }, ruleCount: 8 },
    })
    expect(render(kimiDefault)).toContain('📊')
  })

  it('旧载荷无 quotaProvider 视同 kimi 来源（向后兼容）：kimi 目标限额照常显示', () => {
    const html = render(makePanel({
      quota: kimiQuota,
      decision: { chosen: { provider: 'kimi-coding', model: 'k3' }, reason: '显式 @kimi 指令' },
    }))
    expect(html).toContain('📊')
  })

  it('目标 = 配额来源但 quota null → 配额不可用提示保留；目标异源 → 提示一并隐藏', () => {
    const kimiTarget = render(makePanel({
      quota: null,
      quotaProvider: 'kimi-coding',
      decision: { chosen: { provider: 'kimi-coding', model: 'k3' }, reason: 'x' },
    }))
    expect(kimiTarget).toContain('配额不可用')
    const deepseekTarget = render(makePanel({
      quota: null,
      quotaProvider: 'kimi-coding',
      decision: { chosen: { provider: 'deepseek-official', model: 'deepseek-v4-pro' }, reason: 'x' },
    }))
    expect(deepseekTarget).not.toContain('配额不可用')
  })
})
