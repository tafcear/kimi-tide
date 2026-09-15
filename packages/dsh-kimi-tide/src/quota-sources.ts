/**
 * quota-sources — 配额/余额源注册表（用量/余额 spec v2 §4/§5/§11）。
 *
 * 一个源 = 一个 provider 的一份「用量窗」或「余额」数据面。新源 = 这里加一项，
 * 不再散落 index.ts 手工挂 monitor（v2 M3）。
 *
 * 端点契约：
 * - kimi/zai 沿用既有解析器（0.8.x⑨ 多 plan 配额）；
 * - deepseek-official = 官方文档 `GET <baseURL>/user/balance`（余额）；
 * - qwen-token-plan-cn = **无 API 面**（取证结论见 spec §5.2）：以 url/parse 缺席
 *   注册并带静态 `unavailableReason`，诚实呈现「该套餐查不到」，不伪装成取数失败。
 */
import type { BalanceEntry, BalanceSnapshot, QuotaLike } from './types.js'
import { parseQuotaSnapshot } from './types.js'
import { ZAI_QUOTA_URL, parseZaiQuota } from './zai-usage.js'

/** Kimi Code 用量端点（既有实现，勿改）。 */
export const KIMI_USAGES_URL = 'https://api.kimi.com/coding/v1/usages'
/** DeepSeek 官方基址（三段取值链的兜底）。 */
export const DEEPSEEK_DEFAULT_BASE = 'https://api.deepseek.com'
/** 余额源默认有界超时（M4：不能沿用 0.8×pollMs，300s 周期会挂 240s）。 */
export const BALANCE_TIMEOUT_MS = 15_000
/** qwen token plan 的静态原因（spec §5.2 取证结论）。 */
export const QWEN_NO_API_REASON = '该套餐无公开用量 API（需控制台查看）'

export interface QuotaSourceDescriptor {
  provider: string
  kind: 'usage' | 'balance'
  /** null = 该源无 API 面（不轮询，直接以 no-api 呈现）。 */
  url: string | null
  parse: ((json: unknown, now: number) => QuotaLike | null) | null
  /** per-operation 读凭据（dsh-credentials 契约）。 */
  resolveKey: () => Promise<string | null>
  pollMs: number
  /** 有界超时；缺省 = UsageMonitor 的 0.8×pollMs。 */
  timeoutMs?: number
  unavailableReason?: string
}

export interface QuotaSourceDeps {
  /**
   * 读 llm-pi-ai 节里某 provider 的凭据 ref 名**候选链**（v1.3.0 实机验收修复）。
   * 返回数组而非单名：`settings.get('llm-pi-ai')` 因该命名空间从未注册而恒为
   * undefined（dsh-settings 的 `get(ns)` 只查已注册命名空间），所以必须能依次回落
   * 到 settings.yaml 文件里的 apiKeyEnv 与内置兼容名。
   */
  providerApiKeyEnvs: (providerId: string, fallbacks: readonly string[]) => readonly string[]
  /** 读 llm-deepseek 节（apiKeyEnv / baseURL）。 */
  deepseekSection: () => { apiKeyEnv?: string; baseURL?: string } | undefined
  /** 解析凭据引用；未配置返回 null。 */
  resolveCredential: (ref: string) => Promise<string | null>
  /** 进程环境（bootstrap 名如 DEEPSEEK_BASE_URL 只在这里）。 */
  env: Record<string, string | undefined>
  usagePollMs: number
  balancePollMs: number
}

const nonEmpty = (value: string | undefined): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * provider 凭据 ref 名的**候选链**（纯函数，v1.3.0 实机验收修复）。
 *
 * 为什么需要链而不是单名：`settings.get('llm-pi-ai')` 只查**已注册**的命名空间
 * （dsh-settings 的实现为 `registrations.get(ns)?.resolved`），而 `dsh-llm-pi-ai`
 * 与 `dsh-llm-deepseek` 都**不注册**命名空间 ⇒ 该调用恒为 undefined，旧实现于是
 * 永远落到内置 fallback 名。实机后果：`ZAI_API_KEY` / `KIMI_API_KEY` 在凭据库里
 * 并不存在（真实名是 `ZAI_CODING_CN_API_KEY` / `KIMI_CODING_API_KEY`）⇒ 这两个
 * provider 的配额槽永远空白；只有 `DEEPSEEK_API_KEY` 恰好同名才正常显示余额。
 *
 * 顺序：settings 服务（未来若注册即自动生效）→ settings.yaml 文件（当前唯一
 * 实际可用的来源）→ 内置兼容名。去重、丢空串、容忍任意坏形状（不抛）。
 */
export function providerKeyCandidates(
  providerId: string,
  fallbacks: readonly string[],
  serviceSection: unknown,
  fileSection: unknown,
): string[] {
  const out: string[] = []
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed === '' || out.includes(trimmed)) return
    out.push(trimmed)
  }
  const pick = (section: unknown): void => {
    const providers = (section as { providers?: Record<string, { apiKeyEnv?: unknown }> } | undefined)?.providers
    if (providers === null || typeof providers !== 'object') return
    push(providers[providerId]?.apiKeyEnv)
  }
  pick(serviceSection)
  pick(fileSection)
  for (const fallback of fallbacks) push(fallback)
  return out
}

/**
 * 余额端点 URL：与 `dsh-llm-deepseek` 同源的三段优先级
 * （settings `llm-deepseek.baseURL` → `process.env.DEEPSEEK_BASE_URL` → 官方）。
 * 该环境名是 bootstrap-only（dsh-app-boot 的 BOOTSTRAP_NAMES），第三方插件
 * 读不到 launch environment 对象，只能直读 process.env。
 */
export function deepseekBalanceUrl(settingsBase: string | undefined, envBase: string | undefined): string {
  const base = nonEmpty(settingsBase) ?? nonEmpty(envBase) ?? DEEPSEEK_DEFAULT_BASE
  return `${base.replace(/\/+$/, '')}/user/balance`
}

/** 官方 `/user/balance` 载荷 → 余额快照；`balance_infos` 缺失/空/非数组 → null。 */
export function parseDeepSeekBalance(json: unknown, now: number): BalanceSnapshot | null {
  if (json === null || typeof json !== 'object') return null
  const root = json as { is_available?: unknown; balance_infos?: unknown }
  if (!Array.isArray(root.balance_infos) || root.balance_infos.length === 0) return null
  const balances: BalanceEntry[] = []
  for (const raw of root.balance_infos) {
    if (raw === null || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const currency = typeof entry.currency === 'string' ? entry.currency : ''
    const total = typeof entry.total_balance === 'string' ? entry.total_balance : ''
    if (currency === '' && total === '') continue
    const out: BalanceEntry = { currency, total }
    if (typeof entry.granted_balance === 'string') out.granted = entry.granted_balance
    if (typeof entry.topped_up_balance === 'string') out.toppedUp = entry.topped_up_balance
    balances.push(out)
  }
  if (balances.length === 0) return null
  const snapshot: BalanceSnapshot = { kind: 'balance', balances, fetchedAt: now, stale: false }
  if (typeof root.is_available === 'boolean') snapshot.available = root.is_available
  return snapshot
}

/** 四源注册表（含无 API 面的一源）。顺序 = 展示序（说明页/总览面板沿用）。 */
export function buildQuotaSources(deps: QuotaSourceDeps): QuotaSourceDescriptor[] {
  /**
   * ref 名 → key 的解析（**多候选**，v1.3.0 实机验收修复）：依次试候选链，谁先解析到
   * 非空 key 就用谁。旧实现只试单一 ref 名，而那个名字来自 `settings.get` 的回落值——
   * 与实机凭据库里的名字不一致 ⇒ 配额源恒 no-key，只有恰好同名的 provider 正常。
   */
  const credentialKey = (refs: readonly string[]) => async (): Promise<string | null> => {
    for (const ref of refs) {
      const value = await deps.resolveCredential(ref)
      if (value !== null && value.length > 0) return value
    }
    return null
  }
  const ds = deps.deepseekSection() ?? {}
  const deepseekRefs = [nonEmpty(ds.apiKeyEnv), 'DEEPSEEK_API_KEY']
    .filter((ref): ref is string => ref !== undefined)
  return [
    {
      provider: 'kimi-coding',
      kind: 'usage',
      url: KIMI_USAGES_URL,
      parse: parseQuotaSnapshot,
      resolveKey: credentialKey(deps.providerApiKeyEnvs('kimi-coding', ['KIMI_CODING_API_KEY', 'KIMI_API_KEY'])),
      pollMs: deps.usagePollMs,
    },
    {
      provider: 'zai-coding-cn',
      kind: 'usage',
      url: ZAI_QUOTA_URL,
      parse: parseZaiQuota,
      resolveKey: credentialKey(deps.providerApiKeyEnvs('zai-coding-cn', ['ZAI_CODING_CN_API_KEY', 'ZAI_API_KEY'])),
      pollMs: deps.usagePollMs,
    },
    {
      provider: 'qwen-token-plan-cn',
      kind: 'usage',
      url: null,
      parse: null,
      resolveKey: credentialKey(deps.providerApiKeyEnvs('qwen-token-plan-cn', ['QWEN_TOKEN_PLAN_CN_API_KEY'])),
      pollMs: deps.usagePollMs,
      unavailableReason: QWEN_NO_API_REASON,
    },
    {
      provider: 'deepseek-official',
      kind: 'balance',
      url: deepseekBalanceUrl(ds.baseURL, deps.env.DEEPSEEK_BASE_URL),
      parse: parseDeepSeekBalance,
      resolveKey: credentialKey(deepseekRefs),
      pollMs: deps.balancePollMs,
      timeoutMs: BALANCE_TIMEOUT_MS,
    },
  ]
}
