/**
 * 共享文案间接层（W6 接口冻结）：config.ts / rules.ts / roles.ts / review-verdict.ts
 * 四个模块**既被宿主 import、也被浏览器 import**，不能直接 import client/locale.ts
 * （那是浏览器侧、且 import react）。本层环境无关，两侧都能 import。
 *
 * 语义：宿主侧永不调用 setCopyResolver ⇒ 恒走中文表（宿主行为与改动前逐字节一致）；
 * 浏览器侧由 client/locale.ts 在 wire() 时绑定一次 ⇒ 跟随宿主语言。缺 key 回落 zh、
 * 绝不抛错（宿主 render 路径抛错会把槽位整块搞白）。
 */
import { makeCopy, type CopyKey, type CopyParams } from './locales/index.js'

/** 中文回落（缺省解析器；异常路径复用同一实例）。 */
const zhFallback = makeCopy('zh')

let current: (key: CopyKey, params?: CopyParams) => string = zhFallback

/** 浏览器侧接入 locale 服务后调用一次；宿主侧永不调用。 */
export function setCopyResolver(fn: (key: CopyKey, params?: CopyParams) => string): void {
  current = fn
}

/** 取当前语言文案（宿主＝中文；浏览器＝跟随宿主语言）。缺 key 回落 zh、绝不抛错。 */
export function copyNow(key: CopyKey, params?: CopyParams): string {
  try {
    return current(key, params)
  } catch {
    // 绑定方异常（宿主 bind 形状不符等）→ 回落中文表，绝不外溢。
    try {
      return zhFallback(key, params)
    } catch {
      return String(key)
    }
  }
}
