import assert from 'node:assert/strict'
import { test } from 'node:test'
import { redactTelemetryRecord } from '../src/redact.js'

/** The REAL ledger shape (packages/telemetry/session-telemetry/src/coordinator.ts). */
function ledgerRecord(overrides: Record<string, unknown> = {}) {
  return {
    channel: 'ledger',
    attributes: { 'session.id': 's1', 'event.type': 'kimi/session', 'event.seq': 3 },
    body: {
      id: 'kimi-abc',
      status: 'done',
      prompt: 'secret prompt',
      transcript: 'secret output',
      answer: 'secret answer',
      cwd: '/tmp',
    },
    ...overrides,
  }
}

test('redacts prompt/transcript/answer of a kimi/session ledger record', () => {
  const out = redactTelemetryRecord(ledgerRecord() as never)
  const body = out.body as Record<string, string>
  assert.equal(body.prompt, '[redacted by dsh-kimi-bridge]')
  assert.equal(body.transcript, '[redacted by dsh-kimi-bridge]')
  assert.equal(body.answer, '[redacted by dsh-kimi-bridge]')
  // Non-sensitive fields survive.
  assert.equal(body.id, 'kimi-abc')
  assert.equal(body.cwd, '/tmp')
})

test('leaves non-ledger channels unchanged (same reference)', () => {
  const record = ledgerRecord({ channel: 'metrics' })
  assert.equal(redactTelemetryRecord(record as never), record)
})

test('leaves non-kimi ledger events unchanged (same reference)', () => {
  const record = ledgerRecord({
    attributes: { 'session.id': 's1', 'event.type': 'user/message', 'event.seq': 2 },
  })
  assert.equal(redactTelemetryRecord(record as never), record)
})

test('returns the record unchanged when no sensitive field is present', () => {
  const record = ledgerRecord({
    body: { id: 'kimi-abc', status: 'done', cwd: '/tmp' },
  })
  assert.equal(redactTelemetryRecord(record as never), record)
})

test('redacts agent-loop free text via an allowlist (args/output/text/error)', () => {
  const record = ledgerRecord({
    body: {
      id: 'kimi-abc',
      status: 'done',
      prompt: 'p',
      transcript: 't',
      loop: [
        { seq: 0, kind: 'tool', time: 1, tool: 'Bash', callId: 'tool_1', status: 'done', argsPreview: 'ls -la /secret', outputPreview: 'sensitive output', exitCode: 0, truncated: true },
        { seq: 1, kind: 'message', time: 3, text: 'fine' },
      ],
    },
  })
  const out = redactTelemetryRecord(record as never)
  const loop = (out.body as { loop: Array<Record<string, unknown>> }).loop
  assert.equal(loop[0]?.argsPreview, '[redacted by dsh-kimi-bridge]')
  assert.equal(loop[0]?.outputPreview, '[redacted by dsh-kimi-bridge]')
  assert.equal(loop[0]?.callId, 'tool_1')
  assert.equal(loop[0]?.exitCode, 0)
  assert.equal(loop[1]?.text, '[redacted by dsh-kimi-bridge]')
  assert.ok(!('unknownFuture' in (loop[0] as object)))
})
