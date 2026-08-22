# Spike 报告：S1 直调视觉 + S4c llm/stream 投影缝（2026-08-22）

> 执行：主会话动态 cordis 探针插件 `spike-1`（pkg-3 修正链 pkg-1→pkg-5）。**结论：双 PASS，P1 门禁通过。**

## S1：插件直调视觉模型 —— ✅ PASS

**链路实证**（全部在宿主 rc.2 活体完成）：

1. `ctx.get('attachments').saveImage({ data: Uint8Array, mediaType: 'image/png', name })` → 返回 `ImageAttachmentRef`（attachmentId/mediaType/bytes=长度/width/height）。探针用纯 JS 生成的 8×8 红 PNG（手写 CRC32+Adler32+stored deflate，无 Buffer/fs 依赖）。
2. `ctx.llm.stream({ provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', messages: [{ role:'user', content: [{type:'text',...},{type:'image', attachment: ref}] }] })` → 模型答 `red`（finish:stop）。

**对设计的简化**：`ImageBlock.attachment` 是**持久引用**（dsh-attachment types.d.ts:7-28），不是内联字节——
- 转述缓存键 = `attachmentId` 天然成立；
- pre-step 的 `resolveImages` 只需从消息图块**提取 ref**（无需 readImage 读字节）；VisionCaller 把 ref 直接塞进合成调用即可，字节解析由适配器完成。

**流协议实测**（chunk 直方图）：`block-start ×2 → reasoning-delta ×N → text-delta {index, text} → block-end ×2 → usage ×1 → finish {reason.kind}`。错误形态：`finish.reason.kind === 'error'` + `reason.failure.{code,message}`。

**成本注意**：vision-exp 默认开推理（8×8 红图也跑了 41-49 个 reasoning-delta）——生产 VisionCaller 应显式 `reasoningEffort`（若目录支持 off/low）抑制转述调用的推理开销；`usage` chunk 可取 token 计耗（S5 复核用）。

## S4c：llm/stream 瀑布消息替换 —— ✅ PASS

**实证**：拦截器把文本块里的探针标记改写后经 `ctx.llm.stream(改写后 options)` 短路重派——模型回复的是**改写后**的标记（`rewrites:1, guardHits:1`，恰好一次重入、无递归）。官方事件文档原话支持短路：「call next() to reach the resolved adapter's stream, **or yield your own chunks to short-circuit**」。

**生产范式**（探针实测形态）：

```ts
const inFlight = new Set<object>()
ctx.on('llm/stream', (options, next) => {
  if (inFlight.has(options)) return next()                    // 重入守卫
  // …仅当目标 text-only 且存在已转述图块时：
  const rewritten = substitute(options.messages)              // 新对象，绝不改原（loop 请求深冻结）
  if (rewritten === options.messages) return next()
  const opts2 = { ...options, messages: rewritten }
  inFlight.add(opts2)
  return ctx.llm.stream(opts2)                                // 短路自派
})
```

**约束实录**：
- cordis waterfall 的 `next()` **固定回放原始参数**（cordis lib/index.js:317-325）——`next(改后载荷)` 无效，短路自派是唯一通路。
- agent-loop 构造的请求到达拦截器时是**深冻结**（原地 mutation 抛错；事件文档明示「listeners read it, never rewrite it」）——替换必须构造新消息数组/新块对象。
- 拦截器对全部流量生效（含本会话自身）：匹配条件必须窄（text-only 目标 + 缓存命中），无命中零分配直放。

## 附：动态插件 Tool 注册三坑（pkg-1→pkg-5 修正链）

1. `parameters` 根节点必须开放（`additionalProperties:false` 被拒：implicit parameter root is open）
2. `output: { schema, render }` 为必填（render: `(args, value) => [{type:'text', text}]`）
3. output schema 的对象节点必须显式 `additionalProperties`（true/false 均需写明）

## 门禁结论

S1 ✅ + S4c ✅ → P1（Task 3-12）按原设计开工；S4b/S2/S3 不需要作为 P1 前置。探针插件已拆除（stop + undefine）。
