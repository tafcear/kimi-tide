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
  it('role 命中且 role 决策被套用（via:role）⇒ role', () => {
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

  /* 终审 I2（2026-10-06 修复波）：basis 必须由**最终生效的决策**决定——roleHit
     成立不等于 role 决策被套用（显式 @ 优先级链第 1 档、flow 决策 role 不参与）。
     误标 role 会让面板行「前端 → deepseek-v4-flash · role」自相矛盾。 */
  it('终审 I2：认领队友的显式 @ 轮 ⇒ explicit（带队友名，不带 roleLabel）', () => {
    // Fails if: roleHit 优先于最终决策——显式 @ 轮被误标 basis:'role'
    expect(dispatchMetaOf({ role: 'teammate', name: 'frontend' }, { role: role('frontend'), name: 'frontend' }, { kind: 'route', via: 'explicit' }))
      .toEqual({ basis: 'explicit', teammate: 'frontend' })
  })
  it('终审 I2：认领队友的 flow 终决策（图像正确性通道，role 不参与）⇒ keep + 队友名（不带 roleLabel）', () => {
    // Fails if: flow 轮被误标 role；或带上 roleLabel（keep+roleLabel 会被客户端
    // 渲染成「目标不可用 → 保持继承」护栏文案，与本形态不符）
    expect(dispatchMetaOf({ role: 'teammate', name: 'frontend' }, { role: role('frontend'), name: 'frontend' }, { kind: 'flow' }))
      .toEqual({ basis: 'keep', teammate: 'frontend' })
  })
  it('终审 I2：未认领队友的显式 @ 轮 ⇒ explicit（最终决策优先于 membership 归属）', () => {
    // Fails if: membership 分支先于显式判定——未认领队友的显式 @ 被误标 unclaimed
    expect(dispatchMetaOf({ role: 'teammate', name: 'x' }, undefined, { kind: 'route', via: 'explicit' }))
      .toEqual({ basis: 'explicit', teammate: 'x' })
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
