// @vitest-environment jsdom
/**
 * 面板取数回归锁（2026-09-10 实机故障：dock 永远「面板数据加载中」）。
 *
 * 故障一（信封错位，已修）：v1.2.0 dock 取数走命令通道，但解析只认
 * `payload.result.text` / `payload.text` 两种裸形；rc.1+ 的 typert 远端信封是
 * `{ ok, value }`（value = CommandExecution = `{ commandId, result: { kind, text } }`
 * ——产品侧同款读法：dsh-api-session-controller client.js `command()` 的
 * result.ok / result.value）。信封里取不到 text → 每次取数落 null。
 * 故障二（通道本身，已换道）：命令通道每次执行都被宿主持久化为
 * command/run + command/done（done 含整份面板 JSON）——8s 一次的轮询把会话流
 * 刷满 kimi-tide 命令节点、会话日志重新膨胀，打破「停止写面板事件」的初衷。
 * 现取数走 `/api/kimi-tide/panel` HTTP 只读路由（宿主 connection.fetch 注册，
 * 自带 browser-trust fence，零持久化）。
 *
 * unwrapCommandOutcome 仍保留：dock 动作（preset/refresh/review）继续走命令
 * 通道，其回包（含 kind=error）同样要剥壳上浮，不再静默吞掉。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'
import { tideDockPanelSource, unwrapCommandOutcome } from '../src/client/TideDock.js'
import type { KimiTidePanelProjection } from '../src/types.js'

const panel: KimiTidePanelProjection = {
  quota: null,
  quotaProvider: 'kimi-coding',
  kimi: { route: true, key: true },
  router: { activePreset: 'saving', presetName: '省钱', defaultTarget: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, ruleCount: 2 },
  reasoning: { enabled: true },
  configSource: 'settings',
  candidates: [],
  decision: null,
}

function makeCtx(execute: () => Promise<unknown>): never {
  return {
    get: () => undefined,
    effect: (fn: () => unknown) => fn(),
    slots: {
      inject: () => {},
      register: () => {},
    },
    remote: { commands: { execute } },
  } as never
}

describe('unwrapCommandOutcome：命令回包线形剥壳', () => {
  it('rc.1+ 信封 {ok,value}：value.commandId + result.kind=success + text → ok + 原文', () => {
    const outcome = unwrapCommandOutcome({
      ok: true,
      value: { commandId: 'c1', result: { kind: 'success', text: '{"quota":null}' } },
    })
    // Fails if: 信封内层不被展开（1.2.0 首版只认 payload.result.text / payload.text）
    expect(outcome).toEqual({ ok: true, text: '{"quota":null}' })
  })

  it('信封内 kind=error → ok=false + 错误原文（路由关闭/通道不可用）', () => {
    const outcome = unwrapCommandOutcome({
      ok: true,
      value: { commandId: 'c1', result: { kind: 'error', text: '面板快照不可用（路由关闭或取数失败）' } },
    })
    expect(outcome).toEqual({ ok: false, text: '面板快照不可用（路由关闭或取数失败）' })
  })

  it('远端拒绝 {ok:false,error:{message}} → ok=false + message', () => {
    expect(unwrapCommandOutcome({ ok: false, error: { message: 'denied' } })).toEqual({ ok: false, text: 'denied' })
  })

  it('error-only（无 ok 字段，0.6.x池#d 形态）→ ok=false + message', () => {
    expect(unwrapCommandOutcome({ error: { message: 'boom' } })).toEqual({ ok: false, text: 'boom' })
  })

  it('裸 CommandExecution / legacy {result} / 裸 {text} 三种直连形态都能剥出 text', () => {
    const execution = { commandId: 'c1', result: { kind: 'success', text: '{"a":1}' } }
    expect(unwrapCommandOutcome(execution)).toEqual({ ok: true, text: '{"a":1}' })
    expect(unwrapCommandOutcome({ result: { kind: 'success', text: '{"a":1}' } })).toEqual({ ok: true, text: '{"a":1}' })
    expect(unwrapCommandOutcome({ text: '{"a":1}' })).toEqual({ ok: true, text: '{"a":1}' })
  })

  it('ok=true 但无 text（如命令未匹配 value=undefined）→ {ok:true,text:""}；未知形态 → null', () => {
    expect(unwrapCommandOutcome({ ok: true, value: undefined })).toEqual({ ok: true, text: '' })
    expect(unwrapCommandOutcome('garbage')).toBeNull()
    expect(unwrapCommandOutcome(undefined)).toBeNull()
  })
})

describe('tideDockPanelSource.fetch：面板取数 HTTP 路由（/api/kimi-tide/panel）', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const applyWith = (): void => {
    const execute = vi.fn(async () => ({ ok: true, value: undefined }))
    apply(makeCtx(execute))
  }

  it('HTTP 200 + {ok:true,panel} → 解析出投影对象（取数换道回归锁）', async () => {
    applyWith()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, panel }),
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    // Fails if: 取数退回命令通道（每 8s 一次 command/run+command/done 持久化，
    // 会话流被命令节点刷屏、日志重新膨胀——2026-09-10 实机）或解析不出 panel。
    const result = await tideDockPanelSource.fetch('session-1')
    expect(result).not.toBeNull()
    expect(result?.router.activePreset).toBe('saving')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/kimi-tide/panel?sessionId=session-1',
      expect.objectContaining({ headers: expect.objectContaining({ accept: 'application/json' }) }),
    )
  })

  it('HTTP 非 200（409 会话未激活）/ body ok!=true / fetch 抛错 → 一律 null', async () => {
    applyWith()
    const cases: Array<unknown> = [
      { ok: false, status: 409 },
      { ok: true, json: async () => ({ ok: false, error: 'session not live' }) },
    ]
    for (const responseLike of cases) {
      globalThis.fetch = vi.fn(async () => responseLike) as unknown as typeof fetch
      expect(await tideDockPanelSource.fetch('session-1')).toBeNull()
    }
    globalThis.fetch = vi.fn(async () => { throw new Error('network down') }) as unknown as typeof fetch
    expect(await tideDockPanelSource.fetch('session-1')).toBeNull()
  })
})
