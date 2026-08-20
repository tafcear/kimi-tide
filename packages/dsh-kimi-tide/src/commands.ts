/**
 * kimi-tide: /kimi-tide slash command family — the client→host channel for
 * the dock panel (browser calls ctx.remote.commands.execute(sessionId,
 * '/kimi-tide …'); the harness routes it to this registration).
 *
 * Subcommands (0.5.0, v4):
 *   /kimi-tide preset <id|off>       (off → activePreset=null；id 须存在于 presets)
 *   /kimi-tide show                  (print current preset / default / rule count)
 *   /kimi-tide set activePreset <id|off>  (SETTABLE_KEYS 唯一键)
 *   /kimi-tide export-config         (print the sidecar YAML text)
 *   /kimi-tide import-config <path|inline YAML>  (load a file OR inline YAML text)
 *   /kimi-tide refresh               (re-poll the usages endpoint now)
 *
 * import-config 双形态（沿用 0.4.x 裁定）：参数是已存在文件路径 → 整表替换；
 * 参数是可解析的内联 YAML 文本 → 合并补丁语义（深度合并进当前配置，仅覆盖
 * 文本中出现的字段，其余保持不动）。其余 → 报错。
 *
 * Persistence contract: every mutating subcommand writes RouterConfigV4
 * through the settings namespace (KimiTideCommandDeps.settings) when one is
 * wired — never the v1 patch file; when settings is absent the sidecar
 * (RouterSidecarStore) remains the fallback store.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import YAML from 'yaml'
import type { RouterConfigV4 } from './config.js'
import { coerceRouterConfigV4 } from './migrate.js'
import type { RouterSidecarStore } from './sidecar.js'
import type { UsageMonitor } from './usage.js'

export type KimiTideCommand =
  | { kind: 'preset'; preset: string | null }
  | { kind: 'set'; key: string; value: unknown }
  | { kind: 'show' }
  | { kind: 'export-config' }
  | { kind: 'import-config'; path: string }
  | { kind: 'refresh' }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

/** Settings namespace port: primary read/write channel for the router config. */
export interface SettingsNamespacePort {
  get(): RouterConfigV4
  update(patch: object): Promise<void>
  replace(section: object): Promise<void>
}

export interface KimiTideCommandDeps {
  /** v4 persistence: the sidecar file is the live router store. */
  sidecar: RouterSidecarStore
  /** Primary settings namespace; absent/null → fall back to sidecar read/write. */
  settings?: SettingsNamespacePort | null
  monitor: UsageMonitor
  current: () => RouterConfigV4
  /** Called after a successful save: rebuild the router + push projection. */
  onSaved: (config: RouterConfigV4) => void
}

/** Keys settable via `/kimi-tide set` — paths into RouterConfigV4. */
const SETTABLE_KEYS: Record<string, 'string'> = {
  activePreset: 'string',
}

export function parseKimiTideCommand(args: string): KimiTideCommand {
  const parts = args.trim().split(/\s+/).filter((p) => p.length > 0)
  if (parts.length === 0 || parts[0] === 'help') return { kind: 'help' }
  switch (parts[0]) {
    case 'preset': {
      const preset = parts[1]
      if (preset === undefined) return { kind: 'error', message: 'usage: /kimi-tide preset <id|off>' }
      return { kind: 'preset', preset: preset === 'off' ? null : preset }
    }
    case 'mode':
      return { kind: 'error', message: '已退役，请用 /kimi-tide preset' }
    case 'set': {
      const [key, raw] = [parts[1], parts[2]]
      if (key === undefined || raw === undefined) return { kind: 'error', message: 'usage: /kimi-tide set <key> <value>' }
      const type = SETTABLE_KEYS[key]
      if (type === undefined) {
        return { kind: 'error', message: `unknown settable key "${key}" (allowed: ${Object.keys(SETTABLE_KEYS).join(', ')})` }
      }
      return { kind: 'set', key, value: raw }
    }
    case 'show':
      return { kind: 'show' }
    case 'export-config':
      return { kind: 'export-config' }
    case 'import-config': {
      // 取子命令后的完整剩余参数（保留换行/缩进），而非按空白切分的首 token：
      // 面板走「内联 YAML 文本」往返，多行 YAML 必须原样送达 apply。
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
  '/kimi-tide preset <id|off> — switch active preset (off = 路由关闭)',
  '/kimi-tide show — print the current preset / default / rule count',
  '/kimi-tide set activePreset <id|off> — update the active preset',
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
    case 'preset': {
      if (cmd.preset !== null && deps.current().presets[cmd.preset] === undefined) {
        return `kimi-tide: 预设 '${cmd.preset}' 不存在（现有：${Object.keys(deps.current().presets).join(', ') || '无'}）`
      }
      return persist({ ...deps.current(), activePreset: cmd.preset }, deps, `preset → ${cmd.preset ?? 'off'}`)
    }
    case 'show': {
      const c = deps.current()
      if (c.activePreset === null) return 'kimi-tide: 路由关闭（/kimi-tide preset <id> 启用）'
      const p = c.presets[c.activePreset]
      return p === undefined
        ? `kimi-tide: activePreset '${c.activePreset}' 缺失（配置异常）`
        : `kimi-tide: 预设「${p.name}」· 默认 ${p.default.provider}/${p.default.model} · 规则 ${p.rules.length} 条 · 关键词组 ${Object.keys(c.keywordGroups).length} 个`
    }
    case 'set': {
      const raw = typeof cmd.value === 'string' ? cmd.value : ''
      const preset = raw === 'off' ? null : raw
      const next = structuredClone(deps.current())
      if (preset !== null && next.presets[preset] === undefined) {
        return `kimi-tide: 预设 '${preset}' 不存在（现有：${Object.keys(next.presets).join(', ') || '无'}）`
      }
      next.activePreset = preset
      return persist(next, deps, `activePreset → ${preset ?? 'off'}`)
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
      let next: RouterConfigV4
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

async function persist(config: RouterConfigV4, deps: KimiTideCommandDeps, what: string): Promise<string> {
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

/**
 * 判定 import-config 参数形态：已存在路径优先按文件处理；否则若以 '{'/'-' 开头、
 * 含换行，或 YAML.parse 解析出对象 → 视为内联 YAML 文本；其余按路径（缺失文件
 * 走原报错路径）。导出供面板测试断言「生成的 sidecar 文本正是命令层接受的
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
 * 内联 YAML 合并补丁（面板保存通道）：把解析后的部分配置深度合并进
 * 当前配置并返回合并结果（不落盘——由调用处统一 replace/save）。
 */
function mergeInlineText(text: string, current: RouterConfigV4): RouterConfigV4 {
  const patch = YAML.parse(text) as unknown
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('inline YAML must be a mapping (object)')
  }
  const merged = deepMerge(structuredClone(current), patch) as RouterConfigV4
  merged.version = 4
  return merged
}

/**
 * 读取并校验一个 config YAML 文件（不落盘），供 settings 命名空间路径的
 * import-config 文件形态使用——镜像 RouterSidecarStore.validate 的 v4/v3/v2
 * 结构检查，与 sidecar.importFile 保持相同解析语义但不写入 sidecar。
 */
function parseImportedFile(path: string): RouterConfigV4 {
  const raw = YAML.parse(readFileSync(path, 'utf8')) as unknown
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.version === 4) {
    const presets = r.presets
    if (typeof presets !== 'object' || presets === null || Array.isArray(presets)) {
      throw new Error('config v4 结构不合格：presets 缺失或非对象')
    }
    if (r.activePreset !== null && typeof r.activePreset !== 'string') {
      throw new Error('config v4 结构不合格：activePreset 非 string|null')
    }
    return raw as RouterConfigV4
  }
  if (r.version === 3 || r.version === 2) {
    const d = (r.default ?? {}) as Record<string, unknown>
    if (typeof d.provider !== 'string' || typeof d.model !== 'string') {
      throw new Error('config v3 结构不合格：default.provider/default.model 缺失或非字符串')
    }
    if (!Array.isArray(r.candidates)) {
      throw new Error('config v3 结构不合格：candidates 缺失或非数组')
    }
  }
  return coerceRouterConfigV4(raw, () => {})
}

/**
 * Register the /kimi-tide command globally. Registration is an effect
 * (disposer rides the plugin fiber), matching dsh-commands' runtime.
 */
export function registerKimiTideCommands(ctx: Context, deps: KimiTideCommandDeps): void {
  ctx.effect(() => {
    return ctx.commands.register({
      name: 'kimi-tide',
      description: '月汐 panel: route preset / settings / config export-import / quota refresh',
      input: { hint: 'preset <id|off> · set activePreset <id|off> · show · export-config · import-config <path|inline YAML> · refresh' },
      handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
        const cmd = parseKimiTideCommand(invocation.rawInput)
        const text = await applyKimiTideCommand(cmd, deps)
        return cmd.kind === 'error' ? { kind: 'error', text } : { kind: 'success', text }
      },
    })
  })
}
