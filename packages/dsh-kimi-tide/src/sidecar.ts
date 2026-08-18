import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import YAML from 'yaml'
import { DEFAULT_CONFIG_V2, type RouterConfigV2 } from './config.js'
import { migrateV1 } from './migrate.js'

export interface SidecarOptions {
  file: string
  patchFallback?: () => unknown
  onError: (m: string) => void
}

export class RouterSidecarStore {
  constructor(private readonly o: SidecarOptions) {}

  load(): { config: RouterConfigV2 | null; source: 'sidecar' | 'patch' | 'none' } {
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
      return { config: this.validate(raw), source: 'sidecar' }
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

  private fallback(): RouterConfigV2 | null {
    if (this.o.patchFallback === undefined) return null
    return migrateV1(this.o.patchFallback(), this.o.onError)
  }

  save(config: RouterConfigV2): void {
    if (existsSync(this.o.file)) copyFileSync(this.o.file, this.o.file + '.bak')
    const tmp = this.o.file + `.tmp-${process.pid}`
    writeFileSync(tmp, YAML.stringify(config), 'utf8')
    renameSync(tmp, this.o.file)
  }

  exportText(): string { return readFileSync(this.o.file, 'utf8') }
  importFile(path: string): RouterConfigV2 {
    const cfg = this.validate(YAML.parse(readFileSync(path, 'utf8')) as unknown)
    this.save(cfg)
    return cfg
  }

  private validate(raw: unknown): RouterConfigV2 {
    const r = (raw ?? {}) as Record<string, unknown>
    if (r.version === 2) return raw as RouterConfigV2
    return migrateV1(raw, this.o.onError)   // 旧形状 sidecar 也走迁移
  }
}
export { DEFAULT_CONFIG_V2 }
