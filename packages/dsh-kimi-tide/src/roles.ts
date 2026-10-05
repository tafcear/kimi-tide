/**
 * 分工表纯函数层（设计稿 D2/D5/D7）。
 * 无副作用、不碰宿主服务 —— pre-step 闭包与设置页写通道共用同一套判据。
 */
import type { RoleEntry } from './config.js'

/** 派发依据（投影与面板的枚举，设计稿 D7）。 */
export type DispatchBasis = 'role' | 'explicit' | 'keep' | 'unclaimed'

/** 一次派发的元信息（写进 pre-step 槽位，请求层记账时消费）。 */
export interface DispatchMeta {
  basis: DispatchBasis
  teammate?: string
  roleLabel?: string
}

/** 宿主队友名规则（`dsh-experimental-agent-team/lib/types/roster.js:420`）。 */
export const TEAMMATE_NAME_RULE = 'lower-kebab-case（小写字母/数字/连字符）、≤64 字符、不得为 lead'

/** 认领集合 = teammate[] ∪ {id}（设计稿 D2；评审阻塞 B1 的修法）。 */
export function roleClaimSet(role: RoleEntry): Set<string> {
  const set = new Set<string>(role.teammate ?? [])
  set.add(role.id)
  return set
}

/** 任一认领名（含 role.id）不得被他 role 认领；冲突返回错误串（写入期拒绝用）。 */
export function claimConflict(roles: Record<string, RoleEntry>): string | undefined {
  const owner = new Map<string, string>()
  for (const role of Object.values(roles)) {
    for (const name of roleClaimSet(role)) {
      const prev = owner.get(name)
      if (prev !== undefined && prev !== role.id) return `认领名「${name}」同时属于角色「${prev}」与「${role.id}」`
      owner.set(name, role.id)
    }
  }
  return undefined
}

export function lookupRoleByTeammate(roles: Record<string, RoleEntry>, name: string): RoleEntry | undefined {
  for (const role of Object.values(roles)) if (roleClaimSet(role).has(name)) return role
  return undefined
}

/** 队友身份 → 角色命中（lead 与未认领名一律不命中）。 */
export function resolveRoleDecision(
  roles: Record<string, RoleEntry>,
  membership: { role: string; name: string } | undefined,
): { role: RoleEntry; name: string } | undefined {
  if (membership === undefined || membership.role !== 'teammate') return undefined
  const role = lookupRoleByTeammate(roles, membership.name)
  return role === undefined ? undefined : { role, name: membership.name }
}

/**
 * 派发依据判定（终审 I2，2026-10-06 修复波）：**basis 由最终生效的决策决定**——
 * roleHit 成立不等于 role 决策被套用（显式 @ 是优先级链第 1 档、flow 决策 role
 * 不参与改道）。优先级：explicit（最终 via:'explicit'）> role（最终 via:'role'）
 * > unclaimed（未认领队友）> keep。
 *
 * role 命中但终决策非 role（flow/keep 等）⇒ 记 keep + 队友名、**不带 roleLabel**：
 * 客户端把 keep+roleLabel 渲染成「「前端」目标不可用 → 保持继承」护栏文案，
 * 与「role 本轮没参与」的形态不符（keep+teammate 渲染「frontend → 目标 · keep」，
 * 如实说出 role 未驱动本轮）。
 */
export function dispatchMetaOf(
  membership: { role: string; name: string } | undefined,
  roleHit: { role: RoleEntry; name: string } | undefined,
  decision: { kind: string; via?: string },
): DispatchMeta {
  const teammate = roleHit?.name ?? (membership?.role === 'teammate' ? membership.name : undefined)
  if (decision.kind === 'route' && decision.via === 'explicit') {
    return { basis: 'explicit', ...(teammate === undefined ? {} : { teammate }) }
  }
  if (roleHit !== undefined && decision.kind === 'route' && decision.via === 'role') {
    return { basis: 'role', teammate: roleHit.name, roleLabel: roleHit.role.label }
  }
  if (roleHit !== undefined) return { basis: 'keep', teammate: roleHit.name }
  if (membership !== undefined && membership.role === 'teammate') return { basis: 'unclaimed', teammate: membership.name }
  return { basis: 'keep' }
}

/** 宿主目录单条 description 上限（`dsh-tool-skill/lib/index.js:40`），留 20 字符余量。 */
const DESCRIPTION_BUDGET = 480

/**
 * 生成分工表 skill 的目录摘要与正文（设计稿 D3）。
 * 空表返回 undefined —— 调用方据此不注册（无角色不注入）。
 */
export function renderTeamSkill(roles: Record<string, RoleEntry>): { description: string; body: string } | undefined {
  const list = Object.values(roles)
  if (list.length === 0) return undefined
  const one = (r: RoleEntry): string => `${r.label}→${r.target.provider}/${r.target.model}`
  const full = `派活前读我：${list.map(one).join('、')}`
  const description = full.length <= DESCRIPTION_BUDGET
    ? full
    : `派活前读我：共 ${list.length} 个角色（${list.slice(0, 3).map(one).join('、')}…）`

  const rows = list.map((r) => {
    const claims = [...roleClaimSet(r)].join('、')
    const aliases = (r.aliases ?? []).join('、')
    const effort = r.target.effort === undefined ? '' : `（effort ${r.target.effort}）`
    return `| ${r.label} | \`${r.id}\` | ${r.target.provider}/${r.target.model}${effort} | ${claims} | ${aliases} | ${r.note ?? ''} |`
  })

  const body = [
    '# 月汐分工表（团队派发）',
    '',
    '当任务属于某个专项领域时，**派发给对应模型的子代理**，不要自己硬做。',
    '',
    '| 角色 | id | 目标模型 | 队友名（认领） | 别名 | 备注 |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    '## 怎么派（两种形态，都要）',
    '',
    '1. **一次性任务**（做完即回收）：用 `workflow` 的 `agent(prompt, { provider, model })` 指定上表的目标，提示词必须自带任务所需的全部上下文。',
    '2. **常驻队友**（可多次差遣）：用 `spawn_teammate` 建队友，**队友名必须取自上表的「队友名（认领）」一列**（或该角色的 id）——月汐据此把它的请求改道到目标模型。',
    '',
    '## 队友名合法性',
    '',
    `队友名须满足：${TEAMMATE_NAME_RULE}；名字永不复用，且一旦失败也占用名额。`,
    '',
    '## 什么时候不要派',
    '',
    '- 琐碎到不值得起一个子代理的活（改个错别字、一句话问答）；',
    '- 没有对应角色的领域 —— 要么自己答，要么先请用户在设置里加一个角色；',
    '- 需要与本轮上下文强耦合的连续操作（子代理只有你给它的提示词）。',
  ].join('\n')

  return { description, body }
}
