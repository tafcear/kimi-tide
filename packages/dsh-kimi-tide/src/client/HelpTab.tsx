/**
 * HelpTab — 说明页签渲染器（说明页签 spec v2 §3/§5）。
 *
 * 只读：内容**全部**来自 help-content.ts（单一内容源）——
 * - `buildHelpSections(t)`（8 分区）：受覆盖闸（锚点双向覆盖）与 FEATURE_KEYS 防腐烂闸约束；
 * - `buildWhatsNew(t)`（「本次新版」导览）：按版本轮替的时效文案，无锚点、不参与覆盖闸，
 *   但结构完整性同样有测试钉住（见 test/help-content.test.ts）。
 *
 * 本组件不引入任何写路径、按钮或表单控件；分区用 `<details>` 折叠（默认展开
 * ① 面板速览、⑦ 常见疑问与「本次新版」导览 = 症状优先），每条的「当前：…」行
 * 由内容源自己的 live() 计算——值缺失时整行不渲染（不造噪音）。
 *
 * locale 化（W4）：所有文案经 useCopy() 取当前语言；服务缺席回落中文表。
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { isV5Plus } from '../config.js'
import { buildHelpSections, buildWhatsNew, type HelpConfig, type HelpEntry } from './help-content.js'
import { useCopy } from './locale.js'

export interface HelpTabProps {
  /** 生效配置（card-store 快照的 config）；null = 未就绪 → 只渲染静态内容。 */
  config: HelpConfig | null
}

function liveLineOf(entry: HelpEntry, config: HelpConfig | null): string | undefined {
  if (config === null || entry.live === undefined) return undefined
  try {
    const line = entry.live(config)
    return line === undefined || line.trim() === '' ? undefined : line
  } catch {
    // live 是纯读；任何异常都不该让整页崩掉（降级为不渲染该行）
    return undefined
  }
}

export function HelpTab(props: HelpTabProps): ReactNode {
  // 文案经 useCopy() 取当前语言（服务缺席回落中文表）；语言切换由 locale 订阅触发重渲染。
  const t = useCopy()
  const config = props.config
  const isV5 = config !== null && isV5Plus(config)
  const whatsNew = buildWhatsNew(t)
  const sections = buildHelpSections(t).filter((section) => section.v5Only !== true || isV5)
  return createElement(
    'div',
    { className: 'kt-help' },
    createElement(
      'p',
      { className: 'kt-hint' },
      t('help.tab.hint'),
    ),
    // 「本次新版」导览（v2.1.0）：纯静态、默认展开——症状优先的既有纪律
    // （先说「这一版哪里不一样」，再进逐元素说明）。
    createElement(
      'details',
      { key: 'whatsnew', className: 'kt-help-sec kt-card kt-help-whatsnew', open: true },
      createElement('summary', null, t('help.tab.whatsNewSummary')),
      ...whatsNew.map((entry) =>
        createElement(
          'div',
          { key: entry.id, className: 'kt-help-entry' },
          createElement('div', { className: 'kt-help-title' }, entry.title),
          createElement(
            'ul',
            { className: 'kt-help-body' },
            ...entry.body.map((line, index) => createElement('li', { key: index }, line)),
          ),
        ),
      ),
    ),
    ...sections.map((section) =>
      createElement(
        'details',
        {
          key: section.id,
          className: `kt-help-sec kt-card kt-help-${section.id}`,
          open: section.defaultOpen === true,
        },
        createElement('summary', null, section.title),
        ...section.entries.map((entry) => {
          const live = liveLineOf(entry, config)
          return createElement(
            'div',
            { key: entry.id, className: 'kt-help-entry' },
            createElement('div', { className: 'kt-help-title' }, entry.title),
            createElement(
              'ul',
              { className: 'kt-help-body' },
              ...entry.body.map((line, index) => createElement('li', { key: index }, line)),
            ),
            live === undefined
              ? null
              : createElement('div', { className: 'kt-help-live' }, live),
          )
        }),
      ),
    ),
  )
}

export default HelpTab
