/**
 * HelpTab — 说明页签渲染断言（renderToString，无 jsdom，沿用本目录既有习惯）。
 *
 * 为什么需要：`WHATS_NEW` 从 HelpTab.tsx 迁入 help-content.ts 后，**内容**有结构测试，
 * 但「渲染出来」没人钉——漏 map、key 冲突、details 默认不展开、类名漂移都会静默漏过。
 *
 * Fails if：导览节或任一导览条目/正文行没渲染出来；八个分区标题缺一；
 * config=null 时仍出现 live 行；live 抛错把整页带崩。
 */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HelpTab } from '../src/client/HelpTab.js'
import { HELP_SECTIONS, WHATS_NEW } from '../src/client/help-content.js'

const render = (config: unknown): string =>
  renderToString(createElement(HelpTab, { config: config as never }))

/**
 * react-dom/server 会把正文里的 `<` `>` `"` `'` 转义成实体（导览正文里有
 * 「显式 @ > 调用方点名 > …」这类文本）⇒ 文本断言必须先解码，否则比的是转义串。
 * 顺序：先解 `&amp;` 之外的，最后解 `&amp;`。
 */
const decodeText = (html: string): string =>
  html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')

describe('HelpTab：本次新版导览', () => {
  it('导览节标题 + 全部条目标题 + 每条正文逐行都在 HTML 里', () => {
    const html = decodeText(render(null))
    expect(html).toContain('本次新版：路由页怎么读')
    for (const entry of WHATS_NEW) {
      expect(html, `导览条目标题缺失: ${entry.id}`).toContain(entry.title)
      for (const line of entry.body) {
        expect(html, `导览正文行缺失: ${entry.id}`).toContain(line)
      }
    }
  })

  it('导览节默认展开（`open`），且它排在分区之前（症状优先）', () => {
    const html = render(null)
    expect(html).toMatch(/kt-help-whatsnew[^>]*open/)
    const whatsnewAt = html.indexOf('kt-help-whatsnew')
    const firstSectionAt = html.indexOf(`kt-help-${HELP_SECTIONS[0]!.id}`)
    expect(whatsnewAt).toBeGreaterThan(-1)
    expect(firstSectionAt).toBeGreaterThan(-1)
    expect(whatsnewAt).toBeLessThan(firstSectionAt)
  })
})

describe('HelpTab：分区与降级', () => {
  it('八个分区标题全部渲染', () => {
    const html = render(null)
    for (const section of HELP_SECTIONS) {
      expect(html, `分区标题缺失: ${section.id}`).toContain(section.title)
    }
  })

  it('config=null 时不渲染任何 live 行（值缺失整行不渲染，不造噪音）', () => {
    const withLive = HELP_SECTIONS.flatMap((s) => s.entries).filter((e) => e.live !== undefined)
    expect(withLive.length, '前提：确实存在带 live 的条目').toBeGreaterThan(0)
    expect(render(null)).not.toContain('kt-help-live')
  })

  it('live 读数抛错时降级为不渲染该行，导览与分区仍完整（不整页崩）', () => {
    // 空对象配置：live 的取字段路径多半会抛 —— 组件内已 try/catch 兜底。
    expect(() => render({})).not.toThrow()
    const html = render({})
    expect(html).toContain('本次新版：路由页怎么读')
    for (const section of HELP_SECTIONS) expect(html).toContain(section.title)
  })
})
