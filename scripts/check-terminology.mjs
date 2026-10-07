#!/usr/bin/env node
// 术语与语域门禁（规则本体：docs/agents/terminology.md §4）。
//
// 为什么有这条闸：2026-10-07 发现一类真实缺陷——agent 随手写的口语措辞会沿着
// 「设计稿 → 派发实施 → 独立复核 → 测试断言 → 四处文档面」变成"协议"，而链路上
// 没有任何一环审"这句话像不像产品文案"。复核审的是"落地没落地"，测试锁的是字面。
// 于是「打底」「什么时候轮到它」「关掉它会怎样」「接线/悬空」进了交付面。
//
// 这条闸只做一件事：**受扫面里不许出现禁用词**。它管不了"像不像产品"（那一半靠
// 语体样例与复核任务书里那一条），但能挡住"旧词回流"。
//
// 受扫面（**刻意是显式清单**，历史档案不在其中——改了历史就是篡改记录）：
//   packages/dsh-kimi-tide/src/**（用户可见文案与注释，含 src/locales/** 分表）
//   packages/dsh-kimi-tide/locale/zh.json、locale/en.json（Plugin Manager 展示元数据）
//   根 README.md / README.en.md、包 README.md
//   packages/dsh-kimi-tide/docs/router.md、docs/routing-ia-acceptance.md
//   CHANGELOG.md、当前版本 release-notes-v<package.json version>.md
//
// 用法：node scripts/check-terminology.mjs [--json]
// 退出码：0 通过；1 命中禁用词（打印 文件:行号 与替换建议）。

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'packages', 'dsh-kimi-tide', 'package.json'), 'utf8'))

/** 禁用词 → 建议改法（规则本体 §1/§2）。 */
const BANNED = [
  { word: '打底', hint: '改称「默认目标」（配置字段名仍为「默认模型」）' },
  { word: '轮到它', hint: '标签改「触发条件」' },
  { word: '说人话', hint: '语域：说明用陈述句，不用口语' },
  { word: '打架', hint: '语域：不用比喻' },
  { word: '一贴', hint: '语域：不用口语' },
  { word: '接线', hint: '改「接入」' },
  { word: '悬空', hint: '改「未接入」' },
  { word: '挂空', hint: '改「未接入」' },
]

/**
 * 英文侧：`baseline` 不得再指代「默认目标」。它有合法用法（CSS `align-items`、
 * DOM 锚点 `baseline-chip`、实验对照"no baseline against the strong model"），
 * 故**只扫英文文档、且逐行白名单**——例外必须显式写在这里（prose linter 的常规做法）。
 */
const BANNED_EN = [{ word: 'baseline', hint: '指代默认目标时改 `default target`' }]
const EN_ALLOW = ['no baseline against']

/** 受扫面：显式清单（相对仓库根）。 */
function scanTargets() {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(name)) files.push(full)
    }
  }
  walk(join(root, 'packages', 'dsh-kimi-tide', 'src'))
  for (const rel of [
    'packages/dsh-kimi-tide/locale/zh.json',
    'packages/dsh-kimi-tide/locale/en.json',
    'README.md',
    'README.en.md',
    'packages/dsh-kimi-tide/README.md',
    'packages/dsh-kimi-tide/docs/router.md',
    'packages/dsh-kimi-tide/docs/routing-ia-acceptance.md',
    'CHANGELOG.md',
    `release-notes-v${pkg.version}.md`,
  ]) {
    const full = join(root, rel)
    try {
      if (statSync(full).isFile()) files.push(full)
    } catch {
      // 当前版本还没有发布说明（未发版草稿阶段）：跳过，不算失败
    }
  }
  return files
}

const findings = []
for (const file of scanTargets()) {
  const rel = relative(root, file).replace(/\\/g, '/')
  const isEnglishDoc = rel.endsWith('.en.md')
  const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
  lines.forEach((line, index) => {
    // 表里的禁用词（locale 分表 / 展示元数据）：提示语指向词表本体，避免只改字符串不改词
    const inTable =
      /^packages\/dsh-kimi-tide\/src\/locales\//.test(rel) || /^packages\/dsh-kimi-tide\/locale\/(zh|en)\.json$/.test(rel)
    const tableHint = inTable ? '；表里禁用词：改词表 docs/agents/terminology.md §1 与 src/locales/**' : ''
    const zhHit = BANNED.find((entry) => line.includes(entry.word))
    if (zhHit) findings.push({ file: rel, line: index + 1, word: zhHit.word, hint: zhHit.hint + tableHint, text: line.trim() })
    if (isEnglishDoc && !EN_ALLOW.some((allow) => line.includes(allow))) {
      const enHit = BANNED_EN.find((entry) => new RegExp(`\\b${entry.word}\\b`).test(line))
      if (enHit) findings.push({ file: rel, line: index + 1, word: enHit.word, hint: enHit.hint + tableHint, text: line.trim() })
    }
  })
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ scanned: scanTargets().length, findings }, null, 2))
} else if (findings.length === 0) {
  console.log(`[check-terminology] OK — ${scanTargets().length} 个受扫文件无禁用词（规则：docs/agents/terminology.md）`)
} else {
  for (const hit of findings) {
    console.error(`[check-terminology] ${hit.file}:${hit.line} 命中「${hit.word}」→ ${hit.hint}`)
    console.error(`                   ${hit.text.slice(0, 120)}`)
  }
  console.error(`[check-terminology] FAIL — ${findings.length} 处禁用词；规则与词表见 docs/agents/terminology.md`)
}
process.exit(findings.length === 0 ? 0 : 1)
