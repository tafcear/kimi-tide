#!/usr/bin/env node
/**
 * kimi-tide 路由视图预检 —— 用**真实配置**算出「设置页应该显示什么」。
 *
 * 为什么需要它：2.1.0 的 A/B 项把设置页改成「五档决策链 + 摘要说明 + 接入徽标」，
 * 这些内容全部来自纯函数 `buildRoutingView` / `describeRouting`。于是在实机验收
 * （需要重启宿主）之前，就能用同一份配置把预期结果算出来，做到：
 *   ① 预判 A-1/A-2/A-4 应该看到什么（验收时逐字对照）；
 *   ② 提前暴露校验错误与配置异常，避免把问题带进重启窗口；
 *   ③ 不依赖宿主、不写任何文件（只读）。
 *
 * 用法：
 *   node scripts/acceptance/routing-view-preview.mjs                       # 默认读本机 desktop profile
 *   node scripts/acceptance/routing-view-preview.mjs --profile <名字>      # 指定 profile（如 web）
 *   node scripts/acceptance/routing-view-preview.mjs --config <文件>       # 指定 cordis.patch.yml
 *   node scripts/acceptance/routing-view-preview.mjs --entry <条目 id>     # 默认 dsh-kimi-tide
 *   node scripts/acceptance/routing-view-preview.mjs --json               # 输出机器可读结果
 *
 * 参数纪律（2026-10-08 修）：未知参数一律报错退出（exit 2）；profile 名经 `$DSH_HOME`
 * （回落 `~/.dsh`）解析，不再硬编码某台机器的绝对路径。
 *
 * 退出码：0 = 校验通过；1 = 校验报错或配置缺失（便于当门禁用）。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { resolveConfigArgs } from './_config-args.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '../../packages/dsh-kimi-tide')

const require = createRequire(resolve(PKG, 'package.json'))
const YAML = require('yaml')

/** Windows 下动态 import 必须给 file:// URL，不能给裸盘符路径。 */
const load = (rel) => import(pathToFileURL(resolve(PKG, rel)).href)

const { coerceRouterConfigV6 } = await load('lib/migrate.js')
const { validateRouterConfig } = await load('lib/settings-schema.js')
const { buildRoutingView } = await load('lib/routing-view.js')

const { configPath, entryId, flags } = resolveConfigArgs(process.argv.slice(2), {
  usage: `用法：
  node scripts/acceptance/routing-view-preview.mjs [--profile <名字>] [--config <文件>] [--entry <条目 id>] [--json]`,
  flags: ['json'],
})

/** 从 cordis.patch.yml 里取指定条目的 config.router（insert/config 两种行形态都认）。 */
function readRouterConfig(text, id) {
  const doc = YAML.parse(text)
  const rows = Array.isArray(doc) ? doc : []
  for (const row of rows) {
    for (const candidate of [row, ...(Array.isArray(row?.insert) ? row.insert : [])]) {
      if (candidate?.id === id) {
        const config = candidate.config ?? {}
        if (config.router !== undefined) return { router: config.router, found: 'entry.config.router' }
        return { router: config, found: 'entry.config' }
      }
    }
  }
  return { router: null, found: null }
}

const raw = readFileSync(configPath, 'utf8')
const { router, found } = readRouterConfig(raw, entryId)
if (router === null) {
  console.error(`✗ 在 ${configPath} 里找不到条目 "${entryId}" 的路由配置（已识别行形态：${found ?? '无'}）`)
  process.exit(1)
}

const config = coerceRouterConfigV6(router, () => {})
const invalid = validateRouterConfig(config)
const view = buildRoutingView(config, {})

if (flags.json) {
  console.log(JSON.stringify({ configPath, entryId, invalid: invalid ?? null, view }, null, 2))
  process.exit(invalid === undefined ? 0 : 1)
}

const active = config.activePreset
const preset = active === null ? null : config.presets?.[active]
const wiringMark = { referenced: '被引用', 'claimed-by-flow': '被协作流认领', orphan: '⚠ 未接入' }

console.log(`配置来源：${configPath}（条目 ${entryId}）`)
console.log(`版本：${config.version ?? '（未声明）'} ｜ 激活预设：${active ?? '（路由已关闭）'}${preset ? `（${preset.name ?? active}）` : ''}`)
console.log(`校验：${invalid === undefined ? '✓ 通过' : `✗ ${invalid}`}`)
console.log('')
console.log('【A-1 摘要行（设置页顶部应逐字显示这一行）】')
console.log(`  ${view.summary}`)
console.log('')
console.log('【A-3 五档决策链】')
const tierMark = { ready: '已就绪', 'on-demand': '按需', off: '未启用' }
for (const tier of view.precedence) {
  console.log(`  ${tier.tier}. ${tier.title}  [${tierMark[tier.state] ?? tier.state}]`)
  if (tier.detail !== undefined && tier.detail !== '') console.log(`     ${tier.detail}`)
}
console.log('')
console.log('【默认目标档】')
console.log(`  ${view.fallback.target === null ? '（无默认目标）' : `${view.fallback.target.provider}/${view.fallback.target.model}`} ｜ ${view.fallback.reason}`)
console.log('')
console.log('【A-4 词表接入】')
for (const group of view.groups) {
  const by = group.referencedBy.length > 0 ? `（${group.referencedBy.join(', ')}）` : ''
  console.log(`  ${group.name}：${group.words} 词 ｜ ${wiringMark[group.wiring] ?? group.wiring}${by}`)
}
console.log('')
console.log(`【B-2 重叠】${view.overlaps.length === 0 ? '无' : ''}`)
for (const overlap of view.overlaps) {
  console.log(`  『${overlap.word}』：词表 ${overlap.group} ↔ 角色 ${overlap.roleId}（主会话 ${overlap.sessionTarget} vs 派发 ${overlap.dispatchTarget}）`)
}
console.log('')
console.log(`【派发面】session 行 ${view.session.length} 条 ｜ dispatch 行 ${view.dispatch.length} 条`)
for (const row of view.dispatch) {
  const target = row.target?.provider !== undefined ? `${row.target.provider}/${row.target.model}` : JSON.stringify(row.target)
  console.log(`  ${row.roleId ?? row.id} → ${target}${row.unavailable ? '（目标不可用）' : ''}`)
}

process.exit(invalid === undefined ? 0 : 1)
