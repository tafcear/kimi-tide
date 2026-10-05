import { describe, expect, it } from 'vitest'
import type { RoleEntry } from '../src/config.js'
import {
  claimConflict, dispatchMetaOf, lookupRoleByTeammate, renderTeamSkill, resolveRoleDecision, roleClaimSet,
} from '../src/roles.js'

const role = (id: string, extra: Partial<RoleEntry> = {}): RoleEntry => ({
  id, label: id.toUpperCase(), target: { provider: 'p', model: 'm' }, ...extra,
})

describe('roles：认领集合与冲突', () => {
  it('认领集合 = teammate[] ∪ {id}（评审阻塞 B1 的修法）', () => {
    expect([...roleClaimSet(role('frontend', { teammate: ['ui'] }))].sort()).toEqual(['frontend', 'ui'])
  })

  it('一个认领名被两个 role 认领 ⇒ 冲突（写入期拒绝）', () => {
    const conflict = claimConflict({ a: role('a', { teammate: ['x'] }), b: role('b', { teammate: ['x'] }) })
    expect(conflict).toContain('x')
  })

  it('id 撞他 role 的 teammate ⇒ 也是冲突', () => {
    expect(claimConflict({ a: role('a'), b: role('b', { teammate: ['a'] }) })).toBeDefined()
  })

  it('无冲突返回 undefined', () => {
    expect(claimConflict({ a: role('a'), b: role('b', { teammate: ['x'] }) })).toBeUndefined()
  })
})

describe('roles：队友 → 角色', () => {
  it('按 id 与 teammate 名都能反查；未认领返回 undefined', () => {
    const roles = { frontend: role('frontend', { teammate: ['ui'] }) }
    expect(lookupRoleByTeammate(roles, 'frontend')?.id).toBe('frontend')
    expect(lookupRoleByTeammate(roles, 'ui')?.id).toBe('frontend')
    expect(lookupRoleByTeammate(roles, 'probe-code-ro')).toBeUndefined()
  })

  it('resolveRoleDecision：lead 身份不认领；队友未配角色返回 undefined', () => {
    const roles = { frontend: role('frontend') }
    expect(resolveRoleDecision(roles, { role: 'lead', name: 'lead' })).toBeUndefined()
    expect(resolveRoleDecision(roles, { role: 'teammate', name: 'other' })).toBeUndefined()
    expect(resolveRoleDecision(roles, { role: 'teammate', name: 'frontend' })?.role.id).toBe('frontend')
  })
})

describe('roles：派发依据（依据枚举 role|explicit|unclaimed|keep）', () => {
  it('role 命中优先', () => {
    expect(dispatchMetaOf({ role: 'teammate', name: 'frontend' }, { role: role('frontend'), name: 'frontend' }, { kind: 'route', via: 'role' }))
      .toEqual({ basis: 'role', teammate: 'frontend', roleLabel: 'FRONTEND' })
  })
  it('队友未在分工表 ⇒ unclaimed（即使最终是打底）', () => {
    expect(dispatchMetaOf({ role: 'teammate', name: 'x' }, undefined, { kind: 'route', via: 'default' }).basis).toBe('unclaimed')
  })
  it('非队友子代理：显式点名 ⇒ explicit；否则 keep', () => {
    expect(dispatchMetaOf(undefined, undefined, { kind: 'route', via: 'explicit' }).basis).toBe('explicit')
    expect(dispatchMetaOf(undefined, undefined, { kind: 'keep' }).basis).toBe('keep')
  })
})

describe('roles：分工表 skill 正文', () => {
  it('空表不注册（返回 undefined）', () => {
    expect(renderTeamSkill({})).toBeUndefined()
  })

  it('描述一行索引且 ≤480 字符；正文含认领名与命名规则', () => {
    const rendered = renderTeamSkill({ frontend: role('frontend', { label: '前端', aliases: ['front-end'] }) })!
    expect(rendered.description.length).toBeLessThanOrEqual(480)
    expect(rendered.description).toContain('前端→p/m')
    expect(rendered.body).toContain('frontend')
    expect(rendered.body).toContain('kebab-case')
  })

  it('角色很多时描述退化为摘要（不超 480）', () => {
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`r${i}`, role(`r${i}`)]))
    expect(renderTeamSkill(many)!.description.length).toBeLessThanOrEqual(480)
  })
})
