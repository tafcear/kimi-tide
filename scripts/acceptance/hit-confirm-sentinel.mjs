#!/usr/bin/env node
/**
 * 语义闸实机哨兵（v1.3.0 可观测性补链的配套验收工具）。
 *
 * 为什么需要它——`HitConfirmGate` 的判官缓存**只写有结论的结果**（hit / omit），
 * 失败 / 超时 / 判词解析失败一律不写。于是「同一句话连发两次」成了一个零副作用的探针：
 *
 *   · 判官成功过 ⇒ 第二次命中**进程级** LRU ⇒ pre-step 耗时骤降到无闸基线；
 *   · 判官从未成功 ⇒ 第二次照样重跑（吃满有界超时或提前失败），耗时与第一次同量级。
 *
 * 2026-09-15 的实机验收正是靠这个信号发现「语义确认闸从没产出过一次有效判词」，
 * 而在此之前它**完全静默**——判词只写进程 stdout，判否又必然落打底、打底不上报面板。
 * 单元测试天然覆盖不到这一类失效：mock 永远返回理想判词。
 *
 * 用法：
 *   node scripts/acceptance/hit-confirm-sentinel.mjs                    # 扫最近 30 分钟
 *   node scripts/acceptance/hit-confirm-sentinel.mjs --minutes 180
 *   node scripts/acceptance/hit-confirm-sentinel.mjs --text 重构         # 只看含该片段的会话
 *   node scripts/acceptance/hit-confirm-sentinel.mjs --session <会话目录或 session.v3.jsonl.zstd>
 *   node scripts/acceptance/hit-confirm-sentinel.mjs --json
 *
 * 退出码：0 = 没发现可疑；1 = 同一文本多次出现却毫无耗时下降（判官可能从未成功）；
 *         2 = 参数或读取错误。
 *
 * 判据的边界（诚实声明）：缓存容量 64 条，被逐出后同文本会重新判——所以「未下降」
 * 是**可疑信号**而非定罪；反过来「下降」则可以确证判官至少成功过一次。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
/** 这些来源的 user 消息是会话框架合成的，不是用户真正打的字——统计同文本必须排除。 */
const SKIP_SOURCES = new Set([
  'user-approval',
  '@deepseek-ai/dsh-system-prompt',
  'skill-catalog',
  'agent-instructions',
  'plugin',
  'system',
])
/** 判定「耗时下降」的比例阈值：第二次及以后最快的一次 ≤ 首次的一半才算命中缓存。 */
const DROP_RATIO = 0.5

/** 多 zstd 帧解压 → 事件数组（坏帧跳过，不因单帧损坏丢整卷）。 */
function readEvents(file) {
  const buf = readFileSync(file)
  const starts = []
  let idx = 0
  while ((idx = buf.indexOf(MAGIC, idx)) !== -1) { starts.push(idx); idx += 4 }
  let text = ''
  for (let i = 0; i < starts.length; i++) {
    const chunk = buf.subarray(starts[i], i + 1 < starts.length ? starts[i + 1] : buf.length)
    try { text += zstdDecompressSync(chunk).toString('utf8') } catch { /* 坏帧跳过 */ }
  }
  const events = []
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    try { events.push(JSON.parse(line)) } catch { /* 坏行跳过 */ }
  }
  return events
}

/** 每次 LLM 请求头（provider/model/effort）——路由决策的唯一硬证据，不取模型自述。 */
function headerRows(events) {
  const rows = []
  for (const ev of events) {
    if (ev?.type !== 'request/header') continue
    const cfg = ev?.data?.header?.config
    if (!cfg) continue
    rows.push({ seq: ev.seq, time: ev.time, provider: cfg.provider, model: cfg.model, effort: cfg.reasoningEffort })
  }
  return rows
}

/** 真实用户消息（注意形状：role 与 content 都在 data 下，不是 data.message 下）。 */
function userMessages(events) {
  const out = []
  for (const ev of events) {
    if (ev?.type !== 'user/message') continue
    const d = ev?.data ?? {}
    if (d.role && d.role !== 'user') continue
    if (!Array.isArray(d.content)) continue
    const text = d.content.filter((b) => b?.type === 'text').map((b) => b.text).join(' ')
    if (!text.trim()) continue
    out.push({ seq: ev.seq, time: ev.time, from: d.source?.plugin ?? d.source?.kind ?? 'user', text: text.trim() })
  }
  return out
}

/** 单会话取证：首条真实用户文本 + pre-step 耗时（语义闸就发生在这个窗口里）。 */
function scanSession(file, mtime) {
  let events
  try { events = readEvents(file) } catch { return null }
  const users = userMessages(events).filter((u) => !SKIP_SOURCES.has(u.from))
  const headers = headerRows(events)
  const turnStart = events.find((e) => e.type === 'turn/start')
  const first = users[0]
  const h = headers[0]
  return {
    file,
    mtime,
    sessionId: events.find((e) => e.type === 'session')?.id ?? null,
    depth: events.find((e) => e.type === 'session')?.delegationDepth ?? null,
    text: first?.text ?? null,
    headers,
    preStepMs: first && h ? h.time - first.time : null,
    turnToRequestMs: turnStart && h ? h.time - turnStart.time : null,
  }
}

function collectFiles(root, cutoff) {
  const out = []
  if (!existsSync(root)) return out
  for (const ws of readdirSync(root)) {
    const wsDir = join(root, ws)
    let sessions = []
    try { sessions = readdirSync(wsDir) } catch { continue }
    for (const sess of sessions) {
      const f = join(wsDir, sess, 'session.v3.jsonl.zstd')
      if (!existsSync(f)) continue
      let mtime
      try { mtime = statSync(f).mtimeMs } catch { continue }
      if (mtime < cutoff) continue
      out.push({ file: f, mtime })
    }
  }
  return out
}

/**
 * 同文本分组判定：≥2 次才可判定；最快的一次相对首次未显著下降 ⇒ 可疑。
 *
 * 判据字段必须是 `turnToRequestMs`（turn/start → 首个请求），**不能**用
 * `preStepMs`（首条 user 消息 → 首个请求）——`user/message` 与 `request/header`
 * 几乎同刻写入，两者之差恒为个位数毫秒，根本测不到 pre-step。
 * 这个坑是拿 2026-09-15 那 5 次真实探针当反例跑出来的：初版用错字段，把
 * 「判官从未成功」误判成了「至少成功过一次」。
 */
function judge(rows) {
  const groups = new Map()
  for (const r of rows) {
    if (r.text === null || r.turnToRequestMs === null) continue
    if (!groups.has(r.text)) groups.set(r.text, [])
    groups.get(r.text).push(r)
  }
  const out = []
  for (const [text, list] of groups) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => a.mtime - b.mtime)
    const first = sorted[0].turnToRequestMs
    const later = sorted.slice(1).map((r) => r.turnToRequestMs)
    const best = Math.min(...later)
    out.push({ text, runs: sorted.length, first, later, best, dropped: first > 0 && best <= first * DROP_RATIO })
  }
  return out
}

// ---------------- CLI ----------------
const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(name)
  return i === -1 ? dflt : argv[i + 1]
}
const asJson = argv.includes('--json')
const minutes = Number(arg('--minutes', '30'))
const textFilter = arg('--text', null)
const sessionArg = arg('--session', null)
if (Number.isNaN(minutes)) { console.error('--minutes 需要数字'); process.exit(2) }

let rows = []
if (sessionArg !== null) {
  const p = sessionArg
  const file = existsSync(p) && statSync(p).isDirectory() ? join(p, 'session.v3.jsonl.zstd') : p
  if (!existsSync(file)) { console.error(`找不到会话文件：${file}`); process.exit(2) }
  const r = scanSession(file, 0)
  if (r) rows.push(r)
} else {
  const root = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
  const cutoff = Date.now() - minutes * 60_000
  for (const { file, mtime } of collectFiles(root, cutoff)) {
    const r = scanSession(file, mtime)
    if (r) rows.push(r)
  }
}
rows.sort((a, b) => a.mtime - b.mtime)
if (textFilter !== null) rows = rows.filter((r) => (r.text ?? '').includes(textFilter))

const verdicts = judge(rows)
const suspicious = verdicts.filter((v) => !v.dropped)

if (asJson) {
  console.log(JSON.stringify({ sessions: rows, verdicts, suspicious: suspicious.length }, null, 2))
  process.exit(suspicious.length > 0 ? 1 : 0)
}

console.log(`会话 ${rows.length} 个${sessionArg === null ? `（最近 ${minutes} 分钟）` : ''}${textFilter === null ? '' : `，文本含「${textFilter}」`}\n`)
for (const r of rows) {
  const t = new Date(r.mtime).toLocaleTimeString('zh-CN', { hour12: false })
  const one = (r.text ?? '(无真实用户消息)').replace(/\s+/g, ' ')
  console.log(`── [${t}] depth=${r.depth ?? '-'}`)
  console.log(`   文本: ${one.length > 88 ? one.slice(0, 88) + '…' : one}`)
  console.log(`   pre-step: ${r.preStepMs === null ? 'n/a' : `${r.preStepMs}ms`}（turn→请求 ${r.turnToRequestMs ?? 'n/a'}ms）`)
  for (const h of r.headers) console.log(`   → ${h.provider}/${h.model} effort=${h.effort ?? '-'}`)
}

console.log('\n=== 同文本对照（判官缓存是否曾经命中）===')
if (verdicts.length === 0) {
  console.log('没有出现 ≥2 次的同文本会话——无法判定。')
  console.log('要让哨兵有效：对同一句话（含关键词，例如「重构」）连发两次，每次一个新会话，然后重跑本脚本。')
} else {
  for (const v of verdicts) {
    const flag = v.dropped ? '✅ 耗时下降（判官至少成功过一次）' : '⚠️  毫无下降（判官可能从未成功）'
    console.log(`\n文本: ${v.text.replace(/\s+/g, ' ').slice(0, 88)}`)
    console.log(`  出现 ${v.runs} 次 · 首次 ${v.first}ms · 其后 [${v.later.join(', ')}]ms（最快 ${v.best}ms）`)
    console.log(`  ${flag}`)
  }
  console.log(`\n结论：${suspicious.length === 0 ? '未发现可疑' : `${suspicious.length} 组可疑——语义闸可能从未生效（闸门失效是静默的，请结合决策原因串里的「语义闸…」注记确认）`}`)
}
process.exit(suspicious.length > 0 ? 1 : 0)
