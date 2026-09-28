// src/settings-migration.ts
import { existsSync, renameSync } from 'node:fs'
// 0.1.7：deepEqualJson 由 dsh-settings 迁至 dsh-util-values（dsh-settings 0.1.7 只导出
// SettingsConflictError / SettingsForms / redactSecrets）。语义与旧函数逐字一致，
// 故不用 node:util.isDeepStrictEqual 替代（后者对 undefined 属性 / 稀疏数组 / 原型的
// 判定语义不同）。
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import type { RouterConfigV4, RouterConfigV5 } from './config.js'
import { coerceRouterConfigV5 } from './migrate.js'
import { mergeResolved } from './settings-schema.js'
import { RouterSidecarStore } from './sidecar.js'

export interface MigrationScope { get(): RouterConfigV4 | RouterConfigV5; replace(section: object): Promise<void> }
export type MigrationOutcome = 'imported' | 'skipped-clean' | 'skipped-dirty' | 'no-sidecar'

export interface MigrationDeps {
  sidecarFile: string
  scope: MigrationScope
  entry: unknown                    // patch.yml router 块（composition entry）
  /**
   * 0.1.7：条目是否已带**显式**路由配置（用户/管理员写过）。
   *
   * 旧实现用结构等价判脏（`deepEqualJson(scope.get(), mergeResolved(entry))`）。那在
   * 「宿主已解析条目」的新架构下**恒为不等**：宿主解析值不含 `DEFAULT_FLOWS`（预设流由
   * 插件的 mergeResolved 供给），而 scope.get() 拿到的是宿主解析值 ⇒ 任何条目都会被
   * 判成「已编辑」，sidecar 永远导不进来（实测复现：capability 侧车被判脏、不改名）。
   * 判「用户是否编辑过」只需看一件事：**条目自己的 config 里有没有写路由段**。
   */
  hasExplicitEntryConfig?: boolean
  onError: (m: string) => void
}

export async function migrateSidecarIntoScope(d: MigrationDeps): Promise<MigrationOutcome> {
  if (!existsSync(d.sidecarFile)) return 'no-sidecar'
  // 故意不传 patchFallback：损坏 sidecar 必须得到 config===null 走 no-sidecar，
  // 绝不能把 patch 派生值导入用户层（patch 派生值只是 fallback 读取路径，非可导入的 sidecar 内容）。
  const store = new RouterSidecarStore({ file: d.sidecarFile, onError: d.onError })
  const loaded = store.load()
  if (loaded.config === null) return 'no-sidecar'   // 损坏已被 load 改名 .corrupt
  const dirty = d.hasExplicitEntryConfig === true
  if (dirty) {
    d.onError('dsh-kimi-tide: 插件配置的 router 段已被显式编辑，跳过 sidecar 迁移（保留 sidecar 未改名）；如需导入请先 /kimi-tide import-config')
    return 'skipped-dirty'
  }
  // 0.6.0：命名空间是 v5 存储——sidecar（v4 链路终态）导入即收敛 v5
  // （行为保持：presets/keywordGroups 逐字保留，预置流注册但不绑定）。
  await d.scope.replace(coerceRouterConfigV5(loaded.config, d.onError) as unknown as object)
  try { renameSync(d.sidecarFile, d.sidecarFile + '.legacy-imported') } catch (e) { d.onError(`dsh-kimi-tide: sidecar 留档失败（${(e as Error).message}）；配置已导入设置命名空间，旧 sidecar 文件请手动删除`) }
  return 'imported'
}
