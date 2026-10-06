/**
 * dsh-kimi-tide — 月汐
 *
 * Kimi Code (Moonshot) subscription as a native DeepSeek Harness LLM
 * provider, plus the 月汐 dock panel: official quota display, the 0.4.x
 * kimi 二态接入指示, and the rule-driven router (preset/rule/keyword-
 * group → RouteDecision with via) with provider-agnostic candidate
 * enumeration and sidecar/settings persistence. 0.6.0 协作编排：设置命名
 * 空间升 v5（flows 注册表 + imageFallback），规则目标可引用协作流。
 */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, Message, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { KNOWN_SESSION_EVENT_TYPES as KNOWN_SESSION_EVENT_TYPES_DIRECT } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { copyFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
// Config schema 必须用 **scoped** 的 @deepseek-ai/schemastery：`.volatile()` 标记是
// 3.18.1 起才有的 API（未加 scope 的 `schemastery` 在 npm 上停在 3.18.0，无此方法），
// 而宿主判定「哪些字段可实时更新」读的正是 schema 实例上的 `meta.volatile`
// （dsh-settings/lib/index.js:122-131 volatileForm）。其余 schema（routerConfigSchema
// 等校验/迁移面）继续用未加 scope 的 3.18.0 —— 两者 API 同源、行为一致。
import Schema from '@deepseek-ai/schemastery'
import YAML from 'yaml'
import { REVISE_UNMOUNTED_MESSAGE, REVIEW_UNMOUNTED_MESSAGE, registerKimiTideCommands, type SettingsNamespacePort } from './commands.js'
import { claimedReviewGroups } from './rules.js'
import { coerceRouterConfigV6, hasKimiTideResidueV6 } from './migrate.js'
import { KIMI_TIDE_PANEL_EVENT, KIMI_TIDE_REVIEW_EVENT, KIMI_TIDE_REVISE_EVENT, kimiReviewProjectionDefinition, kimiReviseProjectionDefinition, kimiTideProjectionDefinition } from './projection.js'
import {
  createStreamVisionCaller,
  extractResolvedImages,
  installRouter,
  KimiRouter,
  type RouteDecision,
  type RouterConfigAny,
  type RouterLog,
} from './router.js'
import { ImageStateStore } from './image-state.js'
import { DispatchLedger } from './dispatch-ledger.js'
import { Transcriber } from './transcribe.js'
import { configKey, DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, isFlowTarget, type CandidateMeta, type RoleEntry, type RouteTarget, type RouterConfigV5Plus } from './config.js'
import { routerConfigSchema } from './settings-schema.js'
import { createSettingsPort, hasActivePreset, hasExplicitV5Config, isLegacyRouterShape, onRouterConfigChanged, rawRouterConfig, readRouterConfig } from './settings-port.js'
import { RouterSidecarStore } from './sidecar.js'
import { RouterSettingsStore, type RouterConfig } from './settings.js'
import { UsageMonitor, QUOTA_SOURCE_PROVIDER } from './usage.js'
import { buildQuotaSources, providerKeyCandidates } from './quota-sources.js'
import { HitConfirmGate } from './hit-confirm.js'
import type { CandidateSummary, ConfigSource, DecisionSummary, KimiAccessStatus, KimiTidePanelProjection, QuotaLike, QuotaSourceMeta, QuotaSourceState } from './types.js'
import { buildEffortCatalog, buildMountedModels } from './effort-catalog.js'
import { installTeamSkill, type SkillsLike, type TeamSkillHandle } from './team-skill.js'

export const name = 'dsh-kimi-tide'

export const inject = ['llm', 'timer', 'commands', 'sessionProjections']

/**
 * 本插件的配置形状（0.1.7 起：这就是「设置页里那条 profile entry」的表单来源）。
 *
 * `router` 是路由配置本体（v5 全量：预设/规则/协作流/keywordGroups/auxTargets），
 * 标 `.volatile()` 有两个作用：① 表单只展示 volatile 字段（宿主
 * `dsh-settings/lib/index.js:415-420` 的 volatileForm 闸），② 提交这类字段只做
 * 实时更新、不重载插件实例（loader/volatile-update）。非 volatile 的四个 tunables
 * 改动会走正常重载生命周期（与旧 Config interface 行为一致）。
 *
 * 形状直接复用 `routerConfigSchema`（settings-schema.ts 的单一真相源，默认值从
 * DEFAULT_CONFIG_V5 派生），不另抄一份——避免 schema 与类型漂移。
 */
export const Config = Schema.object({
  /**
   * 路由配置（v5 全量：预设/规则/协作流/keywordGroups/auxTargets），标 `.volatile()`。
   *
   * ⚠ 实测记录（0.1.7 + schemastery 3.18.4，2026-09-28）：条目**未配置** router 时，
   * 宿主解析出的 `activePreset` 是 `undefined`（不是 schema 声明的 null）——读取端
   * 一律按「!== string 即视为不路由」判定，与旧 sidecar 链的 null 等价。
   */
  router: routerConfigSchema.volatile(),
  /**
   * effort 档位表（'provider/model' → 该模型支持的推理档位 id 列表）。**运行面数据**：
   * 由候选枚举产物写入（buildEffortCatalog），不是用户配置——放在这里是因为
   * 0.1.7 取消了「插件自命名设置命名空间」这条推送通道（旧 `kimi-tide-catalog`），
   * 客户端要读它只能经本条目自身的 describe。标 volatile 的理由：① 表单只展示
   * volatile 字段，故它才会出现在 describe 结果里；② 提交 volatile 字段不重载
   * 插件实例（普通字段会），而这份数据随模型清单变化、刷新频繁。
   */
  efforts: Schema.dict(Schema.array(Schema.string())).volatile(),
  /** 真实挂载表（'provider/model' 键列表）：试一句 reviewer 不可用判定的真相源。 */
  mounted: Schema.array(Schema.string()).volatile(),
  /** Quota poll period in milliseconds (default 60000). */
  usagePollMs: Schema.number(),
  /** 余额源轮询周期（默认 300000 = 5min）。 */
  balancePollMs: Schema.number(),
  /** Poll quota immediately on startup (default true). */
  usagePollOnStart: Schema.boolean(),
  /** Patch file holding the legacy static router seed (default $DSH_HOME/profiles/web/cordis.patch.yml). */
  patchFile: Schema.string(),
  /** Sidecar router store file (default: kimi-tide-router.yml next to the patch file). */
  sidecarFile: Schema.string(),
})

/** User-settings namespace owning RouterConfigV5 (dsh-settings). */
export const SETTINGS_NAMESPACE = 'kimi-tide-router'

export interface Config {
  /** Quota poll period in milliseconds (default 60000). */
  usagePollMs?: number
  /**
   * 余额源轮询周期（默认 300000 = 5min）。余额接口是计费端点，60s×1440 次/天偏激进；
   * 余额变化频率也远低于用量窗。
   */
  balancePollMs?: number
  /** Poll quota immediately on startup (default true). */
  usagePollOnStart?: boolean
  /**
   * Router config composition seed. The entry still speaks the legacy v1
   * vocabulary (mode/primary/premium) — it is migrated through the
   * coerceRouterConfigV5 chain into the v5 preset/rule/flows shape
   * (namespace base layer; the sidecar fallback chain stays v4).
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
 * truncated to 120 characters. Flow decisions (0.6.0, Task 9 接线) surface
 * with `flow:{flowId}` semantics — chosen = { provider: 'flow', model: flowId }.
 * Pure — no agent/ctx access.
 *
 * v1.3.0 例外（可观测性补链）：带**语义闸注解**（`confirmNote`）的打底决策要上报。
 * 判否 ⇒ 被否规则过滤出路由链 ⇒ 最终必然落打底，若沿用「打底不上报」，那么
 * 「判否」这个最需要被看见的结果反而完全不可见——A7 实机失效正是被这一点掩盖的。
 * 无注解的打底仍不上报（既有语义逐字节不变）。
 */
export function buildDecisionSummary(decision: RouteDecision): DecisionSummary | null {
  if (decision.kind === 'flow') {
    return { chosen: { provider: 'flow', model: decision.flowId }, reason: decision.reason.slice(0, 120) }
  }
  if (decision.kind !== 'route') return null
  if (decision.via === 'default' && decision.confirmNote === undefined) return null
  return { chosen: { provider: decision.target.provider, model: decision.target.model }, reason: decision.reason.slice(0, 120) }
}

/** The llm runtime surface the candidate enumeration consumes (rc.6 shapes). */
interface LlmCatalog {
  listProviders: () => LlmProviderInfo[]
  listModels: (provider: string) => Promise<LlmModelInfo[]>
  resolveModelInfo: (provider: string, model: string, signal?: AbortSignal) => Promise<LlmResolvedModelInfo>
}

/**
 * 面板推送的语义签名（评审修复 2026-08-23）：剔除逐次必变的 quota.fetchedAt
 * 后序列化。配额轮询每 60s 必产生新 fetchedAt——若按全量比对，每个存活会话
 * 的持久化日志每分钟必追加一条 kimi-tide/panel 事件，而投影 fold 只取最新，
 * 追加量与信息量完全不成比例。签名相同 = 无新信息 = 不追加。纯函数。
 */
export function panelSignature(snapshot: KimiTidePanelProjection): string {
  const quota = snapshot.quota
  const quotaValues = quota === null
    ? null
    : (() => { const { fetchedAt, ...values } = quota; return values })()
  return JSON.stringify({ ...snapshot, quota: quotaValues })
}

/** 所有预设 default + 所有规则 target 的并集（去重，preset 序内 default→rules 序）。 */
function configuredTargets(config: RouterConfigAny): RouteTarget[] {
  const out: RouteTarget[] = []
  const seen = new Set<string>()
  for (const preset of Object.values(config.presets)) {
    for (const t of [preset.default, ...preset.rules.map((r) => r.target)]) {
      if (isFlowTarget(t)) continue   // 协作流引用不参与候选枚举（Task 8 决策扩展）
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
  config: RouterConfigAny,
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
function fallbackCandidateMetas(config: RouterConfigAny): CandidateMeta[] {
  return configuredTargets(config).map((target) => ({
    ...target,
    modalities: ['text'],
    available: true,
  }))
}

/**
 * Register every session event type this plugin has EVER written on the
 * INSTALLATION's KNOWN_SESSION_EVENT_TYPES Set — the only door for a custom
 * event type, because the strict session-log reader (dsh-session-persistence
 * `validateStoredEvents`) refuses types outside that catalog unless the
 * envelope carries `ignorable: true`, and `Session.append` cannot set that
 * marker (it forwards only `surfaceOp` / `sourceEventSeqs`). The catalog is a
 * live mutable Set on the dsh-session module instance the harness itself uses;
 * a `link:`-installed plugin's bare import resolves its workspace node_modules
 * copy instead (a different Set), so we anchor a require in the flat profile
 * module fallback (`$DSH_HOME/profiles/node_modules`). Resolution from there
 * lands on the SAME real module the harness checks, so the mutation makes
 * stored events readable after a restart. Falls back to the directly imported
 * copy when no installation fallback exists (e.g. unit tests).
 *
 * 清单 = 两个类型，且**注册 ≠ 继续写**：
 * - `kimi-tide/panel`：v1.2.0 起已停止写入（全库 120,705 条 / 203.7 MB，占会话
 *   事件体积 27.9%，是 09-10 格式迁移整卷拒载的主因；面板数据改由
 *   `/kimi-tide panel --json` 命令通道按需供给）。但**历史日志仍然带着它**
 *   （实测单会话 147 条、首条 seq 3），而目录里没有该类型 → 那些会话重启后
 *   整卷拒载。2026-09-10 实机事故：注册清单收缩为单类型的那一版一重启，所有
 *   旧会话报「历史加载失败：… unknown to this harness and not marked
 *   ignorable」（gateway/internal）。注册它是**只读兼容**，与是否继续写事件
 *   无关；面板投影 fold 也仍然认这个类型（on-demand 取数失败时的回退源）。
 * - `kimi-tide/review`：仍在写入——12 条 / 9 天、承载评审正文，且是评审卡唯一
 *   的锚点载体（chat 节点必须匹配会话事件）；注册是它的写入前提。
 *
 * 修复依据：`docs/superpowers/specs/2026-09-02-review-flow-design.md` §事件
 * （注册清单由单类型扩展为 **panel + review 两类型**，评审修复 L4）。
 *
 * @returns true when the host (installation) catalog was reached; false when
 * only the locally resolved copy was mutated — the caller MUST then refuse to
 * write review events (a log this harness cannot read is worse than a dropped
 * record; that refusal is the fix for the 09-10 failure mode, where an
 * unreachable catalog was written to anyway). Legacy `kimi-tide/panel` logs
 * stay unreadable in that case, which the caller reports as a warning.
 */
function registerSessionEventTypes(): boolean {
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
  known.add(KIMI_TIDE_REVIEW_EVENT)
  // v1.4.0 评审闭环：退回留痕同样是「本插件写过的事件」——写之前必须先进目录，
  // 否则会话日志一重启就整卷拒读（09-10 故障模式的同款预防）。
  known.add(KIMI_TIDE_REVISE_EVENT)
  return hostReached
}

/** ctx.get('skills') 探测形状（acceptance-fix-1）：只看 register 这一个面。 */
type SkillsProbe = { register?: SkillsLike['register'] }

/**
 * skills 服务探测（acceptance-fix-1）：**必须经 `ctx.get('skills')` 读取**。
 *
 * cordis 的数组形 `inject` 是**必需依赖**声明，而本插件的 inject 只有
 * llm/timer/commands/sessionProjections —— 对未声明 inject 的服务，上下文
 * 代理的**属性访问直接抛错**（`cordis/lib/index.js:676` ——
 * `cannot get property "skills" without inject`）。旧写法
 * `try { ctx.skills } catch { return undefined }` 把那次抛错静默吞成 undefined，
 * 导致分工表 skill 在生产宿主**永不注册**（实机验收 A4）。`ctx.get(name)` 是
 * cordis 给的无 inject 要求读法（reflect.d.ts:6-16，缺席返回 undefined），
 * 本文件读 configEditor/connection/agents 已是同款先例。
 *
 * ⚠ 绝不能把 skills 加进 inject 数组：那会变必需依赖，未挂 dsh-skill 的
 * profile 将直接加载不了本插件（设计稿 §4 明确要避免）。
 * 保留 try/catch 兜底（get 自身抛错也不冒泡）与 typeof 形状校验。
 */
export function probeSkills(ctx: unknown): SkillsLike | undefined {
  try {
    const skills = (ctx as { get?: (name: string) => unknown }).get?.('skills') as SkillsProbe | undefined
    return typeof skills?.register === 'function' ? (skills as SkillsLike) : undefined
  } catch {
    return undefined
  }
}

/** ctx.get('agentTeams') 探测形状（v2.0.0 Task 4）：只看 tryMembership 这一个面。 */
type AgentTeamsProbe = { tryMembership?: (agent: Agent) => { role: string; name: string } | undefined }

/**
 * agentTeams 服务探测（acceptance-fix-1，与 probeSkills 同款范式）：经
 * `ctx.get('agentTeams')` 读取 —— 旧的属性访问形态在 cordis 代理下必抛，被
 * try/catch 静默吞成 undefined，导致认领队友的 role 改道在生产宿主**永不生效**
 * （实机验收 A2/A8）。agentTeams 同样**不得**进 inject 数组（未启用 Agent Teams
 * 组合包的 profile 必须能加载本插件）。
 */
export function probeAgentTeams(ctx: unknown): AgentTeamsProbe | undefined {
  try {
    const teams = (ctx as { get?: (name: string) => unknown }).get?.('agentTeams') as AgentTeamsProbe | undefined
    return typeof teams?.tryMembership === 'function' ? teams : undefined
  } catch {
    return undefined
  }
}

export function apply(ctx: Context, config: Config = {}) {
  // The shipped cordis.patch.yml documents every knob as a comment, so a
  // profile applying that layer as-is composes `config: null` (YAML null) —
  // and the `= {}` default only catches `undefined`. Null then flows through
  // and the first property read (config.usagePollMs) throws, killing the
  // loader entry and with it the whole plugin tree (live incident on DSH
  // desktop 4.0.1, 2026-08-21).
  config = config ?? {}
  const log: RouterLog = { info: (message: string) => { ctx.logger.info(message) } }
  const warn = (message: string) => { ctx.logger?.warn?.(message) }

  // ctx.get('skills') 探测并缓存（acceptance-fix-1：经 ctx.get，cordis 代理下属性
  // 访问必抛——旧写法因此被静默吞成 undefined，见 probeSkills 注释）：未挂 dsh-skill
  // 时整链降级为不注入分工表 skill，绝不在热路径复探。let：applyConfig 会重探测
  // （晚挂载兜底，见 refreshHostServices）。
  let skillsService = probeSkills(ctx)
  // ctx.get('agentTeams') 探测并缓存（同款范式，v2.0.0 Task 4）：宿主未挂团队服务时
  // teamLookup 为 undefined ⇒ pre-step 的 role 分支自然不命中，行为与主会话同形。
  let agentTeams = probeAgentTeams(ctx)

  /**
   * 宿主服务重探测（acceptance-fix-1 晚挂载兜底）：cordis 组合包按 profile 装配，
   * skills/agentTeams 可能在本插件 apply 之后才挂载。applyConfig 是插件的常态
   * 重入点（attach / volatile 提交 / 命令保存，同值保存也会走到），在那里以
   * 可忽略的成本重探一次；服务出现/消失/换实例 ⇒ 返回 true，由调用方重挂
   * 路由器与分工表 skill。择此而非「服务出现后重挂」：cordis 没有面向插件的
   * 「服务出现」通用订阅面，重探测零订阅成本且与既有重挂路径完全同构。
   */
  const refreshHostServices = (): boolean => {
    const nextSkills = probeSkills(ctx)
    const nextTeams = probeAgentTeams(ctx)
    const changed = nextSkills !== skillsService || nextTeams !== agentTeams
    skillsService = nextSkills
    agentTeams = nextTeams
    return changed
  }

  // The strict persistence reader refuses logs with unknown event types — for
  // READING history (legacy `kimi-tide/panel`) as well as for what we append
  // (`kimi-tide/review`). The catalog Set lives on the INSTALLATION's
  // dsh-session module instance; register BOTH types there (see
  // registerSessionEventTypes). The returned flag only gates WRITING review
  // events: catalog unreachable → no review events at all (fail closed).
  // Refusing is strictly better than appending a log this harness cannot read.
  let reviewEventWritable = registerSessionEventTypes()
  if (reviewEventWritable) {
    ctx.logger.info('dsh-kimi-tide: panel/review 事件类型已注册到宿主会话目录（面板数据走命令通道；注册保住历史 kimi-tide/panel 日志可读）')
  } else {
    ctx.logger.warn('dsh-kimi-tide: 宿主会话目录不可达——评审事件将不写入会话日志（拒绝产出宿主读不出的日志），且带历史 kimi-tide/panel 事件的会话可能拒绝加载；面板不受影响（命令通道）')
  }

  // 0.4.x：零接入层——Kimi 模型经 settings.yaml 的 llm-pi-ai.providers.kimi-coding
  // 路由（官方 Models 页维护）进 DSH LLM 注册表。本插件只负责读该路由的
  // apiKeyEnv 引用名并解析 key（配额轮询用），永不触碰密钥本体。
  // 多 plan 配额（2026-08-29 用户裁定）：解析器按 provider 泛化——每个 pi-ai
  // code plan 一个配额监控源。
  /**
   * 读 `~/.dsh/settings.yaml` 的一个顶层节（v1.3.0 实机验收修复）。
   *
   * 为什么必须读文件：`settings.get(ns)` 只查**已注册**的命名空间（dsh-settings 的
   * 实现是 `registrations.get(ns)?.resolved`），而 `dsh-llm-pi-ai` 与
   * `dsh-llm-deepseek` **都不注册**命名空间 ⇒ 该调用恒为 undefined，旧实现于是永远
   * 落到内置 fallback 名。实机后果：`ZAI_API_KEY` / `KIMI_API_KEY` 在凭据库里根本
   * 不存在（真实名带 provider 前缀）⇒ 这两个 provider 的配额槽永远空白，dock 上
   * 「切到 GLM 就没有配额」；只有 `DEEPSEEK_API_KEY` 恰好同名才正常。
   *
   * 容错：文件缺失 / 坏 YAML / 形状不对一律返回 undefined（配额是可选面，绝不因此报错）。
   */
  const settingsFileSection = (ns: string): unknown => {
    try {
      const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
      const text = readFileSync(join(home, 'settings.yaml'), 'utf8')
      const parsed = YAML.parse(text) as Record<string, unknown> | null
      return parsed === null ? undefined : parsed?.[ns]
    } catch { return undefined }
  }
  const serviceSection = (ns: string): unknown => {
    const settings = ctx.get('settings') as { get?: (ns: unknown) => unknown } | undefined
    return settings?.get?.(ns)
  }
  /** provider 的 ref 名候选链：settings 服务 → settings.yaml 文件 → 内置兼容名。 */
  const providerApiKeyEnvs = (providerId: string, fallbacks: readonly string[]): readonly string[] =>
    providerKeyCandidates(providerId, fallbacks, serviceSection('llm-pi-ai'), settingsFileSection('llm-pi-ai'))
  /** 解析 provider 的 key：依次试候选 ref 名，命中即止（凭据服务 → 进程环境）。 */
  const resolveProviderKey = (providerId: string, fallbacks: readonly string[]): (() => Promise<string | null>) => {
    return async (): Promise<string | null> => {
      for (const ref of providerApiKeyEnvs(providerId, fallbacks)) {
        const credentials = ctx.get('credentials') as { resolve?: (r: string) => Promise<{ value: string } | undefined> } | undefined
        if (typeof credentials?.resolve === 'function') {
          try {
            const resolved = await credentials.resolve(ref)
            if (resolved !== undefined && resolved.value.length > 0) return resolved.value
          } catch { /* 落到 env 兜底 */ }
        }
        const fromEnv = process.env[ref]
        if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
      }
      return null
    }
  }
  const resolveKey = resolveProviderKey('kimi-coding', ['KIMI_CODING_API_KEY', 'KIMI_API_KEY'])
  const resolveZaiKey = resolveProviderKey('zai-coding-cn', ['ZAI_CODING_CN_API_KEY', 'ZAI_API_KEY'])

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
    // v1.2.0：二态变化无需推送——面板由命令通道按需现算（见 rememberPanel）。
    if (route !== kimiStatus.route || key !== kimiStatus.key) kimiStatus = { route, key }
  }
  void refreshKimiStatus()

  // Panel data source：配额/余额源注册表（用量/余额 spec v2 §4）——四源，新源只需在
  // quota-sources.ts 加一项；无 API 面的源（qwen）不建 monitor，直接以 no-api 呈现。
  const quotaSources = buildQuotaSources({
    providerApiKeyEnvs,
    // deepseek 节同样要回落文件：apiKeyEnv 可能被用户改名，baseURL 也可能只写在
    // settings.yaml 里（settings 服务对未注册命名空间恒 undefined，见上）。
    deepseekSection: () => {
      const pick = (section: unknown): { apiKeyEnv?: string; baseURL?: string } | undefined =>
        section as { apiKeyEnv?: string; baseURL?: string } | undefined
      return pick(serviceSection('llm-deepseek')) ?? pick(settingsFileSection('llm-deepseek'))
    },
    resolveCredential: async (ref) => {
      const credentials = ctx.get('credentials') as { resolve?: (r: string) => Promise<{ value: string } | undefined> } | undefined
      if (typeof credentials?.resolve === 'function') {
        try {
          const resolved = await credentials.resolve(ref)
          if (resolved !== undefined && resolved.value.length > 0) return resolved.value
        } catch { /* 落到 env 兜底 */ }
      }
      const fromEnv = process.env[ref]
      return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : null
    },
    env: process.env,
    usagePollMs: config.usagePollMs ?? 60_000,
    balancePollMs: config.balancePollMs ?? 300_000,
  })
  const quotaMonitors = quotaSources.map((source) => ({
    source,
    monitor: source.url === null || source.parse === null
      ? null
      : new UsageMonitor({
        pollMs: source.pollMs,
        onUpdate: () => { void refreshKimiStatus() },
        resolveKey: source.resolveKey,
        url: source.url,
        parse: source.parse,
        ...(source.timeoutMs === undefined ? {} : { timeoutMs: source.timeoutMs }),
      }),
  }))
  /** 立即重取全部源（凭据落盘/命令 refresh 共用）。 */
  const refreshAllQuotas = async (): Promise<void> => {
    await Promise.all(quotaMonitors.map(({ monitor }) => monitor?.refresh() ?? Promise.resolve()))
  }
  /** 源状态（S1 三态的事实来源）。 */
  const quotaSourceMetas = (): QuotaSourceMeta[] => quotaMonitors.map(({ source, monitor }) => {
    const snap = monitor?.snapshot()
    const state: QuotaSourceState = source.url === null
      ? 'no-api'
      : snap === undefined || snap.quota === null
        ? (snap?.outcome === 'no-key' ? 'no-credential' : 'failed')
        : 'ok'
    const meta: QuotaSourceMeta = { provider: source.provider, kind: source.kind, state }
    if (state === 'no-api') {
      if (source.unavailableReason !== undefined) meta.reason = source.unavailableReason
    } else if (state === 'no-credential') meta.reason = 'key 未配置'
    else if (state === 'failed') meta.reason = snap?.outcome === 'pending' ? '尚未取数' : '取数失败'
    return meta
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
   * Composition seed.
   *
   * 0.1.7（2026-09-28）：`config.router` 现在是本条目 Config 的 **volatile 快照**。
   * 取「原始值优先、快照兜底」两级（rawRouterConfig）：残留判定必须看原始词汇
   * （v1 的 mode/primary/premium 会在解析期被 schema 补成 version:6，解析后再判就
   * 永远认不出存量）；无 router 段时退回 patch 静态块（v1 词汇），只为存量迁移路径保留。
   */
  const rawRouter = rawRouterConfig(config, (ctx as unknown as { fiber?: { entry?: { options?: { config?: unknown } } } }).fiber?.entry?.options?.config)
  // 启动种子（决定是否走 coerce 迁移链）：仅当原始配置**是旧词汇形态**（v1~v4）时
  // 用它——那种形态在 schema 解析期会被补成 version:6，解析后就认不出来了。
  // 其余情形（v5+ 形态、或条目未配置）一律用宿主解析值，避免把 v5+ 用户配置再搬一遍。
  const legacySeed = isLegacyRouterShape(rawRouter)
  const seedRaw: unknown = legacySeed
    ? rawRouter
    : (() => { try { return store.load() } catch { return null } })()
  const sidecar = new RouterSidecarStore({
    file: sidecarFile,
    patchFallback: () => seedRaw,
    onError: warn,
  })
  const loaded = sidecar.load()
  // sidecar 链路终态恒为 v4（sidecar 是 v4-only 存储，行为逐字节保持）；
  // 命名空间链路（attach 时 applyConfig 喂入）恒为 v6。内存形态 = RouterConfigAny。
  let routerConfig: RouterConfigAny = loaded.config ?? DEFAULT_CONFIG_V4()
  let configSource: ConfigSource =
    loaded.source === 'sidecar' ? 'sidecar' : loaded.source === 'patch' ? 'patch' : 'default'
  /**
   * 设置通道与 sidecar 共用的「条目已解析值」基线。
   *
   * 0.1.7 起由宿主解析（schema 默认 + 组合 base + 用户层），插件不再手工合并；
   * 残留迁移链以 rawRouter 为准（见 rawRouterConfig 头注）。
   */
  const settingsBase: RouterConfigV5Plus = readRouterConfig(config)

  // Candidate pool: mounted immediately with config-derived fallback metas,
  // then replaced by the enumerated pool once the llm catalog settles;
  // llm/adapters-updated (declared by dsh-llm, payload-free) re-enumerates.
  let candidateMetas: CandidateMeta[] = fallbackCandidateMetas(routerConfig)
  // 0.8.0 effort 档位目录：随候选枚举刷新。**0.1.7 换道（2026-09-28）**：不再推
  // 「kimi-tide-catalog」设置命名空间（`settings.register` 已随 0.1.7 移除），改为写
  // 本条目 Config 的两个 volatile 字段（efforts / mounted，见 export const Config）——
  // 客户端用读路由配置的**同一次** settings.describe 就能拿到，少一次 RPC，也不再
  // 往任何"设置文件"里塞运行面数据。（历史：0.8.0 走 typert $mount，实机证伪后改
  // 自有命名空间；该命名空间在 0.1.7 无对应物。）
  let effortCatalog: Record<string, string[]> = buildEffortCatalog(candidateMetas)
  // 1.1.0 A8（2026-09-04）：真实挂载表同节发布——试一句 reviewer 不可用判定的唯一
  // 真相源（availability 三态对自挂 provider 盲）。
  let mountedModels: string[] = buildMountedModels(candidateMetas)
  let enumerationSeq = 0
  // 设置通道就绪后由下方赋值；枚举刷新触发一次同步。写前做内容脏检查：只有模型清单
  // 真变化才落盘（volatile 提交虽不重载插件，仍是一次 profile patch 写）。
  let syncCatalog: (() => void) | null = null
  let lastSyncedCatalog = ''
  const refreshCandidates = () => {
    const seq = ++enumerationSeq
    void enumerateCandidates(ctx.llm as unknown as LlmCatalog, routerConfig, warn)
      .then((metas) => {
        if (seq !== enumerationSeq) return
        candidateMetas = metas
        effortCatalog = buildEffortCatalog(metas)
        mountedModels = buildMountedModels(metas)
        syncCatalog?.()
        mountRouter()
      })
      .catch((error) => warn(`dsh-kimi-tide: candidate enumeration failed: ${(error as Error).message}`))
  }

  let disposeRouter: (() => void) | null = null

  /**
   * 分工表 skill 句柄（插件级状态，与 imageStates 同款范式）：配置变更时先 dispose
   * 旧的、再按新 roles 重挂；roles 为空 / skills 服务缺席 / 宿主拒绝注册 ⇒ 不安装。
   */
  let teamSkill: TeamSkillHandle | null = null
  /**
   * 重挂分工表 skill（控制器裁决 R3）：门控 = roles 非空 **且** 路由处于开启态。
   * 判据用 hasActivePreset（settings-port.ts 注释明确它是「路由开/关」的唯一正确
   * 判据——宿主对未配置条目解析出 undefined 而非 null，裸 `!== null` 会误判）。
   * 路由关闭 = 逃生舱：先 dispose 掉已注册的 skill（目录不留残影），随后不注册、
   * 不报错、不提示——行为回到原生直通，不向上下文注入任何分工表内容。
   */
  const remountTeamSkill = () => {
    teamSkill?.dispose()
    teamSkill = hasActivePreset(routerConfig)
      ? installTeamSkill(skillsService, rolesOf(routerConfig), log)
      : null
  }
  /**
   * 读分工表（控制器裁决 R2）：只认 roles 字段本身（`?? {}` 兜底），**不以
   * `config.version === 6` 门控** —— 线上 profile patch 与存量配置文档常显式写
   * `version: 5`，而 schema 的 version 默认值只在字段缺失时生效；版本号门控会让
   * 用户在设置页写入的分工表静默失效。
   */
  const rolesOf = (router: RouterConfigAny): Record<string, RoleEntry> =>
    (router as { roles?: Record<string, RoleEntry> }).roles ?? {}

  // 0.6.0 协作编排（Task 9 最小接线）：按图状态表 + 转述器随 apply 生命周期
  // 创建一次——配置变更/候选枚举重挂路由器时，转述缓存与图像状态不丢。生产
  // VisionCaller = ctx.llm.stream 直调；0.8.0（D3/M6）：visionModel.effort 经
  // metas 支持集判定后显式下发，不支持/未配置不携带（Ruling 2 默认语义保持）。
  // candidateMetas 是 let——闭包读最新枚举值。
  const imageStates = new ImageStateStore()
  /**
   * 派发台账（v2.0.0 Task 5，设计稿 D7）：插件级状态，与 imageStates 同款范式——
   * 配置变更/候选枚举重挂路由器时不丢；不落盘、不跨宿主重启；条目只存字符串 id。
   */
  const dispatchLedger = new DispatchLedger()
  const resolveEfforts = (target: RouteTarget): string[] | undefined =>
    candidateMetas.find((m) => m.provider === target.provider && m.model === target.model)?.reasoningEfforts
  const transcriber = new Transcriber({
    caller: createStreamVisionCaller(ctx, resolveEfforts),
    log: (message) => { ctx.logger.info(message) },
  })
  /**
   * v1.3.0 语义命中确认闸的判官调用：ctx.llm.stream 直调（与转述/评审同款 aux 通道）。
   * 判官目标由 pre-step 逐次传入（= 当前预设的 default）；**任何失败/中止都返回 null**
   * ⇒ 闸门 fail-open（不过闸），语义层永不制造比现状更坏的结果。
   */
  const confirmGate = new HitConfirmGate({
    call: async ({ input, judge, maxTokens, judgeEffort, signal }) => {
      try {
        const options: GenerateOptions = {
          provider: judge.provider,
          model: judge.model,
          maxTokens,
          messages: [{ role: 'user', content: [{ type: 'text', text: input }] }] as unknown as Message[],
          // v1.3.0 A7 定向修复：钉住判官的推理档位（支持集判定后的 'off'）。
          // 判官是推理模型，而本闸只给 64 token——不钉档位时 reasoning 会把预算
          // 吃光、正文恒为空 ⇒ 判词恒不可解析 ⇒ 闸门静默 fail-open（实机实证：
          // completion_tokens 全部计入 reasoning、finish_reason=length）。适配器把
          // 'off' 映射为 thinking 关闭，正是本处所需；不支持 off 的目标不会走到这里
          // （hit-confirm 的 judgeEffortFor 已过支持集判定）。
          ...(judgeEffort === undefined ? {} : { reasoningEffort: judgeEffort as ReasoningEffortId }),
          ...(signal === undefined ? {} : { signal }),
        }
        let text = ''
        for await (const chunk of ctx.llm.stream(options)) {
          if (chunk.type === 'text-delta') text += chunk.text
          else if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) return null
        }
        return text
      } catch {
        return null
      }
    },
    log: (message) => { ctx.logger.info(message) },
  })
  // 1.1.0 §8：手动评审实现登记（installRouter install 传 fn / dispose 传 null；
  // apply 作用域存最新 fn，Task 6 的 /kimi-tide review 命令消费）。
  let manualReviewFn: ((agent: Agent) => Promise<{ ok: boolean; message: string }>) | null = null
  // v1.4.0 §3.1：手动退回实现登记（与 manualReviewFn 同款「apply 作用域存最新 fn」）。
  let manualReviseFn: ((agent: Agent) => Promise<{ ok: boolean; message: string }>) | null = null
  const mountRouter = () => {
    disposeRouter?.()
    disposeRouter = null
    if (hasActivePreset(routerConfig)) {
      disposeRouter = installRouter(ctx, new KimiRouter(routerConfig, candidateMetas, log), {
        images: imageStates,
        transcriber,
        resolveImages: extractResolvedImages,
        onDecision,
        onReviewEvent: (agent, event) => {
          // spec §7 dock 行：评审执行完成记一条流事件（lastFlowEvent 同款通道，
          // ≤120 截断与 onDecision 惯例一致）。v1.2.0：仅存内存，面板按需现读。
          latestFlowEvents.set(agent, `review:${event.flowId} ${event.ok ? 'ok' : '失败'} · ${event.reviewer.model}`.slice(0, 120))
        },
        // v1.2.0 闸：宿主目录未命中 → 拒绝写评审事件（见 registerSessionEventTypes）。
        reviewEventWritable,
        onManualReview: (fn) => { manualReviewFn = fn },
        onManualRevise: (fn) => { manualReviseFn = fn },
        onReviewRevise: (agent, event) => {
          // v1.4.0 §3.6 dock 行：退回留痕（与评审完成行同款通道、同款 ≤120 截断）。
          const what = event.stopped === 'limit'
            ? `退回已停（达上限）· 第 ${event.reviseIndex} 次`
            : `退回重做（${event.reason === 'manual' ? '手动' : '自动'}）· 第 ${event.reviseIndex} 次`
          latestFlowEvents.set(agent, `revise:${event.flowId} ${what}`.slice(0, 120))
        },
        // v1.3.0 语义命中确认闸：判官 = **本预设的 default**，走 ctx.llm.stream 直调
        // （不经 decide，无 purpose、纯文本无图块 → 不触发任何既有改写）。
        hitConfirm: confirmGate,
        // v2.0.0（Task 4）：队友身份查询注入——agentTeams 服务缺席即 undefined，
        // pre-step 的 role 分支自然不命中（逐字节回到无分工表行为）。
        // 快照到局部常量：let 重探测（refreshHostServices）下闭包无法窄化，且本次
        // 挂载必须钉死挂载时刻的服务实例。
        teamLookup: (() => {
          const teams = agentTeams
          return teams === undefined ? undefined : (agent: Agent) => teams.tryMembership?.(agent)
        })(),
        // v2.0.0（Task 5）：派发台账记账注入——请求层仅在子代理轮（槽位带
        // dispatch 元信息）回调；台账本体插件级，重挂路由器不丢。
        onDispatch: (_agent, entry) => dispatchLedger.record(entry),
      })
    }
  }

  // Decision observability (spec §2.7): only non-default route decisions
  // surface a summary; anything else (off / keep / default miss) clears the
  // summary so a stale decision never leaks into later snapshots.
  // 0.6.0：extra.flowId 标记本轮执行过的协作流——供给投影 v6 的
  // lastFlowEvent（≤120 截断，沿用 decision 摘要惯例）。
  // 评审修复 2026-08-23：决策与流事件按 agent 隔离存储——进程级单值会把
  // A 会话的路由决策串进 B 会话面板；onDecision 只推决策所属会话。
  const latestDecisions = new Map<Agent, DecisionSummary | null>()
  const latestFlowEvents = new Map<Agent, string>()
  const onDecision = (agent: Agent, decision: RouteDecision, extra?: { flowId?: string; flowDigest?: string }) => {
    latestDecisions.set(agent, buildDecisionSummary(decision))
    if (extra?.flowId !== undefined) {
      const target = decision.kind === 'route'
        ? `${decision.target.provider}/${decision.target.model}`
        : decision.kind === 'flow' ? `flow:${decision.flowId}` : 'keep'
      // 0.6.x池#a：携带转述成败摘要（ok/total + 败图 id + visionModel）。
      const digest = extra.flowDigest !== undefined ? `（${extra.flowDigest}）` : ''
      latestFlowEvents.set(agent, `flow:${extra.flowId} 执行 → ${target}${digest}`.slice(0, 120))
    }
  }

  // 0.8.0 B5 换道（2026-08-27）：原 typert remote 宿主半链（effortService
  // provide + EFFORT_CATALOG_CONTRIBUTION 注册）随通道证伪一并移除——档位表
  // 现经 kimi-tide-catalog 设置命名空间推送（inject 块内 syncCatalogNamespace）。

  mountRouter()
  // 启动初挂（裁决 R3）：路由关闭 ⇒ 不注册（静默）；roles 空 / skills 缺席 /
  // 注册失败的其余降级在 installTeamSkill 内部完成。
  remountTeamSkill()
  refreshCandidates()

  // Panel persistence + commands (client→host channel). Commands speak the
  // RouterConfigAny (v4/v5 双形) config shape and write the settings namespace
  // when one is attached, else the sidecar — never the v1 patch file (the
  // sidecar outranks it on load anyway).

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
   * flip alone (sidecar → settings at attach) still swaps the effective source
   * reported by the panel snapshot.
   */
  const applyConfig = (next: RouterConfigAny) => {
    // 宿主服务重探测（acceptance-fix-1 晚挂载兜底）：skills/agentTeams 可能在
    // apply 之后才挂上；服务出现/消失 ⇒ 与配置变更同款重挂（成本可忽略）。
    const servicesChanged = refreshHostServices()
    const source: ConfigSource = settingsScope !== null ? 'settings' : 'sidecar'
    const changed = !sameJson(routerConfig, next)
    if (!changed && configSource === source && !servicesChanged) return
    routerConfig = next
    configSource = source
    if (changed) {
      latestDecisions.clear()
      latestFlowEvents.clear()
      // 配置变更重挂分工表 skill（裁决 R3）：路由由开→关 ⇒ dispose 后不再注册。
      refreshCandidates()
    }
    if (changed || servicesChanged) {
      mountRouter()
      remountTeamSkill()
    }
  }

  registerKimiTideCommands(ctx, {
    sidecar,
    // 多 plan 配额（2026-08-29）：refresh 覆盖全部已配源。
    monitor: {
      refresh: refreshAllQuotas,
    },
    current: () => routerConfig,
    // A getter, not a snapshot: the settings service attaches asynchronously
    // (ctx.inject) and can detach, so the command layer must read the CURRENT
    // port — a value captured here would pin `null` and degrade every save to
    // the sidecar silently.
    get settings() { return settingsScope },
    onSaved: (next) => applyConfig(next),
    // 1.2.0 面板取数（dock 拉模型）：按 agent 现算快照——agent 缺席（漏传）返回
    // null，命令层据此报错而非给一份无主数据。
    panel: (agent) => (agent === undefined ? null : rememberPanel(agent)),
    // 1.1.0 §8：手动评审 = Task 5 挂载的 manualReviewFn（installRouter 随路由
    // 挂载/卸载，onManualReview 登记/置 null）。路由关闭（activePreset=null →
    // installRouter 未挂载）或宿主无评审流时 fn=null → 单源兜底文案。
    manualReview: (agent) => manualReviewFn?.(agent) ?? Promise.resolve({ ok: false, message: REVIEW_UNMOUNTED_MESSAGE }),
    // v1.4.0 §3.1：手动退回 = Task 2 挂载的 manualReviseFn（同款单源兜底文案）。
    manualRevise: (agent) => manualReviseFn?.(agent) ?? Promise.resolve({ ok: false, message: REVISE_UNMOUNTED_MESSAGE }),
    // show 认领行数据：getter——routerConfig 在 applyConfig 处整体替换（let 重绑），
    // getter 保证每次命令执行读实时配置而非注册时快照（与上方 settings getter 同款）。
    get claimedGroups() { return claimedReviewGroups(routerConfig) },
  })

  // Projection units stay registered for HISTORICAL sessions only: v1.2.0 起本
  // 插件不再写自定义会话事件（面板走命令通道），但 08-25 之前的老会话日志里
  // 仍有 kimi-tide/panel（120k 条）与 kimi-tide/review（12 条）事件——注册
  // 保留，读路径才能把它们折出来（panelSchema 的旧载荷容忍见 projection.ts）。
  ctx.sessionProjections.register(kimiTideProjectionDefinition)
  // R9（1.1.0 §7）：评审投影 unit 独立注册（与 panel 并列——L4 裁定不并入
  // panel；fold 每会话保留最近 20 条评审记录）。
  ctx.sessionProjections.register(kimiReviewProjectionDefinition)
  // v1.4.0 §3.6：退回留痕同款独立 unit（历史回看 + 对账）。
  ctx.sessionProjections.register(kimiReviseProjectionDefinition)
  // Dropdown model catalogs: both enumerated async from the llm service
  // (kimi-coding route + deepseek-official); refreshed when adapters change.
  let modelOptions: { kimi: string[]; deepseek: string[] } = { kimi: [], deepseek: [] }
  /** 取某 provider 的快照（legacy quota 字段与 quotaProvider 同源）。 */
  const quotaSnapshotOf = (provider: string): QuotaLike | null =>
    quotaMonitors.find(({ source }) => source.provider === provider)?.monitor?.snapshot().quota ?? null

  const panelSnapshot = (agent: Agent): KimiTidePanelProjection => {
    // 0.1.7：宿主对「未配置 router 的条目」解析出的 activePreset 是 **undefined**
    // （不是 schema 声明的 null）⇒ 归一化后再判，面板与命令层的「不路由」形态一致。
    const rawPreset = routerConfig.activePreset
    const activePreset = rawPreset === undefined ? null : rawPreset
    const preset = activePreset === null ? undefined : routerConfig.presets[activePreset]
    const snapshot: KimiTidePanelProjection = {
      quota: quotaSnapshotOf(QUOTA_SOURCE_PROVIDER),
      // 0.8.x⑨：配额来源标记（dock 按当前路由目标门控渲染限额区）。
      quotaProvider: QUOTA_SOURCE_PROVIDER,
      // 多 plan 配额（2026-08-29）：provider → 快照 | null（dock 按当前命中目标取）。
      quotas: Object.fromEntries(quotaMonitors.map(({ source, monitor }) => [source.provider, monitor?.snapshot().quota ?? null])),
      // S1（2026-09-15 v2）：数据与元数据分离——三态由 quotaSources 承载，客户端据此渲染
      // 「无 API 面 / 无凭据 / 取数失败」，不再从 null 猜。
      quotaSources: quotaSourceMetas(),
      kimi: kimiStatus,
      router: {
        activePreset,
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
      // 评审修复 2026-08-23：decision/lastFlowEvent/imageContext 均为按 agent 字段
      decision: latestDecisions.get(agent) ?? null,
    }
    // 投影 v6（0.6.0）：imageContext 是按 agent 的按图三态计数——无图会话
    // 不写该字段（缺席 ≠ 三零计数）；lastFlowEvent 为该会话最近流事件
    // （onDecision extra.flowId 供给），无则缺席。
    const counts = imageStates.counts(agent)
    if (counts.native + counts.transcribed + counts.blind > 0) snapshot.imageContext = counts
    const flowEvent = latestFlowEvents.get(agent)
    if (flowEvent !== undefined) snapshot.lastFlowEvent = flowEvent
    // 面板 v7（v2.0.0 Task 5，设计稿 D7）：按父会话聚合的派发台账（每会话最近 20 条，
    // 新在前）——子代理记账的 parentSession = Lead 会话 id。Agent 类型面核对结论：
    // agent.id 即 SessionId（dsh-agent types.d.ts:13「Session-backed Agent identity」，
    // 宿主 roster 同口径），快照侧直接以 agent.id 取台账。无派发 = 空数组（非
    // undefined——读取端据此区分「无派发」与「旧载荷无此字段」）；夹具无 id →
    // 空串恒不匹配 → 空数组。
    snapshot.dispatch = dispatchLedger.recentFor((agent as { id?: string }).id ?? '')
    return snapshot
  }
  /**
   * 面板数据的**唯一**出口：按 agent 现算快照（无缓存、无写入）。
   *
   * v1.2.0 会话事件解耦（2026-09-10 用户裁定）：面板曾以
   * `agent.session.append('kimi-tide/panel', …)` 落在会话日志里、由投影回放；
   * 实测全库 120,705 条 / 203.7 MB（占全部会话事件体积 27.9%，个别会话 100%）
   * ——纯冗余，且是 09-10 格式迁移整卷拒载的主因。现改为
   * `/kimi-tide panel --json` 命令通道按需供给：dock 拉取时**现算**，因此拿到
   * 的是当下路由/配额状态，比回放日志里几分钟前的陈旧快照更准。
   *
   * 因不落日志，原先的「语义去重防膨胀」目的随之消失（`panelSignature` 保留为
   * 纯函数与单测面，不再参与推送节流）。
   */
  const rememberPanel = (agent: Agent): KimiTidePanelProjection => panelSnapshot(agent)
  const refreshModelOptions = () => {
    const llm = ctx.llm as { listModels?: (provider: string) => Promise<Array<{ id: string }>> }
    if (typeof llm.listModels !== 'function') return
    void llm.listModels('kimi-coding')
      .then((models) => { modelOptions = { ...modelOptions, kimi: models.map((m) => m.id) } })
      .catch(() => { /* kimi-coding 路由未注册：下拉回退空列表，面板给接入指引 */ })
    void llm.listModels('deepseek-official')
      .then((models) => { modelOptions = { ...modelOptions, deepseek: models.map((m) => m.id) } })
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
    void refreshAllQuotas()
  })
  // 0.1.7：agent/created 的监听器签名带 `this: Scoped<Agent>` 与返回位
  // （`undefined | Promise<undefined>`）；载荷多出 source/signal 两字段，参数按
  // 上下文推导（不再手写窄化注解——注解会切断 this 位的推断）。
  //
  // 两条硬约束（0.1.7 runtime-types.d.ts:218-220 明文，运行时可证）：
  //   ① 返回值必须 undefined —— 该事件是 `@mode serial`，cordis 的 serial 分发把
  //      非 undefined/null/false 的返回值当 bail（isBailed）并**短路掉后续监听器**，
  //      而 agent/created 后面挂着宿主的 agent 初始化链。旧写法把 rememberPanel 的
  //      返回值（一个投影对象）隐式返回了出去 ⇒ 每次都短路。
  //   ② 监听器体内绝不能抛/拒绝 —— 抛一次 = 该 agent 创建失败、用户开不了会话。
  //      rememberPanel 会读 agent.session 与路由槽位，属可能抛的观测面，故兜住。
  ctx.on('agent/created', (payload) => {
    // 首次取数即建签名基线（命令通道按需现算，此处只为观测基线）。
    try {
      rememberPanel(payload.agent)
    } catch (error) {
      warn(`dsh-kimi-tide: agent/created 观测基线取数失败（不影响会话创建）：${(error as Error).message}`)
    }
    return undefined
  })
  ctx.on('agent/disposed', (payload: { agent: Agent }) => {
    latestDecisions.delete(payload.agent)
    latestFlowEvents.delete(payload.agent)
    // 派发台账（Task 5）：清掉该 agent 作为子代理产生的记账（键 = 字符串 agentId）。
    dispatchLedger.dropAgent(payload.agent.id)
  })

  // 面板取数通道（2026-09-10 换道）：dock 每 8s 轮询一次面板快照。若走命令通道
  // （remote.commands.execute → commands.execute），宿主会为每次执行持久化
  // command/run + command/done 两条生命周期事件，done 里还带着整份面板 JSON
  // （实机：会话流被 kimi-tide 命令节点刷屏、会话日志重新膨胀——「停止写面板
  // 事件」的解耦目标被取数通道自己打破）。改挂 connection.fetch 的 HTTP 只读
  // 路由：/api 路径自带宿主 browser-trust fence（loopback/受信 authority +
  // 同源标记，见 dsh-client-connection isTrustedApiRequest），读取零持久化；
  // /api/file（session-controller）是同款先例。动作类命令（preset/refresh/
  // review）仍走命令通道——用户显式行为理应留在时间线里，且频率是人为量级。
  interface ConnectionFetchFace {
    fetch?: {
      register?: (route: {
        path: string
        methods: string[]
        requestBody: string
        fetch: (request: { url: string }) => Promise<Response>
      }, name: string) => () => void
    }
  }
  const registerPanelRoute = (hostCtx: Context): (() => void) | undefined => {
    const connection = hostCtx.get('connection') as ConnectionFetchFace | undefined
    if (connection?.fetch?.register === undefined) return undefined
    const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' }
    return connection.fetch.register({
      path: '/api/kimi-tide/panel',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const url = new URL(request.url)
        const sessionId = url.searchParams.get('sessionId') ?? ''
        const agent = sessionId === '' ? undefined : ctx.get('agents')?.get(sessionId as never) as Agent | undefined
        if (agent === undefined) {
          // 会话未激活（冷会话/刚打开未 resume）：无现场路由状态可算，409 让
          // dock 走降级文案，不为冷会话编造一份空面板。
          return new Response(JSON.stringify({ ok: false, error: 'session not live' }), { status: 409, headers: jsonHeaders })
        }
        return new Response(JSON.stringify({ ok: true, panel: rememberPanel(agent) }), { headers: jsonHeaders })
      },
    }, 'kimi-tide: /api/kimi-tide/panel')
  }
  ctx.effect(() => {
    // A6 同款教训（2026-09-10 实机二次验证）：bundle 时序下 connection.fetch
    // 注册面可能晚于本插件 apply——一次性守卫读 undefined 即静默放弃 = 路由
    // 永不注册（实机：dock 取数 HTTP 404，551a25e 的诊断文案上线后定位）。
    // 修复：就绪立即注册；缺席经 ctx.inject(['connection']) 延迟补挂 + warn
    // 留痕（client/index.ts 评审卡注册同款模式）。
    const disposer = registerPanelRoute(ctx)
    if (disposer !== undefined) return disposer
    warn('connection.fetch 注册面尚未就绪——/api/kimi-tide/panel 面板取数路由经 ctx.inject(["connection"]) 延迟补挂')
    if (typeof ctx.inject !== 'function') return () => {}
    ctx.inject(['connection'], (late) => {
      late.effect(() => {
        const disposer = registerPanelRoute(late)
        return disposer ?? (() => {})
      })
    })
    return () => {}
  })
  // 存活 agent 名册已不再需要：面板数据按需自 agent 现算，无推送目标。
  // （v1.2.0 会话事件解耦前这里维护 liveAgents 供 pushPanelToAllSessions 遍历。）

  // 设置通道（0.1.7 换道，2026-09-28）。旧写法是向 dsh-settings 注册自有命名空间
  // `kimi-tide-router`（`sctx.settings.register(ns, schema, {base, validate})` 返回
  // 带 get/update/replace/watch 的 scope）——该 API 在 0.1.7 已整体移除。现行正道：
  // 路由配置就是本条目 Config 的 `router` 字段（`export const Config` 声明 + `.volatile()`），
  // 读 `ctx.config.router.get()`、写 `configEditor.edit(entry, …)`、变更通知
  // `loader/volatile-update`；细节与证据链见 settings-port.ts 头注。
  //
  // 拿不到通道（旧宿主 / 测试桩 / 无 configEditor）时 port 为 null，命令层与
  // applyConfig 自动退回 sidecar 存储（`applyConfig` 的 source 判定），行为不变。
  const port = createSettingsPort({
    ctx,
    config,
    tunables: () => ({
      ...(config.usagePollMs === undefined ? {} : { usagePollMs: config.usagePollMs }),
      ...(config.balancePollMs === undefined ? {} : { balancePollMs: config.balancePollMs }),
      ...(config.usagePollOnStart === undefined ? {} : { usagePollOnStart: config.usagePollOnStart }),
      ...(config.patchFile === undefined ? {} : { patchFile: config.patchFile }),
      ...(config.sidecarFile === undefined ? {} : { sidecarFile: config.sidecarFile }),
    }),
    onError: warn,
  })
  if (port !== null) {
    // 1) 首个生效值：存量残留（v1/v4 词汇）走 coerce 链，否则直接用快照。
    //    声明面用 RouterConfigAny（as 加宽防赋值窄化回 v5）：迁移后升为 v6。
    let applied: RouterConfigAny = readRouterConfig(config) as RouterConfigAny
    // 2) v6 一次性迁移：存量条目若还是 v1/v4 词汇则搬到 v6 并落盘；写失败只降级
    //    （本次运行用迁移值，下次启动重试），绝不抛回启动路径。
    //    ⚠ 判残留用原始值（rawRouter）——解析后的快照已被 schema 补成 version:6。
    if (legacySeed && hasKimiTideResidueV6(rawRouter)) {
      try {
        const migrated = coerceRouterConfigV6(applied, warn)
        if (migrated !== applied) {
          const docPath = (ctx.get('configEditor') as { documentPath?: string } | undefined)?.documentPath
          if (typeof docPath === 'string' && docPath.length > 0) {
            try { copyFileSync(docPath, docPath + '.pre-v6') } catch (error) {
              warn(`dsh-kimi-tide: 配置文档 .pre-v6 快照失败（${(error as Error).message}）`)
            }
          }
          void port.replace(migrated as unknown as object)
            .then(() => warn('dsh-kimi-tide: 插件配置的 router 段已迁移至 v6（团队派发分工层挂载，行为保持）'))
            .catch((error: unknown) =>
              warn(`dsh-kimi-tide: v6 迁移持久化失败（${(error as Error).message}）；本次运行已应用迁移值，下次启动将重试`))
          applied = migrated
        }
      } catch (error) {
        warn(`dsh-kimi-tide: v6 迁移失败（${(error as Error).message}）；本次运行保留旧形状`)
      }
    }
    settingsScope = port
    applyConfig(applied)
    // 3) 运行时变更：volatile 提交（设置页/卡片/dock 写入）不发重载，只发本事件。
    ctx.effect(() => onRouterConfigChanged(ctx, () => applyConfig(readRouterConfig(config))))
    // 4) 卸载（provider 重载 / 服务释放）：命令层退回 sidecar。
    ctx.effect(() => () => { settingsScope = null })
    // 5) 档位表 / 挂载表发布：写本条目 Config 的 volatile 字段（客户端经同一次
    //    settings.describe 读取）。写前内容脏检查——只有清单真变化才落盘。
    syncCatalog = () => {
      const section = { efforts: effortCatalog, mounted: mountedModels }
      const serialized = JSON.stringify(section)
      if (serialized === lastSyncedCatalog) return
      const setCatalog = port.setCatalog
      if (setCatalog === undefined) return
      try {
        void setCatalog.call(port, section)
          .then(() => { lastSyncedCatalog = serialized })
          .catch((error: unknown) =>
            warn(`dsh-kimi-tide: effort 档位表写入失败（${(error as Error).message}）；effort 下拉降级为「跟随默认」`))
      } catch (error) {
        warn(`dsh-kimi-tide: effort 档位表写入异常（${(error as Error).message}）`)
      }
    }
    syncCatalog()
    ctx.effect(() => () => { syncCatalog = null })
    // 5) 一次性 sidecar → Config 导入（0.4.x 存量用户的迁移路径）。动态 import：
    //    它带的 dsh-util-values 依赖只在真有设置通道的宿主上解析。
    void import('./settings-migration.js')
      .then(({ migrateSidecarIntoScope }) => migrateSidecarIntoScope({
        sidecarFile,
        scope: port,
        // 脏检查：只有「用户在 v5+ 语义下编辑过」才拒绝导入（口径见 hasExplicitV5Config）。
        hasExplicitEntryConfig: hasExplicitV5Config(rawRouter),
        entry: settingsBase,
        onError: warn,
      }))
      .then((outcome) => {
        if (outcome === 'imported') {
          warn('dsh-kimi-tide: sidecar 已迁移至插件配置的 router 段（原文件留档 .legacy-imported）')
        }
      })
      .catch((error) => warn(`dsh-kimi-tide: sidecar 迁移失败（${(error as Error).message}）`))
  }

  // Quota polling lifecycle.
  if (config.usagePollOnStart !== false) {
    for (const { monitor } of quotaMonitors) monitor?.start()
  }
  ctx.effect(() => () => {
    for (const { monitor } of quotaMonitors) monitor?.stop()
  })
  ctx.effect(() => () => {
    disposeRouter?.()
    teamSkill?.dispose()
    teamSkill = null
  })
}
