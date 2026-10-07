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
 *
 * B1（2026-10-07 设计稿 §6.4）：读边界投影（withRoutesProjection——routes
 * 存在时编辑模型 = routes 反投影，与宿主运行期同口径）+ 写边界双写
 * （writeRoutesAndLegacy——presets/roles 的写操作同笔下发 routes 镜像，
 * 文件里两处永远一致，杜绝「文件有 routes 后卡片写旧字段静默失效」）。
 */
import {
  configKey,
  DEFAULT_FLOWS,
  isFlowTarget,
  isV5Plus,
  projectRoutesToLegacy,
  rowsFromLegacy,
  type CollaborationFlow,
  type RoleEntry,
  type RouteRowV7,
  type RouteTarget,
  type RouterConfigV4,
  type RouterConfigV5,
  type RouterConfigV6,
  type RouterConfigV7,
  type RouterPreset,
} from '../config.js'
import { claimConflict } from '../roles.js'

/**
 * 卡片读写的设置视图 id（= **profile entry id**）。
 *
 * 0.1.7 换道（2026-09-28）：`settings.describe` 的 `ns` 不再由插件自命名，而是恒等于
 * profile 里那条 loader entry 的 id（宿主 `dsh-settings/lib/index.js:432`
 * `ns: entry.options.id`）。本插件的 entry id 由 cordis.patch.yml 的 insert 行决定，
 * 即 `dsh-kimi-tide`。旧的 `kimi-tide-router` / `kimi-tide-catalog` 两个命名空间在
 * 0.1.7 已无对应物。
 */
export const CARD_NAMESPACE = 'dsh-kimi-tide'

/**
 * 配置载荷路径：0.1.7 起 describe 给出的 `value` 是**整条 entry 的 Config**
 * （本插件 = `{ router, efforts, mounted, …tunables }`），路由配置在其 `router` 键下。
 */
export const CARD_CONFIG_PATH = 'router'

/** 卡片消费的配置过渡形（Task 11）：v4 存量与 v5+ 协作编排配置皆可渲染；
 *  B1 起 v7（routes 统一路由表）亦可——读边界经 projectRoutesToLegacy 投影成
 *  旧字段形态后，编辑器对版本无感（见 withRoutesProjection）。 */
export type CardConfig = RouterConfigV4 | RouterConfigV5 | RouterConfigV6 | RouterConfigV7

/** 卡片渲染用的单一快照：resolved 值 + base/user 分层（继承/覆盖显示）+ 错误态。 */
export interface CardSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  /** 解析后的生效配置（schema 默认 → base → user 三层合并）。 */
  config: CardConfig | null
  /** 组合 base 层（patch/entry 种子）；字段在此出现 = 继承自部署基座。 */
  base: CardConfig | null
  /** 原始 user 层；字段在此出现 = 用户覆盖。 */
  user: CardConfig | null
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
   * 模型显示名（'provider/model' → 宿主目录显示名，2026-09-11）：官方 Models
   * 页/模型选择器同源的友好名（如 deepseek-flash → DeepSeek-V41-Flash）。
   * null/缺键 = 目录未给名或通道未提供 → 下拉回退裸键（渲染与旧行为逐字一致）。
   */
  modelNames: Record<string, string> | null
  /** 提供方显示名（provider id → 显示名，如 deepseek-official → DeepSeek）：下拉分组组头。 */
  providerNames: Record<string, string> | null
  /**
   * 候选可用性映射（'provider/model' → available）：目标集 = 所有预设的
   * default + 规则 target 去重；命中目录即为可用（无 allowedProviders
   * 白名单过滤）。null = 无灰态（无 connection 通道 / 目录拉取失败），
   * 不为可用性失败污染 error 通道。
   */
  availability: Record<string, boolean> | null
  /**
   * per-model 推理档位表（'provider/model' → effort id 列表，0.8.0 自有
   * Host→Client 通道）。null = 未取/取数失败——UI 降级为「跟随默认」禁用态，
   * 与 availability 同款：不占 error 通道。
   */
  efforts: Record<string, string[]> | null
  /**
   * 路由器真实挂载表（'provider/model' 键列表，1.1.0 A8 自有通道随 efforts
   * 同节发布）。null/缺省 = 未取或旧宿主无此键——试一句 reviewer 判定退化为
   * 三态（不误伤、也不标注挂载盲区）。
   */
  mounted?: string[] | null
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
      /**
       * 0.1.7 起 `settings/describe` 是**零参** RPC（宿主 typert 描述符 `parameters: []`，
       * 严格 arity）。实机报错原文：`client api:settings/describe expected 0 argument(s),
       * got 1`——传 `{}` 或 `undefined` 都算「传了 1 个参数」，被宿主直接拒绝。
       */
      describe(): Promise<{
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
        result: SettingsRpcResult<{ groups: Array<{ id: string; name?: string; models: Array<{ id: string; name?: string }> }> }>
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
  /** 整体覆盖单个预设（组装下一个完整 presets 对象后整段写）。
   *  B1：同一笔写同时下发 routes 镜像（写边界双写，见 writeRoutesAndLegacy）。 */
  savePreset(presetId: string, preset: RouterPreset): Promise<void>
  /** 新建预设；id 冲突 → error 通道，不写。B1：双写同 savePreset。 */
  createPreset(id: string, preset: RouterPreset): Promise<void>
  /** 删除预设；删激活预设时先写 activePreset: null 再删预设（两次顺序写入）。
   *  B1：presets 删除同样带 routes 镜像双写。 */
  deletePreset(id: string): Promise<void>
  /** 整段覆盖关键词组表。 */
  saveKeywordGroups(groups: Record<string, string[]>): Promise<void>
  /** 整段覆盖协作流注册表（v5；流参数编辑走此通道）。 */
  saveFlows(flows: Record<string, CollaborationFlow>): Promise<void>
  /**
   * 删除自建协作流（v5）。守卫（validate-on-write 纪律：删流前必须先清引用）：
   * 预置流（DEFAULT_FLOWS 键）不可删；仍被规则 target 或 imageFallbackFlow 引用
   * 的流拒删——两种拒绝都上浮 error 通道且不写盘。
   */
  deleteFlow(id: string): Promise<void>
  /**
   * 整段覆盖分工表（v6 roles）。守卫式拒写（validate-on-write 纪律，与
   * deleteFlow 同款）：认领名冲突（claimConflict 返回错误串——认领集合 =
   * teammate[] ∪ { id}，跨 role 重叠）时 fail() 上浮 error 通道且**不写盘**。
   * B1：合法写入带 routes 镜像双写（写边界双写，见 writeRoutesAndLegacy）。
   */
  saveRoles(roles: Record<string, RoleEntry>): Promise<void>
  /**
   * 主驱动目标（v6 顶层 driver，Task 7 修复轮 1）：RouteTarget 或 null
   * （null = 跟随宿主默认模型）。写通道 = saveTop；宿主 validate 拒写
   * （如目标不完整）经 saveTop 的「意图值 vs 实读值」比对上浮 error 通道。
   */
  saveDriver(driver: RouteTarget | null): Promise<void>
  /** 主驱动恒定开关（v6 顶层 driverSticky）：true = 主会话打底恒用 driver。 */
  saveDriverSticky(sticky: boolean): Promise<void>
  /** 子代理参与关键词规则开关（v6 顶层 rulesApplyToChildren）：缺省/false = 不参与（v2.0.0 新语义）。 */
  saveRulesApplyToChildren(apply: boolean): Promise<void>
  /** 清除一个顶层字段使其重新继承 base/默认。 */
  resetField(field: string): Promise<void>
  /** 取 per-model 推理档位表与真实挂载表（0.8.0/1.1.0 A8 自有通道）；失败/未提供 → 双 null。 */
  loadEfforts(fetch: () => Promise<{ efforts?: Record<string, string[]>; mounted?: string[] }>): Promise<void>
  getSnapshot(): CardSnapshot
  subscribe(listener: () => void): () => void
}

const asConfig = (value: unknown): CardConfig | null =>
  typeof value === 'object' && value !== null ? (value as CardConfig) : null

/**
 * 终审 I1/F4（2026-10-06 修复波）：**缺席**的 driverSticky 解析为内置默认 true
 * （与 mergeResolved 的 DEFAULT_CONFIG_V6 基座同款口径；红线是不给 schema 加
 * .default()，故默认在读取兜底落地）。显式 version<6 的未迁移文档 ⇒ false
 * （存量口径：迁移路径本就显式写 false，未迁移文档绝不被静默读成 true）。
 * 只作用于解析后的生效值（config），不污染 base/user 分层显示。
 */
const withDriverStickyDefault = (config: CardConfig | null): CardConfig | null => {
  if (config === null || (config as RouterConfigV6).driverSticky !== undefined) return config
  const legacy = typeof config.version === 'number' && config.version < 6
  return { ...config, driverSticky: !legacy }
}

/** 从 entry 级 Config 载荷里取出路由配置（0.1.7：`value.router`；兼容旧扁平形态）。 */
const asRouterConfig = (value: unknown): CardConfig | null => {
  if (typeof value !== 'object' || value === null) return null
  const holder = value as Record<string, unknown>
  return asConfig(holder[CARD_CONFIG_PATH] ?? value)
}

/** 从 entry 级 Config 载荷里取运行面目录数据（efforts / mounted，0.1.7 volatile 字段）。 */
const asCatalogMeta = (value: unknown): { efforts?: Record<string, string[]>; mounted?: string[] } => {
  if (typeof value !== 'object' || value === null) return {}
  const holder = value as Record<string, unknown>
  return {
    efforts: asConfig(holder.efforts) as Record<string, string[]> | null ?? undefined,
    mounted: Array.isArray(holder.mounted) ? (holder.mounted as string[]) : undefined,
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * B1 读边界投影（设计稿 2026-10-07 §6.4「读边界投影」的客户端侧，与宿主运行期
 * 同口径）：配置文件一旦带 routes（v7 导入 / 此前双写落盘），运行期即按 routes
 * 走——卡片的编辑模型必须与运行期同源，否则 ① 编辑的是不生效的旧字段（静默
 * 失效）；② 双写重推 routes 时会把 routes 独有的行集冲掉（数据丢失）。
 * routes 缺失/空数组 ⇒ 原引用返回（v6 及更早零行为变更）；routes ≡ 旧字段 ⇒
 * 投影逐字节等价。只作用于解析后的生效值（config），不污染 base/user 分层。
 */
const withRoutesProjection = (config: CardConfig | null): CardConfig | null =>
  config === null ? null : projectRoutesToLegacy(config)

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
    modelNames: null,
    providerNames: null,
    availability: null,
    mounted: null,
    efforts: null,
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
    // 1.4.1：运行面目录（efforts / mounted）与路由配置同一次读回——0.1.7+ 宿主把
    // 它们放在本条目 Config 的 volatile 字段里（`asCatalogMeta`），scope 路径此前
    // 完全没读，档位表只能指望 legacy fetchEfforts 通道（那条通道在 0.1.7+ 读的是
    // 已移除的 kimi-tide-catalog 命名空间 ⇒ 恒空表 ⇒ 档位下拉全灰）。
    // 扁平形（scope 直接给 router 子树）取不到键 → 保持既有值，行为不变。
    const meta = asCatalogMeta(s.value)
    publish({
      status: s.status === 'ready' && s.value !== undefined
        ? 'ready'
        : s.status === 'unavailable' ? 'unavailable' : 'loading',
      config: s.status === 'ready' ? withDriverStickyDefault(withRoutesProjection(asConfig(s.value))) : null,
      base: asConfig(s.base),
      user: asConfig(s.user),
      writable: s.writable,
      error: null,
      catalog: snapshot.catalog,
      modelNames: snapshot.modelNames,
      providerNames: snapshot.providerNames,
      availability: snapshot.availability,
      efforts: meta.efforts ?? snapshot.efforts,
      mounted: meta.mounted ?? snapshot.mounted,
    })
  }

  /**
   * 候选灰态取数：拉宿主模型目录（llm.models）→ catalog 全量入快照（下拉
   * 数据源），模型/提供方显示名同步入快照（2026-09-11 下拉与官方 Models 页
   * 名称一致）；availability 目标集 = 所有预设 default + 规则模型 target（flow
   * 引用跳过）+ v5 流的 visionModel/reviewer 去重，命中目录即可用（无
   * allowedProviders 白名单过滤）。失败/无通道 → catalog/availability/
   * modelNames/providerNames 均 null（无灰态、无名称→裸键），不占用 error 通道。
   */
  const loadAvailability = async (config: CardConfig | null): Promise<void> => {
    const llm = connection?.api.llm
    if (config === null || llm === undefined) {
      if (snapshot.availability !== null || snapshot.catalog !== null) {
        publish({ ...snapshot, catalog: null, modelNames: null, providerNames: null, availability: null, mounted: null })
      }
      return
    }
    try {
      const r = await llm.models({})
      if (!r.result.ok) {
        publish({ ...snapshot, catalog: null, modelNames: null, providerNames: null, availability: null, mounted: null })
        return
      }
      const catalog = r.result.value.groups.map((group) => ({
        provider: group.id,
        models: group.models.map((model) => model.id),
      }))
      // 显示名映射：目录给了 name 才落键——缺名键由 UI 回退裸键，不编造。
      const modelNames: Record<string, string> = {}
      const providerNames: Record<string, string> = {}
      for (const group of r.result.value.groups) {
        if (group.name !== undefined) providerNames[group.id] = group.name
        for (const model of group.models) {
          if (model.name !== undefined) modelNames[`${group.id}/${model.id}`] = model.name
        }
      }
      const served = new Set<string>()
      for (const group of catalog) {
        for (const model of group.models) served.add(`${group.provider}/${model}`)
      }
      const targets: RouteTarget[] = []
      for (const preset of Object.values(config.presets)) {
        targets.push(preset.default)
        for (const rule of preset.rules) {
          if (!isFlowTarget(rule.target)) targets.push(rule.target)
        }
      }
      if (isV5Plus(config)) {
        for (const flow of Object.values(config.flows)) {
          targets.push(flow.type === 'transcribe' ? flow.visionModel : flow.reviewer)
        }
      }
      const availability: Record<string, boolean> = {}
      const providerServed = new Set(catalog.map((group) => group.provider))
      const seen = new Set<string>()
      for (const target of targets) {
        const key = configKey(target)
        if (seen.has(key)) continue
        seen.add(key)
        // ⑥-B 打磨三修订（实机误报 2026-08-29）三态显式：目录命中 → true；
        // provider 已知而模型缺失（真未挂载）→ false；provider 整个不在目录
        // = 目录通道无法判定该 provider（插件自挂 provider 可经路由通道可达，
        // 实机反例：kimi/zai 工作中却被标未挂载）→ 不落键（视同可用）。
        if (served.has(key)) availability[key] = true
        else if (providerServed.has(target.provider)) availability[key] = false
      }
      publish({ ...snapshot, catalog, modelNames, providerNames, availability })
    } catch {
      publish({ ...snapshot, catalog: null, modelNames: null, providerNames: null, availability: null, mounted: null })
    }
  }

  const load = async (): Promise<void> => {
    if (scope !== null) {
      readScope()
    } else if (connection !== null) {
      try {
        // 0.1.7：describe 零参（见 ConnectionLike 注）。传 undefined 也计数 ⇒ 实机被拒。
        const r = await connection.api.settings.describe()
        if (!r.result.ok) {
          publish({ status: 'unavailable', config: null, base: null, user: null, writable: false, error: null, catalog: null, modelNames: null, providerNames: null, availability: null, efforts: null })
          return
        }
        const view = r.result.value.namespaces.find((n) => n.ns === CARD_NAMESPACE)
        if (view === undefined) {
          revision = undefined
          publish({ status: 'unavailable', config: null, base: null, user: null, writable: false, error: null, catalog: null, modelNames: null, providerNames: null, availability: null, efforts: null })
          return
        }
        revision = view.revision
        // 运行面目录（efforts / mounted）就在同一份 value 里（本条目 Config 的
        // volatile 字段），随本次 describe 一并取得——不必再发第二次 RPC。
        const meta = asCatalogMeta(view.value)
        publish({
          status: 'ready',
          config: withDriverStickyDefault(withRoutesProjection(asRouterConfig(view.value))),
          base: asRouterConfig(view.base),
          user: asRouterConfig(view.user),
          writable: r.result.value.writable,
          error: null,
          catalog: snapshot.catalog,
          modelNames: snapshot.modelNames,
          providerNames: snapshot.providerNames,
          availability: snapshot.availability,
          efforts: meta.efforts ?? snapshot.efforts,
          mounted: meta.mounted ?? snapshot.mounted,
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
          // 0.1.7：路径前缀补上 `router`——describe 的 value 是整条 entry Config
          // （router/efforts/mounted/tunables），路由字段在其 router 子树下。
          ops: [{ op: 'set', path: [CARD_CONFIG_PATH, field], value }],
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

  /**
   * B1 写边界双写（设计稿 2026-10-07 §6.4「写边界双写」）：presets / roles 的写
   * 操作必须把 routes 一并镜像下发——文件里一旦出现 routes，运行期即按 routes
   * 走（读边界字段判据），只写旧字段 = 编辑静默失效（本项目最忌讳的事故形态）。
   * version 字段不动（运行期走字段判据，不靠版本号门控，R2 裁定）；routes 与
   * 旧字段同源（rowsFromLegacy 单源，由「将要写入的 presets/roles」推出）。
   *
   * scope 路径无法单笔原子，用三笔序列（顺序是硬约束，不是风格）：
   *   ① unset routes —— 宿主 validate-on-write 每笔都跑 routes×旧字段冲突
   *      检测：「改既有规则/角色」时无论先写哪一边，中间态两处都不一致 ⇒
   *      两笔皆被拒、编辑永不落盘（死锁）。先摘掉 routes，中间态回退旧字段
   *      投影，恒合法；
   *   ② set 旧字段新值 —— 此刻运行期按旧字段读，行为立即等于用户意图
   *      （即使 ③ 中断/被拒，文件也是「无 routes + 新旧字段」的自洽态）；
   *   ③ set routes 镜像（与 ② 同源）—— 最终态两处一致，冲突检测永不误报，
   *      旧版插件可回退。
   * mutate 路径单笔多 ops 同序下发（unset routes → set 旧字段 → set routes）：
   * 宿主逐 op 校验时每个中间态都合法，整笔合并校验时最终态一致，两种校验
   * 模型下都安全。
   * 写后仍走「意图值 vs 实读值」比对（scope 路径）：routes 与旧字段任一落值
   * 被拒都上浮 error 通道，不静默。
   */
  const writeRoutesAndLegacy = async (
    field: 'presets' | 'roles',
    value: Record<string, RouterPreset> | Record<string, RoleEntry>,
  ): Promise<void> => {
    // 另一半取当前生效值（读边界已投影：routes 存在时 = routes 反投影结果，
    // 重推行集不丢 routes 独有的内容）。
    const presets = (field === 'presets' ? value : snapshot.config?.presets ?? {}) as Record<string, RouterPreset>
    const roles = (field === 'roles' ? value : (snapshot.config as { roles?: Record<string, RoleEntry> } | null)?.roles ?? {}) as Record<string, RoleEntry>
    const routes: RouteRowV7[] = rowsFromLegacy({ presets, roles })
    try {
      if (scope !== null) {
        await scope.unset('routes')
        await scope.set(field, value)
        await scope.set('routes', routes)
      } else if (connection !== null) {
        const r = (await connection.api.settings.mutate({
          ns: CARD_NAMESPACE,
          ops: [
            { op: 'unset', path: [CARD_CONFIG_PATH, 'routes'] },
            { op: 'set', path: [CARD_CONFIG_PATH, field], value },
            { op: 'set', path: [CARD_CONFIG_PATH, 'routes'], value: routes },
          ],
          ...(revision === undefined ? {} : { expectedRevision: revision }),
        })) as { result?: SettingsRpcResult<unknown> } | undefined
        // 与 saveTop 同款拆箱：宿主校验拒绝经 result 通道返回（不抛），必须上浮。
        if (r !== null && typeof r === 'object' && r.result !== undefined && !r.result.ok) {
          fail(new Error(r.result.error.message))
          return
        }
      }
      await load()
      // scope 路径的宿主 validate-on-write 静默 recover（set 不抛、落值被拒）——
      // load 后对比「意图写入值」与「实际值」，routes 或旧字段任一不一致即视为
      // 写入被拒，上浮 error 通道（saveTop 同款纪律）。
      if (scope !== null) {
        const actual = snapshot.config as Record<string, unknown> | null
        if (JSON.stringify(actual?.[field]) !== JSON.stringify(value)
          || JSON.stringify(actual?.routes) !== JSON.stringify(routes)) {
          fail(new Error('写入被拒绝（校验失败？）'))
        }
      }
    } catch (error) {
      fail(error)
    }
  }

  /** 组装「下一个完整 presets 对象」：当前快照 presets 的浅拷贝。 */
  const nextPresets = (): Record<string, RouterPreset> => ({
    ...(snapshot.config?.presets ?? {}),
  })

  const savePreset = async (presetId: string, preset: RouterPreset): Promise<void> => {
    await writeRoutesAndLegacy('presets', { ...nextPresets(), [presetId]: preset })
  }

  const createPreset = async (id: string, preset: RouterPreset): Promise<void> => {
    if (snapshot.config !== null && Object.hasOwn(snapshot.config.presets, id)) {
      fail(new Error(`预设 id 冲突：${id} 已存在`))
      return
    }
    await writeRoutesAndLegacy('presets', { ...nextPresets(), [id]: preset })
  }

  const deletePreset = async (id: string): Promise<void> => {
    // C1 终审修复：宿主 dsh-settings 对每笔写入跑 validateRouterConfig——
    // 「先删 presets 再清 activePreset」会产生 activePreset 指向已删预设的
    // 非法中间态（首笔被拒 → 预设没删、路由被静默关闭）。顺序反转：先清
    // activePreset（若激活的就是待删预设），再写删除后的 presets 整段——
    // 两个中间态各自合法。B1：presets 的删除同样带 routes 镜像双写（该预设
    // 的 session 行随行集重推一并消失，两处永远一致）。
    if (snapshot.config?.activePreset === id) {
      await saveTop('activePreset', null)
    }
    const presets = nextPresets()
    delete presets[id]
    await writeRoutesAndLegacy('presets', presets)
  }

  const saveKeywordGroups = async (groups: Record<string, string[]>): Promise<void> => {
    await saveTop('keywordGroups', groups)
  }

  const saveFlows = async (flows: Record<string, CollaborationFlow>): Promise<void> => {
    await saveTop('flows', flows)
  }

  /**
   * 删流守卫（2026-08-21 避坑：宿主 validate-on-write，每条写后中间态必须
   * 合法——被引用的流删掉会产生「规则/兜底指向不存在流」的非法中间态）。
   * 预置流恒不可删（防规则悬空）；引用检查覆盖规则 target 与
   * imageFallbackFlow 显式引用。拒绝一律走 error 通道，不写盘。
   */
  const deleteFlow = async (id: string): Promise<void> => {
    const config = snapshot.config
    if (config === null || !isV5Plus(config)) {
      fail(new Error('协作流注册表不可用（配置尚未迁移到 v5）'))
      return
    }
    if (Object.hasOwn(DEFAULT_FLOWS(), id)) {
      fail(new Error(`协作流 '${id}' 是预置流，不可删除（防规则悬空）`))
      return
    }
    if (!Object.hasOwn(config.flows, id)) {
      fail(new Error(`协作流 '${id}' 不存在`))
      return
    }
    const refs: string[] = []
    for (const [presetId, preset] of Object.entries(config.presets)) {
      for (const rule of preset.rules) {
        if (isFlowTarget(rule.target) && rule.target.flow === id) {
          refs.push(`预设 '${presetId}' 规则 '${rule.id}'`)
        }
      }
      if (preset.imageFallbackFlow === id) {
        refs.push(`预设 '${presetId}' 的 imageFallbackFlow`)
      }
    }
    if (refs.length > 0) {
      fail(new Error(`协作流 '${id}' 仍被引用（${refs.join('、')}），请先清除引用`))
      return
    }
    const flows = { ...config.flows }
    delete flows[id]
    await saveTop('flows', flows)
  }

  /**
   * 分工表守卫式写通道（Task 7）：先跑 claimConflict（roles.ts 纯函数层，
   * 与 settings-schema 的 validate 同一判据），冲突 → fail() 不写盘；
   * 合法才写。B1：与 presets 同款双写——roles 与镜像 routes 同源下发
   * （writeRoutesAndLegacy），写后「意图值 vs 实读值」比对自带。
   */
  const saveRoles = async (roles: Record<string, RoleEntry>): Promise<void> => {
    const conflict = claimConflict(roles)
    if (conflict !== undefined) {
      fail(new Error(conflict))
      return
    }
    await writeRoutesAndLegacy('roles', roles)
  }

  /* Task 7 修复轮 1：主驱动三键写通道——saveTop 薄封装（无前置守卫；driver
     目标完整性由宿主 validate 把关，拒写经 saveTop 比对上浮 error 通道）。 */
  const saveDriver = async (driver: RouteTarget | null): Promise<void> => {
    await saveTop('driver', driver)
  }

  const saveDriverSticky = async (sticky: boolean): Promise<void> => {
    await saveTop('driverSticky', sticky)
  }

  const saveRulesApplyToChildren = async (apply: boolean): Promise<void> => {
    await saveTop('rulesApplyToChildren', apply)
  }

  const resetField = async (field: string): Promise<void> => {
    try {
      if (scope !== null) await scope.unset(field)
      else if (connection !== null) {
        await connection.api.settings.mutate({
          ns: CARD_NAMESPACE,
          ops: [{ op: 'unset', path: [CARD_CONFIG_PATH, field] }],
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
    saveFlows,
    deleteFlow,
    saveRoles,
    saveDriver,
    saveDriverSticky,
    saveRulesApplyToChildren,
    resetField,
    loadEfforts: async (fetch) => {
      try {
        const meta = await fetch()
        publish({ ...snapshot, efforts: meta.efforts ?? null, mounted: meta.mounted ?? null })
      } catch {
        publish({ ...snapshot, efforts: null, mounted: null })
      }
    },
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
