// src/client/effort-remote.ts — effort 档位表取数（0.8.0，B5 实机换道 2026-08-27）。
// 原通道（ctx.remote.$mount 手工 typert contribution）实机证伪：真实 vendored
// kernel 里 $mount 静默永久 pending——不发 rpc、不 reject、无告警（BrowserSkill
// 浏览器取证三连：DOM 全禁用 + network 零 effortCatalog 请求 + console 零告警）。
// 新通道 = describe 静态注册表：宿主把档位表写进自有 dsh-settings 命名空间
// kimi-tide-catalog，客户端经 connection.api.settings.describe（设置卡片同款、
// 实测健康）按 ns 取值。缺 ns/取数失败 → 抛错，由 card-store.loadEfforts 降级
// 为 efforts=null（下拉「跟随默认」禁用态）。
import { EFFORT_CATALOG_NAMESPACE } from '../effort-catalog.js'

export { EFFORT_CATALOG_NAMESPACE }

/** settings.describe 全量视图里与档位表相关的最小结构面（镜像 dsh 线格式）。 */
export interface EffortDescribeFace {
  settings: {
    describe(body: Record<string, never>): Promise<{
      result:
        | { ok: true; value: { namespaces: ReadonlyArray<{ ns: string; value: unknown }> } }
        | { ok: false; error: { message: string } }
    }>
  }
}

export type EffortsConnection = { api: EffortDescribeFace } | null

/**
 * 经 settings.describe 读取档位表与真实挂载表（1.1.0 A8：mounted 随同节
 * 发布）。连接缺失/describe 失败/命名空间缺席时抛错，交由 card-store.loadEfforts
 * 的 catch 统一降级——本函数不做静默兜底。mounted 缺键（旧宿主遗留节）→ 空表，
 * 判定端以 null/缺省区分「退化三态」与「确认挂载」。
 */
export interface CatalogMeta {
  efforts: Record<string, string[]>
  mounted: string[]
}

export async function fetchEffortsViaDescribe(connection: EffortsConnection): Promise<CatalogMeta> {
  if (connection === null) throw new Error('effort 档位表：connection 通道不可用')
  const r = await connection.api.settings.describe({})
  if (!r.result.ok) throw new Error(`effort 档位表 describe 失败：${r.result.error.message}`)
  const view = r.result.value.namespaces.find((n) => n.ns === EFFORT_CATALOG_NAMESPACE)
  const section = (view?.value as { efforts?: Record<string, string[]>; mounted?: string[] } | undefined) ?? {}
  return { efforts: section.efforts ?? {}, mounted: section.mounted ?? [] }
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
    throw new Error(`describe 失败：${envelope.error?.message ?? 'unknown'}`)
  }
  const namespaces = envelope.value?.namespaces ?? []
  const section = (namespaces.find((n) => n.ns === EFFORT_CATALOG_NAMESPACE)?.value ?? {}) as {
    efforts?: Record<string, string[]>
    mounted?: string[]
  }
  return { efforts: section.efforts ?? {}, mounted: section.mounted ?? [] }
}
