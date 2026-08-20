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
