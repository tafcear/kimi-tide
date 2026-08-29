// @vitest-environment jsdom
/**
 * 设置导航图标标记（2026-08-29 视觉升级：月汐品牌主题化）。
 *
 * settings.section 契约（DSH 0.1.x）只投影 id/order/label——没有 icon 字段；
 * 宿主渲染器对未知 id 塞默认齿轮。移植 dsh-better-sidebar 的公开先例：
 * 按本地化文案识别自己的导航行 → 打 data-kimi-tide-settings-nav 标记 →
 * CSS 用 mask 把齿轮换成月牙。本文件钉标记器的行为契约。
 * 每个用例注释标注「会使其失败的生产改动」。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerSettingsNavIcon } from '../src/client/settings-nav-icon.js'

const MARKER = 'data-kimi-tide-settings-nav'

function mountNav(labels: string[]): void {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  const nav = document.createElement('nav')
  for (const label of labels) {
    const button = document.createElement('button')
    button.textContent = label
    nav.appendChild(button)
  }
  dialog.appendChild(nav)
  document.body.appendChild(dialog)
}

function navButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('[role="dialog"] nav button')] as HTMLButtonElement[]
}

describe('registerSettingsNavIcon：按本地化文案标记自己的导航行', () => {
  let dispose: (() => void) | null = null

  beforeEach(() => {
    document.body.textContent = ''
  })

  afterEach(() => {
    dispose?.()
    dispose = null
    document.body.textContent = ''
  })

  it('可见文本匹配本地化标签的行被打标记，其余行不受影响', () => {
    mountNav(['通用设置', '模型', '月汐', '技能与 MCP'])
    // Fails if: 标记器不跑 sync（月汐行无标记 → CSS 无法把齿轮换月牙）
    dispose = registerSettingsNavIcon(() => '月汐')
    const [general, models, tide, skills] = navButtons()
    expect(tide.hasAttribute(MARKER)).toBe(true)
    expect(general.hasAttribute(MARKER)).toBe(false)
    expect(models.hasAttribute(MARKER)).toBe(false)
    expect(skills.hasAttribute(MARKER)).toBe(false)
  })

  it('文案两侧空白容忍（宿主渲染可能带空白节点）', () => {
    mountNav(['  月汐 '])
    dispose = registerSettingsNavIcon(() => '月汐')
    // Fails if: 匹配用严格相等不做 trim
    expect(navButtons()[0].hasAttribute(MARKER)).toBe(true)
  })

  it('observer 常驻：对话框后挂载（异步渲染）也能补标记', async () => {
    dispose = registerSettingsNavIcon(() => '月汐')
    // 模拟设置对话框后于插件挂载（追加到 body，观察器应捕获）
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const nav = document.createElement('nav')
    const button = document.createElement('button')
    button.textContent = '月汐'
    nav.appendChild(button)
    dialog.appendChild(nav)
    document.body.appendChild(dialog)
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    // Fails if: 只在注册瞬间 sync 一次、无 MutationObserver（后挂载行永远无图标）
    expect(button.hasAttribute(MARKER)).toBe(true)
  })

  it('disposer：清除全部标记并停止观察（fiber 卸载即还原）', async () => {
    mountNav(['月汐'])
    dispose = registerSettingsNavIcon(() => '月汐')
    expect(navButtons()[0].hasAttribute(MARKER)).toBe(true)
    dispose()
    dispose = null
    // Fails if: disposer 不清标记（插件停用后图标残留）
    expect(navButtons()[0].hasAttribute(MARKER)).toBe(false)
    // 停止观察：再动 DOM 不再打新标记
    navButtons()[0].removeAttribute(MARKER)
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(navButtons()[0].hasAttribute(MARKER)).toBe(false)
  })

  it('语言切换：标签 resolver 返回新文案后，旧行去标记、新行打标记', async () => {
    mountNav(['月汐', 'Kimi Tide'])
    let label = '月汐'
    dispose = registerSettingsNavIcon(() => label)
    const [zh, en] = navButtons()
    expect(zh.hasAttribute(MARKER)).toBe(true)
    label = 'Kimi Tide'
    // 直接驱动一次 sync（真实场景由 MutationObserver 的 characterData 变更触发）
    document.body.appendChild(document.createElement('span'))
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(en.hasAttribute(MARKER)).toBe(true)
    expect(zh.hasAttribute(MARKER)).toBe(false)
  })
})
