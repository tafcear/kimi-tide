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
 * 空目录的重试计划（纯函数）：只要「这一轮没拿到可用的目录」就排下一次重试，有界。
 *
 * 2.2.5（2026-10-19 桌面端实机）：判据从「挂载表非空而档位表为空」放宽为
 * `emptyPool || 档位表为空`。修前把「挂载表也为空」判成「provider 尚未注册、
 * 等宿主事件即可」，于是**不重试**；实机真身是 DSH 0.2.1-rc.2 上适配器已注册
 * （listProviders 有 4 个路由）但 `listModels` 在挂载窗口内还拿不到模型——宿主的
 * 模型目录/凭据解析是异步就绪的，几秒后才回填。这个窗口里枚举出空池、又被写成
 * `efforts: {} + mounted: []`，此后既无事件也无重试 ⇒ 档位表永久为空（每次重启
 * 都可能复现）。空池与「有模型但无档位」都值得再等一轮。
 *
 * @param input.efforts - 当前**已发布**的档位表（可能来自上一轮/持久化快照）。
 * @param input.emptyPool - 本轮枚举是否一个可用模型都没拿到（空池/枚举抛错）。
 * @param input.attempt - 已重试次数（0 起）。
 * @param input.delays - 重试时延表；缺省 EMPTY_CATALOG_RETRY_DELAYS_MS。
 * @returns 下一次重试时延（毫秒），或 undefined（不再重试）。
 */
export function planEmptyCatalogRetry(input: {
  efforts: Record<string, string[]>
  emptyPool: boolean
  attempt: number
  delays?: readonly number[]
}): number | undefined {
  const delays = input.delays ?? EMPTY_CATALOG_RETRY_DELAYS_MS
  if (!input.emptyPool && !isEmptyEffortCatalog(input.efforts)) return undefined
  if (input.attempt < 0 || input.attempt >= delays.length) return undefined
  return delays[input.attempt]
}

/** `{ efforts, mounted }` 的运行面目录快照（宿主 Config 的 volatile 字段形态）。 */
export interface PublishedCatalog {
  efforts: EffortCatalog
  mounted: string[]
}

/**
 * 从宿主给的 Config 值里读**上一轮已发布**的运行面目录（纯函数，给插件重载用）。
 *
 * 为什么需要：插件实例每次重载（设置写入触发 owner 重载 / 宿主重启 / profile 更新）
 * 都会先按「空目录」发布首帧。若首轮枚举又恰好落在宿主的异步就绪窗口里，就会把
 * 上一轮本来完好的档位表**覆盖成空表**，而且枚举失败时无从恢复（实机 16:54 现场）。
 * 读取来源有两级：条目原始 config（profile patch 原文，volatile 字段就落在这里）
 * 与宿主解析快照（schemastery 引用，带 `.get()`）。两者形状不合/缺失 ⇒ 返回 null，
 * 调用方退回旧行为（不伪造数据）。
 *
 * @param value - 条目原始 config、Config 快照，或任何 `{ efforts?, mounted? }` 形状的值。
 * @returns 规范化后的目录（缺键按空表/空表处理），或 null（没有任何目录字段/形状不合）。
 */
export function readPublishedCatalog(value: unknown): PublishedCatalog | null {
  /** 解开 schemastery 引用（`.get()`）；普通值原样返回。 */
  const plain = (input: unknown): unknown =>
    input !== null && typeof input === 'object' && typeof (input as { get?: unknown }).get === 'function'
      ? (input as { get: () => unknown }).get()
      : input
  const raw = plain(value)
  if (raw === null || typeof raw !== 'object') return null
  const holder = raw as { efforts?: unknown; mounted?: unknown }
  const hasEfforts = holder.efforts !== undefined
  const hasMounted = holder.mounted !== undefined
  if (!hasEfforts && !hasMounted) return null

  const efforts: EffortCatalog = {}
  if (hasEfforts) {
    const candidate = plain(holder.efforts)
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    for (const [key, levels] of Object.entries(candidate as Record<string, unknown>)) {
      if (typeof key !== 'string' || key.length === 0) return null
      if (!Array.isArray(levels) || levels.some((level) => typeof level !== 'string')) return null
      efforts[key] = [...(levels as string[])]
    }
  }
  const mounted: string[] = []
  if (hasMounted) {
    const candidate = plain(holder.mounted)
    if (!Array.isArray(candidate) || candidate.some((entry) => typeof entry !== 'string')) return null
    mounted.push(...(candidate as string[]))
  }
  return { efforts, mounted }
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
