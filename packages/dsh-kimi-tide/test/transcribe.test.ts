// test/transcribe.test.ts
import { describe, expect, it, vi } from 'vitest'
import type { TranscribeFlow } from '../src/config.js'
import {
  DEFAULT_TRANSCRIBE_PROMPT,
  Transcriber,
  type ResolvedImage,
  type VisionCaller,
} from '../src/transcribe.js'

const flow = (overrides: Partial<TranscribeFlow> = {}): TranscribeFlow => ({
  type: 'transcribe',
  visionModel: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' },
  failurePolicy: 'latch-image',
  ...overrides,
})

/** ref 在本层 opaque——用对象身份断言「原样直传、不解包」。 */
const img = (id: string): ResolvedImage => ({ attachmentId: id, ref: { persistent: id } })

describe('Transcriber 成功路径与缓存', () => {
  it('成功转述：caller 收到 visionModel/默认提示词/含该图的数组，ref 按身份原样直传', async () => {
    const caller = vi.fn<VisionCaller>().mockResolvedValue('转述文字')
    const t = new Transcriber({ caller })
    const image = img('a1')
    const out = await t.text(flow(), image)
    expect(out).toBe('转述文字')
    expect(caller).toHaveBeenCalledTimes(1)
    const [target, prompt, images] = caller.mock.calls[0]
    expect(target).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' })
    expect(prompt).toBe(DEFAULT_TRANSCRIBE_PROMPT)
    expect(images).toHaveLength(1)
    expect(images[0]).toBe(image) // 身份相等：attachmentId/ref 均未被改写
  })

  it('同图二次调用命中缓存：caller 只跑一次，peek 仅命中成功缓存', async () => {
    const caller = vi.fn<VisionCaller>().mockResolvedValue('转述文字')
    const t = new Transcriber({ caller })
    const image = img('a1')
    expect(await t.text(flow(), image)).toBe('转述文字')
    expect(await t.text(flow(), image)).toBe('转述文字')
    expect(caller).toHaveBeenCalledTimes(1)
    expect(t.peek('a1')).toBe('转述文字')
    expect(t.peek('never-seen')).toBeUndefined()
  })
})

describe('Transcriber 失败不重打', () => {
  it('caller 抛错 → 返回 null 且记入失败集：同图不再重打，caller 仍一次', async () => {
    const logs: string[] = []
    const caller = vi.fn<VisionCaller>().mockRejectedValue(new Error('vision 超时'))
    const t = new Transcriber({ caller, log: (m) => logs.push(m) })
    const image = img('bad1')
    expect(await t.text(flow(), image)).toBeNull()
    expect(await t.text(flow(), image)).toBeNull()
    expect(caller).toHaveBeenCalledTimes(1)
    expect(t.peek('bad1')).toBeUndefined() // 失败不进入成功缓存
    expect(logs.length).toBeGreaterThan(0) // 失败可观测
  })

  it('一图失败不影响其他图', async () => {
    const caller = vi.fn<VisionCaller>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('好图转述')
    const t = new Transcriber({ caller })
    expect(await t.text(flow(), img('bad'))).toBeNull()
    expect(await t.text(flow(), img('good'))).toBe('好图转述')
    expect(caller).toHaveBeenCalledTimes(2)
  })

  it('空转述视同失败（评审修复 2026-08-23）：返回 null、进失败集、不进成功缓存', async () => {
    // 模型空响应（流正常结束但累计文本为空）若当成功缓存，投影会把图块
    // 替换成空字符串——文本模型拿到的上下文静默缺一块。空白即失败。
    const logs: string[] = []
    const caller = vi.fn<VisionCaller>().mockResolvedValue('')
    const t = new Transcriber({ caller, log: (m) => logs.push(m) })
    const image = img('empty1')
    expect(await t.text(flow(), image)).toBeNull()
    expect(await t.text(flow(), image)).toBeNull() // 失败集：不重打
    expect(caller).toHaveBeenCalledTimes(1)
    expect(t.peek('empty1')).toBeUndefined()
    expect(logs.length).toBeGreaterThan(0)
  })

  it('纯空白转述（仅空白字符）同样视同失败', async () => {
    const caller = vi.fn<VisionCaller>().mockResolvedValue('  \n\t ')
    const t = new Transcriber({ caller })
    expect(await t.text(flow(), img('blank1'))).toBeNull()
    expect(t.peek('blank1')).toBeUndefined()
  })
})

describe('Transcriber 中止信号透传（I-2）', () => {
  it('text() 把调用方中止信号原样透传给 caller（中止/超时视同失败由既有 catch + 失败集覆盖）', async () => {
    const caller = vi.fn<VisionCaller>().mockResolvedValue('x')
    const t = new Transcriber({ caller })
    const controller = new AbortController()
    await t.text(flow(), img('a1'), controller.signal)
    expect(caller.mock.calls[0][3]).toBe(controller.signal)
  })

  it('caller 因中止 reject → 返回 null 且记入失败集（与 throw 同语义，同图不重打）', async () => {
    const caller = vi.fn<VisionCaller>().mockRejectedValue(new Error('transcribe aborted (timeout)'))
    const t = new Transcriber({ caller })
    expect(await t.text(flow(), img('a1'), new AbortController().signal)).toBeNull()
    expect(await t.text(flow(), img('a1'))).toBeNull()
    expect(caller).toHaveBeenCalledTimes(1)
  })
})

describe('Transcriber 提示词', () => {
  it('flow.prompt 覆盖默认提示词', async () => {
    const caller = vi.fn<VisionCaller>().mockResolvedValue('x')
    const t = new Transcriber({ caller })
    await t.text(flow({ prompt: '自定义：只看报错行' }), img('a1'))
    expect(caller.mock.calls[0][1]).toBe('自定义：只看报错行')
  })

  it('DEFAULT_TRANSCRIBE_PROMPT 含 spec §5.5 全部语义要素', () => {
    // 1. 逐字保留全部文字（含堆栈帧/行号/高亮颜色语义）
    expect(DEFAULT_TRANSCRIBE_PROMPT).toMatch(/逐字/)
    expect(DEFAULT_TRANSCRIBE_PROMPT).toMatch(/堆栈|行号|高亮/)
    // 2. 结构关系
    expect(DEFAULT_TRANSCRIBE_PROMPT).toMatch(/结构|布局|连接/)
    // 3. 关键视觉细节
    expect(DEFAULT_TRANSCRIBE_PROMPT).toMatch(/视觉细节/)
    // 4. 用途声明：供看不到图的文本模型接力
    expect(DEFAULT_TRANSCRIBE_PROMPT).toMatch(/看不到图|无法看到图/)
    // 5. 不确定处标注
    expect(DEFAULT_TRANSCRIBE_PROMPT).toMatch(/不确定/)
  })
})

describe('Transcriber LRU 缓存', () => {
  it('超 cap 逐出最旧（插入序）', async () => {
    const caller = vi.fn<VisionCaller>().mockImplementation(async (_t, _p, images) => `text:${images[0].attachmentId}`)
    const t = new Transcriber({ caller, cacheCap: 2 })
    await t.text(flow(), img('a'))
    await t.text(flow(), img('b'))
    await t.text(flow(), img('c')) // 逐出 a
    expect(t.peek('a')).toBeUndefined()
    expect(t.peek('b')).toBe('text:b')
    expect(t.peek('c')).toBe('text:c')
    // 被逐出的图重打：caller 第 4 次
    expect(await t.text(flow(), img('a'))).toBe('text:a')
    expect(caller).toHaveBeenCalledTimes(4)
  })

  it('命中刷新热度：被访问的图不先逐出', async () => {
    const caller = vi.fn<VisionCaller>().mockImplementation(async (_t, _p, images) => `text:${images[0].attachmentId}`)
    const t = new Transcriber({ caller, cacheCap: 2 })
    await t.text(flow(), img('a'))
    await t.text(flow(), img('b'))
    await t.text(flow(), img('a')) // 刷新 a 热度（缓存命中）
    await t.text(flow(), img('c')) // 逐出 b 而非 a
    expect(t.peek('a')).toBe('text:a')
    expect(t.peek('b')).toBeUndefined()
    expect(t.peek('c')).toBe('text:c')
    expect(caller).toHaveBeenCalledTimes(3)
  })
})

describe('Transcriber 多图传递', () => {
  it('同轮多图逐张全传：每次调用 caller 各收到完整图块（identity 直传）', async () => {
    const seen: ResolvedImage[][] = []
    const caller: VisionCaller = async (_t, _p, images) => {
      seen.push([...images])
      return images.map((i) => i.attachmentId).join(',')
    }
    const t = new Transcriber({ caller })
    const i1 = img('m1')
    const i2 = img('m2')
    const i3 = img('m3')
    expect(await t.text(flow(), i1)).toBe('m1')
    expect(await t.text(flow(), i2)).toBe('m2')
    expect(await t.text(flow(), i3)).toBe('m3')
    // 三张图全部传到 caller，且每次都是原对象（attachmentId+ref 未改写）
    expect(seen.flat().map((i) => i.attachmentId)).toEqual(['m1', 'm2', 'm3'])
    expect(seen[0][0]).toBe(i1)
    expect(seen[1][0]).toBe(i2)
    expect(seen[2][0]).toBe(i3)
  })
})
