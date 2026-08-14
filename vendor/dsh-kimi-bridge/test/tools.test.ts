/**
 * Tool-contract tests for call_kimi / kimi_status / kimi_abort.
 *
 * These import @deepseek-ai/dsh-tools at runtime, which resolves only inside
 * the harness — the runner (scripts/test.mjs) probes and skips this file
 * standalone, so it must also skip itself gracefully when the import fails.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { defineAskKimiTool, defineKimiAbortTool, defineKimiStatusTool, defineKimiSteerTool } from '../src/tools.js'
import type { KimiToolResult } from '../src/types.js'
import { KimiSessionManager } from '../src/kimi-manager.js'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'

const FAKE_KIMI = fileURLToPath(new URL('./fixtures/fake-kimi.mjs', import.meta.url))

function fakeSession(): Session {
  return {
    id: 'sess-1' as Session['id'],
    events: [],
    seq: 0,
    header: { createdAt: Date.now(), cwd: '/tmp' },
    append: () => ({}),
  } as Session
}

function fakeAgent(): Agent {
  const session = fakeSession()
  return { id: 'agent-1', session, whenIdle: async () => {} } as Agent
}

const agent = fakeAgent()
const ctx = { agents: { roots: () => [agent], list: () => [agent], get: () => undefined } }
const manager = new KimiSessionManager(ctx as never, {
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
})
const exec = { agent, signal: new AbortController().signal } as never

test('call_kimi async returns started immediately', async () => {
  const tool = defineAskKimiTool(manager)
  const result = await tool.execute({ prompt: 'hi', mode: 'async' } as never, exec) as KimiToolResult
  assert.equal(result.status, 'started')
  assert.ok(String(result.kimi_session_id).startsWith('kimi-'))
})

test('call_kimi block waits and returns the final answer', async () => {
  const tool = defineAskKimiTool(manager)
  const result = await tool.execute({ prompt: 'hi', mode: 'block' } as never, exec) as KimiToolResult
  assert.equal(result.status, 'completed')
  assert.equal(result.answer, 'final answer')
})

test('kimi_status lists sessions', async () => {
  const tool = defineKimiStatusTool(manager)
  const result = await tool.execute({} as never, exec) as KimiToolResult
  assert.equal(result.status, 'list')
  assert.ok(Array.isArray(result.kimi_sessions))
})

test('kimi_abort aborts a known session', async () => {
  const ask = defineAskKimiTool(manager)
  const started = await ask.execute({ prompt: 'hi', mode: 'async' } as never, exec) as Extract<KimiToolResult, { status: 'started' }>
  const tool = defineKimiAbortTool(manager)
  const result = await tool.execute({ kimi_session_id: started.kimi_session_id } as never, exec) as KimiToolResult
  assert.equal(result.status, 'aborted')
})

test('call_kimi with unknown kimi_session_id returns not-found', async () => {
  const tool = defineAskKimiTool(manager)
  const result = await tool.execute({ prompt: 'hi', mode: 'block', kimi_session_id: 'kimi-nope' } as never, exec) as KimiToolResult
  assert.equal(result.status, 'not-found')
})

test('kimi_abort declares isConcurrencySafe', () => {
  const tool = defineKimiAbortTool(manager)
  assert.equal(tool.isConcurrencySafe?.({ kimi_session_id: 'kimi-x' } as never), true)
})

test('all three tools enforce the root fence (non-root agent denied)', async () => {
  const subagent = { id: 'agent-sub', session: fakeSession(), whenIdle: async () => {} } as Agent
  const ctxRoot = { agents: { roots: () => [agent], list: () => [agent, subagent], get: () => undefined } }
  const m = new KimiSessionManager(ctxRoot as never, {
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
    maxTranscriptChars: 16 * 1024,
    maxLoopSteps: 64,
  maxLoopBytes: 16 * 1024,
    allowedAgents: 'roots',
    killGraceMs: 200,
  })
  const subExec = { agent: subagent, signal: new AbortController().signal } as never

  const ask = defineAskKimiTool(m)
  const asked = await ask.execute({ prompt: 'hi', mode: 'async' } as never, subExec) as KimiToolResult
  assert.equal(asked.status, 'error')
  assert.equal(asked.error, 'agent-not-allowed')

  const status = defineKimiStatusTool(m)
  const listed = await status.execute({} as never, subExec) as KimiToolResult
  assert.equal(listed.status, 'list')
  assert.deepEqual(listed.kimi_sessions, [])

  const abort = defineKimiAbortTool(m)
  const aborted = await abort.execute({ kimi_session_id: 'kimi-x' } as never, subExec) as KimiToolResult
  assert.equal(aborted.status, 'not-found')
})

test('kimi_steer async returns started with parent linkage', async () => {
  const ask = defineAskKimiTool(manager)
  const parent = await ask.execute({ prompt: 'original', mode: 'block' } as never, exec) as KimiToolResult
  assert.equal(parent.status, 'completed')
  const steer = defineKimiSteerTool(manager)
  const result = await steer.execute({ kimi_session_id: parent.kimi_session_id, prompt: 'redirect', mode: 'async' } as never, exec) as KimiToolResult
  assert.equal(result.status, 'started')
  assert.equal(result.parent, parent.kimi_session_id)
  assert.equal(result.kind, 'steer')
})

test('kimi_steer block waits for the resumed answer', async () => {
  const ask = defineAskKimiTool(manager)
  const parent = await ask.execute({ prompt: 'original', mode: 'block' } as never, exec) as KimiToolResult
  assert.equal(parent.status, 'completed')
  const steer = defineKimiSteerTool(manager)
  const result = await steer.execute({ kimi_session_id: parent.kimi_session_id, prompt: 'redirect', mode: 'block' } as never, exec) as KimiToolResult
  assert.equal(result.status, 'completed')
  assert.ok(result.answer.includes('resumed'))
})

test('kimi_steer enforces the root fence', async () => {
  const subagent = { id: 'agent-sub', session: fakeSession(), whenIdle: async () => {} } as Agent
  const ctxRoot = { agents: { roots: () => [agent], list: () => [agent, subagent], get: () => undefined } }
  const m = new KimiSessionManager(ctxRoot as never, {
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
    maxTranscriptChars: 16 * 1024,
    maxLoopSteps: 64,
  maxLoopBytes: 16 * 1024,
    allowedAgents: 'roots',
    killGraceMs: 200,
  })
  const subExec = { agent: subagent, signal: new AbortController().signal } as never
  const steer = defineKimiSteerTool(m)
  const result = await steer.execute({ kimi_session_id: 'kimi-x', prompt: 'go', mode: 'async' } as never, subExec) as KimiToolResult
  assert.equal(result.status, 'error')
  assert.equal(result.error, 'agent-not-allowed')
})
