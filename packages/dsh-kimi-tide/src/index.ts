/**
 * dsh-kimi-tide — 月汐
 *
 * Kimi Code (Moonshot) subscription as a native DeepSeek Harness LLM
 * provider, plus the 月汐 dock panel: official quota display, local token
 * stats, and the 0.3.0 capability-scored router with provider-agnostic
 * candidate enumeration and sidecar persistence.
 */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { KNOWN_SESSION_EVENT_TYPES as KNOWN_SESSION_EVENT_TYPES_DIRECT } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { KimiAdapter } from './adapter.js'
import { registerKimiTideCommands } from './commands.js'
import { KimiOAuthManager } from './oauth.js'
import { KIMI_TIDE_PANEL_EVENT, kimiTideProjectionDefinition } from './projection.js'
import {
  installRouter,
  KimiRouter,
  type RouteDecision,
  type RouterConfig,
  type RouterLog,
} from './router.js'
import { configKey, DEFAULT_CONFIG_V2, type CandidateMeta, type RouterConfigV2 } from './config.js'
import { RouterSidecarStore } from './sidecar.js'
import { RouterSettingsStore } from './settings.js'
import { UsageMonitor } from './usage.js'
import type { CandidateSummary, ConfigSource, DecisionSummary, KimiTidePanelProjection } from './types.js'

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
  /** Router config; absent/mode off = 0.1.x behavior. Static seed for the v2 sidecar chain. */
  router?: RouterConfig
  /** Patch file holding the legacy static router seed (default $DSH_HOME/profiles/web/cordis.patch.yml). */
  patchFile?: string
  /** Sidecar router store file (default: kimi-tide-router.yml next to the patch file). */
  sidecarFile?: string
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

export function defaultSidecarFile(): string {
  return join(dirname(defaultPatchFile()), 'kimi-tide-router.yml')
}

/**
 * Bridge a v1 (0.2.x) router config onto the v2 scoring engine. Kept for
 * tests and external callers that still hold the v1 shape; the production
 * wiring loads RouterConfigV2 through the sidecar chain.
 */
export function routerConfigToV2(config: RouterConfig): RouterConfigV2 {
  const v2 = DEFAULT_CONFIG_V2('kimi-tide')
  return {
    ...v2,
    mode: config.mode,
    default: config.primary,
    candidates: [config.premium, config.premiumLong].filter((t): t is NonNullable<typeof t> => t !== undefined),
    premiumBudget: config.premiumBudget ?? v2.premiumBudget,
    budgetWindow: config.budgetWindow ?? v2.budgetWindow,
    charsPerToken: config.charsPerToken ?? v2.charsPerToken,
  }
}

/**
 * Candidate metadata implied by a v1 config. Per the real capability matrix
 * (pi-ai catalog, 2026-08-18): deepseek-v4-* text-only/cheap, Kimi k3 family
 * multimodal/mid.
 */
export function candidateMetasFromConfig(config: RouterConfig): CandidateMeta[] {
  const tierOf = (provider: string): CandidateMeta['costTier'] => (provider === 'deepseek-official' ? 'cheap' : 'mid')
  const targets = [config.primary, config.premium, config.premiumLong].filter(
    (t): t is NonNullable<typeof t> => t !== undefined,
  )
  const textOnly = new Set(config.textOnlyProviders ?? [config.primary.provider])
  return targets.map((t) => ({
    ...t,
    modalities: textOnly.has(t.provider) ? ['text'] : ['text', 'image'],
    costTier: tierOf(t.provider),
    available: true,
  }))
}

export function buildRouter(config: RouterConfig, log: RouterLog): KimiRouter {
  return new KimiRouter(routerConfigToV2(config), candidateMetasFromConfig(config), log)
}

/**
 * Summarize one routing decision for the panel (spec §2.7). Returns null for
 * anything that must NOT surface: keep decisions, mode-off/cost-mode
 * decisions, and no-decision states. Route decisions carry the scoring delta
 * (null for explicit @provider picks, which are not score comparisons) and
 * the reason truncated to 120 characters. Pure — no agent/ctx access.
 */
export function buildDecisionSummary(
  decision: RouteDecision,
  mode: RouterConfigV2['mode'],
): DecisionSummary | null {
  if (mode !== 'capability' || decision.kind !== 'route') return null
  return {
    chosen: { provider: decision.target.provider, model: decision.target.model },
    reason: decision.reason.slice(0, 120),
    scoreDelta: decision.scoreDelta,
  }
}

/** The llm runtime surface the candidate enumeration consumes (rc.6 shapes). */
interface LlmCatalog {
  listProviders: () => LlmProviderInfo[]
  listModels: (provider: string) => Promise<LlmModelInfo[]>
  resolveModelInfo: (provider: string, model: string, signal?: AbortSignal) => Promise<LlmResolvedModelInfo>
}

/**
 * Provider-agnostic candidate enumeration (spec §2.5): every registered
 * provider on the whitelist contributes its catalog; each model is resolved
 * for inputModalities (drives the image guard) and its cost tier is looked
 * up from config.costTiers (catalogs carry no price data — default mid).
 * A provider/model that fails to enumerate is dropped with a warning, never
 * aborting the pool; before the first enumeration completes the pool is
 * seeded from the configured targets with text-only/default-mid metadata so
 * the router is immediately mountable.
 */
async function enumerateCandidates(
  llm: LlmCatalog,
  config: RouterConfigV2,
  onError: (message: string) => void,
): Promise<CandidateMeta[]> {
  const out: CandidateMeta[] = []
  const seen = new Set<string>()
  const allowed = new Set(config.allowedProviders)
  let providers: LlmProviderInfo[] = []
  try {
    providers = llm.listProviders()
  } catch (error) {
    onError(`dsh-kimi-tide: listProviders failed: ${(error as Error).message}`)
  }
  for (const provider of providers) {
    if (!allowed.has(provider.id)) continue
    let models: LlmModelInfo[] = []
    try {
      models = await llm.listModels(provider.id)
    } catch (error) {
      onError(`dsh-kimi-tide: listModels(${provider.id}) failed: ${(error as Error).message}`)
      continue
    }
    for (const model of models) {
      let modalities: string[] = ['text']
      try {
        const resolved = await llm.resolveModelInfo(provider.id, model.id)
        if (Array.isArray(resolved.inputModalities) && resolved.inputModalities.length > 0) {
          modalities = [...resolved.inputModalities]
        }
      } catch (error) {
        // Conservative degradation, not a drop: an unresolvable model stays
        // available as text-only (modalities ['text']) so routing keeps
        // working and the panel can still show it; the image guard will
        // simply never claim image prompts for it.
        onError(`dsh-kimi-tide: resolveModelInfo(${provider.id}/${model.id}) failed: ${(error as Error).message}`)
      }
      out.push({
        provider: provider.id,
        model: model.id,
        modalities,
        costTier: config.costTiers[configKey({ provider: provider.id, model: model.id })] ?? 'mid',
        available: true,
      })
      seen.add(configKey({ provider: provider.id, model: model.id }))
    }
  }
  // Configured targets absent from the live catalog stay visible (available:
  // false → 标灰 in the panel, excluded from scoring by selectCandidate).
  for (const target of [config.default, ...config.candidates]) {
    const key = configKey(target)
    if (seen.has(key)) continue
    out.push({
      ...target,
      modalities: ['text'],
      costTier: config.costTiers[key] ?? 'mid',
      available: false,
    })
  }
  return out
}

/** Pool used before the first enumeration settles (router mounts immediately). */
function fallbackCandidateMetas(config: RouterConfigV2): CandidateMeta[] {
  const targets = [config.default, ...config.candidates]
  const seen = new Set<string>()
  const out: CandidateMeta[] = []
  for (const target of targets) {
    const key = configKey(target)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...target, modalities: ['text'], costTier: config.costTiers[key] ?? 'mid', available: true })
  }
  return out
}

/**
 * Register the panel event type on the INSTALLATION's KNOWN_SESSION_EVENT_TYPES
 * Set. The strict session-log reader (dsh-session-persistence) refuses event
 * types outside the catalog unless the envelope marks them ignorable, and
 * `Session.append` cannot set that marker — extending the catalog is the only
 * door for a custom projection event. The catalog is a live mutable Set on
 * the dsh-session module instance the harness itself uses; a `link:`-installed
 * plugin's bare import resolves its workspace node_modules copy instead (a
 * different Set), so we anchor a require in the flat profile module fallback
 * (`$DSH_HOME/profiles/node_modules` — one junction per package in the dsh
 * app's dependency closure, maintained by `healProfilesModuleFallback`).
 * Resolution from there lands on the SAME real module the harness checks, so
 * the mutation makes stored `kimi-tide/panel` events readable again after a
 * restart. Falls back to the directly imported copy when no installation
 * fallback exists (e.g. unit tests).
 * @returns true when the host (installation) catalog was reached; false when
 * only the locally resolved copy was mutated.
 */
function registerPanelEventType(): boolean {
  let known = KNOWN_SESSION_EVENT_TYPES_DIRECT as Set<string>
  let hostReached = false
  try {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const hostRequire = createRequire(join(home, 'profiles', 'node_modules', 'host.cjs'))
    const hostSession = hostRequire('@deepseek-ai/dsh-session') as {
      KNOWN_SESSION_EVENT_TYPES: ReadonlySet<string>
    }
    known = hostSession.KNOWN_SESSION_EVENT_TYPES as Set<string>
    hostReached = true
  } catch {
    // No dsh installation fallback in this environment (e.g. unit tests):
    // mutating the directly imported copy is the best effort available.
  }
  known.add(KIMI_TIDE_PANEL_EVENT)
  return hostReached
}

export function apply(ctx: Context, config: Config = {}) {
  const providerName = config.providerName ?? 'kimi-tide';
  const refreshIntervalMs = config.refreshIntervalMs ?? 10 * 60 * 1000;
  const log: RouterLog = {
    info: (message: string) => { ctx.logger.info(message); },
  };
  const warn = (message: string) => { ctx.logger?.warn?.(message) }

  // The strict persistence reader refuses logs with unknown event types.
  // The catalog Set lives on the INSTALLATION's dsh-session module instance;
  // register the panel type there (see registerPanelEventType).
  if (registerPanelEventType()) {
    ctx.logger.info('dsh-kimi-tide: panel event type registered on the installation session catalog')
  } else {
    ctx.logger.warn('dsh-kimi-tide: panel event type registered on a local dsh-session copy; stored kimi-tide/panel events may refuse to load')
  }

  const oauth = new KimiOAuthManager(ctx.logger, { home: config.kimiHome ?? '' })

  // Panel data source: quota polling + local token buckets.
  const monitor = new UsageMonitor(oauth, {
    pollMs: config.usagePollMs ?? 60_000,
    onUpdate: () => pushPanelToAllSessions(),
  })

  const adapter = new KimiAdapter(oauth, {
    providerName,
    onUsage: (usage) => monitor.tapUsage(usage),
    // Durable attachment store for image conversion (optional service; the
    // adapter falls back to the text-only error when it is absent) — mirrors
    // the official dsh-llm-pi-ai resolveAttachments seam.
    resolveAttachments: () => ctx.get('attachments') as never,
  })
  ctx.llm.registerAdapter([providerName], adapter)

  // Router persistence (0.3.0): the sidecar file is the live store; the
  // patch file keeps only the legacy static seed. Priority: sidecar > patch
  // static > DEFAULT_CONFIG_V2(providerName). Saving no longer rewrites the
  // loader-watched patch file, so a panel save no longer re-applies the
  // plugin (the root cause of the 57c7ef8 desync class).
  const store = new RouterSettingsStore({
    patchFile: config.patchFile ?? defaultPatchFile(),
    onError: warn,
  })
  const sidecar = new RouterSidecarStore({
    file: config.sidecarFile ?? defaultSidecarFile(),
    patchFallback: () => {
      if (config.router !== undefined) return config.router
      try {
        return store.load()
      } catch {
        return null
      }
    },
    onError: warn,
  })
  const loaded = sidecar.load()
  let routerConfigV2: RouterConfigV2 = loaded.config ?? DEFAULT_CONFIG_V2(providerName)
  let configSource: ConfigSource =
    loaded.source === 'sidecar' ? 'sidecar' : loaded.source === 'patch' ? 'patch' : 'default'

  // Candidate pool: mounted immediately with config-derived fallback metas,
  // then replaced by the enumerated pool once the llm catalog settles;
  // llm/adapters-updated (declared by dsh-llm, payload-free) re-enumerates.
  let candidateMetas: CandidateMeta[] = fallbackCandidateMetas(routerConfigV2)
  let enumerationSeq = 0
  const refreshCandidates = () => {
    const seq = ++enumerationSeq
    void enumerateCandidates(ctx.llm as unknown as LlmCatalog, routerConfigV2, warn)
      .then((metas) => {
        if (seq !== enumerationSeq) return
        candidateMetas = metas
        mountRouter()
        pushPanelToAllSessions()
      })
      .catch((error) => warn(`dsh-kimi-tide: candidate enumeration failed: ${(error as Error).message}`))
  }

  let disposeRouter: (() => void) | null = null
  const mountRouter = () => {
    disposeRouter?.()
    disposeRouter = null
    if (routerConfigV2.mode !== 'off') {
      disposeRouter = installRouter(ctx, new KimiRouter(routerConfigV2, candidateMetas, log), onDecision)
    }
  }

  // Decision observability (spec §2.7): only capability-mode non-keep
  // decisions surface a summary; anything else (off / keep / cost-mode)
  // clears the summary so a stale decision never leaks into later snapshots.
  let latestDecision: DecisionSummary | null = null
  const onDecision = (_agent: Agent, decision: RouteDecision) => {
    latestDecision = buildDecisionSummary(decision, routerConfigV2.mode)
    pushPanelToAllSessions()
  }

  mountRouter()
  refreshCandidates()

  // Panel persistence + commands (client→host channel). Commands speak the
  // v2 config shape and write ONLY the sidecar — the v1 patch file keeps the
  // legacy static seed untouched (the sidecar outranks it on load anyway, so
  // a raw-text patch splice would be dead weight and would drop v2-only
  // fields like scores/classify.patterns).
  registerKimiTideCommands(ctx, {
    sidecar,
    monitor,
    current: () => routerConfigV2,
    onSaved: (next) => {
      routerConfigV2 = next
      // A config change invalidates any decision made under the old config:
      // the summary is dropped until the next capability route decision.
      latestDecision = null
      configSource = 'sidecar'
      mountRouter()
      refreshCandidates()
      pushPanelToAllSessions()
    },
  })

  // Projection: register the unit, then push the current snapshot into every
  // session as it appears (panel data is process-global, not per-session).
  ctx.sessionProjections.register(kimiTideProjectionDefinition)
  // Dropdown model catalogs: kimi from the pi-ai catalog (sync), deepseek from
  // the llm service (async; refreshed when adapters change).
  let modelOptions: { kimi: string[]; deepseek: string[] } = { kimi: adapter.listModelIds(), deepseek: [] }
  const panelSnapshot = (): KimiTidePanelProjection => ({
    quota: monitor.snapshot().quota,
    local: monitor.snapshot().local,
    router: v2ToV1View(routerConfigV2),
    reasoning: { enabled: true },
    models: modelOptions,
    configSource,
    candidates: candidateMetas.map((m) => {
      const summary: CandidateSummary = { provider: m.provider, model: m.model, available: m.available }
      // 用户覆盖分下发给面板（ScoreEditor 滑杆初值）；无覆盖时缺省。
      const override = routerConfigV2.scores[configKey(m)]
      if (override !== undefined) summary.scores = override
      return summary
    }),
    decision: latestDecision,
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
  const refreshModelOptions = () => {
    const llm = ctx.llm as { listModels?: (provider: string) => Promise<Array<{ id: string }>> }
    if (typeof llm.listModels !== 'function') return
    void llm.listModels('deepseek-official')
      .then((models) => {
        modelOptions = { ...modelOptions, deepseek: models.map((m) => m.id) }
        pushPanelToAllSessions()
      })
      .catch(() => { /* deepseek adapter absent: dropdown falls back to free text */ })
  }
  refreshModelOptions()
  ctx.on('llm/adapters-updated', () => {
    refreshModelOptions()
    refreshCandidates()
  })
  ctx.on('agent/created', (payload: { agent: Agent }) => {
    liveAgents.add(payload.agent)
    pushPanel(payload.agent)
  })
  ctx.on('agent/disposed', (payload: { agent: Agent }) => {
    liveAgents.delete(payload.agent)
  })
  // Seed the roster from the live agent registry: agent/created does NOT
  // re-fire for agents that already live, so a (re)applied instance must
  // recover its roster from ctx.agents. ctx.agents is optional (headless).
  const agentRegistry = ctx.get('agents') as { list?: () => Agent[] } | undefined
  if (typeof agentRegistry?.list === 'function') {
    for (const agent of agentRegistry.list()) liveAgents.add(agent)
    if (liveAgents.size > 0) pushPanelToAllSessions()
  }

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

/**
 * The panel form still speaks the v1 shape (primary/premium); project the v2
 * config back for display until the panel v3 task (Task 10) lands.
 */
function v2ToV1View(config: RouterConfigV2): RouterConfig {
  const premium = config.candidates.find(
    (c) => c.provider !== config.default.provider || c.model !== config.default.model,
  ) ?? config.default
  return {
    mode: config.mode,
    primary: config.default,
    premium,
    premiumBudget: config.premiumBudget,
    budgetWindow: config.budgetWindow,
    charsPerToken: config.charsPerToken,
  }
}
