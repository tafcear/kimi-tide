#!/usr/bin/env node
/**
 * Compliance gate for dsh-kimi-bridge (`npm run check`).
 *
 * Validates:
 *   1. package metadata   — name/version/type/peerDependencies
 *   2. bundle manifest    — dsh.bundle.patch exists and is referenced
 *   3. mount config       — cordis.patch.yml parses and carries insert rows
 *   4. entry contract     — src entry exports `name` and `apply`
 *   5. client half        — dsh.client declaration + exports["./client"]
 *   6. relative imports   — explicit .js extensions (harness runtime is ESM)
 *
 * Exit code 0 = compliant.
 */

import { access, readFile, readdir } from 'node:fs/promises'
import { parse } from 'yaml'

const ROOT = new URL('..', import.meta.url)
const results = []

function report(check, ok, detail = '') {
  results.push({ check, ok, detail })
}

async function exists(rel) {
  try {
    await access(new URL(rel, ROOT))
    return true
  } catch {
    return false
  }
}

async function read(rel) {
  return readFile(new URL(rel, ROOT), 'utf8')
}

/** Recursively list files under a project-relative directory. */
async function walk(rel) {
  const out = []
  async function rec(dir) {
    let entries
    try {
      entries = await readdir(new URL(dir, ROOT), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = `${dir}${dir.endsWith('/') ? '' : '/'}${entry.name}`
      if (entry.isDirectory()) await rec(full)
      else out.push(full)
    }
  }
  await rec(rel)
  return out
}

// --- 1. package metadata ---------------------------------------------------
let pkg
try {
  pkg = JSON.parse(await read('package.json'))
  report('package.json parses', true)
} catch (error) {
  report('package.json parses', false, String(error))
  printAndExit()
}

report('name is a valid npm package name', /^[a-z0-9][a-z0-9-]*$/.test(pkg.name ?? ''), pkg.name)
report('version is set', typeof pkg.version === 'string' && pkg.version.length > 0, pkg.version)
report('type is module (ESM)', pkg.type === 'module', pkg.type)
report(
  'peerDependencies declare @deepseek-ai/cordis',
  Boolean(pkg.peerDependencies && pkg.peerDependencies['@deepseek-ai/cordis']),
  pkg.peerDependencies?.['@deepseek-ai/cordis'],
)

// --- 2. bundle manifest ----------------------------------------------------
const patchRel = pkg.dsh?.bundle?.patch
report('dsh.bundle.patch is declared', typeof patchRel === 'string' && patchRel.length > 0, patchRel)
if (typeof patchRel === 'string' && patchRel.length > 0) {
  report(`dsh.bundle.patch file exists (${patchRel})`, await exists(patchRel))
}

// --- 3. mount config -------------------------------------------------------
const patchPath = typeof patchRel === 'string' && patchRel.length > 0 ? patchRel : 'cordis.patch.yml'
if (await exists(patchPath)) {
  let doc
  try {
    doc = parse(await read(patchPath))
    report(`mount config parses (${patchPath})`, true)
  } catch (error) {
    report(`mount config parses (${patchPath})`, false, String(error))
    doc = null
  }
  if (Array.isArray(doc)) {
    const inserts = doc.filter((row) => row && typeof row === 'object' && Array.isArray(row.insert))
    report('mount config carries at least one insert row', inserts.length > 0)
    const rows = inserts.flatMap((row) => row.insert)
    const bad = rows.filter((r) => !r || typeof r.id !== 'string' || typeof r.name !== 'string')
    report('every inserted row has id + name', bad.length === 0, bad.length ? JSON.stringify(bad[0]) : '')
  } else {
    report('mount config is a YAML list of patch entries', false, 'expected an array')
  }
} else {
  report(`mount config exists (${patchPath})`, false, 'missing file')
}

// --- 4. entry contract -----------------------------------------------------
const entry = pkg.main ? pkg.main.replace(/^\.\//, '') : 'src/index.ts'
const entryExists = await exists(entry)
report(`entry exists (${entry})`, entryExists)
if (entryExists) {
  const source = await read(entry)
  report('entry exports `name`', /export\s+(const|let)\s+name\b/.test(source))
  report('entry exports `apply`', /export\s+function\s+apply\b/.test(source))
}

// --- 5. client half --------------------------------------------------------
report('dsh.client.platform is web', pkg.dsh?.client?.platform === 'web', pkg.dsh?.client?.platform)
const clientInject = pkg.dsh?.client?.inject
report(
  'dsh.client injects runtime + conversation',
  Array.isArray(clientInject)
    && clientInject.includes('@deepseek-ai/dsh-client-runtime')
    && clientInject.includes('@deepseek-ai/dsh-client-ui-conversation'),
  JSON.stringify(clientInject),
)
report('legacy dshClient field is absent', pkg.dshClient === undefined, JSON.stringify(pkg.dshClient))
const clientExport = pkg.exports?.['./client']
report('exports["./client"] is declared', typeof clientExport === 'object' && clientExport !== null, JSON.stringify(clientExport))
const clientDefault = clientExport?.default ?? clientExport
if (typeof clientDefault === 'string') {
  report(`client bundle path exists (${clientDefault})`, await exists(clientDefault.replace(/^\.\//, '')))
}

// --- 6. source conventions -------------------------------------------------
const badImports = []
for (const file of await walk('src')) {
  if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue
  const source = await read(file)
  for (const m of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const spec = m[1]
    if (!spec.endsWith('.js') && !spec.endsWith('.json')) {
      badImports.push(`${file}: ${spec}`)
    }
  }
}
report(
  'relative imports use explicit .js extensions',
  badImports.length === 0,
  badImports[0] ?? '',
)

// --- summary ---------------------------------------------------------------
const failed = results.filter((r) => !r.ok)
console.log('\ndsh-kimi-bridge compliance check')
console.log('----------------------------------')
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.check}${r.detail ? ` — ${r.detail}` : ''}`)
}
console.log('----------------------------------')
console.log(`${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  console.error(`\n${failed.length} check(s) failed. Fix the issues above, then re-run npm run check.`)
  process.exit(1)
}
console.log('All checks passed ✅')

function printAndExit() {
  console.error('\ndsh-kimi-bridge compliance check failed: package.json is unreadable')
  process.exit(1)
}
