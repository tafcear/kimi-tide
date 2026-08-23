/**
 * kimi-tide: RouterSettingsStore — line-anchored read/write of the router
 * section inside the user's cordis.patch.yml. js-yaml round-trips would
 * destroy user comments, so writes operate on raw text: locate the
 * `- id: dsh-kimi-tide` row, then its `config:` block, then the `router:`
 * subtree, and splice only those lines. Writes are atomic (.tmp + rename)
 * with a .bak copy taken first.
 *
 * 【冻结声明 · 2026-08-23 评审裁定】本文件是 v1 legacy 路径的只读迁移器：
 * 生产面只有 load() 可达（index.ts 读 v1 种子喂迁移链）；save() 生产零调用
 * （命令层写 settings 命名空间或 sidecar，永不写 patch 文件——grep 可证），
 * 仅为存量测试保留。写入面就此冻结，不再投入。两个已知标量陷阱按评审裁定
 * 不修（v5 不住这条路径，触发即 schema 校验失败降级为 null，文件不会被
 * 读路径破坏）：
 *   1. parseSimpleYamlBlock 的 replace(/\s+#.*$/, '') 会把含 ' #' 的标量值
 *      截断（引号不感知）；
 *   2. renderEntry/flowMap 渲染字符串数组 [${arr.join(', ')}] 不加引号，
 *      元素含逗号/特殊字符即往返破损。
 */
import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import Schema from 'schemastery'
import type { RouteTarget } from './config.js'

/* ---- @legacy v1（0.2.x）配置形状：patch 文件 router 节读写的词汇。
 * 0.5.0 起该类型从 router.ts 迁至本文件本地（settings.ts 是 v1 词汇 patch
 * 静态块裸读器的 0.5.0 终态）。纯类型声明（编译期擦除，零运行时足迹）。 */
export interface RouterConfigV1 {
  /** off 关闭（默认，向后兼容）；cost 性价比；capability 能力最优。 */
  mode: 'off' | 'cost' | 'capability'
  /** 默认主力路由（便宜/快）。 */
  primary: RouteTarget
  /** Kimi 路由（贵/强）。 */
  premium: RouteTarget
  /** 超长上下文的 Kimi 路由（capability 模式可换 1M 窗模型）。 */
  premiumLong?: RouteTarget
  /** cost 模式升级条件（任一命中即升级，受预算约束）。 */
  escalateWhen?: {
    /** 用户显式 @kimi 指令。 */
    explicit?: boolean
    /** 估算 token 阈值。 */
    estimatedTokensGt?: number
    /** 关键词规则。 */
    patterns?: string[]
  }
  /** cost 模式 Kimi 调用占比上限（滑动窗口内，0-1）。 */
  premiumBudget?: number
  /** capability 模式规则表（顺序匹配，首个命中生效）。 */
  rules?: { match: MatchRule; route: RouteTarget }[]
  /** 估算 token 的字符折算比率（token ≈ chars / ratio）。 */
  charsPerToken?: number
  /** 预算滑动窗口大小（决策次数）。 */
  budgetWindow?: number
  /**
   * Providers that cannot accept image input. Defaults to the primary
   * provider only — the real capability matrix (pi-ai catalog, verified
   * 2026-08-18) is deepseek-v4-* text-only, Kimi k3 family multimodal.
   */
  textOnlyProviders?: string[]
}

export interface MatchRule {
  /** 正则关键词（对最新用户消息全文匹配）。 */
  patterns?: string[]
  /** 消息文本估算 token 数超过该值时命中（中英混合保守估算）。 */
  estimatedTokensGt?: number
}

/** Back-compat alias (0.2.x name) for the v1 router config shape. @legacy */
export type RouterConfig = RouterConfigV1

const ROW_ANCHOR = /^(\s*)- id: dsh-kimi-tide\s*$/

export const RouterConfigSchema = Schema.object({
  mode: Schema.union([Schema.const('off'), Schema.const('cost'), Schema.const('capability')]),
  primary: Schema.object({ provider: Schema.string(), model: Schema.string() }),
  premium: Schema.object({ provider: Schema.string(), model: Schema.string() }),
  premiumLong: Schema.object({ provider: Schema.string(), model: Schema.string() }),
  escalateWhen: Schema.object({
    explicit: Schema.boolean(),
    estimatedTokensGt: Schema.number(),
    patterns: Schema.array(Schema.string()),
  }),
  premiumBudget: Schema.number(),
  budgetWindow: Schema.number(),
  charsPerToken: Schema.number(),
  textOnlyProviders: Schema.array(Schema.string()),
  rules: Schema.array(Schema.object({
    match: Schema.object({
      patterns: Schema.array(Schema.string()),
      estimatedTokensGt: Schema.number(),
    }),
    route: Schema.object({ provider: Schema.string(), model: Schema.string() }),
  })),
}) as unknown as Schema<RouterConfig>

export interface RouterSettingsStoreOptions {
  /** Absolute path to the user's cordis.patch.yml. */
  patchFile: string
  onError: (message: string) => void
}

interface BlockSpan { start: number; end: number; indent: number }

export class RouterSettingsStore {
  constructor(private readonly options: RouterSettingsStoreOptions) {}

  /** Extract config.router from the dsh-kimi-tide row; null when absent/invalid. */
  load(): RouterConfig | null {
    let text: string
    try {
      text = readFileSync(this.options.patchFile, 'utf8')
    } catch (error) {
      this.options.onError(`dsh-kimi-tide: cannot read patch file ${this.options.patchFile}: ${(error as Error).message}`)
      return null
    }
    const lines = text.split('\n')
    const span = locateRouterBlock(lines)
    if (span === null) return null
    const raw = parseSimpleYamlBlock(lines.slice(span.start + 1, span.end))
    try {
      const validated = RouterConfigSchema(raw as unknown as RouterConfig) as RouterConfig
      // Strip keys injected by schemastery defaults that weren't in the file.
      // This preserves round-trip fidelity: save(x) → load() === x.
      const result: Record<string, unknown> = {}
      const validatedDict = validated as unknown as Record<string, unknown>
      for (const key of Object.keys(raw)) {
        if (key in validatedDict) result[key] = validatedDict[key]
      }
      return result as unknown as RouterConfig
    } catch (error) {
      this.options.onError(`dsh-kimi-tide: stored router config invalid, ignoring: ${(error as Error).message}`)
      return null
    }
  }

  /** Validate, then splice the router block into the patch file. */
  save(config: RouterConfig): void {
    // Validate (throws on invalid). Use original config for rendering to avoid
    // schemastery-injected defaults polluting the YAML round-trip.
    RouterConfigSchema(config)
    let text: string
    try {
      text = readFileSync(this.options.patchFile, 'utf8')
    } catch (error) {
      throw new Error(`dsh-kimi-tide: cannot read patch file ${this.options.patchFile}: ${(error as Error).message} — 请确认 dsh web profile 已生成（先运行一次 dsh web）`)
    }
    const lines = text.split('\n')
    const rendered = renderRouterBlock(config)
    const span = locateRouterBlock(lines)
    let next: string[]
    if (span !== null) {
      next = [
        ...lines.slice(0, span.start),
        ...rendered.map((l) => ' '.repeat(span.indent) + l),
        ...lines.slice(span.end),
      ]
    } else {
      const configBlock = locateConfigBlock(lines)
      if (configBlock !== null) {
        const childIndent = configBlock.indent + 2
        next = [
          ...lines.slice(0, configBlock.end),
          ...rendered.map((l) => ' '.repeat(childIndent) + l),
          ...lines.slice(configBlock.end),
        ]
      } else {
        // Bundle-installed plugin: the row lives in the bundle's own
        // cordis.patch.yml, not in the user patch file. The loader merges an
        // id-targeted override patch `{ id, config }` onto that row
        // (dsh-app-boot applyEntryPatches: overrides assign onto the matched
        // entry), so append one holding only the router subtree.
        while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) lines.pop()
        const overrideIndent = 2
        next = [
          ...lines,
          '',
          '# 月汐 dock panel writes here; the row itself is provided by the dsh-kimi-tide bundle.',
          '- id: dsh-kimi-tide',
          '  config:',
          ...rendered.map((l) => ' '.repeat(overrideIndent * 2) + l),
        ]
      }
    }
    copyFileSync(this.options.patchFile, this.options.patchFile + '.bak')
    const tmp = this.options.patchFile + `.tmp-${process.pid}`
    writeFileSync(tmp, next.join('\n'), 'utf8')
    renameSync(tmp, this.options.patchFile)
  }
}

/** Find the dsh-kimi-tide row's `config:` block (children span). */
function locateConfigBlock(lines: string[]): BlockSpan | null {
  for (let i = 0; i < lines.length; i++) {
    const row = ROW_ANCHOR.exec(lines[i])
    if (row === null) continue
    const rowIndent = row[1].length
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      if (line.trim().length === 0) continue
      const indent = line.length - line.trimStart().length
      if (indent <= rowIndent) return null
      const m = /^(\s*)config:\s*(?:#.*)?$/.exec(line)
      if (m !== null) {
        const configIndent = m[1].length
        let end = j + 1
        while (end < lines.length) {
          const l = lines[end]
          if (l.trim().length > 0 && l.length - l.trimStart().length <= configIndent) break
          end++
        }
        return { start: j + 1, end, indent: configIndent }
      }
    }
    return null
  }
  return null
}

/** Find the `router:` subtree lines inside the config block. */
function locateRouterBlock(lines: string[]): BlockSpan | null {
  const config = locateConfigBlock(lines)
  if (config === null) return null
  for (let i = config.start; i < config.end; i++) {
    const m = /^(\s*)router:\s*(?:#.*)?$/.exec(lines[i])
    if (m === null || m[1].length <= config.indent) continue
    const indent = m[1].length
    let end = i + 1
    while (end < config.end) {
      const line = lines[end]
      if (line.trim().length > 0 && !line.trimStart().startsWith('#')) {
        if (line.length - line.trimStart().length <= indent) break
      }
      end++
    }
    return { start: i, end, indent }
  }
  return null
}

/**
 * Minimal YAML-subset parser for the router block (nested maps via indent,
 * flow maps { a: b }, inline arrays [a, b], scalars). Deliberately not a
 * general YAML parser: unreadable shapes fail schemastery validation and
 * load() degrades to null — the file is never corrupted by the read path.
 */
function parseSimpleYamlBlock(lines: string[]): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  const stack: { indent: number; target: Record<string, unknown> }[] = [{ indent: -1, target: root }]
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, '')
    if (line.trim().length === 0) continue
    const indent = rawLine.length - rawLine.trimStart().length
    const m = /^\s*([\w]+):\s*(.*)$/.exec(line)
    if (m === null) continue
    const [, key, rest] = m
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const target = stack[stack.length - 1].target
    if (rest === '') {
      const child: Record<string, unknown> = {}
      target[key] = child
      stack.push({ indent, target: child })
    } else {
      target[key] = parseScalar(rest.trim())
    }
  }
  return root
}

function parseScalar(text: string): unknown {
  if (text === 'true') return true
  if (text === 'false') return false
  if (text.startsWith('{') && text.endsWith('}')) {
    const out: Record<string, unknown> = {}
    const inner = text.slice(1, -1).trim()
    if (inner !== '') {
      for (const pair of inner.split(',')) {
        const idx = pair.indexOf(':')
        if (idx > 0) out[pair.slice(0, idx).trim()] = parseScalar(pair.slice(idx + 1).trim())
      }
    }
    return out
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim()
    return inner === '' ? [] : inner.split(',').map((s) => parseScalar(s.trim()))
  }
  const n = Number(text)
  if (text !== '' && Number.isFinite(n)) return n
  return text.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')
}

/** Render a RouterConfig as block-style YAML lines (relative indent, router: first). */
function renderRouterBlock(config: RouterConfig): string[] {
  const lines: string[] = ['router:']
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue
    renderEntry(lines, key, value, 1)
  }
  return lines
}

function renderEntry(lines: string[], key: string, value: unknown, depth: number): void {
  const pad = '  '.repeat(depth)
  if (Array.isArray(value)) {
    if (value.length === 0) { lines.push(`${pad}${key}: []`); return }
    if (typeof value[0] === 'string') {
      lines.push(`${pad}${key}: [${(value as string[]).join(', ')}]`)
      return
    }
    // rules: array of { match, route } objects — render in flow style per line pair
    lines.push(`${pad}${key}:`)
    for (const item of value as Array<Record<string, unknown>>) {
      lines.push(`${pad}  - match: ${flowMap(item.match as Record<string, unknown>)}`)
      lines.push(`${pad}    route: ${flowMap(item.route as Record<string, unknown>)}`)
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    lines.push(`${pad}${key}:`)
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue
      renderEntry(lines, k, v, depth + 1)
    }
    return
  }
  lines.push(`${pad}${key}: ${formatScalar(value)}`)
}

function flowMap(obj: Record<string, unknown>): string {
  return `{ ${Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${(v as string[]).join(', ')}]` : formatScalar(v)}`)
    .join(', ')} }`
}

function formatScalar(value: unknown): string {
  if (typeof value === 'string') return /^[\w@./\-\u4e00-\u9fff]+$/.test(value) ? value : JSON.stringify(value)
  return String(value)
}
