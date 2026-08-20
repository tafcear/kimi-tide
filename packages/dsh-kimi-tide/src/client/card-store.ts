/**
 * card-store — 「月汐」设置卡片的数据面。
 *
 * 把 settingsScope 的命名空间快照（或 connection.api.settings 的 describe
 * 视图）折叠成卡片渲染所需的 CardSnapshot，并把用户写操作路由到
 * scope.set / connection.api.settings.mutate。卡片组件用
 * useSyncExternalStore(subscribe, getSnapshot) 订阅这个 store。
 *
 * Ruling 2（控制器预检裁决）：ConnectionLike / SettingsScopeLike 两个结构面
 * 类型定义在本文件，SettingsCard.tsx 从这里 import（而非本文件反向 import
 * 组件），避免类型环。
 */
import { configKey, type RouterConfigV4, type RouterPreset } from '../config.js'

export const CARD_NAMESPACE = 'kimi-tide-router'

/** 卡片渲染用的单一快照：resolved 值 + base/user 分层（继承/覆盖显示）+ 错误态。 */
export interface CardSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  /** 解析后的生效配置（schema 默认 → base → user 三层合并）。 */
  config: RouterConfigV4 | null
  /** 组合 base 层（patch/entry 种子）；字段在此出现 = 继承自部署基座。 */
  base: RouterConfigV4 | null
  /** 原始 user 层；字段在此出现 = 用户覆盖。 */
  user: RouterConfigV4 | null
  writable: boolean
  /** 最近一次写失败的信息；成功读入/写回后清空。 */
  error: string | null
  /**
   * 宿主模型全量目录（connection.api.llm.models，settings.section 是 root
   * 作用域 slot、拿不到 session 级投影，改由此通道取数）：下拉数据源，
   * 不做任何裁剪。null = 无 connection 通道 / 目录拉取失败。
   */
  catalog: Array<{ provider: string; models: string[] }> | null
  /**
   * 候选可用性映射（'provider/model' → available）：目标集 = 所有预设的
   * default + 规则 target 去重；命中目录即为可用（无 allowedProviders
   * 白名单过滤）。null = 无灰态（无 connection 通道 / 目录拉取失败），
   * 不为可用性失败污染 error 通道。
   */
  availability: Record<string, boolean> | null
}

/** settings.mutate 的一枚 path op（set / unset）。 */
export type SettingsPathOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** settings.describe 返回的单命名空间视图（卡片只关心 value/base/user/revision）。 */
export interface SettingsDescribeView {
  ns: string
  value: unknown
  base?: unknown
  user?: unknown
  /** 命名空间 raw user 层的单调 revision；写回时作为 expectedRevision。 */
  revision: number
}

/** 拆箱后的 RPC result：ok 携带值，否则携带错误。 */
export type SettingsRpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string } }

/** connection 服务的结构面（api.settings.describe / mutate + 可选 api.llm.models）。 */
export interface ConnectionLike {
  api: {
    settings: {
      describe(request: Record<string, never>): Promise<{
        result: SettingsRpcResult<{ writable: boolean; namespaces: SettingsDescribeView[] }>
      }>
      mutate(request: { ns: string; ops: SettingsPathOp[]; expectedRevision?: number }): Promise<unknown>
    }
    /**
     * 宿主模型目录（dsh-host-apiproxy LlmApi.models，session 无关）：设置页
     * Models 官方先例使用的同一通道。可选——旧宿主/无网关时缺省，卡片降级
     * 为无灰态。
     */
    llm?: {
      models(request: Record<string, never>): Promise<{
        result: SettingsRpcResult<{ groups: Array<{ id: string; models: Array<{ id: string }> }> }>
      }>
    }
  }
}

/** settingsScope.bind(...) 返回的 scope 结构面。 */
export interface SettingsScopeLike {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: unknown
    base: unknown
    user: unknown
    writable: boolean
  }
  subscribe(listener: () => void): () => void
  /** 顶层标量写；revision 冲突检测由 scope 内部处理（latest-write 恢复）。 */
  set(field: string, value: unknown): Promise<void>
  /** 顶层标量清除；revision 冲突检测由 scope 内部处理。 */
  unset(field: string): Promise<void>
}

/** 卡片 store 的对外句柄。 */
export interface CardStore {
  load(): Promise<void>
  /** 顶层标量字段写：scope.set 或 mutate set（单段 path）。 */
  saveTop(field: string, value: unknown): Promise<void>
  /** 切换激活预设（null = 关闭路由，逃生舱）。 */
  saveActivePreset(id: string | null): Promise<void>
  /** 整体覆盖单个预设（组装下一个完整 presets 对象后整段写）。 */
  savePreset(presetId: string, preset: RouterPreset): Promise<void>
  /** 新建预设；id 冲突 → error 通道，不写。 */
  createPreset(id: string, preset: RouterPreset): Promise<void>
  /** 删除预设；删激活预设时先写 activePreset: null 再删预设（两次顺序写入）。 */
  deletePreset(id: string): Promise<void>
  /** 整段覆盖关键词组表。 */
  saveKeywordGroups(groups: Record<string, string[]>): Promise<void>
  /** 清除一个顶层字段使其重新继承 base/默认。 */
  resetField(field: string): Promise<void>
  getSnapshot(): CardSnapshot
  subscribe(listener: () => void): () => void
}

const asConfig = (value: unknown): RouterConfigV4 | null =>
  typeof value === 'object' && value !== null ? (value as RouterConfigV4) : null

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function createCardStore(
  scope: SettingsScopeLike | null,
  connection: ConnectionLike | null,
): CardStore {
  let snapshot: CardSnapshot = {
    status: scope === null && connection === null ? 'unavailable' : 'loading',
    config: null,
    base: null,
    user: null,
    writable: false,
    error: null,
    catalog: null,
    availability: null,
  }
  // connection/mutate 路径的乐观并发栅栏：最近一次 describe 读到的命名空间
  // revision。scope 路径不需要它（scope.set/unset 自带 latest-write 恢复）。
  let revision: number | undefined
  const listeners = new Set<() => void>()
  const publish = (next: CardSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  const fail = (error: unknown): void => {
    publish({ ...snapshot, error: messageOf(error) })
  }

  const readScope = (): void => {
    if (scope === null) return
    const s = scope.getSnapshot()
    publish({
      status: s.status === 'ready' && s.value !== undefined
        ? 'ready'
        : s.status === 'unavailable' ? 'unavailable' : 'loading',
      config: s.status === 'ready' ? asConfig(s.value) : null,
      base: asConfig(s.base),
      user: asConfig(s.user),
      writable: s.writable,
      error: null,
      catalog: snapshot.catalog,
      availability: snapshot.availability,
    })
  }

  /**
   * 候选灰态取数：拉宿主模型目录（llm.models）→ catalog 全量入快照（下拉
   * 数据源）；availability 目标集 = 所有预设 default + 规则 target 去重，
   * 命中目录即可用（无 allowedProviders 白名单过滤）。失败/无通道 →
   * catalog/availability 均 null（无灰态），不占用 error 通道。
   */
  const loadAvailability = async (config: RouterConfigV4 | null): Promise<void> => {
    const llm = connection?.api.llm
    if (config === null || llm === undefined) {
      if (snapshot.availability !== null || snapshot.catalog !== null) {
        publish({ ...snapshot, catalog: null, availability: null })
      }
      return
    }
    try {
      const r = await llm.models({})
      if (!r.result.ok) {
        publish({ ...snapshot, catalog: null, availability: null })
        return
      }
      const catalog = r.result.value.groups.map((group) => ({
        provider: group.id,
        models: group.models.map((model) => model.id),
      }))
      const served = new Set<string>()
      for (const group of catalog) {
        for (const model of group.models) served.add(`${group.provider}/${model}`)
      }
      const availability: Record<string, boolean> = {}
      const seen = new Set<string>()
      for (const preset of Object.values(config.presets)) {
        for (const target of [preset.default, ...preset.rules.map((rule) => rule.target)]) {
          const key = configKey(target)
          if (seen.has(key)) continue
          seen.add(key)
          availability[key] = served.has(key)
        }
      }
      publish({ ...snapshot, catalog, availability })
    } catch {
      publish({ ...snapshot, catalog: null, availability: null })
    }
  }

  const load = async (): Promise<void> => {
    if (scope !== null) {
      readScope()
    } else if (connection !== null) {
      try {
        const r = await connection.api.settings.describe({})
        if (!r.result.ok) {
          publish({ status: 'unavailable', config: null, base: null, user: null, writable: false, error: null, catalog: null, availability: null })
          return
        }
        const view = r.result.value.namespaces.find((n) => n.ns === CARD_NAMESPACE)
        if (view === undefined) {
          revision = undefined
          publish({ status: 'unavailable', config: null, base: null, user: null, writable: false, error: null, catalog: null, availability: null })
          return
        }
        revision = view.revision
        publish({
          status: 'ready',
          config: asConfig(view.value),
          base: asConfig(view.base),
          user: asConfig(view.user),
          writable: r.result.value.writable,
          error: null,
          catalog: snapshot.catalog,
          availability: snapshot.availability,
        })
      } catch (error) {
        fail(error)
      }
    }
    await loadAvailability(snapshot.config)
  }

  // scope 路径同步读一次（renderToString 无 effect，仍能渲染出就绪快照），
  // 并订阅一次：外部写入（document-updated 推送）也会重新折叠快照。
  if (scope !== null) {
    readScope()
    scope.subscribe(readScope)
  }

  const saveTop = async (field: string, value: unknown): Promise<void> => {
    try {
      if (scope !== null) await scope.set(field, value)
      else if (connection !== null) {
        const r = (await connection.api.settings.mutate({
          ns: CARD_NAMESPACE,
          ops: [{ op: 'set', path: [field], value }],
          ...(revision === undefined ? {} : { expectedRevision: revision }),
        })) as { result?: SettingsRpcResult<unknown> } | undefined
        // I1 终审修复：宿主校验拒绝经 result 通道返回（不抛）——ok:false
        // 必须上浮 error，不再当作成功继续 load。
        if (r !== null && typeof r === 'object' && r.result !== undefined && !r.result.ok) {
          fail(new Error(r.result.error.message))
          return
        }
      }
      await load()
      // I1 终审修复（scope 路径）：宿主 validate-on-write 静默 recover（set
      // 不抛、落值被拒）——load 后对比「意图写入值」与「实际值」，不一致即
      // 视为写入被拒，上浮 error 通道。
      if (scope !== null) {
        const actual = (snapshot.config as Record<string, unknown> | null)?.[field]
        if (JSON.stringify(actual) !== JSON.stringify(value)) {
          fail(new Error('写入被拒绝（校验失败？）'))
        }
      }
    } catch (error) {
      fail(error)
    }
  }

  const saveActivePreset = async (id: string | null): Promise<void> => {
    await saveTop('activePreset', id)
  }

  /** 组装「下一个完整 presets 对象」：当前快照 presets 的浅拷贝。 */
  const nextPresets = (): Record<string, RouterPreset> => ({
    ...(snapshot.config?.presets ?? {}),
  })

  const savePreset = async (presetId: string, preset: RouterPreset): Promise<void> => {
    await saveTop('presets', { ...nextPresets(), [presetId]: preset })
  }

  const createPreset = async (id: string, preset: RouterPreset): Promise<void> => {
    if (snapshot.config !== null && Object.hasOwn(snapshot.config.presets, id)) {
      fail(new Error(`预设 id 冲突：${id} 已存在`))
      return
    }
    await saveTop('presets', { ...nextPresets(), [id]: preset })
  }

  const deletePreset = async (id: string): Promise<void> => {
    // C1 终审修复：宿主 dsh-settings 对每笔写入跑 validateRouterConfig——
    // 「先删 presets 再清 activePreset」会产生 activePreset 指向已删预设的
    // 非法中间态（首笔被拒 → 预设没删、路由被静默关闭）。顺序反转：先清
    // activePreset（若激活的就是待删预设），再写删除后的 presets 整段——
    // 两个中间态各自合法。
    if (snapshot.config?.activePreset === id) {
      await saveTop('activePreset', null)
    }
    const presets = nextPresets()
    delete presets[id]
    await saveTop('presets', presets)
  }

  const saveKeywordGroups = async (groups: Record<string, string[]>): Promise<void> => {
    await saveTop('keywordGroups', groups)
  }

  const resetField = async (field: string): Promise<void> => {
    try {
      if (scope !== null) await scope.unset(field)
      else if (connection !== null) {
        await connection.api.settings.mutate({
          ns: CARD_NAMESPACE,
          ops: [{ op: 'unset', path: [field] }],
          ...(revision === undefined ? {} : { expectedRevision: revision }),
        })
      }
      await load()
    } catch (error) {
      fail(error)
    }
  }

  return {
    load,
    saveTop,
    saveActivePreset,
    savePreset,
    createPreset,
    deletePreset,
    saveKeywordGroups,
    resetField,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
