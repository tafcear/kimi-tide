# 验收档案：Q6 显式 `@` 已知 provider 门控（2026-09-15）

> 对象：`docs/superpowers/specs/2026-09-15-at-directive-known-provider-design.md` 及其实现（提交 `e2938d9` spec+实施、`de0f725` 评审修复波）。
> 本档案分两部分：**A 控制器实机核验**（本会话完成，证据全部来自构建产物实跑）；**B 独立模型评审**（评审者 `zai-coding-cn/glm-5.3`，结论见文末）。

## A. 控制器实机核验（2026-09-15，全过）

工具：`scripts/acceptance/q6-gating-check.mjs`（新增，跑的是**构建产物** `lib/`，不依赖宿主）。
为什么能离线验：门控判据 `effectiveExplicitDirective(text, known)` 是纯函数，效果面 `KimiRouter.decide()` 也是纯函数（注入 metas 即可）。

### A1. 判据边界（10 例全过）

| # | 文本 | 期望 | 实测 |
| --- | --- | --- | --- |
| 1 | `@README.md 的说明帮我重构这个函数` | 非指令 | ✅ null |
| 2 | `请读 node_modules/@deepseek-ai/dsh-session 的导出` | 非指令 | ✅ null |
| 3 | `npm i @scope/pkg@1.2.3 然后跑测试` | 非指令 | ✅ null |
| 4 | `文件在 E:\x\@deepseek-ai\dsh\lib\index.js` | 非指令 | ✅ null |
| 5 | `联系 user@example.com 拿资料` | 非指令 | ✅ null |
| 6 | `@kimi 帮我看这段代码` | `{provider:'kimi-coding'}` | ✅ |
| 7 | `见 @deepseek-ai/x，另 @kimi 帮我看` | `{provider:'kimi-coding'}` | ✅ **首个已知匹配**（前面的包名不吞后面的真指令） |
| 8 | `@qwen-token-plan-cn/qwen3.8-max 你好` | `{provider, model}` | ✅ 精确寻址 |
| 9 | `@anthropic 帮我看看` | 非指令 | ✅ null |
| 10 | `@zai-coding-cn 帮我看` | `{provider:'zai-coding-cn'}` | ✅（候选可用性不参与该判定） |

### A2. decide 三态（4 例全过，metas 里 `qwen-token-plan-cn` 置 `available:false` 模拟 key 缺失）

| 情形 | 实测 |
| --- | --- |
| 未识别 `@anthropic` | `route → deepseek-official/deepseek-v4-flash`（via **default**），原因 `@anthropic 非本路由器已知 provider（已忽略）· 预设「省钱」默认` ✅ |
| 引用式 `@README.md` | 同上（`@README 非本路由器已知 provider（已忽略）`）✅ |
| 已知 provider 无可用候选 `@qwen-token-plan-cn` | **`keep`**，原因 `显式 @qwen-token-plan-cn 无可用候选（provider 已知但当前无可路由模型）` ✅ 保 Q3 |
| 真指令 `@zai-coding-cn` | `route → zai-coding-cn/glm-5.3`（via **explicit**），原因 `显式 @zai-coding-cn 指令 → glm-5.3（目录序首个可用）` ✅ |

### A3. 四处调用点同源（静态核对）

`effectiveExplicitDirective` 出现在四处，全部传 `known`：

- `router.ts:301` —— `decide()` 的显式 @ 分支
- `router.ts:756` —— 语义闸前置短路
- `rules.ts:270` —— `reviewTriggerHit`（第 4 参）
- `rules.ts:346` —— `previewRoute`

`KimiRouter.knownProviders()` = 目录全部 provider（**含 `available:false`**）∪ `KIMI_PROVIDER` ∪ 预设已配置 provider（`configuredProviders(preset)`，与 `pickExplicitTarget` 同源）——与 spec 口径一致。

### A4. 边界（诚实标注）

- `known == null`（目录枚举失败/能力未知）时**退化为纯词法判定**：实测 `'@README.md 帮我重构'` → `{provider:'README'}`。这是设计的**保守降级**（宁可过度识别也不漏真指令），但意味着「目录拿不到」时 Q6 的门控不生效——**spec 未把这一条写成显式风险**，建议补进 §7（见 B 部分结论）。
- 本档案 A 部分的证据全部来自**构建产物**，未经过宿主实机；宿主侧等价位是实机验收清单 A9（含 `@README.md` 的消息 ⇒ 落规则目标而非 keep），该探针已于 2026-09-15 实测通过。

## B. 独立模型评审

**评审者身份核验**（按会话日志，不取模型自述）：子会话 `11f6eb7d-f5b9-45c8-8628-8ab1b3bb622f` 的 `request/header` = `zai-coding-cn/glm-5.3`（effort=max）。同一会话的 system prompt 里仍写着 "You are a coding agent powered by the deepseek-flash model" ——**再次印证「模型自述不是身份证据，只有 request/header 才是」**。

**状态**：进行中（派发于 19:39，19:51 仍在读测试文件核变体覆盖）。结论回填于下节。

### 评审结论

**有条件同意**——实现与 spec 主张逐条核实属实、变异判别力真实；两个条件**均已于本会话闭环**。

#### 评审过程事故（S1，已修，责任在控制器）

评审者按任务授权在工作树里做**原位变异测试**（把 `rules.ts:68` 的降级行改成
`if (known == null || known.size >= 0) return explicitDirective(text)`——`known.size >= 0`
恒真 ⇒ 函数变空操作 ⇒ Q6 门控**四处调用点全部退化为词法判定**，等于回滚到本次修复之前的 bug）。
我在同一时段用 **`git add -A`** 提交验收档案，把这份**在途变异**一起扫进了 `58419a9`；
评审者随后的 `git checkout` 是对着**已含变异的 HEAD** 还原的，所以它自己没救回来——**是评审者主动报告才被发现**（这一点值得记：评审者比控制器更早发现自己造成的污染）。

- 修复：`git checkout 0e28be4 -- packages/dsh-kimi-tide/src/rules.ts` → 提交 `8923a8a`；`router.ts` 与全部测试未被波及（`git log 0e28be4..HEAD -- src test` 只命中 rules.ts）。
- 涟漪处理：`v1.3.0` 附注 tag 已**重建**指向 `8923a8a`（否则发出去的 tag 内含带变异的提交），并用流水线同款路径复验（`check-release-notes --tag v1.3.0` OK）；`lib/` 已重建并以 `known == null` 断言核对。
- **纪律（已写入协作日志）**：① 并行 agent 在改工作区时**不许 `git add -A`**——只 add 明确路径，提交前看 `git diff --cached --stat`；② **不许让子代理在共享工作树里做原位变异测试**（要变异就给 `git worktree`/副本，或要求它只列补丁）；③ 「我改完会还原」不是并发安全的保证。

#### 两条中等的处置（均补测 + 变异实证）

| # | 缺口 | 处置 | 变异验证（本次实跑） |
| --- | --- | --- | --- |
| M1 | `knownProviders()`「含 `available:false`」口径零测试钉住——既有的 keep 用例走的是 `configuredProviders` 通道 | `router.test.ts` 新增「provider 仅以 `available:false` 存在于 metas ⇒ 仍算认识 ⇒ keep」 | 把 `knownProviders` 改成 `.filter(m => m.available)` ⇒ **只有该用例红**（精确命中） |
| M2 | `router.ts:881` 的 `reviewTriggerHit` 第 4 参无 wiring 级用例（既有用例只钉「真指令抑制武装」方向） | `review-orchestration.test.ts` 新增 4b「未知 `@README.md` ⇒ **不**抑制武装」 | 去掉第 4 参 ⇒ **只有 4b 红**（精确命中） |

#### 轻微（3 条，均未修，登记备查）

- **L1** `previewRoute` 无 `noteHead` 对应物（`rules.ts:401,430` vs `router.ts:303-304,389,393`）：路由**语义**两侧一致，仅可解释性不对称，且 spec/router.md 未声明。
- **L2** `rules.ts:78-79` 注释称 `configuredProviders` 与 `pickExplicitTarget`「同源不会漂移」名不副实——实际是三份平行实现（`rules.ts:349-352`、`router.ts:403-406`）；语义今天一致，无机制防漂移。
- **L3** 与已知 provider 同名的文件/目录仍会被当指令（`@kimi.md`、`@kimi-tide/kimi-tide`——本仓目录名即撞别名）。Q6 前后行为相同（**非回归**），但 spec §4 只讨论了「未知名不可区分」，未讨论「已知名碰撞」这一残留面。

#### 评审核实的优点（3 条，摘）

1. **单一实现纪律真实成立**：四处调用点全走 `effectiveExplicitDirective`，全 src grep 无漏网；残余词法用法仅三处且各有正当理由（降级路径、noteHead 解释器、带「不得当路由判据」JSDoc 的测试锚点）。
2. **降级不误伤 + Q3 闭环落地**：`known == null` ⇒ 词法旧行为贯穿四点；`index.ts:209-219` 为「配置指向但目录缺失」补 `available:false` metas，使「已知无候选 ⇒ keep」在目录缺失时仍成立。
3. **判别力经实际变异复现**：核心门控退回词法 ⇒ 9 用例红横跨 4 个测试文件；语义闸调用点退回词法 ⇒ 恰好 `router-wiring.test.ts:329` 一红——`de0f725` 声称的「变异实证」不是自述。

#### 未核实 / 需运行期验证

- 评审者的 M3/M4/M5 三个变异未实跑（其会话被截止）；其中 **M4（knownProviders 滤 available）已由本会话补跑**（见上表 M1 行），M3/M5 的核实方法已由评审者给出（改 `rules.ts:71-74` 为单匹配 / 删 `router.ts:881` 第 4 参）。
- A9 实机验收、R6（preview/decide 两次拉取口径分叉，需宿主活体）、R1（枚举失败窗口期行为）离线不可构造，维持 spec 备案。
- 本会话发现的补充边界：`known == null` 时门控退化为纯词法判定（见 A4），spec 未写成风险。

**验证**：全量 `691/691 绿`（含新增 2 例）、typecheck 0、build 过、四个文档门禁过。
