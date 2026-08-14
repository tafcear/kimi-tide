// kimi-capabilities.mjs — Kimi 模型能力综合测试（走 DSH dsh-llm-pi-ai 同款 pi-ai 路径）
// 依赖本地 node_modules；凭据路径经 DSH_HOME / os.homedir() 解析。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import yaml from 'js-yaml'
import { createModels } from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'

const dshHome = process.env.DSH_HOME ?? join(os.homedir(), '.dsh')
const credPath = join(dshHome, '.credentials.yaml')

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
for (const p of builtinProviders().filter((p) => p.id === 'kimi-coding')) models.setProvider(p)

// ---- 8x8 红色 PNG（纯 Node 生成，无第三方依赖）----
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function makeRedPng() {
  const w = 8, h = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const o = y * (1 + w * 3) + 1 + x * 3;
      raw[o] = 255; raw[o + 1] = 0; raw[o + 2] = 0; // pure red
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png.toString('base64');
}

// ---- 单次流式调用：返回 { text, thinking, toolCalls, usage, stopReason, ms } ----
async function run(modelId, context, label) {
  const model = models.getModel('kimi-coding', modelId);
  const t0 = Date.now();
  const result = { text: '', thinking: '', toolCalls: [], usage: null, stopReason: null, ms: 0 };
  const stream = models.streamSimple(model, context, { apiKey, signal: AbortSignal.timeout(180000) });
  try {
    for await (const ev of stream) {
      if (ev.type === 'text_delta') result.text += ev.delta ?? '';
      if (ev.type === 'thinking_delta') result.thinking += ev.delta ?? '';
      // 保留真实 tool call id，闭环回传时保持一致
      if (ev.type === 'toolcall_end') result.toolCalls.push({ id: ev.toolCall.id, name: ev.toolCall.name, args: ev.toolCall.arguments });
      if (ev.type === 'done') { result.stopReason = ev.message?.stopReason ?? 'done'; result.usage = ev.message?.usage ?? null; }
      if (ev.type === 'error') { console.log(`  [${label}] STREAM ERROR:`, ev.error); return null; }
    }
  } catch (error) {
    console.error(`  [${label}] stream crashed:`, error?.message ?? error);
    return null;
  }
  result.ms = Date.now() - t0;
  return result;
}

function summarize(label, r, extra = '') {
  if (!r) return;
  const u = r.usage;
  const usageStr = u ? `in=${u.input} out=${u.output}${u.reasoning != null ? ` (reasoning=${u.reasoning})` : ''} cacheR=${u.cacheRead} cacheW=${u.cacheWrite}` : 'no usage';
  console.log(`  [${label}] stop=${r.stopReason} ${r.ms}ms usage: ${usageStr}`);
  if (extra) console.log(`    ${extra}`);
}

console.log('======== Kimi 能力测试（kimi-coding 订阅后端） ========\n');

// ---------- 模型 1: kimi-for-coding (K2.7 Code) ----------
console.log('--- kimi-for-coding (Kimi K2.7 Code) ---');

// A. 推理（thinking）+ 文本
console.log('[A] 推理测试: "9.9 vs 9.11 哪个大"');
const a = await run('kimi-for-coding', {
  systemPrompt: '先思考再回答，回答用中文，不超过50字。',
  messages: [{ role: 'user', content: '9.9 和 9.11 哪个更大？请先推理再给出结论。' }],
}, 'A');
summarize('A', a, `thinking_len=${a?.thinking.length} text="${a?.text.slice(0, 60)}"`);

// B. 代码生成
console.log('\n[B] 代码生成: Python 快速排序');
const b = await run('kimi-for-coding', {
  systemPrompt: '你是资深程序员，输出可直接运行的代码。',
  messages: [{ role: 'user', content: '用 Python 写一个快速排序函数，附带 3 行注释。' }],
}, 'B');
summarize('B', b, `code_len=${b?.text.length}`);

// C. 工具调用
console.log('\n[C] 工具调用: 查询天气');
const c = await run('kimi-for-coding', {
  systemPrompt: '你可以使用工具。需要天气信息时务必调用 get_weather 工具。',
  messages: [{ role: 'user', content: '北京今天天气怎么样？请调用工具查询。' }],
  tools: [{
    name: 'get_weather',
    description: '查询指定城市的当前天气',
    parameters: { type: 'object', properties: { city: { type: 'string', description: '城市名' } }, required: ['city'] },
  }],
}, 'C');
summarize('C', c, `toolCalls=${JSON.stringify(c?.toolCalls)}`);

// D. 工具调用闭环（把 C 的工具结果回传，模型应总结）
if (c && c.toolCalls.length > 0) {
  console.log('\n[D] 工具闭环: 回传工具结果');
  const tc = c.toolCalls[0];
  const d = await run('kimi-for-coding', {
    systemPrompt: '你可以使用工具。',
    messages: [
      { role: 'user', content: '北京今天天气怎么样？请调用工具查询。' },
      { role: 'assistant', content: [{ type: 'toolCall', id: tc.id ?? 'tc_1', name: tc.name, arguments: tc.args }], timestamp: Date.now() },
      { role: 'toolResult', toolCallId: tc.id ?? 'tc_1', toolName: tc.name, content: [{ type: 'text', text: '{"city":"北京","weather":"晴","temperature":32,"humidity":40}' }], isError: false, timestamp: Date.now() },
    ],
  }, 'D');
  summarize('D', d, `text="${d?.text.slice(0, 80)}"`);
}

// E. 多模态图片
console.log('\n[E] 多模态: 8x8 纯红色 PNG');
const e = await run('kimi-for-coding', {
  systemPrompt: '描述你看到的图片，回答用中文，不超过30字。',
  messages: [{ role: 'user', content: [{ type: 'text', text: '这张图片是什么颜色？' }, { type: 'image', data: makeRedPng(), mimeType: 'image/png' }] }],
}, 'E');
summarize('E', e, `text="${e?.text.slice(0, 80)}"`);

// ---------- 模型 2: k3（旗舰，1M 上下文） ----------
console.log('\n--- k3 (Kimi K3) ---');

const a3 = await run('k3', {
  systemPrompt: '先思考再回答，回答用中文，不超过50字。',
  messages: [{ role: 'user', content: '9.9 和 9.11 哪个更大？请先推理再给出结论。' }],
}, 'A3');
summarize('A3', a3, `thinking_len=${a3?.thinking.length} text="${a3?.text.slice(0, 60)}"`);

const c3 = await run('k3', {
  systemPrompt: '你可以使用工具。需要天气信息时务必调用 get_weather 工具。',
  messages: [{ role: 'user', content: '上海今天天气怎么样？请调用工具查询。' }],
  tools: [{
    name: 'get_weather',
    description: '查询指定城市的当前天气',
    parameters: { type: 'object', properties: { city: { type: 'string', description: '城市名' } }, required: ['city'] },
  }],
}, 'C3');
summarize('C3', c3, `toolCalls=${JSON.stringify(c3?.toolCalls)}`);

console.log('\n======== 测试完成 ========');
