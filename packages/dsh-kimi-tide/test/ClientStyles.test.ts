/**
 * Client CSS 结构钉（2026-08-29 UI 交叉评审 P1-1 修复）。
 *
 * 评审发现：.kt-reason 的布局关键属性（display:flex/flex-direction:column）
 * 嵌在 .kimi-tide-dock 前缀下，而决策面板 portal 到 document.body——选择器
 * 失配后面板退化为行内流；且 .kt-dock-pop .kt-reason 补偿规则只改
 * border-top/padding/gap，补不回布局。修复后布局属性必须在裸 .kt-reason
 * 选择器上（dock 与 portal 双上下文通吃）。本文件逐字钉住该结构。
 * 每个用例注释标注「会使其失败的生产改动」。
 */
import { describe, expect, it } from 'vitest'
import { CLIENT_CSS } from '../src/client/styles.js'

/** 匹配裸 .kt-reason 选择器（行首或 } 之后直接跟选择器，排除 .kimi-tide-dock 前缀形式）。 */
function bareKtReason(css: string): RegExpMatchArray | null {
  return css.match(/(?:^|[}\n])\s*\.kt-reason\s*\{([^}]*)\}/)
}

describe('client CSS 结构钉：决策面板样式作用域（P1-1）', () => {
  it('布局关键属性在裸 .kt-reason 选择器上（dock 与 portal 双上下文都能拿到 flex 列布局）', () => {
    // Fails if: display/flex-direction 被嵌回 .kimi-tide-dock .kt-reason 前缀下，
    // portal（挂 body）面板失去 flex 列布局退化为行内流（2026-08-29 评审 P1-1）
    expect(CLIENT_CSS).toBeDefined()
    const bare = bareKtReason(CLIENT_CSS)
    expect(bare).not.toBeNull()
    expect(bare![1]).toContain('display: flex')
    expect(bare![1]).toContain('flex-direction: column')
  })

  it('dock 内联态保留虚线分隔与纵向留白（改上下文不丢样式）', () => {
    // Fails if: 前缀规则删除或 border-top/padding 从 dock 上下文丢失
    expect(CLIENT_CSS).toMatch(/\.kimi-tide-dock \.kt-reason \{[^}]*border-top/)
    expect(CLIENT_CSS).toMatch(/\.kimi-tide-dock \.kt-reason \{[^}]*padding/)
  })

  it('portal 补偿保持去边框去留白（.kt-dock-pop .kt-reason）', () => {
    // Fails if: portal 补偿规则被删（面板内多出 dock 态的虚线分隔）
    expect(CLIENT_CSS).toMatch(/\.kt-dock-pop \.kt-reason \{[^}]*border-top:\s*none/)
    expect(CLIENT_CSS).toMatch(/\.kt-dock-pop \.kt-reason \{[^}]*padding:\s*0/)
  })

  it("flows 页签隐藏选择器豁免 .kt-error（错误横幅任何页签可见，评审 P2-5）", () => {
    // Fails if: 选择器退回 :not(.kt-flows):not(.kt-tabs)（错误横幅在协作流页签被 display:none 藏住）
    expect(CLIENT_CSS).toMatch(/data-tab='flows'\] > :not\(\.kt-flows\):not\(\.kt-tabs\):not\(\.kt-error\)/)
  })

  it('A9 r2 行带 overflow 管理（窄窗口槽位溢出不顶破容器）', () => {
    // Fails if: .kt-dock-r2 退回无 overflow 控制
    expect(CLIENT_CSS).toMatch(/\.kimi-tide-dock \.kt-dock-r2 \{[^}]*overflow: hidden/)
  })
})

describe('client CSS 结构钉：月汐品牌主题化视觉升级（2026-08-29 用户裁定）', () => {
  it('双上下文根定义 --kt-accent 品牌主色及其 soft/line 透明度派生（alpha 混合适配双主题）', () => {
    // Fails if: accent 变量被删或退回硬编码散落（改主色需逐处找）
    expect(CLIENT_CSS).toMatch(/\.kimi-tide-(?:dock|settings)[^}]*--kt-accent:/)
    expect(CLIENT_CSS).toMatch(/--kt-accent-soft:/)
    expect(CLIENT_CSS).toMatch(/--kt-accent-line:/)
  })

  it('控件焦点有紫色外环（此前焦点零视觉反馈）', () => {
    // Fails if: :focus-visible 环被删
    expect(CLIENT_CSS).toMatch(/\.kimi-tide-settings [^{]*:focus-visible[^}]*outline/)
    expect(CLIENT_CSS).toMatch(/:focus-visible[^}]*--kt-accent/)
  })

  it('区块卡片浮起：kt-card 带双层柔影（层次不再只靠细描边）', () => {
    // Fails if: 卡片退回纯描边（无 box-shadow）
    expect(CLIENT_CSS).toMatch(/\.kimi-tide-settings \.kt-card \{[^}]*box-shadow/)
  })

  it('激活预设与页签强调走品牌紫', () => {
    // Fails if: 激活态退回宿主中性灰蓝
    expect(CLIENT_CSS).toMatch(/\.kt-preset\.kt-active[^}]*--kt-accent/)
    expect(CLIENT_CSS).toMatch(/\.kt-tab-on[^}]*--kt-accent/)
  })

  it('dock 悬浮态淡紫底；决策面板带月汐紫渐变顶条', () => {
    // Fails if: dock hover 无品牌色 / 面板 ::before 渐变条被删
    expect(CLIENT_CSS).toMatch(/\.kimi-tide-dock button:hover[^}]*--kt-accent-soft/)
    expect(CLIENT_CSS).toMatch(/\.kt-dock-pop::before[^}]*--kt-accent/)
  })

  it('主按钮与带图规则行有品牌样式钩子', () => {
    // Fails if: .kt-btn-primary / .kt-row-image 样式被删
    expect(CLIENT_CSS).toMatch(/\.kt-btn-primary[^}]*--kt-accent/)
    expect(CLIENT_CSS).toMatch(/\.kt-row-image[^}]*--kt-accent-soft/)
  })
})
