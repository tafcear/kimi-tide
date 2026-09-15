/**
 * HelpTab — 说明页签渲染器（说明页签 spec v2 §3/§5）。
 *
 * 只读：内容全部来自 help-content.ts（单一内容源），本组件不引入任何
 * 写路径、按钮或表单控件；分区用 `<details>` 折叠（默认展开 ① 面板速览
 * 与 ⑦ 常见疑问 = 症状优先），每条的「当前：…」行由内容源自己的 live()
 * 计算——值缺失时整行不渲染（不造噪音）。
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { HELP_SECTIONS, type HelpConfig, type HelpEntry } from './help-content.js'

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
  const config = props.config
  const isV5 = config !== null && config.version === 5
  const sections = HELP_SECTIONS.filter((section) => section.v5Only !== true || isV5)
  return createElement(
    'div',
    { className: 'kt-help' },
    createElement(
      'p',
      { className: 'kt-hint' },
      '这里讲清面板每个元素是什么、设置里每个字段什么意思。想看更深的设计细节，见仓库 packages/dsh-kimi-tide/docs/router.md。',
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
