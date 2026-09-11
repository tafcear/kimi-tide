// @vitest-environment jsdom
/**
 * 设置卡模型目录通道回归锁（2026-09-11 实机缺陷：设置页下拉无 DeepSeek 模型）。
 *
 * 实机缺陷：dsh 0.1.5-rc.1 起 `llm` remote 命名空间只剩 discoverModels /
 * listProviders / listConfigurableProviders 三个方法（全宿主 grep 无
 * `llm/models`），`remote.llm.models` 打在 undefined 上——buildConnectionFace
 * 的 models() 抛「llm.models 通道不可用」，card-store.loadAvailability 的
 * catch 把 catalog/availability 双双置 null。下拉退化为「仅已配置目标」
 * （presets default + 规则 target + 流 vision/reviewer 扫描），而 DeepSeek
 * 模型只出现在 auxTargets（不进扫描）→ 下拉里一个 DeepSeek 都没有。
 *
 * 修复契约：目录通道换道宿主官方模型目录 RPC——`remote.session.modelCatalog`
 * （session/modelCatalog，产品模型选择器同款，dsh-client-ui-model-selection
 * client.js:46 先例），信封同为 `{ ok, value | error }`，groups 形状
 * `{ id, models: [{ id, … }] }` 与 card-store 现有消费逐字兼容；旧通道
 * （remote.llm.models / legacy connection.api.llm.models）保留作回退。
 * 每个用例注释标注「会使其失败的生产改动」。
 */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'

/** 宿主 session/modelCatalog 返回形（ModelCatalog，dsh-api-session-controller types）。 */
const MODEL_CATALOG = {
  default: { provider: 'deepseek-official', model: 'deepseek-flash' },
  routableProviders: ['deepseek-official', 'kimi-coding', 'zai-coding-cn'],
  groups: [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' },
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    },
    { id: 'kimi-coding', name: 'Kimi', models: [{ id: 'k3', name: 'Kimi K3' }] },
    { id: 'zai-coding-cn', name: 'Z.ai', models: [{ id: 'glm-5.3-flash', name: 'GLM-5.3 Flash' }] },
  ],
  failures: [],
}

interface ModelsFace {
  api: { llm: { models: (request: Record<string, never>) => Promise<{ result: unknown }> } }
}

/**
 * 驱动 client apply()，捕获 settings.section 槽位并手动触发其 inject()，
 * 拿到卡片实际使用的 connection 面（与实机同一条构造路径）。
 */
function mountConnectionFace(
  remote: Record<string, unknown>,
  legacyConnection?: unknown,
): ModelsFace {
  let sectionFactory: (() => unknown) | undefined
  const ctx = {
    get: (name: string) => (name === 'connection' ? legacyConnection : undefined),
    effect: (fn: () => unknown) => fn(),
    slots: {
      inject: (name: string, factory: () => unknown) => {
        if (name === 'settings.section') sectionFactory = factory
      },
      register: (spec: unknown) => spec,
    },
    remote,
  }
  apply(ctx as never)
  expect(sectionFactory).toBeDefined()
  const spec = sectionFactory!() as { inject: () => { connection: ModelsFace | null } }
  const connection = spec.inject().connection
  expect(connection).not.toBeNull()
  return connection as ModelsFace
}

describe('设置卡目录通道：remote.session.modelCatalog（0.1.5-rc.1+ 正道）', () => {
  it('llm.models 缺席（现行宿主形态）→ 目录走 session.modelCatalog，DeepSeek 组进选项', async () => {
    const modelCatalog = vi.fn(async () => ({ ok: true, value: MODEL_CATALOG }))
    // remote 形态 = dsh 0.1.5-rc.1 实况：llm 命名空间只有三个方法，无 models。
    const connection = mountConnectionFace({
      commands: { execute: () => Promise.resolve({}) },
      session: { modelCatalog },
      llm: { listProviders: () => [], discoverModels: () => Promise.resolve([]) },
    })
    const r = await connection.api.llm.models({})
    // Fails if: 目录通道仍只认 remote.llm.models（实机缺陷本体——抛
    // 「llm.models 通道不可用」，catalog 置 null，下拉退化为已配置目标）。
    expect(modelCatalog).toHaveBeenCalledTimes(1)
    const result = r.result as {
      ok: boolean
      value: { groups: Array<{ id: string; models: Array<{ id: string }> }> }
    }
    expect(result.ok).toBe(true)
    expect(result.value.groups.map((g) => g.id)).toEqual([
      'deepseek-official',
      'kimi-coding',
      'zai-coding-cn',
    ])
    // card-store 消费面逐字兼容：models[].id 可直接映射（卡片下拉数据源）。
    const deepseek = result.value.groups[0]
    expect(deepseek.models.map((m) => m.id)).toContain('deepseek-v4-flash')
  })

  it('modelCatalog 返回 ok:false → 信封透传（card-store 按 !result.ok 降级无灰态）', async () => {
    const modelCatalog = vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'catalog unavailable' } }))
    const connection = mountConnectionFace({
      commands: { execute: () => Promise.resolve({}) },
      session: { modelCatalog },
      llm: {},
    })
    const r = await connection.api.llm.models({})
    expect((r.result as { ok: boolean }).ok).toBe(false)
  })
})

describe('设置卡目录通道：旧宿主回退链保持', () => {
  it('无 session 命名空间（0.1.2-rc.x 形态）→ 回退 remote.llm.models', async () => {
    const models = vi.fn(async () => ({
      ok: true,
      value: { groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] }] },
    }))
    const connection = mountConnectionFace({
      commands: { execute: () => Promise.resolve({}) },
      llm: { models },
    })
    const r = await connection.api.llm.models({})
    // Fails if: 换道时误删 llm.models 回退（旧宿主目录直接失效）。
    expect(models).toHaveBeenCalledTimes(1)
    expect((r.result as { ok: boolean }).ok).toBe(true)
  })

  it('loopback 两级全缺（更旧宿主）→ 回退 legacy connection.api.llm.models', async () => {
    const models = vi.fn(async () => ({
      result: {
        ok: true,
        value: { groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] }] },
      },
    }))
    const connection = mountConnectionFace(
      { commands: { execute: () => Promise.resolve({}) } },
      { api: { llm: { models } } },
    )
    const r = await connection.api.llm.models({})
    expect(models).toHaveBeenCalledTimes(1)
    expect((r.result as { ok: boolean }).ok).toBe(true)
  })
})
