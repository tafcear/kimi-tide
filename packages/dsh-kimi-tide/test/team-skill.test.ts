import { describe, expect, it, vi } from 'vitest'
import { TEAM_SKILL_NAME, installTeamSkill } from '../src/team-skill.js'
import type { RoleEntry } from '../src/config.js'

const log = { info: () => {} }
const roles: Record<string, RoleEntry> = { frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'k3' } } }

describe('team-skill：注册与降级', () => {
  it('skills 缺席（未挂 dsh-skill）⇒ 不注册、不抛、installed=false', () => {
    expect(installTeamSkill(undefined, roles, log).installed).toBe(false)
  })

  it('roles 为空 ⇒ 不注册', () => {
    const register = vi.fn(() => () => {})
    expect(installTeamSkill({ register }, {}, log).installed).toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('正常注册：name/description/content/source=runtime，且 disposer 幂等', () => {
    const disposeInner = vi.fn()
    const register = vi.fn(() => disposeInner)
    const handle = installTeamSkill({ register }, roles, log)
    expect(handle.installed).toBe(true)
    expect(register).toHaveBeenCalledTimes(1)
    const skill = register.mock.calls[0]![0] as { name: string; description: string; content: string; source: string }
    expect(skill.name).toBe(TEAM_SKILL_NAME)
    expect(skill.description).toContain('前端')
    expect(skill.content).toContain('spawn_teammate')
    expect(skill.source).toBe('runtime')
    handle.dispose()
    handle.dispose()
    expect(disposeInner).toHaveBeenCalledTimes(1)
  })

  it('注册抛错（宿主拒绝）⇒ 降级为未安装，不冒泡', () => {
    const register = vi.fn(() => { throw new Error('duplicate name') })
    expect(installTeamSkill({ register }, roles, log).installed).toBe(false)
  })
})
