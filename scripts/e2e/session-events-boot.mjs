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
 * Fixtures (both v3, current generation):
 *   control   — permission/sandbox/approval events only → must always load
 *   custom    — same, plus a `kimi-tide/panel` event WITHOUT `ignorable: true`
 *               → loads only while the plugin registers that type at apply()
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

symlinkSync(pluginDir, join(profileModules, 'dsh-kimi-tide'), 'junction')
writeFileSync(join(profileDir, 'cordis.yml'), '# isolated E2E profile root\n[]\n', 'utf8')
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-kimi-tide-e2e',
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-kimi-tide'] } },
}, null, 2) + '\n', 'utf8')

// --- 2. fixtures: synthetic v3 sessions -------------------------------------
// The storage derives the session's project directory from the header `cwd`, so
// the fixture must live under that exact encoded directory name.
const CWD = 'E:\\kimi-tide-e2e'
const WORKSPACE = '--E-kimi-tide-e2e--'
const controlId = 'session-e2e-control'
const customId = 'session-e2e-custom-event'

function frame(events) {
  return events.map((event) => JSON.stringify(event)).join('\n') + '\n'
}

function writeSession(id, { custom }) {
  const now = Date.now()
  const header = { type: 'session', version: 3, id, createdAt: now, cwd: CWD, isSeeded: false, delegationDepth: 0, agentPreset: 'cordis' }
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
  writeFileSync(join(dir, 'session.v3.jsonl.zstd'), Buffer.concat(frames))
}

writeSession(controlId, { custom: false })
writeSession(customId, { custom: true })

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
spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
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
const control = verdict.sessions[controlId]
const custom = verdict.sessions[customId]

const rows = [
  ['plugin mounted (settings namespace kimi-tide-router)', verdict.settingsNamespaces.includes('kimi-tide-router')],
  [`catalog has kimi-tide/panel = ${expect === 'ok'}`, verdict.catalog.hasPanel === (expect === 'ok')],
  ['catalog has kimi-tide/review', verdict.catalog.hasReview === true],
  ['control session loads', control?.ok === true],
  [`custom-event session ${expect === 'ok' ? 'loads' : 'refused on the custom type'}`, expect === 'ok'
    ? custom?.ok === true
    : custom?.ok === false && /kimi-tide\/panel/.test(String(custom?.error ?? ''))],
]
if (expect === 'refused') {
  rows.push(['refusal names the unknown type + ignorable rule', /unknown to this harness and not marked ignorable/.test(String(custom?.error ?? ''))])
}

console.log('\n[e2e] evidence')
console.log(`  plugin source  : ${pluginDir}`)
console.log(`  catalog        : panel=${verdict.catalog.hasPanel} review=${verdict.catalog.hasReview} size=${verdict.catalog.size}`)
console.log(`  settings ns    : ${verdict.settingsNamespaces.join(', ') || '(none reported)'}`)
console.log(`  control        : ${control?.ok ? `OPENS (${control.events} events)` : `REFUSED -> ${control?.error}`}`)
console.log(`  custom event   : ${custom?.ok ? `OPENS (${custom.events} events)` : `REFUSED -> ${custom?.error}`}`)
console.log(`  probe attempts : ${custom?.attempts} (elapsed ${verdict.elapsedMs} ms)`)
if (banner) console.log(`  boot banner    : ${banner.trim()}`)

console.log('\n[e2e] checks')
let failed = 0
for (const [label, passed] of rows) {
  if (!passed) failed += 1
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label}`)
}

if (keep) console.log(`\n[e2e] artifacts kept at ${home}`)
else rmSync(home, { recursive: true, force: true })

console.log(`\n[e2e] ${failed === 0 ? `PASS (expect=${expect})` : `FAIL (${failed} check(s), expect=${expect})`}`)
process.exit(failed === 0 ? 0 : 1)
