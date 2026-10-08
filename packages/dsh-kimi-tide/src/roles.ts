/**
 * 分工表纯函数层（设计稿 D2/D5/D7）。
 * 无副作用、不碰宿主服务 —— pre-step 闭包与设置页写通道共用同一套判据。
 */
import type { RoleEntry } from './config.js'
import { copyNow } from './copy.js'
import { describeRouting, type RoutingConfigLike } from './routing-view.js'

/** 派发依据（投影与面板的枚举，设计稿 D7）。 */
export type DispatchBasis = 'role' | 'explicit' | 'keep' | 'unclaimed'

/** 一次派发的元信息（写进 pre-step 槽位，请求层记账时消费）。 */
export interface DispatchMeta {
  basis: DispatchBasis
  teammate?: string
  roleLabel?: string
}

/** 宿主队友名规则（`dsh-experimental-agent-team/lib/types/roster.js:420`）。
 *  模块级常量只能取加载期语言（宿主恒 zh）；运行期消费方只有 renderTeamSkill
 *  （宿主侧注入文本），无浏览器渲染路径，快照化无影响。 */
export const TEAMMATE_NAME_RULE = copyNow('shared.roles.teammateNameRule')

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
      if (prev !== undefined && prev !== role.id) return copyNow('shared.roles.claimConflict', { 0: name, 1: prev, 2: role.id })
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
export function renderTeamSkill(
  roles: Record<string, RoleEntry>,
  routing?: RoutingConfigLike,
): { description: string; body: string } | undefined {
  const list = Object.values(roles)
  if (list.length === 0) return undefined
  const one = (r: RoleEntry): string => `${r.label}→${r.target.provider}/${r.target.model}`
  // M5（2026-10-07 复核）：传入路由配置（宿主挂载侧恒传）时 description 消费
  // describeRouting 的**同源片段**（主会话默认目标 + 命中走哪 + 派发到哪）——摘要
  // 的「派发：」段即旧角色索引，信息不丢；不再自拼文案防跨模块漂移。routing
  // 缺席（旧调用方）维持旧文案，零行为变更。W6：copy 注入改走共享层 copyNow
  // （宿主恒 zh，逐字节不变；浏览器侧若日后渲染本摘要则跟随宿主语言）。
  const summary = routing === undefined ? undefined : describeRouting(routing, { copy: copyNow })
  const head = summary ?? list.map(one).join(copyNow('shared.roles.listJoin'))
  const full = copyNow('shared.roles.readFirst', { 0: head })
  const description = full.length <= DESCRIPTION_BUDGET
    ? full
    : copyNow('shared.roles.readFirstOverflow', { 0: list.length, 1: list.slice(0, 3).map(one).join(copyNow('shared.roles.listJoin')) })

  const rows = list.map((r) => {
    const claims = [...roleClaimSet(r)].join(copyNow('shared.roles.listJoin'))
    const aliases = (r.aliases ?? []).join(copyNow('shared.roles.listJoin'))
    const effort = r.target.effort === undefined ? '' : copyNow('shared.roles.effortSuffix', { 0: r.target.effort })
    return `| ${r.label} | \`${r.id}\` | ${r.target.provider}/${r.target.model}${effort} | ${claims} | ${aliases} | ${r.note ?? ''} |`
  })

  const body = [
    copyNow('shared.roles.skill.title'),
    '',
    copyNow('shared.roles.skill.intro'),
    '',
    copyNow('shared.roles.skill.tableHeader'),
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    copyNow('shared.roles.skill.howto'),
    '',
    copyNow('shared.roles.skill.oneShot'),
    copyNow('shared.roles.skill.persistent'),
    '',
    copyNow('shared.roles.skill.nameRuleTitle'),
    '',
    copyNow('shared.roles.skill.nameRule', { 0: TEAMMATE_NAME_RULE }),
    '',
    copyNow('shared.roles.skill.whenNot'),
    '',
    copyNow('shared.roles.skill.whenNot1'),
    copyNow('shared.roles.skill.whenNot2'),
    copyNow('shared.roles.skill.whenNot3'),
    '',
    // 派完怎么验（2026-10-08 护栏扩面的另一半）：派发后必须回读宿主持久真源
    // （子会话首条 request/header 事件）——展示层字段改道后不回写，照它们判会判错。
    copyNow('shared.roles.skill.verifyTitle'),
    '',
    copyNow('shared.roles.skill.verify1'),
    copyNow('shared.roles.skill.verify2'),
    copyNow('shared.roles.skill.verify3'),
    copyNow('shared.roles.skill.verify4'),
    copyNow('shared.roles.skill.verify5'),
    copyNow('shared.roles.skill.verify6'),
  ].join('\n')

  return { description, body }
}
