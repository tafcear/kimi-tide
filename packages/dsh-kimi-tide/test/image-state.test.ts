import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ImageStateStore } from '../src/image-state.js'
import type { RouteTarget } from '../src/config.js'

/** WeakMap 键只需引用语义：普通对象钉桩即可。 */
const agentA = {} as Agent
const agentB = {} as Agent

const k3: RouteTarget = { provider: 'kimi-coding', model: 'k3' }

describe('ImageStateStore', () => {
  it('mark/get 三态往返：native/transcribed/blind 各自读回', () => {
    const s = new ImageStateStore()
    s.mark(agentA, 'img-1', 'native')
    s.mark(agentA, 'img-2', 'transcribed')
    s.mark(agentA, 'img-3', 'blind')
    expect(s.get(agentA, 'img-1')).toEqual({ state: 'native' })
    expect(s.get(agentA, 'img-2')).toEqual({ state: 'transcribed' })
    expect(s.get(agentA, 'img-3')).toEqual({ state: 'blind' })
  })

  it('未标记的 attachmentId 返回 undefined', () => {
    const s = new ImageStateStore()
    expect(s.get(agentA, 'img-x')).toBeUndefined()
  })

  it('native() 只列 native 且保持插入序（先标先列）', () => {
    const s = new ImageStateStore()
    s.mark(agentA, 'a', 'transcribed')
    s.mark(agentA, 'b', 'native')
    s.mark(agentA, 'c', 'blind')
    s.mark(agentA, 'd', 'native')
    expect(s.native(agentA).map(([id, e]) => [id, e.state])).toEqual([
      ['b', 'native'],
      ['d', 'native'],
    ])
  })

  it('counts 汇总三类数量；无记录 agent 为全零', () => {
    const s = new ImageStateStore()
    s.mark(agentA, 'a', 'native')
    s.mark(agentA, 'b', 'native')
    s.mark(agentA, 'c', 'transcribed')
    s.mark(agentA, 'd', 'blind')
    expect(s.counts(agentA)).toEqual({ native: 2, transcribed: 1, blind: 1 })
    expect(s.counts(agentB)).toEqual({ native: 0, transcribed: 0, blind: 0 })
  })

  it('transcribed/blind 覆盖 native 后 native() 不再列出且计数随之变化', () => {
    const s = new ImageStateStore()
    s.mark(agentA, 'a', 'native')
    s.mark(agentA, 'b', 'native')
    s.mark(agentA, 'a', 'transcribed')
    expect(s.native(agentA).map(([id]) => id)).toEqual(['b'])
    expect(s.counts(agentA)).toEqual({ native: 1, transcribed: 1, blind: 0 })
    s.mark(agentA, 'b', 'blind')
    expect(s.native(agentA)).toEqual([])
    expect(s.counts(agentA)).toEqual({ native: 0, transcribed: 1, blind: 1 })
  })

  it('不同 agent 完全隔离（WeakMap 语义：同 attachmentId 互不可见）', () => {
    const s = new ImageStateStore()
    s.mark(agentA, 'img-1', 'native')
    expect(s.get(agentB, 'img-1')).toBeUndefined()
    expect(s.native(agentB)).toEqual([])
    expect(s.counts(agentB)).toEqual({ native: 0, transcribed: 0, blind: 0 })
    s.mark(agentB, 'img-1', 'blind')
    expect(s.get(agentA, 'img-1')).toEqual({ state: 'native' })
    expect(s.get(agentB, 'img-1')).toEqual({ state: 'blind' })
  })

  it('latchTarget 仅随 native 携带；覆盖为 transcribed/blind 时被清除（mark 整体替换条目）', () => {
    const s = new ImageStateStore()
    s.mark(agentA, 'img-1', 'native', k3)
    expect(s.get(agentA, 'img-1')).toEqual({ state: 'native', latchTarget: k3 })
    // 覆盖为 transcribed：条目整体替换，latchTarget 一并清除
    s.mark(agentA, 'img-1', 'transcribed')
    const e = s.get(agentA, 'img-1')
    expect(e?.state).toBe('transcribed')
    expect(e?.latchTarget).toBeUndefined()
    // 覆盖回 native 不传 latchTarget：条目仍无 latchTarget（可清除语义对称）
    s.mark(agentA, 'img-1', 'native')
    expect(s.get(agentA, 'img-1')).toEqual({ state: 'native' })
  })

  it('demoteUnbackedTranscribed：缓存落空（LRU 逐出）的 transcribed 条目降级回 native 且保留 latchTarget', () => {
    // 评审修复 2026-08-23：进程级转述 LRU 逐出后，状态表 transcribed 条目
    // 的投影 peek 落空（图块原样进 text-only 请求）。降级回 native 让
    // lazy/latch 回退路径重新接管；latchTarget 随之复活（latch 不回溯更早
    // 条目，故条目必须自带 latchTarget 才可改道）。
    const s = new ImageStateStore()
    s.mark(agentA, 'img-1', 'native', k3)
    s.mark(agentA, 'img-1', 'transcribed', k3) // 调用方保留 latchTarget 的形态
    s.mark(agentA, 'img-2', 'transcribed')
    s.mark(agentA, 'img-3', 'blind')
    s.mark(agentA, 'img-4', 'native', k3)
    // img-2 仍有缓存背书；img-1 落空
    const demoted = s.demoteUnbackedTranscribed(agentA, (id) => id === 'img-2')
    expect(demoted).toEqual(['img-1'])
    expect(s.get(agentA, 'img-1')).toEqual({ state: 'native', latchTarget: k3 })
    expect(s.get(agentA, 'img-2')?.state).toBe('transcribed')
    expect(s.get(agentA, 'img-3')?.state).toBe('blind') // blind 不参与
    expect(s.get(agentA, 'img-4')).toEqual({ state: 'native', latchTarget: k3 }) // 本就 native 不动
    // 无记录 agent → 空
    expect(s.demoteUnbackedTranscribed(agentB, () => false)).toEqual([])
  })
})
