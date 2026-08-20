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
