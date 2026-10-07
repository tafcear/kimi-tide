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
 *
 * 2026-10 v4 世代改造（中文说明见 scripts/e2e/README.md）：
 * - 目录证据：探针的裸 `import('@deepseek-ai/dsh-session')` 经隔离 profile 的
 *   node_modules junction 解析到部署的真实 dsh-session——与宿主校验用的是
 *   同一物理模块（扁平区那份本身就是指向 dsh 嵌套副本的 junction），所以
 *   `resolvedFrom` 记下的就是宿主自己那份实例，不是探针私有的副本。
 * - 快速收敛：v3 带自定义类型 ⇒ 上游 RELEASED_V3_EVENT_TYPES 冻结拒载（注册
 *   救不回，属设计使然），命中该拒绝消息即视为终态不再重试；v4 的同款拒绝
 *   在 15s 宽限后也视为终态（插件 apply() 早已完成，重试无意义）。
 */
import { writeFileSync } from 'node:fs'

export const name = 'kimi-tide-e2e-probe'

export function apply(ctx, config) {
  const sessionIds = Array.isArray(config?.sessionIds) ? config.sessionIds : []
  const out = typeof config?.out === 'string' ? config.out : ''
  const timeoutMs = typeof config?.timeoutMs === 'number' ? config.timeoutMs : 45_000
  if (sessionIds.length === 0 || out === '') return

  const startedAt = Date.now()
  const sessions = new Map(sessionIds.map((id) => [id, { ok: false, error: 'not observed yet', attempts: 0, frozen: false }]))
  let catalog = { checked: false }

  // 上游拒绝路径的消息特征（命中即终态——这类拒绝与插件注册时序无关，重试
  // 不可能翻盘）：v3 冻结判据（RELEASED_V3_EVENT_TYPES）与 v4 未注册判据
  // （dsh-session 校验层 "unknown to this harness and not marked ignorable"）。
  const FROZEN_REFUSAL = /format v[34] contains unknown event type |unknown to this harness and not marked ignorable/
  const V4_GRACE_MS = 15_000

  const checkCatalog = async () => {
    if (catalog.checked) return
    try {
      const session = await import('@deepseek-ai/dsh-session')
      const known = session.KNOWN_SESSION_EVENT_TYPES
      catalog = {
        checked: true,
        hasPanel: known.has('kimi-tide/panel'),
        hasReview: known.has('kimi-tide/review'),
        hasRevise: known.has('kimi-tide/review-revise'),
        size: known.size,
        // 宿主自己那份 dsh-session 的解析地址（同源性直接证据，进 verdict 供编排器打印）
        resolvedFrom: import.meta.resolve('@deepseek-ai/dsh-session'),
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
      sessions: Object.fromEntries([...sessions.entries()].map(([id, value]) => [id, { ok: value.ok, events: value.events ?? null, error: value.ok ? null : value.error, attempts: value.attempts, frozen: value.frozen }])),
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
      // 已加载、或已命中上游冻结拒绝（v3 立即终态；v4 过宽限期后终态）的条目不再重试。
      if (entry.ok || entry.frozen) continue
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
        const elapsed = Date.now() - startedAt
        if (FROZEN_REFUSAL.test(entry.error) && (/format v3 /.test(entry.error) || elapsed >= V4_GRACE_MS)) entry.frozen = true
        allOk = false
      } finally {
        try {
          observation?.[Symbol.dispose]?.()
        } catch {
          /* lease disposal is best-effort in a probe */
        }
      }
      if (!entry.ok && !entry.frozen) allOk = false
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
