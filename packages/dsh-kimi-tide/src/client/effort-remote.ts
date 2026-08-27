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
 * 经 settings.describe 读取档位表。连接缺失/describe 失败/命名空间缺席时抛错，
 * 交由 card-store.loadEfforts 的 catch 统一降级——本函数不做静默兜底。
 */
export async function fetchEffortsViaDescribe(connection: EffortsConnection): Promise<Record<string, string[]>> {
  if (connection === null) throw new Error('effort 档位表：connection 通道不可用')
  const r = await connection.api.settings.describe({})
  if (!r.result.ok) throw new Error(`effort 档位表 describe 失败：${r.result.error.message}`)
  const view = r.result.value.namespaces.find((n) => n.ns === EFFORT_CATALOG_NAMESPACE)
  const efforts = (view?.value as { efforts?: Record<string, string[]> } | undefined)?.efforts
  return efforts ?? {}
}
