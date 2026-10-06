import { describe, expect, it } from 'vitest'
import { DispatchLedger } from '../src/dispatch-ledger.js'

const entry = (i: number, parentSession = 's1') => ({
  basis: 'role' as const, target: { provider: 'kimi-coding', model: 'k3' }, at: i, parentSession,
})

describe('DispatchLedger', () => {
  it('按父会话过滤、按时间倒序、每会话上限 20（他会话记账不挤占本会话名额）', () => {
    const ledger = new DispatchLedger()
    for (let i = 0; i < 25; i++) ledger.record(entry(i))
    ledger.record(entry(99, 's2'))
    const s1 = ledger.recentFor('s1')
    expect(s1).toHaveLength(20)
    expect(s1[0]!.at).toBe(24)          // 最新在前
    expect(ledger.recentFor('s2')).toHaveLength(1)
  })

  it('子代理 dispose 不得删掉父会话可见的行（一次性派发干完即销毁）', () => {
    const ledger = new DispatchLedger()
    ledger.record({ ...entry(1), agentId: 'child-1' })
    ledger.record({ ...entry(2), agentId: 'child-2' })
    ledger.dropSession('child-1') // 子代理自身销毁
    expect(ledger.recentFor('s1').map((e) => e.at)).toEqual([2, 1])
  })

  it('父会话 dispose 清掉其名下条目，不影响他会话', () => {
    const ledger = new DispatchLedger()
    ledger.record({ ...entry(1), agentId: 'child-1' })
    ledger.record({ ...entry(2, 's2'), agentId: 'child-2' })
    ledger.dropSession('s1') // 父会话（Lead）销毁
    expect(ledger.recentFor('s1')).toHaveLength(0)
    expect(ledger.recentFor('s2')).toHaveLength(1)
  })
})
