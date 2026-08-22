import { describe, expect, it } from 'vitest'
import Schema from 'schemastery'

describe('schemastery 未知键行为探测（spec 待核实 1）', () => {
  it('Schema.object 对 schema 外未知键：记录实际行为（透传）', () => {
    const s = Schema.object({ a: Schema.string() })
    // 实测（2026-08-21）：schemastery Schema.object 对 schema 外未知键
    // 既不「剥离」（非 { a:'x' }）也不「拒绝」（不抛错），而是原样透传保留。
    // T5 推论：兼容层 schema 只需列出 version/mode/default；其余 v3 遗留
    // 字段（scores/classify/candidates/costTiers/预算参数等）会被透传并
    // 由 migrateV3 忽略，无需逐字段列入 schema（规划上等同「剥离」分支）。
    expect(s({ a: 'x', b: 1 } as never)).toEqual({ a: 'x', b: 1 })
  })
})

describe('schemastery v5 兼容层行为钉桩（Task 5，2026-08-22 实测）', () => {
  it('dict 字段无 default：缺失即注入 {}（flows 注册表的默认值靠 mergeResolved deepMerge 供给）', () => {
    const s = Schema.object({ flows: Schema.dict(Schema.object({ type: Schema.string() })) })
    // 实测：dict 构造即带隐式 meta.default={}，缺失键注入 {} 而非省略。
    expect(s({} as never)).toEqual({ flows: {} })
  })
  it('union 标量无 default：缺失省略、存在即校验（imageFallback/imageFallbackFlow 因此不带 default）', () => {
    const s = Schema.object({
      imageFallback: Schema.union([Schema.const('latch'), Schema.const('blind'), Schema.const('transcribe-lazy')]),
      imageFallbackFlow: Schema.string(),
    })
    // 实测：无 default 的 union/标量缺失键不出现在输出；非法值直接抛 ValidationError。
    expect(s({} as never)).toEqual({})
    expect(s({ imageFallback: 'latch' } as never)).toEqual({ imageFallback: 'latch' })
    expect(() => s({ imageFallback: 'bogus' } as never)).toThrow(/imageFallback/)
  })
  it('version union 收 2/3/4/5：各 const 原样保留，缺省落 5，表外值拒绝', () => {
    const s = Schema.object({
      version: Schema.union([Schema.const(2), Schema.const(3), Schema.const(4), Schema.const(5)]).default(5),
    })
    expect(s({} as never)).toEqual({ version: 5 })
    for (const v of [2, 3, 4, 5]) expect(s({ version: v } as never)).toEqual({ version: v })
    expect(() => s({ version: 6 } as never)).toThrow(/version/)
  })
})
