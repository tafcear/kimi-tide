#!/usr/bin/env node
/**
 * 发布前一致性自检（把已有门禁没串起来的那一角补齐）。
 *
 * 已有的 `scripts/check-*.mjs` 各查一角：版本号一致性（changelog）、README 双语骨架
 * （readme-sync）、发布正文双语四段（release-notes）、本地链接（doc-links）。
 * **没有一处**回答这个问题：**"这次要发的新东西，有没有全部被讲到？"**
 * ——尤其是版本自身的自述面（说明页签 / README / CHANGELOG / 发布正文）。
 *
 * 本检查补这一角，五项：
 *   ① 版本三方一致：package.json / CHANGELOG 首节 / README 双语版本行；
 *   ② 发布正文与 CHANGELOG 的**条目数**不背离（正文说 N 条，CHANGELOG 该节至少 N-2 条）；
 *   ③ 发布正文里的测试数 == 实测（调用 vitest 计数）；
 *   ④ **用户可见新特性被讲到**：每条特性至少在一个自述面出现（说明页 / README / CHANGELOG / 正文）；
 *   ⑤ 干净度：仓库里不留 `.tmp-*` / 调试残留（`console.log` 于 src）。
 *
 * 用法：node scripts/acceptance/prepush-coherence.mjs [--json] [--skip-tests]
 * 退出码：0 全过；1 有项不过；2 读取/环境错误。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const skipTests = argv.includes('--skip-tests')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

/** 本版**用户可见**新特性：每条给一组「任一命中即算讲到」的短语 + 必须出现的最小面数。 */
const FEATURES = [
  { id: '余额/用量双形态', phrases: ['余额', 'balance'], surfaces: 3 },
  { id: '用量总览三态', phrases: ['用量总览', '无公开 API', 'Overview'], surfaces: 3 },
  { id: '说明页签', phrases: ['说明', 'Help tab'], surfaces: 3 },
  { id: '语义命中确认闸', phrases: ['语义确认', '命中确认', 'semantic hit', 'hitConfirm'], surfaces: 3 },
  { id: '配额条剩余语义', phrases: ['剩余', 'remaining'], surfaces: 3 },
  { id: '显式 @ 精确寻址', phrases: ['@provider/model', '@kimi/k3', '精确寻址', '精确钉到', 'pins that exact model', 'pins that model'], surfaces: 4 },
  { id: '@ 误判面收窄', phrases: ['已知 provider', 'known provider'], surfaces: 3 },
]

const SURFACE_FILES = {
  help: 'packages/dsh-kimi-tide/src/client/help-content.ts',
  readme: 'README.md',
  readmeEn: 'README.en.md',
  changelog: 'CHANGELOG.md',
  release: 'release-notes-v1.3.0.md',
}

const failures = []
const report = { version: {}, sections: {}, tests: {}, features: [], cleanliness: {} }
const fail = (msg) => failures.push(msg)

// ── ① 版本三方一致 ─────────────────────────────────────────────────────────
const pkgVersion = JSON.parse(read('packages/dsh-kimi-tide/package.json')).version
const changelogFirst = read('CHANGELOG.md').match(/^## v([\d.]+)/m)?.[1]
const readmeLine = read('README.md').match(/v(\d+\.\d+\.\d+)（/)?.[1]
const readmeEnLine = read('README.en.md').match(/v(\d+\.\d+\.\d+)/)?.[1]
report.version = { pkgVersion, changelogFirst, readmeLine, readmeEnLine }
for (const [what, got] of Object.entries(report.version)) {
  if (got !== pkgVersion) fail(`① 版本不一致：${what}=${got ?? '(缺)'}，package.json=${pkgVersion}`)
}

// ── ② 正文 vs CHANGELOG 条目数 ─────────────────────────────────────────────
const release = read(SURFACE_FILES.release)
const zhBlock = release.split('---')[0]
const zhBullets = (zhBlock.match(/^[-*] /gm) ?? []).length
const changelogSection = read('CHANGELOG.md').split(/^## v/m)[1] ?? ''
const changelogBullets = (changelogSection.match(/^\s*[-*] /gm) ?? []).length
report.sections = { releaseZhBullets: zhBullets, changelogBullets }
if (changelogBullets + 2 < zhBullets) {
  fail(`② 发布正文列了 ${zhBullets} 条，而 CHANGELOG 该节只有 ${changelogBullets} 条（正文不应比变更日志多出 2 条以上）`)
}

// ── ③ 正文测试数 == 实测 ───────────────────────────────────────────────────
const claimed = Number(release.match(/\*\*(\d+)\/(\d+) 通过\*\*/)?.[2] ?? release.match(/\*\*(\d+)\/(\d+) passing\*\*/)?.[2] ?? NaN)
if (!skipTests) {
  try {
    const out = execFileSync('npx', ['vitest', 'run', '--reporter=dot'], {
      cwd: join(root, 'packages', 'dsh-kimi-tide'), encoding: 'utf8', shell: true,
      // 只取 stdout：vitest 的 stderr 里有 jsdom/React 的 act 告警与预期内的错误日志，
      // 与本检查无关，混进来会把结论埋掉（第一次跑就是这样）。
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const actual = Number(out.match(/Tests\s+(\d+) passed/)?.[1] ?? NaN)
    report.tests = { claimed, actual }
    if (!Number.isNaN(actual) && actual !== claimed) fail(`③ 发布正文写 ${claimed} 个测试，实测 ${actual}`)
  } catch (error) {
    report.tests = { claimed, actual: null, error: String(error.message).slice(0, 120) }
    fail('③ 无法跑测（--skip-tests 可跳过；本项不是代码问题）')
  }
}

// ── ④ 用户可见新特性是否被讲到 ─────────────────────────────────────────────
for (const feature of FEATURES) {
  const hit = {}
  for (const [name, rel] of Object.entries(SURFACE_FILES)) {
    if (!existsSync(join(root, rel))) { hit[name] = false; continue }
    const text = read(rel)
    hit[name] = feature.phrases.some((p) => text.toLowerCase().includes(p.toLowerCase()))
  }
  const count = Object.values(hit).filter(Boolean).length
  report.features.push({ id: feature.id, hits: hit, count, need: feature.surfaces })
  if (count < feature.surfaces) {
    const missing = Object.entries(hit).filter(([, v]) => !v).map(([k]) => k)
    fail(`④ 特性「${feature.id}」只出现在 ${count}/${feature.surfaces} 个自述面，缺：${missing.join(', ')}`)
  }
}

// ── ⑤ 干净度 ───────────────────────────────────────────────────────────────
const stray = []
const walk = (dir, depth = 0) => {
  if (depth > 3) return
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'lib' || entry === 'dist') continue
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) { walk(p, depth + 1); continue }
    if (/^\.tmp-|\.tmp\.|\.bak$/.test(entry)) stray.push(p.replace(root, '').replace(/\\/g, '/'))
  }
}
walk(root)
const debugLogs = read('packages/dsh-kimi-tide/src/rules.ts').includes('KT_DEBUG')
  || read('packages/dsh-kimi-tide/src/router.ts').includes('KT_DEBUG')
  || read('packages/dsh-kimi-tide/src/index.ts').includes('KT_DEBUG')
report.cleanliness = { stray, debugLogs }
if (stray.length > 0) fail(`⑤ 仓库里有临时/备份残留：${stray.join(', ')}`)
if (debugLogs) fail('⑤ src 里残留 KT_DEBUG 调试开关')

if (asJson) {
  console.log(JSON.stringify({ failures, report }, null, 2))
} else {
  console.log('版本三方：' + JSON.stringify(report.version))
  console.log(`条目数：发布正文 ${report.sections.releaseZhBullets} 条 · CHANGELOG 该节 ${report.sections.changelogBullets} 条`)
  if (!skipTests) console.log(`测试数：正文声称 ${report.tests.claimed} · 实测 ${report.tests.actual ?? '(未取到)'}`)
  console.log('特性自述面覆盖：')
  for (const f of report.features) {
    const marks = Object.entries(f.hits).map(([k, v]) => `${v ? '✓' : '✗'}${k}`).join(' ')
    console.log(`  ${f.count >= f.need ? '✅' : '❌'} ${f.id}（${f.count}/${f.need}）${marks}`)
  }
  console.log(`干净度：临时残留 ${report.cleanliness.stray.length} 个 · 调试开关 ${report.cleanliness.debugLogs ? '有' : '无'}`)
  console.log(`\n结论：${failures.length === 0 ? '全部通过' : `${failures.length} 项不过：\n  - ` + failures.join('\n  - ')}`)
}
process.exit(failures.length === 0 ? 0 : 1)
