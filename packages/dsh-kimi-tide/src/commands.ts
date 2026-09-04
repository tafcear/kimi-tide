/**
 * kimi-tide: /kimi-tide slash command family — the client→host channel for
 * the dock panel (browser calls ctx.remote.commands.execute(sessionId,
 * '/kimi-tide …'); the harness routes it to this registration).
 *
 * Subcommands (0.6.0, v4/v5 双形配置):
 *   /kimi-tide preset <id|off>       (off → activePreset=null；id 须存在于 presets)
 *   /kimi-tide show                  (print current preset / default / rule count；0.6.0 v5 补 flows 注册表段 + 每预设 imageFallback 行)
 *   /kimi-tide set activePreset <id|off>  (SETTABLE_KEYS 唯一键)
 *   /kimi-tide export-config         (print the sidecar YAML text)
 *   /kimi-tide import-config <path|inline YAML>  (load a file OR inline YAML text)
 *   /kimi-tide refresh               (re-poll the usages endpoint now)
 *   /kimi-tide review                (1.1.0 §8：手动评审该 agent 最近完成轮——armed 语义外唯一入口)
 *
 * Agent targeting: the dsh-commands runtime dispatches each invocation to the
 * exact receiving agent (CommandInvocation.agent), and registerKimiTideCommands'
 * handler passes that agent into applyKimiTideCommand — the ONLY session/agent
 * carrier this module has (every other branch is agent-agnostic; review is the
 * first branch that must know which agent's last turn to review).
 * import-config 双形态（沿用 0.4.x 裁定）：参数是已存在文件路径 → 整表替换；
 * 参数是可解析的内联 YAML 文本 → 合并补丁语义（深度合并进当前配置，仅覆盖
 * 文本中出现的字段，其余保持不动）。其余 → 报错。0.6.0（v5）：文件导入支持
 * v5 形状（flows/imageFallback）；写命名空间一律收敛 v5（沿用 parseImportedFile
 * 「导入即迁移」惯例）；sidecar 兜底存储仅支持 v4，v5 文件导入明确拒绝而非静默
 * 损毁；内联合并保持当前版本（v4→4，v5→5）。
 *
 * Persistence contract: every mutating subcommand writes RouterConfigAny
 * through the settings namespace (KimiTideCommandDeps.settings) when one is
 * wired — never the v1 patch file; when settings is absent the sidecar
 * (RouterSidecarStore, v4-only) remains the fallback store.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import YAML from 'yaml'
import type { RouterConfigV4, RouterConfigV5 } from './config.js'
import { coerceRouterConfigV4, coerceRouterConfigV5 } from './migrate.js'
import type { RouterConfigAny } from './router.js'
import type { RouterSidecarStore } from './sidecar.js'

export type KimiTideCommand =
  | { kind: 'preset'; preset: string | null }
  | { kind: 'set'; key: string; value: unknown }
  | { kind: 'show' }
  | { kind: 'export-config' }
  | { kind: 'import-config'; path: string }
  | { kind: 'refresh' }
  | { kind: 'review' }
  | { kind: 'help' }
  | { kind: 'error'; message: string }

/** 手动评审未接线/路由关闭时的命令回显文案（index.ts 兜底共用，单源防漂移）。 */
export const REVIEW_UNMOUNTED_MESSAGE = '评审流未挂载（路由关闭中）'

/** Settings namespace port: primary read/write channel for the router config. */
export interface SettingsNamespacePort {
  get(): RouterConfigAny
  update(patch: object): Promise<void>
  replace(section: object): Promise<void>
}

export interface KimiTideCommandDeps {
  /** v4 persistence: the sidecar file is the live router store. */
  sidecar: RouterSidecarStore
  /** Primary settings namespace; absent/null → fall back to sidecar read/write. */
  settings?: SettingsNamespacePort | null
  /** 配额轮询源（多 plan 2026-08-29：refresh 需覆盖全部已配源，结构化最小面）。 */
  monitor: { refresh(): Promise<void> }
  current: () => RouterConfigAny
  /** Called after a successful save: rebuild the router + push projection. */
  onSaved: (config: RouterConfigAny) => void
  /** 1.1.0 §8：手动评审（spec §8——取该 agent 的 lastTurn 缓存同款异步评审）。 */
  manualReview?: (agent: Agent) => Promise<{ ok: boolean; message: string }>
  /** show 认领行数据：claimedReviewGroups 的实时结果（非空 → 输出追加一行）。 */
  claimedGroups?: Set<string>
}

/** Keys settable via `/kimi-tide set` — paths into RouterConfigAny（v4/v5 共有的顶层键）。 */
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
    case 'review':
      return { kind: 'review' }
    default:
      return { kind: 'error', message: `unknown subcommand "${parts[0]}" — try /kimi-tide help` }
  }
}

const HELP_TEXT = [
  '/kimi-tide preset <id|off> — switch active preset (off = 路由关闭)',
  '/kimi-tide show — print the current preset / default / rule count（v5 另输出 flows 注册表与每预设 imageFallback；有认领组时追加认领行）',
  '/kimi-tide set activePreset <id|off> — update the active preset',
  '/kimi-tide export-config — print the sidecar YAML',
  '/kimi-tide import-config <path|inline YAML> — load a YAML file OR inline YAML text (panel save channel)',
  '/kimi-tide refresh — re-poll code plan quotas (kimi/zai) now',
  '/kimi-tide review — 手动评审最近完成的一轮（无需 armed 命中；无缓存或路由关闭会得到对应提示）',
].join('\n')

export async function applyKimiTideCommand(cmd: KimiTideCommand, deps: KimiTideCommandDeps, agent?: Agent): Promise<string> {
  switch (cmd.kind) {
    case 'help':
      return HELP_TEXT
    case 'error':
      return `kimi-tide: ${cmd.message}`
    case 'refresh':
      await deps.monitor.refresh()
      return 'kimi-tide: quota refreshed'
    case 'review': {
      // 1.1.0 §8：手动评审（spec §8）——armed 语义外唯一入口；命令幂等（连发两次
      // 各评审一次，用户显式行为不去重，runner 侧无缓存即返回「无可评审的上一轮」）。
      // agent 缺失只可能出现在漏传 agent 的调用处（dsh-commands handler 恒传
      // invocation.agent）；与 manualReview 未接线同语义降级为未挂载文案。
      const r = deps.manualReview === undefined || agent === undefined
        ? { ok: false, message: REVIEW_UNMOUNTED_MESSAGE }
        : await deps.manualReview(agent)
      return r.ok ? r.message : `kimi-tide: ${r.message}`
    }
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
      if (p === undefined) return `kimi-tide: activePreset '${c.activePreset}' 缺失（配置异常）`
      const lines = [
        `kimi-tide: 预设「${p.name}」· 默认 ${p.default.provider}/${p.default.model} · 规则 ${p.rules.length} 条 · 关键词组 ${Object.keys(c.keywordGroups).length} 个`,
      ]
      // 0.6.0（v5）：flows 注册表段（id/类型/关键参数）——v4 存量无注册表，不输出该段。
      if (c.version === 5) {
        lines.push(`flows: ${formatFlows(c.flows)}`)
      }
      // 每预设 imageFallback 行：缺省 = latch（维持 0.5.x 行为）；transcribe-lazy 级联显示目标流。
      lines.push(`imageFallback: ${formatImageFallbacks(c)}`)
      // 1.1.0 §8：show 认领行——认领中的关键词组非空时追加（spec §8）。
      if (deps.claimedGroups !== undefined && deps.claimedGroups.size > 0) {
        lines.push(`评审流认领组：${[...deps.claimedGroups].join('、')}（命中词不再整轮切模型，轮末自动评审）`)
      }
      return lines.join('\n')
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
      let next: RouterConfigAny
      try {
        if (deps.settings != null) {
          // 命名空间是 v5 存储：文件导入沿用「导入即迁移」惯例收敛 v5；
          // 内联合并保留当前版本（mergeInlineText 内保证）。
          next = inline ? mergeInlineText(cmd.path, deps.current()) : coerceRouterConfigV5(parseImportedFile(cmd.path), () => {})
          await deps.settings.replace(next as unknown as object)
        } else if (inline) {
          next = mergeInlineText(cmd.path, deps.current())
          deps.sidecar.save(next as RouterConfigV4)
        } else {
          next = parseImportedFile(cmd.path)
          // sidecar 兜底存储仅支持 v4：v5 配置（flows/imageFallback）导入即损毁
          // （load 走 v4 迁移链丢字段）——明确拒绝，不静默写盘。
          if (next.version === 5) {
            throw new Error('v5 配置（flows/imageFallback）需要带设置服务的宿主（设置命名空间）；sidecar 兜底存储仅支持 v4')
          }
          deps.sidecar.save(next)
        }
      } catch (error) {
        return `kimi-tide: import failed — ${(error as Error).message}`
      }
      deps.onSaved(next)
      return `kimi-tide: imported ${inline ? 'inline YAML' : cmd.path}; effective now, persists across restarts`
    }
  }
}

/** v5 flows 注册表段：每流 `id(类型 → 关键参数)`。 */
function formatFlows(flows: RouterConfigV5['flows']): string {
  const entries = Object.entries(flows).map(([id, flow]) =>
    flow.type === 'transcribe'
      ? `${id}(转述 → ${flow.visionModel.provider}/${flow.visionModel.model}, 失败 ${flow.failurePolicy})`
      : `${id}(评审 → ${flow.reviewer.provider}/${flow.reviewer.model}, ${flow.trigger}, ${flow.rounds} 轮${flow.autoRevise ? ', 自动修订' : ''})`,
  )
  return entries.length === 0 ? '无' : entries.join(' · ')
}

/** 每预设 imageFallback 行：`id=姿态`（缺省 latch；transcribe-lazy 级联目标流）。 */
function formatImageFallbacks(c: RouterConfigAny): string {
  return Object.entries(c.presets).map(([id, preset]) => {
    const mode = preset.imageFallback
    const label = mode === undefined
      ? 'latch'
      : mode === 'transcribe-lazy'
        ? `transcribe-lazy→${preset.imageFallbackFlow ?? 'transcribe'}`
        : mode
    return `${id}=${label}`
  }).join(' · ')
}

async function persist(config: RouterConfigAny, deps: KimiTideCommandDeps, what: string): Promise<string> {
  if (deps.settings != null) {
    try { await deps.settings.update(config as unknown as object) } catch (error) {
      return `kimi-tide: save failed — ${(error as Error).message}`
    }
    deps.onSaved(config)
    return `kimi-tide: saved (${what}); effective now, persists across restarts`
  }
  // 兜底：无 settings 服务时维持旧 sidecar 写入（sidecar 链路恒为 v4 形状）
  try { deps.sidecar.save(config as RouterConfigV4) } catch (error) { return `kimi-tide: save failed — ${(error as Error).message}` }
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
 * version 保持当前配置的版本（v4→4，v5→5；0.6.0：v5 内联补丁不再被压回 4）。
 */
function mergeInlineText(text: string, current: RouterConfigAny): RouterConfigAny {
  const patch = YAML.parse(text) as unknown
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('inline YAML must be a mapping (object)')
  }
  const merged = deepMerge(structuredClone(current), patch) as RouterConfigAny
  ;(merged as { version: number }).version = current.version
  return merged
}

/**
 * 读取并校验一个 config YAML 文件（不落盘），供设置命名空间与 sidecar 两条
 * import-config 文件形态路径使用——镜像 RouterSidecarStore.validate 的
 * v5/v4/v3/v2 结构检查。v4/v5 直通；v2/v3 经 coerceRouterConfigV4 统一迁移
 * （v5 收敛由调用方按目标存储决定：命名空间 coerceRouterConfigV5，sidecar 拒 v5）。
 */
function parseImportedFile(path: string): RouterConfigAny {
  const raw = YAML.parse(readFileSync(path, 'utf8')) as unknown
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.version === 5) {
    const presets = r.presets
    if (typeof presets !== 'object' || presets === null || Array.isArray(presets)) {
      throw new Error('config v5 结构不合格：presets 缺失或非对象')
    }
    if (r.activePreset !== null && typeof r.activePreset !== 'string') {
      throw new Error('config v5 结构不合格：activePreset 非 string|null')
    }
    if (typeof r.flows !== 'object' || r.flows === null || Array.isArray(r.flows)) {
      throw new Error('config v5 结构不合格：flows 缺失或非对象')
    }
    return raw as RouterConfigV5
  }
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
      description: '月汐 panel: route preset / settings / config export-import / quota refresh / manual review',
      input: { hint: 'preset <id|off> · set activePreset <id|off> · show · export-config · import-config <path|inline YAML> · refresh · review' },
      handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
        const cmd = parseKimiTideCommand(invocation.rawInput)
        // invocation.agent = 发起命令的接收 agent（dsh-commands 契约）；review 分支
        // 据此评审该 agent 的 lastTurn。其余分支不消费 agent。
        const text = await applyKimiTideCommand(cmd, deps, invocation.agent)
        return cmd.kind === 'error' ? { kind: 'error', text } : { kind: 'success', text }
      },
    })
  })
}
