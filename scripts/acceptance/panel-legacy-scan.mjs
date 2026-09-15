#!/usr/bin/env node
/**
 * 离线验收：旧面板载荷容忍（交接单 2026-09-04 / 2026-09-10 待办 4 的投影层那一半）。
 *
 * 交接单把待办 4 记成「需重启宿主后 UI 实开」——但「老会话能不能投影出来」是**纯函数
 * 问题**（`panelSchema.parse`），不必开界面：把三个样例会话里**真实的**旧面板事件
 * 喂给发货中的 `lib/projection.js` 用的同一份 schema，全过即为该半闭环；
 * 剩下要眼睛的只有「评审卡渲染」那一半。
 *
 * 用法：node scripts/acceptance/panel-legacy-scan.mjs [--json]
 * 退出码：0 全部旧载荷可投影；1 有载荷被拒；2 读取/参数错误。
 */
import { readFileSync, existsSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
/** 交接单材料指针③ 的三个样例会话（v3 日志，09-10 修复产物）。
 *  `lost` = 09-14 `~\.dsh` 整目录删除事故的已确认损失（本次全盘扫描不复存在），
 *  按「记录在案」处理而不是判失败——把它当失败会掩盖真正要盯的那两个样例。 */
const SAMPLES = [
  ['session-4fb0f4d5-ac54-4b6f-b139-2a9cf6ee6cc0', 543, '--E-BaiduSyncdisk-Data--', false],
  ['session-6ca2f899-4b7a-4895-a17e-2b2049984c30', 363, '--E-BaiduSyncdisk-Data--', false],
  ['session-c01dab3c-09fa-4bdc-b7ad-870852b6e746', 616, '--E-BaiduSyncdisk-Data--', true],
]

function readEvents(file) {
  const buf = readFileSync(file)
  const starts = []
  let i = 0
  while ((i = buf.indexOf(MAGIC, i)) !== -1) { starts.push(i); i += 4 }
  let text = ''
  for (let k = 0; k < starts.length; k++) {
    try { text += zstdDecompressSync(buf.subarray(starts[k], k + 1 < starts.length ? starts[k + 1] : buf.length)).toString('utf8') } catch { /* 坏帧跳过 */ }
  }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    try { out.push(JSON.parse(line)) } catch { /* 坏行跳过 */ }
  }
  return out
}

/** 旧载荷识别口径（与交接单一致）：0.6.0 之前的字段集 = quota/local/router/reasoning/models。 */
function isLegacy(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false
  const keys = new Set(Object.keys(payload))
  const modern = ['kimi', 'configSource', 'candidates', 'decision']
  if (modern.every((k) => keys.has(k))) return false
  return ['quota', 'router', 'reasoning'].some((k) => keys.has(k))
}

const asJson = process.argv.includes('--json')
const home = process.env.DSH_HOME ?? `${process.env.USERPROFILE}\\.dsh`
const sessionsRoot = `${home}\\sessions`

// 发货中的 schema：直接 import 插件产物，确保验的是**运行的同一份**实现。
const mod = await import(new URL('../../packages/dsh-kimi-tide/lib/projection.js', import.meta.url))
const schema = mod.kimiTideProjectionDefinition?.stateSchema
if (schema === undefined) {
  console.error('取不到 kimiTideProjectionDefinition.stateSchema——产物形状变了，先读 lib/projection.d.ts')
  process.exit(2)
}

const rows = []
for (const [id, expectedEvents, workspace, lost] of SAMPLES) {
  const file = `${sessionsRoot}\\${workspace}\\${id}\\session.v3.jsonl.zstd`
  if (!existsSync(file)) { rows.push({ id, missing: true, lost, file }); continue }
  const events = readEvents(file)
  const panels = events.filter((e) => e.type === 'kimi-tide/panel')
  const legacy = panels.filter((e) => isLegacy(e.data))
  const bad = []
  for (const e of legacy) {
    const parsed = schema.safeParse(e.data)
    if (!parsed.success) {
      bad.push({ seq: e.seq, issues: parsed.error.issues.map((x) => `${x.path.join('.') || '(root)'}: ${x.message}`).slice(0, 6) })
    }
  }
  rows.push({
    id,
    lost,
    file,
    events: events.length,
    expectedEvents,
    panels: panels.length,
    legacy: legacy.length,
    modern: panels.length - legacy.length,
    rejected: bad.length,
    bad: bad.slice(0, 3),
    reviewEvents: events.filter((e) => e.type === 'kimi-tide/review').length,
  })
}

if (asJson) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  for (const r of rows) {
    if (r.missing) {
      console.log(r.lost
        ? `⚠️  ${r.id}：已确认丢失（09-14 ~\\.dsh 整目录删除事故；本次全盘扫描不复存在）——记录在案，不计失败`
        : `✗ ${r.id}：文件不在（${r.file}）`)
      continue
    }
    const tag = r.rejected === 0 ? '✅' : '❌'
    console.log(`${tag} ${r.id}`)
    console.log(`   事件 ${r.events} · 面板事件 ${r.panels}（旧载荷 ${r.legacy} / 现代载荷 ${r.modern}）· 评审事件 ${r.reviewEvents}`)
    console.log(`   旧载荷投影：${r.legacy - r.rejected}/${r.legacy} 通过${r.rejected > 0 ? `（被拒 ${r.rejected}）` : ''}`)
    for (const b of r.bad) console.log(`      seq ${b.seq} → ${b.issues.join(' | ')}`)
  }
}

const failed = rows.filter((r) => (r.missing && !r.lost) || (r.rejected ?? 0) > 0)
const checked = rows.filter((r) => !r.missing)
const legacyTotal = checked.reduce((n, r) => n + r.legacy, 0)
console.log(`\n结论：${failed.length === 0
  ? `抽查 ${checked.length} 个样例、${legacyTotal} 条旧载荷全部可投影 ⇒ 投影层那半闭环（剩「评审卡渲染」需眼睛）`
  : `${failed.length} 个样例有问题`}`)
process.exit(failed.length === 0 ? 0 : 1)
