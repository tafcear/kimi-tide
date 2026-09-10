/**
 * kimi-tide E2E probe — a profile plugin mounted INSIDE a real harness boot.
 *
 * The E2E orchestrator (session-events-boot.mjs) copies this file into an
 * isolated profile and adds a row for it to that profile's cordis.patch.yml.
 * The row's config carries:
 *   sessionIds      — fixture session ids to observe (control + custom-event ones)
 *   out             — absolute path of the JSON verdict file to write
 *   timeoutMs       — how long to keep retrying before writing a final verdict
 *
 * What it proves: once the harness has mounted dsh-kimi-tide, EVERY stored
 * session is readable through `ctx.sessionQuery.observeSession(...)` — the exact
 * call the product's history load makes. A session carrying an event type this
 * harness does not know and that is not marked `ignorable` must refuse; a
 * plugin that registers the type at apply() makes it readable again.
 *
 * Plain ESM, no dependencies: this runs inside the booted harness process.
 */
import { writeFileSync } from 'node:fs'

export const name = 'kimi-tide-e2e-probe'

export function apply(ctx, config) {
  const sessionIds = Array.isArray(config?.sessionIds) ? config.sessionIds : []
  const out = typeof config?.out === 'string' ? config.out : ''
  const timeoutMs = typeof config?.timeoutMs === 'number' ? config.timeoutMs : 45_000
  if (sessionIds.length === 0 || out === '') return

  const startedAt = Date.now()
  const sessions = new Map(sessionIds.map((id) => [id, { ok: false, error: 'not observed yet', attempts: 0 }]))
  let catalog = { checked: false }

  const checkCatalog = async () => {
    if (catalog.checked) return
    try {
      const session = await import('@deepseek-ai/dsh-session')
      const known = session.KNOWN_SESSION_EVENT_TYPES
      catalog = {
        checked: true,
        hasPanel: known.has('kimi-tide/panel'),
        hasReview: known.has('kimi-tide/review'),
        size: known.size,
      }
    } catch (error) {
      catalog = { checked: true, importFailed: String(error?.message ?? error).slice(0, 200) }
    }
  }

  const settingsNamespaces = () => {
    try {
      const settings = ctx.get('settings')
      const described = settings?.describe?.() ?? []
      return described.map((entry) => entry?.ns ?? entry?.namespace ?? entry?.name).filter((value) => typeof value === 'string')
    } catch {
      return []
    }
  }

  const writeVerdict = (final) => {
    const payload = {
      final,
      dshHome: process.env.DSH_HOME ?? null,
      elapsedMs: Date.now() - startedAt,
      catalog,
      settingsNamespaces: settingsNamespaces(),
      sessions: Object.fromEntries([...sessions.entries()].map(([id, value]) => [id, { ok: value.ok, events: value.events ?? null, error: value.ok ? null : value.error, attempts: value.attempts }])),
    }
    try {
      writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8')
    } catch {
      /* the orchestrator reports a missing verdict as a timeout */
    }
  }

  const attempt = async () => {
    await checkCatalog()
    const sessionQuery = ctx.get('sessionQuery')
    if (sessionQuery === undefined) {
      for (const entry of sessions.values()) entry.error = 'sessionQuery service is not mounted'
      return false
    }
    let allOk = true
    for (const [id, entry] of sessions) {
      if (entry.ok) continue
      entry.attempts += 1
      let observation
      try {
        observation = await sessionQuery.observeSession(id, { projectionMode: 'none' })
        entry.ok = true
        entry.events = observation.events.length
        entry.error = null
      } catch (error) {
        entry.ok = false
        entry.error = String(error?.message ?? error).slice(0, 500)
        allOk = false
      } finally {
        try {
          observation?.[Symbol.dispose]?.()
        } catch {
          /* lease disposal is best-effort in a probe */
        }
      }
    }
    return allOk
  }

  const tick = async () => {
    let done = false
    try {
      done = await attempt()
    } catch (error) {
      for (const entry of sessions.values()) if (!entry.ok) entry.error = String(error?.message ?? error).slice(0, 500)
    }
    if (done || Date.now() - startedAt >= timeoutMs) {
      writeVerdict(done)
      return
    }
    setTimeout(() => { void tick() }, 1_000)
  }

  setTimeout(() => { void tick() }, 2_000)
}
