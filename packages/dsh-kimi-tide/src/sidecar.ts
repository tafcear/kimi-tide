import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import YAML from 'yaml'
import { DEFAULT_CONFIG_V4, type RouterConfigV4 } from './config.js'
import { coerceRouterConfigV4 } from './migrate.js'

export interface SidecarOptions {
  file: string
  patchFallback?: () => unknown
  onError: (m: string) => void
}

export class RouterSidecarStore {
  constructor(private readonly o: SidecarOptions) {}

  load(): { config: RouterConfigV4 | null; source: 'sidecar' | 'patch' | 'none' } {
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
      // v2/v3→v4 写回迁移（spec §6.1）：旧文件留档 .pre-v4 后把迁移结果写回，
      // 使后续 load 走直通路径（幂等；settings 宿主随后整体导入并留档 .legacy-imported）。
      if ((raw as { version?: unknown })?.version !== 4) {
        try { copyFileSync(this.o.file, this.o.file + '.pre-v4') } catch (error) {
          this.o.onError(`dsh-kimi-tide: sidecar .pre-v4 留档失败（${(error as Error).message}）`)
        }
        try {
          this.save(config)
        } catch (error) {
          this.o.onError(`dsh-kimi-tide: sidecar v4 写回失败（${(error as Error).message}）；本次运行使用迁移结果，文件将在下次保存时落盘`)
        }
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

  private fallback(): RouterConfigV4 | null {
    if (this.o.patchFallback === undefined) return null
    return coerceRouterConfigV4(this.o.patchFallback(), this.o.onError)
  }

  save(config: RouterConfigV4): void {
    if (existsSync(this.o.file)) copyFileSync(this.o.file, this.o.file + '.bak')
    const tmp = this.o.file + `.tmp-${process.pid}`
    writeFileSync(tmp, YAML.stringify(config), 'utf8')
    renameSync(tmp, this.o.file)
  }

  exportText(): string { return readFileSync(this.o.file, 'utf8') }
  importFile(path: string): RouterConfigV4 {
    const cfg = this.validate(YAML.parse(readFileSync(path, 'utf8')) as unknown)
    this.save(cfg)
    return cfg
  }

  private validate(raw: unknown): RouterConfigV4 {
    const r = (raw ?? {}) as Record<string, unknown>
    if (r.version === 4) {
      // 损坏永不崩：半损坏 v4 直通会导致 configKey(preset.default) 抛 TypeError
      // 浅结构检查不合格即视为损坏：抛错由 load() 捕获 → .corrupt 保留 →
      // coerceRouterConfigV4(patchFallback)。结构合格则直通。
      const presets = r.presets
      if (typeof presets !== 'object' || presets === null || Array.isArray(presets)) {
        throw new Error('sidecar 结构不合格：presets 缺失或非对象')
      }
      if (r.activePreset !== null && typeof r.activePreset !== 'string') {
        throw new Error('sidecar 结构不合格：activePreset 非 string|null')
      }
      return raw as RouterConfigV4
    }
    if (r.version === 3 || r.version === 2) {
      // 损坏永不崩：半损坏 v2/v3 直通会导致 configKey(config.default) 抛 TypeError
      // 浅结构检查不合格即视为损坏：抛错由 load() 捕获 → .corrupt 保留 →
      // coerceRouterConfigV4(patchFallback)。结构合格则走 coerceRouterConfigV4 统一迁移
      // （v3 → migrateV3 语义映射；v2 → migrateV2 改名后 migrateV3）。
      const d = (r.default ?? {}) as Record<string, unknown>
      if (typeof d.provider !== 'string' || typeof d.model !== 'string') {
        throw new Error('sidecar 结构不合格：default.provider/default.model 缺失或非字符串')
      }
      if (!Array.isArray(r.candidates)) {
        throw new Error('sidecar 结构不合格：candidates 缺失或非数组')
      }
      return coerceRouterConfigV4(raw, this.o.onError)
    }
    return coerceRouterConfigV4(raw, this.o.onError)   // 旧形状 sidecar 也走迁移（收尾 v4）
  }
}
export { DEFAULT_CONFIG_V4 }
