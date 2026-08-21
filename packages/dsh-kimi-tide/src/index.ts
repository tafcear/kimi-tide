/**
 * dsh-kimi-tide — 月汐
 *
 * Kimi Code (Moonshot) subscription as a native DeepSeek Harness LLM
 * provider, plus the 月汐 dock panel: official quota display, the 0.4.x
 * kimi 二态接入指示, and the 0.5.0 rule-driven router (preset/rule/keyword-
 * group → RouteDecision with via) with provider-agnostic candidate
 * enumeration and sidecar/settings persistence.
 */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: brings the `ctx.settings` augmentation in without making
// @deepseek-ai/dsh-settings a load-time dependency (rc.6 hosts lack it).
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { KNOWN_SESSION_EVENT_TYPES as KNOWN_SESSION_EVENT_TYPES_DIRECT } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { copyFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { registerKimiTideCommands, type SettingsNamespacePort } from './commands.js'
import { coerceRouterConfigV4, hasKimiTideResidue } from './migrate.js'
import { KIMI_TIDE_PANEL_EVENT, kimiTideProjectionDefinition } from './projection.js'
import {
  installRouter,
  KimiRouter,
  type RouteDecision,
  type RouterLog,
} from './router.js'
import { configKey, DEFAULT_CONFIG_V4, type CandidateMeta, type RouteTarget, type RouterConfigV4 } from './config.js'
import { routerConfigSchema, validateRouterConfig } from './settings-schema.js'
import { RouterSidecarStore } from './sidecar.js'
import { RouterSettingsStore, type RouterConfig } from './settings.js'
import { UsageMonitor } from './usage.js'
import type { CandidateSummary, ConfigSource, DecisionSummary, KimiAccessStatus, KimiTidePanelProjection } from './types.js'

export const name = 'dsh-kimi-tide'

export const inject = ['llm', 'timer', 'commands', 'sessionProjections']

/** User-settings namespace owning RouterConfigV4 (dsh-settings). */
export const SETTINGS_NAMESPACE = 'kimi-tide-router'

export interface Config {
  /** Quota poll period in milliseconds (default 60000). */
  usagePollMs?: number
  /** Poll quota immediately on startup (default true). */
  usagePollOnStart?: boolean
  /**
   * Router config composition seed. The entry still speaks the legacy v1
   * vocabulary (mode/primary/premium) — it is migrated through the
   * coerceRouterConfigV4 chain into the v4 preset/rule shape.
   */
  router?: RouterConfig
  /** Patch file holding the legacy static router seed (default $DSH_HOME/profiles/web/cordis.patch.yml). */
  patchFile?: string
  /** Sidecar router store file (default: kimi-tide-router.yml next to the patch file). */
  sidecarFile?: string
}

export function defaultPatchFile(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'profiles', 'web', 'cordis.patch.yml')
}

export function defaultSidecarFile(): string {
  return join(dirname(defaultPatchFile()), 'kimi-tide-router.yml')
}

/**
 * Summarize one routing decision for the panel (spec §2.7). Returns null for
 * anything that must NOT surface: keep decisions, no-decision states, and
 * default-preset (miss → 打底) routes. Route decisions carry the reason
 * truncated to 120 characters. Pure — no agent/ctx access.
 */
export function buildDecisionSummary(decision: RouteDecision): DecisionSummary | null {
  if (decision.kind !== 'route' || decision.via === 'default') return null
  return { chosen: { provider: decision.target.provider, model: decision.target.model }, reason: decision.reason.slice(0, 120) }
}

/** The llm runtime surface the candidate enumeration consumes (rc.6 shapes). */
interface LlmCatalog {
  listProviders: () => LlmProviderInfo[]
  listModels: (provider: string) => Promise<LlmModelInfo[]>
  resolveModelInfo: (provider: string, model: string, signal?: AbortSignal) => Promise<LlmResolvedModelInfo>
}

/** 所有预设 default + 所有规则 target 的并集（去重，preset 序内 default→rules 序）。 */
function configuredTargets(config: RouterConfigV4): RouteTarget[] {
  const out: RouteTarget[] = []
  const seen = new Set<string>()
  for (const preset of Object.values(config.presets)) {
    for (const t of [preset.default, ...preset.rules.map((r) => r.target)]) {
      const key = configKey(t)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(t)
    }
  }
  return out
}

/**
 * Provider-agnostic candidate enumeration (spec §2.5): every registered
 * provider contributes its catalog (no whitelist — a provider that fails to
 * enumerate is dropped with a warning, never aborting the pool); each model
 * is resolved for inputModalities (drives the image guard). Before the
 * first enumeration completes the pool is seeded from the configured
 * targets (preset defaults + rule targets) with text-only metadata so the
 * router is immediately mountable.
 */
async function enumerateCandidates(
  llm: LlmCatalog,
  config: RouterConfigV4,
  onError: (message: string) => void,
): Promise<CandidateMeta[]> {
  const out: CandidateMeta[] = []
  const seen = new Set<string>()
  let providers: LlmProviderInfo[] = []
  try {
    providers = llm.listProviders()
  } catch (error) {
    onError(`dsh-kimi-tide: listProviders failed: ${(error as Error).message}`)
  }
  for (const provider of providers) {
    let models: LlmModelInfo[] = []
    try {
      models = await llm.listModels(provider.id)
    } catch (error) {
      onError(`dsh-kimi-tide: listModels(${provider.id}) failed: ${(error as Error).message}`)
      continue
    }
    for (const model of models) {
      let modalities: string[] = ['text']
      let reasoningEfforts: string[] | undefined
      try {
        const resolved = await llm.resolveModelInfo(provider.id, model.id)
        if (Array.isArray(resolved.inputModalities) && resolved.inputModalities.length > 0) {
          modalities = [...resolved.inputModalities]
        }
        // 推理等级能力（2026-08-21：路由目标若支持会话级 effort 则保留，
        // router.applyTo 据此做支持判定与钳制；无 reasoning 的模型不带此字段）。
        if (Array.isArray(resolved.reasoning?.efforts) && resolved.reasoning.efforts.length > 0) {
          reasoningEfforts = resolved.reasoning.efforts.map((e) => e.id)
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
        available: true,
        ...(reasoningEfforts === undefined ? {} : { reasoningEfforts }),
      })
      seen.add(configKey({ provider: provider.id, model: model.id }))
    }
  }
  // Configured targets absent from the live catalog stay visible (available:
  // false → 标灰 in the panel, and the router skips them when routing).
  for (const target of configuredTargets(config)) {
    const key = configKey(target)
    if (seen.has(key)) continue
    out.push({
      ...target,
      modalities: ['text'],
      available: false,
    })
  }
  return out
}

/**
 * Structural equality over JSON-shaped data (key order agnostic) — mirrors
 * dsh-settings' change-detection predicate without importing it, so this
 * module stays loadable on a host that has no settings package at all.
 */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((entry, index) => sameJson(entry, b[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => key in right && sameJson(left[key], right[key]))
}

/** Pool used before the first enumeration settles (router mounts immediately). */
function fallbackCandidateMetas(config: RouterConfigV4): CandidateMeta[] {
  return configuredTargets(config).map((target) => ({
    ...target,
    modalities: ['text'],
    available: true,
  }))
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
  const log: RouterLog = { info: (message: string) => { ctx.logger.info(message) } }
  const warn = (message: string) => { ctx.logger?.warn?.(message) }

  // The strict persistence reader refuses logs with unknown event types.
  // The catalog Set lives on the INSTALLATION's dsh-session module instance;
  // register the panel type there (see registerPanelEventType).
  if (registerPanelEventType()) {
    ctx.logger.info('dsh-kimi-tide: panel event type registered on the installation session catalog')
  } else {
    ctx.logger.warn('dsh-kimi-tide: panel event type registered on a local dsh-session copy; stored kimi-tide/panel events may refuse to load')
  }

  // 0.4.x：零接入层——Kimi 模型经 settings.yaml 的 llm-pi-ai.providers.kimi-coding
  // 路由（官方 Models 页维护）进 DSH LLM 注册表。本插件只负责读该路由的
  // apiKeyEnv 引用名并解析 key（配额轮询用），永不触碰密钥本体。
  const kimiApiKeyEnv = (): string => {
    const settings = ctx.get('settings') as { get?: (ns: unknown) => unknown } | undefined
    const section = settings?.get?.('llm-pi-ai') as { providers?: Record<string, { apiKeyEnv?: string }> } | undefined
    return section?.providers?.['kimi-coding']?.apiKeyEnv ?? 'KIMI_API_KEY'
  }
  const resolveKey = async (): Promise<string | null> => {
    const env = kimiApiKeyEnv()
    const credentials = ctx.get('credentials') as { resolve?: (ref: string) => Promise<{ value: string } | undefined> } | undefined
    if (typeof credentials?.resolve === 'function') {
      try {
        const resolved = await credentials.resolve(env)
        if (resolved !== undefined && resolved.value.length > 0) return resolved.value
      } catch { /* 落到 env 兜底 */ }
    }
    const fromEnv = process.env[env]
    return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : null
  }

  // 0.4.x 二态接入指示：路由注册 + key 可解析。缺任一 → 面板显示配置指引
  // （spec §3.5/验收 5）。刷新触发：启动、llm/adapters-updated、设置文档变化
  // （llm-pi-ai 节经 settings 服务提交）、配额轮询（顺带 60s 兜底）、
  // credentials/updated（凭据落盘即生效，无需重启）。
  let kimiStatus: KimiAccessStatus = { route: false, key: false }
  const refreshKimiStatus = async () => {
    let route = false
    try {
      route = (ctx.llm as unknown as LlmCatalog).listProviders().some((p) => p.id === 'kimi-coding')
    } catch { /* llm 不可用：保持 false */ }
    let key = false
    try { key = (await resolveKey()) !== null } catch { /* 同上 */ }
    if (route !== kimiStatus.route || key !== kimiStatus.key) {
      kimiStatus = { route, key }
      pushPanelToAllSessions()
    }
  }
  void refreshKimiStatus()

  // Panel data source: quota polling（本地 token 统计随接入层退役，Task 6 移除）。
  const monitor = new UsageMonitor({
    pollMs: config.usagePollMs ?? 60_000,
    onUpdate: () => {
      pushPanelToAllSessions()
      void refreshKimiStatus()
    },
    resolveKey,
  })

  // Router persistence (0.4.0): the dsh-settings namespace `kimi-tide-router`
  // is the primary store (see the ctx.inject wiring below); the sidecar file
  // stays the live store for hosts WITHOUT a settings service and the one-shot
  // migration source for hosts that gained one. The patch file keeps only the
  // legacy static seed. Priority without settings: sidecar > patch static >
  // DEFAULT_CONFIG_V4().
  const store = new RouterSettingsStore({
    patchFile: config.patchFile ?? defaultPatchFile(),
    onError: warn,
  })
  const sidecarFile = config.sidecarFile ?? defaultSidecarFile()
  /**
   * Composition seed in its raw v1 shape: entry config, else the patch static
   * block. Read once — it feeds both the sidecar fallback chain and the
   * settings `base` layer, and re-reading would duplicate its warnings.
   */
  const seedRaw: unknown = config.router !== undefined
    ? config.router
    : (() => { try { return store.load() } catch { return null } })()
  const sidecar = new RouterSidecarStore({
    file: sidecarFile,
    patchFallback: () => seedRaw,
    onError: warn,
  })
  const loaded = sidecar.load()
  let routerConfigV4: RouterConfigV4 = loaded.config ?? DEFAULT_CONFIG_V4()
  let configSource: ConfigSource =
    loaded.source === 'sidecar' ? 'sidecar' : loaded.source === 'patch' ? 'patch' : 'default'
  // The settings namespace's `base` layer must be v4-shaped: the composition
  // entry (and the legacy patch block) speak v1 (mode/primary/premium), and v1
  // keys mean nothing to routerConfigSchema — layering them raw would resolve
  // to the schema's DEFAULT targets and silently drop a composed route.
  // coerceRouterConfigV4 is the version-dispatching v1/v2/v3→v4 bridge the
  // sidecar fallback chain uses; a NULL seed resolves to DEFAULT_CONFIG_V4()
  // so the namespace base aligns with mergeResolved's clean predicate and the
  // routerConfigV4 fallback above.
  const settingsBase: Partial<RouterConfigV4> =
    seedRaw === null || seedRaw === undefined
      ? DEFAULT_CONFIG_V4()
      : coerceRouterConfigV4(seedRaw, warn)

  // Candidate pool: mounted immediately with config-derived fallback metas,
  // then replaced by the enumerated pool once the llm catalog settles;
  // llm/adapters-updated (declared by dsh-llm, payload-free) re-enumerates.
  let candidateMetas: CandidateMeta[] = fallbackCandidateMetas(routerConfigV4)
  let enumerationSeq = 0
  const refreshCandidates = () => {
    const seq = ++enumerationSeq
    void enumerateCandidates(ctx.llm as unknown as LlmCatalog, routerConfigV4, warn)
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
    if (routerConfigV4.activePreset !== null) {
      disposeRouter = installRouter(ctx, new KimiRouter(routerConfigV4, candidateMetas, log), onDecision)
    }
  }

  // Decision observability (spec §2.7): only non-default route decisions
  // surface a summary; anything else (off / keep / default miss) clears the
  // summary so a stale decision never leaks into later snapshots.
  let latestDecision: DecisionSummary | null = null
  const onDecision = (_agent: Agent, decision: RouteDecision) => {
    latestDecision = buildDecisionSummary(decision)
    pushPanelToAllSessions()
  }

  mountRouter()
  refreshCandidates()

  // Panel persistence + commands (client→host channel). Commands speak the
  // v4 config shape and write the settings namespace when one is attached,
  // else the sidecar — never the v1 patch file (the sidecar outranks it on
  // load anyway).

  /** Owner scope of the settings namespace; null until attached (or after detach). */
  let settingsScope: SettingsNamespacePort | null = null

  /**
   * Adopt a new effective config: the single write path shared by the settings
   * namespace (attach / committed change / migration) and the command layer's
   * onSaved. A config change invalidates any decision made under the old
   * config, so the summary is dropped until the next route.
   *
   * Idempotent by value: one save arrives twice on a namespace host (the
   * command's onSaved, then the namespace commit watcher), and an unchanged
   * config must not re-mount the router or re-enumerate candidates. A source
   * flip alone (sidecar → settings at attach) still re-pushes the panel.
   */
  const applyConfig = (next: RouterConfigV4) => {
    const source: ConfigSource = settingsScope !== null ? 'settings' : 'sidecar'
    const changed = !sameJson(routerConfigV4, next)
    if (!changed && configSource === source) return
    routerConfigV4 = next
    configSource = source
    if (changed) {
      latestDecision = null
      mountRouter()
      refreshCandidates()
    }
    pushPanelToAllSessions()
  }

  registerKimiTideCommands(ctx, {
    sidecar,
    monitor,
    current: () => routerConfigV4,
    // A getter, not a snapshot: the settings service attaches asynchronously
    // (ctx.inject) and can detach, so the command layer must read the CURRENT
    // port — a value captured here would pin `null` and degrade every save to
    // the sidecar silently.
    get settings() { return settingsScope },
    onSaved: (next) => applyConfig(next),
  })

  // Projection: register the unit, then push the current snapshot into every
  // session as it appears (panel data is process-global, not per-session).
  ctx.sessionProjections.register(kimiTideProjectionDefinition as Extract<typeof kimiTideProjectionDefinition, { wire: unknown }>)
  // Dropdown model catalogs: both enumerated async from the llm service
  // (kimi-coding route + deepseek-official); refreshed when adapters change.
  let modelOptions: { kimi: string[]; deepseek: string[] } = { kimi: [], deepseek: [] }
  const panelSnapshot = (): KimiTidePanelProjection => {
    const preset = routerConfigV4.activePreset === null ? undefined : routerConfigV4.presets[routerConfigV4.activePreset]
    return {
      quota: monitor.snapshot().quota,
      kimi: kimiStatus,
      router: {
        activePreset: routerConfigV4.activePreset,
        presetName: preset?.name ?? null,
        defaultTarget: preset?.default ?? null,
        ruleCount: preset?.rules.length ?? 0,
      },
      reasoning: { enabled: true },
      models: modelOptions,
      configSource,
      candidates: candidateMetas.map((m) => {
        const summary: CandidateSummary = { provider: m.provider, model: m.model, available: m.available }
        return summary
      }),
      decision: latestDecision,
    }
  }
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
    void llm.listModels('kimi-coding')
      .then((models) => {
        modelOptions = { ...modelOptions, kimi: models.map((m) => m.id) }
        pushPanelToAllSessions()
      })
      .catch(() => { /* kimi-coding 路由未注册：下拉回退空列表，面板给接入指引 */ })
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
    void refreshKimiStatus()
  })
  // 凭据引用落盘即生效：credentials 服务发出 reference-updated 事件时重读接入指示与配额。
  // 事件未声明（宿主无凭据服务时永不触发）：经宽化类型注册，避免给 Events 增补类型。
  ;(ctx as unknown as { on: (name: string, listener: () => void) => () => void }).on('credentials/reference-updated', () => {
    void refreshKimiStatus()
    void monitor.refresh()
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

  // Settings namespace (dsh-settings, rc.7+): register `kimi-tide-router` with
  // the composition seed as its base layer and keep the owner scope so the
  // command layer can write through it. This is installSettingsSection's
  // wiring done by hand — the seam's hooks expose only a read thunk, and the
  // host needs the read AND write halves of the scope. The callback never runs
  // on a host without a settings service (rc.6), which is exactly the seam's
  // no-op behavior: the sidecar fallback stays in charge. Wired here, after the
  // panel roster exists, because attaching immediately applies the resolved
  // config and pushes a snapshot.
  ctx.inject(['settings'], (sctx) => {
    let scope: SettingsScope<RouterConfigV4>
    try {
      scope = sctx.settings.register(SETTINGS_NAMESPACE as never, routerConfigSchema as never, {
        base: settingsBase,
        // dsh-settings' validate throws to refuse a write; T1's returns a message.
        validate: (value: RouterConfigV4) => {
          const message = validateRouterConfig(value)
          if (message !== undefined) throw new Error(message)
        },
      }) as unknown as SettingsScope<RouterConfigV4>
    } catch (error) {
      // A stored section that already fails schema/validate rejects the
      // registration itself. Degrade loudly to the sidecar instead of leaving
      // the whole plugin fiber broken.
      warn(`dsh-kimi-tide: 设置命名空间 ${SETTINGS_NAMESPACE} 注册失败（${(error as Error).message}）；本次运行退回 sidecar 存储`)
      return
    }
    const port: SettingsNamespacePort = {
      get: () => scope.get(),
      update: (patch) => scope.update(patch),
      replace: (section) => scope.replace(section),
    }
    settingsScope = port
    // v4 一次性迁移（0.5.0，spec §6.1）。dsh-settings 的 replace 在 persist
    // 之后才 commit（scope.get() 异步更新），因此必须同步算出迁移值直喂首个
    // applyConfig——否则首个挂载与 sidecar 导入脏检查看到的是迁移前旧形。
    // 持久化替换在后台完成；提交后 watch 会以相同值再触发 applyConfig，
    // applyConfig 按值幂等（sameJson）不会重复挂载。整段迁移包在 try/catch
    // 里：迁移失败只降级（保留旧形状），绝不把异常抛回 inject 回调使命名空间
    // 半接（无 watch、无 sidecar 导入）。
    let baseline: RouterConfigV4
    try {
      const current = scope.get()
      const migrated = hasKimiTideResidue(current) ? coerceRouterConfigV4(current, warn) : current
      if (migrated !== current) {
        const docPath = (sctx.settings as { documentPath?: string }).documentPath
        if (typeof docPath === 'string' && docPath.length > 0) {
          try { copyFileSync(docPath, docPath + '.pre-v4') } catch (error) {
            warn(`dsh-kimi-tide: 设置文档 .pre-v4 快照失败（${(error as Error).message}）`)
          }
        }
        void scope.replace(migrated as unknown as object)
          .then(() => warn('dsh-kimi-tide: 设置命名空间 kimi-tide-router 已迁移至 v4（预设+规则）'))
          .catch((error: unknown) =>
            warn(`dsh-kimi-tide: 命名空间 v4 迁移持久化失败（${(error as Error).message}）；本次运行已应用迁移值，下次启动将重试`))
      }
      baseline = migrated
    } catch (error) {
      warn(`dsh-kimi-tide: 命名空间 v4 迁移失败（${(error as Error).message}）；本次运行保留旧形状`)
      baseline = scope.get()
    }
    applyConfig(baseline)
    // Detach (provider reload / service disposal) rides the scoped fiber: the
    // command layer falls back to the sidecar until the callback re-runs.
    sctx.effect(() => () => { settingsScope = null })
    // Committed changes (panel save, /kimi-tide, external document edit, the
    // migration below) all land here.
    sctx.effect(() => scope.watch(() => applyConfig(scope.get())))
    // One-shot legacy sidecar → namespace import. Imported dynamically so the
    // dsh-settings dependency it carries is resolved only on a host that
    // actually has the service (rc.6 keeps loading this plugin).
    void import('./settings-migration.js')
      .then(({ migrateSidecarIntoScope }) => migrateSidecarIntoScope({
        sidecarFile,
        scope: port,
        // MUST be the same v4-shaped base the namespace was registered with:
        // the dirty check compares scope.get() against mergeResolved(entry).
        entry: settingsBase,
        onError: warn,
      }))
      .then((outcome) => {
        if (outcome === 'imported') {
          warn('dsh-kimi-tide: sidecar 已迁移至设置命名空间 kimi-tide-router（原文件留档 .legacy-imported）')
        }
      })
      .catch((error) => warn(`dsh-kimi-tide: sidecar 迁移失败（${(error as Error).message}）`))
  })

  // Quota polling lifecycle.
  if (config.usagePollOnStart !== false) monitor.start()
  ctx.effect(() => () => monitor.stop())
  ctx.effect(() => () => disposeRouter?.())
}
