import { describe, expect, it } from 'vitest'
import { EFFORT_CATALOG_NAMESPACE, fetchCatalogMetaViaRemoteDescribe, fetchEffortsViaDescribe } from '../src/client/effort-remote.js'

// 2026-08-27 实机验收 B5 换道回归：档位表经 settings.describe 读
// kimi-tide-catalog 命名空间（原 typert $mount 手工贡献通道在真实 vendored
// kernel 静默挂起，已证伪弃用）。本文件钉死 describe 通道的取数契约。
// 1.4.1（2026-10-03 桌面端实机缺陷）：0.1.7+ 宿主已无 kimi-tide-catalog 命名
// 空间——档位表 / 挂载表是本条目 Config 的 volatile 字段（describe 视图里
// ns = entry id）。取数改为「本条目 ns 优先 → 旧 ns 回退」，两者都缺席时**抛错**
// 而不是返回空表（空表会覆盖 describe 主通道读到的真表 ⇒ 档位下拉全灰）。

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

  it('命中 kimi-tide-catalog 命名空间 → 返回 efforts 表（旧宿主回退）', async () => {
    const table = { 'kimi-coding/k3': ['low', 'high', 'max'] }
    const connection = okDescribe([
      { ns: 'kimi-tide-router', value: {} },
      { ns: EFFORT_CATALOG_NAMESPACE, value: { efforts: table } },
    ])
    await expect(fetchEffortsViaDescribe(connection as never)).resolves.toEqual({ efforts: table, mounted: [] })
  })

  it('1.4.1：本条目 ns（dsh-kimi-tide）优先于旧 kimi-tide-catalog', async () => {
    const entryTable = { 'zai-coding-cn/glm-5.3': ['low', 'high', 'max'] }
    const connection = okDescribe([
      { ns: EFFORT_CATALOG_NAMESPACE, value: { efforts: { 'stale/model': ['low'] } } },
      { ns: 'dsh-kimi-tide', value: { router: {}, efforts: entryTable, mounted: ['zai-coding-cn/glm-5.3'] } },
    ])
    await expect(fetchEffortsViaDescribe(connection as never)).resolves.toEqual({
      efforts: entryTable,
      mounted: ['zai-coding-cn/glm-5.3'],
    })
  })

  it('1.4.1：两个命名空间都缺席 → 抛错（不再伪造空表）', async () => {
    const connection = okDescribe([{ ns: 'kimi-tide-router', value: {} }])
    await expect(fetchEffortsViaDescribe(connection as never)).rejects.toThrow(/既无 dsh-kimi-tide 也无 kimi-tide-catalog/)
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

// 1.4.1：loopback typed remote 面（ctx.remote.settings.describe，rc.1 零参调用）
// ——故障现场就在这里：它只查旧 ns，查不到返回空表，把主通道的真表盖掉了。
describe('fetchCatalogMetaViaRemoteDescribe（1.4.1：本条目 ns 优先）', () => {
  it('裸 value 形态 + 本条目 ns → 返回真表', async () => {
    const table = { 'kimi-coding/k3': ['low', 'high', 'max'] }
    const describe = async () => ({
      namespaces: [{ ns: 'dsh-kimi-tide', value: { efforts: table, mounted: ['kimi-coding/k3'] } }],
    })
    await expect(fetchCatalogMetaViaRemoteDescribe(describe)).resolves.toEqual({
      efforts: table,
      mounted: ['kimi-coding/k3'],
    })
  })

  it('envelope 形态（{ok,value}）+ 旧 ns → 回退可用', async () => {
    const table = { 'kimi-coding/k3': ['high'] }
    const describe = async () => ({
      ok: true,
      value: { namespaces: [{ ns: EFFORT_CATALOG_NAMESPACE, value: { efforts: table } }] },
    })
    await expect(fetchCatalogMetaViaRemoteDescribe(describe)).resolves.toEqual({ efforts: table, mounted: [] })
  })

  it('视图里没有本插件任何 ns → 抛错（不返回空表去覆盖主通道）', async () => {
    const describe = async () => ({ namespaces: [{ ns: 'some-other-plugin', value: {} }] })
    await expect(fetchCatalogMetaViaRemoteDescribe(describe)).rejects.toThrow(/既无 dsh-kimi-tide 也无 kimi-tide-catalog/)
  })

  it('envelope ok:false → 抛错', async () => {
    const describe = async () => ({ ok: false, error: { message: 'boom' } })
    await expect(fetchCatalogMetaViaRemoteDescribe(describe)).rejects.toThrow(/describe 失败：boom/)
  })
})
