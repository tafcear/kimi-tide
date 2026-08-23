import { describe, expect, it, vi } from 'vitest'
import { UsageMonitor } from '../src/usage.js'

const USAGES_OK = {
  usage: { used: 9, limit: 100, resetTime: 'w' },
  limits: [{ used: 10, limit: 100, resetTime: 'f' }],
  user: { membership: { level: 'LEVEL_INTERMEDIATE' } },
}

function fetchResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

describe('UsageMonitor quota polling (API key auth)', () => {
  it('resolves the key per refresh and sends it as Bearer', async () => {
    const resolveKey = vi.fn(async () => 'sk-abc')
    const fetchFn = vi.fn(async () => fetchResponse(200, USAGES_OK))
    const monitor = new UsageMonitor({ pollMs: 60000, onUpdate: () => {}, resolveKey, fetchFn: fetchFn as unknown as typeof fetch, now: () => 1000 })
    await monitor.refresh()
    expect(monitor.snapshot().quota?.weekly.used).toBe(9)
    expect(resolveKey).toHaveBeenCalledOnce()
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-abc' })
  })

  it('does not fetch when the key is unresolvable (null)', async () => {
    const fetchFn = vi.fn()
    const monitor = new UsageMonitor({ pollMs: 60000, onUpdate: () => {}, resolveKey: async () => null, fetchFn: fetchFn as unknown as typeof fetch })
    await monitor.refresh()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(monitor.snapshot().quota).toBeNull()
  })

  it('does not fetch when the key is an empty string', async () => {
    const fetchFn = vi.fn()
    const monitor = new UsageMonitor({ pollMs: 60000, onUpdate: () => {}, resolveKey: async () => '', fetchFn: fetchFn as unknown as typeof fetch })
    await monitor.refresh()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(monitor.snapshot().quota).toBeNull()
  })

  it('a rejecting resolveKey is swallowed: refresh() resolves and the snapshot stays null', async () => {
    const fetchFn = vi.fn()
    const monitor = new UsageMonitor({
      pollMs: 60000,
      onUpdate: () => {},
      resolveKey: async () => { throw new Error('credential backend unavailable') },
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    await expect(monitor.refresh()).resolves.toBeUndefined()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(monitor.snapshot().quota).toBeNull()
  })

  it('on 401 marks stale without any refresh-retry (no OAuth anymore)', async () => {
    const fetchFn = vi.fn(async () => fetchResponse(401, {}))
    const monitor = new UsageMonitor({ pollMs: 60000, onUpdate: () => {}, resolveKey: async () => 'sk-abc', fetchFn: fetchFn as unknown as typeof fetch })
    await monitor.refresh()
    await monitor.refresh()
    expect(fetchFn).toHaveBeenCalledTimes(2)   // 每次 refresh 只拉一次，无重试
    expect(monitor.snapshot().quota).toBeNull()
  })

  it('on persistent failure keeps the old snapshot and marks it stale', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(fetchResponse(200, USAGES_OK))
      .mockResolvedValue(fetchResponse(500, {}))
    const monitor = new UsageMonitor({ pollMs: 60000, onUpdate: () => {}, resolveKey: async () => 'sk-abc', fetchFn: fetchFn as unknown as typeof fetch })
    await monitor.refresh()
    await monitor.refresh()
    expect(monitor.snapshot().quota?.stale).toBe(true)
  })

  it('throttles onUpdate notifications (2s window)', async () => {
    let now = 0
    const onUpdate = vi.fn()
    const fetchFn = vi.fn(async () => fetchResponse(200, USAGES_OK))
    const monitor = new UsageMonitor({ pollMs: 60000, onUpdate, resolveKey: async () => 'sk-abc', fetchFn: fetchFn as unknown as typeof fetch, now: () => now })
    await monitor.refresh()
    await monitor.refresh()
    expect(onUpdate).toHaveBeenCalledOnce()
    now = 3000
    await monitor.refresh()
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })

  it('passes an AbortSignal that aborts a hung request before the next poll tick', async () => {
    // 挂起的端点：只在 signal abort 时收场（评审 P1：裸 fetch 挂起 = refresh 永不返回）
    const fetchFn = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')))
    }))
    const monitor = new UsageMonitor({ pollMs: 50, onUpdate: () => {}, resolveKey: async () => 'sk-abc', fetchFn: fetchFn as unknown as typeof fetch })
    await monitor.refresh()   // 超时 = pollMs*0.8 = 40ms 后中止，refresh 正常失败收场
    expect(monitor.snapshot().quota).toBeNull()
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('a hung request that outlives the timeout marks a prior snapshot stale', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(fetchResponse(200, USAGES_OK))
      .mockImplementationOnce((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')))
      }))
    const monitor = new UsageMonitor({ pollMs: 50, onUpdate: () => {}, resolveKey: async () => 'sk-abc', fetchFn: fetchFn as unknown as typeof fetch })
    await monitor.refresh()
    await monitor.refresh()
    expect(monitor.snapshot().quota?.stale).toBe(true)
  })

  it('concurrent refresh folds into the in-flight fetch (no socket pile-up when the endpoint hangs)', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetchFn = vi.fn(async () => { await gate; return fetchResponse(200, USAGES_OK) })
    const monitor = new UsageMonitor({ pollMs: 60000, onUpdate: () => {}, resolveKey: async () => 'sk-abc', fetchFn: fetchFn as unknown as typeof fetch })
    const first = monitor.refresh()
    const second = monitor.refresh()   // 模拟 setInterval 到点触发而上一轮仍挂起
    release()
    await Promise.all([first, second])
    expect(fetchFn).toHaveBeenCalledOnce()
    expect(monitor.snapshot().quota?.weekly.used).toBe(9)
  })
})
