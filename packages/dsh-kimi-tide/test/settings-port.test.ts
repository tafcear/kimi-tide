// test/settings-port.test.ts — 1.4.1（2026-10-03 桌面端实机缺陷）回归：
// 档位表 / 挂载表是本条目 Config 的 volatile 字段，由宿主 setCatalog 发布；
// ConfigEditor.edit 收的是**整份** raw config，漏掉的字段会被这次写覆盖掉。
// 修复前：update/replace（设置页任何一次保存、命令层 persist、sidecar 迁移）
// 都会把 efforts/mounted 从 profile patch 里抹掉，而 setCatalog 的内容脏检查
// （serialized === lastSyncedCatalog）此时恰好命中、不会再补写 ⇒ 客户端档位表
// 变空、所有「档位」下拉退化禁用（实机现象：设置页改任何一项后档位即灰）。
import { describe, expect, it } from 'vitest'
import { createSettingsPort, isLegacyRouterShape, readRouterConfig } from '../src/settings-port.js'
import { DEFAULT_CONFIG_V5, DEFAULT_CONFIG_V6, type RouterConfigV5, type RouterConfigV6 } from '../src/config.js'
import { coerceRouterConfigV6 } from '../src/migrate.js'

/**
 * 端口测试替身：editor.edit 按宿主实测语义**整份覆盖**（candidate 里没有的键
 * 就此消失），并把每次候选原样留档供断言。
 */
const makePort = () => {
  const candidates: Array<Record<string, unknown>> = []
  let doc: Record<string, unknown> = { router: DEFAULT_CONFIG_V5() as unknown as Record<string, unknown> }
  const editor = {
    documentPath: 'C:/tmp/cordis.patch.yml',
    async edit(
      _entry: unknown,
      change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
    ): Promise<void> {
      const next = change(structuredClone(doc.router), {})
      candidates.push(next)
      doc = { ...next }   // 整份覆盖
    },
  }
  const ctx = {
    fiber: { entry: { options: { id: 'dsh-kimi-tide' } } },
    get: (name: string) => (name === 'configEditor' ? editor : undefined),
  }
  const config = { router: { get: () => doc.router } }
  const port = createSettingsPort({
    ctx: ctx as never,
    config,
    tunables: () => ({}),
    onError: () => {},
  })
  if (port === null) throw new Error('端口未建立（夹具不完整）')
  return { port, candidates, doc: () => doc }
}

const TABLE = { 'kimi-coding/k3': ['low', 'high', 'max'] }
const MOUNTED = ['kimi-coding/k3', 'zai-coding-cn/glm-5.3']

describe('settings-port：legacy 判据（v6 加宽）', () => {
  it('isLegacyRouterShape：v6 不是 legacy（否则每次启动重跑迁移）', () => {
    expect(isLegacyRouterShape({ version: 6 })).toBe(false)
  })
})

describe('settings-port：运行期读取兜底（v6 收敛）', () => {
  it('条目没有 router 段时 readRouterConfig 回落 v6 默认（新装默认 driverSticky: true）', () => {
    // 三条兜底路径都收敛到同一个 v6 内置真相源：
    // ① config 无 router 键；② volatile 快照为 undefined；③ config 本身缺失。
    for (const config of [{}, { router: { get: () => undefined } }, undefined]) {
      const c = readRouterConfig(config)
      expect(c.version).toBe(6)
      if (c.version !== 6) continue   // 收窄到 v6 判别成员：下面断言 v6 专属字段
      expect(c.driverSticky).toBe(true)
      expect(c.roles).toEqual({})
      expect(c).toEqual(DEFAULT_CONFIG_V6())
    }
  })
})

/**
 * 终审 I1/F4（2026-10-06 修复波）：缺席的 driverSticky 解析为内置默认 true。
 * 红线是不给 schema 加 .default()，故默认在读取兜底落地（mergeResolved 的
 * DEFAULT_CONFIG_V6 基座同款口径）。三态：① 新装（无 router 段）⇒ true
 * （上组已钉）；② 卡片单字段写后（段落存在、driverSticky 缺席）⇒ 仍 true；
 * ③ 存量：显式 version<6 未迁移文档 ⇒ false，迁移后（显式 false）⇒ 仍 false。
 */
describe('settings-port：driverSticky 缺席解析（终审 I1/F4 修复波）', () => {
  it('已解析快照缺 driverSticky（卡片单字段写后的形态）⇒ 解析为 true', () => {
    // 卡片保存全是单字段写：首次保存后用户层 = {activePreset:'saving'}，宿主按
    // schema 重解析补 version:6/presets/roles，driverSticky 因红线无 default 缺席。
    const doc = DEFAULT_CONFIG_V6() as Partial<RouterConfigV6>
    delete doc.driverSticky
    doc.activePreset = 'saving'
    const c = readRouterConfig({ router: { get: () => doc } }) as RouterConfigV6
    // Fails if: 缺席 ⇒ 运行期 === true 判 false（「新装默认开」在卡片写通道失活）
    expect(c.driverSticky).toBe(true)
  })

  it('plain 兼容形态（无 Volatile 包装的旧宿主）同款解析', () => {
    const doc = DEFAULT_CONFIG_V6() as Partial<RouterConfigV6>
    delete doc.driverSticky
    expect((readRouterConfig({ router: doc }) as RouterConfigV6).driverSticky).toBe(true)
  })

  it('显式 version:5 的未迁移文档缺 driverSticky ⇒ 兜底 false（不被静默读成 true）', () => {
    // Fails if: 读取兜底把未迁移 v5 文档读成新装默认 true（静默改写存量行为）
    expect((readRouterConfig({ router: { get: () => DEFAULT_CONFIG_V5() } }) as RouterConfigV6).driverSticky).toBe(false)
  })

  it('迁移后的存量（migrateV5 显式写 false）⇒ 仍 false', () => {
    const migrated = coerceRouterConfigV6(DEFAULT_CONFIG_V5(), () => {})
    expect(migrated.driverSticky).toBe(false)   // 前置：迁移路径本就显式 false
    expect((readRouterConfig({ router: { get: () => migrated } }) as RouterConfigV6).driverSticky).toBe(false)
  })

  it('显式 true / false 的文档 ⇒ 原样透传（兜底不覆盖显式值）', () => {
    expect((readRouterConfig({ router: { get: () => DEFAULT_CONFIG_V6() } }) as RouterConfigV6).driverSticky).toBe(true)
    const off = { ...DEFAULT_CONFIG_V6(), driverSticky: false }
    expect((readRouterConfig({ router: { get: () => off } }) as RouterConfigV6).driverSticky).toBe(false)
  })
})

describe('settings-port：volatile 档位表跨写保留（1.4.1 回归）', () => {
  it('setCatalog 发布 → 落进文档（efforts/mounted 可读回）', async () => {
    const { port, doc } = makePort()
    await port.setCatalog({ efforts: TABLE, mounted: MOUNTED })
    expect(doc().efforts).toEqual(TABLE)
    expect(doc().mounted).toEqual(MOUNTED)
  })

  it('随后的 update（设置页保存预设）不抹掉档位表', async () => {
    const { port, doc } = makePort()
    await port.setCatalog({ efforts: TABLE, mounted: MOUNTED })
    await port.update({ activePreset: 'saving' })
    expect((readRouterConfig({ router: { get: () => doc().router } }) as RouterConfigV5).activePreset).toBe('saving')
    expect(doc().efforts).toEqual(TABLE)      // ← 修复前为 undefined
    expect(doc().mounted).toEqual(MOUNTED)
  })

  it('随后的 replace（整段迁移 / 命令层写回）不抹掉档位表', async () => {
    const { port, doc } = makePort()
    await port.setCatalog({ efforts: TABLE, mounted: MOUNTED })
    const next = { ...DEFAULT_CONFIG_V5(), activePreset: 'capability' }
    await port.replace(next as unknown as object)
    expect(doc().efforts).toEqual(TABLE)
    expect(doc().mounted).toEqual(MOUNTED)
  })

  it('从未发布过目录 → 写回内容不含 efforts/mounted（行为与旧版逐字一致）', async () => {
    const { port, doc, candidates } = makePort()
    await port.update({ activePreset: 'saving' })
    expect('efforts' in doc()).toBe(false)
    expect('mounted' in doc()).toBe(false)
    expect(Object.keys(candidates[0]!)).toEqual(['router'])
  })

  it('目录随每次发布更新（后一次覆盖前一次，不残留旧表）', async () => {
    const { port, doc } = makePort()
    await port.setCatalog({ efforts: TABLE, mounted: MOUNTED })
    await port.setCatalog({ efforts: { 'zai-coding-cn/glm-5.3': ['low', 'high'] }, mounted: ['zai-coding-cn/glm-5.3'] })
    expect(doc().efforts).toEqual({ 'zai-coding-cn/glm-5.3': ['low', 'high'] })
    await port.update({ activePreset: 'saving' })
    expect(doc().efforts).toEqual({ 'zai-coding-cn/glm-5.3': ['low', 'high'] })
  })
})
