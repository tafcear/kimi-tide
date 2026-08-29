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
