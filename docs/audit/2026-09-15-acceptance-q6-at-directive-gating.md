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

（待回填：严重 / 中等 / 轻微 / 优点 / 未核实项 / 评审方法）
