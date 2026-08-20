// test/card-store.test.ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_V4 } from '../src/config.js'
import { createCardStore, type SettingsScopeLike } from '../src/client/card-store.js'

const makeScope = (initial: unknown): SettingsScopeLike & { writes: Array<[string, unknown]> } => {
  let value = initial
  const writes: Array<[string, unknown]> = []
  const listeners = new Set<() => void>()
  return {
    writes,
    getSnapshot: () => ({ status: 'ready', value, base: value, user: {}, writable: true }),
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) },
    set: async (f, v) => { writes.push([f, v]); value = { ...(value as object), [f]: v }; for (const l of listeners) l() },
    unset: async (f) => { writes.push([f, undefined]); const { [f]: _, ...rest } = value as Record<string, unknown>; value = rest; for (const l of listeners) l() },
  }
}

describe('card-store v4', () => {
  it('saveActivePreset 写 activePreset（null=关闭）', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V4())
    const store = createCardStore(scope, null)
    await store.saveActivePreset('saving')
    expect(scope.writes).toEqual([['activePreset', 'saving']])
    await store.saveActivePreset(null)
    expect(scope.writes[1]).toEqual(['activePreset', null])
  })
  it('savePreset 整段覆盖单个预设（rules 数组整体替换）', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V4())
    const store = createCardStore(scope, null)
    const edited = { ...DEFAULT_CONFIG_V4().presets.saving, rules: [] }
    await store.savePreset('saving', edited)
    const [field, value] = scope.writes[0]
    expect(field).toBe('presets')
    expect((value as Record<string, { rules: unknown[] }>).saving.rules).toEqual([])
    expect((value as Record<string, { name: string }>).capability.name).toBe('能力')  // 其他预设不动
  })
  it('deletePreset 删除激活预设时同写 activePreset null（一次写入两个字段）', async () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    const scope = makeScope(c)
    const store = createCardStore(scope, null)
    await store.deletePreset('saving')
    const presetWrite = scope.writes.find(([f]) => f === 'presets')
    const activeWrite = scope.writes.find(([f]) => f === 'activePreset')
    expect(presetWrite).toBeDefined()
    expect((presetWrite![1] as Record<string, unknown>).saving).toBeUndefined()
    expect(activeWrite).toEqual(['activePreset', null])
  })
  it('createPreset id 冲突 → error 通道，不写', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V4())
    const store = createCardStore(scope, null)
    await store.createPreset('saving', DEFAULT_CONFIG_V4().presets.saving)
    expect(scope.writes).toEqual([])
    expect(store.getSnapshot().error).toContain('saving')
  })
  it('catalog：connection.llm.models 全量目录入快照；availability=目录命中', async () => {
    const connection = { api: {
      settings: { describe: async () => ({ result: { ok: true as const, value: { writable: true, namespaces: [{ ns: 'kimi-tide-router', value: DEFAULT_CONFIG_V4(), revision: 1 }] } } }), mutate: async () => ({}) },
      llm: { models: async () => ({ result: { ok: true as const, value: { groups: [
        { id: 'kimi-coding', models: [{ id: 'k3' }, { id: 'kimi-for-coding-highspeed' }] },
        { id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] },
      ] } } }) },
    } }
    const store = createCardStore(null, connection as never)
    await store.load()
    const snap = store.getSnapshot()
    expect(snap.catalog?.find((g) => g.provider === 'kimi-coding')?.models).toContain('k3')
    expect(snap.availability?.['kimi-coding/k3']).toBe(true)
    expect(snap.availability?.['kimi-coding/kimi-for-coding']).toBe(false)  // 未挂载 → 标灰
  })
})
