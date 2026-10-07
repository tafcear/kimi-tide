import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { applyKimiTideCommand, parseKimiTideCommand, type KimiTideCommandDeps, type SettingsNamespacePort } from '../src/commands.js'
import { describeRouting } from '../src/routing-view.js'
import { DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, DEFAULT_CONFIG_V6, type RouterConfigV4, type RouterConfigV5, type RouterConfigV6 } from '../src/config.js'
import { migrateV6 } from '../src/migrate.js'
import type { RouterConfigAny } from '../src/router.js'
import { RouterSidecarStore } from '../src/sidecar.js'
import type { UsageMonitor } from '../src/usage.js'

const dir = mkdtempSync(join(tmpdir(), 'kt-commands-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function v4cfg(activePreset: string | null): RouterConfigV4 {
  return { ...DEFAULT_CONFIG_V4(), activePreset }
}

function v5cfg(activePreset: string | null): RouterConfigV5 {
  return { ...DEFAULT_CONFIG_V5(), activePreset }
}

function makeDeps(
  config: RouterConfigAny = v4cfg(null),
  onSaved?: (c: RouterConfigAny) => void,
  opts: { file?: string; settings?: SettingsNamespacePort | null } = {},
): KimiTideCommandDeps {
  let current = config
  const file = opts.file ?? join(dir, `sidecar-${Math.random().toString(36).slice(2)}.yml`)
  const sidecar = new RouterSidecarStore({ file, onError: () => {} })
  return {
    sidecar,
    settings: opts.settings ?? null,
    monitor: { refresh: vi.fn(async () => {}) } as unknown as UsageMonitor,
    current: () => current,
    onSaved: (next: RouterConfigAny) => {
      onSaved?.(next)
      current = next
    },
  }
}

describe('parseKimiTideCommand', () => {
  it('parses preset subcommand (off → null)', () => {
    expect(parseKimiTideCommand('preset saving')).toEqual({ kind: 'preset', preset: 'saving' })
    expect(parseKimiTideCommand('preset off')).toEqual({ kind: 'preset', preset: null })
  })
  it('rejects preset without an id', () => {
    expect(parseKimiTideCommand('preset').kind).toBe('error')
  })
  it('mode subcommand is retired → error pointing at preset', () => {
    const cmd = parseKimiTideCommand('mode cost')
    expect(cmd.kind).toBe('error')
    if (cmd.kind !== 'error') return
    expect(cmd.message).toContain('preset')
  })
  it('parses set activePreset', () => {
    expect(parseKimiTideCommand('set activePreset saving')).toEqual({ kind: 'set', key: 'activePreset', value: 'saving' })
    expect(parseKimiTideCommand('set activePreset off')).toEqual({ kind: 'set', key: 'activePreset', value: 'off' })
  })
  it('rejects unknown settable keys and reports the activePreset table', () => {
    const cmd = parseKimiTideCommand('set lambda 0.3')
    expect(cmd.kind).toBe('error')
    if (cmd.kind !== 'error') return
    expect(cmd.message).toMatch(/unknown/)
    expect(cmd.message).toContain('activePreset')
  })
  it('parses show', () => {
    expect(parseKimiTideCommand('show')).toEqual({ kind: 'show' })
  })
  it('parses panel / panel --json（同一载荷，dock 取数通道）', () => {
    expect(parseKimiTideCommand('panel')).toEqual({ kind: 'panel' })
    expect(parseKimiTideCommand('panel --json')).toEqual({ kind: 'panel' })
  })
  it('parses refresh and empty/help', () => {
    expect(parseKimiTideCommand('refresh')).toEqual({ kind: 'refresh' })
    expect(parseKimiTideCommand('')).toEqual({ kind: 'help' })
    expect(parseKimiTideCommand('help')).toEqual({ kind: 'help' })
  })
  it('parses export-config and import-config', () => {
    expect(parseKimiTideCommand('export-config')).toEqual({ kind: 'export-config' })
    expect(parseKimiTideCommand('import-config C:/tmp/cfg.yml')).toEqual({ kind: 'import-config', path: 'C:/tmp/cfg.yml' })
  })
  it('parse: import-config keeps the full inline YAML (newlines/indent intact)', () => {
    const text = 'version: 4\nactivePreset: saving'
    const cmd = parseKimiTideCommand(`import-config ${text}`)
    expect(cmd).toEqual({ kind: 'import-config', path: text })
  })
  it('errors on unknown subcommand', () => {
    expect(parseKimiTideCommand('frobnicate').kind).toBe('error')
  })
})

describe('applyKimiTideCommand', () => {
  it('/kimi-tide preset saving → activePreset=saving 持久化', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const out = await applyKimiTideCommand(parseKimiTideCommand('preset saving'), deps)
    expect(saved[0].activePreset).toBe('saving')
    expect(out).toContain('saving')
  })

  it('/kimi-tide preset off → activePreset=null', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg('saving'), (c) => saved.push(c))
    const out = await applyKimiTideCommand(parseKimiTideCommand('preset off'), deps)
    expect(saved[0].activePreset).toBeNull()
    expect(out).toContain('off')
  })

  it('/kimi-tide preset ghost → error 且不落盘', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const out = await applyKimiTideCommand(parseKimiTideCommand('preset ghost'), deps)
    expect(out).toContain('不存在')
    expect(saved).toHaveLength(0)
  })

  /**
   * 1.2.0 会话事件解耦：面板数据不再写会话日志，改由本命令按需供给 dock。
   * 契约 = 返回 `KimiTidePanelProjection` 的 JSON 文本；取数不可用（缺 agent /
   * 未接线 / 快照空）一律抛错——命令层把它收敛成 error 结果，dock 据此回退，
   * 绝不拿一份无主数据冒充某会话的面板。
   */
  it('/kimi-tide panel --json → 返回该 agent 的面板快照 JSON（可被 schema 解析）', async () => {
    const snapshot = { router: { activePreset: 'saving' }, kimi: { route: true, key: true } }
    const deps = { ...makeDeps(v4cfg('saving')), panel: () => snapshot }
    const agent = { id: 'agent-1' }
    const out = await applyKimiTideCommand(parseKimiTideCommand('panel --json'), deps, agent as never)
    expect(JSON.parse(out)).toEqual(snapshot)
  })

  it('/kimi-tide panel → 缺 agent 时拒绝（不返回无主面板）', async () => {
    const deps = { ...makeDeps(v4cfg('saving')), panel: () => ({ router: {} }) }
    await expect(applyKimiTideCommand(parseKimiTideCommand('panel'), deps)).rejects.toThrow(/缺 agent|未接线/)
  })

  it('/kimi-tide panel → 未接线（旧宿主/单测直呼）时拒绝', async () => {
    const deps = makeDeps(v4cfg('saving'))
    const agent = { id: 'agent-1' }
    await expect(applyKimiTideCommand(parseKimiTideCommand('panel'), deps, agent as never)).rejects.toThrow(/未接线/)
  })

  it('/kimi-tide panel → 快照为空时拒绝（路由关闭且无数据）', async () => {
    const deps = { ...makeDeps(v4cfg('saving')), panel: () => null }
    const agent = { id: 'agent-1' }
    await expect(applyKimiTideCommand(parseKimiTideCommand('panel'), deps, agent as never)).rejects.toThrow(/快照不可用/)
  })

  it('/kimi-tide show → 输出当前预设/默认/规则数', async () => {
    const deps = makeDeps(v4cfg('saving'))
    const out = await applyKimiTideCommand(parseKimiTideCommand('show'), deps)
    expect(out).toContain('省钱')
    expect(out).toContain('deepseek-v4-flash')
    // 0.8.0：saving 规则 3 条（+translate）、关键词组 7 个
    expect(out).toContain('规则 3 条')
    expect(out).toContain('关键词组 7 个')
  })

  it('/kimi-tide show → 摘要行走 describeRouting 单源（复核⑤ M5：不再自拼文案）', async () => {
    // 跨模块判据：show 输出必须包含 describeRouting(当前配置) 的逐字输出——
    // 若 show 回退到自拼摘要、或 describeRouting 改措辞而 show 未跟随，本测试变红。
    const cfg: RouterConfigV6 = {
      ...DEFAULT_CONFIG_V6(),
      activePreset: 'saving',
      roles: { frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'k3' } } },
    }
    const deps = makeDeps(cfg)
    const out = await applyKimiTideCommand(parseKimiTideCommand('show'), deps)
    expect(out).toContain(describeRouting(cfg))
  })

  it('/kimi-tide show（v5）→ 补 flows 注册表段与每预设 imageFallback 行（0.6.0）', async () => {
    const deps = makeDeps(v5cfg('saving'))
    const out = await applyKimiTideCommand(parseKimiTideCommand('show'), deps)
    expect(out).toContain('省钱')
    // flows 注册表段：id + 类型 + 关键参数（预置流注册但不绑定）
    expect(out).toContain('flows:')
    expect(out).toContain('transcribe')
    expect(out).toContain('deepseek-v4-flash-vision-exp')
    expect(out).toContain('latch-image')
    expect(out).toContain('review')
    // 每预设 imageFallback 行（缺省 = latch，维持 0.5.x 行为）
    expect(out).toContain('imageFallback:')
    expect(out).toContain('saving=latch')
    expect(out).toContain('capability=latch')
  })

  it('/kimi-tide show（v5）→ transcribe-lazy 级联显示目标流（缺省解析预置 transcribe）', async () => {
    const cfg = v5cfg('saving')
    cfg.presets.saving.imageFallback = 'transcribe-lazy'
    cfg.presets.capability.imageFallback = 'blind'
    const deps = makeDeps(cfg)
    const out = await applyKimiTideCommand(parseKimiTideCommand('show'), deps)
    expect(out).toContain('saving=transcribe-lazy→transcribe')
    expect(out).toContain('capability=blind')
  })

  it('/kimi-tide mode … 子命令已退役 → error 提示 preset', async () => {
    const deps = makeDeps(v4cfg(null))
    expect(await applyKimiTideCommand(parseKimiTideCommand('mode cost'), deps)).toContain('preset')
  })

  it('set activePreset saving persists (off → null)', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const out = await applyKimiTideCommand(parseKimiTideCommand('set activePreset saving'), deps)
    expect(saved[0].activePreset).toBe('saving')
    expect(out).toContain('saved')

    const off = await applyKimiTideCommand(parseKimiTideCommand('set activePreset off'), deps)
    expect(saved[1].activePreset).toBeNull()
    expect(off).toContain('saved')
  })

  it('set activePreset ghost → error 且不落盘', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const out = await applyKimiTideCommand(parseKimiTideCommand('set activePreset ghost'), deps)
    expect(out).toContain('不存在')
    expect(saved).toHaveLength(0)
  })

  it('export-config: returns the sidecar YAML text, parseable back to RouterConfigV4', async () => {
    const deps = makeDeps(v4cfg('saving'))
    deps.sidecar.save(v4cfg('saving'))
    const text = await applyKimiTideCommand({ kind: 'export-config' }, deps)
    const parsed = YAML.parse(text) as RouterConfigV4
    expect(parsed.version).toBe(4)
    expect(parsed.activePreset).toBe('saving')
    expect(parsed.presets.saving.default.model).toBe('deepseek-v4-flash')
  })

  it('export-config: explains when no sidecar file exists yet', async () => {
    const deps = makeDeps(v4cfg(null))
    const reply = await applyKimiTideCommand({ kind: 'export-config' }, deps)
    expect(reply).toMatch(/不可读|不存在|尚未|not found/)
  })

  it('import-config: 文件形态走 v4 结构校验并直通', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const incoming = v4cfg('capability')
    const src = join(dir, 'import-src.yml')
    writeFileSync(src, YAML.stringify(incoming), 'utf8')
    const reply = await applyKimiTideCommand({ kind: 'import-config', path: src }, deps)
    expect(reply).toMatch(/import/i)
    expect(saved[0].activePreset).toBe('capability')
    expect(deps.current().activePreset).toBe('capability')
    expect(deps.sidecar.load().config!.activePreset).toBe('capability')
  })

  it('import-config: v4 文件结构不合格（presets 非对象）报错', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const src = join(dir, 'import-bad.yml')
    writeFileSync(src, 'version: 4\npresets: [1, 2]\n', 'utf8')
    const reply = await applyKimiTideCommand({ kind: 'import-config', path: src }, deps)
    expect(reply).toMatch(/import failed|失败/)
    expect(saved).toHaveLength(0)
  })

  it('import-config: 内联 YAML 合并 version 置 4', async () => {
    const saved: RouterConfigV4[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const text = 'activePreset: saving'
    const reply = await applyKimiTideCommand({ kind: 'import-config', path: text }, deps)
    expect(reply).toMatch(/import/i)
    expect(saved[0].version).toBe(4)
    expect(saved[0].activePreset).toBe('saving')
    expect(deps.current().version).toBe(4)
  })

  it('import-config: v5 当前配置的内联合并保持 version 5（0.6.0）', async () => {
    const saved: RouterConfigAny[] = []
    const deps = makeDeps(v5cfg(null), (c) => saved.push(c), {
      settings: { get: () => v5cfg(null), update: async () => {}, replace: async () => {} },
    })
    const reply = await applyKimiTideCommand({ kind: 'import-config', path: 'activePreset: saving' }, deps)
    expect(reply).toMatch(/import/i)
    expect(saved[0].version).toBe(5)
    expect(saved[0].activePreset).toBe('saving')
    expect((saved[0] as RouterConfigV5).flows.transcribe).toBeDefined()
  })

  it('import-config: v5 文件导入命名空间（flows/imageFallback 字段存活，收敛 v6）', async () => {
    const replaces: object[] = []
    const deps = makeDeps(v5cfg(null), undefined, {
      settings: { get: () => v5cfg(null), update: async () => {}, replace: async (s) => { replaces.push(s) } },
    })
    const incoming = v5cfg('capability')
    incoming.presets.capability.imageFallback = 'transcribe-lazy'
    const src = join(dir, 'import-v5-ns.yml')
    writeFileSync(src, YAML.stringify(incoming), 'utf8')
    const out = await applyKimiTideCommand({ kind: 'import-config', path: src }, deps)
    expect(out).toMatch(/import/i)
    expect(replaces).toHaveLength(1)
    const written = replaces[0] as RouterConfigV5
    expect(written.version).toBe(6)
    expect(written.activePreset).toBe('capability')
    expect(written.flows.transcribe.visionModel.model).toBe('deepseek-v4-flash-vision-exp')
    expect(written.presets.capability.imageFallback).toBe('transcribe-lazy')
  })

  it('import-config: v5 文件导入 sidecar 兜底宿主 → 明确拒绝（v4-only 存储不静默损毁）', async () => {
    const saved: RouterConfigAny[] = []
    const deps = makeDeps(v4cfg(null), (c) => saved.push(c))
    const src = join(dir, 'import-v5-sidecar.yml')
    writeFileSync(src, YAML.stringify(v5cfg('capability')), 'utf8')
    const reply = await applyKimiTideCommand({ kind: 'import-config', path: src }, deps)
    expect(reply).toMatch(/import failed|失败/)
    expect(reply).toContain('v5')
    expect(saved).toHaveLength(0)
  })

  it('refresh: triggers monitor.refresh and replies', async () => {
    const deps = makeDeps(v4cfg(null))
    const reply = await applyKimiTideCommand({ kind: 'refresh' }, deps)
    expect(deps.monitor.refresh).toHaveBeenCalledOnce()
    expect(reply).toMatch(/refresh/i)
  })

  it('surfaces sidecar save errors as a reply, not a throw', async () => {
    const deps = makeDeps(v4cfg(null))
    deps.sidecar.save = vi.fn(() => { throw new Error('schema rejected') }) as RouterSidecarStore['save']
    const reply = await applyKimiTideCommand(parseKimiTideCommand('preset saving'), deps)
    expect(reply).toContain('schema rejected')
  })
})

describe('applyKimiTideCommand with settings namespace', () => {
  it('preset writes through scope.update, not the sidecar', async () => {
    const writes: object[] = []
    const deps = makeDeps(v4cfg(null), undefined, {
      settings: {
        get: () => v4cfg(null),
        update: async (p) => { writes.push(p) },
        replace: async () => {},
      },
    })
    const saveSpy = vi.fn()
    deps.sidecar.save = saveSpy as RouterSidecarStore['save']
    const out = await applyKimiTideCommand(parseKimiTideCommand('preset capability'), deps)
    expect(writes).toEqual([{ ...v4cfg(null), activePreset: 'capability' }])
    expect(saveSpy).not.toHaveBeenCalled()
    expect(out).toContain('saved')
  })

  it('export-config prints the resolved namespace value as YAML', async () => {
    const deps = makeDeps(v4cfg(null), undefined, {
      settings: {
        get: () => v4cfg('saving'),
        update: async () => {},
        replace: async () => {},
      },
    })
    const out = await applyKimiTideCommand({ kind: 'export-config' }, deps)
    expect(out).toContain('activePreset: saving')
  })

  it('import-config (file) replaces the namespace section', async () => {
    const replaces: object[] = []
    const deps = makeDeps(v4cfg(null), undefined, {
      settings: {
        get: () => v4cfg(null),
        update: async () => {},
        replace: async (s) => { replaces.push(s) },
      },
    })
    const incoming = v4cfg('capability')
    const src = join(dir, 'import-src-ns.yml')
    writeFileSync(src, YAML.stringify(incoming), 'utf8')
    const out = await applyKimiTideCommand({ kind: 'import-config', path: src }, deps)
    // v6（团队派发）：写入命名空间一律收敛为 v6（presets/activePreset 逐字保持，存量行为保持）
    expect(replaces).toHaveLength(1)
    const written = replaces[0] as RouterConfigV5
    expect(written.version).toBe(6)
    expect(written.activePreset).toBe('capability')
    expect(written.presets).toEqual(incoming.presets)
    expect(written.flows.transcribe).toBeDefined()
    expect(out).toMatch(/import/i)
  })

  it('falls back to sidecar when settings is null', async () => {
    const deps = makeDeps(v4cfg(null))
    const saveSpy = vi.fn()
    deps.sidecar.save = saveSpy as RouterSidecarStore['save']
    const out = await applyKimiTideCommand(parseKimiTideCommand('preset saving'), deps)
    expect(saveSpy).toHaveBeenCalled()
    expect(out).toContain('saved')
  })
})

/**
 * 终审 I3/F5（修复波）：import-config 文件形态经 migrateV5 不得再丢 v5 文档上
 * 已存在的分工层字段（export→import 往返保住分工表）；文件与内联两条路径
 * 落盘前跑分工表拒写校验（认领冲突 / role 目标不完整 ⇒ 明确报错且不落盘，
 * 与设置卡 saveRoles 的守卫式拒写同款语义）。
 */
describe('applyKimiTideCommand import-config 分工层（终审 I3/F5 修复波）', () => {
  const nsDeps = (current: RouterConfigAny, replaces: object[]): KimiTideCommandDeps =>
    makeDeps(current, undefined, {
      settings: { get: () => current, update: async () => {}, replace: async (s) => { replaces.push(s) } },
    })

  it('文件形态：v5 文件携带分工层字段 ⇒ 收敛 v6 时透传（往返不丢分工表）', async () => {
    const replaces: object[] = []
    const deps = nsDeps(v5cfg(null), replaces)
    const incoming = v5cfg('saving') as RouterConfigV5 & Partial<RouterConfigV6>
    incoming.roles = {
      frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'kimi-for-coding' }, teammate: ['fe'] },
    }
    incoming.driver = { provider: 'kimi-coding', model: 'k3' }
    incoming.driverSticky = true
    const src = join(dir, 'import-v5-team.yml')
    writeFileSync(src, YAML.stringify(incoming), 'utf8')
    const out = await applyKimiTideCommand({ kind: 'import-config', path: src }, deps)
    expect(out).toMatch(/import/i)
    expect(replaces).toHaveLength(1)
    const written = replaces[0] as RouterConfigV6
    expect(written.version).toBe(6)
    // Fails if: migrateV5 逐字段重建——roles 被重置 {}、driver/driverSticky 蒸发
    expect(written.roles).toEqual(incoming.roles)
    expect(written.driver).toEqual(incoming.driver)
    expect(written.driverSticky).toBe(true)
  })

  it('文件形态：分工表认领冲突 ⇒ 明确报错且不落盘', async () => {
    const replaces: object[] = []
    const deps = nsDeps(v5cfg(null), replaces)
    const incoming = v5cfg('saving') as RouterConfigV5 & Partial<RouterConfigV6>
    incoming.roles = {
      a: { id: 'a', label: 'A', target: { provider: 'p', model: 'm' }, teammate: ['x'] },
      b: { id: 'b', label: 'B', target: { provider: 'p', model: 'm' }, teammate: ['x'] },
    }
    const src = join(dir, 'import-v5-conflict.yml')
    writeFileSync(src, YAML.stringify(incoming), 'utf8')
    const out = await applyKimiTideCommand({ kind: 'import-config', path: src }, deps)
    // Fails if: 只做结构校验——冲突分工表落盘（lookupRoleByTeammate 首名命中 ⇒ 静默换人）
    expect(out).toMatch(/import failed/)
    expect(out).toContain('认领名')
    expect(replaces).toHaveLength(0)
  })

  it('内联形态：分工表认领冲突 ⇒ 明确报错且不落盘', async () => {
    const replaces: object[] = []
    const deps = nsDeps({ ...DEFAULT_CONFIG_V6() }, replaces)
    const text = [
      'roles:',
      '  a: { id: a, label: A, target: { provider: p, model: m }, teammate: [x] }',
      '  b: { id: b, label: B, target: { provider: p, model: m }, teammate: [x] }',
    ].join('\n')
    const out = await applyKimiTideCommand({ kind: 'import-config', path: text }, deps)
    // Fails if: 内联合并路径不接拒写校验（与文件形态两标准）
    expect(out).toMatch(/import failed/)
    expect(out).toContain('认领名')
    expect(replaces).toHaveLength(0)
  })

  it('内联形态：role 目标不完整（provider 空串）⇒ 明确报错且不落盘', async () => {
    const replaces: object[] = []
    const deps = nsDeps({ ...DEFAULT_CONFIG_V6() }, replaces)
    const text = [
      'roles:',
      '  frontend: { id: frontend, label: 前端, target: { provider: "", model: m } }',
    ].join('\n')
    const out = await applyKimiTideCommand({ kind: 'import-config', path: text }, deps)
    // Fails if: 完整性校验缺席——空目标分工表落盘，运行期改道到空 provider
    expect(out).toMatch(/import failed/)
    expect(out).toContain('target.provider')
    expect(replaces).toHaveLength(0)
  })
})

/**
 * C2 配置面 v7（设计稿 2026-10-07 §6.2）：export-config / import-config 往返
 * 不得丢 routes（10-06「migrateV5 逐字段重建丢分工表」回归钉扩到 v7）。
 */
describe('applyKimiTideCommand import/export × routes v7（C2）', () => {
  const v7cfg = (): RouterConfigV6 & { version: number; routes: unknown[] } => {
    const base = migrateV6(DEFAULT_CONFIG_V6())
    return JSON.parse(JSON.stringify(base)) as never
  }
  const nsDeps = (current: RouterConfigAny, replaces: object[]): KimiTideCommandDeps =>
    makeDeps(current, undefined, {
      settings: { get: () => current, update: async () => {}, replace: async (s) => { replaces.push(s) } },
    })

  it('export-config（v7 当前配置）→ 内联 import-config ⇒ version 7 与 routes 全字段往返不丢', async () => {
    const cfg = v7cfg()
    const text = await applyKimiTideCommand({ kind: 'export-config' }, nsDeps(cfg, []))
    const replaces: object[] = []
    const out = await applyKimiTideCommand({ kind: 'import-config', path: text }, nsDeps(cfg, replaces))
    // Fails if: 内联合并丢 routes / version 被压回
    expect(out).toMatch(/import/i)
    expect(replaces).toHaveLength(1)
    const written = replaces[0] as typeof cfg
    expect(written.version).toBe(7)
    expect(written.routes).toEqual(cfg.routes)
    expect(written.roles).toEqual(cfg.roles)
    expect(written.presets).toEqual(cfg.presets)
  })

  it('文件形态：v7 文件导入命名空间 ⇒ 直通保住 version 7 与 routes（不被 v6 迁移链兜底摧毁）', async () => {
    const cfg = v7cfg()
    const src = join(dir, 'import-v7-routes.yml')
    writeFileSync(src, YAML.stringify(cfg), 'utf8')
    const replaces: object[] = []
    const out = await applyKimiTideCommand({ kind: 'import-config', path: src }, nsDeps(DEFAULT_CONFIG_V6(), replaces))
    // Fails if: v7 文件落进 coerceRouterConfigV6 的 v1 兜底链——routes/roles 全灭（10-06 事故同型）
    expect(out).toMatch(/import/i)
    expect(replaces).toHaveLength(1)
    const written = replaces[0] as typeof cfg
    expect(written.version).toBe(7)
    expect(written.routes).toEqual(cfg.routes)
    expect(written.roles).toEqual(cfg.roles)
  })

  it('文件形态：v7 文件 routes 与旧字段冲突 ⇒ 拒写不落盘', async () => {
    const cfg = v7cfg()
    // 摸黑改一条 session 行目标，制造 routes × presets[*].rules 冲突
    cfg.routes = cfg.routes.map((r) =>
      (r as { id?: string; preset?: string }).id === 'code-kfc' && (r as { preset?: string }).preset === 'capability'
        ? { ...(r as object), target: { provider: 'zai-coding-cn', model: 'glm-5.3' } }
        : r)
    const src = join(dir, 'import-v7-conflict.yml')
    writeFileSync(src, YAML.stringify(cfg), 'utf8')
    const replaces: object[] = []
    const out = await applyKimiTideCommand({ kind: 'import-config', path: src }, nsDeps(DEFAULT_CONFIG_V6(), replaces))
    expect(out).toMatch(/import failed/)
    expect(out).toContain('冲突')
    expect(replaces).toHaveLength(0)
  })
})

/**
 * C2b（设计稿 2026-10-07 §6.4）persist 边界：import / persist 在语义校验之后
 * 套 projectRoutesToLegacy——落盘文档的旧字段与 routes 镜像一致（旧版插件可
 * 回退、后续保存不误报冲突）；无 routes 的配置原引用返回（零行为变更）。
 */
describe('applyKimiTideCommand × projectRoutesToLegacy（C2b persist 边界）', () => {
  const v7cfg = (): RouterConfigV6 & { version: number; routes: unknown[] } => {
    const base = migrateV6(DEFAULT_CONFIG_V6())
    return JSON.parse(JSON.stringify(base)) as never
  }
  const freshRow = {
    id: 'fresh-writing', scope: 'session', when: { kind: 'keywords', group: 'writing' },
    target: { provider: 'kimi-coding', model: 'k3' }, preset: 'capability',
  }

  it('v7 文件 routes 新增规则（旧字段无此行，不冲突）⇒ 落盘 presets.rules 已镜像新规则', async () => {
    const cfg = v7cfg()
    cfg.routes = [...cfg.routes, freshRow]
    const src = join(dir, 'import-v7-mirror.yml')
    writeFileSync(src, YAML.stringify(cfg), 'utf8')
    const replaces: object[] = []
    const out = await applyKimiTideCommand({ kind: 'import-config', path: src }, makeDeps(DEFAULT_CONFIG_V6(), undefined, {
      settings: { get: () => DEFAULT_CONFIG_V6(), update: async () => {}, replace: async (s) => { replaces.push(s) } },
    }))
    expect(out).toMatch(/import/i)
    const written = replaces[0] as typeof cfg
    // Fails if: persist 边界漏投影——落盘文档的 presets.capability.rules 没有 fresh 行
    expect(written.presets.capability!.rules.map((r) => r.id)).toContain('fresh-writing')
    expect(written.routes).toHaveLength(cfg.routes.length)
  })

  it('set 保存（persist 边界）⇒ 旧字段与 routes 镜像（写入前统一投影）', async () => {
    const cfg = v7cfg()
    cfg.routes = [...cfg.routes, freshRow]
    const updates: object[] = []
    const deps = makeDeps(cfg as never, undefined, {
      settings: { get: () => cfg, update: async (s) => { updates.push(s) }, replace: async () => {} },
    })
    const out = await applyKimiTideCommand({ kind: 'set', value: 'saving' }, deps)
    expect(out).toMatch(/saved/)
    const written = updates[0] as typeof cfg
    expect(written.activePreset).toBe('saving')
    expect(written.routes).toEqual(cfg.routes)
    expect(written.presets.capability!.rules.map((r) => r.id)).toContain('fresh-writing')
  })
})
