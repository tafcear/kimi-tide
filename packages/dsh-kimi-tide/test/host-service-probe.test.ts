/**
 * acceptance-fix-1：宿主服务探测（skills / agentTeams）必须经 `ctx.get` 读取。
 *
 * 背景（实机验收 A2/A4/A8 三连失败的根因）：cordis 的数组形 `inject` 是**必需
 * 依赖**声明，本插件的 inject 只有 llm/timer/commands/sessionProjections；
 * 对未声明 inject 的服务，上下文代理的**属性访问直接抛错**
 * （`cordis/lib/index.js:676` —— `cannot get property "<name>" without inject`）。
 * 旧探测写法 `try { ctx.skills } catch { return undefined }` 把那次抛错静默吞成
 * undefined ⇒ 分工表 skill 永不注册、队友 role 永不改道；单测全绿只是因为测试
 * 直接传假对象、绕过了 cordis 代理。`ctx.get(name)` 是 cordis 给的无 inject 要求
 * 读法（reflect.d.ts:6-16），本插件读 configEditor/connection/agents 已是同款先例。
 *
 * 本组钉死四条语义：
 * ① ctx.get 提供服务 ⇒ 原样返回该对象；② 缺席 ⇒ 返回 undefined 且不抛；
 * ③ 属性访问即抛的 cordis 形态（旧写法必炸的场景）⇒ 经 get 正常取到；
 * ④ get 自身抛错 / 形状不符 ⇒ 兜底 undefined，绝不冒泡。
 */
import { describe, expect, it, vi } from 'vitest'
import { probeAgentTeams, probeSkills, resolveTeamMembership } from '../src/index.js'

/**
 * 模拟 cordis 上下文代理：除 `get` 之外的任何属性访问都抛
 * `cannot get property "<name>" without inject`（生产形态 1:1）。
 */
function cordisLikeCtx(services: Record<string, unknown>): unknown {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'get') return (name: string) => services[name]
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  })
}

describe('probeSkills（acceptance-fix-1：经 ctx.get，无 inject 要求）', () => {
  it('ctx.get("skills") 提供服务 ⇒ 原样返回服务对象', () => {
    const svc = { register: vi.fn() }
    const ctx = { get: (name: string) => (name === 'skills' ? svc : undefined) }
    expect(probeSkills(ctx)).toBe(svc)
  })

  it('ctx 不提供该服务 ⇒ 返回 undefined 且不抛', () => {
    expect(probeSkills({ get: () => undefined })).toBeUndefined()
    // 连 get 方法都没有的最小假 ctx（纯数据对象）同样不抛
    expect(probeSkills({})).toBeUndefined()
  })

  it('形状不符（无 register 函数）⇒ undefined', () => {
    expect(probeSkills({ get: () => ({}) })).toBeUndefined()
    expect(probeSkills({ get: () => ({ register: 42 }) })).toBeUndefined()
  })

  it('cordis 形态（属性访问即抛）⇒ 经 get 正常取到服务；缺席得 undefined（旧写法必炸）', () => {
    const svc = { register: vi.fn() }
    expect(probeSkills(cordisLikeCtx({ skills: svc }))).toBe(svc)
    expect(probeSkills(cordisLikeCtx({}))).toBeUndefined()
  })

  it('get 自身抛错 ⇒ try/catch 兜底为 undefined，不冒泡', () => {
    const ctx = { get: () => { throw new Error('boom') } }
    expect(probeSkills(ctx)).toBeUndefined()
  })
})

describe('probeAgentTeams（acceptance-fix-1：经 ctx.get，无 inject 要求）', () => {
  it('ctx.get("agentTeams") 提供服务 ⇒ 原样返回服务对象', () => {
    const svc = { tryMembership: vi.fn() }
    const ctx = { get: (name: string) => (name === 'agentTeams' ? svc : undefined) }
    expect(probeAgentTeams(ctx)).toBe(svc)
  })

  it('ctx 不提供该服务 ⇒ 返回 undefined 且不抛', () => {
    expect(probeAgentTeams({ get: () => undefined })).toBeUndefined()
    expect(probeAgentTeams({})).toBeUndefined()
  })

  it('形状不符（无 tryMembership 函数）⇒ undefined', () => {
    expect(probeAgentTeams({ get: () => ({}) })).toBeUndefined()
    expect(probeAgentTeams({ get: () => ({ tryMembership: 'not-a-fn' }) })).toBeUndefined()
  })

  it('cordis 形态（属性访问即抛）⇒ 经 get 正常取到服务；缺席得 undefined', () => {
    const svc = { tryMembership: vi.fn() }
    expect(probeAgentTeams(cordisLikeCtx({ agentTeams: svc }))).toBe(svc)
    expect(probeAgentTeams(cordisLikeCtx({}))).toBeUndefined()
  })

  it('get 自身抛错 ⇒ try/catch 兜底为 undefined，不冒泡', () => {
    const ctx = { get: () => { throw new Error('boom') } }
    expect(probeAgentTeams(ctx)).toBeUndefined()
  })

  it('探测返回的服务原样带出权威面（membership / listMembers 不被裁掉）', () => {
    const svc = { tryMembership: vi.fn(), membership: vi.fn(), listMembers: vi.fn() }
    expect(probeAgentTeams({ get: () => svc })).toBe(svc)
  })
})

/**
 * v2.2.3：队友身份改用**权威面优先**的解析链。
 *
 * 背景（2026-10-12 实测缺陷）：带 `subagent/descriptor` 的 continuable 子会话
 * （＝今日宿主里 `spawn_teammate` 队友的普遍形态）过不了宿主的
 * `roster.tryMembership()` —— roster.js:64-98 在名册 `member` 取不到时先判
 * `subagentDescriptor(agent)`，为真即 `return undefined`（注释口径：「直接子会话
 * 不在名册内即不算队友」）。于是插件拿到 undefined ⇒ 第 3 档分工表静默不点火，
 * 认领队友（backend/data/qa）全部落默认目标 v4F，而设置页仍显示「已就绪」。
 * 宿主的 Team 工具自己走的是**抛错版** `membership(agent)`（roster.membership →
 * journal.state(root).members 实名解析），它对本形态返回真正的
 * `{ role: 'teammate', name }`。故本组钉死：权威面优先、失败取 tryMembership 的
 * 回落、两面皆无 ⇒ undefined（与修前逐字节一致），且**任何分支都不抛**。
 */
describe('resolveTeamMembership：权威面优先 + 回落（2026-10-12 缺陷修复）', () => {
  it('① 权威面命中 ⇒ 用它（本缺陷的修复判据）', () => {
    const svc = {
      membership: () => ({ role: 'teammate', name: 'backend' }),
      tryMembership: () => undefined,
    }
    expect(resolveTeamMembership(svc, {})).toEqual({ role: 'teammate', name: 'backend' })
  })

  it('② 权威面抛（本 agent 不在任何 Team）⇒ 回落 tryMembership，取它的答案', () => {
    const svc = {
      membership: () => { throw new Error('agent is not a member of an active Agent Team') },
      tryMembership: () => ({ role: 'lead', name: 'lead' }),
    }
    expect(resolveTeamMembership(svc, {})).toEqual({ role: 'lead', name: 'lead' })
  })

  it('③ 两面都答不出 ⇒ undefined：普通子代理/未认领队友形态，行为与修前逐字节一致', () => {
    const svc = {
      membership: () => { throw new Error('TEAM_NOT_MEMBER') },
      tryMembership: () => undefined,
    }
    expect(resolveTeamMembership(svc, {})).toBeUndefined()
  })

  it('④ 只有权威面（旧宿主无 tryMembership）：命中即用，不在名册即 undefined', () => {
    expect(resolveTeamMembership({ membership: () => ({ role: 'teammate', name: 'qa' }) }, {})).toEqual({ role: 'teammate', name: 'qa' })
    expect(resolveTeamMembership({ membership: () => { throw new Error('TEAM_NOT_MEMBER') } }, {})).toBeUndefined()
  })

  it('⑤ 两面都缺席 / 畸形 / 方法本身抛 ⇒ undefined，绝不向上抛', () => {
    expect(resolveTeamMembership({}, {})).toBeUndefined()
    expect(resolveTeamMembership({ membership: () => undefined, tryMembership: () => { throw new Error('boom') } }, {})).toBeUndefined()
    expect(resolveTeamMembership({ membership: 'not-a-fn', tryMembership: 42 } as never, {})).toBeUndefined()
  })

  it('⑥ 权威面**不作弊**：它返回 lead 也不改写（主会话口径仍由调用点 isChild 决定）', () => {
    // 调用点只在子代理轮读身份（router.ts 的 isChild 分支），本函数不做任何角色改写；
    // guard 侧靠 isTeammateMembership 只认 role==='teammate'，lead 照旧不算队友。
    expect(resolveTeamMembership({ membership: () => ({ role: 'lead', name: 'lead' }) }, {})).toEqual({ role: 'lead', name: 'lead' })
  })
})
