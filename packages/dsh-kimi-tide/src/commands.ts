/**
 * kimi-tide: /kimi-tide slash command family — the client→host channel for
 * the dock panel (browser calls ctx.remote.commands.execute(sessionId,
 * '/kimi-tide …'); the harness routes it to this registration).
 *
 * Subcommands (0.3.0, v3):
 *   /kimi-tide mode off|cost|capability
 *   /kimi-tide set <key> <value>     (keys into RouterConfigV3 — SETTABLE_KEYS)
 *   /kimi-tide export-config         (print the sidecar YAML text)
 *   /kimi-tide import-config <path|inline YAML>  (load a file OR inline YAML text)
 *   /kimi-tide refresh               (re-poll the usages endpoint now)
 *
 * import-config 双形态（Task 10 修复轮 1，控制器裁定授权——Task 9 简报只定义
 * 了路径形态，面板 v3 需「生成 sidecar 文本经 import-config 往返」，两者桥接）：
 *   - 参数是已存在文件路径         → 整表替换（原语义，不变）
 *   - 参数是可解析的内联 YAML 文本 → 合并补丁语义：深度合并进当前配置，仅覆盖
 *     文本中出现的字段（scores 逐候选合并、candidates 整表替换、default 字段合并），
 *     其余保持不动——面板各组件只持有各自区块数据（projection 受控负载），整表
 *     替换会丢 lambda/routeThreshold/既有 scores 等未投影字段。
 *   - 其余（不存在路径/不可解析） → 报错，路径形态行为不变
 *
 * Persistence contract: every mutating subcommand writes RouterConfigV3
 * through the settings namespace (KimiTideCommandDeps.settings) when one is
 * wired — never the v1 patch file; when settings is absent the sidecar
 * (RouterSidecarStore) remains the fallback store. The sidecar is the
 * authoritative router store on load when no settings namespace is present
 * (sidecar > patch > default), so a v1 raw-text splice would either lose
 * v2-only fields (scores, classify.patterns) or be shadowed on the next load.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import YAML from 'yaml'
import type { RouterConfigV3 } from './config.js'
import { coerceRouterConfig, migrateV1 } from './migrate.js'
import type { RouterSidecarStore } from './sidecar.js'
import type { UsageMonitor } from './usage.js'

export type KimiTideCommand =
  | { kind: 'mode'; mode: RouterConfigV3['mode'] }
  | { kind: 'set'; key: string; value: unknown }
  | { kind: 'export-config' }
  | { kind: 'import-config'; path: string }
  | { kind: 'refresh' }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

/** Settings namespace port: primary read/write channel for the router config. */
export interface SettingsNamespacePort {
  get(): RouterConfigV3
  update(patch: object): Promise<void>
  replace(section: object): Promise<void>
}

export interface KimiTideCommandDeps {
  /** v3 persistence: the sidecar file is the live router store. */
  sidecar: RouterSidecarStore
  /** Primary settings namespace; absent/null → fall back to sidecar read/write. */
  settings?: SettingsNamespacePort | null
  monitor: UsageMonitor
  current: () => RouterConfigV3
  /** Called after a successful save: rebuild the router + push projection. */
  onSaved: (config: RouterConfigV3) => void
}

/** Keys settable via `/kimi-tide set` — paths into RouterConfigV3. */
const SETTABLE_KEYS: Record<string, 'number' | 'string'> = {
  lambda: 'number',
  routeThreshold: 'number',
  premiumBudget: 'number',
  budgetWindow: 'number',
  charsPerToken: 'number',
  'default.model': 'string',
}

export function parseKimiTideCommand(args: string): KimiTideCommand {
  const parts = args.trim().split(/\s+/).filter((p) => p.length > 0)
  if (parts.length === 0 || parts[0] === 'help') return { kind: 'help' }
  switch (parts[0]) {
    case 'mode': {
      const mode = parts[1]
      if (mode === 'off' || mode === 'cost' || mode === 'capability') return { kind: 'mode', mode }
      return { kind: 'error', message: `usage: /kimi-tide mode off|cost|capability (got "${mode ?? ''}")` }
    }
    case 'set': {
      const [key, raw] = [parts[1], parts[2]]
      if (key === undefined || raw === undefined) return { kind: 'error', message: 'usage: /kimi-tide set <key> <value>' }
      const type = SETTABLE_KEYS[key]
      if (type === undefined) {
        return { kind: 'error', message: `unknown settable key "${key}" (allowed: ${Object.keys(SETTABLE_KEYS).join(', ')})` }
      }
      if (type === 'number') {
        const n = Number(raw)
        if (!Number.isFinite(n)) return { kind: 'error', message: `"${raw}" is not a number` }
        return { kind: 'set', key, value: n }
      }
      return { kind: 'set', key, value: raw }
    }
    case 'export-config':
      return { kind: 'export-config' }
    case 'import-config': {
      // 取子命令后的完整剩余参数（保留换行/缩进），而非按空白切分的首 token：
      // 面板 v3 走「内联 YAML 文本」往返，多行 YAML 必须原样送达 apply。
      const rest = args.trim().slice('import-config'.length).trim()
      if (rest === '') return { kind: 'error', message: 'usage: /kimi-tide import-config <path|inline YAML>' }
      return { kind: 'import-config', path: rest }
    }
    case 'refresh':
      return { kind: 'refresh' }
    default:
      return { kind: 'error', message: `unknown subcommand "${parts[0]}" — try /kimi-tide help` }
  }
}

const HELP_TEXT = [
  '/kimi-tide mode off|cost|capability — switch routing mode',
  '/kimi-tide set <key> <value> — update one router setting (v3)',
  `  keys: ${Object.keys(SETTABLE_KEYS).join(', ')}`,
  '/kimi-tide export-config — print the sidecar YAML',
  '/kimi-tide import-config <path|inline YAML> — load a YAML file OR inline YAML text (panel save channel)',
  '/kimi-tide refresh — re-poll Kimi quota now',
].join('\n')

export async function applyKimiTideCommand(cmd: KimiTideCommand, deps: KimiTideCommandDeps): Promise<string> {
  switch (cmd.kind) {
    case 'help':
      return HELP_TEXT
    case 'error':
      return `kimi-tide: ${cmd.message}`
    case 'refresh':
      await deps.monitor.refresh()
      return 'kimi-tide: quota refreshed'
    case 'mode':
      return persist({ ...deps.current(), mode: cmd.mode }, deps, `mode → ${cmd.mode}`)
    case 'set': {
      const next = structuredClone(deps.current())
      setDotted(next as unknown as Record<string, unknown>, cmd.key, cmd.value)
      return persist(next, deps, `${cmd.key} → ${String(cmd.value)}`)
    }
    case 'export-config': {
      if (deps.settings != null) {
        try {
          return YAML.stringify(deps.settings.get())
        } catch (error) {
          return `kimi-tide: export failed — ${(error as Error).message}`
        }
      }
      try {
        return deps.sidecar.exportText()
      } catch (error) {
        return `kimi-tide: export failed — ${(error as Error).message}（sidecar 不存在或不可读；可先 /kimi-tide set 生成）`
      }
    }
    case 'import-config': {
      const inline = isInlineYamlText(cmd.path)
      let next: RouterConfigV3
      try {
        if (deps.settings != null) {
          next = inline ? mergeInlineText(cmd.path, deps.current()) : parseImportedFile(cmd.path)
          await deps.settings.replace(next as unknown as object)
        } else if (inline) {
          next = mergeInlineText(cmd.path, deps.current())
          deps.sidecar.save(next)
        } else {
          next = deps.sidecar.importFile(cmd.path)
        }
      } catch (error) {
        return `kimi-tide: import failed — ${(error as Error).message}`
      }
      deps.onSaved(next)
      return `kimi-tide: imported ${inline ? 'inline YAML' : cmd.path}; effective now, persists across restarts`
    }
  }
}

async function persist(config: RouterConfigV3, deps: KimiTideCommandDeps, what: string): Promise<string> {
  if (deps.settings != null) {
    try { await deps.settings.update(config as unknown as object) } catch (error) {
      return `kimi-tide: save failed — ${(error as Error).message}`
    }
    deps.onSaved(config)
    return `kimi-tide: saved (${what}); effective now, persists across restarts`
  }
  // 兜底：无 settings 服务时维持旧 sidecar 写入
  try { deps.sidecar.save(config) } catch (error) { return `kimi-tide: save failed — ${(error as Error).message}` }
  deps.onSaved(config)
  return `kimi-tide: saved (${what}); effective now, persists across restarts（sidecar 兜底模式）`
}

function setDotted(target: Record<string, unknown>, dotted: string, value: unknown): void {
  const segments = dotted.split('.')
  let node = target
  for (const segment of segments.slice(0, -1)) {
    if (node[segment] === undefined || node[segment] === null) node[segment] = {}
    node = node[segment] as Record<string, unknown>
  }
  node[segments[segments.length - 1]] = value
}

/**
 * 判定 import-config 参数形态：已存在路径优先按文件处理；否则若以 '{'/'-' 开头、
 * 含换行，或 YAML.parse 解析出对象 → 视为内联 YAML 文本；其余按路径（缺失文件
 * 走原报错路径）。导出供面板 v3 测试断言「生成的 sidecar 文本正是命令层接受的
 * 内联形态」。
 */
export function isInlineYamlText(arg: string): boolean {
  if (existsSync(arg)) return false
  const t = arg.trim()
  if (t.length === 0) return false
  if (t.startsWith('{') || t.startsWith('-') || t.includes('\n')) return true
  try {
    const parsed = YAML.parse(t)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
  } catch {
    return false
  }
}

/** 递归合并：patch 中的对象与 base 同型对象按字段合并，标量/数组整体替换。 */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return structuredClone(patch)
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = deepMerge(out[k], v)
  }
  return out
}

/**
 * 内联 YAML 合并补丁（面板 v3 保存通道）：把解析后的部分配置深度合并进
 * 当前配置并返回合并结果（不落盘——由调用处统一 replace/save）。见文件头
 * 注释——面板各区块文本只带各自字段，必须合并而非整表替换，否则未投影字段
 * （lambda/routeThreshold/既有 scores）会丢。
 */
function mergeInlineText(text: string, current: RouterConfigV3): RouterConfigV3 {
  const patch = YAML.parse(text) as unknown
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('inline YAML must be a mapping (object)')
  }
  const merged = deepMerge(structuredClone(current), patch) as RouterConfigV3
  merged.version = 3
  return merged
}

/**
 * 读取并校验一个 config YAML 文件（不落盘），供 settings 命名空间路径的
 * import-config 文件形态使用——镜像 RouterSidecarStore.validate 的 v2/v3 结构
 * 检查 + coerceRouterConfig 迁移（v2→v3 改名、v1→v3），与 sidecar.importFile
 * 保持相同解析语义但不写入 sidecar。
 */
function parseImportedFile(path: string): RouterConfigV3 {
  const raw = YAML.parse(readFileSync(path, 'utf8')) as unknown
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.version === 3 || r.version === 2) {
    const d = (r.default ?? {}) as Record<string, unknown>
    if (typeof d.provider !== 'string' || typeof d.model !== 'string') {
      throw new Error('config v3 结构不合格：default.provider/default.model 缺失或非字符串')
    }
    if (!Array.isArray(r.candidates)) {
      throw new Error('config v3 结构不合格：candidates 缺失或非数组')
    }
    return coerceRouterConfig(raw, () => {})
  }
  return migrateV1(raw, () => {})
}

/**
 * Register the /kimi-tide command globally. Registration is an effect
 * (disposer rides the plugin fiber), matching dsh-commands' runtime.
 */
export function registerKimiTideCommands(ctx: Context, deps: KimiTideCommandDeps): void {
  ctx.effect(() => {
    return ctx.commands.register({
      name: 'kimi-tide',
      description: '月汐 panel: route mode / settings / config export-import / quota refresh',
      input: { hint: 'mode off|cost|capability · set <key> <value> · export-config · import-config <path|inline YAML> · refresh' },
      handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
        const cmd = parseKimiTideCommand(invocation.rawInput)
        const text = await applyKimiTideCommand(cmd, deps)
        return cmd.kind === 'error' ? { kind: 'error', text } : { kind: 'success', text }
      },
    })
  })
}
