#!/usr/bin/env node
/**
 * Stand-in for `kimi -p <prompt> --output-format stream-json` used by the
 * kimi manager tests.
 *
 * Emits the REAL kimi-code 0.34.0 stream-json event vocabulary (verified
 * against a live run):
 *   {"role":"meta","type":"system.version","version":"0.34.0"}
 *   {"role":"assistant","tool_calls":[…]}
 *   {"role":"tool","tool_call_id":"…","content":"…"}   (tool result; big)
 *   plain text lines                                   (tool output noise)
 *   {"role":"assistant","content":"…"}                 (transcript/answer)
 *   {"role":"meta","type":"session.resume_hint","session_id":"session_…",
 *    "command":"kimi -r session_…","content":"To resume this session: …"}
 *
 * argv: -p <prompt> for fresh runs; -S <session_id> -p <prompt> for resume.
 * Env: FAKE_KIMI_FAIL=1 (stderr + exit 3), FAKE_KIMI_DELAY_MS,
 *      FAKE_KIMI_SESSION_MISMATCH=1 (different session id).
 */

const argv = process.argv.slice(2)
const promptIndex = argv.indexOf('-p')
const sessionIndex = argv.indexOf('-S')
const resumed = sessionIndex !== -1
const sessionId = resumed && argv[sessionIndex + 1] !== undefined
  ? argv[sessionIndex + 1]
  : 'session_8b846be9-323a-4dc5-82d7-b3886f2434b4'
const prompt = promptIndex !== -1 && argv[promptIndex + 1] !== undefined ? argv[promptIndex + 1] : ''

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
emit({ role: 'meta', type: 'system.version', version: '0.34.0' })

if (process.env.FAKE_KIMI_FAIL === '1') {
  process.stderr.write('boom from fake kimi\n')
  setTimeout(() => { process.exitCode = 3 }, Number(process.env.FAKE_KIMI_DELAY_MS ?? '50'))
} else if (process.env.FAKE_KIMI_SESSION_MISMATCH === '1') {
  emit({ role: 'meta', type: 'session.resume_hint', session_id: 'session-OTHER', command: 'kimi -r session-OTHER' })
  emit({ role: 'assistant', content: 'final answer (resumed)' })
  process.exitCode = 0
} else {
  const delay = Number(process.env.FAKE_KIMI_DELAY_MS ?? '50')
  emit({ role: 'assistant', tool_calls: [{ type: 'function', id: 'tool_1', function: { name: 'Bash', arguments: '{"command":"echo hi"}' } }] })
  emit({ role: 'tool', tool_call_id: 'tool_1', content: 'hi\n'.repeat(3) })
  process.stdout.write('plain tool output line\n')
  emit({ role: 'assistant', content: resumed ? `resumed: first message (prompt: ${prompt.slice(0, 30)})` : 'first message' })
  setTimeout(() => {
    emit({ role: 'assistant', content: resumed ? 'final answer (resumed)' : 'final answer' })
    if (process.env.FAKE_KIMI_NO_RESUME_HINT !== '1') {
      emit({ role: 'meta', type: 'session.resume_hint', session_id: sessionId, command: `kimi -r ${sessionId}`, content: `To resume this session: kimi -r ${sessionId}` })
    }
    process.exitCode = 0
  }, delay)
}
