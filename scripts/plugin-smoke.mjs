// plugin-smoke.mjs — dsh-kimi-tide 插件冒烟测试：OAuth 刷新 + 适配器真实流式调用 + 工具调用
import { KimiAdapter } from '../packages/dsh-kimi-tide/lib/adapter.js'
import { KimiOAuthManager } from '../packages/dsh-kimi-tide/lib/oauth.js'

const logger = { warn: (m) => console.warn('[oauth]', m), error: (m) => console.error('[oauth]', m) }

async function runStream(adapter, options) {
  const text = []
  const reasoning = []
  const toolCalls = []
  const types = new Set()
  let finish = null
  let usage = null
  for await (const chunk of adapter.stream(options)) {
    types.add(chunk.type)
    if (chunk.type === 'text-delta') text.push(chunk.text)
    if (chunk.type === 'reasoning-delta') reasoning.push(chunk.text)
    if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
      toolCalls.push({ name: chunk.block.name, args: chunk.block.arguments })
    }
    if (chunk.type === 'usage') usage = chunk.usage
    if (chunk.type === 'finish') finish = chunk.reason
  }
  return { text: text.join(''), reasoning: reasoning.join(''), toolCalls, finish, usage, types: [...types] }
}

const oauth = new KimiOAuthManager(logger, { home: '' })
const refreshed = await oauth.refresh()
console.log('1) oauth refresh:', refreshed, '| access token len:', oauth.getAccessToken().length)
if (!refreshed) process.exit(1)

const adapter = new KimiAdapter(oauth, { providerName: 'kimi-tide' })

const models = await adapter.listModels('kimi-tide')
console.log('2) models:', models.map((m) => m.id).join(', '))

const meta = await adapter.resolveModel('kimi-tide', 'kimi-for-coding')
console.log('3) resolveModel:', meta.id, 'ctx=', meta.context?.contextWindow, 'efforts=', meta.reasoning?.efforts.map((e) => e.id).join('/'))

console.log('4) 文本流式调用...')
const r1 = await runStream(adapter, {
  provider: 'kimi-tide',
  model: 'kimi-for-coding',
  system: '回答用中文，不超过20字。',
  messages: [
    { role: 'user', content: [{ type: 'text', text: '用一句话介绍你自己' }], id: 'm1', source: { kind: 'user' } },
  ],
})
console.log('   finish:', JSON.stringify(r1.finish), '| usage:', JSON.stringify(r1.usage))
console.log('   reasoning len:', r1.reasoning.length, '| text:', r1.text.slice(0, 80))

console.log('5) 工具调用...')
const r2 = await runStream(adapter, {
  provider: 'kimi-tide',
  model: 'kimi-for-coding',
  system: '你可以使用工具。需要天气信息时务必调用 get_weather 工具。',
  messages: [
    { role: 'user', content: [{ type: 'text', text: '北京今天天气怎么样？请调用工具查询。' }], id: 'm1', source: { kind: 'user' } },
  ],
  tools: [{
    name: 'get_weather',
    description: '查询指定城市的当前天气',
    parameters: { type: 'object', properties: { city: { type: 'string', description: '城市名' } }, required: ['city'] },
  }],
})
console.log('   finish:', JSON.stringify(r2.finish), '| toolCalls:', JSON.stringify(r2.toolCalls))

const ok = r1.finish?.kind === 'stop' && r1.text.length > 0 && r2.toolCalls.length > 0
console.log(ok ? '\nSMOKE PASS' : '\nSMOKE FAIL')
process.exit(ok ? 0 : 1)
