/**
 * kimi-tide: /kimi-tide slash command family — the client→host channel for
 * the dock panel (browser calls ctx.remote.commands.execute(sessionId,
 * '/kimi-tide …'); the harness routes it to this registration).
 *
 * Subcommands (0.3.0, v2):
 *   /kimi-tide mode off|cost|capability
 *   /kimi-tide set <key> <value>     (keys into RouterConfigV2 — SETTABLE_KEYS)
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
 * Persistence contract: every mutating subcommand writes RouterConfigV2
 * through the RouterSidecarStore — never the v1 patch file. The sidecar is
 * the authoritative router store (sidecar > patch > default on load), so a
 * v1 raw-text splice would either lose v2-only fields (scores,
 * classify.patterns) or be shadowed by the sidecar on the next load.
 */
import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import YAML from 'yaml'
import type { RouterConfigV2 } from './config.js'
import type { RouterSidecarStore } from './sidecar.js'
import type { UsageMonitor } from './usage.js'

export type KimiTideCommand =
  | { kind: 'mode'; mode: RouterConfigV2['mode'] }
  | { kind: 'set'; key: string; value: unknown }
  | { kind: 'export-config' }
  | { kind: 'import-config'; path: string }
  | { kind: 'refresh' }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

export interface KimiTideCommandDeps {
  /** v2 persistence: the sidecar file is the live router store. */
  sidecar: RouterSidecarStore
  monitor: UsageMonitor
  current: () => RouterConfigV2
  /** Called after a successful save: rebuild the router + push projection. */
  onSaved: (config: RouterConfigV2) => void
}

/** Keys settable via `/kimi-tide set` — paths into RouterConfigV2. */
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
  '/kimi-tide set <key> <value> — update one router setting (v2)',
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
      try {
        return deps.sidecar.exportText()
      } catch (error) {
        return `kimi-tide: export failed — ${(error as Error).message}（sidecar 不存在或不可读；可先 /kimi-tide set 生成）`
      }
    }
    case 'import-config': {
      const inline = isInlineYamlText(cmd.path)
      let next: RouterConfigV2
      try {
        next = inline ? importInlineText(cmd.path, deps) : deps.sidecar.importFile(cmd.path)
      } catch (error) {
        return `kimi-tide: import failed — ${(error as Error).message}`
      }
      deps.onSaved(next)
      return `kimi-tide: imported ${inline ? 'inline YAML' : cmd.path}; effective now, persists across restarts`
    }
  }
}

function persist(config: RouterConfigV2, deps: KimiTideCommandDeps, what: string): string {
  try {
    deps.sidecar.save(config)
  } catch (error) {
    return `kimi-tide: save failed — ${(error as Error).message}`
  }
  deps.onSaved(config)
  return `kimi-tide: saved (${what}); effective now, persists across restarts`
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
 * 内联 YAML 合并补丁落盘（面板 v3 保存通道）：把解析后的部分配置深度合并进
 * 当前配置并写入 sidecar。见文件头注释——面板各区块文本只带各自字段，必须合并
 * 而非整表替换，否则未投影字段（lambda/routeThreshold/既有 scores）会丢。
 */
function importInlineText(text: string, deps: KimiTideCommandDeps): RouterConfigV2 {
  const patch = YAML.parse(text) as unknown
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('inline YAML must be a mapping (object)')
  }
  const merged = deepMerge(structuredClone(deps.current()), patch) as RouterConfigV2
  merged.version = 2
  deps.sidecar.save(merged)
  return merged
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
