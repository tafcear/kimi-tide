import { describe, expect, it } from 'vitest'
import { EFFORT_CATALOG_NAMESPACE, fetchEffortsViaDescribe } from '../src/client/effort-remote.js'

// 2026-08-27 实机验收 B5 换道回归：档位表经 settings.describe 读
// kimi-tide-catalog 命名空间（原 typert $mount 手工贡献通道在真实 vendored
// kernel 静默挂起，已证伪弃用）。本文件钉死 describe 通道的取数契约。

const okDescribe = (namespaces: ReadonlyArray<{ ns: string; value: unknown }>) => ({
  api: {
    settings: {
      async describe(_body: Record<string, never>) {
        return { result: { ok: true as const, value: { namespaces } } }
      },
    },
  },
})

describe('fetchEffortsViaDescribe（B5 换道：settings.describe 通道）', () => {
  it('connection 缺失 → 抛错（不静默兜底）', async () => {
    await expect(fetchEffortsViaDescribe(null)).rejects.toThrow(/connection 通道不可用/)
  })

  it('describe 失败（ok:false）→ 抛错', async () => {
    const connection = {
      api: {
        settings: {
          async describe(_body: Record<string, never>) {
            return { result: { ok: false as const, error: { message: 'boom' } } }
          },
        },
      },
    }
    await expect(fetchEffortsViaDescribe(connection as never)).rejects.toThrow(/describe 失败：boom/)
  })

  it('命中 kimi-tide-catalog 命名空间 → 返回 efforts 表', async () => {
    const table = { 'kimi-coding/k3': ['low', 'high', 'max'] }
    const connection = okDescribe([
      { ns: 'kimi-tide-router', value: {} },
      { ns: EFFORT_CATALOG_NAMESPACE, value: { efforts: table } },
    ])
    await expect(fetchEffortsViaDescribe(connection as never)).resolves.toEqual({ efforts: table, mounted: [] })
  })

  it('命名空间缺席 → 空表（degrade 语义，不抛）', async () => {
    const connection = okDescribe([{ ns: 'kimi-tide-router', value: {} }])
    await expect(fetchEffortsViaDescribe(connection as never)).resolves.toEqual({ efforts: {}, mounted: [] })
  })

  it('节内缺 efforts 字段 → 空表', async () => {
    const connection = okDescribe([{ ns: EFFORT_CATALOG_NAMESPACE, value: {} }])
    await expect(fetchEffortsViaDescribe(connection as never)).resolves.toEqual({ efforts: {}, mounted: [] })
  })

  it('A8（1.1.0）：节内 mounted 挂载表 → 原样返回（与 efforts 并列）', async () => {
    const connection = okDescribe([
      { ns: EFFORT_CATALOG_NAMESPACE, value: { efforts: {}, mounted: ['kimi-coding/k3'] } },
    ])
    await expect(fetchEffortsViaDescribe(connection as never)).resolves.toEqual({
      efforts: {},
      mounted: ['kimi-coding/k3'],
    })
  })

  it('命名空间常量钉桩为 kimi-tide-catalog', () => {
    expect(EFFORT_CATALOG_NAMESPACE).toBe('kimi-tide-catalog')
  })
})
