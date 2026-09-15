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
  providerKeyCandidates,
  type QuotaSourceDeps,
} from '../src/quota-sources.js'

const deps = (over: Partial<QuotaSourceDeps> = {}): QuotaSourceDeps => ({
  providerApiKeyEnvs: (_id, fallbacks) => [...fallbacks],
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

  it('Kimi/Zai 的 key 引用走各自 apiKeyEnv 候选链（pi-ai 节）', async () => {
    const seen: string[] = []
    const sources = buildQuotaSources(deps({
      providerApiKeyEnvs: (id, fallbacks) => (id === 'kimi-coding' ? ['KIMI_X', ...fallbacks] : [...fallbacks]),
      resolveCredential: async (ref) => { seen.push(ref); return null },
    }))
    await sources.find((s) => s.provider === 'kimi-coding')!.resolveKey()
    await sources.find((s) => s.provider === 'zai-coding-cn')!.resolveKey()
    // 全部候选都被试过（旧实现只试第一个 ⇒ 别名 provider 恒解析不到 key）
    expect(seen).toEqual(['KIMI_X', 'KIMI_CODING_API_KEY', 'KIMI_API_KEY', 'ZAI_CODING_CN_API_KEY', 'ZAI_API_KEY'])
  })

  it('候选链命中即止：第一个有 key 就不问后面的（v1.3.0 实机验收修复）', async () => {
    const seen: string[] = []
    const sources = buildQuotaSources(deps({
      providerApiKeyEnvs: (_id, fallbacks) => [...fallbacks],
      resolveCredential: async (ref) => { seen.push(ref); return ref === 'ZAI_CODING_CN_API_KEY' ? 'secret' : null },
    }))
    const zai = sources.find((s) => s.provider === 'zai-coding-cn')!
    await expect(zai.resolveKey()).resolves.toBe('secret')
    expect(seen).toEqual(['ZAI_CODING_CN_API_KEY'])
  })

  it('全链未配置 → null（保持 S1 的 no-credential 语义）', async () => {
    const sources = buildQuotaSources(deps({ resolveCredential: async () => null }))
    await expect(sources.find((s) => s.provider === 'zai-coding-cn')!.resolveKey()).resolves.toBeNull()
  })
})

describe('providerKeyCandidates（v1.3.0 实机验收修复：ref 名三段链）', () => {
  const ZAI_FILE = { providers: { 'zai-coding-cn': { apiKeyEnv: 'ZAI_CODING_CN_API_KEY' } } }

  it('settings.yaml 文件里的 apiKeyEnv 优先于内置 fallback —— 本次缺陷的直接修复', () => {
    // 实机：settings.get('llm-pi-ai') 恒 undefined（该命名空间从未注册），只有文件这一路
    // 能给出真实 ref 名 ZAI_CODING_CN_API_KEY；旧实现只认 ZAI_API_KEY，而凭据库里没有
    // 这个名字 ⇒ 配额源恒 no-key、dock 上切到 GLM 就是空的。
    expect(providerKeyCandidates('zai-coding-cn', ['ZAI_API_KEY'], undefined, ZAI_FILE))
      .toEqual(['ZAI_CODING_CN_API_KEY', 'ZAI_API_KEY'])
  })

  it('服务端 section 可用时排最前（未来命名空间若注册即自动生效），并去重', () => {
    expect(providerKeyCandidates('zai-coding-cn', ['ZAI_API_KEY'], ZAI_FILE, ZAI_FILE))
      .toEqual(['ZAI_CODING_CN_API_KEY', 'ZAI_API_KEY'])
  })

  it('两路都拿不到 → 只剩内置候选；坏形状与重复项不抛、不重复', () => {
    expect(providerKeyCandidates('zai-coding-cn', ['ZAI_API_KEY', 'ZAI_API_KEY'], undefined, null))
      .toEqual(['ZAI_API_KEY'])
    expect(providerKeyCandidates('x', ['A'], { providers: 'nope' }, { providers: { x: { apiKeyEnv: 42 } } }))
      .toEqual(['A'])
    expect(providerKeyCandidates('x', ['A'], undefined, { providers: { x: { apiKeyEnv: '  ' } } }))
      .toEqual(['A'])
  })
})
