// test/guard.test.ts（派发护栏纯函数层：判据 + 畸形输入 + 文案渲染 + 配置载体；
// v2.2.1 候选起拦 workflow——判据 = 脚本「一次都没点名」）
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG_V5, DEFAULT_CONFIG_V6, DEFAULT_CONFIG_V7, projectRoutesToLegacy, rowsFromLegacy,
  type RoleEntry, type RouteRowV7, type RouterConfigV6, type RouterConfigV7,
} from '../src/config.js'
import { coerceRouterConfigV6, migrateV5, migrateV6 } from '../src/migrate.js'
import { routerConfigSchema, validateRouterConfig } from '../src/settings-schema.js'
import {
  DISPATCH_GUARD_TOOLS, dispatchGuardRejection, missingKeywordsText, parseKeywords, workflowScriptUnnamed,
} from '../src/guard.js'

const TARGET = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

function role(id: string, label: string, extra: Partial<RoleEntry> = {}): RoleEntry {
  return { id, label, target: TARGET, ...extra }
}

/** 表驱动调用：缺省 = 护栏开启 + `subagent` + 主会话调用。 */
function reject(
  roles: Record<string, RoleEntry>,
  args: unknown,
  over: { toolName?: string; guarded?: boolean; callerIsTeammate?: boolean } = {},
): string | undefined {
  return dispatchGuardRejection({
    toolName: over.toolName ?? 'subagent',
    args,
    roles,
    guarded: over.guarded ?? true,
    ...(over.callerIsTeammate === undefined ? {} : { callerIsTeammate: over.callerIsTeammate }),
  })
}

const prompt = (text: string): { description: string; prompt: string } => ({ description: 'task', prompt: text })

describe('dispatchGuardRejection：放行面（关闭态 / 队友调用 / 非派发工具 / 空表）', () => {
  const hitRoles = { qa: role('qa', '质量', { keywords: ['测试'] }) }

  it('① guarded !== true ⇒ 放行（false / 缺失同款）；开关打开时同输入必拦（对照）', () => {
    expect(reject(hitRoles, prompt('派给 qa 做测试'), { guarded: false })).toBeUndefined()
    expect(dispatchGuardRejection({ toolName: 'subagent', args: prompt('派给 qa 做测试'), roles: hitRoles })).toBeUndefined()
    expect(reject(hitRoles, prompt('派给 qa 做测试'))).toBeTypeOf('string')
  })

  it('① callerIsTeammate === true ⇒ 放行（队友自己派活不管）', () => {
    expect(reject(hitRoles, prompt('派给 qa 做测试'), { callerIsTeammate: true })).toBeUndefined()
  })

  it('② 只拦 DISPATCH_GUARD_TOOLS：spawn_teammate / send_message / 未知名一律放行', () => {
    expect([...DISPATCH_GUARD_TOOLS]).toEqual(['subagent', 'subagent_fork', 'workflow'])
    for (const toolName of ['spawn_teammate', 'send_message', 'read', 'Subagent', '']) {
      expect(reject(hitRoles, prompt('派给 qa 做测试'), { toolName })).toBeUndefined()
    }
  })

  it('⑨ 空分工表 ⇒ 放行', () => {
    expect(reject({}, prompt('派给 qa 做测试'))).toBeUndefined()
  })
})

describe('dispatchGuardRejection：领域判定', () => {
  it('③ keywords 命中（大小写不敏感子串）；未命中放行', () => {
    const roles = { fe: role('fe', '前端', { keywords: ['Frontend', 'React'] }) }
    expect(reject(roles, prompt('fix the FRONTEND layout'))).toBeTypeOf('string')
    expect(reject(roles, prompt('react 组件重构'))).toBeTypeOf('string')
    expect(reject(roles, prompt('顺手看看后端'))).toBeUndefined()
  })

  it('③b keywords 非空 ⇒ 只用它：显示名 / 别名 / id 都不再参与判定', () => {
    const roles = { fe: role('fe', '前端', { keywords: ['界面'], aliases: ['UI'] }) }
    expect(reject(roles, prompt('改一下前端样式'))).toBeUndefined()
    expect(reject(roles, prompt('看看这个 fe 模块'))).toBeUndefined()
    expect(reject(roles, prompt('界面卡住了'))).toBeTypeOf('string')
  })

  it('④ keywords 缺失 / 空数组 ⇒ 回退 label（子串）+ aliases（子串）', () => {
    const missing = { fe: role('fe', '前端', { aliases: ['界面', 'UI'] }) }
    expect(reject(missing, prompt('改一下前端样式'))).toBeTypeOf('string')
    expect(reject(missing, prompt('帮我看看 ui 那一块'))).toBeTypeOf('string')
    expect(reject(missing, prompt('写个 SQL 查询'))).toBeUndefined()

    const empty = { fe: role('fe', '前端', { keywords: [] }) }   // 空数组与缺失同义
    expect(reject(empty, prompt('改一下前端样式'))).toBeTypeOf('string')
  })

  it('⑤ id 走词边界：qa 不命中 qatar / qa-team，命中独立词（含大小写与行尾）', () => {
    const roles = { qa: role('qa', '质量') }
    expect(reject(roles, prompt('总结 qatar 的赛事'))).toBeUndefined()
    expect(reject(roles, prompt('QATAR 的赛事'))).toBeUndefined()
    expect(reject(roles, prompt('把 qa-team 的流水线修一下'))).toBeUndefined()
    expect(reject(roles, prompt('派给 qa 做测试'))).toBeTypeOf('string')
    expect(reject(roles, prompt('这一块交给 QA'))).toBeTypeOf('string')
  })

  it('角色序（键序）决定「第一个命中」，只报一个角色', () => {
    const roles = { alpha: role('alpha', '甲', { keywords: ['页面'] }), beta: role('beta', '乙', { keywords: ['页面'] }) }
    const reason = reject(roles, prompt('这个页面有问题'))
    expect(reason).toBeTypeOf('string')
    expect(reason).toContain('alpha')
    expect(reason).not.toContain('beta')
  })

  it('⑥ subagent 与 subagent_fork 都拦', () => {
    const roles = { qa: role('qa', '质量', { keywords: ['测试'] }) }
    expect(reject(roles, prompt('派给 qa 做测试'), { toolName: 'subagent' })).toBeTypeOf('string')
    expect(reject(roles, prompt('派给 qa 做测试'), { toolName: 'subagent_fork' })).toBeTypeOf('string')
  })

  it('⑧ 拒绝理由含角色 id / 显示名与可执行下一步，且占位符全部替换', () => {
    const roles = { frontend: role('frontend', '前端', { keywords: ['页面'] }) }
    const reason = reject(roles, prompt('调一下这个页面')) as string
    expect(reason).toContain('frontend')
    expect(reason).toContain('前端')
    expect(reason).toContain('spawn_teammate(name="frontend"')
    // 指路串与理由主体同词（显示名）：同一句里 id 与 label 混用读起来像笔误
    // （2026-10-08 裁定）——fixHint 的 {0} 取 label，不取 id。
    expect(reason).toContain('给角色「前端」')
    expect(reason).toMatch(/keywords/i)
    for (const placeholder of ['{0}', '{1}', '{2}']) expect(reason).not.toContain(placeholder)
  })
})

describe('dispatchGuardRejection：畸形输入绝不抛异常（一律放行）', () => {
  const roles = { qa: role('qa', '质量', { keywords: ['测试'] }) }

  it('⑦ args 非对象 / 字段非字符串 / 两者都取不到 ⇒ 放行', () => {
    const argsCases: unknown[] = [
      null, undefined, 42, '纯文本', [], {}, { description: 42, prompt: null }, { prompt: undefined },
      { description: '   ' }, new Date(), Symbol('x'),
    ]
    for (const args of argsCases) {
      expect(() => reject(roles, args)).not.toThrow()
      expect(reject(roles, args)).toBeUndefined()
    }
  })

  it('⑦b roles 畸形 / 角色条目畸形 ⇒ 放行且不抛', () => {
    for (const broken of [null, undefined, 42, 'x', [], {}, { a: null }, { a: 42 }, { a: 'role' }]) {
      expect(() => reject(broken as never, prompt('派给 qa 做测试'))).not.toThrow()
      expect(reject(broken as never, prompt('派给 qa 做测试'))).toBeUndefined()
    }
    // 缺 label / 缺 keywords 的角色仍按 id 判（渲染时 label 回落 id）
    const bare = { qa: { id: 'qa', target: TARGET } as RoleEntry }
    expect(reject(bare, prompt('派给 qa 做测试'))).toContain('qa')
    expect(reject(bare, prompt('派给 qa 做测试'))).toContain('给角色「qa」')
    // 非字符串 keywords 项被丢弃 ⇒ 回退路径（不因垃圾项命中）
    const dirty = { qa: role('qa', '质量', { keywords: [42 as never, '', '测试'] }) }
    expect(reject(dirty, prompt('随手聊两句'))).toBeUndefined()
    expect(reject(dirty, prompt('跑一下测试'))).toBeTypeOf('string')
  })

  it('⑦c 判定输入本身畸形（null）⇒ 放行', () => {
    expect(() => dispatchGuardRejection(null as never)).not.toThrow()
    expect(dispatchGuardRejection(null as never)).toBeUndefined()
  })
})

describe('workflowScriptUnnamed：脚本判据「一次都没点名」（纯函数）', () => {
  it('含 agent( 且全文无 provider/model ⇒ 未点名；点名任一 ⇒ 放行', () => {
    expect(workflowScriptUnnamed('const r = await agent("评审一下", { label: "a", phase: "p" })')).toBe(true)
    expect(workflowScriptUnnamed('agent("评审一下", { provider: "kimi-coding", model: "k3" })')).toBe(false)
    expect(workflowScriptUnnamed('agent("评审一下", { provider: "kimi-coding" })')).toBe(false)
    expect(workflowScriptUnnamed('agent("评审一下", { model: "k3" })')).toBe(false)
  })

  it('不含 agent( ⇒ 不拦（脚本根本没派子代理）', () => {
    expect(workflowScriptUnnamed('log("hello")')).toBe(false)
    expect(workflowScriptUnnamed('const agents = 3')).toBe(false)
    expect(workflowScriptUnnamed('')).toBe(false)
  })

  it('大小写不敏感、词边界：PROVIDER / Model 算点名；models / providerX 不算（漏拦方向）', () => {
    expect(workflowScriptUnnamed('agent(p, { PROVIDER: x })')).toBe(false)
    expect(workflowScriptUnnamed('agent(p) // check the Model output')).toBe(false)
    expect(workflowScriptUnnamed('agent(p) // models comparison')).toBe(true)
    expect(workflowScriptUnnamed('agent(p) // providerX')).toBe(true)
  })

  it('宁可漏拦不可误拦：提示词正文提到 model 一词即视为点过名（已知取舍，钉住防回退）', () => {
    expect(workflowScriptUnnamed('agent("review this model output")')).toBe(false)
  })

  it('非字符串输入安全（恒 false，不抛）', () => {
    for (const bad of [42, null, undefined, {}, []]) {
      expect(() => workflowScriptUnnamed(bad as never)).not.toThrow()
      expect(workflowScriptUnnamed(bad as never)).toBe(false)
    }
  })
})

describe('dispatchGuardRejection：workflow 分支（判据 = 一次都没点名）', () => {
  const roles = { qa: role('qa', '质量', { keywords: ['测试'] }) }
  const unnamed = { script: 'const r = await agent("评审一下", { label: "a", phase: "p" })' }
  const named = { script: 'agent("评审一下", { provider: "kimi-coding", model: "k3" })' }

  it('未点名 ⇒ 拒绝；理由写清四件事（默认目标 / 不参与原因 / 两条改法 / 显式出路）', () => {
    const reason = reject(roles, unnamed, { toolName: 'workflow' }) as string
    expect(reason).toBeTypeOf('string')
    expect(reason).toContain('默认目标')
    expect(reason).toContain('不是队友')
    expect(reason).toContain('spawn_teammate')
    expect(reason).toContain('provider')
    expect(reason).toContain('model')
  })

  it('点名过（provider 或 model 任一）⇒ 放行；确实要走默认目标的显式写法同样放行', () => {
    expect(reject(roles, named, { toolName: 'workflow' })).toBeUndefined()
    const explicitDefault = { script: 'agent("评审一下", { provider: "deepseek-official", model: "deepseek-flash" })' }
    expect(reject(roles, explicitDefault, { toolName: 'workflow' })).toBeUndefined()
  })

  it('与分工表无关：空表 / 畸形表照样拦（workflow 子代理不是队友，判据不看 roles）', () => {
    expect(reject({}, unnamed, { toolName: 'workflow' })).toBeTypeOf('string')
    expect(reject(null as never, unnamed, { toolName: 'workflow' })).toBeTypeOf('string')
  })

  it('args 非对象 / script 非字符串 ⇒ 一律放行（畸形实参红线）；关闭态与队友调用放行', () => {
    const argsCases: unknown[] = [null, undefined, 42, 'x', [], {}, { script: 42 }, { meta: { name: 'x' } }]
    for (const args of argsCases) {
      expect(() => reject(roles, args, { toolName: 'workflow' })).not.toThrow()
      expect(reject(roles, args, { toolName: 'workflow' })).toBeUndefined()
    }
    expect(reject(roles, unnamed, { toolName: 'workflow', guarded: false })).toBeUndefined()
    expect(reject(roles, unnamed, { toolName: 'workflow', callerIsTeammate: true })).toBeUndefined()
  })
})

describe('护栏文案与解析辅助', () => {
  it('missingKeywordsText：回退提示按显示名渲染（缺 label 回落 id）', () => {
    expect(missingKeywordsText(role('qa', '质量'))).toContain('质量')
    expect(missingKeywordsText({ id: 'qa', target: TARGET } as RoleEntry)).toContain('qa')
  })

  it('parseKeywords：半角/全角逗号分隔、trim、丢空、去重保序（非字符串输入安全）', () => {
    expect(parseKeywords(' 前端 , UI ，前端,, 页面 ')).toEqual(['前端', 'UI', '页面'])
    expect(parseKeywords('')).toEqual([])
    expect(parseKeywords(',' as string)).toEqual([])
    expect(parseKeywords(42 as never)).toEqual([])
  })
})

describe('护栏判据的配置载体（keywords / dispatchGuard）', () => {
  it('rowsFromLegacy 搬 keywords（缺失不落键）；projectRoutesToLegacy 反向还原', () => {
    const rows = rowsFromLegacy({ presets: {}, roles: { qa: role('qa', '质量', { keywords: ['测试'] }), plain: role('plain', '通用') } })
    expect(rows[0]).toMatchObject({ id: 'qa', keywords: ['测试'] })
    expect('keywords' in rows[1]).toBe(false)
    const back = projectRoutesToLegacy({ ...DEFAULT_CONFIG_V7(), roles: {}, routes: rows })
    expect(back.roles.qa.keywords).toEqual(['测试'])
    expect('keywords' in back.roles.plain).toBe(false)
  })

  it('v6 存量升级链路（migrateV6 → projectRoutesToLegacy）后护栏仍读到显式领域词', () => {
    const v6: RouterConfigV6 = { ...DEFAULT_CONFIG_V6(), roles: { qa: role('qa', '质量', { keywords: ['测试'] }) } }
    const projected = projectRoutesToLegacy(migrateV6(v6))
    expect(projected.roles.qa.keywords).toEqual(['测试'])
    expect(reject(projected.roles, prompt('跑一下测试'))).toBeTypeOf('string')
    // 对照：投影丢字段（模拟未搬运）⇒ 回退路径不按显式词判，同一文本放行
    expect(reject({ qa: { id: 'qa', label: '质量', target: TARGET } }, prompt('跑一下测试'))).toBeUndefined()
  })

  it('migrateV5 按字段透传 dispatchGuard（version:5 文档携带 v7 字段）；缺失即缺失', () => {
    expect((migrateV5({ ...DEFAULT_CONFIG_V5(), dispatchGuard: 'enforce' }) as { dispatchGuard?: string }).dispatchGuard).toBe('enforce')
    expect((coerceRouterConfigV6({ ...DEFAULT_CONFIG_V5(), dispatchGuard: 'enforce' }) as { dispatchGuard?: string }).dispatchGuard).toBe('enforce')
    expect('dispatchGuard' in (migrateV5(DEFAULT_CONFIG_V5()) as object)).toBe(false)
    expect('dispatchGuard' in (migrateV6(DEFAULT_CONFIG_V6()) as object)).toBe(false)
  })

  it('schema：dispatchGuard 缺失不注入（默认往返相等）；显式值存活；非法值拒绝', () => {
    const parsed = routerConfigSchema(DEFAULT_CONFIG_V7() as never) as RouterConfigV7
    expect(parsed).toEqual(DEFAULT_CONFIG_V7())
    expect('dispatchGuard' in parsed).toBe(false)
    expect((routerConfigSchema({ ...DEFAULT_CONFIG_V7(), dispatchGuard: 'enforce' } as never) as RouterConfigV7).dispatchGuard).toBe('enforce')
    expect(() => routerConfigSchema({ ...DEFAULT_CONFIG_V7(), dispatchGuard: 'yes' } as never)).toThrow()
  })

  it('validateRoutes：routes 行 × roles 的 keywords 不一致 ⇒ 报冲突（不静默丢字段）', () => {
    const base = DEFAULT_CONFIG_V7()
    const row = (keywords?: string[]): RouteRowV7 => ({
      id: 'qa', scope: 'dispatch', when: { kind: 'role' }, target: TARGET, label: '质量',
      ...(keywords === undefined ? {} : { keywords }),
    })
    const roles = { qa: role('qa', '质量', { keywords: ['测试'] }) }
    expect(validateRouterConfig({ ...base, roles, routes: [...base.routes, row(['测试'])] })).toBeUndefined()
    expect(validateRouterConfig({ ...base, roles, routes: [...base.routes, row()] })).toContain('冲突')
  })
})
