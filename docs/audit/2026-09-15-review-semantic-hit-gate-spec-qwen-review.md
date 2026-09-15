# 评审档案：语义命中确认闸设计稿（2026-09-15，独立模型评审）

> **评审人**：**qwen3.8-max**（provider `qwen-token-plan-cn`；经 workflow 的显式 provider/model 覆盖派发——`@` 指令只能钉 provider 不能钉模型，`qwen-token-plan-cn` 池内首选未必是它）
> **评审对象**：`docs/superpowers/specs/2026-09-15-semantic-hit-gate-design.md`（305 行，commit `6f0c781`）
> **评审结论**：**有条件同意**——核心机制锚点全部成立，但 §6 配置 schema 写法与本版核心承诺直接冲突（S1），另有 4 处中等编排缺口
> **独立性**：评审者与作者（DSH 主 agent，deepseek-flash）**不同族**；本轮的 k3 首轮因 Kimi 月配额 403 中断（抢救记录见 `2026-09-15-review-interrupted-kimi-quota-salvage.md`）
> **证据基础**：评审实读 spec + `router.ts`/`rules.ts`/`config.ts`/`settings-schema.ts`/`review.ts`/`transcribe.ts`/`index.ts`/`test/router-wiring.test.ts` + 宿主 `dsh-agent` 事件契约类型定义

---

## 1. 评审报告全文（评审模型产出，未删改结论）

结论：**有条件同意**——核心机制（pre-step 瀑布预计算 + decide 入参注入 + fail-open）全部锚点核实成立，但 §6 配置 schema 写法与本版核心承诺「缺省不注入／存量零突变」直接冲突，必须重写；另有 4 处中等级编排缺口。成熟度：机制面扎实可实施，配置面有一处硬伤、编排面需补细节，修完可进实施。

### 九条论断核实（逐条）

1. **pre-step 可插闸：成立**。`agent/pre-step` 契约为 waterfall（dsh-agent `runtime-types.d.ts:311-319`，`@mode waterfall`，`next: () => Promise<PreStepDecision>`），监听器 async 且被 loop await；既有代码已在 next() 之后 await 真实 LLM 调用（router.ts:627 `transcribeBatch` → `ctx.llm.stream`），§2.1 引 router.ts:579 锚点无误。
2. **decide 签名兼容：成立**。全部调用点为 src router.ts:613/631/643 与 test（integration/review-flow/router，均 ≤3 参），追加可选第 4 参兼容；`previewRoute` 不调用 decide（rules.ts:253 自行复刻），签名无需同步改——但见中等#2：re-decide 调用点需要传参，稿子漏了。
3. **「同型 continue」：不完全成立**。落点（打底 :291）相同，但按 §5.2「循环之前剔除」实现，被否规则不经过 ：275/278/282/286 的 continue，且有可观测差异（中等#4）。
4. **认领抑制先于闸：成立**。§7 步骤 1-2（抑制→routable→闸）与 decide 内序（:254-257 过滤先于循环）一致；被认领组命中既不路由也不产生判官调用，`reviewTriggerHit` 武装（:712）独立不受闸影响。
5. **延迟类比：部分成立**。pre-step 是整轮阻塞点、30s 先例（router.ts:361）、超时即弃均属实；但先例是低频路径（带图+流目标），闸门落在高频路径（每个关键词命中轮），见轻微#10。
6. **试一句偏差处理：足够诚实**（§8.2 显式声明+hint 仅在可判状态置位，不装作预演等价）。
7. **测试面：大体足够但不自洽**。router-wiring 夹具（真瀑布 dispatch + makeDeps 注入缝，test:148-267）完全支持假 caller 注入；缺口见严重#1（schema 测试行与 §6 矛盾）、中等#2/#3（缺交互用例）。
8. **schema 可行性：不成立**，见严重#1。
9. **范围切割：无自相矛盾**，但 §1 以假阴案例为第一动因、本版不治假阴——发布文案不得暗示漏命中已解决（§10 措辞目前是安全的，保持）。

### 严重（核心承诺不成立）

**S1 · §6 schema 写法使「缺省不注入／存量零突变」不成立** · 对象型字段加进 `presetSchema` 后，schemastery 缺失即注入 `{}`，与「省略」承诺直接冲突 · 证据：settings-schema.ts:66 本仓实测注释「对象/字典/数组型字段：缺失即注入 {}/[]（与是否带 default 无关）」；test/settings-schema.test.ts:7-9「v5 默认往返相等」将失败；§6 括号自己承认「缺失即注 {}」却同时声称「缺省省略」「往返相等（缺省不注入）」（§9），稿内自相矛盾；所引 settings-schema.ts:75-80 的先例（imageFallback）是 const 联合（标量型），不适用对象型——同类对象字段的既判先例恰是 v3 `default` **不入 schema**（:69-71：「入则往返被注入 default:{} 破坏默认往返相等」） · 建议：`hitConfirm` 不入 presetSchema，靠非 strict 透传保活 + `validateRouterConfig` 做形状/界校验（v3 default 同款）；若坚持入 schema，须显式改写红线测试与「零突变」定义（不推荐）。

### 中等（导致错误行为或返工）

**M1 · 判否结果未穿进转述后的 re-decide** · eager/lazy 转述成功后 decide 以 `hasImage=false` 重跑（router.ts:631/:643），若不传 `omittedRuleIds`，被否关键词规则在重跑中复活 · 证据：§7 步骤 7 只覆盖 ：613 首次调用，步骤 8 称「其后一律不动」；流决策路径下关键词命中确会参与重跑（image 规则重跑时不再命中） · 建议：§7 明确三次 decide 全部携带同一集合，并补 wiring 测试「闸 × eager 转述」。

**M2 · 闸门会在结果不可能生效的轮上发无效调用** · §2.2 声明显式 @ 不进闸、带图轮关键词命中「几乎不发生」，但 §7 步骤 1-5 的触发条件只有「routable 有 keywords 命中」：显式 @ 轮（decide :237 短路先于 ：251）与 image ∞ 首位遮蔽轮（关键词规则恒被 image 规则遮蔽）都会发出 1.2s 判官调用且结果必然被丢弃 · 证据：router.ts:237-243、:265（∞ 排序）、§2.2 自己的分析即证明 · 建议：§7 步骤 2 补两个前置短路：`explicitProvider(text) !== null` 或 routable 首位为 image/flow 可用命中 → 不调；补对应零调用测试。

**M3 · 「完全同型 continue」与特异度标注矛盾** · 前置过滤使次条规则升为 routable index 0，会带上「（特异度最高）」标注——违反 0.8.x①「降级命中不误标」不变量；而真正的目标不可用路径（路内 continue）次条在 index 1、无标注 · 证据：router.ts:265-267（`routable.length > 1 && index === 0`）、router.md:532-533；§5.3 原因表未覆盖标注 · 建议：§5.3 补标注规则（建议被否规则视同不存在但标注位基于全量 hits 计算），并加 router.test 断言。

**M4 · 只判链首一条：omit 分支出现「未确认即改道」** · 判否首条后次条规则未经确认直接生效，与标题承诺「命中轮先确认再改道」形成落差，且未被 §2.4 能力边界登记 · 证据：§3.4「只判路由链首条」、§5.3「前序判否」原因串；§3.4/§7 引用的「§4.5」小节不存在 · 建议：在 §2.4 限制节显式登记「次条及以后不经确认」，并把断链的 §4.5 落成实际小节。

### 轻微（措辞与完备性）

**L1 · §3.2「不经 llm/stream 既有拦截路径」描述不实** · `ctx.llm.stream` 直调仍穿越 llm/stream 瀑布——router.ts:761-795 拦截器与 `inFlight` 守卫的存在本身即证明（review/VisionCaller 同理） · 三条保证的**结论**成立（无 purpose、无图块、decide 不在链上），但机制表述会误导实施者 · 建议改写为「穿越瀑布但两处改写均不命中」。

**L2 · maxTokens 缺省 32 与 why≤20 字不自洽** · 20 个 CJK 字加 JSON 结构在常见 tokenizer 下可超 32 token，截断→解析失败→无结论率上升（fail-open 安全但闸门常态失效） · §3.3/§6 该对齐（缺省提至 ~64 或 why 限 10 字）。

**L3 · 缓存键不含判官身份** · 键 = 文本+规则签名（§3.7），切换预设（判官变）而规则签名不变时沿用旧判官 verdict · 建议键中加入 default 的 targetKey 或 preset key。

**L4 · 延迟类比缺频率维度与无结论率指标** · 30s 先例是低频路径，闸门是高频路径；1.2s 可能低于小模型真实 p50 → 高 fail-open 率 · A5 只测 p50/p95 时延，应加「无结论率」验收指标（§10）。

**L5 · 锚点与引用瑕疵** · §3.4/§7 引「§4.5」不存在；§8.1 引 `_ui-review-2026-08-29.md` 仓库内不存在（glob 无果，**无法核实**）；§1/§3.1「deepseek-flash」实为 `deepseek-v4-flash`（config.ts:115）。

**L6 · §1 动因错位** · 第一现象（saving 假阴）本版不治，README 改写（§10）目前措辞安全，保持「只声明命中确认已做」。

其余锚点核对：§1 config.ts:99（17 词）、§2.1 router.ts:231-292、§2.5 :275/278/282/286/291、§3.5 :368-373、§3.7 transcribe.ts:38、§5.2 :254-257、§7 :613/:339-346、router.md:541 均与源码一致，无偏差。

### 未覆盖的失败模式

- 判官 verdict 指向候选表内**非链首**规则：§3.4 只定义「不在候选表→null」，表内非链首未定义（应显式一律 null）→ §3.4 该补。
- turn 中止信号在判官调用期间触发：§3.5 有信号组合，但「abort 视为无结论、不写缓存」未点名 → §3.6 表该补一行。
- 判官 = preset.default 本身是 flow 目标引用？不可能（default 是 RouteTarget 形状，config.ts:26-34），但 §3.1 未写这一前提 → §3.1 补一句。
- 词表热改后同签名缓存命中：因 prompt 不含词表，语义上安全，但该论证应写进 §3.7 而非留白。
- 多 agent 并发下的判否观测：`latestDecisions` 已按 agent 隔离（index.ts:496-499），不缺，但 §8.3 可引锚点自证。

### 应保留的优点（改稿勿丢）

- 「判否不产生新目标」的权限护城河（§2.3）与 fail-open 全链一致（问不到≠问到了说不是，§3.6）。
- 判官 = preset.default 的三后果论证，含贵 default 反噬的诚实登记（§3.1）。
- decide 保持纯函数 + 纯过滤函数对（confirmableHits/applyConfirmVerdicts，§5.1）的可证伪结构。
- 与 1.1.0 认领抑制的正交性与顺序钉死（§1.1），不重复治理。
- 试一句偏差的显式声明而非静默（§8.2），以及「存量零突变 = 既有测试逐字节通过」的可执行定义（§9 红线）。
- 实机验收 A1-A6 与判否率指标暴露（§11.5）的发布门槛意识。

---

## 2. 控制器逐项复核（DSH 主 agent，2026-09-15，逐条回源码）

> 依 `docs/agent-collaboration-loop.md` §3.4：审查者也会误报，每条先核源码再进修复循环。

| # | 评审意见 | 复核结论 | 本次实读证据 | 处置 |
|---|---|---|---|---|
| S1 | `hitConfirm: Schema.object` 破坏「缺省不注入」 | **成立** | `settings-schema.ts:63-71` 自述「对象/字典/数组型字段：缺失即注入 {}/[]，与是否带 default 无关」；`:69-71` v3 `default` 正是因此不入 schema；`settings-schema.test.ts:7-9` 原文断言往返相等 | **必改**：`hitConfirm` 不入 presetSchema（透传保活 + `validateRouterConfig` 校验），与 v3 default 同款 |
| M1 | 判否集合未穿进 re-decide | **成立** | `router.ts:613/631/643` 三处 `router.decide(...)`，后两处仅传 `false` | **必改**：三处同带 `omittedRuleIds`；补「闸 × eager 转述」wiring 用例 |
| M2 | 结果不可能生效的轮仍发调用 | **成立** | `router.ts:237-243` 显式 @ 在 :251 之前短路；`:265` image 命中计 ∞ 恒排首位 | **必改**：§7 补前置短路 + 零调用断言 |
| M3 | 前置过滤破坏「降级不误标特异度最高」 | **成立** | `router.ts:265-267` 标注取 `routable.length > 1 && index === 0`；`router.md:532-533` 记录该不变量 | **必改**：§5.3 补标注规则 |
| M4 | 只判链首 → 次条未确认即改道；§4.5 断链 | **成立** | 稿件 §3.4/§7 确有「§4.5」引用而全文无该小节 | **必改**：§2.4 登记限制 + 修正引用 |
| L5 | 锚点瑕疵（`_ui-review` 不在仓库内；模型名 `deepseek-v4-flash`） | **成立** | `config.ts:115` 实为 `deepseek-v4-flash`；`_ui-review-2026-08-29.md` 确实在仓库**上一级**目录 | **必改**（措辞） |
| L1-L4/L6、未覆盖项 | 表述与完备性 | **成立/合理** | 抽查 `router.ts:761-795`（llm/stream 拦截器）确实存在于调用链上 | 采纳，进 v2 |

**结论**：评审意见 **9 条成立、0 条误报**（未逐条复核的 L2/L3/L4 为设计判断类，采纳其建议）；本稿需出 **v2**，必改 6 项。
