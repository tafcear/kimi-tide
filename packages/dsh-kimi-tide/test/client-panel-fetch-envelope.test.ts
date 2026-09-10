// @vitest-environment jsdom
/**
 * 面板取数回包剥壳回归锁（2026-09-10 实机故障：dock 永远「面板数据加载中」）。
 *
 * 实机故障：v1.2.0 dock 取数改走 `/kimi-tide panel --json` 命令通道，但解析只认
 * `payload.result.text` / `payload.text` 两种裸形；而 rc.1+ 的 typert 远端信封是
 * `{ ok, value }`（value = CommandExecution = `{ commandId, result: { kind, text } }`
 * ——产品侧同款读法：dsh-api-session-controller client.js `command()` 的
 * result.ok / result.value）。信封里取不到 text → 每次取数落 null → dock 无投影
 * 兜底（新会话不写面板事件）→ 永远「加载中」。
 *
 * 契约（unwrapCommandOutcome / tideDockPanelSource.fetch，每个用例标注「会使其
 * 失败的生产改动」）：信封、裸 CommandExecution、legacy 裸形、error-only、
 * 远端拒绝五种线形都要落对；kind='error' 与 ok=false 一律降级为 null。
 */
import { describe, expect, it, vi } from 'vitest'
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

describe('tideDockPanelSource.fetch：dock 取数通道（信封剥壳后解析）', () => {
  it('信封 {ok,value} 里的面板 JSON 被解析成投影对象（实机故障回归锁）', async () => {
    const execute = vi.fn(async () => ({
      ok: true,
      value: { commandId: 'c1', result: { kind: 'success', text: JSON.stringify(panel) } },
    }))
    apply(makeCtx(execute))
    // Fails if: 解析退回只认 payload.result.text / payload.text——信封内取不到 text，
    // fetch 恒 null → dock 永远「面板数据加载中」（2026-09-10 实机故障本体）。
    const result = await tideDockPanelSource.fetch('session-1')
    expect(result).not.toBeNull()
    expect(result?.router.activePreset).toBe('saving')
    expect(execute).toHaveBeenCalledWith('session-1', '/kimi-tide panel --json')
  })

  it('kind=error / ok=false / execute 抛错 / value 缺失 → 一律 null（dock 保留上一帧）', async () => {
    const cases: Array<() => Promise<unknown>> = [
      async () => ({ ok: true, value: { commandId: 'c', result: { kind: 'error', text: '面板快照不可用' } } }),
      async () => ({ ok: false, error: { message: 'denied' } }),
      async () => { throw new Error('rpc down') },
      async () => ({ ok: true, value: undefined }),
      async () => undefined,
    ]
    for (const executeImpl of cases) {
      apply(makeCtx(vi.fn(executeImpl)))
      expect(await tideDockPanelSource.fetch('session-1')).toBeNull()
    }
  })
})
