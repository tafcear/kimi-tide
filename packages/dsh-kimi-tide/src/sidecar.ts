import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import YAML from 'yaml'
import { DEFAULT_CONFIG_V3, type RouterConfigV3 } from './config.js'
import { coerceRouterConfig, migrateV1 } from './migrate.js'

export interface SidecarOptions {
  file: string
  patchFallback?: () => unknown
  onError: (m: string) => void
}

export class RouterSidecarStore {
  constructor(private readonly o: SidecarOptions) {}

  load(): { config: RouterConfigV3 | null; source: 'sidecar' | 'patch' | 'none' } {
    if (!existsSync(this.o.file)) {
      const fb = this.fallback()
      // A patch fallback that yields nothing must not masquerade as a patch
      // source: probe the raw block first so the caller can tell 'patch' from
      // 'default' (observability, configSource).
      if (fb === null || this.probePatch() === null) return { config: fb, source: 'none' }
      return { config: fb, source: 'patch' }
    }
    try {
      const raw = YAML.parse(readFileSync(this.o.file, 'utf8')) as unknown
      const config = this.validate(raw)
      // v2→v3 写回迁移（spec §3.3）：旧文件留档 .pre-v3 后把迁移结果写回，
      // 使后续 load 走直通路径（幂等；settings 宿主随后整体导入并留档 .legacy-imported）。
      if ((raw as { version?: unknown })?.version === 2) {
        try { copyFileSync(this.o.file, this.o.file + '.pre-v3') } catch (error) {
          this.o.onError(`dsh-kimi-tide: sidecar .pre-v3 留档失败（${(error as Error).message}）`)
        }
        this.save(config)
      }
      return { config, source: 'sidecar' }
    } catch (error) {
      try { renameSync(this.o.file, this.o.file + '.corrupt') } catch { /* keep going */ }
      this.o.onError(`dsh-kimi-tide: sidecar 损坏，已保留 .corrupt 副本（${this.o.file}）：${(error as Error).message}；可用 /kimi-tide import-config 恢复`)
      const fb = this.fallback()
      return { config: fb, source: fb !== null && this.probePatch() !== null ? 'patch' : 'none' }
    }
  }

  /** Raw patch fallback payload, null when the callback is absent or has no block. */
  private probePatch(): unknown {
    if (this.o.patchFallback === undefined) return null
    try {
      const raw = this.o.patchFallback()
      return raw === null || raw === undefined ? null : raw
    } catch {
      return null
    }
  }

  private fallback(): RouterConfigV3 | null {
    if (this.o.patchFallback === undefined) return null
    return migrateV1(this.o.patchFallback(), this.o.onError)
  }

  save(config: RouterConfigV3): void {
    if (existsSync(this.o.file)) copyFileSync(this.o.file, this.o.file + '.bak')
    const tmp = this.o.file + `.tmp-${process.pid}`
    writeFileSync(tmp, YAML.stringify(config), 'utf8')
    renameSync(tmp, this.o.file)
  }

  exportText(): string { return readFileSync(this.o.file, 'utf8') }
  importFile(path: string): RouterConfigV3 {
    const cfg = this.validate(YAML.parse(readFileSync(path, 'utf8')) as unknown)
    this.save(cfg)
    return cfg
  }

  private validate(raw: unknown): RouterConfigV3 {
    const r = (raw ?? {}) as Record<string, unknown>
    if (r.version === 3 || r.version === 2) {
      // 损坏永不崩：半损坏 v2/v3 直通会导致 configKey(config.default) 抛 TypeError
      // 浅结构检查不合格即视为损坏：抛错由 load() 捕获 → .corrupt 保留 →
      // migrateV1(patchFallback)。结构合格则走 coerceRouterConfig 统一迁移
      // （v3 直通；v2 → migrateV2 改名）。
      const d = (r.default ?? {}) as Record<string, unknown>
      if (typeof d.provider !== 'string' || typeof d.model !== 'string') {
        throw new Error('sidecar 结构不合格：default.provider/default.model 缺失或非字符串')
      }
      if (!Array.isArray(r.candidates)) {
        throw new Error('sidecar 结构不合格：candidates 缺失或非数组')
      }
      return coerceRouterConfig(raw, this.o.onError)
    }
    return migrateV1(raw, this.o.onError)   // 旧形状 sidecar 也走迁移（收尾 v3）
  }
}
export { DEFAULT_CONFIG_V3 }
