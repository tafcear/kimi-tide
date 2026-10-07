/**
 * locales 单源（阶段 P 冻结接口）：文案按 surface 分表
 * （shared = P chrome 文案；view = P routing-view；settings/panel/help = W1/W2/W4 填充），
 * 本模块合并成 zh/en 两张总表。
 *
 * 共享层约束：宿主侧与浏览器两侧都能 import——**不得 import 宿主服务、不得 import react**
 * （浏览器接入在 client/locale.ts；宿主服务一律经 ctx.get('locale') 结构化面访问）。
 *
 * 键命名冻结：`<surface>.<area>.<name>`，全小写 camelCase 段（键字符串含点号，表内用引号包键）。
 * zh 是唯一真源；en 键集在各 surface 文件里用 `Record<keyof typeof zh, string>` 钉住。
 */
import { zh as zhShared } from './zh/shared.js'
import { zh as zhSettings } from './zh/settings.js'
import { zh as zhPanel } from './zh/panel.js'
import { zh as zhHelp } from './zh/help.js'
import { zh as zhView } from './zh/view.js'
import { en as enShared } from './en/shared.js'
import { en as enSettings } from './en/settings.js'
import { en as enPanel } from './en/panel.js'
import { en as enHelp } from './en/help.js'
import { en as enView } from './en/view.js'

/** 宿主 locale 命名空间（dshmarket 同款槽位 `locale: NS` 契约）。 */
export const LOCALE_NS = 'settings.kimi-tide'

/**
 * 跨表键冲突闸（冻结语义）：模块加载时对各 surface 表做键集交集检查——
 * 两张表出现同名键必须**响亮失败**（防"两张表各写一份、后者静默覆盖"）。
 * 一次性检查，纯内存、零依赖。
 */
function assertNoDuplicateKeys(tables: Record<string, Record<string, string>>): void {
  const seen = new Map<string, string>()
  for (const [surface, table] of Object.entries(tables)) {
    for (const key of Object.keys(table)) {
      const prev = seen.get(key)
      if (prev !== undefined) throw new Error(`duplicate copy key: ${key} (${prev} / ${surface})`)
      seen.set(key, surface)
    }
  }
}
const zhSurfaces = { shared: zhShared, settings: zhSettings, panel: zhPanel, help: zhHelp, view: zhView }
const enSurfaces = { shared: enShared, settings: enSettings, panel: enPanel, help: enHelp, view: enView }
assertNoDuplicateKeys(zhSurfaces)
assertNoDuplicateKeys(enSurfaces)

const zhMerged = { ...zhShared, ...zhSettings, ...zhPanel, ...zhHelp, ...zhView }
const enMerged = { ...enShared, ...enSettings, ...enPanel, ...enHelp, ...enView }

export type CopyKey = keyof typeof zhMerged
export type CopyParams = Record<string, string | number>

/** 中文总表（唯一真源）。 */
export const zh: Record<CopyKey, string> = zhMerged
/** 英文总表（键集 = zh，各 surface 文件里类型钉住）。 */
export const en: Record<CopyKey, string> = enMerged

/** `{0}` / `{name}` 占位替换（缺参原样保留，不抛错）。 */
export function formatCopy(template: string, params?: CopyParams): string {
  if (params === undefined) return template
  return template.replace(/\{([^{}]+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/** 造一个翻译函数（缺 key 时回落 zh，再缺则返回 key 本身＋一次 console.warn，绝不抛错）。 */
export function makeCopy(lang: 'zh' | 'en'): (key: CopyKey, params?: CopyParams) => string {
  const primary = (lang === 'en' ? en : zh) as Record<string, string | undefined>
  const base = zh as Record<string, string | undefined>
  return (key, params) => {
    const hit = primary[key] ?? base[key]
    if (hit === undefined) {
      console.warn(`[kimi-tide] missing copy key: ${String(key)}`)
      return String(key)
    }
    return formatCopy(hit, params)
  }
}
