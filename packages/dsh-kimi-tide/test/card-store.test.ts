// test/card-store.test.ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, type RouterConfigV5 } from '../src/config.js'
import { createCardStore, type SettingsScopeLike } from '../src/client/card-store.js'
import { validateRouterConfig } from '../src/settings-schema.js'

// 宿主 dsh-settings 行为模拟（C1 终审）：set 落值前先跑 validateRouterConfig，
// 校验拒绝则不改值（不抛错、静默 recover）——validate-on-write。
const makeScope = (initial: unknown): SettingsScopeLike & { writes: Array<[string, unknown]> } => {
  let value = initial
  const writes: Array<[string, unknown]> = []
  const listeners = new Set<() => void>()
  return {
    writes,
    getSnapshot: () => ({ status: 'ready', value, base: value, user: {}, writable: true }),
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) },
    set: async (f, v) => {
      writes.push([f, v])
      const candidate = { ...(value as object), [f]: v }
      if (validateRouterConfig(candidate as RouterConfigV5) !== undefined) return  // 宿主：校验拒绝，不落值
      value = candidate
      for (const l of listeners) l()
    },
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
  it('deletePreset 删除激活预设：先写 activePreset null 再删预设（两次顺序写入）', async () => {
    // Fails if: deletePreset 回到「先删 presets 再清 activePreset」——宿主
    // validate-on-write 会拒绝首笔（activePreset 指向已删预设），预设没删、
    // 路由被静默关闭。判别点 = writes 首笔必须是 ['activePreset', null]。
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    const scope = makeScope(c)
    const store = createCardStore(scope, null)
    await store.deletePreset('saving')
    expect(scope.writes[0]).toEqual(['activePreset', null])
    // 最终态：presets 无该 id 且 activePreset null（两笔写入都被宿主接受）
    const snap = store.getSnapshot()
    expect(snap.config?.activePreset).toBeNull()
    expect(snap.config?.presets.saving).toBeUndefined()
    expect(snap.config?.presets.capability).toBeDefined()  // 其他预设不动
    expect(snap.error).toBeNull()
  })
  it('校验拒绝（宿主 validate-on-write 静默 recover）→ error 通道', async () => {
    // Fails if: saveTop scope 路径不再在 load 后对比「意图值 vs 实际值」——
    // 宿主拒写（不落值、不抛错）时错误无声消失。
    // Task 5：validate 语义校验仅对 v5 生效（v4 及以下直通），夹具抬为 v5。
    const scope = makeScope(DEFAULT_CONFIG_V5())
    const store = createCardStore(scope, null)
    await store.saveActivePreset('nonexistent')  // activePreset 不在 presets → 宿主拒写
    expect(store.getSnapshot().error).toContain('写入被拒绝')
    expect(store.getSnapshot().config?.activePreset).toBeNull()  // 值未被污染
  })
  it('connection mutate 返回 ok:false → error 通道（不静默）', async () => {
    // Fails if: saveTop connection 路径不再拆箱 mutate 的 result——宿主校验
    // 拒绝经 result.error 返回（不抛），不检查则错误无声消失。
    const connection = { api: {
      settings: {
        describe: async () => ({ result: { ok: true as const, value: { writable: true, namespaces: [{ ns: 'kimi-tide-router', value: DEFAULT_CONFIG_V4(), revision: 1 }] } } }),
        mutate: async () => ({ result: { ok: false as const, error: { message: 'activePreset 不在 presets 中' } } }),
      },
    } }
    const store = createCardStore(null, connection as never)
    await store.load()
    await store.saveActivePreset('nonexistent')
    expect(store.getSnapshot().error).toContain('activePreset 不在 presets 中')
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

describe('card-store effort 档位目录（0.8.0）', () => {
  it('loadEfforts 取数成功 → efforts 入快照；取数失败 → efforts null（不占 error 通道）', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V4())
    const store = createCardStore(scope, null)
    await store.loadEfforts(async () => ({ 'kimi-coding/k3': ['low', 'high', 'max'] }))
    expect(store.getSnapshot().efforts).toEqual({ 'kimi-coding/k3': ['low', 'high', 'max'] })
    expect(store.getSnapshot().error).toBeNull()
    await store.loadEfforts(async () => { throw new Error('remote 挂了') })
    expect(store.getSnapshot().efforts).toBeNull()
    expect(store.getSnapshot().error).toBeNull()  // 降级通道，不污染 error
  })

  it('无 fetch（旧宿主/未接 remote）→ efforts 保持 null', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V4())
    const store = createCardStore(scope, null)
    expect(store.getSnapshot().efforts).toBeNull()
  })
})
