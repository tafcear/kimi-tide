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
import { probeAgentTeams, probeSkills } from '../src/index.js'

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
})
