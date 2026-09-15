#!/usr/bin/env node
/**
 * Q6 离线验收：显式 `@` 已知 provider 门控（不依赖宿主，跑的是**构建产物**）。
 *
 * 治什么——`@` 在本 Harness 里同时是「工作区路径引用」语法（`@README.md`、
 * `node_modules/@deepseek-ai/...`）与路由指令语法。修之前任何含 `@` 的文本都被
 * 当成显式指令；当该 provider 不在候选池时 `decide` 返回 `keep` 并**整条跳过关键词
 * 规则链**（还连带跳过语义确认闸、关掉评审流武装），界面上完全看不出规则被跳过。
 *
 * 为什么能离线验——门控的判据是纯函数（`effectiveExplicitDirective(text, known)`），
 * 效果面是 `KimiRouter.decide()`（纯函数，注入 metas 即可）。所以「哪类文本算指令」
 * 与「未识别时落到哪」都能在进程外钉死，不必起宿主。
 *
 * 用法：node scripts/acceptance/q6-gating-check.mjs [--json]
 * 退出码：0 全过；1 有用例失败；2 取不到产物。
 */
import { KimiRouter } from '../../packages/dsh-kimi-tide/lib/router.js'
import { DEFAULT_CONFIG_V4 } from '../../packages/dsh-kimi-tide/lib/config.js'
import { effectiveExplicitDirective } from '../../packages/dsh-kimi-tide/lib/rules.js'

const asJson = process.argv.includes('--json')

/** 判据用例：[文本, 期望, 说明]。期望 null = 非指令（不短路规则链）。 */
const DIRECTIVE_CASES = [
  ['@README.md 的说明帮我重构这个函数', null, '工作区路径引用不是指令'],
  ['请读 node_modules/@deepseek-ai/dsh-session 的导出', null, 'scoped 包名不是指令'],
  ['npm i @scope/pkg@1.2.3 然后跑测试', null, 'npm 包名不是指令'],
  ['文件在 E:\\x\\@deepseek-ai\\dsh\\lib\\index.js', null, 'Windows 路径片段不是指令'],
  ['联系 user@example.com 拿资料', null, '邮箱不是指令（词法边界）'],
  ['@kimi 帮我看这段代码', { provider: 'kimi-coding' }, '@kimi 是真指令（内置别名）'],
  ['见 @deepseek-ai/x，另 @kimi 帮我看', { provider: 'kimi-coding' }, '取首个**已知**匹配：前面的包名不吞后面的真指令'],
  ['@qwen-token-plan-cn/qwen3.8-max 你好', { provider: 'qwen-token-plan-cn', model: 'qwen3.8-max' }, '@provider/model 精确寻址'],
  ['@anthropic 帮我看看', null, '未识别 provider 不是指令'],
  ['@zai-coding-cn 帮我看', { provider: 'zai-coding-cn' }, '已知 provider 仍是指令（候选可用性不参与该判定）'],
]

const KNOWN = new Set(['kimi-coding', 'deepseek-official', 'zai-coding-cn', 'qwen-token-plan-cn'])

/** decide 三态：[标签, 文本, 期望 kind, 期望目标（route 时）, 期望原因子串]。 */
const DECIDE_CASES = [
  ['未识别 provider 落打底（Q6 行为变更）', '@anthropic 帮我看看这段代码', 'route', 'deepseek-official/deepseek-v4-flash', '非本路由器已知 provider（已忽略）'],
  ['引用式 @路径 落打底', '@README.md 的说明帮我重构这个函数', 'route', 'deepseek-official/deepseek-v4-flash', '已忽略'],
  ['已知 provider 无可用候选 ⇒ keep（保 Q3）', '@qwen-token-plan-cn 帮我看看', 'keep', null, '无可用候选'],
  ['真指令且候选可用 ⇒ 精确寻址', '@zai-coding-cn 帮我看', 'route', 'zai-coding-cn/glm-5.3', '指令'],
]

let failures = 0
const results = { directive: [], decide: [] }

for (const [text, expected, note] of DIRECTIVE_CASES) {
  const got = effectiveExplicitDirective(text, KNOWN)
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  if (!ok) failures++
  results.directive.push({ text, note, expected, got, ok })
  if (!asJson) {
    console.log(`${ok ? '✅' : '❌'} ${note}`)
    if (!ok) console.log(`   文本：${text}\n   期望 ${JSON.stringify(expected)} · 实得 ${JSON.stringify(got)}`)
  }
}

const config = DEFAULT_CONFIG_V4()
config.activePreset = 'saving'
const router = new KimiRouter(config, [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], available: true },
  { provider: 'zai-coding-cn', model: 'glm-5.3', modalities: ['text'], available: true },
  { provider: 'qwen-token-plan-cn', model: 'qwen3.8-max', modalities: ['text'], available: false },
], { info: () => {} })

if (!asJson) console.log('')
for (const [label, text, wantKind, wantTarget, wantReason] of DECIDE_CASES) {
  const d = router.decide([{ role: 'user', content: [{ type: 'text', text }] }], 1, false)
  const target = d.kind === 'route' ? `${d.target.provider}/${d.target.model}` : null
  const ok = d.kind === wantKind && (wantTarget === null || target === wantTarget) && d.reason.includes(wantReason)
  if (!ok) failures++
  results.decide.push({ label, text, kind: d.kind, target, reason: d.reason, wantKind, wantTarget, ok })
  if (!asJson) {
    console.log(`${ok ? '✅' : '❌'} ${label}`)
    console.log(`   ${d.kind}${target === null ? '' : ' → ' + target}：${d.reason}`)
  }
}

if (asJson) console.log(JSON.stringify({ failures, results }, null, 2))
console.log(`\n结论：${failures === 0 ? `全部通过（判据 ${DIRECTIVE_CASES.length} 例 + decide 三态 ${DECIDE_CASES.length} 例）` : `${failures} 例失败`}`)
process.exit(failures === 0 ? 0 : 1)
