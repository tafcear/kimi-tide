/**
 * kimi-tide: /kimi-tide slash command family — the client→host channel for
 * the dock panel (browser calls ctx.remote.commands.execute(sessionId,
 * '/kimi-tide …'); the harness routes it to this registration).
 *
 * Subcommands (0.3.0, v2):
 *   /kimi-tide mode off|cost|capability
 *   /kimi-tide set <key> <value>     (keys into RouterConfigV2 — SETTABLE_KEYS)
 *   /kimi-tide export-config         (print the sidecar YAML text)
 *   /kimi-tide import-config <path>  (load a YAML file into the sidecar)
 *   /kimi-tide refresh               (re-poll the usages endpoint now)
 *
 * Persistence contract: every mutating subcommand writes RouterConfigV2
 * through the RouterSidecarStore — never the v1 patch file. The sidecar is
 * the authoritative router store (sidecar > patch > default on load), so a
 * v1 raw-text splice would either lose v2-only fields (scores,
 * classify.patterns) or be shadowed by the sidecar on the next load.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
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
      const path = parts[1]
      if (path === undefined) return { kind: 'error', message: 'usage: /kimi-tide import-config <path>' }
      return { kind: 'import-config', path }
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
  '/kimi-tide import-config <path> — load a YAML file into the sidecar',
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
      let next: RouterConfigV2
      try {
        next = deps.sidecar.importFile(cmd.path)
      } catch (error) {
        return `kimi-tide: import failed — ${(error as Error).message}`
      }
      deps.onSaved(next)
      return `kimi-tide: imported ${cmd.path}; effective now, persists across restarts`
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
 * Register the /kimi-tide command globally. Registration is an effect
 * (disposer rides the plugin fiber), matching dsh-commands' runtime.
 */
export function registerKimiTideCommands(ctx: Context, deps: KimiTideCommandDeps): void {
  ctx.effect(() => {
    return ctx.commands.register({
      name: 'kimi-tide',
      description: '月汐 panel: route mode / settings / config export-import / quota refresh',
      input: { hint: 'mode off|cost|capability · set <key> <value> · export-config · import-config <path> · refresh' },
      handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
        const cmd = parseKimiTideCommand(invocation.rawInput)
        const text = await applyKimiTideCommand(cmd, deps)
        return cmd.kind === 'error' ? { kind: 'error', text } : { kind: 'success', text }
      },
    })
  })
}
