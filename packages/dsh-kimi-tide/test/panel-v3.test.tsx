/**
 * Panel v3 render-to-string snapshot tests (Task 10).
 *
 * These assert KEY COPY （关键文案） in the server-rendered markup rather than a
 * full tree snapshot, so they stay robust to style/markup tweaks. Each test
 * names the production change that would make it fail.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import YAML from 'yaml'
import { parseKimiTideCommand, isInlineYamlText } from '../src/commands.js'
import { CandidateList, candidatesToSidecar } from '../src/client/CandidateList.js'
import { ScoreEditor, scoresToSidecar } from '../src/client/ScoreEditor.js'
import { ReasonPanel } from '../src/client/ReasonPanel.js'
import { TideDock } from '../src/client/TideDock.js'
import type { CandidateSummary, KimiTidePanelProjection } from '../src/types.js'

const noop = () => {}

const CANDIDATES: CandidateSummary[] = [
  { provider: 'kimi-tide', model: 'kimi-for-coding', available: true },
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', available: true },
  { provider: 'kimi-tide', model: 'k3', available: false },
]

const MODEL_OPTIONS = ['kimi-for-coding', 'deepseek-v4-flash', 'k3', 'deepseek-v4-pro']

function makePanel(overrides: Partial<KimiTidePanelProjection> = {}): KimiTidePanelProjection {
  return {
    quota: null,
    local: { today: { inputTokens: 0, outputTokens: 0 }, session: { inputTokens: 0, outputTokens: 0 }, calls: 0 },
    router: {
      mode: 'capability',
      primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
      premiumBudget: 0.2,
      budgetWindow: 20,
      charsPerToken: 2,
    } as KimiTidePanelProjection['router'],
    reasoning: { enabled: true },
    models: { kimi: ['kimi-for-coding', 'k3'], deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
    configSource: 'sidecar',
    candidates: CANDIDATES,
    decision: { chosen: { provider: 'kimi-tide', model: 'kimi-for-coding' }, reason: '代码任务命中 Kimi 编码优势', scoreDelta: 1.5 },
    ...overrides,
  }
}

describe('CandidateList', () => {
  it('renders a header, one row per candidate, and an add-row control', () => {
    const html = renderToString(createElement(CandidateList, {
      candidates: CANDIDATES,
      defaultTarget: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      modelOptions: MODEL_OPTIONS,
      busy: false,
      onCommand: noop,
    }))
    // Fails if: the section header or add control is removed.
    expect(html).toContain('候选')
    expect(html).toContain('添加候选')
    // Fails if: candidate rows stop rendering their provider/model identity.
    expect(html).toContain('kimi-for-coding')
    expect(html).toContain('deepseek-v4-flash')
    expect(html).toContain('k3')
  })

  it('marks the default candidate with a checked radio', () => {
    const html = renderToString(createElement(CandidateList, {
      candidates: CANDIDATES,
      defaultTarget: { provider: 'kimi-tide', model: 'kimi-for-coding' },
      modelOptions: MODEL_OPTIONS,
      busy: false,
      onCommand: noop,
    }))
    expect(html).toContain('默认')
    expect(html).toContain('type="radio"')
    expect(html).toContain('checked')
  })

  it('greys out unavailable candidates', () => {
    const html = renderToString(createElement(CandidateList, {
      candidates: CANDIDATES,
      defaultTarget: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      modelOptions: MODEL_OPTIONS,
      busy: false,
      onCommand: noop,
    }))
    // Fails if: unavailable candidates lose their disabled/greyed affordance.
    expect(html).toContain('kt-unavailable')
    expect(html).toContain('不可用')
  })

  it('emits a remove control per row', () => {
    const html = renderToString(createElement(CandidateList, {
      candidates: CANDIDATES,
      defaultTarget: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      modelOptions: MODEL_OPTIONS,
      busy: false,
      onCommand: noop,
    }))
    // Fails if: per-row delete affordance is dropped.
    expect(html).toContain('删除')
  })
})

describe('ScoreEditor', () => {
  it('renders all six capability dimensions with 0–5 step-0.5 sliders', () => {
    const html = renderToString(createElement(ScoreEditor, {
      target: { provider: 'kimi-tide', model: 'kimi-for-coding' },
      busy: false,
      onCommand: noop,
    }))
    for (const dim of ['代码', '推理', '写作', '工具', '视觉', '长上下文']) {
      expect(html).toContain(dim)
    }
    expect(html).toContain('type="range"')
    expect(html).toContain('step="0.5"')
    expect(html).toContain('max="5"')
  })

  it('shows baseline vs override scores and a one-shot save action', () => {
    const html = renderToString(createElement(ScoreEditor, {
      target: { provider: 'kimi-tide', model: 'kimi-for-coding' },
      busy: false,
      onCommand: noop,
    }))
    // Fails if: the baseline-vs-override readout or save affordance is removed.
    expect(html).toContain('基线')
    expect(html).toContain('覆盖')
    expect(html).toContain('保存评分')
  })
})

describe('ReasonPanel', () => {
  it('shows configSource, decision reason/scoreDelta, and the actual-route chip', () => {
    const html = renderToString(createElement(ReasonPanel, {
      configSource: 'sidecar',
      decision: { chosen: { provider: 'kimi-tide', model: 'kimi-for-coding' }, reason: '代码任务命中 Kimi 编码优势', scoreDelta: 1.5 },
      mode: 'capability',
    }))
    // Fails if: configSource / decision / actual-route observability is dropped.
    expect(html).toContain('sidecar')
    expect(html).toContain('代码任务命中 Kimi 编码优势')
    expect(html).toContain('1.5')
    expect(html).toContain('实际路由')
    expect(html).toContain('kimi-for-coding')
  })

  it('renders a friendly empty state when no decision was observed', () => {
    const html = renderToString(createElement(ReasonPanel, {
      configSource: 'default',
      decision: null,
      mode: 'capability',
    }))
    expect(html).toContain('default')
    expect(html).toContain('实际路由')
    // Fails if: the no-decision empty copy disappears.
    expect(html).toMatch(/暂无|尚未|没有/)
  })
})

describe('TideDock v3', () => {
  const useProjection = () => makePanel()

  it('mounts the v3 sections and the decision chip', () => {
    const html = renderToString(createElement(TideDock, { sessionId: 's1', useProjection }))
    // v3 panels mounted inside the settings fold.
    expect(html).toContain('候选')
    expect(html).toContain('保存评分')
    expect(html).toContain('实际路由')
    // Decision chip on the main row.
    expect(html).toContain('代码任务命中 Kimi 编码优势')
  })

  it('no longer emits the removed v1-only settings fields', () => {
    const html = renderToString(createElement(TideDock, { sessionId: 's1', useProjection }))
    // Fails if: the broken v1 keys (Task 9 removed them from SETTABLE_KEYS) reappear.
    expect(html).not.toContain('升级阈值')
    expect(html).not.toContain('长上下文模型')
    expect(html).not.toContain('Kimi 模型')
  })

  it('keeps the quota/tokens environment readouts', () => {
    const html = renderToString(createElement(TideDock, { sessionId: 's1', useProjection }))
    // Fails if: usage/quota readouts are dropped during the v3 re-mount.
    expect(html).toContain('配额不可用')
    expect(html).toContain('📥')
    expect(html).toContain('📤')
  })
})

describe('panel v3 save channel (inline YAML via import-config)', () => {
  it('ScoreEditor 生成的 sidecar 文本被命令层识别为内联 YAML 且可解析', () => {
    const text = scoresToSidecar({ provider: 'kimi-tide', model: 'kimi-for-coding' }, { code: 4.5, vision: 3 })
    expect(isInlineYamlText(text)).toBe(true)
    const parsed = YAML.parse(text) as { version: number; scores: Record<string, Record<string, number>> }
    expect(parsed.version).toBe(2)
    expect(parsed.scores['kimi-tide/kimi-for-coding']).toEqual({ code: 4.5, vision: 3 })
  })

  it('CandidateList 生成的 sidecar 文本被命令层识别为内联 YAML 且可解析', () => {
    const text = candidatesToSidecar(
      [
        { provider: 'kimi-tide', model: 'k3' },
        { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      ],
      { provider: 'kimi-tide', model: 'k3' },
    )
    expect(isInlineYamlText(text)).toBe(true)
    const parsed = YAML.parse(text) as {
      default: { provider: string; model: string }
      candidates: Array<{ provider: string; model: string }>
    }
    expect(parsed.default.model).toBe('k3')
    expect(parsed.candidates).toHaveLength(2)
  })

  it('面板发送的完整命令串经 parse 后保留完整内联 YAML（多行/缩进不丢失）', () => {
    const text = scoresToSidecar({ provider: 'kimi-tide', model: 'kimi-for-coding' }, { code: 4.5 })
    const cmd = parseKimiTideCommand(`import-config ${text}`)
    expect(cmd.kind).toBe('import-config')
    if (cmd.kind !== 'import-config') return
    expect(cmd.path).toBe(text)
    expect(isInlineYamlText(cmd.path)).toBe(true)
  })
})
