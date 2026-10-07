#!/usr/bin/env node
// 客户端文案 locale 门禁（规则本体：docs/agents/terminology.md §4/§6）。
//
// 为什么有这条闸：上游 DSH 的明文规则是「Client UI copy is locale-owned」
// （deepseek-harness 仓 AGENTS.md:154，verify-client-ui-i18n 拒绝硬编码文案）。
// 本仓此前没有这道闸，agent 随手写的中文口语能一路进交付面；W 系列任务把文案搬进
// src/locales/{zh,en}/*.ts 分表后，本闸把「硬编码文案回流」变成红。
//
// 判据（两大块）：
//   A. 硬编码扫描（AST 级，不用正则——注释天然不进 TS AST）：
//      扫 packages/dsh-kimi-tide/src/client/**/*.{ts,tsx} 与 src/routing-view.ts，
//      字符串字面量 / 模板字面量（head/middle/tail）/ JSX 文本节点里出现
//      汉字（\u3400-\u4DBF \u4E00-\u9FFF \uF900-\uFAFF）、
//      中文标点（\u3000-\u303F）、全角形式（\uFF00-\uFFEF）、
//      破折号——（\u2014/\u2015）、省略号…（\u2026）任一字符即违规。
//      例外：src/client/styles.ts 的 CLIENT_CSS 是 CSS 大模板串——先剥掉 /* … */ 注释
//      再判（只剥注释，CSS 里 content: 的真实中文仍然红）；剥离时保持行号不变。
//      注意：不用 \p{Han}（本机 Node v24.19.0 的 V8 拒绝该属性名），一律显式码位范围。
//   B. 表结构校验（用 esbuild 把 5×2 张 surface 表打成临时 ESM 再 import 拿真值）：
//      zh/en 键集完全相等；跨 surface（shared/settings/panel/help/view）无重复键；
//      值为非空字符串；同一键 zh/en 占位符（{0}/{name}）集合一致；
//      locale/{zh,en}.json 的 meta.title/meta.description 存在且非空。
//
// 用法：node scripts/check-client-i18n.mjs [--json] [--roots <dir…>] [--fixture <dir>]
//   --roots    只扫指定目录/文件（硬编码扫描；表结构校验仍在真实仓库上跑）——负控用
//   --fixture  用 <dir> 整体替换包根（其下的 src/client、src/routing-view.ts、
//              src/locales/**、locale/*.json 存在才扫）——负控用
// 退出码：0 通过；1 有违规（逐条打印，末尾给「怎么改」一句）。
// 依赖：typescript 与 esbuild 均经 createRequire 从
//   packages/dsh-kimi-tide/package.json 解析（不给根目录凭空加依赖）。

import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const defaultPkg = join(repoRoot, 'packages', 'dsh-kimi-tide')
const pkgRequire = createRequire(join(defaultPkg, 'package.json'))
const ts = pkgRequire('typescript')

// ---- CLI ----
const argv = process.argv.slice(2)
const wantJson = argv.includes('--json')
const rootsFlag = argv.indexOf('--roots')
const fixtureFlag = argv.indexOf('--fixture')
const cliRootsArgs =
  rootsFlag !== -1 ? argv.slice(rootsFlag + 1).filter((a) => !a.startsWith('--')) : null
const cliRoots = cliRootsArgs?.map((a) => resolve(repoRoot, a))
const fixtureDir = fixtureFlag !== -1 ? argv[fixtureFlag + 1] : null
const pkgRoot = fixtureDir ? resolve(repoRoot, fixtureDir) : defaultPkg

const HARD_CODED_SCANNED_EXTENSIONS = /\.(ts|tsx)$/

/** 违规字符集（显式码位范围；含中文标点/全角/破折号/省略号——拼接用标点也要拦）。 */
const BAD_CHARS = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF\u2014\u2015\u2026]/
const BAD_CHARS_DESC =
  '汉字/中文标点（U+3000–U+303F）/全角形式（U+FF00–U+FFEF）/——/…'

/** 硬编码扫描的受扫文件（--roots 覆盖时只扫给定根）。 */
function hardcodedTargets() {
  if (cliRoots) {
    const files = []
    for (const root of cliRoots) {
      let st
      try {
        st = statSync(root)
      } catch {
        continue // 不存在的根：跳过（负控临时目录可能只造了一部分）
      }
      if (st.isDirectory()) walk(root, files)
      else if (HARD_CODED_SCANNED_EXTENSIONS.test(root)) files.push(root)
    }
    return files
  }
  const files = []
  const clientDir = join(pkgRoot, 'src', 'client')
  if (existsSync(clientDir)) walk(clientDir, files)
  const routing = join(pkgRoot, 'src', 'routing-view.ts')
  if (existsSync(routing)) files.push(routing)
  return files
}

function walk(dir, files) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, files)
    else if (HARD_CODED_SCANNED_EXTENSIONS.test(name)) files.push(full)
  }
}

/** 剥掉 /* … *\/ 注释并保持每个字符的行内位置（换行保留），使行号不漂移。 */
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 对一个文件做 AST 级硬编码扫描；返回 findings。 */
function scanFile(file) {
  let text = readFileSync(file, 'utf8')
  const isStyles = relative(pkgRoot, file).replace(/\\/g, '/') === 'src/client/styles.ts'
  if (isStyles) text = stripCssComments(text)
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const findings = []
  const check = (node, literal) => {
    if (literal.length === 0 || !BAD_CHARS.test(literal)) return
    const pos = node.getStart(sf)
    const { line } = sf.getLineAndCharacterOfPosition(pos)
    findings.push({ file: relative(repoRoot, file).replace(/\\/g, '/'), line: line + 1, excerpt: literal.trim().slice(0, 80) })
  }
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node, node.text)
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) check(node, node.text)
    else if (ts.isJsxText(node)) check(node, node.getText(sf))
    node.forEachChild(visit)
  }
  visit(sf)
  return findings
}

// ---- 表结构校验 ----
const SURFACES = ['shared', 'settings', 'panel', 'help', 'view']

async function loadTables() {
  const zhFiles = []
  const enFiles = []
  for (const s of SURFACES) {
    const zhFile = join(pkgRoot, 'src', 'locales', 'zh', `${s}.ts`)
    const enFile = join(pkgRoot, 'src', 'locales', 'en', `${s}.ts`)
    if (existsSync(zhFile)) zhFiles.push([s, zhFile])
    if (existsSync(enFile)) enFiles.push([s, enFile])
  }
  if (zhFiles.length + enFiles.length === 0) return null
  // esbuild 在 Windows 上无法 resolve file:// URL 形式的 specifier，用正斜杠绝对路径
  const importPath = (f) => f.replace(/\\/g, '/')
  const entry = [
    ...zhFiles.map(([s, f], i) => `import * as z${i} from ${JSON.stringify(importPath(f))}`),
    ...enFiles.map(([s, f], i) => `import * as e${i} from ${JSON.stringify(importPath(f))}`),
    'export default {',
    `  zh: { ${zhFiles.map(([s], i) => `${JSON.stringify(s)}: z${i}.zh`).join(', ')} },`,
    `  en: { ${enFiles.map(([s], i) => `${JSON.stringify(s)}: e${i}.en`).join(', ')} },`,
    '}',
    '',
  ].join('\n')
  const tmp = mkdtempSync(join(tmpdir(), 'kt-i18n-'))
  const entryFile = join(tmp, 'entry.mjs')
  const outFile = join(tmp, 'tables.mjs')
  try {
    const esbuild = pkgRequire('esbuild')
    // Windows 上 file:// import 需要 loader 约束，避免 esbuild 猜扩展名
    writeFileSync(entryFile, entry)
    await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: outFile,
      logLevel: 'silent',
    })
    const mod = await import(`${pathToFileURL(outFile).href}?v=${Date.now()}`)
    return mod.default
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

const placeholders = (value) => new Set((value.match(/\{[^{}]+\}/g) ?? []).map((p) => p.slice(1, -1)))

function checkTables(tables, findings) {
  const zhSurfaces = tables?.zh ?? {}
  const enSurfaces = tables?.en ?? {}
  const surfaceNames = new Set([...Object.keys(zhSurfaces), ...Object.keys(enSurfaces)])
  for (const s of surfaceNames) {
    const zhT = zhSurfaces[s]
    const enT = enSurfaces[s]
    if (!zhT) {
      findings.push({ kind: 'missing-surface', detail: `zh/${s}.ts 缺失（en 侧存在）` })
      continue
    }
    if (!enT) {
      findings.push({ kind: 'missing-surface', detail: `en/${s}.ts 缺失（zh 侧存在）` })
      continue
    }
    const zhKeys = Object.keys(zhT)
    const enKeys = new Set(Object.keys(enT))
    for (const key of zhKeys) {
      if (!enKeys.has(key)) findings.push({ kind: 'keyset', detail: `en/${s}.ts 缺键「${key}」` })
      else enKeys.delete(key)
    }
    for (const extra of enKeys) findings.push({ kind: 'keyset', detail: `en/${s}.ts 多键「${extra}」（zh 无此键）` })
    for (const key of zhKeys) {
      const value = zhT[key]
      if (typeof value !== 'string' || value.trim() === '')
        findings.push({ kind: 'empty-value', detail: `zh/${s}.ts「${key}」值为空/非字符串` })
    }
    for (const [key, value] of Object.entries(enT)) {
      if (typeof value !== 'string' || value.trim() === '')
        findings.push({ kind: 'empty-value', detail: `en/${s}.ts「${key}」值为空/非字符串` })
    }
  }
  // 两两求交（防"两张表各写一份、后者静默覆盖"）
  const names = [...surfaceNames]
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = zhSurfaces[names[i]]
      const b = zhSurfaces[names[j]]
      if (!a || !b) continue
      for (const key of Object.keys(a)) {
        if (Object.prototype.hasOwnProperty.call(b, key))
          findings.push({ kind: 'duplicate-key', detail: `跨表重复键「${key}」（${names[i]} / ${names[j]}）` })
      }
    }
  }
  // 占位符集合一致（zh/en 同键）
  for (const s of names) {
    const zhT = zhSurfaces[s]
    const enT = enSurfaces[s]
    if (!zhT || !enT) continue
    for (const [key, zhValue] of Object.entries(zhT)) {
      const enValue = enT[key]
      if (typeof enValue !== 'string') continue
      const pz = placeholders(zhValue)
      const pe = placeholders(enValue)
      const same = pz.size === pe.size && [...pz].every((p) => pe.has(p))
      if (!same)
        findings.push({
          kind: 'placeholders',
          detail: `${s}「${key}」占位符不一致：zh={${[...pz].join(',')}} en={${[...pe].join(',')}}`,
        })
    }
  }
}

function checkMeta(findings) {
  for (const lang of ['zh', 'en']) {
    const file = join(pkgRoot, 'locale', `${lang}.json`)
    if (!existsSync(file)) {
      findings.push({ kind: 'meta', detail: `locale/${lang}.json 缺失` })
      continue
    }
    let json
    try {
      json = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      findings.push({ kind: 'meta', detail: `locale/${lang}.json 不是合法 JSON：${error.message}` })
      continue
    }
    for (const field of ['title', 'description']) {
      const value = json?.meta?.[field]
      if (typeof value !== 'string' || value.trim() === '')
        findings.push({ kind: 'meta', detail: `locale/${lang}.json 的 meta.${field} 缺失或为空` })
    }
  }
}

// ---- 主流程 ----
const hardcoded = []
for (const file of hardcodedTargets()) hardcoded.push(...scanFile(file))

const tableFindings = []
const tables = await loadTables()
if (tables === null) tableFindings.push({ kind: 'tables-missing', detail: `未找到 src/locales/{zh,en}/*.ts（pkg=${relative(repoRoot, pkgRoot)}）` })
else checkTables(tables, tableFindings)
if (!fixtureDir || existsSync(join(pkgRoot, 'locale'))) checkMeta(tableFindings)

const ok = hardcoded.length === 0 && tableFindings.length === 0

if (wantJson) {
  console.log(
    JSON.stringify(
      {
        ok,
        pkg: relative(repoRoot, pkgRoot).replace(/\\/g, '/'),
        scannedFiles: hardcodedTargets().length,
        hardcoded,
        tables: tableFindings,
      },
      null,
      2,
    ),
  )
} else if (ok) {
  console.log(`[check-client-i18n] OK — ${hardcodedTargets().length} 个源文件无硬编码文案；表结构与展示元数据校验通过`)
} else {
  for (const hit of hardcoded) {
    console.error(`[check-client-i18n] ${hit.file}:${hit.line} 硬编码文案（${BAD_CHARS_DESC}）`)
    console.error(`                   ${hit.excerpt}`)
  }
  for (const hit of tableFindings) console.error(`[check-client-i18n] 表结构：${hit.detail}`)
  console.error(`[check-client-i18n] FAIL — ${hardcoded.length} 处硬编码 + ${tableFindings.length} 处表结构问题`)
  console.error('[check-client-i18n] 怎么改：文案搬进 packages/dsh-kimi-tide/src/locales/{zh,en}/<surface>.ts，渲染处用 useCopy()/copy()（src/client/locale.ts）；键命名 <surface>.<area>.<name>，占位符 {0}/{1}/{name}。规则见 docs/agents/terminology.md §4/§6。')
}
process.exit(ok ? 0 : 1)
