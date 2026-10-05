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

  it('dropAgent 清掉该 agent 的记账（agent/disposed 用）', () => {
    const ledger = new DispatchLedger()
    ledger.record({ ...entry(1), agentId: 'a1' })
    ledger.record({ ...entry(2), agentId: 'a2' })
    ledger.dropAgent('a1')
    expect(ledger.recentFor('s1').every((e) => e.agentId !== 'a1')).toBe(true)
  })
})
