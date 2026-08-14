/**
 * Telemetry privacy for dsh-kimi-bridge: exported ledger records never carry
 * kimi prompt/output text. Standalone module (no harness imports) so it can
 * be unit-tested outside the harness.
 *
 * Real ledger shape (packages/telemetry/session-telemetry/src/coordinator.ts):
 *   { channel: 'ledger', attributes: { 'event.type': <event type>, ... },
 *     body: <event.data> }   — body IS the kimi record, type rides attributes.
 */

/** Loose shape of the telemetry ledger record (host-side event). */
export interface TelemetryRecord {
  channel?: string
  attributes?: Record<string, unknown>
  body?: unknown
}

const REDACTED = '[redacted by dsh-kimi-bridge]'
const SENSITIVE_KEYS = ['prompt', 'transcript', 'answer', 'error'] as const
const LOOP_SENSITIVE_KEYS = ['text', 'argsPreview', 'outputPreview', 'error'] as const
const LOOP_SAFE_KEYS = ['seq', 'kind', 'time', 'status', 'exitCode', 'truncated', 'callId', 'tool', 'startedAt', 'completedAt'] as const

/** Redact one telemetry record: ledger channel + kimi/session event only. */
export function redactTelemetryRecord(record: TelemetryRecord): TelemetryRecord {
  if (record.channel !== 'ledger') return record
  if (record.attributes?.['event.type'] !== 'kimi/session') return record
  if (typeof record.body !== 'object' || record.body === null) return record
  const body = record.body as Record<string, unknown>
  const redacted: Record<string, unknown> = { ...body }
  let changed = false
  for (const key of SENSITIVE_KEYS) {
    if (typeof redacted[key] === 'string') {
      redacted[key] = REDACTED
      changed = true
    }
  }
  // Agent-loop steps: keep an explicit safe-field allowlist, redact free text,
  // and drop any unknown future field (fail closed).
  const loop = redacted['loop']
  if (Array.isArray(loop)) {
    const redactedLoop = loop.map(step => {
      if (typeof step !== 'object' || step === null) return step
      const source = step as Record<string, unknown>
      const next: Record<string, unknown> = {}
      for (const key of LOOP_SAFE_KEYS) {
        if (source[key] !== undefined) next[key] = source[key]
      }
      for (const key of LOOP_SENSITIVE_KEYS) {
        if (typeof source[key] === 'string') next[key] = REDACTED
      }
      return next
    })
    if (redactedLoop.some((step, i) => step !== loop[i])) {
      redacted['loop'] = redactedLoop
      changed = true
    }
  }
  return changed ? { ...record, body: redacted } : record
}
