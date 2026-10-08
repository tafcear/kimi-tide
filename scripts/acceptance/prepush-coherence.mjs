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
const skipFeatures = argv.includes('--skip-features')
for (const token of argv) {
  if (!['--json', '--skip-tests', '--skip-features'].includes(token)) {
    console.error(`[参数错误] 不认识的参数：${token}\n用法：node scripts/acceptance/prepush-coherence.mjs [--json] [--skip-tests] [--skip-features]`)
    process.exit(2)
  }
}
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const pkgVersion = JSON.parse(read('packages/dsh-kimi-tide/package.json')).version
const releaseRel = `release-notes-v${pkgVersion}.md`

/**
 * 本版**用户可见**新特性（第 ④ 项的输入）：按版本放在
 * `scripts/acceptance/coherence-features/v<版本>.json`，形如
 *   [{ "id": "余额/用量双形态", "phrases": ["余额","balance"], "surfaces": 3 }]
 * 找不到该版本的文件就**跳过第 ④ 项并明说**（不是失败）——因为"本版有哪些新特性"
 * 只有人在写发布正文时知道，脚本不该编。
 *
 * （2026-10-08 修：此前这里把 v1.3.0 的 7 条特性与 `release-notes-v1.3.0.md`
 *  硬编码在源文件里，导致每个后续版本都必然报「正文 14 条 vs CHANGELOG 4 条」
 *  「正文写 691 个测试、实测 1158」这类**假阳性**。旧清单已归档为
 *  `coherence-features/v1.3.0.json`，一条不丢。）
 */
const featuresRel = `scripts/acceptance/coherence-features/v${pkgVersion}.json`
const features = existsSync(join(root, featuresRel)) ? JSON.parse(read(featuresRel)) : null

const SURFACE_FILES = {
  help: 'packages/dsh-kimi-tide/src/client/help-content.ts',
  readme: 'README.md',
  readmeEn: 'README.en.md',
  changelog: 'CHANGELOG.md',
  release: releaseRel, // ← 由 package.json 版本推出（此前硬编码 release-notes-v1.3.0.md）
}

const failures = []
const warnings = []
const report = { version: {}, sections: {}, tests: {}, features: [], cleanliness: {} }
const fail = (msg) => failures.push(msg)
const warn = (msg) => warnings.push(msg)

/**
 * HEAD 是否恰好是一个 tag（＝正在发版那一刻）。
 * 用途：发布正文描述的是**已发布的那一版**；而开发中测试数长出来是正常的
 * （2026-10-08 实测：正文 1129、当前 1158 —— 护栏那版加了 29 条）。
 * 所以「测试数对不上」只在发版提交上算失败，平时只报警告。
 */
const isReleaseCommit = (() => {
  try {
    execFileSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    return true
  } catch {
    return false
  }
})()

// ── ① 版本三方一致 ─────────────────────────────────────────────────────────
const changelogFirst = read('CHANGELOG.md').match(/^## v([\d.]+)/m)?.[1]
const readmeLine = read('README.md').match(/当前版本：\*\*v(\d+\.\d+\.\d+)/)?.[1]
// 英文侧此前用 /v(\d+\.\d+\.\d+)/ —— 会命中文档散文里最早出现的版本号（实测命中 v1.4.0，
// 凭空造出一条"版本不一致"）。现与中文侧同款：只认「Current version: **vX.Y.Z」这一行。
const readmeEnLine = read('README.en.md').match(/Current version:\s*\*\*v(\d+\.\d+\.\d+)/)?.[1]
report.version = { pkgVersion, changelogFirst, readmeLine, readmeEnLine }
for (const [what, got] of Object.entries(report.version)) {
  if (got !== pkgVersion) fail(`① 版本不一致：${what}=${got ?? '(缺)'}，package.json=${pkgVersion}`)
}

// ── ② 正文 vs CHANGELOG 条目数 ─────────────────────────────────────────────
if (!existsSync(join(root, releaseRel))) {
  console.error(`✗ 找不到本版发布正文：${releaseRel}\n   （发布正文是发版流程的产物；先写正文，或确认 package.json 版本是否已对齐）`)
  process.exit(2)
}
const release = read(SURFACE_FILES.release)
const zhBlock = release.split('---')[0]
// 只数「### 本次更新」这一节里的条目。此前把整块中文（含「### 验证与验收」的条目）一起数，
// 于是一篇"4 条更新 + 3 条验收"的正文被数成 7 条、拿去跟 CHANGELOG 的 4 条比 ⇒ 假阳性。
const zhUpdateSection = zhBlock.split(/^### /m).find((s) => s.startsWith('本次更新')) ?? ''
const zhBullets = (zhUpdateSection.match(/^[-*] /gm) ?? []).length
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
    report.tests = { claimed, actual, releaseCommit: isReleaseCommit }
    if (!Number.isNaN(actual) && actual !== claimed) {
      if (isReleaseCommit) fail(`③ 发布正文写 ${claimed} 个测试，实测 ${actual}`)
      else warn(`③ 正文声称 ${claimed} 个测试、当前实测 ${actual}（HEAD 不是 tag ⇒ 开发中的正常漂移，不判失败；发版提交上会判失败）`)
    }
  } catch (error) {
    report.tests = { claimed, actual: null, error: String(error.message).slice(0, 120) }
    fail('③ 无法跑测（--skip-tests 可跳过；本项不是代码问题）')
  }
}

// ── ④ 用户可见新特性是否被讲到（按版本的清单；缺则跳过，不判失败）────────────
if (skipFeatures) {
  report.featuresSkipped = '--skip-features'
} else if (features === null) {
  report.featuresSkipped = `本版没有 ${featuresRel}（"本版有哪些新特性"只有写正文的人知道，脚本不编）`
} else {
  for (const feature of features) {
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
  console.log(JSON.stringify({ failures, warnings, report }, null, 2))
} else {
  console.log('版本三方：' + JSON.stringify(report.version))
  console.log(`条目数：发布正文 ${report.sections.releaseZhBullets} 条 · CHANGELOG 该节 ${report.sections.changelogBullets} 条`)
  if (!skipTests) console.log(`测试数：正文声称 ${report.tests.claimed} · 实测 ${report.tests.actual ?? '(未取到)'}`)
  if (report.featuresSkipped !== undefined) {
    console.log(`特性自述面覆盖：跳过（${report.featuresSkipped}）`)
  } else {
    console.log('特性自述面覆盖：')
    for (const f of report.features) {
      const marks = Object.entries(f.hits).map(([k, v]) => `${v ? '✓' : '✗'}${k}`).join(' ')
      console.log(`  ${f.count >= f.need ? '✅' : '❌'} ${f.id}（${f.count}/${f.need}）${marks}`)
    }
  }
  console.log(`干净度：临时残留 ${report.cleanliness.stray.length} 个 · 调试开关 ${report.cleanliness.debugLogs ? '有' : '无'}`)
  if (warnings.length > 0) {
    console.log(`\n警告（不判失败）：\n  - ` + warnings.join('\n  - '))
  }
  console.log(`\n结论：${failures.length === 0 ? '全部通过' : `${failures.length} 项不过：\n  - ` + failures.join('\n  - ')}`)
}
process.exit(failures.length === 0 ? 0 : 1)
