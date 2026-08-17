/**
 * dsh-kimi-tide — 月汐
 *
 * Kimi Code (Moonshot) subscription as a native DeepSeek Harness LLM
 * provider, plus the 月汐 dock panel: official quota display, local token
 * stats, and a router-settings panel persisted back into the user's
 * cordis.patch.yml.
 */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { KimiAdapter } from './adapter.js'
import { registerKimiTideCommands } from './commands.js'
import { KimiOAuthManager } from './oauth.js'
import { KIMI_TIDE_PANEL_EVENT, kimiTideProjectionDefinition } from './projection.js'
import { installRouter, KimiRouter, type RouterConfig, type RouterLog } from './router.js'
import { RouterSettingsStore } from './settings.js'
import { UsageMonitor } from './usage.js'
import type { KimiTidePanelProjection } from './types.js'

export const name = 'dsh-kimi-tide'

export const inject = ['llm', 'timer', 'commands', 'sessionProjections']

export interface Config {
  /** Provider route name registered into ctx.llm. */
  providerName?: string
  /** Kimi home directory; default follows KIMI_CODE_HOME then ~/.kimi-code. */
  kimiHome?: string
  /** Token refresh period in milliseconds (access tokens live ~15 min). */
  refreshIntervalMs?: number
  /** Refresh immediately on startup (default true). */
  refreshOnStart?: boolean
  /** Quota poll period in milliseconds (default 60000). */
  usagePollMs?: number
  /** Poll quota immediately on startup (default true). */
  usagePollOnStart?: boolean
  /** Router config; absent/mode off = 0.1.x behavior. The dock panel persists edits to the patch file. */
  router?: RouterConfig
  /** Patch file to persist router settings into (default $DSH_HOME/profiles/web/cordis.patch.yml). */
  patchFile?: string
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  mode: 'off',
  primary: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  premium: { provider: 'kimi-tide', model: 'kimi-for-coding' },
  premiumLong: { provider: 'kimi-tide', model: 'k3' },
}

export function defaultPatchFile(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'profiles', 'web', 'cordis.patch.yml')
}

export function buildRouter(config: RouterConfig, log: RouterLog): KimiRouter {
  return new KimiRouter(config, log)
}

export function apply(ctx: Context, config: Config = {}) {
  const providerName = config.providerName ?? 'kimi-tide';
  const refreshIntervalMs = config.refreshIntervalMs ?? 10 * 60 * 1000;
  const log: RouterLog = {
    info: (message: string) => { ctx.logger.info(message); },
  };

  // The strict persistence reader refuses logs with unknown event types.
  // KNOWN_SESSION_EVENT_TYPES is typed ReadonlySet but is a live mutable Set
  // at runtime (same pattern as dsh-kimi-bridge/src/index.ts:105).
  (KNOWN_SESSION_EVENT_TYPES as Set<string>).add(KIMI_TIDE_PANEL_EVENT)

  const oauth = new KimiOAuthManager(ctx.logger, { home: config.kimiHome ?? '' })

  // Panel data source: quota polling + local token buckets.
  const monitor = new UsageMonitor(oauth, {
    pollMs: config.usagePollMs ?? 60_000,
    onUpdate: () => pushPanelToAllSessions(),
  })

  const adapter = new KimiAdapter(oauth, {
    providerName,
    onUsage: (usage) => monitor.tapUsage(usage),
  })
  ctx.llm.registerAdapter([providerName], adapter)

  // Router: static config wins; otherwise the persisted panel config; else default off.
  const store = new RouterSettingsStore({
    patchFile: config.patchFile ?? defaultPatchFile(),
    onError: (message) => ctx.logger?.warn?.(message),
  })
  let routerConfig: RouterConfig = config.router ?? loadPersisted(store) ?? DEFAULT_ROUTER_CONFIG
  let disposeRouter: (() => void) | null = null
  const mountRouter = () => {
    disposeRouter?.()
    disposeRouter = null
    if (routerConfig.mode !== 'off') {
      disposeRouter = installRouter(ctx, buildRouter(routerConfig, log))
    }
  }
  mountRouter()

  // Panel persistence + commands (client→host channel).
  registerKimiTideCommands(ctx, {
    store,
    monitor,
    current: () => routerConfig,
    onSaved: (next) => {
      routerConfig = next
      mountRouter()
      pushPanelToAllSessions()
    },
  })

  // Projection: register the unit, then push the current snapshot into every
  // session as it appears (panel data is process-global, not per-session).
  ctx.sessionProjections.register(kimiTideProjectionDefinition)
  const panelSnapshot = (): KimiTidePanelProjection => ({
    quota: monitor.snapshot().quota,
    local: monitor.snapshot().local,
    router: routerConfig,
    reasoning: { enabled: true },
  })
  const pushPanel = (agent: Agent) => {
    try {
      agent.session.append(KIMI_TIDE_PANEL_EVENT, panelSnapshot())
    } catch (error) {
      ctx.logger?.warn?.(`dsh-kimi-tide: panel push failed: ${(error as Error).message}`)
    }
  }
  const liveAgents = new Set<Agent>()
  function pushPanelToAllSessions() {
    for (const agent of liveAgents) pushPanel(agent)
  }
  ctx.on('agent/created', (payload: { agent: Agent }) => {
    liveAgents.add(payload.agent)
    pushPanel(payload.agent)
  })
  ctx.on('agent/disposed', (payload: { agent: Agent }) => {
    liveAgents.delete(payload.agent)
  })

  // OAuth refresh loop (0.1.x behavior).
  const refresh = () => { void oauth.refresh().catch(() => {}) }
  if (config.refreshOnStart !== false) void oauth.refresh().catch(() => {})
  ctx.effect(() => {
    const timer = ctx.setInterval(refresh, refreshIntervalMs)
    return () => timer()
  })

  // Quota polling lifecycle.
  if (config.usagePollOnStart !== false) monitor.start()
  ctx.effect(() => () => monitor.stop())
  ctx.effect(() => () => disposeRouter?.())
}

function loadPersisted(store: RouterSettingsStore): RouterConfig | null {
  try {
    return store.load()
  } catch {
    return null
  }
}
