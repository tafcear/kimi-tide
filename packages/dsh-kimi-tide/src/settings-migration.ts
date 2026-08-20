// src/settings-migration.ts
import { existsSync, renameSync } from 'node:fs'
import { deepEqualJson } from '@deepseek-ai/dsh-settings'
import type { RouterConfigV4 } from './config.js'
import { mergeResolved } from './settings-schema.js'
import { RouterSidecarStore } from './sidecar.js'

export interface MigrationScope { get(): RouterConfigV4; replace(section: object): Promise<void> }
export type MigrationOutcome = 'imported' | 'skipped-clean' | 'skipped-dirty' | 'no-sidecar'

export interface MigrationDeps {
  sidecarFile: string
  scope: MigrationScope
  entry: unknown                    // patch.yml router 块（composition entry）
  onError: (m: string) => void
}

export async function migrateSidecarIntoScope(d: MigrationDeps): Promise<MigrationOutcome> {
  if (!existsSync(d.sidecarFile)) return 'no-sidecar'
  // 故意不传 patchFallback：损坏 sidecar 必须得到 config===null 走 no-sidecar，
  // 绝不能把 patch 派生值导入用户层（patch 派生值只是 fallback 读取路径，非可导入的 sidecar 内容）。
  const store = new RouterSidecarStore({ file: d.sidecarFile, onError: d.onError })
  const loaded = store.load()
  if (loaded.config === null) return 'no-sidecar'   // 损坏已被 load 改名 .corrupt
  const clean = deepEqualJson(d.scope.get(), mergeResolved(d.entry))
  if (!clean) {
    d.onError('dsh-kimi-tide: 设置命名空间已有用户编辑，跳过 sidecar 迁移（保留 sidecar 未改名）；如需导入请先 /kimi-tide import-config')
    return 'skipped-dirty'
  }
  await d.scope.replace(loaded.config as unknown as object)
  try { renameSync(d.sidecarFile, d.sidecarFile + '.legacy-imported') } catch (e) { d.onError(`dsh-kimi-tide: sidecar 留档失败（${(e as Error).message}）；配置已导入设置命名空间，旧 sidecar 文件请手动删除`) }
  return 'imported'
}
