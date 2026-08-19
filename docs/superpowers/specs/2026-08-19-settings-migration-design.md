# 设置界面迁移：月汐路由器设置迁至 DSH 官方设置页

> 状态：**已评审**，实施计划见 [`../plans/2026-08-19-settings-migration-implementation.md`](../plans/2026-08-19-settings-migration-implementation.md)（2026-08-19 设计稿）
> 决策出处：用户 2026-08-19 指派「先把 tide 插件设置转到官方设置页面再做后续」；
> 关键决策经用户选择：持久化路径=**B 原生设置命名空间**；拆分边界=**全迁卡片、dock 留读出口**。
> 依赖：DSH `dsh-client-ui-settings` / `dsh-settings`（rc.7 起提供，本机已装，接口实读锚点见下）。

## 1. 目标与非目标

**目标**：把月汐 dock 面板内的路由器设置表单整体迁至 DSH 原生设置面板的「月汐」卡片
（`settings.section`）；路由配置持久化从 sidecar 文件迁至 DSH 设置文档的原生命名空间
（revision 冲突检测 + base/user 分层 + document-updated 推送）；dock 面板退化为只读仪表。

**非目标**：
- 不改路由器决策语义（classify/selectCandidate/护栏不变，仅配置来源变化）
- 不做设置项增删（表单字段与现有 RouterConfigV2 一一对应）
- 不处理远程浏览器持久化（settingsScope 对远程客户端为 memory 模式，本机 loopback 不受影响；与现状一致）

## 2. 现状（2026-08-19，main @ 0d15689）

- 表单内嵌 dock（`src/client/TideDock.tsx` v3：mode/候选/评分/ReasonPanel），写路径 =
  `ctx.remote.commands.execute('/kimi-tide …')`（`src/client/index.ts` L15-17 桥接）→ 宿主命令
  （`src/commands.ts`）→ sidecar 文件 `$DSH_HOME/profiles/web/kimi-tide-router.yml`（`src/sidecar.ts`）
- 宿主读路径：启动时 `sidecar.load()`（`src/index.ts` L323）一次性；面板/命令保存走
  `onSaved` 热更新（L375-384：换配置 → 清决策摘要 → mountRouter → 刷新候选 → 推面板）
- 分层现状：sidecar > patch.yml `router` 静态块 > DEFAULT_CONFIG_V2；patch 块已被 0.3.0 降级为
  legacy 种子（sidecar 优先生效）
- 配置形状：`RouterConfigV2`（`src/config.ts`）13 字段：version(2)/mode/default/candidates/
  scores/classify/allowedProviders/costTiers/routeThreshold/lambda/premiumBudget/budgetWindow/
  charsPerToken

## 3. 目标架构

### 3.1 客户端：官方设置卡片

注册模式照抄官方 Models 页先例（`@deepseek-ai/dsh-client-ui-settings-models/lib/client.js`
L2714-2720，rc.7 实读）：

```ts
// client 插件 inject 增加 'locale'/'connection'（现有：slots/remote/remote.commands）
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'kimi-tide-router',
  order: 100,
  label: () => t('nav'),        // locale 绑定，与官方一致
  inject: injected,             // () => ({ scope, useSnapshot, t, models, … })
}, SettingsCard))
```

- 槽位契约（`dsh-client-ui-settings/lib/types/client/contract/slots.d.ts` L67-71）：kind list /
  scope root；owner props 仅 `{ close }`；选项 id/order/label 由注册者提供
- 卡片数据面：`ctx.settingsScope.bind({ namespace: 'kimi-tide-router' })` →
  `SettingsScope<T>`（getSnapshot/subscribe/set(field,value)/unset(field)，见
  `dsh-client-runtime/lib/types/client/contract/settings-scope.d.ts`）
- 快照 status loading/ready/unavailable；mode host/memory；writable 决定控件可用性

### 3.2 宿主：原生命名空间 + 官方安装 seam

```ts
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
installSettingsSection(ctx, 'kimi-tide-router', routerConfigSchema, config.router ?? {}, {
  setSource: (get) => { currentConfigSource = get },   // 服务挂载后指向 scope.get()
  onChange: () => applyConfig(currentConfigSource()),  // 即现有 onSaved 热更新路径
})
```

- seam 语义（`dsh-settings/lib/index.js` L618-636 实读）：内部 `ctx.inject(['settings'])` →
  `register(ns, schema, { base: entry, validate? })`；挂载后 setSource(() => scope.get())；
  scope.watch → onChange；卸载回退 setSource(() => entry)。**无 settings 服务时不注册、不报错**
- 分层（`dsh-settings/lib/types/types.d.ts`）：解析值 = schema 默认 → base（= patch.yml
  `router` 块的 composition entry）→ user 层。**patch.yml 保留部署基座角色**，用户编辑全部落
  user 层，`/kimi-tide export-config` 等只读操作输出 resolved 值
- 冲突：namespace 级 revision 乐观并发（SettingsConflictError），单字段写串行链

### 3.3 配置源枚举更新

`configSource`（面板投影字段）枚举扩展：`'settings' | 'patch' | 'default'`（`'sidecar'` 仅
迁移窗口期过渡出现）。投影 schema（`src/projection.ts`）与 `configKey` 语义同步更新。

## 4. Schema（schemastery，新增 `src/settings-schema.ts`）

宿主以 schemastery（已是运行时依赖）声明 RouterConfigV2 的 wire schema：

| 字段 | 类型 | 默认（=DEFAULT_CONFIG_V2） |
|---|---|---|
| version | const 2（导入兼容；schema 自身是版本权威） | 2 |
| mode | enum off/cost/capability | off |
| default / candidates[] | {provider: string, model: string} | 见 config.ts |
| scores | Record<"provider/model", Partial<Dim 0..5>> | {} |
| classify.patterns? | Record<string, string[]> | {} |
| allowedProviders | string[] | [kimi-tide, deepseek-official] |
| costTiers | Record<string, cheap/mid/expensive> | {} |
| routeThreshold / lambda / premiumBudget | number | 0.75 / 0.5 / 0.2 |
| budgetWindow | number(int) | 20 |
| charsPerToken | number | 2 |

- `validate` 钩子（注册选项）：跨字段约束**沿用现有 import-config/sidecar 校验语义**
  （如 default 目标合法、数值域 0..1、budgetWindow 正整数）——schema 无法表达的约束放这里
  （注册失败=写入被拒，与官方语义一致）
- 与 `RouterConfigV2` 接口保持同构；`sidecar.ts` 的 YAML 校验逻辑与 schema 校验并存，
  import 路径以 schema 校验为准

## 5. 迁移（一次性，幂等）

1. 宿主启动、settings 挂载后：若 sidecar 文件存在且尚未迁移 →
   `scope.replace(<sidecar 解析值>)`（整表进 user 层；`version` 字段剥离，其余逐字段）
2. sidecar 改名 `kimi-tide-router.yml.legacy-imported`（留档不删）
3. 幂等：sidecar 不存在 = 无迁移；命名空间已有 user 层时**不覆盖**（判定：
   `scope.get()` 与「schema 默认+base」深比较无差异才导入；有差异跳过并告警）
4. rc.6 兼容：settings 服务缺失时 seam 不运行，回退旧 sidecar 读路径（只读不写，代码保留）；
   `setSource` 被调用前，读路径同样暂用 sidecar——迁移与回退互不阻塞

## 6. 命令族改造（`src/commands.ts`）

| 命令 | 现状 | 改造后 |
|---|---|---|
| `/kimi-tide mode <m>` | 写 sidecar | `scope.update({ mode })` |
| `/kimi-tide set <key> <value>` | 写 sidecar | `scope.update({ [key]: value })` |
| `/kimi-tide export-config` | 打印 sidecar YAML | 打印 `scope.get()` resolved 值的 YAML |
| `/kimi-tide import-config <path\|inline YAML>` | 写 sidecar | 解析后 schema 校验 → `scope.replace()`；双形态（文件/内联）保留 |
| `/kimi-tide refresh` | 不变 | 不变 |

命令依赖从 `RouterSidecarStore` 改为 settings scope 句柄 + 可选 sidecar 兜底；无 settings
服务时命令回退旧路径并提示「设置服务不可用，写入仅本次生效」或维持只读。

## 7. dock 退化（`src/client/TideDock.tsx`）

- 保留：配额/用量/本地 token、路由决策 chip（process-global 投影，维持现状）、
  configSource 显示、reasoning 状态
- 移除：设置折叠区全部写控件（mode 下拉/模型下拉/滑杆/输入框/保存按钮）
- 新增：只读 mode 徽标 + 指引行「路由设置已迁至 设置 → 月汐」
  （注：settings.section 无跨面板 openSection 公开接口，dock 不做深链，仅文字指引——
  实读结论，`openSection` 仅存在于 onboarding 协调器 props）

## 8. 卡片表单（新 `src/client/SettingsCard.tsx`）

复用面板 v3 子组件（CandidateList/ScoreEditor/ReasonPanel 提取为共享组件）：
1. mode 三选（off/cost/capability）
2. 默认路由 + 候选列表（宿主枚举候选池，含 available 灰态）
3. 每候选评分滑杆（scores 覆盖；显示继承值 vs 覆盖值）
4. 数值区：routeThreshold/lambda/premiumBudget/budgetWindow/charsPerToken
5. 高级折叠：classify.patterns、costTiers、allowedProviders
6. 保存语义：顶层标量字段走 `scope.set(field, value)`；**嵌套字段（如 scores 某候选某维）走
   `connection.api.settings.mutate({ns, ops: [{op:'set', path:['scores','<provider>/<model>','<dim>'],
   value}], expectedRevision})`**——多段 path 数组逐层下钻 plain object（宿主 `applyPathOp`，
   `dsh-settings/lib/index.js` L143-176 实读），与官方 Models 卡片 `path:['providers',route]`
   先例同构；两种写法共用 revision 冲突检测与 latest-write 恢复语义

## 9. 数据流

```
卡片 set() ──► settings 文档 user 层 ──► document-updated ──► 宿主 scope.watch
  ──► onChange ──► 现有 onSaved 热更新路径（换配置/清决策/mountRouter/刷新候选/推面板）
读路径：宿主 scope.get()（resolved）────► routerConfigV2
面板投影：dock 只读投影不变；configSource 新增 'settings'
```

## 10. 测试策略（TDD）与验收

**测试**：
- `settings-schema.test.ts`：schema 校验（合法/非法/边界）、默认值解析、跨字段 validate
- `migration.test.ts`：一次性导入、幂等（user 层已有差异不覆盖）、改名留档、rc.6 回退
- `commands.test.ts` 更新：六命令改写 namespace（mock scope），无 settings 服务回退
- `index-wiring.test.ts` 更新：installSettingsSection seam（mock settings 服务）setSource/
  onChange/卸载回退
- `SettingsCard.test.tsx`：快照 + 写路径（mock settingsScope.bind 与 settings.mutate 多段
  path，含嵌套 scores 字段）+ 继承/覆盖显示
- 既有 162 测试中 sidecar/面板相关断言按新架构迁移；**全量绿 + typecheck + build**

**验收**：
1. 设置面板导航出现「月汐」卡片（id `kimi-tide-router`）
2. 卡片表单读写落 settings 文档（文件可核），字段级 revision 冲突有报错不丢写
3. 首次启动后 sidecar 被改名留档、内容进入 user 层；patch.yml `router` 块成为 base
4. 改设置后 dock chip/configSource 热更新、路由立即生效（无需重启）
5. dock 无写入口、只读信息正常；六命令与卡片双入口写同一命名空间、互相同步
6. 重启 dsh web 后设置保持；README/插件 README/development-plan-router 文档同步

## 11. 风险与开放问题

| 风险 | 应对 |
|---|---|
| 迁移误覆盖用户已改的 user 层 | 深比较判定 + 跳过告警（§5.3） |
| settings 文档损坏/写入失败 | 宿主 SettingsProvider 自带 last-good 保护（官方语义）；插件侧 catch + 面板报错 |
| rc.6 用户（无 settings 服务） | seam no-op + sidecar 只读回退（§5.4），功能不退化 |
| 面板投影 configSource 枚举变化破坏旧会话 | projection schema 版本字段不变、新增枚举值向后兼容 |
| dock 迁移后用户找不到设置 | 指引行 + README 更新 |

## 12. 锚点清单（全部本机实读，2026-08-19）

- `@deepseek-ai/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts`（settings.section 契约）
- `@deepseek-ai/dsh-client-ui-settings-models/lib/client.js` L2654-2733（官方注册先例）
- `@deepseek-ai/dsh-settings/lib/index.js` L618-636（installSettingsSection）、L143-176（applyPathOp 多段 path 语义）、L430（mutate）
- `@deepseek-ai/dsh-settings/lib/types/types.d.ts` L84-106/L216-341（owner scope / register / installSettingsSection 声明）
- `@deepseek-ai/dsh-client-runtime/lib/types/client/contract/settings-scope.d.ts`（客户端 bind 契约）
- 本仓库：`src/index.ts` L302-385（sidecar 读 + onSaved 热更新）、`src/config.ts`、
  `src/commands.ts`、`src/client/index.ts` L11-24、`src/client/TideDock.tsx`
