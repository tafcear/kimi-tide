#!/usr/bin/env node
/**
 * 语义闸判官离线探针（v1.3.0 A7 根因取证，第 2 步）。
 *
 * 为什么需要它：判官在**真实宿主进程内**调用，判词只写 stdout（拿不到），
 * 而「(a) 1.2s 超时不足」与「(b) 判词不可解析」在会话日志里只剩一个耗时差异的
 * 间接信号。本探针把**判官那一发请求**原样复现到进程外：
 *
 *   buildConfirmInput()（lib 里的真实实现，不是重写）
 *     + 与宿主同样的 maxTokens（缺省 64）
 *     + 同样的 /chat/completions 参数（不传 reasoning_effort、不传 thinking）
 *     + 同样的 1200ms 有界超时判定
 *
 * ⇒ 三件事一次问清：真实耗时是多少、64 token 够不够、模型到底吐了什么形状。
 *
 * 用法：
 *   node scripts/acceptance/judge-probe.mjs                       # 用默认探针句
 *   node scripts/acceptance/judge-probe.mjs --text "……"            # 换句子
 *   node scripts/acceptance/judge-probe.mjs --max-tokens 256       # 试预算
 *   node scripts/acceptance/judge-probe.mjs --effort off           # 试 pin 档位
 *   node scripts/acceptance/judge-probe.mjs --runs 3 --json
 *
 * 退出码：0 探针跑完（无论判词是否可解析）；2 参数/凭据/网络错误。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildConfirmInput, parseConfirmVerdict, clipRawSample } from '../../packages/dsh-kimi-tide/lib/hit-confirm.js'

const DEFAULTS = {
  text: '请只回复 OK，不要调用任何工具。我昨天说的那个重构早就写完了，今天想聊点别的。',
  candidates: [{ ruleId: 'code-kfc', group: 'code', targetKey: 'zai-coding-cn/glm-5.3' }],
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  maxTokens: 64,
  timeoutMs: 1200,
  runs: 1,
  effort: null,
  thinking: null,
}

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(name)
  return i === -1 ? dflt : argv[i + 1]
}
const asJson = argv.includes('--json')
const opt = {
  ...DEFAULTS,
  text: arg('--text', DEFAULTS.text),
  model: arg('--model', DEFAULTS.model),
  maxTokens: Number(arg('--max-tokens', String(DEFAULTS.maxTokens))),
  timeoutMs: Number(arg('--timeout-ms', String(DEFAULTS.timeoutMs))),
  runs: Number(arg('--runs', String(DEFAULTS.runs))),
  effort: arg('--effort', null),
  // 宿主的 `reasoningEffort: 'off'` 经 dsh-llm-deepseek 的 resolveThinking 映射为
  // 线缆上的 `thinking: {type:'disabled'}`（**不是** reasoning_effort —— 直传
  // `reasoning_effort: 'off'` 会被 DeepSeek 以 400 拒绝，实测）。
  thinking: arg('--thinking', null),
}
if ([opt.maxTokens, opt.timeoutMs, opt.runs].some((n) => Number.isNaN(n))) {
  console.error('--max-tokens / --timeout-ms / --runs 需要数字')
  process.exit(2)
}

/** 凭据解析：环境变量优先，其次 ~/.dsh/.credentials.yaml 的 refs 段（形如 NAME: <id>.<secret>）。 */
function apiKey() {
  const fromEnv = process.env.DEEPSEEK_API_KEY
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  const file = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.credentials.yaml')
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    console.error(`读不到凭据文件：${file}，且环境变量 DEEPSEEK_API_KEY 为空`)
    process.exit(2)
  }
  const m = text.match(/^\s*DEEPSEEK_API_KEY:\s*(\S+)\s*$/m)
  if (m === null) {
    console.error(`凭据文件里没有 DEEPSEEK_API_KEY：${file}`)
    process.exit(2)
  }
  return m[1]
}

const key = apiKey()
const input = buildConfirmInput(opt.text, opt.candidates)
const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? opt.baseUrl).replace(/\/+$/, '')

if (!asJson) {
  console.log(`判官输入（${input.length} 字符）：`)
  console.log(input.split('\n').map((l) => `  │ ${l}`).join('\n'))
  console.log(`\n目标 ${opt.model} · max_tokens=${opt.maxTokens} · 有界超时=${opt.timeoutMs}ms` +
    `${opt.effort === null ? '' : ` · reasoning_effort=${opt.effort}`}` +
    `${opt.thinking === null ? ' · 不传 thinking（= 宿主现状）' : ` · thinking={type:${opt.thinking}}`}`)
  console.log(`baseURL ${baseUrl}\n`)
}

/** 单次调用：返回原始响应字段 + 解析结果 + 耗时。 */
async function runOnce(index) {
  const body = {
    model: opt.model,
    messages: [{ role: 'user', content: input }],
    max_tokens: opt.maxTokens,
    stream: false,
  }
  if (opt.effort !== null) body.reasoning_effort = opt.effort
  if (opt.thinking !== null) body.thinking = { type: opt.thinking }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  const started = Date.now()
  let res
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    return { index, transportError: String(error?.message ?? error) }
  }
  const text = await res.text()
  const durationMs = Date.now() - started
  clearTimeout(timer)
  if (!res.ok) return { index, status: res.status, durationMs, body: text.slice(0, 600) }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return { index, status: res.status, durationMs, body: text.slice(0, 600), parseError: true }
  }
  const choice = json.choices?.[0] ?? {}
  const content = choice.message?.content ?? ''
  const reasoning = choice.message?.reasoning_content ?? ''
  const verdict = parseConfirmVerdict(content, opt.candidates)
  const usage = json.usage ?? {}
  const finishReason = choice.finish_reason ?? null
  return {
    index,
    status: res.status,
    durationMs,
    exceedsBoundedTimeout: durationMs > opt.timeoutMs,
    finishReason,
    usage: {
      prompt: usage.prompt_tokens ?? null,
      completion: usage.completion_tokens ?? null,
      reasoning: usage.completion_tokens_details?.reasoning_tokens ?? null,
    },
    reasoningChars: typeof reasoning === 'string' ? reasoning.length : 0,
    contentChars: content.length,
    content,
    clipped: clipRawSample(content),
    parsed: verdict === null ? null : { verdict: verdict.verdict, ruleId: verdict.ruleId, why: verdict.why },
  }
}

const results = []
for (let i = 1; i <= opt.runs; i++) results.push(await runOnce(i))

if (asJson) {
  console.log(JSON.stringify({ input, opt: { ...opt, key: undefined }, results }, null, 2))
} else {
  for (const r of results) {
    console.log(`── 第 ${r.index} 次`)
    if (r.transportError !== undefined) { console.log(`   传输错误：${r.transportError}`); continue }
    if (r.status !== 200) { console.log(`   HTTP ${r.status}：${r.body}`); continue }
    console.log(`   耗时 ${r.durationMs}ms${r.exceedsBoundedTimeout ? `  ⚠️ 超过有界超时 ${opt.timeoutMs}ms ⇒ 宿主侧判 (a) 超时` : `  ✓ 在 ${opt.timeoutMs}ms 预算内`}`)
    console.log(`   finish_reason=${r.finishReason} · completion=${r.usage.completion}（reasoning=${r.usage.reasoning}）· 正文 ${r.contentChars} 字符 / 思考 ${r.reasoningChars} 字符`)
    console.log(`   判词原文「${r.clipped}」`)
    console.log(`   解析结果：${r.parsed === null ? '❌ 不可解析（⇒ 宿主侧判 (b) 解析失败）' : `✅ ${JSON.stringify(r.parsed)}`}`)
  }
}
process.exit(0)
