// src/client/effort-remote.ts — effort 档位表取数（0.8.0；B5 换道 2026-08-27；
// 1.4.1 二次换道 2026-10-03）。
// 历史：原通道（ctx.remote.$mount 手工 typert contribution）实机证伪——$mount
// 静默永久 pending（不发 rpc、不 reject、无告警）。0.8.0 换道为自有 dsh-settings
// 命名空间 `kimi-tide-catalog`。0.1.7 起该命名空间已无对应物：档位表 / 挂载表改为
// 本条目 Config 的 volatile 字段（efforts / mounted），与路由配置同一次
// settings.describe 回来。
// 1.4.1 实机缺陷：本文件仍只查 `kimi-tide-catalog`，查不到就返回**空表**（而不是
// 「没数据」），而 SettingsCard 的 loadEfforts 会拿这个空表覆盖 describe 主通道刚
// 读到的真表 ⇒ 桌面端所有「档位」下拉退化禁用（实机现象）。现按 ns 优先级取值：
// 本条目 Config（0.1.7+）→ 旧自有命名空间（< 0.1.7 宿主）→ 都没有则抛错，交由
// card-store.loadEfforts 的 catch 处理（不静默伪造空表）。
import { EFFORT_CATALOG_NAMESPACE } from '../effort-catalog.js'
import { CARD_NAMESPACE } from './card-store.js'
import { copy } from './locale.js'

export { EFFORT_CATALOG_NAMESPACE }

/** settings.describe 全量视图里与档位表相关的最小结构面（镜像 dsh 线格式）。 */
export interface EffortDescribeFace {
  settings: {
    /** 0.1.7：零参 RPC（传任何实参都被宿主按 arity 拒绝）。 */
    describe(): Promise<{
      result:
        | { ok: true; value: { namespaces: ReadonlyArray<{ ns: string; value: unknown }> } }
        | { ok: false; error: { message: string } }
    }>
  }
}

export type EffortsConnection = { api: EffortDescribeFace } | null

/** 档位表 + 真实挂载表（card-store 的快照字段消费）。 */
export interface CatalogMeta {
  efforts: Record<string, string[]>
  mounted: string[]
}

/**
 * 档位表来源的 ns 优先级：本条目 Config（0.1.7+，`efforts`/`mounted` 是它的
 * volatile 字段）→ 旧自有命名空间（< 0.1.7 宿主）。
 */
const CATALOG_NAMESPACES: readonly string[] = [CARD_NAMESPACE, EFFORT_CATALOG_NAMESPACE]

/**
 * 从 describe 的命名空间视图里取档位表（1.4.1）：按上面的优先级取**本插件的**那一节。
 * 两个 ns 都不在视图里 → null（调用方抛错降级，**不得**伪造空表——空表会覆盖
 * describe 主通道读到的真表，桌面端「档位」下拉由此全灰，1.4.1 实机缺陷）。
 */
const catalogFromNamespaces = (
  namespaces: ReadonlyArray<{ ns: string; value?: unknown }>,
): CatalogMeta | null => {
  for (const ns of CATALOG_NAMESPACES) {
    const found = namespaces.find((n) => n.ns === ns)
    if (found === undefined) continue
    const section = (found.value ?? {}) as { efforts?: Record<string, string[]>; mounted?: string[] }
    return { efforts: section.efforts ?? {}, mounted: section.mounted ?? [] }
  }
  return null
}

/**
 * 经 settings.describe 读取档位表与真实挂载表（1.1.0 A8：mounted 随同节发布）。
 * 连接缺失/describe 失败/命名空间缺席时抛错，交由 card-store.loadEfforts 的 catch
 * 统一降级——本函数不做静默兜底。mounted 缺键（旧宿主遗留节）→ 空表，判定端以
 * null/缺省区分「退化三态」与「确认挂载」。
 *
 * 0.1.7 状态：此路已**不再是主通道**——档位表并入本条目 Config 的 volatile 字段
 * （`efforts`/`mounted`），随路由配置的同一次 describe 回来（见 card-store 的
 * `asCatalogMeta`）。本函数保留作 connection 面回退；1.4.1 起同样先查本条目 ns，
 * 供仍有 connection 但无 loopback describe 的宿主使用；调用形态必须是零参。
 */
export async function fetchEffortsViaDescribe(connection: EffortsConnection): Promise<CatalogMeta> {
  if (connection === null) throw new Error(copy('settings.diag.effortNoConnection'))
  const r = await connection.api.settings.describe()
  if (!r.result.ok) throw new Error(copy('settings.diag.effortDescribeFailed', { 0: r.result.error.message }))
  const meta = catalogFromNamespaces(r.result.value.namespaces)
  if (meta === null) throw new Error(copy('settings.diag.effortNamespaceMissing', { 0: CARD_NAMESPACE, 1: EFFORT_CATALOG_NAMESPACE }))
  return meta
}

/**
 * 1.1.0 A8 复测（2026-09-05）：rc.1 的 loopback typed remote `settings.describe`
 * 为零参数直接调用（TYPERT 描述符 parameters: []——带参调用触发严格 arity 拒绝，
 * 与 commands.execute 教训同款）。本函数消费该零参调用，宽容解析两种返回形态：
 * RPC envelope（{ok, value|error}）或裸 value。失败即抛，交由调用方降级。
 */
export async function fetchCatalogMetaViaRemoteDescribe(
  describe: () => Promise<unknown>,
): Promise<CatalogMeta> {
  const raw = await describe()
  type DescribeEnvelope = {
    ok?: boolean
    value?: { namespaces?: ReadonlyArray<{ ns: string; value?: unknown }> }
    error?: { message?: string }
  }
  const envelope: DescribeEnvelope =
    raw !== null && typeof raw === 'object' && 'ok' in (raw as Record<string, unknown>)
      ? (raw as DescribeEnvelope)
      : { ok: true, value: raw as { namespaces?: ReadonlyArray<{ ns: string; value?: unknown }> } }
  if (envelope.ok !== true) {
    throw new Error(copy('settings.diag.describeFailed', { 0: envelope.error?.message ?? 'unknown' }))
  }
  const meta = catalogFromNamespaces(envelope.value?.namespaces ?? [])
  if (meta === null) throw new Error(copy('settings.diag.effortNamespaceMissing', { 0: CARD_NAMESPACE, 1: EFFORT_CATALOG_NAMESPACE }))
  return meta
}
