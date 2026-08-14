// e2e-kimi.mjs — 模拟 DSH dsh-llm-pi-ai 适配器路径，端到端调用 kimi-coding
// 依赖本地 node_modules（npm install 安装）；凭据与设置路径经 DSH_HOME /
// os.homedir() 解析，不再硬编码用户名与 npx 缓存哈希。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import { createModels } from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'

const dshHome = process.env.DSH_HOME ?? join(os.homedir(), '.dsh')
const credPath = join(dshHome, '.credentials.yaml')

// 读 KIMI_API_KEY（与 dsh credentials seam 相同来源）
let apiKey
try {
  const credText = readFileSync(credPath, 'utf8')
  const doc = yaml.load(credText)
  apiKey = typeof doc === 'object' && doc !== null ? doc.KIMI_API_KEY : undefined
} catch (error) {
  console.error(`cannot read ${credPath}: ${error?.message ?? error}`)
  process.exit(1)
}
if (typeof apiKey !== 'string' || apiKey.length === 0) {
  console.log('KIMI_API_KEY missing or empty')
  process.exit(1)
}

const models = createModels()
const provider = builtinProviders().find((p) => p.id === 'kimi-coding')
if (!provider) { console.log('kimi-coding provider not found in catalog'); process.exit(1) }
models.setProvider(provider)

const model = models.getModel('kimi-coding', 'kimi-for-coding')
if (!model) { console.log('model not found'); process.exit(1) }
console.log('model:', model.id, '| api:', model.api, '| baseUrl:', model.baseUrl)

const context = {
  systemPrompt: 'You are a helpful assistant. Reply in Chinese, keep it under 20 words.',
  messages: [{ role: 'user', content: '用一句话介绍你自己' }],
}

const stream = models.streamSimple(model, context, { apiKey, signal: AbortSignal.timeout(60000) })
let text = ''
let done = false
try {
  for await (const ev of stream) {
    if (ev.type === 'text_delta') text += ev.delta ?? ''
    if (ev.type === 'text_end') { /* text_delta 已累积完整文本 */ }
    if (ev.type === 'done') { done = true }
    if (ev.type === 'error') { console.log('STREAM ERROR:', ev.error); process.exit(1) }
  }
} catch (error) {
  console.error('stream crashed:', error?.message ?? error)
  process.exit(1)
}
console.log('stream ok, done =', done)
console.log('ASSISTANT:', text.slice(0, 300))
