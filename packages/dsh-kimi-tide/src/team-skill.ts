/**
 * 分工表 → 宿主 runtime skill（设计稿 D3）。
 * 用本地结构化类型描述 ctx.skills 的最小子集：本插件不依赖 dsh-skill 包。
 */
import type { RoleEntry } from './config.js'
import { renderTeamSkill } from './roles.js'
import type { RoutingConfigLike } from './routing-view.js'

export const TEAM_SKILL_NAME = 'kimi-tide-team'

/** ctx.skills 的最小结构面（`dsh-skill/lib/types/index.d.ts:78-84,257`）。 */
export interface SkillsLike {
  register(skill: {
    name: string
    description: string
    content: string
    source: 'runtime'
    invocation?: { modelInvocable: boolean; userInvocable: boolean }
  }): () => void
}

export interface TeamSkillHandle {
  installed: boolean
  dispose: () => void
}

const NOOP: TeamSkillHandle = { installed: false, dispose: () => {} }

/**
 * 注册/刷新分工表 skill。任何失败（服务缺席、宿主拒绝）都降级为「未安装」，
 * 绝不冒泡 —— 分工表注入是增强项，不是路由正确性的前置。
 */
export function installTeamSkill(
  skills: SkillsLike | undefined,
  roles: Record<string, RoleEntry>,
  log: { info: (message: string) => void },
  routing?: RoutingConfigLike,
): TeamSkillHandle {
  if (skills === undefined) return NOOP
  const rendered = renderTeamSkill(roles, routing)
  if (rendered === undefined) return NOOP

  let disposeInner: (() => void) | undefined
  try {
    disposeInner = skills.register({
      name: TEAM_SKILL_NAME,
      description: rendered.description,
      content: rendered.body,
      source: 'runtime',
      invocation: { modelInvocable: true, userInvocable: false },
    })
  } catch (error) {
    log.info(`kimi-tide: 分工表 skill 注册失败（已降级为不注入）— ${String(error)}`)
    return NOOP
  }

  let disposed = false
  return {
    installed: true,
    dispose: () => {
      if (disposed) return
      disposed = true
      try { disposeInner?.() } catch { /* 释放失败不阻断 */ }
    },
  }
}
