# 评审档案：Review Subagent 设计稿（2026-09-11）

> **评审人**：Kimi（真身，k3，子代理派发，提示词首行 `@kimi`，只读 + 收敛契约）｜ **实施者/控制器**：DSH 主 agent（deepseek-flash）
> **评审对象**：`docs/superpowers/specs/2026-09-11-review-subagent-design.md`（v1，229 行，commit `3ce2db1`）
> **评审结论**：**有条件同意**进入 writing-plans；成熟度 **实验级偏可用级**（封堵 S1/S2 后可达可用级）
> **控制器处置**：逐条复核全部完成（本文 §2）→ spec 回改为 v2（`docs/superpowers/specs/2026-09-11-review-subagent-design.md`）
> **证据基础**：评审读 11 个文件（spec + router.ts/review.ts/config.ts/settings-schema.ts + router.md + 1.1.0 spec + 协作闭环文档 + 3 份宿主契约文件），1 次聚焦检索

---

## 1. 评审报告全文（评审子代理产出，未删改结论）

### A. spec §2 契约表逐项复核

| # | 契约（摘要） | 结论 | 证据 / 反证 |
|---|---|---|---|
| 1 | `ctx.subagents.start(name,request)`；`SubagentRun={id,localAgent,result,dispose}` | 部分成立 | `SubagentRun` 形状核实无误（`dsh-subagent/lib/types/types.d.ts:292-318`；引用行号 292-299 略偏：`localAgent` 实落 :304、`dispose` :317）。服务侧 `start(name,request)` 签名与 `ctx.subagents.list()` 在该文件无定义（仅 provider 侧 `SubagentProvider.start(request)` :359）→ 无法核实（活体锚点） |
| 2 | `SubagentStartRequest` 九字段 | 成立 | types.d.ts:136-192 逐字段在：label:138 / prompt:140 / parent:146 / signal:154 / agentOptions:162 / outputSchema:168 / maxDepth:175 / toolFilter:183 / persona:191 |
| 3 | `AgentOptions` 形状 | 无法核实（形状） | 类型 import 自 dsh-agent（types.d.ts:11），本文件无定义；「in-process merge over 父 Agent options」语义成立（:157-160） |
| 4 | `ToolRestriction` + restrict 失败语义 | 成立 | `dsh-tools/lib/types/index.d.ts:475-480`；:603-609「空过滤/未知名/scope-local/reserved 名失败 + Restrictions intersect + scoped registrations remain visible」 |
| 5 | in-process 驱动器行为 | 部分成立 | 「未发布窗口安装 persona/toolFilter/结构化输出」成立（driver `lib/index.js:171-178`）；「继承 cwd 与谱系」成立（types.d.ts:142-145）；「父级工具限制与权限不导入」**存疑**——driver:169/172 存在 `captureDelegatedPolicyOverrides(parent)` + `appendDelegatedPolicyOverrides(child.session, inherited)` |
| 6 | `SubagentResult` + 五态 stopReason | 成立 | types.d.ts:239-282（枚举 :239-250） |
| 7 | `tools.register(ToolDefinition)→disposer` | 成立 | index.d.ts:601；ToolDefinition :106-172。注：execute 第二参类型为 `ToolRunContext`（:119） |
| 8 | `ToolExecutionInput.agent?` | 成立 | index.d.ts:197-208（可选——见 M4） |
| 9 | `SessionEventMap` 四事件形状 | 部分成立 | assistant/message、user/message 由 router.ts:884-930 交叉证实；`tool/call`/`tool/result`/`step/start` 无法核实（活体锚点）；UNKNOWN_TOOL 经 executor 暴露由 index.d.ts:657-663 旁证 |
| 10 | session/event 按 agent 作用域注册 | 成立 | router.ts:877-931 实证同款 |
| 11 | `session.append` + `KNOWN_SESSION_EVENT_TYPES` | 成立 | router.ts:851 append 实证；:347-355 v1.2.0 fail-closed 佐证目录敏感性 |
| 12 | `ctx.llm.stream` 直调有界 | 成立 | review.ts:71-100（60s :17/:85；12000 字符 :15） |

**§1 根因复核**：①月汐评审无工具——成立（review.ts:15/17/71-100）；②配置实况「触发但形态不对」——机制成立（router.ts:254-257 静态抑制、:706-722 武装、:937-947 轮末异步评审），settings.yaml 具体值不在清单内 → 无法核实；③协作闭环承接形态——成立（agent-collaboration-loop.md:80、:29/:103）。

### B. 分级问题清单

**严重**

- **S1 · `agentOptions` 钉模型被 kimi-tide 自身路由层击穿**（§2 行3 与 §11.2「结构性关闭 2026-08-27②」不成立）。证据：`installRouter` 的 `agent/pre-step`（router.ts:579-588）与 `agent/request`（:730-754，`{prepend:true}` 恒最外层）对**所有 agent** 生效，全文无子代理豁免；08-27② 事故成因正是路由改道子代理。子代理首轮 step-1 任务书（必含「评审/代码」词）被 `decide` 重算：review 组被认领抑制后落 code 规则或预设默认（saving → deepseek-v4-flash），**评审静默跑在错误模型上**。建议：把 `run.localAgent` 登记 WeakSet，pre-step / request / 武装三处跳过（或按谱系判定）；补单测 + A2 扩展验收「子会话实际请求 provider/model == flow.reviewer」。
- **S2 · PTC 模式下保留通道 `run_code` 不受 `toolFilter` 约束**，「硬只读」塌缩。证据：index.d.ts:472-473（restrictions 不影响 reserved PTC transport）、:554-562（run_code 不进可过滤层）、:625-626（可见性 = 继承面先过滤，再叠加自身注册与保留通道）、:603-605（deny 保留名直接报错）。PTC 部署下评审子代理可经 run_code 执行任意代码，写/命令全放开，熔断工具判据落空。建议：派发前探测有效 presentation mode，PTC 下 fail-closed 拒派发（或给 child scope 挂 `tools.guard` 拒 run_code，:610-620）；§10/文档注明；A2 验收声明运行模式。

**中等**

- **M1** L1 熔断对 remote provider 静默失明：`run.localAgent?.ctx.on` 可选链 = localAgent undefined 时监视器不挂，仅剩墙钟；未声明降级语义。
- **M2** 裁定 3（「direct 只留给手动快评」）与 §3/§6.2（executor opt-in、缺省 direct 轮末保留）措辞冲突。
- **M3** 并发无闸：工具入口可被同轮并发调用 N 次并与轮末入口叠加，成本与 L2 计数被放大。
- **M4** `exec.agent` 可选（index.d.ts:208）：非 agent 上下文执行时 parent 缺失未处理。
- **M5** completed 但空产出漏判：`SubagentResult.output` 可为 `[]`（types.d.ts:258-263），空报告会 ok:true。
- **M6** direct 流并存时子代理被复评（任务书命中 review 词）；单 subagent 流也有「跳过留痕」噪音。
- **M7** `AbortSignal.any/timeout` 缺宿主兼容兜底——既有 `boundedSignal`（router.ts:368-373）正为此存在。

**轻微**

- **m1** §2 行1 锚点行号偏差；**m2** 行5 措辞与 driver:169/172 抵触（结论方向不受影响：dsh-tools:630-631 证明 toolFilter 过滤整个继承面）；**m3** 空转判据的墙钟定时器须随 run dispose 清理；**m4** §7 新字段与 v1.2.0 `reviewEventWritable` fail-closed（router.ts:347-355）交互未述；**m5** 轮末写路径遇相对路径未按父 agent cwd 归一；**m6** L2 状态键为 flow id，流改名后悬挂（进程内可接受）。

### C. 未覆盖失败模式

①kimi-tide 自路由穿透（S1）；②PTC run_code 穿透（S2）；③remote provider 熔断失明（M1）；④工具/轮末并发叠加（M3）；⑤空输出误成功（M5）；⑥非 agent 上下文工具调用（M4）；⑦熔断定时器泄漏（m3）；⑧L2 随重挂载清零（§5.2 已自认，可接受）；⑨`SessionEventMap` 工具事件形状无运行期存在性校验 + 降级文案。

### D. 结论

**有条件同意**进入 writing-plans。条件：(1) 封堵 S1 与 S2（不堵则「钉模型」与「硬只读」两个核心卖点不成立）；(2) M1/M3/M4/M5 给出实现或显式非目标声明；(3) 修正 §2 行1/行5 锚点措辞；(4) §9 测试与 A 系验收补：子代理实际路由目标断言、PTC 模式声明、空产出用例、并发用例。
**应保留的优点**：fail-closed 白名单 ∩ 可见工具集；熔断判据与四条事故映射覆盖良好；配置 opt-in 与 schemastery「缺省省略不注入」模式一致（settings-schema.ts:64-79）；轮末接线点（armed / turn-stopping / wireSessionFeed）真实存在且 1.1.0 语义兼容；旧载荷容忍有 v1.2.0 实证支撑。§12 五问问得对；Q4 的热重载竞态在现行代码已有效果级防线（router.ts:569-578）。**需补第六问**：「评审子代理如何对 kimi-tide 自身路由不可见」。
**成熟度**：现为实验级偏可用级；条件全落后可达可用级；生产级需 L2 持久化与阈值可配置（现列非目标，YAGNI 划分恰当）。

---

## 2. 控制器逐项复核与处置（2026-09-11，主 agent 对源码逐条核实）

> 依据 `docs/agent-collaboration-loop.md` §3.4：审查者也会误报，**每一条必须先核实再决定是否进修复循环**（2026-08-24 实证：评审子代理曾 3 次把存在且逐字正确的代码判为缺失）。

| # | 评审意见 | 核实结论 | 证据（本次实读） | 处置 |
|---|---|---|---|---|
| S1 | 路由层击穿 agentOptions 钉模型 | **成立且必要修复** | `router.ts:579` pre-step / `:730` request 均为宿主级 `ctx.on` + `{prepend:true}`；`:724` `slots.set(agent, …)`；`:735` `router.applyTo(resolved, slot.decision)` 无条件替换 provider/model；全文件无子代理豁免分支 | spec v2 §4 步骤 2.5 新增**路由豁免**（任务书哨兵 + WeakSet 双保险），§9/A 系补「子会话实际路由目标 == flow.reviewer」断言 |
| S2 | PTC `run_code` 穿过 toolFilter | **成立且必要修复** | `dsh-tools/lib/types/index.d.ts:472-473`（不影响 reserved PTC transport）、`:554-562`（run_code 在可过滤层之外）、`:603-605`（reserved 名 restrict 直接失败）、`:625-627`/`:657-663`（可见面按 mode 叠加保留通道；PTC 下模型直调只认 run_code）；代码运行时本身可绕过工具直接落盘 ⇒ 过滤无法兜住 | spec v2 §4 新增**步骤 0：呈现模式探测**（PTC → fail-closed 拒派发）+ 二级防线 `tools.guard`（`index.d.ts:610-620`）拒 `run_code`；§10 把「PTC 支持」写成显式非目标；A2 验收声明运行模式 |
| M1 | remote provider 熔断失明 | 成立 | spec v1 §4 步骤 4 写的是 `run.localAgent?.ctx.on`（可选链静默跳过） | 采 fail-closed：`localAgent === undefined` → 拒派发并给明确文案（§4 步骤 1） |
| M2 | 裁定 3 与 §3/§6.2 措辞冲突 | 成立（纯措辞） | 裁定 3 原句「direct 形态只留给手动快评」与 §3「缺省 direct、存量零突变」并读有歧义 | 裁定表补注：**存量配置轮末维持 direct；subagent 是显式升级路径**；「只留给」改为「手动快评保留 direct」 |
| M3 | 并发无闸 | 成立 | spec v1 无 in-flight 概念；轮末与工具入口可叠加 | 采 per-flow in-flight 互斥：进行中则工具入口立即返回「进行中」态、轮末入口跳过并留痕（§5.3 新增） |
| M4 | `exec.agent` 可选 | 成立 | `index.d.ts:197-208` 明确可选 | 采：`parent === undefined` → `isError` + 明确文案（§6.1） |
| M5 | 空输出误成功 | 成立 | `types.d.ts:258-263` output 可为 `[]`；`review.ts:95` 既有「空输出即失败」先例 | 采：空报告 → `ok:false`（§4 步骤 5） |
| M6 | 子代理被复评/留痕噪音 | 成立 | 与 S1 同源（武装发生在 pre-step step-1，无豁免） | 随 S1 豁免一并关闭（§4 步骤 2.5 第三点：豁免 agent 不武装） |
| M7 | 缺 boundedSignal 兜底 | 成立 | `router.ts:368-373` 既有 `boundedSignal` 先例 | 采：复用同模式组合 turn/调用方信号与超时（§4 步骤 3） |
| m1 | §2 行1 行号偏差 | 成立 | `localAgent` :304、`dispose` :317（非 :292-299） | 改锚点；服务侧签名标注「活体 Inspect 锚点，无包内类型」 |
| m2 | 行5「父级限制不导入」措辞 | 部分成立 | driver:169/172 确有 `captureDelegatedPolicyOverrides` + `appendDelegatedPolicyOverrides`；但 dsh-tools:630-635 证明 toolFilter 过滤**整个继承面** | 改写为：**工具限制**不导入（扁平新作用域）；**父级显式沙箱覆盖与 `'never'` 审批 pin 会随 run 带入**（driver README 同述）⇒ 只读只能靠 toolFilter，不能靠权限链 |
| m3 | 空转定时器生命周期 | 成立 | spec v1 未述 | 采：所有熔断定时器随 run 终局 `dispose()` 清理（§5.1 末） |
| m4 | 与 `reviewEventWritable` fail-closed 交互 | 成立 | `router.ts:347-355`（v1.2.0 事件目录 fail-closed） | 采：新字段仅在目录可写时附带；不可写时降级为日志 + 面板行（§7） |
| m5 | 相对路径未归一 | 成立 | spec v1 §6.2 未述 | 采：按父 agent cwd 归一为绝对路径（§6.2） |
| m6 | L2 状态随流改名悬挂 | 成立（可接受） | 进程内 Map 键为 flow id | 采：文档一句说明（§5.3 末） |
| C⑨ | 工具事件形状无存在性校验 | 成立 | `SessionEventMap` 工具事件形状为活体锚点，无包内类型 | 采：首个 `tool/call` 到达时做形状校验，不符则只保留墙钟 + 上屏降级文案（§5.1 末） |

**不接受的意见**：无。评审报告全部条目经核实成立或部分成立，无幻觉发现（本次评审质量高于 2026-08-24 先例）。

## 3. 处置后状态

- spec 回改 v2：`docs/superpowers/specs/2026-09-11-review-subagent-design.md`（§4 步骤 0/2.5 新增、§5.3 并发闸新增、§9/A 系验收扩充、§11.2 措辞降级、§12 补第六问、§13 修订记录）
- 未进入实施；待用户复审 spec v2 → `writing-plans`
