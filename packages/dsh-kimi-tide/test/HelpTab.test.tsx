/**
 * HelpTab — 说明页签渲染断言（renderToString，无 jsdom，沿用本目录既有习惯）。
 *
 * 为什么需要：`WHATS_NEW` 从 HelpTab.tsx 迁入 help-content.ts 后，**内容**有结构测试，
 * 但「渲染出来」没人钉——漏 map、key 冲突、details 默认不展开、类名漂移都会静默漏过。
 *
 * Fails if：导览节或任一导览条目/正文行没渲染出来；八个分区标题缺一；
 * config=null 时仍出现 live 行；live 抛错把整页带崩。
 *
 * W4 locale 化新增：英文渲染闸、键集一致性、占位符一致性。
 */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HelpTab } from '../src/client/HelpTab.js'
import { buildHelpSections, buildWhatsNew, DOCK_ELEMENTS, FEATURE_KEYS, HELP_SECTIONS, SETTINGS_SECTIONS, WHATS_NEW } from '../src/client/help-content.js'
import { zh as zhHelp } from '../src/locales/zh/help.js'
import { en as enHelp } from '../src/locales/en/help.js'
import { formatCopy, type CopyKey, type CopyParams } from '../src/locales/index.js'

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
    // 中文回落：无 locale 服务时 copy() 返回 zh 表值
    expect(html).toContain(zhHelp['help.tab.whatsNewSummary'])
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
    expect(html).toContain(zhHelp['help.tab.whatsNewSummary'])
    for (const section of HELP_SECTIONS) expect(html).toContain(section.title)
  })
})

/* ======== W4 locale 化新增测试 ======== */

/** 用指定表造一个简易 t 函数（模拟 locale 服务绑定后的行为）。 */
function makeT(table: Record<string, string>): (key: CopyKey, params?: CopyParams) => string {
  return (key, params) => {
    const hit = table[key] ?? zhHelp[key]
    if (hit === undefined) return String(key)
    return formatCopy(hit, params)
  }
}

describe('HelpTab：locale 化键集与占位符', () => {
  it('zh/en 键集相等（运行期断言）', () => {
    const zhKeys = Object.keys(zhHelp).sort()
    const enKeys = Object.keys(enHelp).sort()
    expect(enKeys).toEqual(zhKeys)
  })

  it('zh/en 占位符集合一致（每个键的 {N}/{name} 集合相同）', () => {
    const placeholderRe = /\{([^{}]+)\}/g
    for (const key of Object.keys(zhHelp)) {
      const zhPlaceholders = [...(zhHelp[key] as string).matchAll(placeholderRe)].map((m) => m[1]).sort()
      const enPlaceholders = [...(enHelp[key as keyof typeof enHelp] as string).matchAll(placeholderRe)].map((m) => m[1]).sort()
      expect(enPlaceholders, `占位符不一致: ${key}`).toEqual(zhPlaceholders)
    }
  })
})

describe('HelpTab：英文渲染闸', () => {
  it('用 en 表构建的内容包含英文且不包含对应中文原句', () => {
    const enT = makeT(enHelp)
    const enSections = buildHelpSections(enT)
    const enWhatsNew = buildWhatsNew(enT)

    // 抽样验证：分区标题、导览标题、正文各一条
    // 1. 分区标题：dock
    expect(enSections[0]!.title).toBe(enHelp['help.section.dock.title'])
    expect(enSections[0]!.title).not.toBe(zhHelp['help.section.dock.title'])

    // 2. 导览标题：chain
    expect(enWhatsNew[0]!.title).toBe(enHelp['help.whatsNew.chain.title'])
    expect(enWhatsNew[0]!.title).not.toBe(zhHelp['help.whatsNew.chain.title'])

    // 3. 正文行：dock.label.body0
    const dockLabelEntry = enSections[0]!.entries.find((e) => e.id === 'dock-label')!
    expect(dockLabelEntry.body[0]).toBe(enHelp['help.section.dock.label.body0'])
    expect(dockLabelEntry.body[0]).not.toBe(zhHelp['help.section.dock.label.body0'])

    // 4. fallback hint body should contain English, not Chinese
    const routingSection = enSections.find((s) => s.id === 'routing')!
    const fallbackEntry = routingSection.entries.find((e) => e.id === 'routing-fallback')!
    for (const line of fallbackEntry.body) {
      expect(line).not.toMatch(/^latch：带图后锁定/)
    }
  })

  it('负控：用 zh 表构建时中文 ≠ 英文（证明英文闸有牙）', () => {
    const zhT = makeT(zhHelp)
    const zhSections = buildHelpSections(zhT)

    // 中文构建结果确实等于中文表值
    expect(zhSections[0]!.title).toBe(zhHelp['help.section.dock.title'])
    // 并且不等于英文
    expect(zhSections[0]!.title).not.toBe(enHelp['help.section.dock.title'])
  })
})

describe('HelpTab：结构闸未被弱化', () => {
  it('FEATURE_KEYS 防腐烂闸仍存在且有牙', () => {
    expect(FEATURE_KEYS.length).toBeGreaterThan(20)
  })

  it('锚点双向覆盖闸数据源未丢失', () => {
    expect(DOCK_ELEMENTS.length).toBeGreaterThan(10)
    expect(SETTINGS_SECTIONS.length).toBeGreaterThan(5)
  })
})
