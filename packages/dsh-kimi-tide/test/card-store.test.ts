// test/card-store.test.ts
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, DEFAULT_CONFIG_V6, DEFAULT_CONFIG_V7, rowsFromConfig, rowsFromLegacy, type RouteRowV7, type RouteTarget, type RouterConfigV5, type RouterConfigV6 } from '../src/config.js'
import { createCardStore, type SettingsScopeLike } from '../src/client/card-store.js'
import { validateRouterConfig } from '../src/settings-schema.js'
import { buildRoutingView, previewDispatch } from '../src/routing-view.js'

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
    // B1 双写：写序列 = unset routes → set presets → set routes（三笔同源），
    // 「presets 整段覆盖」的断言语义不变——定位 presets 那一笔而非固定位次。
    const presetsWrite = scope.writes.find(([f]) => f === 'presets')
    expect(presetsWrite).toBeDefined()
    const value = presetsWrite![1]
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
        describe: async () => ({ result: { ok: true as const, value: { writable: true, namespaces: [{ ns: 'dsh-kimi-tide', value: { router: DEFAULT_CONFIG_V4() }, revision: 1 }] } } }),
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
      settings: { describe: async () => ({ result: { ok: true as const, value: { writable: true, namespaces: [{ ns: 'dsh-kimi-tide', value: { router: DEFAULT_CONFIG_V4() }, revision: 1 }] } } }), mutate: async () => ({}) },
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
  it('catalog：目录携带显示名 → modelNames/providerNames 入快照（2026-09-11 与官方一致）', async () => {
    // Fails if: 目录映射丢弃 name 字段——下拉只能渲染裸 provider/model 键，
    // 与官方 Models 页/模型选择器的友好名不一致（实机报障本体）。
    const connection = { api: {
      settings: { describe: async () => ({ result: { ok: true as const, value: { writable: true, namespaces: [{ ns: 'dsh-kimi-tide', value: { router: DEFAULT_CONFIG_V4() }, revision: 1 }] } } }), mutate: async () => ({}) },
      llm: { models: async () => ({ result: { ok: true as const, value: { groups: [
        { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' }] },
        { id: 'kimi-coding', name: 'Kimi', models: [{ id: 'k3', name: 'Kimi K3' }] },
      ] } } }) },
    } }
    const store = createCardStore(null, connection as never)
    await store.load()
    const snap = store.getSnapshot()
    expect(snap.modelNames?.['deepseek-official/deepseek-flash']).toBe('DeepSeek-V41-Flash')
    expect(snap.modelNames?.['kimi-coding/k3']).toBe('Kimi K3')
    expect(snap.providerNames?.['deepseek-official']).toBe('DeepSeek')
    expect(snap.providerNames?.['kimi-coding']).toBe('Kimi')
  })
  it('⑥-B 打磨三修订: provider 整个不在目录 → 不判 false（目录通道无法判定，插件自挂 provider 可经路由可达——实机误报 2026-08-29）', async () => {    // Fails if: 目录缺 provider 即给其配置目标标 false（工作中的模型被误标未挂载）
    const connection = { api: {
      settings: { describe: async () => ({ result: { ok: true as const, value: { writable: true, namespaces: [{ ns: 'dsh-kimi-tide', value: { router: DEFAULT_CONFIG_V4() }, revision: 1 }] } } }), mutate: async () => ({}) },
      llm: { models: async () => ({ result: { ok: true as const, value: { groups: [
        { id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] },
      ] } } }) },
    } }
    const store = createCardStore(null, connection as never)
    await store.load()
    const snap = store.getSnapshot()
    expect(snap.availability?.['kimi-coding/k3']).toBeUndefined()
    expect(snap.availability?.['kimi-coding/kimi-for-coding']).toBeUndefined()
    expect(snap.availability?.['deepseek-official/deepseek-v4-flash']).toBe(true)  // 目录内目标照常判定
  })
})

describe('card-store saveRoles（Task 7：分工表守卫式写通道）', () => {
  it('saveRoles：认领名冲突 ⇒ fail() 拒绝且不落盘（deleteFlow 同款守卫：先校验、不合法不写）', async () => {
    // Fails if: 「先写后校验」或冲突时仍走 saveTop——非法 roles 要么污染配置、
    // 要么错误只靠宿主 validate 静默 recover 上浮不了语义明确的认领冲突信息。
    const scope = makeScope(DEFAULT_CONFIG_V6())
    const store = createCardStore(scope, null)
    const bad = {
      a: { id: 'a', label: 'A', target: { provider: 'p', model: 'm' }, teammate: ['x'] },
      b: { id: 'b', label: 'B', target: { provider: 'p', model: 'm' }, teammate: ['x'] },
    }
    await store.saveRoles(bad)
    expect(scope.writes).toEqual([])  // 守卫式拒写：一笔都没发
    expect(store.getSnapshot().error).toContain('认领名')  // 错误上浮 error 通道
    expect((store.getSnapshot().config as RouterConfigV6 | null)?.roles).toEqual({})  // 值未污染
  })

  it('saveRoles：合法分工表写入成功并回读一致', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V6())
    const store = createCardStore(scope, null)
    const roles = { frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'k3' } } }
    await store.saveRoles(roles)
    expect((store.getSnapshot().config as RouterConfigV6 | null)?.roles).toEqual(roles)
    expect(store.getSnapshot().error).toBeNull()
  })
})

describe('card-store 主驱动写通道（Task 7 修复轮 1：driver / driverSticky / rulesApplyToChildren）', () => {
  it('saveDriver：合法 RouteTarget 写入成功并回读一致', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V6())
    const store = createCardStore(scope, null)
    const driver = { provider: 'kimi-coding', model: 'k3' }
    await store.saveDriver(driver)
    expect(scope.writes).toEqual([['driver', driver]])
    expect((store.getSnapshot().config as RouterConfigV6 | null)?.driver).toEqual(driver)
    expect(store.getSnapshot().error).toBeNull()
  })

  it('saveDriver：null（跟随宿主默认）写入成功并回读一致', async () => {
    const scope = makeScope({ ...DEFAULT_CONFIG_V6(), driver: { provider: 'kimi-coding', model: 'k3' } })
    const store = createCardStore(scope, null)
    await store.saveDriver(null)
    expect(scope.writes).toEqual([['driver', null]])
    expect((store.getSnapshot().config as RouterConfigV6 | null)?.driver).toBeNull()
    expect(store.getSnapshot().error).toBeNull()
  })

  it('saveDriver：目标不完整 ⇒ 宿主 validate 拒写 ⇒ error 通道上浮且值未污染', async () => {
    // Fails if: saveTop 的写后「意图值 vs 实读值」比对丢落——宿主 validate-on-write
    // 静默 recover（set 不抛、落值被拒）时错误无声消失（driver 目标不完整属此列）。
    const scope = makeScope(DEFAULT_CONFIG_V6())
    const store = createCardStore(scope, null)
    await store.saveDriver({ provider: '', model: 'm' })  // v6 validate：driver 目标不完整 → 拒写
    expect(store.getSnapshot().error).toContain('写入被拒绝')
    expect((store.getSnapshot().config as RouterConfigV6 | null)?.driver).toBeNull()  // 值未污染
  })

  it('saveDriverSticky：开关布尔写入回读一致（新装默认 true → 显式关）', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V6())
    const store = createCardStore(scope, null)
    await store.saveDriverSticky(false)
    expect(scope.writes).toEqual([['driverSticky', false]])
    expect((store.getSnapshot().config as RouterConfigV6 | null)?.driverSticky).toBe(false)
    expect(store.getSnapshot().error).toBeNull()
  })

  it('saveRulesApplyToChildren：缺省（不参与）→ 显式开 → 显式关，写入回读一致', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V6())  // 缺省不写该键（运行期缺省 false = 新语义）
    const store = createCardStore(scope, null)
    await store.saveRulesApplyToChildren(true)
    expect(scope.writes).toEqual([['rulesApplyToChildren', true]])
    expect((store.getSnapshot().config as RouterConfigV6 | null)?.rulesApplyToChildren).toBe(true)
    await store.saveRulesApplyToChildren(false)
    expect((store.getSnapshot().config as RouterConfigV6 | null)?.rulesApplyToChildren).toBe(false)
    expect(store.getSnapshot().error).toBeNull()
  })
})

describe('card-store driverSticky 缺席解析（终审 I1/F4 修复波）', () => {
  it('新装快照缺 driverSticky ⇒ 卡片读到 true；卡片写单个字段后仍是 true', async () => {
    // 终审 I1：卡片保存全是单字段写——首次保存任何一项后，配置文档 router 段
    // 变为缺 driverSticky 的形态（schema 红线无 default），「主驱动恒定」勾选框
    // 此前由默认值显示为开、下次读取自己翻成关（§8-1「新装开」半落空）。
    const doc = DEFAULT_CONFIG_V6() as Partial<RouterConfigV6>
    delete doc.driverSticky
    const scope = makeScope(doc)
    const store = createCardStore(scope, null)
    // Fails if: 折叠快照不把缺席解析为内置默认 true（勾选框显示关）
    expect((store.getSnapshot().config as RouterConfigV6 | null)?.driverSticky).toBe(true)
    await store.saveActivePreset('saving')
    // Fails if: 卡片写单个字段后默认值蒸发（写后回读翻成 false）
    expect((store.getSnapshot().config as RouterConfigV6 | null)?.driverSticky).toBe(true)
    expect(store.getSnapshot().error).toBeNull()
  })

  it('显式 version:5 快照缺 driverSticky ⇒ 卡片读到 false（未迁移存量不被静默读成 true）', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V5())
    const store = createCardStore(scope, null)
    // Fails if: 卡片兜底把未迁移 v5 文档读成 true（静默改写存量行为）
    expect((store.getSnapshot().config as RouterConfigV6 | null)?.driverSticky).toBe(false)
  })

  it('迁移后的存量（显式 false）⇒ 卡片读到 false；显式值不被兜底覆盖', async () => {
    const scope = makeScope({ ...DEFAULT_CONFIG_V6(), driverSticky: false })
    const store = createCardStore(scope, null)
    expect((store.getSnapshot().config as RouterConfigV6 | null)?.driverSticky).toBe(false)
  })
})

describe('card-store effort 档位目录（0.8.0）', () => {
  it('loadEfforts 取数成功 → efforts/mounted 入快照；取数失败 → 双 null（不占 error 通道）', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V4())
    const store = createCardStore(scope, null)
    await store.loadEfforts(async () => ({ efforts: { 'kimi-coding/k3': ['low', 'high', 'max'] }, mounted: ['kimi-coding/k3'] }))
    expect(store.getSnapshot().efforts).toEqual({ 'kimi-coding/k3': ['low', 'high', 'max'] })
    expect(store.getSnapshot().mounted).toEqual(['kimi-coding/k3'])
    expect(store.getSnapshot().error).toBeNull()
    await store.loadEfforts(async () => { throw new Error('remote 挂了') })
    expect(store.getSnapshot().efforts).toBeNull()
    expect(store.getSnapshot().mounted).toBeNull()
    expect(store.getSnapshot().error).toBeNull()  // 降级通道，不污染 error
  })

  it('loadEfforts 节内缺 mounted（旧宿主遗留节）→ mounted null（三态退化语义）', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V4())
    const store = createCardStore(scope, null)
    await store.loadEfforts(async () => ({ efforts: {} }))
    expect(store.getSnapshot().efforts).toEqual({})
    expect(store.getSnapshot().mounted).toBeNull()
  })

  it('无 fetch（旧宿主/未接 remote）→ efforts 保持 null', async () => {
    const scope = makeScope(DEFAULT_CONFIG_V4())
    const store = createCardStore(scope, null)
    expect(store.getSnapshot().efforts).toBeNull()
  })

  it('1.4.1：scope 路径也读运行面目录（entry Config 形：value 带 router + efforts/mounted）', () => {
    const table = { 'zai-coding-cn/glm-5.3': ['low', 'high', 'max'] }
    const scope = makeScope({
      router: DEFAULT_CONFIG_V4(),
      efforts: table,
      mounted: ['zai-coding-cn/glm-5.3'],
    })
    const store = createCardStore(scope, null)
    // Fails if: scope 路径不读 efforts/mounted（档位表就只能指望 legacy fetchEfforts
    // 通道；那条通道在 0.1.7+ 宿主上读的是已移除的 kimi-tide-catalog 命名空间 = 恒空）
    expect(store.getSnapshot().efforts).toEqual(table)
    expect(store.getSnapshot().mounted).toEqual(['zai-coding-cn/glm-5.3'])
  })
})

describe('card-store v7 写通道双写（B1，2026-10-07 设计稿 §6.4「写边界双写」）', () => {
  it('savePreset 改既有规则目标：三笔序列（unset routes → set presets → set routes）全落盘，最终态 routes ≡ 旧字段', async () => {
    // Fails if: ① 双写退化为只写 presets——文件一旦出现 routes（v7 导入/此前
    // 双写），运行期按 routes 走，只写旧字段 = 编辑静默失效（本任务收口的事故
    // 形态）；② 两笔直写——「改既有行」时宿主 routes×旧字段冲突检测会把两个
    // 中间态都拒掉（死锁，编辑永不落盘），三笔序列先摘 routes 才恒合法。
    const scope = makeScope({ ...DEFAULT_CONFIG_V6(), activePreset: 'saving' })
    const store = createCardStore(scope, null)
    const saving = DEFAULT_CONFIG_V6().presets.saving
    const edited = {
      ...saving,
      rules: saving.rules.map((r) => (r.id === 'code-kfc' ? { ...r, target: { provider: 'kimi-coding', model: 'k3' } } : r)),
    }
    await store.savePreset('saving', edited)
    expect(scope.writes.map(([f]) => f)).toEqual(['routes', 'presets', 'routes'])
    expect(store.getSnapshot().error).toBeNull()
    const config = store.getSnapshot().config as RouterConfigV6 & { routes?: RouteRowV7[] }
    // 最终态过宿主同款校验：routes × 旧字段冲突检测不误报（两处语义一致）
    expect(validateRouterConfig(config)).toBeUndefined()
    // routes 与写入的 presets/roles 同源（rowsFromLegacy 单源）
    const routesWrite = scope.writes[2][1] as RouteRowV7[]
    expect(routesWrite).toEqual(rowsFromLegacy({ presets: scope.writes[1][1] as RouterConfigV6['presets'], roles: {} }))
    // 读回走字段判据（rowsFromConfig：routes 存在按 routes）与落盘 routes 一致
    expect(rowsFromConfig(config)).toEqual(routesWrite)
    // 再读回来 buildRoutingView：编辑结果（code-kfc → kimi-coding/k3）在视图里生效
    const view = buildRoutingView(config)
    const row = view.session.find((r) => r.id === 'code-kfc')
    expect(row).toBeDefined()
    expect((row!.target as RouteTarget).model).toBe('k3')
  })

  it('saveRoles：roles 与 routes 镜像同序三笔下发，dispatch 行携带 roles 元数据；读回 previewDispatch 命中', async () => {
    // Fails if: 分工表写操作不带 routes 镜像（routes 存在后角色编辑静默失效），
    // 或 dispatch 行丢 label/teammate 元数据（skill 正文与认领集合失真）。
    const scope = makeScope(DEFAULT_CONFIG_V6())
    const store = createCardStore(scope, null)
    const roles = {
      frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'k3' } },
      backend: { id: 'backend', label: '后端', target: { provider: 'zai-coding-cn', model: 'glm-5.3' }, teammate: ['glm'] },
    }
    await store.saveRoles(roles)
    expect(scope.writes.map(([f]) => f)).toEqual(['routes', 'roles', 'routes'])
    expect(store.getSnapshot().error).toBeNull()
    const config = store.getSnapshot().config as RouterConfigV6 & { routes?: RouteRowV7[] }
    expect(validateRouterConfig(config)).toBeUndefined()
    const dispatch = config.routes!.filter((r) => r.scope === 'dispatch')
    expect(dispatch.map((r) => r.id)).toEqual(['frontend', 'backend'])
    expect(dispatch[1]!.teammate).toEqual(['glm'])
    expect(config.roles).toEqual(roles)
    // 再读回来 buildRoutingView：previewDispatch 按认领名反查命中（role 依据 + label）
    const view = buildRoutingView(config)
    expect(previewDispatch(view, 'glm')).toEqual({
      target: { provider: 'zai-coding-cn', model: 'glm-5.3' },
      basis: 'role',
      roleLabel: '后端',
    })
  })

  it('connection/mutate 路径：一笔 mutate 同序三 ops（unset routes → set presets → set routes），routes 与 presets 同源', async () => {
    // Fails if: mutate 路径拆成多笔（中间态撞宿主校验）或 ops 顺序漂移
    // （先 set routes 后 set presets 在逐 op 校验的宿主上死锁）。
    const mutate = vi.fn(async () => ({ result: { ok: true as const, value: {} } }))
    const connection = { api: {
      settings: {
        describe: async () => ({ result: { ok: true as const, value: { writable: true, namespaces: [{ ns: 'dsh-kimi-tide', value: { router: DEFAULT_CONFIG_V6() }, revision: 3 }] } } }),
        mutate,
      },
    } }
    const store = createCardStore(null, connection as never)
    await store.load()
    const edited = { ...DEFAULT_CONFIG_V6().presets.saving, rules: [] }
    await store.savePreset('saving', edited)
    expect(mutate).toHaveBeenCalledTimes(1)
    const req = mutate.mock.calls[0]![0] as { ns: string; expectedRevision?: number; ops: Array<{ op: string; path: string[]; value?: unknown }> }
    expect(req.ns).toBe('dsh-kimi-tide')
    expect(req.expectedRevision).toBe(3)
    expect(req.ops.map((op) => `${op.op}:${op.path.join('.')}`)).toEqual(['unset:router.routes', 'set:router.presets', 'set:router.routes'])
    expect(req.ops[2]!.value).toEqual(rowsFromLegacy({ presets: req.ops[1]!.value as RouterConfigV6['presets'], roles: {} }))
  })

  it('routes 落值被宿主静默吞掉 ⇒ error 上浮（双写的「意图 vs 实读」比对不静默）', async () => {
    // Fails if: 双写只做旧字段的比对——routes 那笔被宿主吞掉时错误无声消失
    // （文件里 routes 与旧字段从此分叉，运行期按陈旧 routes 走 = 静默失效）。
    let value: unknown = DEFAULT_CONFIG_V6()
    const scope: SettingsScopeLike = {
      getSnapshot: () => ({ status: 'ready', value, base: undefined, user: undefined, writable: true }),
      subscribe: () => () => {},
      set: async (f, v) => { if (f !== 'routes') value = { ...(value as object), [f]: v } },
      unset: async () => {},
    }
    const store = createCardStore(scope, null)
    await store.savePreset('saving', { ...DEFAULT_CONFIG_V6().presets.saving, rules: [] })
    expect(store.getSnapshot().error).toContain('写入被拒绝')
  })

  it('读边界投影：v7 形（routes + 陈旧旧字段）⇒ 快照编辑模型来自 routes，陈旧旧字段不生效', async () => {
    // Fails if: 读边界不投影——卡片编辑的是不生效的旧字段（运行期按 routes 走），
    // 且后续双写会以陈旧旧字段重推 routes，冲掉 routes 独有内容（数据丢失）。
    const v7 = DEFAULT_CONFIG_V7()
    v7.presets = {
      ...v7.presets,
      saving: { ...v7.presets.saving, rules: [{ id: 'stale', when: { kind: 'image' }, target: { provider: 'p', model: 'm' } }] },
    }
    const scope = makeScope(v7)
    const store = createCardStore(scope, null)
    const config = store.getSnapshot().config
    // 陈旧旧字段（stale 规则）被 routes 反投影覆盖；routes 行集（内置规则）在场
    expect(config?.presets.saving.rules.find((r) => r.id === 'stale')).toBeUndefined()
    expect(config?.presets.saving.rules.some((r) => r.id === 'image-k3')).toBe(true)
  })

  it('v7 形上 saveRoles：presets 半边取 routes 反投影值，重推 routes 不丢 session 行（无投影即数据丢失的回归钉）', async () => {
    // Fails if: v7 默认形态（presets[*].rules 已迁出为空）上写 roles 时按空
    // presets 重推 routes——全部 session 行被静默清空（本任务最重的数据丢失面）。
    const scope = makeScope(DEFAULT_CONFIG_V7())
    const store = createCardStore(scope, null)
    const roles = { frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'k3' } } }
    await store.saveRoles(roles)
    expect(store.getSnapshot().error).toBeNull()
    const config = store.getSnapshot().config
    expect(config?.presets.saving.rules.length).toBe(3)
    expect(config?.presets.capability.rules.length).toBe(8)
    expect(validateRouterConfig(config as RouterConfigV6)).toBeUndefined()
  })
})

describe('card-store v2.2.0 派发护栏（dispatchGuard 写通道 + keywords 不丢）', () => {
  it('saveDispatchGuard：勾选 ⇒ 落 \'enforce\'，取消 ⇒ 落 \'off\'；回读一致、无 error', async () => {
    // Fails if: 卡片把布尔直接写进配置（schema 只收 'off' | 'enforce'）——宿主
    // validate-on-write 静默拒写：开关看着打开了，护栏实际不生效。
    const scope = makeScope({ ...DEFAULT_CONFIG_V6(), activePreset: 'saving' })
    const store = createCardStore(scope, null)
    await store.saveDispatchGuard(true)
    expect(scope.writes).toEqual([['dispatchGuard', 'enforce']])
    expect((store.getSnapshot().config as { dispatchGuard?: string }).dispatchGuard).toBe('enforce')
    await store.saveDispatchGuard(false)
    expect(scope.writes[1]).toEqual(['dispatchGuard', 'off'])
    expect((store.getSnapshot().config as { dispatchGuard?: string }).dispatchGuard).toBe('off')
    expect(store.getSnapshot().error).toBeNull()
  })

  it('saveRoles：角色编辑后 keywords 不丢——roles 与 routes 镜像两处都在（护栏判据的载体）', async () => {
    // Fails if: 角色编辑路径重建 RoleEntry 时丢掉 role.keywords，或 rowsFromLegacy /
    // projectRoutesToLegacy 不再搬该字段——用户填的领域词在下次保存时被静默抹掉，
    // 护栏随即退回 label/aliases 判定（本任务收口的数据丢失面）。
    const scope = makeScope({ ...DEFAULT_CONFIG_V6(), activePreset: 'saving' })
    const store = createCardStore(scope, null)
    const keywords = ['页面', 'React']
    await store.saveRoles({
      frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'k3' }, keywords },
    })
    const saved = store.getSnapshot().config as RouterConfigV6 & { routes?: RouteRowV7[] }
    expect(saved.roles.frontend!.keywords).toEqual(keywords)                     // 旧字段半边
    expect(saved.routes!.filter((r) => r.scope === 'dispatch')[0]!.keywords).toEqual(keywords)  // routes 镜像半边
    expect(validateRouterConfig(saved)).toBeUndefined()

    // 再编辑一次（改 label，模拟 RoleRow 的 {...role, label} 重建）：keywords 仍在两处
    await store.saveRoles({ frontend: { ...saved.roles.frontend!, label: '前端组' } })
    const edited = store.getSnapshot().config as RouterConfigV6 & { routes?: RouteRowV7[] }
    expect(store.getSnapshot().error).toBeNull()
    expect(edited.roles.frontend!.label).toBe('前端组')
    expect(edited.roles.frontend!.keywords).toEqual(keywords)
    expect(edited.routes!.filter((r) => r.scope === 'dispatch')[0]!.keywords).toEqual(keywords)
  })
})
