import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { KimiSessionManager, type KimiManagerConfig } from '../src/kimi-manager.js'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'

/** The fake kimi binary (see test/fixtures/fake-kimi.mjs). */
const FAKE_KIMI = fileURLToPath(new URL('./fixtures/fake-kimi.mjs', import.meta.url))

interface FakeSession extends Session {
  events: Array<{ type: string; data: unknown }>
}

function fakeSession(id = 'sess-1'): FakeSession {
  const events: Array<{ type: string; data: unknown }> = []
  return {
    id: id as Session['id'],
    events,
    seq: 0,
    header: { createdAt: Date.now(), cwd: '/tmp' },
    append(type: string, data: unknown) {
      events.push({ type, data })
      return {}
    },
  } as FakeSession
}

function fakeAgent(session: FakeSession, id = 'agent-1'): Agent {
  return { id, session, whenIdle: async () => {} } as Agent
}

function stubCtx(agent: Agent): unknown {
  return { agents: { roots: () => [agent], list: () => [agent], get: () => undefined } }
}

function config(overrides: Partial<KimiManagerConfig> = {}): KimiManagerConfig {
  return {
    kimiPath: FAKE_KIMI,
    reviewOnly: false,
    kimiHome: '',
    reviewHomeDir: '',
    maxTimeoutMs: 60 * 1000,
    defaultTimeoutMs: 0,
    maxParallel: 3,
    maxSessionsPerSession: 8,
    maxRetained: 16,
    maxPromptChars: 4096,
    maxTranscriptChars: 64 * 1024,
    maxLoopSteps: 64,
  maxLoopBytes: 16 * 1024,
    allowedAgents: 'roots',
    killGraceMs: 200,
    ...overrides,
  }
}

async function settled(manager: KimiSessionManager, agent: Agent, id: string): Promise<import('../src/types.js').KimiSessionView> {
  const out = await manager.waitFor(agent, id, new AbortController().signal)
  if (out === 'cancelled') assert.fail('waitFor cancelled unexpectedly')
  return out
}

test('ask (async) returns queued; the session settles done with the final answer', async () => {
  const session = fakeSession()
  const agent = fakeAgent(session)
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  const record = manager.ask(agent, { prompt: 'hi' })
  // ask() spawns synchronously, so the returned record may already be running.
  assert.ok(record.status === 'queued' || record.status === 'running', `status was ${record.status}`)
  const final = await settled(manager, agent, record.id)
  assert.equal(final.status, 'done')
  assert.equal(final.answer, 'final answer')
  assert.equal(final.kimiId, 'session_8b846be9-323a-4dc5-82d7-b3886f2434b4')
  assert.ok(final.transcript.includes('first message'))
  assert.ok(final.transcript.includes('final answer'))
  assert.equal(final.exitCode, 0)
  // Events were appended to the session log (queued + running + session_meta + final).
  const statuses = session.events.map(e => (e.data as { status?: string }).status)
  assert.ok(statuses.includes('queued'))
  assert.ok(statuses.includes('done'))
})

test('block wait on a previously started async session returns the completed record', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  const record = manager.ask(agent, { prompt: 'hi' })
  const final = await settled(manager, agent, record.id)
  assert.equal(final.status, 'done')
})

test('non-zero exit settles as error with stderr detail', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  process.env.FAKE_KIMI_FAIL = '1'
  try {
    const record = manager.ask(agent, { prompt: 'hi' })
    const final = await settled(manager, agent, record.id)
    assert.equal(final.status, 'error')
    assert.equal(final.exitCode, 3)
    assert.ok(final.error?.includes('boom from fake kimi'))
  } finally {
    delete process.env.FAKE_KIMI_FAIL
  }
})

test('abort settles the session as aborted', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  process.env.FAKE_KIMI_DELAY_MS = '500'
  try {
    const record = manager.ask(agent, { prompt: 'hi' })
    await new Promise(r => setTimeout(r, 150))
    const outcome = manager.abort(agent, record.id)
    assert.equal(outcome, 'aborted')
    const final = await settled(manager, agent, record.id)
    assert.equal(final.status, 'aborted')
    assert.equal(final.error, 'aborted')
  } finally {
    delete process.env.FAKE_KIMI_DELAY_MS
  }
})

test('abort of an unknown id is not-found', () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  assert.equal(manager.abort(agent, 'kimi-nope'), 'not-found')
})

test('maxParallel budget rejects the next ask', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config({ maxParallel: 1 }))
  const first = manager.ask(agent, { prompt: 'hi', mode: 'async' })
  // Second ask while the first is still running (fake kimi takes 50ms+).
  assert.throws(() => manager.ask(agent, { prompt: 'again' }), /maxParallel/)
  const final = await settled(manager, agent, first.id)
  assert.equal(final.status, 'done')
  // Slot freed: a new ask now succeeds.
  const third = manager.ask(agent, { prompt: 'third' })
  const thirdFinal = await settled(manager, agent, third.id)
  assert.equal(thirdFinal.status, 'done')
})

test('list returns the sessions oldest first', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config({ maxParallel: 3 }))
  const a = manager.ask(agent, { prompt: 'a' })
  const b = manager.ask(agent, { prompt: 'b' })
  const ids = manager.list(agent).map(s => s.id)
  assert.deepEqual(ids, [a.id, b.id])
  await settled(manager, agent, b.id)
})

test('disposeSession kills running sessions for that dsh session', async () => {
  const agent = fakeAgent(fakeSession('sess-kill'))
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  process.env.FAKE_KIMI_DELAY_MS = '500'
  try {
    const record = manager.ask(agent, { prompt: 'hi' })
    await new Promise(r => setTimeout(r, 150))
    manager.disposeSession('sess-kill')
    const final = await settled(manager, agent, record.id)
    assert.equal(final.status, 'aborted')
  } finally {
    delete process.env.FAKE_KIMI_DELAY_MS
  }
})

test('reconcile marks stale queued/running records as host_restarted on first touch', async () => {
  // Simulate a previous host process: a folded projection carries a running
  // record with no live handle (the snapshot reader returns it).
  const session = fakeSession('sess-restart')
  const agent = fakeAgent(session)
  const stale: import('../src/types.js').KimiSessionView = {
    id: 'kimi-stale',
    status: 'running',
    prompt: 'old prompt',
    cwd: '/tmp',
    createdAt: 1000,
    startedAt: 2000,
    transcript: '',
    loop: [],
    timeoutMs: 0,
  }
  // Simulate the real fold: appended events replace the record the reader sees.
  let records: import('../src/types.js').KimiSessionView[] = [stale]
  const snapshotReader = () => {
    const last = session.events
      .filter(e => e.type === 'kimi/session')
      .map(e => e.data as import('../src/types.js').KimiSessionView).at(-1)
    if (last !== undefined) records = [last]
    return { sessions: records }
  }
  const manager = new KimiSessionManager(stubCtx(agent) as never, config(), snapshotReader)
  manager.list(agent)
  const appended = session.events
    .filter(e => e.type === 'kimi/session')
    .map(e => e.data as import('../src/types.js').KimiSessionView)
  assert.equal(appended.length, 1)
  assert.equal(appended[0]?.id, 'kimi-stale')
  assert.equal(appended[0]?.status, 'error')
  assert.equal(appended[0]?.error, 'host_restarted')
  // Idempotent: a second touch does not re-append (the fold now carries the error).
  manager.list(agent)
  assert.equal(session.events.filter(e => e.type === 'kimi/session').length, 1)
})

test('list merges folded history with live buckets', async () => {
  const session = fakeSession('sess-merge')
  const agent = fakeAgent(session)
  const folded: import('../src/types.js').KimiSessionView = {
    id: 'kimi-old',
    status: 'done',
    prompt: 'old',
    cwd: '/tmp',
    createdAt: 100,
    transcript: '',
    loop: [],
    timeoutMs: 0,
  }
  const manager = new KimiSessionManager(stubCtx(agent) as never, config(), () => ({ sessions: [folded] }))
  const live = manager.ask(agent, { prompt: 'new' })
  const ids = manager.list(agent).map(s => s.id)
  assert.deepEqual(ids, ['kimi-old', live.id])
  await settled(manager, agent, live.id)
})

test('timeout aborts the session as aborted with error timeout', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config({ defaultTimeoutMs: 120 }))
  process.env.FAKE_KIMI_DELAY_MS = '800'
  try {
    const record = manager.ask(agent, { prompt: 'hi' })
    const final = await settled(manager, agent, record.id)
    assert.equal(final.status, 'aborted')
    assert.equal(final.error, 'timeout')
  } finally {
    delete process.env.FAKE_KIMI_DELAY_MS
  }
})

test('block wait cancelled by the caller signal stops the session (killOnCancel)', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  process.env.FAKE_KIMI_DELAY_MS = '800'
  const controller = new AbortController()
  try {
    const record = manager.ask(agent, { prompt: 'hi' })
    setTimeout(() => controller.abort(), 120)
    const out = await manager.waitFor(agent, record.id, controller.signal, { killOnCancel: true })
    assert.notEqual(out, 'cancelled')
    assert.equal((out as import('../src/types.js').KimiSessionView).status, 'aborted')
  } finally {
    delete process.env.FAKE_KIMI_DELAY_MS
  }
})

test('stdin EPIPE (child exits before reading) does not crash and settles', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  process.env.FAKE_KIMI_EXIT_EARLY = '1'
  try {
    const record = manager.ask(agent, { prompt: 'hi' })
    // The test completing at all proves the unhandled-'error' crash is fixed.
    const final = await settled(manager, agent, record.id)
    assert.ok(final.status === 'done' || final.status === 'error', `status was ${final.status}`)
  } finally {
    delete process.env.FAKE_KIMI_EXIT_EARLY
  }
})

test('prompt above maxPromptChars is rejected', () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config({ maxPromptChars: 16 }))
  assert.throws(() => manager.ask(agent, { prompt: 'x'.repeat(17) }), /maxPromptChars/)
})

test('a session without a working directory fails closed (no process.cwd fallback)', () => {
  const session = fakeSession()
  ;(session.header as { cwd?: string }).cwd = undefined
  const agent = fakeAgent(session)
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  assert.throws(() => manager.ask(agent, { prompt: 'hi' }), /session-cwd-unavailable/)
})

test('maxRetained evicts the oldest settled record with a durable kimi/evict tombstone', async () => {
  const session = fakeSession()
  const agent = fakeAgent(session)
  const manager = new KimiSessionManager(stubCtx(agent) as never, config({ maxRetained: 1 }))
  const a = manager.ask(agent, { prompt: 'a' })
  await settled(manager, agent, a.id)
  const b = manager.ask(agent, { prompt: 'b' })
  await settled(manager, agent, b.id)
  const evicts = session.events
    .filter(e => e.type === 'kimi/evict')
    .map(e => e.data as { ids: string[] })
  assert.ok(evicts.some(e => e.ids.includes(a.id)), 'oldest id must be tombstoned')
  // The live bucket no longer holds the evicted id.
  const ids = manager.list(agent).map(s => s.id)
  assert.ok(!ids.includes(a.id), 'evicted id must not be listed')
})

test('steer resumes a settled parent on the same thread', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  const parent = manager.ask(agent, { prompt: 'original question' })
  const parentFinal = await settled(manager, agent, parent.id)
  assert.equal(parentFinal.status, 'done')
  assert.ok(parentFinal.kimiId !== undefined)

  const child = manager.steer(agent, { kimi_session_id: parent.id, prompt: 'now do it differently' })
  assert.equal(child.kind, 'steer')
  assert.equal(child.parent, parent.id)
  assert.equal(child.kimiId, parentFinal.kimiId) // same thread
  assert.equal(child.cwd, parentFinal.cwd)
    const childFinal = await settled(manager, agent, child.id)
  assert.equal(childFinal.status, 'done')
  assert.ok(childFinal.answer?.includes('resumed'), 'resume path must have run')
})

test('steer rejects an unsettled parent', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  process.env.FAKE_KIMI_DELAY_MS = '400'
  try {
    const parent = manager.ask(agent, { prompt: 'hi' })
    await new Promise(r => setTimeout(r, 60))
    assert.throws(() => manager.steer(agent, { kimi_session_id: parent.id, prompt: 'go' }), /parent-running/)
  } finally {
    delete process.env.FAKE_KIMI_DELAY_MS
  }
})

test('steer rejects an unknown parent and a parent without a thread id', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  assert.throws(() => manager.steer(agent, { kimi_session_id: 'kimi-nope', prompt: 'go' }), /parent-not-found/)

  // A settled folded record without a kimiId is not resumable.
  const noThread: import('../src/types.js').KimiSessionView = {
    id: 'kimi-nothread',
    status: 'done',
    prompt: 'old',
    cwd: '/tmp',
    createdAt: 100,
    transcript: '',
    loop: [],
    timeoutMs: 0,
  }
  const reader = () => ({ sessions: [noThread] })
  const m2 = new KimiSessionManager(stubCtx(agent) as never, config(), reader)
  assert.throws(() => m2.steer(agent, { kimi_session_id: 'kimi-nothread', prompt: 'go' }), /parent-not-resumable/)
})

test('steer works on a post-restart parent (folded history only)', async () => {
  const session = fakeSession('sess-steer-restart')
  const agent = fakeAgent(session)
  const folded: import('../src/types.js').KimiSessionView = {
    id: 'kimi-old',
    status: 'done',
    prompt: 'old',
    cwd: '/tmp',
    kimiId: 'session_8b846be9-323a-4dc5-82d7-b3886f2434b4',
    createdAt: 100,
    transcript: '',
    loop: [],
    timeoutMs: 0,
  }
  const manager = new KimiSessionManager(stubCtx(agent) as never, config(), () => ({ sessions: [folded] }))
  const child = manager.steer(agent, { kimi_session_id: 'kimi-old', prompt: 'continue' })
  assert.equal(child.parent, 'kimi-old')
  const childFinal = await settled(manager, agent, child.id)
  assert.equal(childFinal.status, 'done')
  assert.ok(childFinal.answer?.includes('resumed'))
})

test('steer is single-flight per thread (session-busy while a continuation runs)', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  process.env.FAKE_KIMI_DELAY_MS = '500'
  try {
    const parent = manager.ask(agent, { prompt: 'original' })
    await settled(manager, agent, parent.id)
    const first = manager.steer(agent, { kimi_session_id: parent.id, prompt: 'continue 1' })
    await new Promise(r => setTimeout(r, 120))
    // Second steer on the SAME thread while the first continuation runs.
    assert.throws(() => manager.steer(agent, { kimi_session_id: parent.id, prompt: 'continue 2' }), /session-busy/)
    await settled(manager, agent, first.id)
  } finally {
    delete process.env.FAKE_KIMI_DELAY_MS
  }
})

test('steer rejects an old ancestor (stale-parent; the thread is linear)', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  const parent = manager.ask(agent, { prompt: 'original' })
  await settled(manager, agent, parent.id)
  const head = manager.steer(agent, { kimi_session_id: parent.id, prompt: 'continue' })
  await settled(manager, agent, head.id)
  // Resuming the ORIGINAL (no longer the thread head) must be rejected.
  assert.throws(() => manager.steer(agent, { kimi_session_id: parent.id, prompt: 'again' }), /stale-parent/)
})

test('steer settles as session-mismatch when resume returns a different session id', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  try {
    const parent = manager.ask(agent, { prompt: 'original' })
    await settled(manager, agent, parent.id)
    // Mismatch applies to the resume run only (the parent already settled).
    process.env.FAKE_KIMI_SESSION_MISMATCH = '1'
    const child = manager.steer(agent, { kimi_session_id: parent.id, prompt: 'go' })
    const final = await settled(manager, agent, child.id)
    assert.equal(final.status, 'error')
    assert.equal(final.error, 'session-mismatch')
  } finally {
    delete process.env.FAKE_KIMI_SESSION_MISMATCH
  }
})

test('prompt with a NUL character is rejected', () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  assert.throws(() => manager.ask(agent, { prompt: 'a\u0000b' }), /NUL/)
})

test('exit 0 without the resume_hint marker settles as protocol-error', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  process.env.FAKE_KIMI_NO_RESUME_HINT = '1'
  try {
    const record = manager.ask(agent, { prompt: 'hi' })
    const final = await settled(manager, agent, record.id)
    assert.equal(final.status, 'error')
    assert.ok(final.error?.startsWith('protocol-error'), `error was ${final.error}`)
  } finally {
    delete process.env.FAKE_KIMI_NO_RESUME_HINT
  }
})

test('loop captures kimi steps (messages + tool_calls + tool results)', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config())
  const record = manager.ask(agent, { prompt: 'hi' })
  const final = await settled(manager, agent, record.id)
  const kinds = final.loop.map(s => s.kind)
  assert.ok(kinds.includes('message'), `kinds: ${kinds.join(',')}`)
  assert.ok(kinds.includes('tool'), `kinds: ${kinds.join(',')}`)
  const toolRow = final.loop.find(s => s.kind === 'tool')
  assert.equal(toolRow?.tool, 'Bash')
  assert.equal(toolRow?.status, 'done')
  assert.ok(toolRow?.outputPreview !== undefined)
})

test('loop is a bounded sliding window (maxLoopSteps evicts the oldest steps)', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config({ maxLoopSteps: 3 }))
  const record = manager.ask(agent, { prompt: 'hi' })
  const final = await settled(manager, agent, record.id)
  assert.ok(final.loop.length <= 3, `loop length was ${final.loop.length}`)
})

test('loop window respects the serialized-byte cap', async () => {
  const agent = fakeAgent(fakeSession())
  const manager = new KimiSessionManager(stubCtx(agent) as never, config({ maxLoopBytes: 8 * 1024 }))
  const record = manager.ask(agent, { prompt: 'hi' })
  const final = await settled(manager, agent, record.id)
  const bytes = Buffer.byteLength(JSON.stringify(final), 'utf8')
  assert.ok(bytes <= 8 * 1024, `record serialized to ${bytes} bytes (cap 8KiB)`)
})
