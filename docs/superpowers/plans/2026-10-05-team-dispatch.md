# 团队派发（分工层执行面）实施计划

> **给执行 agent**：必需子技能 —— `superpowers:subagent-driven-development`（推荐，逐任务派新子代理 + 两段式评审）或 `superpowers:executing-plans`（本会话内批量执行 + 检查点）。步骤用 `- [ ]` 复选框跟踪。
>
> **设计稿（先行必读）**：`docs/superpowers/specs/2026-10-05-team-dispatch-design.md`（v2，§8 十三项已由用户全部裁定按建议值执行）。
> **评审档案**：`docs/superpowers/reviews/2026-10-05-team-dispatch-kimi-review-round1.md`（Round-1「有条件通过」，本计划已吸收全部处置）。
> **侦察依据**：本计划中的所有行号来自 2026-10-05 两路只读代码侦察（config/migrate/schema/测试体例；router/index/projection/client）。执行时若行号漂移，按**函数名/注释锚点**定位。

**目标**：让月汐从「逐消息路由器」升级为「分工层执行面」——快速主驱动模型恒定在岗（不再被预设打底拉走）、用户在设置页自配「分工表」（角色 → 模型）、专项活派给指定模型的子代理（一次性 / 常驻队友都要）、每次派发有据可查。

**架构**：配置升 v6（新增 `driver` / `driverSticky` / `rulesApplyToChildren` / `roles` 四个字段，走既有逐级迁移链）；新增 `src/roles.ts`（分工表纯函数：认领集合、冲突判定、skill 正文生成、决策元信息）；新增 `src/team-skill.ts`（把分工表注册成宿主 runtime skill，模型按需读取）；`src/router.ts` 的 pre-step 闭包新增 `via:'role'` 决策分支与主驱动恒定；新增 `src/dispatch-ledger.ts`（插件级派发台账）经 `panelSnapshot` 推给 dock；设置页加角色编辑器。

**技术栈**：TypeScript（NodeNext / strict / verbatimModuleSyntax）· Cordis 插件（宿主 `@deepseek-ai/dsh@0.1.7-rc.2`）· schemastery（配置 schema）+ zod（投影 schema）· vitest（基线 **802 passed / 46 文件**）· esbuild（客户端构建）。

---

## 全局约束

- **TDD 铁律**：每个任务先写失败测试并**实跑看红**（贴出实测失败输出），再写最小实现，再跑绿；禁止先实现后补测试。
- **质量基线**：`npm run typecheck` 0 错误 ＋ `npm test` 全绿（只增不减，基线 802）＋ `npm run build` 通过，方可提交（`README.md:263`）。
- **配置默认值红线**：新增可选字段**一律不带 `.default()`** —— 对象型字段入 schema 会被注入 `{}` 破坏「默认往返相等」（`test/settings-schema.test.ts:7-9`）。缺省由 `mergeResolved` 的 `deepMerge` 供（`flows` 先例，`settings-schema.ts:82-83`）。
- **迁移口径**（评审阻塞 B2）：v5→v6 迁移写 `version: 6` ＋ `roles: {}` ＋ **`driverSticky: false`**（存量保持 v1.4.1 行为；新装由 `DEFAULT_CONFIG_V6()` 得 `true`）；**不写** `driver`（缺失＝跟随宿主默认）与 `rulesApplyToChildren`（缺失＝运行期缺省 `false`＝新语义，这是 v2.0.0 的既定行为变更）。
- **宿主服务访问纪律**：插件**不新增**对 `@deepseek-ai/dsh-experimental-agent-team` 的依赖（`package.json:54-108` 无此包）。所有宿主服务（`ctx.agentTeams` / `ctx.skills`）走**本地结构化类型 + 装配期 `try/catch` 探测 + 缓存布尔**（cordis 服务缺席时**访问即抛**，不是 `undefined`）。
- **方言**：注释 / 提交信息 / 文档全中文；标识符英文；测试 import 用相对路径 + 显式 `.js` 后缀；类型用 `import type` 单列。
- **命令**：所有 `npm` 命令在 `packages/dsh-kimi-tide` 下执行；仓库级门禁 `npm run check` 在仓库根执行。
- **本计划不动**：`README.md` / `README.en.md` / `CHANGELOG.md` / 版本号（保持 v1.4.1 三方一致，门禁绿；发版由 release runbook 处理）。
- **提交粒度**：一个任务一次提交（或任务内按步骤分组提交），提交信息中文、形如 `feat(team): …`。

---

### Task 1：配置 v6（形状 + 迁移 + schema + 版本落点加宽）

**Files：**
- 修改：`packages/dsh-kimi-tide/src/config.ts`（新增 `RoleEntry` / `RouterConfigV6` / `RouterConfigV5Plus` / `isV5Plus` / `DEFAULT_ROLES` / `DEFAULT_CONFIG_V6`）
- 修改：`packages/dsh-kimi-tide/src/migrate.ts`（新增 `migrateV5` / `coerceRouterConfigV6` / `hasKimiTideResidueV6`）
- 修改：`packages/dsh-kimi-tide/src/settings-schema.ts`（version union/default、版本闸、v6 校验、`mergeResolved`）
- 修改：`packages/dsh-kimi-tide/src/settings-port.ts:143,157`（legacy 判据加宽 —— **不改会把 v6 当 legacy 反复重跑迁移**）
- 修改：`packages/dsh-kimi-tide/src/index.ts:971-990`（coerce 换 V6、留档后缀 `.pre-v6`）
- 修改：`packages/dsh-kimi-tide/src/settings-migration.ts:47`（sidecar 导入走 V6）
- 修改（版本落点加宽清单，逐处照做）：`router.ts:116,120,1378,1394`｜`rules.ts:261,316`｜`commands.ts:221,272,377`｜`client/card-store.ts:42,311,469`｜`client/help-content.ts:17,42-64,90`｜`client/HelpTab.tsx:31`｜`client/SettingsCard.tsx:626,664`
- 测试：`test/config.test.ts`、`test/migrate.test.ts`、`test/settings-schema.test.ts`、`test/schema-probe.test.ts`、`test/settings-port.test.ts`

**Interfaces（本任务产出，后续任务依赖）：**
- `RoleEntry { id: string; label: string; target: RouteTarget; teammate?: string[]; aliases?: string[]; note?: string }`
- `RouterConfigV6 { version: 6; activePreset: string \| null; presets; flows; keywordGroups; auxTargets?; driver?: RouteTarget \| null; driverSticky?: boolean; rulesApplyToChildren?: boolean; roles: Record<string, RoleEntry> }`
- `isV5Plus(config: { version: number }): config is RouterConfigV5Plus`
- `DEFAULT_CONFIG_V6(): RouterConfigV6`（`driverSticky: true`、`driver: null`、`roles: {}`、**无** `rulesApplyToChildren`）
- `coerceRouterConfigV6(raw, warn): RouterConfigV6`、`migrateV5(raw): RouterConfigV6`、`hasKimiTideResidueV6(config): boolean`

- [ ] **步骤 1：写失败测试 —— 形状与内置真相源**

在 `test/config.test.ts` 追加：

```ts
import { DEFAULT_CONFIG_V6, isV5Plus } from '../src/config.js'

describe('RouterConfigV6（团队派发）', () => {
  it('内置真相源：version 6 / driverSticky true / driver null / roles 空 / 无 rulesApplyToChildren', () => {
    const c = DEFAULT_CONFIG_V6()
    expect(c.version).toBe(6)
    expect(c.driverSticky).toBe(true)
    expect(c.driver).toBeNull()
    expect(c.roles).toEqual({})
    expect(c).not.toHaveProperty('rulesApplyToChildren')
    expect(c.presets).toEqual(DEFAULT_CONFIG_V5().presets)
    expect(c.flows).toEqual(DEFAULT_FLOWS())
  })

  it('isV5Plus：v4 否、v5/v6 是', () => {
    expect(isV5Plus({ version: 4 })).toBe(false)
    expect(isV5Plus({ version: 5 })).toBe(true)
    expect(isV5Plus({ version: 6 })).toBe(true)
  })
})
```

- [ ] **步骤 2：跑测试看红**

运行：`npm test -- test/config.test.ts`
预期：FAIL —— 报错形如 `DEFAULT_CONFIG_V6 is not a function` / `isV5Plus is not a function`。

- [ ] **步骤 3：实现 config.ts 新增部分**

在 `config.ts` 的 `RouterConfigV5`（`:92-107`）之后追加：

```ts
/** 分工表条目（设计稿 D2）：一个角色 = 一个领域 → 一个模型目标。 */
export interface RoleEntry {
  /** 稳定 id（配置键；同时是默认认领的队友名，须满足 lower-kebab-case）。 */
  id: string
  /** 显示名，如「前端」。 */
  label: string
  /** 该角色的路由目标（复用 RouteTarget 与既有降级语义）。 */
  target: RouteTarget
  /** 额外认领的队友名（与 id 合并成认领集合；不得与他 role 冲突）。 */
  teammate?: string[]
  /** 供模型识别的别名（进分工表 skill 正文）。 */
  aliases?: string[]
  /** 给模型的补充说明。 */
  note?: string
}

/** v6 配置：v5 之上新增分工层（driver / driverSticky / rulesApplyToChildren / roles）。 */
export interface RouterConfigV6 {
  version: 6
  activePreset: string | null
  presets: Record<string, RouterPreset>
  flows: Record<string, CollaborationFlow>
  keywordGroups: Record<string, string[]>
  auxTargets?: Record<string, RouteTarget>
  /** 主驱动目标；null / 缺失 = 跟随宿主 agent-default-model（设计稿 D1）。 */
  driver?: RouteTarget | null
  /** true 时主会话打底 = driver（新装默认 true；存量迁移显式 false）。 */
  driverSticky?: boolean
  /** 子代理是否参与关键词规则；缺失/false = 不参与（设计稿 D6，v2.0.0 行为变更）。 */
  rulesApplyToChildren?: boolean
  /** 分工表；键即 role.id。 */
  roles: Record<string, RoleEntry>
}

export type RouterConfigV5Plus = RouterConfigV5 | RouterConfigV6

/** v5 及以上（flows 等字段可用）；版本落点统一的加宽判据。 */
export function isV5Plus(config: { version: number }): config is RouterConfigV5Plus {
  return config.version >= 5
}

/** 内置分工表：空表（不替用户做能力判断；设置页提供三条可一键填入的示例）。 */
export function DEFAULT_ROLES(): Record<string, RoleEntry> {
  return {}
}

/**
 * v6 内置真相源（新装 / 「重置为默认」路径）。
 * driverSticky: true = 主驱动恒定（用户 2026-10-05 裁定"开"）；
 * 存量配置由 migrateV5 显式写 false，保持 v1.4.1 行为。
 * rulesApplyToChildren 故意缺席：运行期缺省 false 即新语义，迁移不写（评审阻塞 B2）。
 */
export function DEFAULT_CONFIG_V6(): RouterConfigV6 {
  const v5 = DEFAULT_CONFIG_V5()
  return {
    version: 6,
    activePreset: v5.activePreset,
    presets: v5.presets,
    flows: v5.flows,
    keywordGroups: v5.keywordGroups,
    ...(v5.auxTargets === undefined ? {} : { auxTargets: v5.auxTargets }),
    driver: null,
    driverSticky: true,
    roles: DEFAULT_ROLES(),
  }
}
```

- [ ] **步骤 4：跑测试看绿**

运行：`npm test -- test/config.test.ts`
预期：PASS。

- [ ] **步骤 5：写失败测试 —— 迁移（照 `migrate.test.ts:144-173` 的三条范式）**

在 `test/migrate.test.ts` 追加：

```ts
import { coerceRouterConfigV6, hasKimiTideResidueV6, migrateV5 } from '../src/migrate.js'
import { DEFAULT_CONFIG_V5, DEFAULT_FLOWS } from '../src/config.js'

describe('migrateV5（v5→v6：存量保持旧行为）', () => {
  it('自定义 v5 输入：预设/流/词组逐字保持；driverSticky 显式 false；不写 driver / rulesApplyToChildren', () => {
    const v5 = DEFAULT_CONFIG_V5()
    v5.activePreset = 'saving'
    const v6 = migrateV5(v5)
    expect(v6.version).toBe(6)
    expect(v6.presets).toEqual(v5.presets)
    expect(v6.flows).toEqual(v5.flows)
    expect(v6.keywordGroups).toEqual(v5.keywordGroups)
    expect(v6.roles).toEqual({})
    expect(v6.driverSticky).toBe(false)          // 存量保持 v1.4.1 行为
    expect(v6).not.toHaveProperty('driver')
    expect(v6).not.toHaveProperty('rulesApplyToChildren')
  })

  it('同引用直通幂等：已是 v6 的输入原样返回', () => {
    const v6 = migrateV5(DEFAULT_CONFIG_V5())
    expect(migrateV5(v6)).toBe(v6)
    expect(coerceRouterConfigV6(v6, () => {})).toBe(v6)
  })

  it('v1 → v6 端到端：走完整链路不抛错，且 flows 为内置流', () => {
    const v6 = coerceRouterConfigV6(V1, () => {})
    expect(v6.version).toBe(6)
    expect(v6.flows).toEqual(DEFAULT_FLOWS())
  })

  it('hasKimiTideResidueV6：v6 无残留为 false；v5 残留为 true', () => {
    expect(hasKimiTideResidueV6(DEFAULT_CONFIG_V6())).toBe(false)
    expect(hasKimiTideResidueV6(DEFAULT_CONFIG_V5())).toBe(true)
  })
})
```

（`V1` 是 `migrate.test.ts:5-26` 的既有夹具常量；`DEFAULT_CONFIG_V6` 需补进该文件的 import。）

- [ ] **步骤 6：跑测试看红**

运行：`npm test -- test/migrate.test.ts`
预期：FAIL —— `migrateV5 is not a function`。

- [ ] **步骤 7：实现 migrate.ts 新增部分**

在 `coerceRouterConfigV5`（`:142-146`）之后追加（风格照 `migrateV4` `:128-139`）：

```ts
/**
 * v5 → v6：只新增字段，存量行为保持。
 * driverSticky 显式 false —— 新装走 DEFAULT_CONFIG_V6()（true），存量留旧行为；
 * driver / rulesApplyToChildren 不写：前者缺失＝跟随宿主默认，后者缺失＝运行期缺省 false（新语义）。
 */
export function migrateV5(raw: unknown): RouterConfigV6 {
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.version === 6) return raw as RouterConfigV6
  const v5 = coerceRouterConfigV5(raw, () => {})
  return {
    version: 6,
    activePreset: v5.activePreset,
    presets: v5.presets,
    flows: v5.flows,
    keywordGroups: v5.keywordGroups,
    ...(v5.auxTargets === undefined ? {} : { auxTargets: v5.auxTargets }),
    driverSticky: false,
    roles: {},
  }
}

export function coerceRouterConfigV6(raw: unknown, warn: (message: string) => void): RouterConfigV6 {
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.version === 6) return raw as RouterConfigV6
  return migrateV5(coerceRouterConfigV5(raw, warn))
}

/** v6 残留判据（照 hasKimiTideResidueV5 `:149-153`）。 */
export function hasKimiTideResidueV6(config: unknown): boolean {
  if ((config as { version?: unknown } | null | undefined)?.version !== 6) return true
  try {
    return JSON.stringify(config).includes('kimi-tide')
  } catch {
    return true
  }
}
```

- [ ] **步骤 8：跑测试看绿**

运行：`npm test -- test/migrate.test.ts`
预期：PASS。

- [ ] **步骤 9：写失败测试 —— schema 与版本落点**

在 `test/schema-probe.test.ts` 把「`version: 6` 抛错」那条（`:32-39`，尤其 `:38`）改为「收 6」，并新增：

```ts
it('version 6 被接受，默认 6', () => {
  const parsed = Config({ version: 6 })
  expect(parsed.version).toBe(6)
  expect(Config({}).version).toBe(6)
})
```

在 `test/settings-schema.test.ts` 追加：

```ts
it('v6 默认往返相等（含 driverSticky: true）', () => {
  expect(routerConfigSchema(DEFAULT_CONFIG_V6())).toEqual(DEFAULT_CONFIG_V6())
})

it('mergeResolved 不把 driverSticky 注入到存量配置（迁移后仍为 false）', () => {
  const migrated = coerceRouterConfigV6(DEFAULT_CONFIG_V5(), () => {})
  const resolved = mergeResolved(migrated)
  expect(resolved.driverSticky).toBe(false)
})
```

在 `test/settings-port.test.ts` 追加：

```ts
it('isLegacyRouterShape：v6 不是 legacy（否则每次启动重跑迁移）', () => {
  expect(isLegacyRouterShape({ version: 6 })).toBe(false)
})
```

- [ ] **步骤 10：跑测试看红**

运行：`npm test -- test/schema-probe.test.ts test/settings-schema.test.ts test/settings-port.test.ts`
预期：FAIL —— 三条新断言分别报「version 6 抛 `ValidationError`」「driverSticky 得到 true」「v6 被判 legacy」。

- [ ] **步骤 11：实现 schema / 校验 / 端口加宽**

`settings-schema.ts`：

1. `:88` 版本 union 与 default：
```ts
version: Schema.union([
  Schema.const(2), Schema.const(3), Schema.const(4), Schema.const(5), Schema.const(6),
]).default(6),
```
2. 顶层新增字段（**一律不带 `.default()`**；`roles` 是 dict，缺失由 `mergeResolved` 供默认；`driver` 用无默认 union 保住往返相等）：
```ts
driver: Schema.union([targetSchema, Schema.const(null)]),
driverSticky: Schema.boolean(),
rulesApplyToChildren: Schema.boolean(),
roles: Schema.dict(roleSchema),          // roleSchema = Schema.object({ id, label, target: targetSchema, teammate: Schema.array(Schema.string()), aliases: …, note: Schema.string() })，全部无 default
```
3. `:111` 版本闸改为 `if (raw.version !== 5 && raw.version !== 6) return undefined`，并在校验体尾部追加 v6 专属（返回错误串，不抛）：
```ts
if (raw.version === 6) {
  const roles = raw.roles ?? {}
  const conflict = claimConflict(roles)                     // roles.ts（任务 2）——本任务先内联同名逻辑，任务 2 抽取后改 import
  if (conflict !== undefined) return conflict
  for (const [id, role] of Object.entries(roles)) {
    if (typeof role.label !== 'string' || role.label.length === 0) return `roles.${id}.label 不能为空`
    if (typeof role.target?.provider !== 'string' || role.target.provider.length === 0) return `roles.${id}.target.provider 不能为空`
    if (typeof role.target?.model !== 'string' || role.target.model.length === 0) return `roles.${id}.target.model 不能为空`
  }
  const d = raw.driver
  if (d !== undefined && d !== null && (typeof d.provider !== 'string' || d.provider.length === 0 || typeof d.model !== 'string' || d.model.length === 0)) return 'driver 目标不完整'
}
```
4. `mergeResolved`（`:235-248`）：默认基座换 `DEFAULT_CONFIG_V6()`；`:245` 的 flows 收窄条件由 `version !== 5` 改为 `!isV5Plus(...)`（`isV5Plus` 自 `config.js` 引入）。

`settings-port.ts`：`:143` `isLegacyRouterShape` 的 `version !== 5` → `!isV5Plus(raw)`；`:157` `hasExplicitV5Config` 的 `version === 5` → `isV5Plus(...)`。

`index.ts:971-990`：`hasKimiTideResidueV5` → `hasKimiTideResidueV6`、`coerceRouterConfigV5` → `coerceRouterConfigV6`、留档后缀 `.pre-v5` → `.pre-v6`（`copyFileSync` 那行 `:977`）。
`settings-migration.ts:47`：改用 `coerceRouterConfigV6`。

**版本落点加宽清单**（逐处把「只认 v5」改成 `isV5Plus`，语义不变）：`router.ts:116`（`RouterConfigAny` 并入 `RouterConfigV6`）、`:120`/`:1378`/`:1394`（`config.version === 5 ? config.flows : {}` → `isV5Plus(config) ? config.flows : {}`）、`rules.ts:261`/`:316`（`config.version !== 5` 早退 → `!isV5Plus(config)`）、`commands.ts:221`/`:272`/`:377`、`client/card-store.ts:42`（`CardConfig` 并入 v6）/`:311`/`:469`、`client/help-content.ts:17`（`HelpConfig` 并入 v6）/`:90`、`client/HelpTab.tsx:31`、`client/SettingsCard.tsx:626`/`:664`（`isV5` 改名 `isV5Plus` 并加宽）。

- [ ] **步骤 12：跑测试看绿 + 全量**

运行：`npm test -- test/schema-probe.test.ts test/settings-schema.test.ts test/settings-port.test.ts`，再 `npm test`、`npm run typecheck`
预期：PASS / 全绿 / 0 错误。若 `test/help-content.test.ts:88-98` 因 schema 顶层新键报红，则按该闸要求把 `driver` / `driverSticky` / `rulesApplyToChildren` / `roles` 加进 `client/help-content.ts:42-64` 的 `FEATURE_KEYS` **首段**（帮助正文的完整条目留到任务 7）。

- [ ] **步骤 13：提交**

```bash
git add packages/dsh-kimi-tide/src packages/dsh-kimi-tide/test
git commit -m "feat(config): 配置 v6 —— 新增 driver/driverSticky/rulesApplyToChildren/roles + 迁移链 v5→v6（存量保持旧行为）"
```

---

### Task 2：分工表纯函数层 `src/roles.ts`

**Files：**
- 新建：`packages/dsh-kimi-tide/src/roles.ts`
- 测试：`packages/dsh-kimi-tide/test/roles.test.ts`（新建）

**Interfaces：**
- 消费（任务 1）：`RoleEntry`、`RouterConfigV6`、`RouteTarget`
- 产出：
  - `roleClaimSet(role: RoleEntry): Set<string>`
  - `claimConflict(roles: Record<string, RoleEntry>): string | undefined`
  - `lookupRoleByTeammate(roles: Record<string, RoleEntry>, name: string): RoleEntry | undefined`
  - `resolveRoleDecision(roles, membership): { role: RoleEntry; name: string } | undefined`
  - `dispatchMetaOf(membership, roleHit, decision): DispatchMeta`
  - `renderTeamSkill(roles): { description: string; body: string } | undefined`
  - `TEAMMATE_NAME_RULE: string`

- [ ] **步骤 1：写失败测试**

新建 `test/roles.test.ts`：

```ts
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
```

- [ ] **步骤 2：跑测试看红**

运行：`npm test -- test/roles.test.ts`
预期：FAIL —— `Cannot find module '../src/roles.js'`。

- [ ] **步骤 3：实现 `src/roles.ts`**

```ts
/**
 * 分工表纯函数层（设计稿 D2/D5/D7）。
 * 无副作用、不碰宿主服务 —— pre-step 闭包与设置页写通道共用同一套判据。
 */
import type { RoleEntry, RouterConfigV6 } from './config.js'

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

/** 派发依据判定（优先级：role > unclaimed > explicit > keep）。 */
export function dispatchMetaOf(
  membership: { role: string; name: string } | undefined,
  roleHit: { role: RoleEntry; name: string } | undefined,
  decision: { kind: string; via?: string },
): DispatchMeta {
  if (roleHit !== undefined) return { basis: 'role', teammate: roleHit.name, roleLabel: roleHit.role.label }
  if (membership !== undefined && membership.role === 'teammate') return { basis: 'unclaimed', teammate: membership.name }
  if (decision.kind === 'route' && decision.via === 'explicit') return { basis: 'explicit' }
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
```

- [ ] **步骤 4：跑测试看绿**

运行：`npm test -- test/roles.test.ts`
预期：PASS。

- [ ] **步骤 5：把任务 1 内联的冲突判定改为引用本模块**

`settings-schema.ts` 里任务 1 内联的 `claimConflict` 改为 `import { claimConflict } from './roles.js'`（删除内联实现），跑 `npm test -- test/settings-schema.test.ts` 确认仍绿。

- [ ] **步骤 6：提交**

```bash
git add packages/dsh-kimi-tide/src/roles.ts packages/dsh-kimi-tide/src/settings-schema.ts packages/dsh-kimi-tide/test/roles.test.ts
git commit -m "feat(roles): 分工表纯函数层 —— 认领集合/冲突判定/队友反查/派发依据/skill 正文生成"
```

---

### Task 3：分工表注册成宿主 runtime skill `src/team-skill.ts`

**Files：**
- 新建：`packages/dsh-kimi-tide/src/team-skill.ts`
- 修改：`packages/dsh-kimi-tide/src/index.ts`（`ctx.skills` 探测 + 配置变更时重挂）
- 测试：`packages/dsh-kimi-tide/test/team-skill.test.ts`（新建）

**宿主契约依据**（已核实）：`dsh-skill/lib/types/index.d.ts:78-84` —— `SkillRegistration = Omit<SkillDefinition,'invocation'|'provider'> & { invocation?; provider? }`；`SkillDefinition.content` 是 Markdown 正文（`:74`）；`source` 取值含 `'runtime'`（`:24`）；`register(skill): () => void` 返回 disposer（`:257`）。

**Interfaces：**
- 消费：`renderTeamSkill`（任务 2）、`RoleEntry`（任务 1）
- 产出：`installTeamSkill(skills, roles, log): TeamSkillHandle`；`TeamSkillHandle { installed: boolean; dispose: () => void }`；`TEAM_SKILL_NAME = 'kimi-tide-team'`

- [ ] **步骤 1：写失败测试**

新建 `test/team-skill.test.ts`：

```ts
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
```

- [ ] **步骤 2：跑测试看红**

运行：`npm test -- test/team-skill.test.ts`
预期：FAIL —— `Cannot find module '../src/team-skill.js'`。

- [ ] **步骤 3：实现 `src/team-skill.ts`**

```ts
/**
 * 分工表 → 宿主 runtime skill（设计稿 D3）。
 * 用本地结构化类型描述 ctx.skills 的最小子集：本插件不依赖 dsh-skill 包。
 */
import type { RoleEntry } from './config.js'
import { renderTeamSkill } from './roles.js'

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
): TeamSkillHandle {
  if (skills === undefined) return NOOP
  const rendered = renderTeamSkill(roles)
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
```

- [ ] **步骤 4：跑测试看绿**

运行：`npm test -- test/team-skill.test.ts`
预期：PASS。

- [ ] **步骤 5：接进 `index.ts` 装配（探测 + 配置变更重挂）**

在插件 `apply()` 作用域（`index.ts:597` `imageStates` 附近）加：

```ts
/** ctx.skills 探测（cordis 服务缺席时访问即抛 → 必须 try/catch 并缓存，见设计稿 §4）。 */
type SkillsProbe = { register?: SkillsLike['register'] }
function probeSkills(ctx: unknown): SkillsLike | undefined {
  try {
    const skills = (ctx as { skills?: SkillsProbe }).skills
    return typeof skills?.register === 'function' ? (skills as SkillsLike) : undefined
  } catch {
    return undefined
  }
}
```

在 `applyConfig`（`index.ts:723-735`）内、`mountRouter()`（`:732`）之后加：

```ts
teamSkill?.dispose()
teamSkill = installTeamSkill(skillsService, config.version === 6 ? config.roles : {}, log)
```

其中 `skillsService` 在 `apply()` 开头探一次（`const skillsService = probeSkills(ctx)`），`teamSkill` 用插件级 `let` 持有；dispose 时释放（与 `disposeRouter` 同处）。

- [ ] **步骤 6：跑全量 + 类型检查**

运行：`npm test`、`npm run typecheck`
预期：全绿 / 0 错误（新增 `index.ts` 代码不改变既有行为，无新测试红线）。

- [ ] **步骤 7：提交**

```bash
git add packages/dsh-kimi-tide/src/team-skill.ts packages/dsh-kimi-tide/src/index.ts packages/dsh-kimi-tide/test/team-skill.test.ts
git commit -m "feat(team): 分工表注册为宿主 runtime skill —— 探测降级 + 配置变更重挂"
```

---

### Task 4：路由核心（`via:'role'` + 主驱动恒定 + 子代理跳关键词规则）

**Files：**
- 修改：`packages/dsh-kimi-tide/src/router.ts`（`RouteDecision` 的 `via` 联合、`decide` 第 5 可选参、pre-step 闭包 role 分支与 driverSticky、`installRouter` deps 增 `teamLookup`、槽位增 `dispatch`）
- 修改：`packages/dsh-kimi-tide/src/index.ts`（`ctx.agentTeams` 探测 → `teamLookup`）
- 测试：`packages/dsh-kimi-tide/test/router.test.ts`（追加）

**接入点（侦察实读，行号锚点）：** `RouteDecision` `:65-68`（`via` 联合在 `:66`）｜`decide` 签名 `:295`｜打底构造点 `:397`｜hitConfirm 闸块 `:805-836`（守卫在 `:805`）｜规则链 `:344-394`｜三个 `decide` 调用点 `:839`/`:857`/`:869`（**必须同传新参**）｜pre-step 监听器 `:763-961`（`step` 门控 `:772`、`payload.agent` `:773`）｜槽写入 `:956`｜`applyTo` `:420-423`｜`shouldKeepExternalTarget` `:523-527`（首行 `via !== 'default'` ⇒ `via:'role'` 天然不被让位）｜`effortForTarget` 调用点 `:433`/`:1028`（role 走同一条 `replaceRoute` 通道，effort 语义自动一致）。

**Interfaces：**
- 消费：`resolveRoleDecision` / `dispatchMetaOf` / `DispatchMeta`（任务 2）、`isV5Plus`（任务 1）
- 产出：`RouteDecision` 的 `via` 联合新值 `'role'`；`decide(..., opts?: { skipKeywordRules?: boolean })`；`installRouter` deps 新字段 `teamLookup?: (agent: Agent) => { role: string; name: string } | undefined`；槽位类型 `{ decision; hasImage; dispatch?: DispatchMeta }`

- [ ] **步骤 1：写失败测试（纯函数与决策层）**

在 `test/router.test.ts` 追加（复用该文件既有的 `cfg5`/`cfg5WithFlowRule`/`METAS` 夹具，新增 `cfg6`）：

```ts
const cfg6 = (active: string | null, over: Partial<RouterConfigV6> = {}): RouterConfigV6 => {
  const c = DEFAULT_CONFIG_V6(); c.activePreset = active; return { ...c, ...over }
}

describe('v2.0.0：via:\'role\' 与 shouldKeepExternalTarget', () => {
  it('role 决策不被 B-1a 让位吞掉（首行 via !== default 守卫）', () => {
    const d = { kind: 'route' as const, target: { provider: 'kimi-coding', model: 'k3' }, reason: 'r', via: 'role' as const }
    expect(shouldKeepExternalTarget(d, { provider: 'deepseek-official', model: 'deepseek-flash' }, childAgent())).toBe(false)
  })
})

describe('v2.0.0：子代理跳关键词规则（D6）', () => {
  it('skipKeywordRules 跳过关键词规则，但图像规则仍生效', () => {
    const c = cfg6('saving', { presets: { saving: { name: '省钱', default: { provider: 'deepseek-official', model: 'deepseek-flash' }, rules: [
      { id: 'image-k3', when: { kind: 'image' }, target: { provider: 'kimi-coding', model: 'k3' } },
      { id: 'code-glm', when: { kind: 'keywords', group: 'code' }, target: { provider: 'zai-coding-cn', model: 'glm-5.3' } },
    ] } } })
    const r = new KimiRouter(c, METAS, log)
    expect(r.decide([textMsg('帮我重构这段代码')], 1, false, undefined, { skipKeywordRules: true }).kind).toBe('route')
    expect(r.decide([textMsg('帮我重构这段代码')], 1, false, undefined, { skipKeywordRules: true })).toMatchObject({ via: 'default' })
    expect(r.decide([imageMsg()], 1, false, undefined, { skipKeywordRules: true })).toMatchObject({ via: 'rule' })
  })
})

describe('v2.0.0：主驱动恒定（D1）', () => {
  it('driverSticky=false ⇒ 行为与 v1.4.1 一致（打底 = 预设默认）', () => {
    const r = new KimiRouter(cfg6('saving', { driverSticky: false }), METAS, log)
    expect(r.decide([textMsg('随便聊聊')], 1)).toMatchObject({ via: 'default', target: { provider: 'deepseek-official', model: 'deepseek-flash' } })
  })
  it('driverSticky=true ⇒ 打底目标换成 driver', () => {
    const c = cfg6('capability', { driverSticky: true, driver: { provider: 'deepseek-official', model: 'deepseek-flash' } })
    expect(new KimiRouter(c, METAS, log).decide([textMsg('随便聊聊')], 1)).toMatchObject({ via: 'default', target: { provider: 'deepseek-official', model: 'deepseek-flash' } })
  })
})
```

（说明：`driverSticky` 的**生效点在 pre-step 闭包**而非 `decide` —— 上面第二条断言的是"预设打底已是该目标"的等价形；闭包层的三变体验收在任务 8 的实机清单 A1a/A1b/A1c。`childAgent()` 是本文件新增的极简夹具：`{ id: 'c', session: { header: { delegationDepth: 1 } } } as unknown as Agent`。）

- [ ] **步骤 2：跑测试看红**

运行：`npm test -- test/router.test.ts`
预期：FAIL —— `'role'` 不在 `via` 联合（类型报错）＋ `decide` 无第 5 参。

- [ ] **步骤 3：实现 router.ts 的类型与 decide 新参**

1. `:66` 的 `via` 联合加 `'role'`：
```ts
| { kind: 'route'; target: RouteTarget; reason: string; via: 'explicit' | 'rule' | 'default' | 'role'; confirmNote?: string }
```
2. `:295` 签名加第 5 可选参，并在规则链入口按它过滤：
```ts
decide(
  messages: readonly UserMessage[],
  step: number,
  hasImageOverride?: boolean,
  omittedRuleIds?: ReadonlySet<string>,
  opts?: { skipKeywordRules?: boolean },
): RouteDecision {
  ...
  // 规则链（`:344-394`）：命中集算完后，子代理跳过关键词规则、保留图像规则
  const matched = matchingScored(...)   // 现行命中计算（`:351`），变量名以现场为准
  const effective = opts?.skipKeywordRules === true
    ? matched.filter(({ rule }) => rule.when.kind === 'image')
    : matched
  // 后续循环改用 effective（`:362-394`）
```
3. 三个调用点 `:839`/`:857`/`:869` 一并传入同一 `opts`（漏传会让跳规则失效，`:837-838` 注释同款理由）。

- [ ] **步骤 4：实现 pre-step 闭包（role 分支 + driverSticky + 槽位扩展）**

在 `installRouter` 的 pre-step 闭包内：

```ts
// 1) 子代理判定与跳规则开关（`:772` 的 step 门控之后）
const isChild = delegationDepthOf(payload.agent) > 0
const skipKeywordRules = isChild && config.rulesApplyToChildren !== true

// 2) hitConfirm 闸块（`:805`）守卫加 !skipKeywordRules —— 子代理零判官调用（评审 S7）
if (!skipKeywordRules && deps.hitConfirm !== undefined && /* 既有守卫 */) { ... }

// 3) 分工表命中（`:805-836` 之后、首个 decide `:839` 之前）
const membership = isChild ? deps.teamLookup?.(payload.agent) : undefined
const roleHit = resolveRoleDecision(config.version === 6 ? config.roles : {}, membership)

// 4) 首个 decide 带上 opts
let decision = withConfirmNote(router.decide(messages, step, hasImage, omittedRuleIds, { skipKeywordRules }))

// 5) role 覆盖：显式 @ 与 flow 决策不覆盖（优先级链 1 > 3；flow 是图像正确性通道）
if (roleHit !== undefined && decision.kind === 'route' && decision.via !== 'explicit') {
  decision = {
    kind: 'route',
    target: roleHit.role.target,
    reason: `分工表「${roleHit.role.label}」→ ${roleHit.role.target.provider}/${roleHit.role.target.model}（队友 ${roleHit.name}）`,
    via: 'role',
    ...(decision.confirmNote === undefined ? {} : { confirmNote: decision.confirmNote }),
  }
}

// 6) 主驱动恒定（仅主会话、仅打底）
if (!isChild && config.version === 6 && config.driverSticky === true && decision.kind === 'route' && decision.via === 'default') {
  decision = config.driver == null
    ? { kind: 'keep', reason: '主驱动跟随宿主默认' }
    : { ...decision, target: config.driver, reason: `${decision.reason}（主驱动）` }
}

// 7) 槽位（`:956`）带上派发元信息（请求层记账用）
slots.set(payload.agent, {
  decision,
  hasImage,
  dispatch: isChild ? dispatchMetaOf(membership, roleHit, decision) : undefined,
})
```

`deps` 类型（`:470-496` 的接口）加：
```ts
/** 队友身份查询（index.ts 从 ctx.agentTeams 探测注入；缺席即 undefined）。 */
teamLookup?: (agent: Agent) => { role: string; name: string } | undefined
```
槽位类型（`:713`）加 `dispatch?: DispatchMeta`（`import type { DispatchMeta } from './roles.js'`）。

- [ ] **步骤 5：跑测试看绿**

运行：`npm test -- test/router.test.ts`、`npm run typecheck`
预期：PASS / 0 错误。

- [ ] **步骤 6：`index.ts` 注入 teamLookup**

```ts
/** ctx.agentTeams 探测（cordis 服务缺席时访问即抛）。 */
type AgentTeamsProbe = { tryMembership?: (agent: Agent) => { role: string; name: string } | undefined }
function probeAgentTeams(ctx: unknown): AgentTeamsProbe | undefined {
  try {
    const teams = (ctx as { agentTeams?: AgentTeamsProbe }).agentTeams
    return typeof teams?.tryMembership === 'function' ? teams : undefined
  } catch {
    return undefined
  }
}
```
`apply()` 里 `const agentTeams = probeAgentTeams(ctx)`；`mountRouter()` 组装 `installRouter(ctx, router, { ...既有 deps, teamLookup: agentTeams === undefined ? undefined : (agent) => agentTeams.tryMembership!(agent) })`。

- [ ] **步骤 7：跑全量 + 提交**

运行：`npm test`、`npm run typecheck`
预期：全绿 / 0 错误。

```bash
git add packages/dsh-kimi-tide/src/router.ts packages/dsh-kimi-tide/src/index.ts packages/dsh-kimi-tide/test/router.test.ts
git commit -m "feat(router): via:'role' 分工表改道 + 主驱动恒定 + 子代理跳关键词规则（含判官零调用）"
```

---

### Task 5：派发台账（ledger + panelSnapshot + 投影 v7）

**Files：**
- 新建：`packages/dsh-kimi-tide/src/dispatch-ledger.ts`
- 修改：`packages/dsh-kimi-tide/src/index.ts`（插件级 ledger、request 层记账、`panelSnapshot` 带 `dispatch`、`agent/disposed` 清理）
- 修改：`packages/dsh-kimi-tide/src/projection.ts`（`stateVersion` 6→7、schema 加可选 `dispatch`）、`packages/dsh-kimi-tide/src/types.ts`（投影类型）
- 测试：`packages/dsh-kimi-tide/test/dispatch-ledger.test.ts`（新建）、`test/index-wiring.test.ts`（追加）

**关键事实（侦察实读）：** 面板实时数据**不走会话事件**（v1.2.0 起停写 `kimi-tide/panel`），而是 `panelSnapshot()`（`index.ts:781-821`）→ `rememberPanel`（`:835`）→ `GET /api/kimi-tide/panel`（`:902-922`）；投影 schema（`projection.ts:70-113`，`stateVersion` 在 `:178`）只服务历史回放与 wire 契约。请求监听器在 `router.ts:962-1005`（取槽 `:964`、删槽 `:966`、`applyTo` `:973`、图像护栏 `:986-991`）。

**Interfaces：**
- 消费：`DispatchMeta`（任务 2）、槽位 `dispatch`（任务 4）
- 产出：`DispatchLedger` 类；`DispatchEntry { basis; teammate?; roleLabel?; target: RouteTarget; at: number; parentSession?: string }`；`panelSnapshot().dispatch: DispatchEntry[]`

- [ ] **步骤 1：写失败测试 —— ledger**

新建 `test/dispatch-ledger.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { DispatchLedger } from '../src/dispatch-ledger.js'

const entry = (i: number, parentSession = 's1') => ({
  basis: 'role' as const, target: { provider: 'kimi-coding', model: 'k3' }, at: i, parentSession,
})

describe('DispatchLedger', () => {
  it('按父会话过滤、按时间倒序、上限 20', () => {
    const ledger = new DispatchLedger()
    for (let i = 0; i < 25; i++) ledger.record(entry(i))
    ledger.record(entry(99, 's2'))
    const s1 = ledger.recentFor('s1')
    expect(s1).toHaveLength(20)
    expect(s1[0]!.at).toBe(24)          // 最新在前
    expect(ledger.recentFor('s2')).toHaveLength(1)
  })

  it('dropAgent 清掉该 agent 的记账（agent/disposed 用）', () => {
    const ledger = new DispatchLedger()
    ledger.record({ ...entry(1), agentId: 'a1' })
    ledger.record({ ...entry(2), agentId: 'a2' })
    ledger.dropAgent('a1')
    expect(ledger.recentFor('s1').every((e) => e.agentId !== 'a1')).toBe(true)
  })
})
```

- [ ] **步骤 2：跑测试看红**

运行：`npm test -- test/dispatch-ledger.test.ts`
预期：FAIL —— `Cannot find module '../src/dispatch-ledger.js'`。

- [ ] **步骤 3：实现 `src/dispatch-ledger.ts`**

```ts
/**
 * 派发台账（设计稿 D7）。
 * 插件级、活过路由器配置重挂载（对照 imageStates，`index.ts:597`）、不落盘、不跨宿主重启。
 * 用可枚举的全局 FIFO 数组（面板要按父会话聚合，WeakMap 不可枚举）；条目只存字符串 id，不持 Agent 引用。
 */
import type { RouteTarget } from './config.js'
import type { DispatchBasis } from './roles.js'

export interface DispatchEntry {
  basis: DispatchBasis
  teammate?: string
  roleLabel?: string
  target: RouteTarget
  at: number
  parentSession?: string
  agentId?: string
}

const CAP = 20

export class DispatchLedger {
  private readonly entries: DispatchEntry[] = []

  record(entry: DispatchEntry): void {
    this.entries.push(entry)
    if (this.entries.length > CAP) this.entries.splice(0, this.entries.length - CAP)
  }

  /** 某会话（通常 = Lead 会话 id）名下的最近 20 条，最新在前。 */
  recentFor(sessionId: string): readonly DispatchEntry[] {
    return this.entries.filter((e) => e.parentSession === sessionId).slice().reverse()
  }

  dropAgent(agentId: string): void {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i]!.agentId === agentId) this.entries.splice(i, 1)
  }
}
```

- [ ] **步骤 4：跑测试看绿**

运行：`npm test -- test/dispatch-ledger.test.ts`
预期：PASS。

- [ ] **步骤 5：写失败测试 —— 面板快照带 dispatch**

在 `test/index-wiring.test.ts` 追加（复用该文件既有的假宿主 `makeSettings`）：

```ts
it('panelSnapshot 带 dispatch：子代理的派发行按父会话聚合到 Lead', async () => {
  // 断言要点：快照对象含 dispatch 数组；无派发时为空数组（不是 undefined）
  expect(Array.isArray(snapshot.dispatch)).toBe(true)
})
```
（该文件已有构造 `resolveRouter`/`makeSettings` 的范式，`index-wiring.test.ts:9-15,64-78`；按现场变量名落位。）

- [ ] **步骤 6：接线（index.ts + projection.ts + types.ts）**

1. `index.ts` 插件作用域：`const dispatchLedger = new DispatchLedger()`（`imageStates` 旁，`:597`）。
2. `router.ts` 请求监听器（`:962-1005`）在**图像护栏之后**记账（此处 `slot` 尚未被丢弃，取槽后先留引用）：

```ts
// 记账（设计稿 D7）：只在子代理轮、且 pre-step 产生过 dispatch 元信息时记一条
if (slot?.dispatch !== undefined) {
  deps.onDispatch?.(agent, {
    ...slot.dispatch,
    target: { provider: applied.provider, model: applied.model, ...(applied.reasoningEffort === undefined ? {} : { effort: applied.reasoningEffort }) },
    at: Date.now(),
    parentSession: (agent as unknown as { session?: { header?: { parentSession?: string } } }).session?.header?.parentSession,
    agentId: (agent as unknown as { id?: string }).id,
  })
}
```
`deps` 加 `onDispatch?: (agent: Agent, entry: DispatchEntry) => void`；`index.ts` 注入 `onDispatch: (_agent, entry) => dispatchLedger.record(entry)`。
3. `panelSnapshot()`（`:781-821`）：在 `lastFlowEvent`（`:818-819`）旁加 `dispatch: dispatchLedger.recentFor(sessionIdOf(agent))`；`sessionIdOf` 用 `(agent as unknown as { session?: { id?: string } }).session?.id ?? (agent as unknown as { id?: string }).id`（**实现时按 Agent 类型面核对**：roster.js 用的是 `agent.id`）。
4. `agent/disposed`（`:878-881`）调 `dispatchLedger.dropAgent(agent.id)`。
5. `projection.ts`：`:178` `stateVersion: 6` → `7`；`panelSchema`（`:70-113`）加可选字段（照 `lastFlowEvent` `:112`）：
```ts
dispatch: z.array(z.object({
  basis: z.enum(['role', 'explicit', 'keep', 'unclaimed']),
  teammate: z.string().optional(),
  roleLabel: z.string().optional(),
  target: z.object({ provider: z.string(), model: z.string(), effort: z.string().optional() }),
  at: z.number(),
  parentSession: z.string().optional(),
})).max(20).optional(),
```
6. `types.ts`（`:108-144`）`KimiTidePanelProjection` 加同名可选 `dispatch`（复用 `DispatchEntry`）。

- [ ] **步骤 7：跑全量 + 提交**

运行：`npm test`、`npm run typecheck`
预期：全绿 / 0 错误。

```bash
git add packages/dsh-kimi-tide/src packages/dsh-kimi-tide/test
git commit -m "feat(dispatch): 派发台账 + 面板快照 dispatch 字段 + 投影 stateVersion 7"
```

---

### Task 6：dock 派发区（摘要行 + 明细）

**Files：**
- 修改：`packages/dsh-kimi-tide/src/client/TideDock.tsx`（r2 加 `data-kt-el="dispatch"` 摘要行；向 `ReasonPanel` 传 dispatch）
- 修改：`packages/dsh-kimi-tide/src/client/ReasonPanel.tsx`（明细列表，照 `:52` 的「最近流事件」行）
- 修改：`packages/dsh-kimi-tide/src/client/help-content.ts`（`DOCK_ELEMENTS` `:27-31` + `HELP_SECTIONS` 锚点）
- 修改：`packages/dsh-kimi-tide/src/client/styles.ts`（`.kt-dispatch`）
- 测试：`packages/dsh-kimi-tide/test/TideDock.test.tsx`（追加）

**落点（侦察实读）：** r2 里 `image-context`（`TideDock.tsx:680-691`）之后、`<span className="kt-dock-r2-end">`（`:693`）之前；两个悬浮层传参处 `:760-774`（`decision` `:768`、`lastFlowEvent` `:770`）。**新锚点必须同时进 `DOCK_ELEMENTS` 与 `HELP_SECTIONS`**，否则 `test/TideDock.test.tsx:366-…`（锚点三态并集闸）与 `test/help-content.test.ts:63-77` 报红。

- [ ] **步骤 1：写失败测试**

在 `test/TideDock.test.tsx` 追加：

```tsx
it('派发区：有派发时显示最新一条摘要（角色/队友 → 模型 · 依据）', () => {
  renderDock({ dispatch: [{ basis: 'role', teammate: 'frontend', roleLabel: '前端', target: { provider: 'kimi-coding', model: 'k3' }, at: 1 }] })
  const el = document.querySelector('[data-kt-el="dispatch"]')
  expect(el?.textContent).toContain('前端')
  expect(el?.textContent).toContain('kimi-coding/k3')
})

it('派发区：无派发时不渲染该锚点', () => {
  renderDock({ dispatch: [] })
  expect(document.querySelector('[data-kt-el="dispatch"]')).toBeNull()
})
```
（`renderDock` 用该文件既有的渲染助手/夹具，按现场写法落位。）

- [ ] **步骤 2：跑测试看红**

运行：`npm test -- test/TideDock.test.tsx`
预期：FAIL —— 找不到 `[data-kt-el="dispatch"]`。

- [ ] **步骤 3：实现 UI**

`TideDock.tsx` 摘要格式化（纯函数便于单测）：

```ts
/** 派发行摘要：角色/队友 → provider/model · 依据。 */
export function formatDispatch(entry: DispatchEntry): string {
  const who = entry.roleLabel ?? entry.teammate ?? (entry.basis === 'explicit' ? '点名' : entry.basis === 'unclaimed' ? `未在分工表` : '继承')
  return `${who} → ${entry.target.provider}/${entry.target.model} · ${entry.basis}`
}
```
渲染（r2 内、`image-context` 之后）：
```tsx
{dispatch.length > 0 && (
  <span className="kt-slot kt-dispatch" data-kt-el="dispatch" title="最近一次派发">
    {formatDispatch(dispatch[0]!)}
  </span>
)}
```
`ReasonPanel` 增 `dispatch` 属性，明细照 `:52` 风格逐行渲染（最多 20 条，倒序已在 ledger 侧完成）。
`help-content.ts`：`DOCK_ELEMENTS` 加 `{ id: 'dispatch', label: '派发', description: '最近一次把专项活派给哪个角色的模型，以及依据' }`；`HELP_SECTIONS` 加对应锚点条目。
`styles.ts`：`.kimi-tide-dock .kt-dispatch { … }`（同 `.kt-slot` 字号，超长省略号）。

- [ ] **步骤 4：跑测试看绿 + 门禁**

运行：`npm test -- test/TideDock.test.tsx test/help-content.test.ts`
预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add packages/dsh-kimi-tide/src/client packages/dsh-kimi-tide/test/TideDock.test.tsx
git commit -m "feat(dock): 派发区摘要行与明细 + 帮助锚点与样式"
```

---

### Task 7：设置页角色编辑器（分工表）

**Files：**
- 修改：`packages/dsh-kimi-tide/src/client/SettingsCard.tsx`（「路由」页内新增 `<details className="kt-card">` 分工表卡，照关键词组卡 `:1223-1251` 的形态与组件）
- 修改：`packages/dsh-kimi-tide/src/client/card-store.ts`（`saveRoles` 守卫式写通道 + 接口/导出/`storeWriter` 登记 + `CardConfig` 并入 v6）
- 修改：`packages/dsh-kimi-tide/src/client/help-content.ts`（`SETTINGS_SECTIONS` 加「分工表」锚点与说明条目）
- 测试：`packages/dsh-kimi-tide/test/card-store.test.ts`（追加）、`test/SettingsCard.dom.test.tsx`（追加）

**写通道范式（侦察实读）：** `saveTop(field, value)`（`card-store.ts:385-416`：`scope.set` 或 `settings.mutate` + 写后「意图值 vs 实读值」比对）；守卫式拒绝范式见 `deleteFlow`（`:467-499`：不合法则 `fail()` **不写盘**）；`storeWriter` 包装表在 `:550-575`；接口 `:155-183`；导出对象 `:517-543`。

- [ ] **步骤 1：写失败测试 —— 写通道（含认领冲突拒绝）**

在 `test/card-store.test.ts` 追加：

```ts
it('saveRoles：认领名冲突 ⇒ 拒绝且不落盘（fail 不写）', async () => {
  const store = makeStore(makeScope(DEFAULT_CONFIG_V6()))
  const bad = { a: { id: 'a', label: 'A', target: { provider: 'p', model: 'm' }, teammate: ['x'] },
                b: { id: 'b', label: 'B', target: { provider: 'p', model: 'm' }, teammate: ['x'] } }
  await expect(store.saveRoles(bad)).rejects.toThrow(/认领名/)
  expect(store.getConfig()!.roles).toEqual({})          // 未写入
})

it('saveRoles：合法分工表写入成功并回读一致', async () => {
  const store = makeStore(makeScope(DEFAULT_CONFIG_V6()))
  const roles = { frontend: { id: 'frontend', label: '前端', target: { provider: 'kimi-coding', model: 'k3' } } }
  await store.saveRoles(roles)
  expect(store.getConfig()!.roles).toEqual(roles)
})
```
（`makeStore`/`getConfig` 用该文件既有范式；`makeScope` 在 `:9-26`，其写入前替身会跑 `validateRouterConfig`。）

- [ ] **步骤 2：跑测试看红**

运行：`npm test -- test/card-store.test.ts`
预期：FAIL —— `store.saveRoles is not a function`。

- [ ] **步骤 3：实现 `saveRoles`**

`card-store.ts`：

```ts
const saveRoles = async (roles: Record<string, RoleEntry>): Promise<void> => {
  const conflict = claimConflict(roles)
  if (conflict !== undefined) return fail(conflict)      // 守卫式拒绝：不写盘（照 deleteFlow 范式）
  await saveTop('roles', roles)
}
```
接口声明（`:155-183`）与导出对象（`:517-543`）各加一条；`storeWriter` 包装表（`:550-575`）加 `saveRoles: wrap('saveRoles')`；`CardConfig`（`:42`）并入 `RouterConfigV6`；`HelpConfig`（`help-content.ts:17`）并入 v6。

- [ ] **步骤 4：跑测试看绿**

运行：`npm test -- test/card-store.test.ts`
预期：PASS。

- [ ] **步骤 5：写失败测试 —— 编辑器渲染**

在 `test/SettingsCard.dom.test.tsx` 追加：

```tsx
it('分工表卡：渲染角色行；点示例按钮填入前端/后端/写作三个角色', async () => {
  renderCard(DEFAULT_CONFIG_V6())
  expect(screen.getByText('分工表')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '填入三条示例' }))
  expect(screen.getAllByLabelText('角色显示名').length).toBe(3)
})
```
（复用该文件既有的渲染与交互范式，按现场 API 落位。）

- [ ] **步骤 6：实现编辑器 UI**

在「路由」页内（关键词组卡 `:1223-1251` 之后）加：

```tsx
<details className="kt-card" data-kt-section="roles">
  <summary>分工表（专项活派给谁）</summary>
  <p className="kt-hint">每个角色 = 一个领域 → 一个模型。队友名用 kebab-case（如 frontend），名字要写进「队友名」列，月汐据此改道。</p>
  {roleRows.map((role) => (
    <div className="kt-role-row" key={role.id}>
      <input aria-label="角色显示名" value={role.label} onChange={…} />
      <input aria-label="角色 id" value={role.id} onChange={…} />
      <TargetSelect value={role.target} onChange={…} />      {/* 复用 :147-199 */}
      <EffortSelect value={role.target.effort} onChange={…} />{/* 复用 :201-229 */}
      <input aria-label="队友名" value={(role.teammate ?? []).join(',')} onChange={…} />
      <input aria-label="别名" value={(role.aliases ?? []).join(',')} onChange={…} />
      <button onClick={() => void store.saveRoles(removeRole(roleRows, role.id))}>删除</button>
    </div>
  ))}
  <button onClick={() => void store.saveRoles([...roleRows, newRole()])}>新增角色</button>
  <button onClick={() => void store.saveRoles(EXAMPLE_ROLES())}>填入三条示例</button>
</details>
```
`EXAMPLE_ROLES()`（`roles.ts` 导出，纯数据）：`frontend`（前端）/`backend`（后端）/`writer`（写作），`target` 用空字符串占位并提示用户从下拉选（`TargetSelect` 允许未选中的占位态；若组件不支持空目标，则示例填入后立即以默认候选池首个可用目标兜底——**实现时按 `TargetSelect` 现状定夺并在测试里钉住**）。
hooks 纪律：新增 `useState` 必须在该组件既有的 `config === null` 提前返回（`:577-585`）之前；`help-content.ts` 的 `SETTINGS_SECTIONS`（`:34-36`）加「分工表」条目。

- [ ] **步骤 7：跑测试看绿 + 门禁 + 提交**

运行：`npm test -- test/SettingsCard.dom.test.tsx test/card-store.test.ts test/help-content.test.ts`，再 `npm test`、`npm run typecheck`、`npm run build`
预期：PASS / 全绿 / 0 错误 / 构建通过。

```bash
git add packages/dsh-kimi-tide/src/client packages/dsh-kimi-tide/test
git commit -m "feat(settings): 分工表角色编辑器 + saveRoles 守卫式写通道（认领冲突拒写）"
```

---

### Task 8：文档 + 实机验收 runbook

**Files：**
- 修改：`packages/dsh-kimi-tide/docs/router.md`（新增「2.0.0 团队派发」节）
- 修改：`docs/superpowers/specs/2026-10-05-team-dispatch-design.md`（仅追加「实施记录」指针行，不动正文；若实施中发现设计偏差，回写该节并注明）
- 不动：`README.md` / `README.en.md` / `CHANGELOG.md` / 版本号（发版 runbook 处理）

- [ ] **步骤 1：写文档**

`docs/router.md` 新增节（放在末节之后）：v6 字段表（`driver`/`driverSticky`/`rulesApplyToChildren`/`roles`）、优先级链五档、`via:'role'` 的判定与原因串格式、主驱动恒定的两条边界（`driver=null`；`activePreset=null` 时不生效）、子代理跳关键词规则与判官零调用、派发台账与面板字段、迁移口径（存量 `driverSticky:false`）。

- [ ] **步骤 2：跑仓库门禁**

运行（仓库根）：`npm run check`
预期：三绿（版本三方一致 / 114+ md 0 断链 / README 双语骨架一致）。

- [ ] **步骤 3：实机验收 runbook（发版门禁，逐条留证）**

在真实宿主（桌面端，Agent Teams 组合包已启用）逐条执行；每条以**子/主会话日志的 `request/header`** 为证据：

```bash
node scripts/acceptance/session-dump.mjs <会话目录>/session.v4.jsonl.zstd --grep 'request/header'
```

| # | 判据 | 操作 | 预期证据 |
|---|---|---|---|
| A1a | 主会话打底＝driver | `driverSticky: true` ＋ `driver: {deepseek-official/deepseek-flash}`；发一条无关键词消息 | 首个 `request/header` = `deepseek-official/deepseek-flash` |
| A1b | `driver=null` 时跟随宿主默认 | 同上但 `driver: null` | 请求头 = 宿主 `agent-default-model`（flash） |
| A1c | 关键词轮规则仍赢 | 发「帮我重构这段代码」 | 请求头 = 规则目标（glm-5.3），不是 driver |
| A2 | **队友按分工表改道（最高优先）** | 配 role `frontend` → `kimi-coding/k3`；建队友 `frontend` | 队友子会话 `request/header` = `kimi-coding/k3`；主面板派发行 basis=`role` |
| A3 | 一次性派发不被劫持 | `workflow` 调 `agent('帮我重构这段代码…', {provider:'kimi-coding',model:'k3'})` | 子会话请求头 = `kimi-coding/k3`（任务描述**必须含关键词组词**，否则判据失效） |
| A4 | 分工表进目录且可加载 | 新会话看 `<available_skills>`；调 `skill('kimi-tide-team')` | 目录含 `kimi-tide-team`（description ≤500）；正文含角色表与配方。反向：roles 空 ⇒ 目录中无该 skill；roles 变更 ⇒ 下一 pre-step 出现目录替换消息 |
| A5 | 未认领队友 | 建队友 `probe-x`（不在任何认领列） | 不改道（继承 flash）＋ 面板该行 basis=`unclaimed` |
| A6 | role 目标不可用 | 把 role 目标改成一个未挂载 provider | 不改道 ＋ 面板提示（无静默换人） |
| A7 | 存量兼容 | 用 v5 配置启动（迁移后） | 主会话路由行为与 v1.4.1 逐字节一致；`driverSticky` 落为 `false` |
| A8 | 多队友并发 | 两个队友分属不同 role 同时跑 | 两路请求头各自命中各自 role 目标 |

- [ ] **步骤 4：提交**

```bash
git add packages/dsh-kimi-tide/docs/router.md docs/superpowers/specs/2026-10-05-team-dispatch-design.md
git commit -m "docs(router): 团队派发（v6 配置 / via:'role' / 主驱动恒定 / 派发台账）架构说明 + 实机验收 runbook 登记"
```

---

## 自检记录（写计划时对照设计稿逐节核过）

- **范围与设计稿对应**：D1 主驱动恒定 → 任务 4；D2 分工表配置 → 任务 1＋2＋7；D3 skill 注入 → 任务 2（正文）＋3（注册）；D4 一次性派发不造工具＋观测 → 任务 5（记账）；D5 队友改道 → 任务 4；D6 子代理跳关键词规则 → 任务 4；D7 留痕 → 任务 5＋6；D8 护栏 → 复用既有降级/支持集判定（任务 4 沿用 `replaceRoute` 通道，无新代码）。
- **两处与设计稿的显式差异**（已在此声明，供评审/用户复核）：
  1. §4 原文「迁移不写 `driverSticky`」→ 本计划改为**迁移显式写 `driverSticky: false`**。原因：新装默认 `true` 必须由 `DEFAULT_CONFIG_V6()` 提供，若迁移不写、默认基座又有 `true`，存量用户会被 `deepMerge` 注入 `true`，违背「存量保持旧行为」的裁定。写 `false` 是**已裁定值**（§8-1 落地口径），不属评审 B2 所禁的「写未裁定值」。
  2. D4 的 `subagent/start|end` 订阅**未进本计划**：任务 5 在请求层记账，记录的是**实际生效模型**（比 start 事件的 provider 名更真），已覆盖 D4「看得见」的目标；`start|end` 订阅留作后续增强（若需要"派发耗时/成败"再加）。
- **占位符扫描**：无 TBD/TODO；每个代码步骤都是可直接落位的实现或明确的"按现场变量名落位 + 行号锚点"。
- **类型一致性**：`RoleEntry`/`RouterConfigV6`/`DispatchMeta`/`DispatchEntry`/`TeamSkillHandle`/`SkillsLike`/`claimConflict`/`renderTeamSkill`/`resolveRoleDecision`/`dispatchMetaOf` 在任务 1→7 中命名与签名一致。
- **已知待现场核对项**（执行时按下述方法确认，不要猜）：① `Agent.session.id` 与 `agent.id` 哪个是会话 id（`index.ts` 记账与 `panelSnapshot` 聚合用；roster.js 用 `agent.id`）；② `matchingScored`/规则循环的真实变量形状（任务 4 步骤 3）；③ `TargetSelect` 是否支持"未选目标"的占位态（任务 7 步骤 6）。
