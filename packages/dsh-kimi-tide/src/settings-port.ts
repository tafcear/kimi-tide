// src/settings-port.ts
/**
 * 设置端口（0.1.7 换道，2026-09-28）。
 *
 * 【为什么必须换】0.1.7 起「设置由当前 Profile 的插件配置保存」（上游 release notes
 * 原文），dsh-settings 不再提供「插件自命名命名空间」这条通道：
 *   - `SettingsForms` 只剩 describe/update/replace/mutate/configure，**没有 register**
 *     （宿主 `dsh-settings/lib/types/index.d.ts:62-117`）；
 *   - 表单里的 `ns` 恒等于 profile entry id（宿主 `dsh-settings/lib/index.js:432`
 *     `ns: entry.options.id`），且只吐「有运行时 `Config` 导出 + 至少一个
 *     `.volatile()` 字段」的条目（同文件 `:415-420` 的 `volatileForm` 闸）。
 *   ⇒ `kimi-tide-router` / `kimi-tide-catalog` 这两个旧命名空间在 0.1.7 无对应物。
 *
 * 【现在的形态】路由配置就是本插件那条 profile entry 的 `config.router`（由
 * index.ts 的 `export const Config` 声明形状、带 `.volatile()` 标记）：
 *   - **读**：`ctx.config.router.get()`——cordis 的 Volatile 快照，宿主已把
 *     「schema 默认 → 组合 base → 用户层」三层解析合并好，插件不再自行 merge；
 *   - **写**：`ctx.get('configEditor').edit(entry, () => next)`——插件侧唯一的官方
 *     自写路径（生产先例：宿主 `dsh-agent-default-model/lib/index.js:53-66`）；
 *     落盘位置仍是 profile patch（`~/.dsh/profiles/web/cordis.patch.yml`），
 *     但由 ConfigEditor 负责保注释/原子写/与 Loader 对账，插件不再自己拼 YAML；
 *   - **变更通知**：`loader/volatile-update`（宿主只发给 owning fiber，
 *     `cordis-plugin-loader/lib/types/index.d.ts:24-29`；官方用法
 *     `dsh-llm-deepseek/lib/index.js:2264-2275`）→ 重读快照喂 applyConfig。
 *
 * 【降级】宿主没有 configEditor 服务、或本条目拿不到 fiber（例如测试桩、
 * 旧宿主）时，`createSettingsPort()` 返回 null ⇒ 上层沿用 sidecar 文件存储
 * （0.4.x 以来既有路径，行为不变）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_CONFIG_V5, type RouterConfigV5 } from './config.js'
import type { SettingsNamespacePort } from './commands.js'

/** ConfigEditor 的最小结构面（避免把宿主服务的深类型带进插件公共面）。 */
interface ConfigEditorFace {
  edit(
    entry: unknown,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

/** cordis Volatile 的最小结构面：快照读取。 */
interface VolatileFace<T> {
  get(): T
}

/** 本插件的运行时 Config 结构面：router 为 volatile 快照，其余为普通字段。 */
interface PluginConfigFace {
  router?: VolatileFace<RouterConfigV5>
}

/**
 * 读本插件 Config 的结构面。
 *
 * ⚠ **不能走 `ctx.config`**：cordis 的 `config` 是 accessor，未在 `inject` 里声明就取会抛
 * `cannot get property "config" without inject`（干跑树实测，2026-09-28）。函数式插件
 * 的正道是 `apply(ctx, config)` 的第二个参数——它就是解析后的 Config，volatile 字段在
 * 其中是 `.get()` 快照（实测：`router` 的 ctor 为 Object 且带 get 方法）。
 * 故这里一律由调用方把 config 显式传进来，不做任何 ctx 侧读取。
 */
function asConfigFace(config: unknown): PluginConfigFace | undefined {
  return config !== null && typeof config === 'object' ? (config as PluginConfigFace) : undefined
}

/** 本插件那条 profile entry 的 id（= cordis.patch.yml 里 insert 行的 id）。 */
export const PLUGIN_ENTRY_ID = 'dsh-kimi-tide'

export interface SettingsPortDeps {
  ctx: Context
  /** `apply(ctx, config)` 的第二参（解析后的 Config；volatile 字段是 `.get()` 快照）。 */
  config: unknown
  /** 非 volatile 配置字段的当前值（usagePollMs / patchFile / sidecarFile …）。 */
  tunables: () => Record<string, unknown>
  onError: (message: string) => void
}

/**
 * 从本插件的 Config 取路由配置快照。宿主已完成三层合并；缺失（条目未配
 * router 段）时回落 v5 默认值，与旧「base = DEFAULT_CONFIG_V5()」语义一致。
 */
export function readRouterConfig(config: unknown): RouterConfigV5 {
  const face = asConfigFace(config)
  const volatile = face?.router
  if (volatile !== undefined && typeof volatile.get === 'function') {
    const value = volatile.get()
    return value ?? DEFAULT_CONFIG_V5()
  }
  // 兼容形态：0.1.7 之前的宿主把 Config 原样交给插件（普通对象，无 Volatile 包装）。
  // 两种形态都按「已解析的 v5 配置」读取，插件侧读取路径保持一致。
  const plain = (face as unknown as { router?: RouterConfigV5 } | undefined)?.router
  if (plain !== undefined && plain !== null) return plain
  return DEFAULT_CONFIG_V5()
}

/**
 * **原始**配置形状（未解析）：cordis 交给 `apply(ctx, config)` 的那一份。
 *
 * 用途（关键）：`readRouterConfig` 读的是 **schema 解析后**的快照——存量 v1 词汇
 * （mode/primary/premium）在解析期被 schema 的 `version` 默认值补成 `version: 5`，
 * 于是残留检测 `hasKimiTideResidueV5`（判据：`version !== 5`）**再也认不出**它，
 * 迁移链会被整体跳过（实测：`mode:'cost'` 的存量种子不再映射到 saving 预设）。
 * 故启动路径必须用原始值判残留。
 */
export function rawRouterConfig(config: unknown, entryConfig?: unknown): unknown {
  // 首选：Loader 条目里保存的**原始** config（宿主 `cordis-plugin-loader` 的
  // Entry.options.config 即 profile patch 里的原文，见 entry.d.ts）。这是唯一
  // 能分辨「条目有没有被显式配置过」的取证点——解析后的快照分辨不出来。
  if (entryConfig !== null && typeof entryConfig === 'object' && 'router' in entryConfig) {
    return (entryConfig as { router?: unknown }).router
  }
  if (config === null || typeof config !== 'object') return undefined
  const router = (config as { router?: unknown }).router
  // volatile 快照形态：取其快照（已是解析产物，但至少形状正确，供兜底比较）。
  if (router !== null && typeof router === 'object' && typeof (router as { get?: unknown }).get === 'function') {
    return (router as { get(): unknown }).get()
  }
  return router
}

/**
 * 「当前是否有生效的预设」——**唯一**的正确判据。
 *
 * 0.1.7 实测：宿主对「未配置 router 的条目」解析出的 `activePreset` 是 `undefined`
 * （不是 schema 声明的 `null`），而插件内部旧代码一律只判 `!== null` ⇒ 那种情况下
 * 会**带着非法预设去挂路由器**（`presets[undefined]`）。凡「开/关路由」的判定都走
 * 本函数，别各自写 `!== null`。
 */
export function hasActivePreset(config: { activePreset?: unknown }): boolean {
  return typeof config.activePreset === 'string' && config.activePreset.length > 0
}

/**
 * 条目是否带**旧词汇**（v1~v4）配置——即需要走 coerce 迁移链的存量形态。
 *
 * v1~v4 的判别标记：`mode` / `primary` / `premium` / `default`（v5 已无这些键）。
 * 无 version 但只有 v5 键（如 `{activePreset:'saving'}`）= 用户按 v5 语义写的，
 * 宿主解析即终态，不需要迁移。
 */
export function isLegacyRouterShape(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return false
  const config = raw as Record<string, unknown>
  const version = config.version
  if (typeof version === 'number') return version !== 5
  return 'mode' in config || 'primary' in config || 'premium' in config || 'default' in config
}

/**
 * 条目是否携带**用户显式写过的 v5 路由配置**（决定 sidecar 导入的脏检查）。
 *
 * 判据：显式 `version: 5`，或写了 `activePreset` / `presets`——两者都是「用户已经
 * 配好了，别拿旧 sidecar 覆盖」的信号。未配置（undefined）、旧词汇种子（v1~v4，
 * 由 isLegacyRouterShape 识别后另走迁移链）都判 false，允许导入。
 */
export function hasExplicitV5Config(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return false
  const config = raw as { version?: unknown; activePreset?: unknown; presets?: unknown }
  if (config.version === 5) return true
  if (config.activePreset !== undefined && config.activePreset !== null) return true
  return config.presets !== undefined && Object.keys(config.presets as object).length > 0
}

/**
 * 可写副本：Volatile 快照与 schema 解析产物都是**冻结**对象，而 ConfigEditor →
 * Loader 的再解析会原地写入（实测报 `Cannot assign to read only property`）。
 * 故写盘前一律结构化克隆，clone 结果可写。
 */
function writableCopy<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  return structuredClone(value)
}

/**
 * 建立设置端口；条件不满足（无 fiber.entry / 无 configEditor / 无 volatile
 * 路由字段）时返回 null，由调用方降级到 sidecar。
 */
export function createSettingsPort(deps: SettingsPortDeps): SettingsNamespacePort | null {
  const { ctx, config, tunables, onError } = deps
  const fiber = (ctx as unknown as { fiber?: { entry?: unknown } }).fiber
  const entry = fiber?.entry
  if (entry === undefined) {
    onError('dsh-kimi-tide: 本条目无 fiber.entry（非 Loader 挂载），设置通道不可用；沿用 sidecar 存储')
    return null
  }
  const editor = (ctx as unknown as { get?: (name: string) => unknown }).get?.('configEditor') as ConfigEditorFace | undefined
  if (editor === undefined || typeof editor.edit !== 'function') {
    onError('dsh-kimi-tide: 宿主无 configEditor 服务，设置通道不可用；沿用 sidecar 存储')
    return null
  }
  const routerVolatile = asConfigFace(config)?.router
  if (routerVolatile === undefined || typeof routerVolatile.get !== 'function') {
    // Config schema 未声明 volatile 路由字段 ⇒ 表单里看不到本条目，写回也无处落。
    onError('dsh-kimi-tide: Config 未声明 volatile 的 router 字段，设置通道不可用；沿用 sidecar 存储')
    return null
  }

  // ConfigEditor.edit 收「完整 raw config」——所有字段（含非 volatile 的 tunables）
  // 都要带上，漏掉的字段会被这次写覆盖掉。故以 tunables 快照为底、只替换 router。
  const write = (router: RouterConfigV5): Promise<void> => {
    const next: Record<string, unknown> = { ...tunables(), router: writableCopy(router) as unknown as Record<string, unknown> }
    return editor.edit(entry, () => next)
  }

  return {
    get: () => readRouterConfig(config),
    update: (patch) => write(deepMergeRouter(readRouterConfig(config), patch)),
    replace: (section) => write(section as RouterConfigV5),
    setCatalog: (section) => {
      const next: Record<string, unknown> = {
        ...tunables(),
        router: writableCopy(readRouterConfig(config)) as unknown as Record<string, unknown>,
        efforts: writableCopy(section.efforts),
        mounted: writableCopy(section.mounted),
      }
      return editor.edit(entry, () => next)
    },
  }
}

/**
 * 顶层浅合并（旧 `scope.update(patch)` 语义：dsh-settings 的 update 是「把补丁字段
 * 合并进当前配置」，不递归）。嵌套值整体替换——与旧行为逐字一致。
 */
function deepMergeRouter(current: RouterConfigV5, patch: object): RouterConfigV5 {
  return { ...(current as unknown as Record<string, unknown>), ...(patch as Record<string, unknown>) } as unknown as RouterConfigV5
}

/**
 * 订阅「volatile 配置已提交进运行实例」事件（无需重载）。宿主只把该事件发给
 * owning fiber，故本插件只会收到自己的配置变更。
 * @returns 注销函数。
 */
export function onRouterConfigChanged(ctx: Context, handler: () => void): () => void {
  // 事件声明来自 @deepseek-ai/cordis-plugin-loader 的模块增强，而本插件不直接依赖
  // 该包（只依赖运行时服务）⇒ 类型面上 Events 里没有这个键。运行时它就是普通
  // 事件名（宿主只发给 owning fiber），故在这里做一次显式收窄，收窄处写清理由。
  const on = ctx.on.bind(ctx) as unknown as (name: string, listener: (paths: readonly (readonly string[])[]) => void) => () => void
  return on('loader/volatile-update', () => { handler() })
}
