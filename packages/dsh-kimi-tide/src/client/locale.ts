/**
 * 浏览器侧 locale 接入（阶段 P 冻结接口）：
 * - `attachLocaleService(ctx)` 在 apply() 里调一次：注册合并字典 + 绑定 t + 订阅语言切换；
 * - 宿主 locale 服务一律经 `ctx.get('locale')` / `ctx.inject(['locale'], …)` 结构化面访问，
 *   **不 import 任何宿主包**（官方明令禁止新增 client 依赖）；
 * - 服务缺席（旧宿主/单测）时 `copy()` 回落中文表，`attachLocaleService` 不抛错——
 *   宿主里 render/apply 抛错会把槽位整块搞白。
 */
import type { Context } from '@deepseek-ai/cordis'
import { useSyncExternalStore } from 'react'
import { copyNow, setCopyResolver } from '../copy.js'
import { LOCALE_NS, en, makeCopy, zh, type CopyKey, type CopyParams } from '../locales/index.js'

/** 宿主 locale 服务的结构化面（不 import 任何宿主包）。 */
export interface LocaleServiceFace {
  register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string, params?: Record<string, unknown>) => string
  subscribe?(cb: () => void): () => void
  getSnapshot?(): { active?: string; locales?: Array<{ id: string; label: string }>; revision?: number }
  setLocale?(id: string): void
}

type BoundCopy = (key: string, params?: Record<string, unknown>) => string

/** 模块态：宿主 bind 结果（缺席 = null 走中文回落）、当前语言（subscribe/getSnapshot
 *  驱动）与宿主服务对象引用（wire 成功后持有——W7 语言操控面 listLanguages/setLanguage 用）。 */
let bound: BoundCopy | null = null
let active: 'zh' | 'en' = 'zh'
let serviceRef: LocaleServiceFace | null = null
const listeners = new Set<() => void>()
const zhCopy = makeCopy('zh')

function notify(): void {
  for (const cb of [...listeners]) {
    try {
      cb()
    } catch {
      // 订阅者异常不得外溢到宿主回调链。
    }
  }
}

function wire(ctx: Context, locale: LocaleServiceFace): void {
  try {
    // effect 用调用方 ctx（dshmarket 同款：插件停用/热重载时反向注销字典）。
    ctx.effect(() => locale.register(LOCALE_NS, { zh, en }), 'kimi-tide: dictionaries')
    bound = locale.bind(LOCALE_NS)
    serviceRef = locale
    // W6：共享模块（config/rules/roles/review-verdict）经 src/copy.ts 跟随语言——
    // 绑定「bound 优先、缺席/异常回落 zh」的同一套语义（与 copy() 回落链同源）。
    setCopyResolver((key: CopyKey, params?: CopyParams) => {
      if (bound !== null) return params === undefined ? bound(key) : bound(key, params)
      return zhCopy(key, params)
    })
    // 语言切换只更新模块态并通知 React 订阅者——**不重新注册**字典（register 一次即可）。
    if (typeof locale.subscribe === 'function' && typeof locale.getSnapshot === 'function') {
      const sync = (): void => {
        active = locale.getSnapshot!().active?.startsWith('zh') === true ? 'zh' : 'en'
        refreshLangSnapshot()
      }
      sync()
      ctx.effect(() => locale.subscribe!(() => {
        sync()
        notify()
      }), 'kimi-tide: locale subscription')
    } else {
      // 有 getSnapshot 但无 subscribe：语言列表可读但收不到变化通知——快照取一次即可。
      refreshLangSnapshot()
    }
  } catch {
    // 服务形状不符（极旧宿主）：保持 bound=null，回落中文，绝不抛错。
    bound = null
    serviceRef = null
  }
}

/** apply() 里调一次：注册字典 + 绑定 t + 订阅语言切换；服务缺席走中文回落。 */
export function attachLocaleService(ctx: Context): void {
  const direct = ctx.get('locale') as LocaleServiceFace | undefined
  if (direct?.register !== undefined && direct?.bind !== undefined) {
    wire(ctx, direct)
    return
  }
  // 服务晚就绪：照抄 index.ts 对 uiConversation 的既有写法，inject 函数形态延迟驱动。
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['locale'], (late) => {
    const locale = late.get('locale') as LocaleServiceFace | undefined
    if (locale?.register !== undefined && locale?.bind !== undefined) wire(late, locale)
  })
}

/** 非组件上下文（事件处理器、命令桥、字符串拼接）用这个取当前语言文案。绝不抛错。 */
export function copy(key: CopyKey, params?: CopyParams): string {
  // W6 起委托 src/copy.ts 的 copyNow（同一全局绑定；对外签名与回落语义不变）。
  return copyNow(key, params)
}

/**
 * useSyncExternalStore 的三参（P3 修复）：模块级稳定函数——不随渲染新建闭包，
 * 避免反复订阅；第三参 getServerSnapshot 供 renderToString（SSR）路径使用，
 * 缺它 React 18 直接抛 Missing getServerSnapshot。
 */
function subscribeCopy(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getCopySnapshot(): 'zh' | 'en' {
  return active
}

/** React 组件用：语言切换时重渲染（内部 useSyncExternalStore，render 路径绝不抛错）。 */
export function useCopy(): (key: CopyKey, params?: CopyParams) => string {
  useSyncExternalStore(subscribeCopy, getCopySnapshot, getCopySnapshot)
  return copy
}

/** 当前语言（'zh' | 'en'），缺服务时为 'zh'。 */
export function currentLanguage(): 'zh' | 'en' {
  return active
}

/* ---- W7 语言操控面（设置卡「界面语言」行）：列表/生效语言读取 + 切换转发。
   真源在宿主服务（getSnapshot().locales / setLocale）；本侧只缓存一份引用稳定的
   快照供 useSyncExternalStore 消费。render/交互路径绝不抛错。 ---- */

export interface LanguageOption { id: string; label: string }

/** 宿主注册的语言列表；服务缺席或未提供 locales 时返回 []（卡片据此决定整行不渲染）。 */
export function listLanguages(): LanguageOption[] {
  try {
    const locales = serviceRef?.getSnapshot?.().locales
    if (!Array.isArray(locales)) return []
    // 宿主数据照原样透传（label 是数据，不进 locale 表）；形状不符的条目丢弃。
    return locales.filter((entry): entry is LanguageOption =>
      typeof entry?.id === 'string' && typeof entry?.label === 'string')
  } catch {
    return []
  }
}

/** 当前生效语言 id；服务缺席时回落 'zh'。 */
export function activeLanguageId(): string {
  try {
    const id = serviceRef?.getSnapshot?.().active
    return typeof id === 'string' && id !== '' ? id : 'zh'
  } catch {
    return 'zh'
  }
}

/** 切换语言（转调宿主 setLocale）；服务缺席/无 setter 时 no-op 且不抛错。 */
export function setLanguage(id: string): void {
  try {
    serviceRef?.setLocale?.(id)
  } catch {
    // 宿主 setter 异常不外溢——交互路径绝不抛错。
  }
}

/** useLanguages 的模块级快照（内容未变不换对象——useSyncExternalStore 靠引用判变更）。 */
let langSnapshot: { options: LanguageOption[]; active: string } = { options: [], active: 'zh' }

function refreshLangSnapshot(): void {
  const options = listLanguages()
  const activeId = activeLanguageId()
  const prev = langSnapshot
  const unchanged = prev.active === activeId
    && prev.options.length === options.length
    && prev.options.every((option, index) => option.id === options[index]!.id && option.label === options[index]!.label)
  if (!unchanged) langSnapshot = { options, active: activeId }
}

function getLangSnapshot(): { options: LanguageOption[]; active: string } {
  return langSnapshot
}

/** 语言列表或生效语言变化时重渲染（内部 useSyncExternalStore，三参齐全——上一轮 P3 的教训）。 */
export function useLanguages(): { options: LanguageOption[]; active: string } {
  return useSyncExternalStore(subscribeCopy, getLangSnapshot, getLangSnapshot)
}
