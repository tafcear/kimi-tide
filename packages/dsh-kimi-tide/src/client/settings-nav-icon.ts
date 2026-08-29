/**
 * 设置导航图标标记（2026-08-29 视觉升级：月汐品牌主题化）。
 *
 * settings.section 契约（DSH 0.1.x）只投影 id/order/label——没有 icon 字段；
 * 宿主渲染器（dsh-client-ui-settings-general navIcon）对未知 id 塞默认齿轮。
 * 移植 dsh-better-sidebar 的公开先例（settings-nav-icon.ts 同名机制）：
 * 按本地化文案识别自己在设置导航里的行 → 打 data-kimi-tide-settings-nav
 * 标记 → bundled CSS 用 mask 把齿轮换成月汐紫月牙。
 *
 * 生命周期：MutationObserver 常驻 body（对话框后挂载/语言切换/重渲染自动
 * 重标）；disposer 断开观察并清除全部标记（fiber 卸载即还原，HMR 安全）。
 */

const MARKER = 'data-kimi-tide-settings-nav'

/**
 * 保持标记在可见文本等于当前本地化标签的导航行上。
 * @param label - 与 settings.section 注册同源的本地化标签 resolver。
 * @returns disposer：断开观察并移除本插件拥有的全部标记。
 */
export function registerSettingsNavIcon(label: () => string): () => void {
  // SSR/node 环境卫兵：apply() 也会在无 DOM 上下文执行（renderToString 测试等）。
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function'
    || typeof MutationObserver === 'undefined') {
    return () => {}
  }
  let disposed = false
  const sync = (): void => {
    if (disposed) return
    const currentLabel = label().trim()
    const buttons = document.querySelectorAll('[role="dialog"] nav button')
    for (const button of buttons) {
      if (currentLabel.length > 0 && button.textContent?.trim() === currentLabel) {
        button.setAttribute(MARKER, '')
      } else {
        button.removeAttribute(MARKER)
      }
    }
  }
  sync()
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  return () => {
    disposed = true
    observer.disconnect()
    document.querySelectorAll(`[${MARKER}]`).forEach((element) => {
      element.removeAttribute(MARKER)
    })
  }
}
