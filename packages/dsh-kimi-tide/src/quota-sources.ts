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
  /** 读 llm-pi-ai 节里某 provider 的 apiKeyEnv 引用名。 */
  providerApiKeyEnv: (providerId: string, fallbackEnv: string) => string
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
  const credentialKey = (ref: string) => async (): Promise<string | null> => deps.resolveCredential(ref)
  const ds = deps.deepseekSection() ?? {}
  return [
    {
      provider: 'kimi-coding',
      kind: 'usage',
      url: KIMI_USAGES_URL,
      parse: parseQuotaSnapshot,
      resolveKey: credentialKey(deps.providerApiKeyEnv('kimi-coding', 'KIMI_API_KEY')),
      pollMs: deps.usagePollMs,
    },
    {
      provider: 'zai-coding-cn',
      kind: 'usage',
      url: ZAI_QUOTA_URL,
      parse: parseZaiQuota,
      resolveKey: credentialKey(deps.providerApiKeyEnv('zai-coding-cn', 'ZAI_API_KEY')),
      pollMs: deps.usagePollMs,
    },
    {
      provider: 'qwen-token-plan-cn',
      kind: 'usage',
      url: null,
      parse: null,
      resolveKey: credentialKey(deps.providerApiKeyEnv('qwen-token-plan-cn', 'QWEN_TOKEN_PLAN_CN_API_KEY')),
      pollMs: deps.usagePollMs,
      unavailableReason: QWEN_NO_API_REASON,
    },
    {
      provider: 'deepseek-official',
      kind: 'balance',
      url: deepseekBalanceUrl(ds.baseURL, deps.env.DEEPSEEK_BASE_URL),
      parse: parseDeepSeekBalance,
      resolveKey: credentialKey(nonEmpty(ds.apiKeyEnv) ?? 'DEEPSEEK_API_KEY'),
      pollMs: deps.balancePollMs,
      timeoutMs: BALANCE_TIMEOUT_MS,
    },
  ]
}
