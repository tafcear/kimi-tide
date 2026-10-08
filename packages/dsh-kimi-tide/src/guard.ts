/**
 * 派发护栏纯函数层（v2.2.0）。
 *
 * 产品语义（宿主能力决定，勿推翻）：`ctx.tools.guard(fn)` 是**单调最终拒绝**——
 * 同步检查，返回字符串即拒绝该次工具调用、返回 undefined 放行；护栏**不能改派**
 * （改派 = 另一次 `spawn_teammate` 调用）⇒ 本护栏只做「拒绝 + 把正确的下一步写进
 * 拒绝理由」。本模块零副作用、零宿主依赖：宿主接入、disposer 与开关读取归 `src/index.ts`。
 *
 * 判据：
 * - 拦 `DISPATCH_GUARD_TOOLS`（`subagent` / `subagent_fork`）且**调用方是主会话**；
 * - 任务文本 = `args.description` + `args.prompt`（能取到的字符串，换行拼接）；
 * - 按分工表**键序**逐角色判定，**只报第一个命中**：该角色 `keywords` 非空 ⇒ 优先只按
 *   keywords 做大小写不敏感子串匹配；留空/缺失/空数组 ⇒ 回退 label + aliases
 *   （大小写不敏感子串）与 id（词边界：两侧非 `[a-z0-9-]`，防 `qa` 命中 `qatar`）。
 *
 * 红线：
 * - **绝不抛异常、绝不因实参形状异常拒绝**——`args` / `roles` 畸形一律放行
 *   （拒绝是最终态：误拦比漏拦代价高）；
 * - 关闭态（`guarded !== true`）与队友调用**逐字节**放行（护栏关闭 = 今天行为）；
 * - 文案全部经 `copyNow` 取 `shared.roles.guard.*`（zh 是唯一真源，本文件不写死文案）。
 */
import type { RoleEntry } from './config.js'
import { copyNow } from './copy.js'

/**
 * 护栏拦截的工具名白名单。**只有这两个**：`workflow` / `spawn_teammate` /
 * `send_message` 一律不拦——前两者本就是分工表 skill 推荐的派发形态，
 * 后者是队友协作面（改派失败后的补救动作）。
 */
export const DISPATCH_GUARD_TOOLS = ['subagent', 'subagent_fork'] as const

/** 判据输入：宿主 guard 回调按此投影（纯数据，无宿主类型依赖）。 */
export interface DispatchGuardInput {
  /** 宿主 `ToolExecution.name`。 */
  toolName: string
  /** 宿主 `ToolExecution.arguments`（形状不受信，按字段探测）。 */
  args: unknown
  /** 分工表（**投影后**的 RoleEntry 表；键序 = 角色序，决定「第一个命中」）。 */
  roles: Record<string, RoleEntry>
  /** 护栏总开关：配置 `dispatchGuard === 'enforce'`。 */
  guarded?: boolean
  /** 调用方本身是队友（`agentTeams.tryMembership` 命中）⇒ 不拦。 */
  callerIsTeammate?: boolean
}

/**
 * 宿主 guard 注册句柄（**接入侧**形状；本模块只导出类型，不产运行期代码）：
 * `ctx.tools.guard(check)` 返回的 disposer 由注册方持有，重挂/卸载时调用。
 * `installed` 供接入侧自检（判据不读它）。
 */
export interface DispatchGuardRejection {
  installed: boolean
  dispose: () => void
}

/** 词边界字符集：与宿主队友名规则（lower-kebab-case）同集。 */
const WORD_CHAR = /[a-z0-9-]/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 形状探测（类型收窄用）：非对象 ⇒ undefined，调用方据此走放行路径。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined
}

/** 大小写不敏感子串命中（空 needle 恒不命中）。 */
function containsFold(haystack: string, needle: string): boolean {
  return needle.length > 0 && haystack.toLowerCase().includes(needle.toLowerCase())
}

/** 词边界命中：命中处两侧都不是 `[a-z0-9-]`（文本两端视为边界）。 */
function containsWord(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false
  const hay = haystack.toLowerCase()
  const word = needle.toLowerCase()
  const isWordChar = (index: number): boolean => index >= 0 && index < hay.length && WORD_CHAR.test(hay[index] as string)
  for (let at = hay.indexOf(word); at !== -1; at = hay.indexOf(word, at + 1)) {
    if (!isWordChar(at - 1) && !isWordChar(at + word.length)) return true
  }
  return false
}

/** 任务文本：`description` + `prompt`（字符串字段，换行拼接）；都取不到 ⇒ undefined。 */
function taskTextOf(args: unknown): string | undefined {
  if (!isPlainObject(args)) return undefined
  const parts: string[] = []
  if (typeof args.description === 'string') parts.push(args.description)
  if (typeof args.prompt === 'string') parts.push(args.prompt)
  return parts.length === 0 ? undefined : parts.join('\n')
}

/** 角色的显式领域词（只认非空字符串项；非数组/畸形项一律丢弃 ⇒ 回退路径）。 */
function keywordsOf(role: Record<string, unknown>): string[] {
  const raw = role.keywords
  if (!Array.isArray(raw)) return []
  return raw.filter((word): word is string => typeof word === 'string' && word.length > 0)
}

/** 单角色的领域判定（keywords 非空 ⇒ 优先只按它判；否则 label/aliases/id 回退）。 */
function roleMatches(role: Record<string, unknown>, id: string, text: string): boolean {
  const keywords = keywordsOf(role)
  if (keywords.length > 0) return keywords.some((word) => containsFold(text, word))
  if (typeof role.label === 'string' && containsFold(text, role.label)) return true
  const aliases = role.aliases
  if (Array.isArray(aliases) && aliases.some((alias) => typeof alias === 'string' && containsFold(text, alias))) return true
  return containsWord(text, id)
}

/** 拒绝理由（`shared.roles.guard.rejectSubagent`；{0} id、{1} label、{2} 指路串）。 */
function rejectionText(id: string, role: Record<string, unknown>): string {
  const label = typeof role.label === 'string' && role.label.length > 0 ? role.label : id
  // 指路串取**显示名**（与理由主体同词）：同一句里 id 与 label 混用读起来像笔误
  // ——理由面向模型，措辞一致性优先于「照抄配置键」。
  const fixHint = copyNow('shared.roles.guard.fixHint', { 0: label })
  return copyNow('shared.roles.guard.rejectSubagent', { 0: id, 1: label, 2: fixHint })
}

/**
 * 派发护栏判据：拒绝理由字符串 ⇒ 拒绝该次调用；undefined ⇒ 放行。
 * 纯函数、不抛异常（畸形输入一律放行）。
 */
export function dispatchGuardRejection(input: DispatchGuardInput): string | undefined {
  const raw = asRecord(input)
  if (raw === undefined) return undefined
  if (raw.guarded !== true) return undefined
  if (raw.callerIsTeammate === true) return undefined
  const toolName = raw.toolName
  if (typeof toolName !== 'string' || !(DISPATCH_GUARD_TOOLS as readonly string[]).includes(toolName)) return undefined
  const text = taskTextOf(raw.args)
  if (text === undefined) return undefined
  const roles = raw.roles
  if (!isPlainObject(roles)) return undefined
  for (const id of Object.keys(roles)) {
    const role = roles[id]
    if (!isPlainObject(role)) continue
    if (roleMatches(role, id, text)) return rejectionText(id, role)
  }
  return undefined
}

/**
 * 「本角色的判定目前来自 label/aliases 而非显式 keywords」提示
 * （`shared.roles.guard.roleKeywordsFallback`；{0} = 角色显示名）。
 * 供拒绝对话面/设置卡复用；**不拼进 `dispatchGuardRejection` 的拒绝理由**——
 * `shared.roles.guard.fixHint` 已含「留空则回退显示名与别名」，再拼一次即重复。
 */
export function missingKeywordsText(role: RoleEntry): string {
  const record = asRecord(role) ?? {}
  const id = typeof record.id === 'string' ? record.id : ''
  const label = typeof record.label === 'string' && record.label.length > 0 ? record.label : id
  return copyNow('shared.roles.guard.roleKeywordsFallback', { 0: label })
}

/**
 * 逗号串 → 领域词数组：半角/全角逗号分隔、逐项 trim、丢空项、去重保序（大小写敏感）。
 * 消费者：设置卡 `keywords` 输入面（`src/client/**`，非本模块写域）——本函数只解析字符串，
 * 不做长度/字符集约束（护栏按子串匹配，词形由用户决定）；空结果由消费侧落成
 * `undefined`（本仓「缺失即省略」口径），与「空数组 = 回退」同义。
 * 分隔符 = 半角逗号 + 全角逗号（U+FF0C，源码写作转义：全角标点在受扫面里是红线）。
 */
export function parseKeywords(raw: string): string[] {
  if (typeof raw !== 'string') return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(/[,\uFF0C]/)) {
    const word = part.trim()
    if (word.length === 0 || seen.has(word)) continue
    seen.add(word)
    out.push(word)
  }
  return out
}
