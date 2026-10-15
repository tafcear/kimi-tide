// src/effort-catalog.ts — effort 档位目录（0.8.0）。
// 通道史（2026-08-27 实机验收 B5 换道）：原设计为 Typert remote 手工
// contribution（宿主 provide + 客户端 $mount）——宿主半链 spike 通过，但
// 客户端半链在真实 vendored kernel 实机证伪：$mount 静默永久 pending
// （不发 rpc、不 reject、无告警）。换道为 dsh-settings 自有命名空间
// `kimi-tide-catalog`：宿主在候选枚举刷新后把档位表写进该节（写前脏
// 检查，settings.yaml 里该节仅随模型清单变化），客户端经
// connection.api.settings.describe（设置卡片同款静态注册表通道）读取。
// 无装饰器、无生成器依赖。
import type { CandidateMeta } from './config.js'

/** 档位表命名空间（dsh-settings；客户端经 settings.describe 按 ns 读取）。 */
export const EFFORT_CATALOG_NAMESPACE = 'kimi-tide-catalog'

/** 档位表：'provider/model' → 支持的 reasoningEffort id 列表。 */
export type EffortCatalog = Record<string, string[]>

/** 从候选池建档位表（纯函数）：只收带 reasoningEfforts 的条目，返回副本。 */
export function buildEffortCatalog(metas: readonly CandidateMeta[]): EffortCatalog {
  const out: EffortCatalog = {}
  for (const meta of metas) {
    if (meta.reasoningEfforts === undefined || meta.reasoningEfforts.length === 0) continue
    out[`${meta.provider}/${meta.model}`] = [...meta.reasoningEfforts]
  }
  return out
}

/**
 * 空档位表的重试时延（毫秒）。为什么有这张表（2026-10-15 实机）：适配器晚于
 * 本插件挂载注册时，首次枚举可能只拿到残缺池子——池里 4 个模型、一个档位都没
 * 声明 ⇒ 客户端档位表为空 ⇒ 设置页**每一行**的档位下拉禁用，且那句「该模型未
 * 声明档位」把"没数据"说成了"模型不支持"（用户按它去查模型，查不出所以然）。
 * 有界重试给适配器注册留出窗口；超出表长即不再重试（宿主本就不报档位时不刷屏）。
 */
export const EMPTY_CATALOG_RETRY_DELAYS_MS: readonly number[] = [5_000, 20_000]

/**
 * 档位表是否为空（纯函数）：零键 / null / undefined 都算空。客户端据此区分
 * 「档位表未取到」（表本身没数据）与「该模型未声明档位」（表有数据、缺这一个键）
 * ——修前两者共用同一句文案，空表被误述成模型能力缺失。
 */
export function isEmptyEffortCatalog(efforts: Record<string, string[]> | null | undefined): boolean {
  return efforts === null || efforts === undefined || Object.keys(efforts).length === 0
}

/**
 * 空档位表的重试计划（纯函数）：**挂载表非空而档位表为空** ⇒ 返回下一次重试时延；
 * 其余情况返回 undefined（不排重试）。判据为什么带挂载表：挂载表为空 = 枚举整体
 * 没拿到东西（provider 尚未注册），与「枚举成功但无模型声明档位」是两种状态；只有
 * 后者值得再等一轮适配器注册。
 * @param input.efforts - 本轮发布的档位表。
 * @param input.mounted - 本轮发布的挂载表。
 * @param input.attempt - 已重试次数（0 起）。
 * @param input.delays - 重试时延表；缺省 EMPTY_CATALOG_RETRY_DELAYS_MS。
 * @returns 下一次重试时延（毫秒），或 undefined（不再重试）。
 */
export function planEmptyCatalogRetry(input: {
  efforts: Record<string, string[]>
  mounted: readonly string[]
  attempt: number
  delays?: readonly number[]
}): number | undefined {
  const delays = input.delays ?? EMPTY_CATALOG_RETRY_DELAYS_MS
  if (input.mounted.length === 0) return undefined
  if (!isEmptyEffortCatalog(input.efforts)) return undefined
  if (input.attempt < 0 || input.attempt >= delays.length) return undefined
  return delays[input.attempt]
}

/**
 * 从候选池建真实挂载表（1.1.0 A8，纯函数）：'provider/model' 键列表，收
 * available 条目（decide 侧 reviewerAvailable 同语义：m.available 真值）。
 * 与 efforts 的区别：本表不要求带档位——无档位模型（不在 efforts 表）也是
 * 真实挂载，reviewer 可用性判定不得误伤。发布进 kimi-tide-catalog 命名空间
 * 的 mounted 键，试一句 reviewer 判定的唯一真相源。
 */
export function buildMountedModels(metas: readonly CandidateMeta[]): string[] {
  const out: string[] = []
  for (const meta of metas) {
    if (!meta.available) continue
    out.push(`${meta.provider}/${meta.model}`)
  }
  return out
}
