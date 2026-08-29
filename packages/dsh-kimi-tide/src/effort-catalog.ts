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
