#!/usr/bin/env node
/**
 * 派发路由核验（离线只读）——「子代理到底跑在哪个模型上」的唯一硬证据核对器。
 *
 * 为什么值得常驻：2026-10-08 实测，一个主会话用 workflow 派了 3 个「独立评审」子代理，
 * 派发说明写着「三个不同模型」，实际 3 个子会话全部落在默认目标 deepseek-official/deepseek-flash。
 * 事后复盘：改道的判断做过、也做对了，但**没有任何一步的动作叫「核对路由」**——
 * 本工具把这个动作固化为一条可跑的命令（配套的收工步写在 docs/agent-collaboration-loop.md §3.6）。
 *
 * 判据口径：**只有子会话首条 request/header 的 config（provider/model）靠得住**。
 * 会话头、subagent/descriptor.agentModel、list_agents 在改道后不回写（展示层漂移），
 * 照它们判会判错。本工具只读 request/header。
 *
 * 用法：
 *   node scripts/acceptance/check-dispatch-routing.mjs <父会话id | 会话文件 | 会话目录> [--last N] [--expect provider/model,...] [--json] [--sessions-root <目录>]
 *
 *   父会话 id 形如 session-a539ab51-…（也接受不带 session- 前缀的裸 uuid）；
 *   传会话文件/目录时，读它首行的 session 头取自身 id 作为父会话。
 *   会话根解析顺序：--sessions-root > $DSH_HOME/sessions > ~/.dsh/sessions。
 *
 * 退出码：
 *   0 = 全部对得上（给了 --expect 且逐项一致；或没给 --expect 且至少列出 1 个子会话）
 *   1 = --expect 不一致 / 零子会话 / 列出的子会话里有缺 request/header 的
 *   2 = 参数或路径或读取错误（未知参数必 2 并打印用法——参数写错却报绿是验收里最坏的一种失败）
 *
 * 逐帧解码复用 session-dump.mjs 导出的 scanZstdFrames()（不自己扫 magic——
 * 那会在压缩数据里误命中，该文件注释里有踩坑记录）。零第三方依赖。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

const USAGE = '用法：node scripts/acceptance/check-dispatch-routing.mjs <父会话id | 会话文件 | 会话目录> [--last N] [--expect provider/model,...] [--json] [--sessions-root <目录>]'

/**
 * 拿到 session-dump.mjs 导出的逐帧解码器。
 *
 * 为什么不能直接 import：session-dump.mjs 是「既是库又是 CLI」的写法，顶层 CLI 没有
 * import 守卫——直接 import 会对着我们自己的 argv 跑它的参数解析，轻则打印污染输出，
 * 重则 process.exit 抢先杀掉本进程。这里在 import 期间临时接管 argv / console /
 * process.exit 三件套，让它安静地走完「概览一个非 zstd 文件」的默认分支（零事件 ⇒
 * 零行为、不触达任何 exit），结束后原样恢复。唯一的目的是单源复用 scanZstdFrames()
 * ——复制一份会造成两处漂移，而那个函数的踩坑注释只活在 session-dump.mjs 里。
 */
async function loadSessionDump() {
  const selfFile = fileURLToPath(import.meta.url) // 目标指向本脚本自身：非 zstd ⇒ scanZstdFrames 返回零帧
  const dumpFile = new URL('./session-dump.mjs', import.meta.url)
  const argvBackup = process.argv
  const logBackup = console.log
  const errBackup = console.error
  const exitBackup = process.exit
  console.log = () => {}
  console.error = () => {}
  process.exit = () => {}
  process.argv = [argvBackup[0], argvBackup[1], selfFile]
  try {
    return await import(dumpFile.href)
  } finally {
    process.argv = argvBackup
    console.log = logBackup
    console.error = errBackup
    process.exit = exitBackup
  }
}

// ---------------- 参数解析（白名单；未知参数必 exit 2） ----------------
const argv = process.argv.slice(2)
const VALUE_OPTIONS = new Set(['--last', '--expect', '--sessions-root'])
const FLAG_OPTIONS = new Set(['--json'])
const options = { last: null, expect: null, sessionsRoot: null, json: false }
const positionals = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    if (FLAG_OPTIONS.has(a)) {
      if (options.json) fail2(`${a} 只能给一次`)
      options.json = true
      continue
    }
    if (VALUE_OPTIONS.has(a)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) fail2(`${a} 需要一个值`)
      if (a === '--last') {
        if (options.last !== null) fail2(`${a} 只能给一次`)
        if (!/^\d+$/.test(value) || Number(value) < 1) fail2(`--last 需要正整数，收到「${value}」`)
        options.last = Number(value)
      } else if (a === '--expect') {
        if (options.expect !== null) fail2(`${a} 只能给一次`)
        for (const item of value.split(',')) {
          if (!/^[^/\s]+\/[^/\s]+$/.test(item)) fail2(`--expect 的每一项形如 provider/model，收到「${item}」`)
        }
        options.expect = value.split(',')
      } else {
        if (options.sessionsRoot !== null) fail2(`${a} 只能给一次`)
        options.sessionsRoot = value
      }
      i++
      continue
    }
    fail2(`未知参数：${a}`)
  }
  positionals.push(a)
}
if (positionals.length !== 1) fail2(positionals.length === 0 ? '缺少目标参数（父会话 id / 会话文件 / 会话目录）' : `只接受一个目标参数，收到 ${positionals.length} 个`)
const target = positionals[0]

function fail2(message) {
  console.error(`${message}`)
  console.error(USAGE)
  process.exit(2)
}

// ---------------- 主流程 ----------------
const { scanZstdFrames, decodeSessionFile, resolveSessionFile } = await loadSessionDump()

/** 会话根：--sessions-root > $DSH_HOME/sessions > ~/.dsh/sessions（与 session-dump --list 同口径）。 */
const sessionsRoot = options.sessionsRoot
  ?? (process.env.DSH_HOME ? join(process.env.DSH_HOME, 'sessions') : undefined)
  ?? join(homedir(), '.dsh', 'sessions')
if (!existsSync(sessionsRoot)) fail2(`会话根不存在：${sessionsRoot}`)

/**
 * 读会话文件**首行**的 session 头：只解压第一帧，不整卷解码。
 * 为什么——扫描阶段要过整个会话库（几百卷、每卷几千事件），判 parentSession 只需首行；
 * 首行解不出时回落整卷解码（首帧不含完整首行的极端情形兜底）。
 */
function readSessionHead(file) {
  const buffer = readFileSync(file)
  const { frames } = scanZstdFrames(buffer)
  if (frames.length > 0) {
    try {
      const text = zstdDecompressSync(buffer.subarray(frames[0].start, frames[0].end)).toString('utf8')
      for (const line of text.split('\n')) {
        if (!line.trim().startsWith('{')) continue
        try {
          const head = JSON.parse(line)
          if (head?.type === 'session') return head
          break // 首行是 JSON 但不是 session 头 ⇒ 落到整卷兜底
        } catch { break }
      }
    } catch { /* 落到整卷兜底 */ }
  }
  const { events } = decodeSessionFile(file)
  return events.find((e) => e?.type === 'session') ?? null
}

/** 目标 → 要匹配的父会话键。parentSession 字段一律是 session-<uuid> 形态，两种写法都认。 */
function parentKeysOf(targetInput) {
  const p = isAbsolute(targetInput) ? targetInput : resolve(process.cwd(), targetInput)
  if (existsSync(p)) {
    const file = resolveSessionFile(p)
    if (file === null) fail2(`路径存在但找不到会话文件（v4/v3/v0 均无）：${p}`)
    const head = readSessionHead(file)
    if (head === null || head.id === undefined) fail2(`读不到该会话的首行 session 头：${file}`)
    return { keys: new Set([`session-${head.id}`, head.id]), from: `会话 ${head.id}（由 ${p} 解析）` }
  }
  // 不在盘上 ⇒ 按父会话 id 处理（session-<uuid> 或裸 uuid 都接受）
  const bare = targetInput.startsWith('session-') ? targetInput.slice('session-'.length) : targetInput
  return { keys: new Set([targetInput, `session-${bare}`, bare]), from: `父会话 ${targetInput}` }
}
const parent = parentKeysOf(target)

// 扫 <root>/<工作区>/<会话id>/ 下三种磁盘形态，收集 parentSession 命中的子会话
const children = []
for (const ws of readdirSync(sessionsRoot)) {
  const wsDir = join(sessionsRoot, ws)
  let ids = []
  try { ids = readdirSync(wsDir) } catch { continue } // 非目录或不可读 ⇒ 跳过
  for (const id of ids) {
    const file = resolveSessionFile(join(wsDir, id)) // v4 优先、回落 v3/v0（session-dump 口径）
    if (file === null) continue
    let head = null
    try { head = readSessionHead(file) } catch { continue }
    if (head === null || !parent.keys.has(head.parentSession)) continue
    children.push({ id: head.id ?? id, createdAt: head.createdAt ?? 0, file })
  }
}
// 升序展示；createdAt 同批同毫秒时按 id 兜底，保证输出确定（同批派发的毫秒差经常为 0–2ms）
children.sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
const total = children.length
if (options.last !== null) children.splice(0, total - options.last)

/** 首条 request/header 的 config——provider/model 的唯一硬证据；没有则 NO_HEADER。 */
function extract(child) {
  const { events } = decodeSessionFile(child.file)
  const rh = events.find((e) => e?.type === 'request/header')
  const cfg = rh?.data?.header?.config ?? null
  // 首条真实用户消息：source.kind 非 user 的都是会话框架合成的（skill-catalog / runtime-context…），
  // 真正的派发提示词 source.kind === 'user'（子会话里它就是「用户消息」）
  const u = events.find((e) => e?.type === 'user/message' && (e.data?.role === 'user' || e.data?.role === undefined)
    && (e.data?.source?.kind === undefined || e.data?.source?.kind === 'user'))
  const text = u ? (u.data.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join(' ').replace(/\s+/g, ' ').trim() : ''
  return {
    id: child.id,
    createdAt: child.createdAt,
    hasHeader: cfg !== null,
    provider: cfg?.provider ?? null,
    model: cfg?.model ?? null,
    effort: cfg?.reasoningEffort ?? null,
    maxTokens: cfg?.maxTokens ?? null,
    firstUserText: text === '' ? '(无真实用户消息)' : (text.length > 80 ? `${text.slice(0, 80)}…` : text),
  }
}
const rows = children.map(extract)
const actual = rows.map((r) => (r.hasHeader ? `${r.provider}/${r.model}` : 'NO_HEADER'))

// ---------------- 判定 ----------------
let exitCode = 0
let verdict = null
if (total === 0) {
  verdict = `在 ${sessionsRoot} 下没有找到 parentSession 指向 ${parent.from} 的子会话`
  exitCode = 1
} else {
  const missing = rows.filter((r) => !r.hasHeader)
  if (missing.length > 0) {
    verdict = `有 ${missing.length} 个子会话缺 request/header（${missing.map((r) => r.id.slice(0, 8)).join(' ')}）——无法核对其路由`
    exitCode = 1
  }
  if (options.expect !== null) {
    const ok = actual.length === options.expect.length && actual.every((a, i) => a === options.expect[i])
    if (!ok) {
      verdict = `期望 vs 实际不一致（共 ${total} 个子会话，比对其中 ${rows.length} 个）`
      exitCode = 1
    } else {
      verdict = `期望 vs 实际逐项一致（比对 ${rows.length} 个，父会话下共 ${total} 个子会话）`
    }
  } else if (exitCode === 0) {
    verdict = `列出 ${rows.length} 个子会话（共 ${total} 个），未给 --expect，不比对`
  }
}

// ---------------- 输出 ----------------
if (options.json) {
  console.log(JSON.stringify({
    parent: parent.from,
    sessionsRoot,
    totalChildren: total,
    listed: rows.length,
    expected: options.expect,
    actual,
    allMatched: exitCode === 0,
    verdict,
    children: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      createdAtIso: new Date(r.createdAt).toISOString(),
      provider: r.provider,
      model: r.model,
      effort: r.effort,
      maxTokens: r.maxTokens,
      firstUserText: r.firstUserText,
    })),
  }, null, 2))
  process.exit(exitCode)
}

console.log(`${parent.from} · 根 ${sessionsRoot} · 子会话共 ${total} 个${options.last !== null ? `（--last ${options.last}，列出最近 ${rows.length} 个）` : `，全部列出`}`)
rows.forEach((r, i) => {
  const when = r.createdAt > 0 ? new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }) : '-'
  const route = r.hasHeader ? `${r.provider}/${r.model} effort=${r.effort ?? '-'} maxTokens=${r.maxTokens ?? '-'}` : 'NO_HEADER（缺 request/header，无法核对路由）'
  console.log(`  ${i + 1}. ${r.id.slice(0, 8)}  ${when}  ${route}`)
  console.log(`     ${r.firstUserText}`)
})
if (options.expect !== null) {
  console.log(`\n期望：${options.expect.join(', ')}`)
  console.log(`实际：${actual.join(', ')}`)
}
console.log(`\n结论：${verdict}`)
process.exit(exitCode)
