> 评审模型：kimi-coding/k3（独立评审）｜日期：2026-10-05｜被评文件：docs/superpowers/specs/2026-10-05-team-dispatch-design.md（提交 03c9c81）

# 团队派发设计稿 v1 —— Kimi 独立评审（Round 1）

评审方式说明：172 行设计稿一遍读完；事实包 8 条逐一对照宿主源码（`C:\Users\tafce\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`，0.1.7-rc.2）与本仓 `packages/dsh-kimi-tide/src` 实读核实，未派发子代理。核过的关键源码位置在各条目中随附。

## 1. 结论

**有条件通过**。机制面无致命硬伤——D3/D4/D5/D7 依赖的宿主能力（`ctx.skills.register`、`subagent/start|end`、`ctx.agentTeams`、`workflow agentOptions`）全部源码核实为真，三项 spike 结论与源码一致；但存在 2 处**文稿级矛盾**会导致核心功能静默失效或兼容承诺落空（§2 B1/B2），必须先改稿，再进 writing-plans。

## 2. 阻塞项（Critical，必须改）

### B1. D5 命中条件与 D3 派发配方互相断裂（"与角色同名"悬空）

- **问题**：D3（设计稿第 68 行）教模型「队友名取 role 的 `teammate` 名单**或与角色同名**」，并自注"这一步是 D5 生效的前提，必须写在正文里"；但 D5（第 81 行）的命中条件只认 `队友名 ∈ 某 role 的 teammate[]`，**没有"同名"分支**。模型按配方起了同名队友、用户又没把该名写进 `teammate[]` ⇒ D5 静默不命中 ⇒ 队友停在继承 flash（B-1a 让位），核心路径断掉且无任何报错。
- **附带歧义**：「与角色同名」指 `id` 还是 `label` 未定义。`label`「前端」是中文，而宿主强制队友名 lower-kebab-case、≤64 字符、不得为 "lead"（`dsh-experimental-agent-team/lib/types/roster.js:420`，`TEAM_INVALID_MEMBER_NAME`）——同名只可能是 `id`。
- **依据**：设计稿第 68、81 行；宿主 `roster.js:420`、`:244`（名字永不复用，`TEAM_MEMBER_NAME_TAKEN`，稿子的括注属实）。
- **建议改法**：D5 命中规则写死为 `teammate[] ∪ { role.id }`（或显式二选一）；D2 校验追加"任何 role 的 `id` 不得出现在另一 role 的 `teammate[]`"（与既有"一名不认领两 role"同级）；D3 正文配方改写为「队友名**必须**取 role.id 或 `teammate[]` 之一」，并写明名字合法性约束（kebab-case／≤64／非 `lead`），否则模型起中文名会在 `spawn_teammate` 直接失败，成为体验断点。

### B2. 迁移链把未裁定项的默认值写死，与同节承诺自相矛盾

- **问题**：§4（第 119 行）规定 v5→v6 迁移写入 `rulesApplyToChildren = false`；同节（第 120 行）又承诺"若 §8 第 3 项裁定不采纳，则该开关缺省 `true`，连这一处差异也不存在"。§8 第 3 项**尚未裁定**。一旦迁移把 `false` 落进用户配置文件，日后裁定翻转只改代码缺省已救不回已迁移的存量配置——"完全等价 v1.4.1"的承诺对存量用户失效。
- **依据**：设计稿第 119–120 行、第 164 行；迁移链现状 `packages/dsh-kimi-tide/src/migrate.ts:128-145`（`migrateV4`/`coerceRouterConfigV5` 家族，v6 将沿用）。
- **建议改法**：迁移**不写入** `rulesApplyToChildren`（缺省由运行期代码决定，裁定翻转即一行改动、对已迁移配置零影响）；或把"§8 第 3 项裁定"列为 `migrate.ts` 定稿的前置条件写进稿子。

## 3. 建议项（Important）

### I1. D5 应用 `tryMembership`，不是 `membership`

- **问题**：D5（第 80 行）写 `ctx.agentTeams.membership(agent)` 取队友名、"失败/非成员则跳过"。宿主 `membership` 对非成员**抛** `TEAM_NOT_MEMBER`（`dsh-experimental-agent-team/lib/types/roster.js:52-55`）；而 `roster.d.ts:49-53` 与 `index.d.ts:105` 明确提供 `tryMembership`——"Resolve a caller **without throwing** for scoped installation and lifecycle observers"，正是本场景。
- **建议改法**：改为 `tryMembership(agent)`，`undefined` 即跳过；命中判定追加 `membership.role === 'teammate'` 纵深防御（lead 伪行的 `name` 是 `"lead"`，虽 `delegationDepth > 0` 门控已挡住主会话，但 `teammate[]` 里配 `"lead"` 字符串不应有任何命中路径）。

### I2. `ctx.agentTeams`／`ctx.skills` 缺席时是抛错，不是 `undefined`——"自动跳过"需点名探测机制

- **问题**：§4（第 121–122 行）与 D3（第 70 行）都依赖"宿主无该服务 ⇒ 跳过"。但 cordis 的服务解析是 Proxy：属性找不到即 `throw`（`cordis/lib/index.js:671-695`，"cannot get property ... without inject"）。且 `dsh-experimental-agent-team/lib/types/index.d.ts:12-16` 用 `declare module` 把 `Context.agentTeams` 声明为非可选——类型层面也拦不住。最直观的 `if (ctx.agentTeams)` 写法会在无 Team 组合包的宿主上**炸掉整个插件**。
- **建议改法**：稿子写明探测机制——装配期 `try { ctx.agentTeams } catch { /* 标记不可用 */ }` 探一次并缓存布尔（`ctx.skills` 同法），D5/D3 全部走缓存标记。这是 §4 兼容承诺能成立的前提。

### I3. "B-1a 例外（必须实现）"在稿子自己的设计下是死条件

- **问题**：D5（第 89 行）要求给 `shouldKeepExternalTarget` 追加"且该 agent 未命中分工表"。但该函数第一行就是 `decision.via !== 'default'` ⇒ `false`（`packages/dsh-kimi-tide/src/router.ts:524`）；role 命中既然自带 `via: 'role'`（第 81 行），让位根本不会发生，例外永不触发。且该函数签名 `(decision, incoming, agent)` 拿不到分工表信息，真要实现就得在 request 阶段重算 membership——为零行为差异加管道。
- **建议改法**：删掉例外段，替换为一条单测锚点「`via: 'role'` ⇒ 不让位（B-1a 首行守卫）」。若实现者把 role 命中表达成"换了目标的 via:'default'"，例外才有必要——但那违背稿子自己定的 `via` 语义，应以防呆注释封死。

### I4. A2 的"对照 S2 探针 B 已预演"是错误论据，最高风险路径从未排雷

- **问题**：S2 两次探针走的都是 **v1.4.1 既有机制**（显式 `@` 改道 / B-1a 让位保继承）；`via: 'role'` 的分工表改道路径是本设计新增，**从未被预演**。A2（第 134 行）的括号注记会让验收者误以为该路径风险已排除。（详见 §7 E1/E2。）
- **建议改法**：删括号注记，A2 标注"全新路径，发版门禁最高优先"；A5 才是 S2 探针 B（未认领队友保继承）的真正对照，可把对照注记挪到 A5。

### I5. D7 记账生命周期未定义：配置变更重挂载会清空闭包内 WeakMap

- **问题**：月汐现状是"配置变更 ⇒ applyConfig ⇒ 注销+重注册"（`router.ts:756-762` 注释），`installRouter` 闭包内的 `slots` 等 WeakMap 每次改配置即销毁。D7 派发 ledger 若放 router 闭包，**用户每改一次 roles 派发区就清零**；放插件层可活过重挂载、活不过重启。稿子未写存放层级与寿命预期。另"WeakMap：agentId → …"措辞有误——WeakMap 键必须是对象，应键 `Agent`（`router.ts:713` 惯例）。
- **建议改法**：稿子写明 ledger 存放层级（建议插件层）与寿命承诺（活过配置重挂载、不承诺跨重启），并并入 §8 待裁定（见 §6 D4'）。

### I6. D5/D6 需要 `decide()` 拿不到的信息，接缝位置应点名

- **问题**：现 `decide(messages, step, hasImage)` 是纯函数、无 agent/depth 入参（调用处 `router.ts:839/857/869`）。"role 命中"与"子代理退出关键词"都依赖 agent 身份/深度。稿子未说分支长在 pre-step 处理器还是 decide 内部；§5 单测"优先级链 5 档逐档"的可测性直接取决于这个接缝。
- **建议改法**：稿子点名——depth/identity 分支放 `installRouter` 的 pre-step 闭包（agent 在手），`decide` 保持纯函数、仅新增"跳过关键词规则"开关参数；优先级链单测按此接缝设计夹具。

### I7. D6 与语义命中确认闸（hitConfirm）的联动没交代

- **问题**：v1.3.0 的 hitConfirm 在关键词命中时先问判官（`router.ts:805-816`）。D6 让子代理退出关键词规则后，闸也绝不该对子会话 firing（白花的 LLM 调用，判官还是 preset.default）。机制上闸只在关键词命中时触发，D6 后自动一致——但无测试钉住就是回归温床。
- **建议改法**：§5 单测清单加一条"子会话（depth>0）即使任务描述含关键词，hitConfirm 调用数 = 0"。

## 4. 可选/轻微项（Minor）

- M1. D3 的 description 进目录有 **500 字符/条截断**（`dsh-tool-skill/lib/index.js:40`、`:359-362`，空白归并后超长截 "..."）：roles 一多，索引行尾部角色从目录里静默消失——`renderTeamSkill` 应自检 ≤500 或退化为"N 个角色，读我"式摘要。
- M2. roles 每次变更 ⇒ digest 变 ⇒ 所有活会话下一 pre-step 收 `renderCatalogUpdate` **整目录替换**（`dsh-tool-skill/lib/index.js:231-235`）⇒ 该消息之后 KV 前缀失效。配置频繁调整成本不可忽略，稿子提一句即可。
- M3. D3"宿主 `skills/change` 驱动目录刷新"机制描述不确：消费路径是每 pre-step snapshot＋digest 惰性替换（`dsh-tool-skill/lib/index.js:203-235`），`skills/change` 仅是 dsh-skill 侧 emit（`dsh-skill/lib/index.js:404`）。结果对、措辞应改。
- M4. A5 的「未在分工表」与 D7 的依据枚举（role/explicit/keep，第 99 行）不一致：投影需要第四个依据值（如 `unclaimed`），D7 应补。
- M5. D1 `driver=null`＋`driverSticky=true` 时打底=跟随宿主默认，该轮 via/reason 面板如何呈现未定义；`activePreset=null` 时路由器整体未挂载（`router.ts:937` 注释），driver 不生效——两处都应写明。
- M6. `subagent/start|end` 是 **scoped emit**（按 delegating parent 过滤，`dsh-subagent/lib/types/index.d.ts:84-98`）：装配时监听作用域选错会漏记派发行，实现注意。
- M7. stateVersion 升级后旧会话派发区为空，符合"既有惯例重建"，§4 可多写半句让用户有预期。
- M8. D5 的 `step === 1` 门控与现状一致且**足够**：队友每个 turn（含 `send_message` 唤醒的续轮）都从 step 1 起判定，工具循环步不切模型（`router.ts:765-771`；`docs/router.md:32-33`）——"非首步是否也需改道"答案是不需要，建议稿子补上这一行推理，省得实现者重考据。

## 5. 逐条判据核对（A1–A7）

| 判据 | 能否验收 | 缺什么 |
|---|---|---|
| A1 主会话打底＝driver | 能 | 只覆盖 driver=显式目标＋非关键词轮；缺 driver=null 变体、关键词轮（规则仍赢）变体 |
| A2 队友按分工表改道 | 方法能，论据错 | 删"对照 S2 探针 B 已预演"（I4）；补"roles 变更后存量队友下一轮生效"变体 |
| A3 一次性派发不被劫持 | 现状写法不能 | 方法必须写明"任务描述**含关键词组词**"——否则 v1.4.1（B-1a 只护打底）也能过，D6 无门禁 |
| A4 分工表进目录且可加载 | 能 | 缺反向：roles 空 ⇒ 目录无 `kimi-tide-team`；缺 roles 变更 ⇒ 目录替换消息出现 |
| A5 未在分工表的队友 | 能 | S2 探针 B 形态才是真对照（I4）；依赖 M4 补投影依据值 |
| A6 role 目标不可用 | 不能判 pass/fail | 缺"不改道之后队友跑在什么上"的预期值（应为继承值经 B-1a keep）——需先裁定 §6 D2' |
| A7 存量兼容 | 能 | 前置：§8 第 3 项裁定落地 ＋ B2 修复（迁移不写死 `rulesApplyToChildren`） |
| （新增建议）多队友并发 | 缺 | 两队友分属不同 role 同时跑：per-agent 槽位天然隔离（`router.ts:713` WeakMap），但需实机探针钉住两路请求头各自命中 |
| （新增建议）hitConfirm 豁免 | 缺 | 见 I7：子会话关键词命中时判官调用数=0 |

## 6. 缺失决策清单（建议并入设计稿 §8）

- D1'. `role.id` 是否自动成为队友名命中条件（即 B1 的修法取舍）；若是，校验须覆盖"id 与他 role 的 teammate[] 冲突"。
- D2'. 角色目标不可用时队友的降级落点：继承值经 B-1a keep？还是退预设默认？——A6 的 pass 条件依赖此裁定。
- D3'. roles 变更对**存量队友**是"下一轮动态生效"还是"创建时锁定"（D5 每轮查表 ⇒ 动态；需用户确认此为预期）。
- D4'. 派发 ledger 的持久性预期：活过配置重挂载？活过重启？是否落盘？
- D5'. `driverSticky=true` 且 `driver=null` 时的面板呈现（via/reason）；`activePreset=null` 时 driver 不生效是否可接受。
- D6'. 同一 role 的 `teammate[]` 认领多个队友名（并发多实例）是否为受支持形态——数组形状暗示是，但判据与额度提示都按单队友写。
- D7'. 演进预案：上游若给 `spawn_teammate` 加模型字段，D5 请求层改道是否退役为创建时写入 agentOptions（挂账即可，不影响本稿实施）。
- D8'. skill 正文是否承担队友名合法性教学（kebab-case／≤64／非 `lead`）——不教则模型起非法名在 `spawn_teammate` 直接失败（`TEAM_INVALID_MEMBER_NAME`）。

## 7. 与事实的偏差

- **E1（A2，第 134 行）**：稿子写"对照 S2 探针 B 已预演"。事实：S2 两次探针 = 提示词含 `@kimi` ⇒ 落到 `kimi-coding/k3`（**显式 @ 机制**）、提示词仅含「代码」⇒ 落到继承值 `deepseek-flash`（**B-1a 让位**），均为 v1.4.1 既有机制；`via:'role'` 的分工表路径本设计才新增，从未预演。依据：设计稿 §1.3 S2 行（第 24 行）＋事实包 6。
- **E2（D5，第 89 行）**：稿子写"否则队友会停在继承模型上（S2 探针 A 即该形态）"。事实：§1.3 **从未定义探针 A/B 的命名**，D5 与 A2 却突然引用 A/B；按 §1.3 描述，"停在继承模型"的是仅含「代码」的那次探针。无论 A/B 如何映射，E1 的"已预演"都不成立。依据：设计稿第 24、89、134 行互证。
- **E3（D5，第 89 行）**："B-1a 例外（必须实现）"——机制判断错误而非引用错误：`shouldKeepExternalTarget` 首行守卫（`router.ts:524`）已使 `via:'role'` 决策天然不让位，例外是死条件。改法见 I3。
- **E4（D3，第 69 行）**："宿主 `skills/change` 驱动目录刷新"——实际消费机制是 tool-skill 每 pre-step snapshot＋digest 惰性替换（`dsh-tool-skill/lib/index.js:203-235`）；`skills/change` 只是 dsh-skill 侧 emit（`dsh-skill/lib/index.js:404`）。结论不变、机制描述应正。

其余锚点核对结果（全部属实，无异议）：`spawn_teammate` schema 无 LLM 模型字段、`provider` 为子代理提供方（`dsh-experimental-tool-agent-team/lib/index.js:242-293`）；`workflow` 的 `agent(prompt,{provider,model})` 装入 `agentOptions`（`dsh-workflow-ptc/lib/index.js:336-339`；契约 `dsh-subagent/lib/types/types.d.ts:155-162`）；`ctx.skills.register` 返回 disposer、同名先到先得（`dsh-skill/lib/index.js:193-214`；README.zh.md:52）；`membership`/`listMembers` 签名（`dsh-experimental-agent-team/lib/types/index.d.ts:35-48`）；`TeamMemberView.model` 为创建时继承值（`roster.js:112-130`）；Team 名永不复用（`roster.js:244`）；B-1a 现状（`router.ts:513-527`）；迁移链 `coerceRouterConfigV4/V5` 家族（`migrate.ts:111-145`）。
