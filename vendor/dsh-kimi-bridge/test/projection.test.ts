import assert from 'node:assert/strict'
import { test } from 'node:test'
import { kimiProjectionDefinition } from '../src/projection.js'
import type { KimiSessionView } from '../src/types.js'

function kimiEvent(overrides: Partial<KimiSessionView> & { id: string }): Parameters<typeof apply>[1] {
  return {
    type: 'kimi/session',
    seq: 1,
    time: Date.now(),
    data: {
      status: 'running',
      prompt: 'p',
      cwd: '/tmp',
            createdAt: 1000,
      transcript: '',
      loop: [],
      timeoutMs: 0,
      ...overrides,
    },
  }
}

// Local alias to keep the fold test readable.
const apply = kimiProjectionDefinition.apply
const view = kimiProjectionDefinition.view
const init = kimiProjectionDefinition.init

test('init starts empty', () => {
  assert.deepEqual(init(), { sessions: {} })
})

test('folds kimi/session events into the map (whole-value overwrite)', () => {
  let state = init()
  state = apply(state, kimiEvent({ id: 'a', status: 'queued' }))
  state = apply(state, kimiEvent({ id: 'a', status: 'running' }))
  state = apply(state, kimiEvent({ id: 'b', status: 'done' }))
  assert.deepEqual(Object.keys(state.sessions).sort(), ['a', 'b'])
  assert.equal(state.sessions['a']?.status, 'running')
  assert.equal(state.sessions['b']?.status, 'done')
})

test('ignores unrelated events (same state reference → zero downstream work)', () => {
  let state = init()
  state = apply(state, kimiEvent({ id: 'a' }))
  const unrelated = {
    type: 'user/message' as const,
    seq: 2,
    time: Date.now(),
    data: {},
  }
  assert.equal(apply(state, unrelated as never), state)
})

test('view returns sessions sorted by createdAt', () => {
  let state = init()
  state = apply(state, kimiEvent({ id: 'later', createdAt: 2000 }))
  state = apply(state, kimiEvent({ id: 'earlier', createdAt: 500 }))
  const projection = view(state)
  assert.deepEqual(projection.sessions.map(s => s.id), ['earlier', 'later'])
})

test('folds kimi/evict tombstones by dropping ids', () => {
  let state = init()
  state = apply(state, kimiEvent({ id: 'a' }))
  state = apply(state, kimiEvent({ id: 'b' }))
  const evict = { type: 'kimi/evict' as const, seq: 3, time: Date.now(), data: { ids: ['a'] } }
  state = apply(state, evict as never)
  assert.deepEqual(Object.keys(state.sessions), ['b'])
  assert.deepEqual(view(state).sessions.map(s => s.id), ['b'])
})

test('the view output passes the unit schema (wire-ready)', () => {
  let state = init()
  state = apply(state, kimiEvent({ id: 'a', status: 'done', answer: 'ok', exitCode: 0, finishedAt: 2000, durationMs: 1000 }))
  const projection = view(state)
  const parsed = kimiProjectionDefinition.schema.parse(projection)
  assert.equal(parsed.sessions[0]?.id, 'a')
  assert.equal(parsed.sessions[0]?.answer, 'ok')
})
