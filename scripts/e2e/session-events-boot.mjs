#!/usr/bin/env node
/**
 * kimi-tide E2E — "a stored session carrying this plugin's custom event type is
 * still readable after a restart".
 *
 * This is a BOOT-LEVEL test: it composes an isolated DSH home, writes synthetic
 * stored sessions into it, boots the real `dsh web` profile (with the local
 * dsh-kimi-tide bundle mounted) and lets a probe plugin inside that process read
 * the fixtures through `ctx.sessionQuery.observeSession(...)` — the same call the
 * product's history load uses, and the one that produced
 * "历史加载失败: failed to observe session … unknown to this harness".
 *
 * 夹具（两代格式 × 对照/自定义，2026-10 v4 世代改造，详见 scripts/e2e/README.md）：
 *   v3 control — 仅 permission/sandbox/approval 等已发布类型 → 永远可加载；
 *   v3 custom  — 同上外加一条 `kimi-tide/panel` → **上游按设计拒载**：
 *                v3 读取判据是 dsh-session-format-v3-to-v4 里冻结的字面量
 *                Set RELEASED_V3_EVENT_TYPES，任何插件注册都救不回 ⇒ 这条
 *                检查钉的是上游冻结行为（拒绝消息必须点名该类型），不是本
 *                插件的能力；保留它是为了守住「v3 历史带自定义类型 ⇒ 拒载」
 *                这一事实的可见性。
 *   v4 control — 同 v3 control 的事件集，当前格式（v4）落盘 → 必须可加载；
 *   v4 custom  — 同上外加一条 `kimi-tide/panel` → **只有插件在 apply() 时把
 *                该类型注册进宿主 KNOWN_SESSION_EVENT_TYPES 才能加载**——这才
 *                是本 E2E 原本要守的承诺（注册成功 ⇒ v4 历史可读）。
 *
 * Usage:
 *   node scripts/e2e/session-events-boot.mjs --expect ok                 # fixed build
 *   node scripts/e2e/session-events-boot.mjs --expect refused --pre-fix  # negative control
 *
 * Options:
 *   --expect <ok|refused>   required assertion (default ok)
 *   --pre-fix               mount a vendored copy with the panel registration
 *                           stripped (the regression this E2E exists to catch)
 *   --plugin <dir>          mount this dsh-kimi-tide package directory instead
 *                           of the profile's installed one
 *   --source-home <dir>     DSH home providing profiles/ to link against
 *                           (default: $DSH_HOME or ~/.dsh)
 *   --keep                  keep the isolated home and the boot log
 *   --timeout <ms>          verdict wait budget (default 120000)
 *   --out <dir>             where to put the isolated home (default: os tmpdir)
 */
import { spawn, spawnSync } from 'node:child_process'
import { constants, zstdCompressSync } from 'node:zlib'
import { cpSync, mkdirSync, existsSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const next = process.argv[index + 1]
  return next === undefined || next.startsWith('--') ? true : next
}

const expect = String(arg('expect', 'ok'))
if (expect !== 'ok' && expect !== 'refused') throw new Error(`--expect must be ok or refused, got ${expect}`)
const sourceHome = resolve(String(arg('source-home', process.env.DSH_HOME ?? join(homedir(), '.dsh'))))
const keep = arg('keep', false) === true
const timeoutMs = Number(arg('timeout', 120_000))
const outRoot = arg('out', null) === null ? tmpdir() : resolve(String(arg('out')))

const webProfile = join(sourceHome, 'profiles', 'web')
const flatFallback = join(sourceHome, 'profiles', 'node_modules')
for (const required of [webProfile, flatFallback]) {
  if (!existsSync(required)) throw new Error(`source DSH home is missing ${required}`)
}

const home = mkdtempSync(join(outRoot, 'kimi-tide-e2e-'))
const profileDir = join(home, 'profiles', 'web')
const sessionsRoot = join(home, 'sessions')
const logPath = join(home, 'boot.log')
const verdictPath = join(home, 'verdict.json')
mkdirSync(profileDir, { recursive: true })
mkdirSync(sessionsRoot, { recursive: true })

// --- 1. isolated profile: real packages (junctions), trimmed bundle set ------
symlinkSync(flatFallback, join(home, 'profiles', 'node_modules'), 'junction')
// The profile's own node_modules stays a real directory so the E2E can point
// `dsh-kimi-tide` at a vendored copy (the `--plugin` negative control) while
// everything else resolves to the deployment's real packages.
const profileModules = join(profileDir, 'node_modules')
mkdirSync(profileModules, { recursive: true })
symlinkSync(join(flatFallback, '@deepseek-ai'), join(profileModules, '@deepseek-ai'), 'junction')
let pluginDir = String(arg('plugin', '')) === '' ? realpathSync(join(webProfile, 'node_modules', 'dsh-kimi-tide')) : resolve(String(arg('plugin')))
if (!existsSync(join(pluginDir, 'lib', 'index.js'))) throw new Error(`plugin dir has no lib/index.js: ${pluginDir}`)

// `--pre-fix` vendors a copy with the panel registration stripped: the negative
// control that proves this E2E actually detects the regression instead of
// passing vacuously. The repo build is never touched.
if (arg('pre-fix', false) === true) {
  const vendorRoot = join(home, 'vendor', 'dsh-kimi-tide')
  mkdirSync(vendorRoot, { recursive: true })
  for (const entry of ['package.json', 'cordis.patch.yml']) cpSync(join(pluginDir, entry), join(vendorRoot, entry))
  cpSync(join(pluginDir, 'lib'), join(vendorRoot, 'lib'), { recursive: true })
  const libPath = join(vendorRoot, 'lib', 'index.js')
  const original = readFileSync(libPath, 'utf8')
  const stripped = original.replace(/^[ \t]*known\.add\(KIMI_TIDE_PANEL_EVENT\);?\r?\n/m, '')
  if (stripped === original) throw new Error('--pre-fix: the panel registration line was not found in lib/index.js')
  writeFileSync(libPath, stripped)
  symlinkSync(join(pluginDir, 'node_modules'), join(vendorRoot, 'node_modules'), 'junction')
  pluginDir = vendorRoot
}

// 命名空间断言取稳定语义：期望值来自本插件 package.json 的 name（0.2 世代
// 表单命名空间 = profile 条目 id = 包名），不写死任何命名空间字符串——
// `kimi-tide-router` 是 0.1.x 旧名，写死它就是 2026-09-10 那次静默腐烂的根因。
// 注意在 --pre-fix 之后读取（vendor 拷贝携带同一份 package.json，name 不变）。
const pluginName = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8')).name
if (typeof pluginName !== 'string' || pluginName.length === 0) throw new Error(`cannot read the plugin package name from ${pluginDir}`)

symlinkSync(pluginDir, join(profileModules, 'dsh-kimi-tide'), 'junction')
writeFileSync(join(profileDir, 'cordis.yml'), '# isolated E2E profile root\n[]\n', 'utf8')
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-kimi-tide-e2e',
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-kimi-tide'] } },
}, null, 2) + '\n', 'utf8')

// --- 2. fixtures: synthetic v3 + v4 sessions ---------------------------------
// The storage derives the session's project directory from the header `cwd`, so
// the fixture must live under that exact encoded directory name.
// 行格式两代同形（{type,seq,time,data}，逐行 JSONL，多 zstd 帧追加）；文件名
// 按 generation 命名：session.v3.jsonl.zstd / session.v4.jsonl.zstd。
// v4 夹具合法性依据：与真实生产 v4 会话逐行同构（本机 111 份 v4 实测），
// 且 v3 control 经 v3→v4 迁移加载成功本身就证明该事件集能过 v4 校验。
const CWD = 'E:\\kimi-tide-e2e'
const WORKSPACE = '--E-kimi-tide-e2e--'
const controlId = 'session-e2e-control'
const customId = 'session-e2e-custom-event'
const v4ControlId = 'session-e2e-v4-control'
const v4CustomId = 'session-e2e-v4-custom-event'

function frame(events) {
  return events.map((event) => JSON.stringify(event)).join('\n') + '\n'
}

function writeSession(id, { custom, version }) {
  const now = Date.now()
  const header = { type: 'session', version, id, createdAt: now, cwd: CWD, isSeeded: false, delegationDepth: 0, agentPreset: 'cordis' }
  const events = [
    { type: 'permission/preset', seq: 0, time: now, data: { preset: 'workspace-write' } },
    { type: 'sandbox/mode', seq: 1, time: now, data: { mode: 'workspace-write' } },
    { type: 'approval/policy', seq: 2, time: now, data: { policy: 'ask' } },
  ]
  if (custom) {
    events.push({
      type: 'kimi-tide/panel',
      seq: events.length,
      time: now,
      // Exactly the payload family the pre-1.2.0 plugin wrote; no `ignorable` marker.
      data: { quota: null, kimi: { route: false, key: false }, router: { activePreset: null, presetName: null, defaultTarget: null, ruleCount: 0 }, configSource: 'default', candidates: [], decision: null },
    })
  }
  events.push({ type: 'turn/start', seq: events.length, time: now, data: { turn: 1 } })
  events.push({ type: 'turn/end', seq: events.length, time: now, data: { turn: 1, reason: { kind: 'completed' } } })

  const dir = join(sessionsRoot, WORKSPACE, id)
  mkdirSync(dir, { recursive: true })
  const frames = [
    zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'), CHECKSUM),
    zstdCompressSync(Buffer.from(frame(events), 'utf8'), CHECKSUM),
  ]
  writeFileSync(join(dir, `session.v${version}.jsonl.zstd`), Buffer.concat(frames))
}

writeSession(controlId, { custom: false, version: 3 })
writeSession(customId, { custom: true, version: 3 })
writeSession(v4ControlId, { custom: false, version: 4 })
writeSession(v4CustomId, { custom: true, version: 4 })

// --- 3. probe row in the isolated profile -----------------------------------
const probeSource = join(HERE, 'probe-plugin.mjs')
cpSync(probeSource, join(profileDir, 'e2e-probe.mjs'))
writeFileSync(join(profileDir, 'cordis.patch.yml'), [
  '# Isolated E2E overlay: no product rows are changed, only the probe is added.',
  '- insert:',
  '    - id: kimi-tide-e2e-probe',
  "      name: './e2e-probe.mjs'",
  '      config:',
  `        out: ${JSON.stringify(verdictPath)}`,
  `        timeoutMs: ${Math.max(5_000, Math.min(45_000, timeoutMs - 20_000))}`,
  '        sessionIds:',
  `          - ${controlId}`,
  `          - ${customId}`,
  `          - ${v4ControlId}`,
  `          - ${v4CustomId}`,
  '',
].join('\n'), 'utf8')

// --- 4. boot the real web profile in the isolated home ----------------------
console.log(`[e2e] isolated DSH home : ${home}`)
console.log(`[e2e] source DSH home   : ${sourceHome}`)
console.log(`[e2e] expectation       : ${expect}`)
const logFd = openSync(logPath, 'w')
// Boot through the deployment's own CLI entry with this node binary: no shell
// hop, and the same launcher a user's `dsh web` invocation runs.
const dshBin = join(sourceHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(dshBin)) throw new Error(`cannot locate the dsh CLI entry at ${dshBin}`)
const child = spawn(process.execPath, [dshBin, '--profile', 'web', '--no-open', '--port', '0'], {
  cwd: REPO,
  env: { ...process.env, DSH_HOME: home },
  stdio: ['ignore', logFd, logFd],
})
console.log(`[e2e] booted dsh web (pid ${child.pid}) — waiting for the verdict…`)

const deadline = Date.now() + timeoutMs
let verdict = null
while (Date.now() < deadline) {
  if (existsSync(verdictPath)) {
    try {
      verdict = JSON.parse(readFileSync(verdictPath, 'utf8'))
      break
    } catch {
      /* still being written */
    }
  }
  await new Promise((done) => setTimeout(done, 500))
}

// --- 5. teardown ------------------------------------------------------------
// 平台无关收尾：Windows 用 taskkill 杀整棵进程树；POSIX 直接 SIGKILL 主进程。
if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
else child.kill('SIGKILL')
await new Promise((done) => setTimeout(done, 500))

if (verdict === null) {
  console.error(`[e2e] FAIL: no verdict within ${timeoutMs} ms — boot log tail:`)
  try {
    console.error(readFileSync(logPath, 'utf8').split('\n').slice(-25).join('\n'))
  } catch { /* nothing to show */ }
  if (!keep) rmSync(home, { recursive: true, force: true })
  process.exit(1)
}

// --- 6. assertions ----------------------------------------------------------
const boot = readFileSync(logPath, 'utf8')
const banner = boot.split('\n').find((line) => line.includes('dsh web: http')) ?? null
const control3 = verdict.sessions[controlId]
const custom3 = verdict.sessions[customId]
const control4 = verdict.sessions[v4ControlId]
const custom4 = verdict.sessions[v4CustomId]

// 拒绝消息判据（上游实际文案，必须点名类型本身）：
// - v3：dsh-session-format-v3-to-v4 的 `format v3 contains unknown event type "…" at seq N`；
// - v4（未注册时）：dsh-session 校验层的历史名句 `contains event type "…" (seq N)
//   unknown to this harness and not marked ignorable`（即 2026-09-10 实机事故原话）。
const V3_REFUSAL = /format v3 contains unknown event type "kimi-tide\/panel"/
const V4_REFUSAL = /contains event type "kimi-tide\/panel" \(seq \d+\) unknown to this harness and not marked ignorable/

// 每条 check 附失败详情（detail），FAIL 时原样打印，避免「红而无证据」。
const rows = [
  {
    label: `plugin mounted (settings namespace ${pluginName})`,
    passed: verdict.settingsNamespaces.includes(pluginName),
    detail: `实际命名空间列表: ${JSON.stringify(verdict.settingsNamespaces)}`,
  },
  {
    label: `host catalog has kimi-tide/panel = ${expect === 'ok'}`,
    passed: verdict.catalog.hasPanel === (expect === 'ok'),
    detail: `catalog: ${JSON.stringify(verdict.catalog)}`,
  },
  {
    label: 'host catalog has kimi-tide/review',
    passed: verdict.catalog.hasReview === true,
    detail: `catalog: ${JSON.stringify(verdict.catalog)}`,
  },
  {
    label: 'v3 control session loads',
    passed: control3?.ok === true,
    detail: control3?.ok ? '' : `error: ${control3?.error}`,
  },
  {
    // 上游设计使然：RELEASED_V3_EVENT_TYPES 是冻结字面量 Set，注册救不回。
    // 这条不是能力断言，而是把「v3 历史带自定义类型 ⇒ 按设计拒载」钉成显式
    // 事实：必须拒载、且拒绝消息必须点名 kimi-tide/panel（不许静默放过）。
    label: 'v3 custom-type session ⇒ 上游按设计拒载（RELEASED_V3_EVENT_TYPES 冻结），消息点名 kimi-tide/panel',
    passed: custom3?.ok === false && custom3?.frozen === true && V3_REFUSAL.test(String(custom3?.error ?? '')),
    detail: custom3?.ok ? '意外加载成功（上游冻结判据被突破？需复核）' : `error: ${custom3?.error} | frozen=${custom3?.frozen}`,
  },
  {
    label: 'v4 control session loads',
    passed: control4?.ok === true,
    detail: control4?.ok ? '' : `error: ${control4?.error}`,
  },
  {
    // 本 E2E 真正守的承诺：插件注册 ⇒ v4 历史可读；剥掉注册 ⇒ 拒载且点名类型。
    label: expect === 'ok'
      ? 'v4 custom-type session loads（注册生效 ⇒ v4 历史可读）'
      : 'v4 custom-type session refused，消息点名 kimi-tide/panel',
    passed: expect === 'ok'
      ? custom4?.ok === true
      : custom4?.ok === false && V4_REFUSAL.test(String(custom4?.error ?? '')),
    detail: custom4?.ok ? `OPENS (${custom4.events} events)` : `error: ${custom4?.error} | frozen=${custom4?.frozen}`,
  },
]

console.log('\n[e2e] evidence')
console.log(`  plugin source  : ${pluginDir}`)
console.log(`  catalog        : panel=${verdict.catalog.hasPanel} review=${verdict.catalog.hasReview} revise=${verdict.catalog.hasRevise} size=${verdict.catalog.size}`)
console.log(`  catalog source : ${verdict.catalog.resolvedFrom ?? '(unavailable)'}`)
console.log(`  settings ns    : ${verdict.settingsNamespaces.join(', ') || '(none reported)'}`)
console.log(`  v3 control     : ${control3?.ok ? `OPENS (${control3.events} events)` : `REFUSED -> ${control3?.error}`}`)
console.log(`  v3 custom      : ${custom3?.ok ? `OPENS (${custom3.events} events)` : `REFUSED (upstream frozen) -> ${custom3?.error}`}`)
console.log(`  v4 control     : ${control4?.ok ? `OPENS (${control4.events} events)` : `REFUSED -> ${control4?.error}`}`)
console.log(`  v4 custom      : ${custom4?.ok ? `OPENS (${custom4.events} events)` : `REFUSED -> ${custom4?.error}`}`)
console.log(`  probe attempts : v3c=${custom3?.attempts} v4c=${custom4?.attempts} (elapsed ${verdict.elapsedMs} ms)`)
if (banner) console.log(`  boot banner    : ${banner.trim()}`)

console.log('\n[e2e] checks')
let failed = 0
for (const { label, passed, detail } of rows) {
  if (!passed) failed += 1
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label}`)
  if (!passed && detail) console.log(`       ↳ ${detail}`)
}

if (keep) console.log(`\n[e2e] artifacts kept at ${home}`)
else rmSync(home, { recursive: true, force: true })

console.log(`\n[e2e] ${failed === 0 ? `PASS (expect=${expect})` : `FAIL (${failed} check(s), expect=${expect})`}`)
process.exit(failed === 0 ? 0 : 1)
