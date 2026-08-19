// src/settings-migration.ts
import { existsSync, renameSync } from 'node:fs'
import { deepEqualJson } from '@deepseek-ai/dsh-settings'
import type { RouterConfigV2 } from './config.js'
import { mergeResolved } from './settings-schema.js'
import { RouterSidecarStore } from './sidecar.js'

export interface MigrationScope { get(): RouterConfigV2; replace(section: object): Promise<void> }
export type MigrationOutcome = 'imported' | 'skipped-clean' | 'skipped-dirty' | 'no-sidecar'

export interface MigrationDeps {
  sidecarFile: string
  scope: MigrationScope
  entry: unknown                    // patch.yml router 块（composition entry）
  providerName: string
  onError: (m: string) => void
}

export async function migrateSidecarIntoScope(d: MigrationDeps): Promise<MigrationOutcome> {
  if (!existsSync(d.sidecarFile)) return 'no-sidecar'
  const store = new RouterSidecarStore({ file: d.sidecarFile, onError: d.onError })
  const loaded = store.load()
  if (loaded.config === null) return 'no-sidecar'   // 损坏已被 load 改名 .corrupt
  const clean = deepEqualJson(d.scope.get(), mergeResolved(d.entry, d.providerName))
  if (!clean) {
    d.onError('dsh-kimi-tide: 设置命名空间已有用户编辑，跳过 sidecar 迁移（保留 sidecar 未改名）；如需导入请先 /kimi-tide import-config')
    return 'skipped-dirty'
  }
  await d.scope.replace(loaded.config as unknown as object)
  try { renameSync(d.sidecarFile, d.sidecarFile + '.legacy-imported') } catch { /* 留档失败不阻塞 */ }
  return 'imported'
}
