#!/usr/bin/env node
/**
 * 会话日志普查 / 事件转储（离线只读；排障与取证的第一站）。
 *
 * 为什么值得常驻：这个会话里光是「先看清事件形状」就避免了三次误判——
 * `request/header` 不带 turn/step（按 turn 配对判据误报 3.2%）、
 * `user/message` 的 role/content 在 `data` 下（照 assistant 的形状写提取器会静默返空）、
 * `assistant/message` 同时带 usage 与 message.source（路由归属的硬证据）。
 * 每次排查都要重写一遍帧解码太浪费——本工具把它固化下来。
 *
 * 与既有工具的分工：
 *   - `hit-confirm-sentinel.mjs` / `panel-legacy-scan.mjs`：**面向具体判据**（LRU 是否命中 / 载荷能否投影）
 *   - 本工具：**面向「这卷日志里到底有什么」**——事件类型普查、位置信息分布、用户消息形状、错误扫描
 *
 * 用法：
 *   node scripts/acceptance/session-dump.mjs <会话文件|目录>          # 概览（默认）
 *   node scripts/acceptance/session-dump.mjs <路径> --types           # 事件类型普查（按条数降序）
 *   node scripts/acceptance/session-dump.mjs <路径> --positions       # 哪些事件类型带 turn/step（跨事件对齐的前提）
 *   node scripts/acceptance/session-dump.mjs <路径> --users           # 用户消息形状（source/kind/content 块型）
 *   node scripts/acceptance/session-dump.mjs <路径> --errors          # 错误/失败扫描（finish reason / error 字段）
 *   node scripts/acceptance/session-dump.mjs <路径> --grep <正则>     # 任意事件原文匹配（截断显示）
 *   node scripts/acceptance/session-dump.mjs <路径> --json            # 结构化输出
 *   node scripts/acceptance/session-dump.mjs --list [--minutes 60]    # 不传路径时：列出最近更新的会话（含事件数与面板事件数）
 *
 * 支持两种磁盘形态：v3（`session.v3.jsonl.zstd`）与 v0（`session.jsonl.zstd`）。
 * 退出码：0 正常；2 参数/读取错误。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 4247762216 // 0xFD2FB528 little-endian

/**
 * 逐帧解析 zstd 流（不是「扫 magic」——那在压缩数据里会误命中）。
 * 解析 frame header 得到每帧的起止，再逐帧解压后拼接。允许尾帧截断（正在写的日志）。
 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, truncated: true }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames, badMagicAt: offset }
    offset += 4
    if (offset === buffer.length) return { frames, truncated: true }
    const descriptor = buffer.readUInt8(offset); offset += 1
    const fcsFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictFlag = descriptor & 3
    const dictBytes = dictFlag === 3 ? 4 : dictFlag
    const fcsBytes = fcsFlag === 0 ? (singleSegment ? 1 : 0) : 1 << fcsFlag
    const remainder = (singleSegment ? 0 : 1) + dictBytes + fcsBytes
    if (buffer.length - offset < remainder) return { frames, truncated: true }
    offset += remainder
    for (;;) {
      if (buffer.length - offset < 3) return { frames, truncated: true }
      const blockHeader = buffer.readUIntLE(offset, 3); offset += 3
      const last = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      const payload = blockType === 1 ? 1 : blockSize // RLE 块载荷 1 字节
      if (buffer.length - offset < payload) return { frames, truncated: true }
      offset += payload
      if (last) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, truncated: true }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** 解压整卷（多帧）为文本；坏帧跳过并计数。 */
export function decodeSessionFile(file) {
  const buffer = readFileSync(file)
  const { frames, truncated, badMagicAt } = scanZstdFrames(buffer)
  const parts = []
  let skipped = 0
  for (const frame of frames) {
    try { parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end))) } catch { skipped++ }
  }
  const text = Buffer.concat(parts).toString('utf8')
  const events = []
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    try { events.push(JSON.parse(line)) } catch { /* 坏行跳过 */ }
  }
  return { events, frames: frames.length, skipped, truncated: truncated === true, badMagicAt }
}

/** 路径 → 会话文件（目录则找 v3 优先、回落 v0）。 */
export function resolveSessionFile(input) {
  const p = isAbsolute(input) ? input : resolve(process.cwd(), input)
  if (!existsSync(p)) return null
  if (statSync(p).isDirectory()) {
    for (const name of ['session.v3.jsonl.zstd', 'session.jsonl.zstd']) {
      const f = join(p, name)
      if (existsSync(f)) return f
    }
    return null
  }
  return p
}

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const grepIndex = argv.indexOf('--grep')
const grepPattern = grepIndex === -1 ? null : argv[grepIndex + 1]
const minutesIndex = argv.indexOf('--minutes')
// 位置参数 = 既不是 --选项、也不是「带值选项」后面的那个值。
const VALUE_OPTIONS = new Set(['--grep', '--minutes'])
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_OPTIONS.has(argv[i - 1] ?? ''))
const target = positional[0]

/**
 * 不传路径时的入口：列出最近更新的会话。
 * 为什么需要——排查时最常问的是「刚才那轮在哪个会话里」，手输路径既慢又容易打错；
 * 旧的一次性脚本把路径写死在文件里（换个会话就失效），这里改成按 mtime 现扫。
 */
function listRecent(minutes) {
  const root = join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh'), 'sessions')
  if (!existsSync(root)) { console.error(`找不到会话目录：${root}`); process.exit(2) }
  const cutoff = Date.now() - minutes * 60_000
  const rows = []
  for (const ws of readdirSync(root)) {
    const wsDir = join(root, ws)
    let ids = []
    try { ids = readdirSync(wsDir) } catch { continue }
    for (const id of ids) {
      const sessionFile = resolveSessionFile(join(wsDir, id))
      if (sessionFile === null) continue
      let mtime = 0
      try { mtime = statSync(sessionFile).mtimeMs } catch { continue }
      if (mtime < cutoff) continue
      const { events, frames } = decodeSessionFile(sessionFile)
      const panels = events.filter((e) => e.type === 'kimi-tide/panel').length
      const first = events.find((e) => e.type === 'user/message' && e.data?.role === 'user'
        && (e.data?.source?.kind === undefined || e.data?.source?.kind === 'user'))
      const text = (first?.data?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join(' ').trim()
      rows.push({ id, ws, mtime, events: events.length, frames, panels, text })
    }
  }
  rows.sort((a, b) => b.mtime - a.mtime)
  console.log(`最近 ${minutes} 分钟内更新的会话：${rows.length} 个`)
  for (const r of rows) {
    const when = new Date(r.mtime).toLocaleTimeString('zh-CN', { hour12: false })
    const one = r.text === '' ? '(无真实用户消息)' : r.text.replace(/\s+/g, ' ')
    console.log(`  ${when} ${r.id.slice(0, 8)} 事件 ${String(r.events).padStart(5)} 帧 ${String(r.frames).padStart(3)} 面板 ${String(r.panels).padStart(5)} :: ${one.length > 60 ? `${one.slice(0, 60)}…` : one}`)
  }
  console.log('\n下一步：node scripts/acceptance/session-dump.mjs <上面某个目录> --positions|--users|--types')
}

const listIndex = minutesIndex
if (target === undefined) {
  if (!flags.has('--list') && listIndex === -1) {
    console.error('用法：node scripts/acceptance/session-dump.mjs <会话文件|目录> [--types|--positions|--users|--errors|--turns|--grep <正则>|--json]\n      node scripts/acceptance/session-dump.mjs --list [--minutes 60]')
    process.exit(2)
  }
  const minutes = listIndex === -1 ? 60 : Number(argv[listIndex + 1])
  listRecent(Number.isNaN(minutes) ? 60 : minutes)
  process.exit(0)
}
const file = resolveSessionFile(target)
if (file === null) { console.error(`找不到会话文件：${target}`); process.exit(2) }

const { events, frames, skipped, truncated } = decodeSessionFile(file)
const asJson = flags.has('--json')
const brief = (value, n = 220) => {
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  return s.length <= n ? s : `${s.slice(0, n)}…`
}

const census = new Map()
for (const e of events) census.set(e.type, (census.get(e.type) ?? 0) + 1)
const sortedCensus = [...census.entries()].sort((a, b) => b[1] - a[1])

if (asJson) {
  console.log(JSON.stringify({
    file, frames, skippedFrames: skipped, truncated, events: events.length,
    census: Object.fromEntries(sortedCensus),
  }, null, 2))
  process.exit(0)
}

console.log(`文件：${file}`)
console.log(`帧 ${frames}（跳过 ${skipped}${truncated ? ' · 尾帧截断（日志仍在写）' : ''}）· 事件 ${events.length}`)

if (flags.has('--types') || process.argv.length <= 3) {
  console.log('\n=== 事件类型普查（按条数降序）===')
  for (const [type, count] of sortedCensus) console.log(`  ${String(count).padStart(6)}  ${type}`)
}

if (flags.has('--positions')) {
  // 跨事件对齐的前提：哪些类型自带 turn/step，哪些必须靠事件序游标归集。
  console.log('\n=== 位置信息分布（turn / step / 都无）===')
  const rows = new Map()
  for (const e of events) {
    const hasTurn = typeof e?.data?.turn === 'number'
    const hasStep = typeof e?.data?.step === 'number'
    const key = e.type
    const cur = rows.get(key) ?? { turn: 0, step: 0, none: 0 }
    if (hasTurn && hasStep) cur.step++
    else if (hasTurn) cur.turn++
    else cur.none++
    rows.set(key, cur)
  }
  for (const [type, r] of rows) {
    console.log(`  ${type.padEnd(26)} turn+step=${String(r.step).padStart(5)} 仅turn=${String(r.turn).padStart(5)} 都无=${String(r.none).padStart(5)}`)
  }
  console.log('  ⚠️ 「都无」的类型若需要按轮/步归集，必须用事件序游标（turn/start、step/start 更新游标）。')
}

if (flags.has('--users')) {
  console.log('\n=== 用户消息形状（role/content 在 data 下，不是 data.message 下）===')
  for (const e of events) {
    if (e.type !== 'user/message') continue
    const d = e.data ?? {}
    const kinds = Array.isArray(d.content) ? d.content.map((b) => b?.type).join('+') : '(非数组)'
    console.log(`  seq=${e.seq} role=${d.role ?? '-'} source=${brief(d.source ?? null, 90)} kinds=[${kinds}]`)
  }
}

if (flags.has('--errors')) {
  console.log('\n=== 错误 / 失败扫描 ===')
  let hits = 0
  for (const e of events) {
    const s = JSON.stringify(e)
    if (!/"error"|isError":true|finish_reason":"(length|error)|reason":\{"kind":"(error|aborted)/i.test(s)) continue
    hits++
    console.log(`  [${e.type}] seq=${e.seq} ${brief(s, 200)}`)
  }
  console.log(hits === 0 ? '  （零命中）' : `  共 ${hits} 条`)
}

if (grepPattern !== null) {
  const re = new RegExp(grepPattern)
  console.log(`\n=== 匹配 /${grepPattern}/ 的事件 ===`)
  let hits = 0
  for (const e of events) {
    if (!re.test(JSON.stringify(e))) continue
    hits++
    console.log(`  [${e.type}] seq=${e.seq} ${brief(e.data ?? null, 240)}`)
  }
  console.log(hits === 0 ? '  （零命中）' : `  共 ${hits} 条`)
}

if (flags.has('--turns')) {
  console.log('\n=== 轮/步骨架 ===')
  let current = null
  for (const e of events) {
    if (e.type === 'step/start') { current = e.data?.step ?? null; continue }
    if (e.type !== 'turn/start' && e.type !== 'turn/end') continue
    console.log(`  [${e.type}] seq=${e.seq} turn=${e.data?.turn ?? '-'}${e.type === 'turn/end' ? ` reason=${brief(e.data?.reason ?? null, 60)}` : ''}`)
    if (current !== null && e.type === 'turn/end') current = null
  }
}
