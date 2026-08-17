/**
 * kimi-tide: /kimi-tide slash command family — the client→host channel for
 * the dock panel (browser calls ctx.remote.commands.execute(sessionId,
 * '/kimi-tide …'); the harness routes it to this registration).
 *
 * Subcommands:
 *   /kimi-tide mode off|cost|capability
 *   /kimi-tide set <key> <value>     (dotted keys into RouterConfig)
 *   /kimi-tide refresh               (re-poll the usages endpoint now)
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { RouterConfig } from './router.js'
import type { RouterSettingsStore } from './settings.js'
import type { UsageMonitor } from './usage.js'

export type KimiTideCommand =
  | { kind: 'mode'; mode: RouterConfig['mode'] }
  | { kind: 'set'; key: string; value: unknown }
  | { kind: 'refresh' }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

export interface KimiTideCommandDeps {
  store: RouterSettingsStore
  monitor: UsageMonitor
  current: () => RouterConfig
  /** Called after a successful save: rebuild the router + push projection. */
  onSaved: (config: RouterConfig) => void
}

/** Keys settable via `/kimi-tide set` — dotted paths into RouterConfig. */
const SETTABLE_KEYS: Record<string, 'number' | 'boolean' | 'string'> = {
  premiumBudget: 'number',
  budgetWindow: 'number',
  charsPerToken: 'number',
  'escalateWhen.estimatedTokensGt': 'number',
  'escalateWhen.explicit': 'boolean',
  'primary.model': 'string',
  'premium.model': 'string',
  'premiumLong.model': 'string',
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
      if (type === 'boolean') {
        if (raw !== 'true' && raw !== 'false') return { kind: 'error', message: `"${raw}" is not a boolean` }
        return { kind: 'set', key, value: raw === 'true' }
      }
      return { kind: 'set', key, value: raw }
    }
    case 'refresh':
      return { kind: 'refresh' }
    default:
      return { kind: 'error', message: `unknown subcommand "${parts[0]}" — try /kimi-tide help` }
  }
}

const HELP_TEXT = [
  '/kimi-tide mode off|cost|capability — switch routing mode',
  '/kimi-tide set <key> <value> — update one router setting',
  `  keys: ${Object.keys(SETTABLE_KEYS).join(', ')}`,
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
  }
}

function persist(config: RouterConfig, deps: KimiTideCommandDeps, what: string): string {
  try {
    deps.store.save(config)
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
      description: '月汐 panel: route mode / settings / quota refresh',
      input: { hint: 'mode off|cost|capability · set <key> <value> · refresh' },
      handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
        const cmd = parseKimiTideCommand(invocation.rawInput)
        const text = await applyKimiTideCommand(cmd, deps)
        return cmd.kind === 'error' ? { kind: 'error', text } : { kind: 'success', text }
      },
    })
  })
}
