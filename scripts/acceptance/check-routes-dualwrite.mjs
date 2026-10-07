#!/usr/bin/env node
/**
 * kimi-tide B-4 判据 —— 「routes 双写落盘」自动核查。
 *
 * 为什么需要它：v2.1.0 起 `routes` 是唯一真源，旧字段（`presets[*].rules` /
 * `roles`）是**镜像**。写通道必须在同一笔里让两边一致；一旦分叉，界面显示的
 * 与运行期实际走的就是两回事——这是本次改造里**唯一可能静默失败**的一条，
 * 靠肉眼比对 YAML 既慢又不可靠。
 *
 * 判据（不依赖投影实现的细节，只认语义等价）：
 *     routes  ≡  rowsFromLegacy(presets[*].rules ∪ roles)
 * 外加一次完整的 `validateRouterConfig`（它同时覆盖「空 routes × 非空旧字段」
 * 这类冲突）。两边任一不成立即 FAIL。
 *
 * 用法（仓库根执行）：
 *   node scripts/acceptance/check-routes-dualwrite.mjs              # 读本机 desktop profile
 *   node scripts/acceptance/check-routes-dualwrite.mjs --config <文件>
 *   node scripts/acceptance/check-routes-dualwrite.mjs --entry <条目 id>   # 默认 dsh-kimi-tide
 *   node scripts/acceptance/check-routes-dualwrite.mjs --json
 *
 * 退出码：0 = 两边一致且校验通过；1 = 不一致 / 校验失败；2 = 文件里还没有 routes
 *        （说明设置页尚未写过一次——先去改一个字段再重跑）。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '../../packages/dsh-kimi-tide')
const require = createRequire(resolve(PKG, 'package.json'))
const YAML = require('yaml')
const load = (rel) => import(pathToFileURL(resolve(PKG, rel)).href)

const { rowsFromLegacy } = await load('lib/config.js')
const { validateRouterConfig } = await load('lib/settings-schema.js')

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i += 1 }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const configPath = args.config ?? 'C:/Users/tafce/.dsh/profiles/desktop/cordis.patch.yml'
const entryId = args.entry ?? 'dsh-kimi-tide'

function readRouterConfig(text, id) {
  const doc = YAML.parse(text)
  const rows = Array.isArray(doc) ? doc : []
  for (const row of rows) {
    for (const candidate of [row, ...(Array.isArray(row?.insert) ? row.insert : [])]) {
      if (candidate?.id !== id) continue
      const config = candidate.config ?? {}
      return config.router !== undefined ? config.router : config
    }
  }
  return null
}

const router = readRouterConfig(readFileSync(configPath, 'utf8'), entryId)
if (router === null) {
  console.error(`✗ 在 ${configPath} 里找不到条目 "${entryId}" 的路由配置`)
  process.exit(1)
}

const invalid = validateRouterConfig(router)
const routes = Array.isArray(router.routes) ? router.routes : null
const legacyRows = rowsFromLegacy(router)

const counts = (rows) => ({
  total: rows.length,
  session: rows.filter((r) => r.scope === 'session').length,
  dispatch: rows.filter((r) => r.scope === 'dispatch').length,
})

if (args.json) {
  const equal = routes !== null && JSON.stringify(routes) === JSON.stringify(legacyRows)
  console.log(JSON.stringify({
    configPath,
    entryId,
    hasRoutes: routes !== null,
    routes: routes === null ? null : counts(routes),
    legacy: counts(legacyRows),
    consistent: equal,
    invalid: invalid ?? null,
  }, null, 2))
  process.exit(routes === null ? 2 : equal && invalid === undefined ? 0 : 1)
}

console.log(`配置来源：${configPath}（条目 ${entryId}）`)
console.log(`校验：${invalid === undefined ? '✓ 通过' : `✗ ${invalid}`}`)

if (routes === null) {
  console.log('')
  console.log('⏳ 文件里还没有 `routes` —— 说明设置页自本版以来尚未写过一次。')
  console.log('   请到「设置 → 月汐 → 路由」改任意一个字段（例如新增一个角色），再重跑本命令。')
  console.log('   若改完仍然没有 `routes`：说明写入没落到这个文件（B-4 不通过，见 runbook §0-4）。')
  process.exit(2)
}

const rc = counts(routes)
const lc = counts(legacyRows)
const equal = JSON.stringify(routes) === JSON.stringify(legacyRows)

console.log(`routes 行数：${rc.total}（session ${rc.session} / dispatch ${rc.dispatch}）`)
console.log(`旧字段推出的行数：${lc.total}（session ${lc.session} / dispatch ${lc.dispatch}）`)
console.log('')

if (!equal) {
  // 只报第一处分叉，避免刷屏；顺序即语义，所以按数组逐项比。
  const n = Math.max(routes.length, legacyRows.length)
  for (let i = 0; i < n; i += 1) {
    const a = JSON.stringify(routes[i] ?? null)
    const b = JSON.stringify(legacyRows[i] ?? null)
    if (a !== b) {
      console.log(`✗ B-4 FAIL —— 第 ${i + 1} 行两边不一致（真源 routes vs 镜像旧字段）：`)
      console.log(`    routes : ${a}`)
      console.log(`    旧字段 : ${b}`)
      break
    }
  }
  console.log('')
  console.log('   含义：界面显示的与运行期实际走的可能已经是两回事。请报告，不要忽略。')
  process.exit(1)
}

if (invalid !== undefined) {
  console.log(`✗ B-4 FAIL —— 两边行集一致，但配置未通过校验：${invalid}`)
  process.exit(1)
}

console.log('✓ B-4 PASS —— `routes` 与镜像旧字段语义逐行一致，且配置校验通过。')
console.log('   （这证明写通道的双写生效；运行期以 routes 为准，回退到旧版插件读旧字段同样正确。）')
process.exit(0)
