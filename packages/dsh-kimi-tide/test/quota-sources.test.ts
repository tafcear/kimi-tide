/**
 * 配额源注册表 + DeepSeek 余额解析（用量/余额 spec v2 §4/§5/§11）。
 *
 * 覆盖三件事：余额契约解析（官方文档形状）、baseURL 三段取值链（M2）、
 * 四源注册表形状与状态（S1：no-api / no-credential / failed / ok）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildQuotaSources,
  deepseekBalanceUrl,
  parseDeepSeekBalance,
  type QuotaSourceDeps,
} from '../src/quota-sources.js'

const deps = (over: Partial<QuotaSourceDeps> = {}): QuotaSourceDeps => ({
  providerApiKeyEnv: (_id, fallback) => fallback,
  deepseekSection: () => undefined,
  resolveCredential: async () => 'k',
  env: {},
  usagePollMs: 60_000,
  balancePollMs: 300_000,
  ...over,
})

describe('parseDeepSeekBalance：官方契约形状', () => {
  it('文档示例 → 余额快照（金额原样保留字符串，不做 parseFloat）', () => {
    const snap = parseDeepSeekBalance({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
    }, 123)
    expect(snap).toEqual({
      kind: 'balance',
      balances: [{ currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00' }],
      available: true,
      fetchedAt: 123,
      stale: false,
    })
  })

  it('多币种并列；缺 granted/toppedUp 时字段缺席（不臆造 0）', () => {
    const snap = parseDeepSeekBalance({
      is_available: false,
      balance_infos: [
        { currency: 'CNY', total_balance: '1.00' },
        { currency: 'USD', total_balance: '2.00', topped_up_balance: '2.00' },
      ],
    }, 1)
    expect(snap?.balances).toEqual([
      { currency: 'CNY', total: '1.00' },
      { currency: 'USD', total: '2.00', toppedUp: '2.00' },
    ])
    expect(snap?.available).toBe(false)
  })

  it('balance_infos 缺失/空/非数组 → null（不产出空余额壳）', () => {
    expect(parseDeepSeekBalance({ is_available: true }, 1)).toBeNull()
    expect(parseDeepSeekBalance({ is_available: true, balance_infos: [] }, 1)).toBeNull()
    expect(parseDeepSeekBalance({ balance_infos: 'nope' }, 1)).toBeNull()
    expect(parseDeepSeekBalance(null, 1)).toBeNull()
  })
})

describe('deepseekBalanceUrl：三段取值链（M2）', () => {
  it('settings 的 baseURL 最优先（并去掉尾斜杠）', () => {
    expect(deepseekBalanceUrl('https://proxy.example/v1/', 'https://env.example')).toBe('https://proxy.example/v1/user/balance')
  })

  it('settings 缺席 → 环境变量 DEEPSEEK_BASE_URL（bootstrap-only，直读 process.env）', () => {
    expect(deepseekBalanceUrl(undefined, 'https://env.example')).toBe('https://env.example/user/balance')
  })

  it('两者都缺席 → 官方域', () => {
    expect(deepseekBalanceUrl(undefined, undefined)).toBe('https://api.deepseek.com/user/balance')
    expect(deepseekBalanceUrl('', '')).toBe('https://api.deepseek.com/user/balance')
  })
})

describe('buildQuotaSources：四源注册表', () => {
  it('四个 provider 齐备，kind 与轮询节奏正确（余额源慢轮询 + 短超时）', () => {
    const sources = buildQuotaSources(deps())
    expect(sources.map((s) => s.provider)).toEqual([
      'kimi-coding', 'zai-coding-cn', 'qwen-token-plan-cn', 'deepseek-official',
    ])
    const balance = sources.find((s) => s.provider === 'deepseek-official')!
    expect(balance.kind).toBe('balance')
    expect(balance.pollMs).toBe(300_000)
    // M4：余额源 15s 有界超时，而不是 0.8×pollMs（=240s）
    expect(balance.timeoutMs).toBe(15_000)
    expect(balance.url).toBe('https://api.deepseek.com/user/balance')
    const usage = sources.find((s) => s.provider === 'kimi-coding')!
    expect(usage.kind).toBe('usage')
    expect(usage.pollMs).toBe(60_000)
    expect(usage.timeoutMs).toBeUndefined()
  })

  it('qwen 以「无 API 面」注册（url/parse 缺席 + 静态原因），不参与轮询', () => {
    const qwen = buildQuotaSources(deps()).find((s) => s.provider === 'qwen-token-plan-cn')!
    expect(qwen.kind).toBe('usage')
    expect(qwen.url).toBeNull()
    expect(qwen.parse).toBeNull()
    expect(qwen.unavailableReason).toContain('无公开用量 API')
  })

  it('deepseek 的 key 读 llm-deepseek 节（缺省 DEEPSEEK_API_KEY），baseURL 跟随 settings/env', async () => {
    const seen: string[] = []
    const sources = buildQuotaSources(deps({
      deepseekSection: () => ({ apiKeyEnv: 'MY_DS_KEY', baseURL: 'https://gw.example' }),
      resolveCredential: async (ref) => { seen.push(ref); return 'secret' },
    }))
    const ds = sources.find((s) => s.provider === 'deepseek-official')!
    expect(ds.url).toBe('https://gw.example/user/balance')
    await expect(ds.resolveKey()).resolves.toBe('secret')
    expect(seen).toEqual(['MY_DS_KEY'])
  })

  it('Kimi/Zai 的 key 引用走各自 apiKeyEnv（pi-ai 节）', async () => {
    const seen: string[] = []
    const sources = buildQuotaSources(deps({
      providerApiKeyEnv: (id, fallback) => (id === 'kimi-coding' ? 'KIMI_X' : fallback),
      resolveCredential: async (ref) => { seen.push(ref); return null },
    }))
    await sources.find((s) => s.provider === 'kimi-coding')!.resolveKey()
    await sources.find((s) => s.provider === 'zai-coding-cn')!.resolveKey()
    expect(seen).toEqual(['KIMI_X', 'ZAI_API_KEY'])
  })
})
