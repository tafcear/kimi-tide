import { describe, expect, it, vi } from 'vitest'
import { UsageMonitor } from '../src/usage.js'
import type { KimiOAuthManager } from '../src/oauth.js'

function fakeOAuth(token = 'tok'): KimiOAuthManager {
  return {
    getAccessToken: () => token,
    refresh: vi.fn(async () => true),
  } as unknown as KimiOAuthManager
}

const USAGES_OK = {
  usage: { used: 9, limit: 100, resetTime: 'w' },
  limits: [{ used: 10, limit: 100, resetTime: 'f' }],
  user: { membership: { level: 'LEVEL_INTERMEDIATE' } },
}

function fetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('UsageMonitor quota polling', () => {
  it('fetches usages and stores a fresh snapshot', async () => {
    const fetchFn = vi.fn(async () => fetchResponse(200, USAGES_OK))
    const monitor = new UsageMonitor(fakeOAuth(), { pollMs: 60000, onUpdate: () => {}, fetchFn: fetchFn as unknown as typeof fetch, now: () => 1000 })
    await monitor.refresh()
    const { quota } = monitor.snapshot()
    expect(quota?.weekly.used).toBe(9)
    expect(quota?.stale).toBe(false)
    expect(fetchFn).toHaveBeenCalledOnce()
    const url = String((fetchFn.mock.calls[0] as unknown[])[0])
    expect(url).toBe('https://api.kimi.com/coding/v1/usages')
  })

  it('on 401 refreshes the OAuth token and retries once', async () => {
    const oauth = fakeOAuth()
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(fetchResponse(401, {}))
      .mockResolvedValueOnce(fetchResponse(200, USAGES_OK))
    const monitor = new UsageMonitor(oauth, { pollMs: 60000, onUpdate: () => {}, fetchFn: fetchFn as unknown as typeof fetch })
    await monitor.refresh()
    expect(oauth.refresh).toHaveBeenCalledOnce()
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(monitor.snapshot().quota?.weekly.used).toBe(9)
  })

  it('on persistent failure keeps the old snapshot and marks it stale', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(fetchResponse(200, USAGES_OK))
      .mockResolvedValue(fetchResponse(500, {}))
    const monitor = new UsageMonitor(fakeOAuth(), { pollMs: 60000, onUpdate: () => {}, fetchFn: fetchFn as unknown as typeof fetch })
    await monitor.refresh()
    await monitor.refresh()
    const { quota } = monitor.snapshot()
    expect(quota?.weekly.used).toBe(9)
    expect(quota?.stale).toBe(true)
  })

  it('throttles onUpdate notifications (2s window)', async () => {
    let now = 0
    const onUpdate = vi.fn()
    const fetchFn = vi.fn(async () => fetchResponse(200, USAGES_OK))
    const monitor = new UsageMonitor(fakeOAuth(), { pollMs: 60000, onUpdate, fetchFn: fetchFn as unknown as typeof fetch, now: () => now })
    await monitor.refresh()
    await monitor.refresh()
    expect(onUpdate).toHaveBeenCalledOnce()
    now = 3000
    await monitor.refresh()
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })
})

describe('UsageMonitor local token stats', () => {
  it('accumulates today/session buckets and call count', () => {
    const monitor = new UsageMonitor(fakeOAuth(), { pollMs: 60000, onUpdate: () => {}, now: () => Date.parse('2026-08-17T10:00:00') })
    monitor.tapUsage({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 20 })
    monitor.tapUsage({ inputTokens: 30, outputTokens: 10 })
    const { local } = monitor.snapshot()
    expect(local.calls).toBe(2)
    expect(local.today).toEqual({ inputTokens: 130, outputTokens: 60, cacheReadTokens: 20 })
    expect(local.session.inputTokens).toBe(130)
  })

  it('resets the today bucket across a local-day boundary', () => {
    let now = Date.parse('2026-08-17T23:59:00')
    const monitor = new UsageMonitor(fakeOAuth(), { pollMs: 60000, onUpdate: () => {}, now: () => now })
    monitor.tapUsage({ inputTokens: 100, outputTokens: 0 })
    now = Date.parse('2026-08-18T00:01:00')
    monitor.tapUsage({ inputTokens: 5, outputTokens: 0 })
    const { local } = monitor.snapshot()
    expect(local.today.inputTokens).toBe(5)
    expect(local.session.inputTokens).toBe(105)
  })
})
