# 评审档案：v1.3.0 三项已落地改动（2026-09-15，独立模型评审）

> **评审人**：**glm-5.3**（provider `zai-coding-cn`；经 `@zai-coding-cn` 显式 @ 派发——Kimi 月配额已尽，且当日已实证该 provider 的池内首个即可用模型为 glm-5.3）
> **评审对象**：三个已落地提交 `015147f`（配额条剩余语义）/ `4f7f658`（Q2 页签提示 + Q4 措辞）/ `eece851`（说明页签 + 页签 a11y）
> **评审结论**：**有条件同意合并**（3 中等 + 8 轻微；1 处事实错误 + 两道闸的覆盖弱于自称）
> **独立性**：与作者（DSH 主 agent / deepseek-flash）不同族；**只读**（未运行测试——绿色声明属作者自述，评审明确标注「无法核实」）
> **控制器复核**：见 §2（逐条核源码；3 中等全部成立、已修）

---

## 1. 评审报告全文（评审模型产出，未删改结论）

**结论：有条件同意合并。** 015147f、4f7f658 成熟可保留；eece851 功能与结构达成（容器+hidden 确实结构性消灭 `:not()` 链那类 bug，a11y 补齐完整），但说明内容含 1 处事实错误、两道“闸”的实际覆盖弱于其自称，需一次小改。全程只读；测试绿色为提交自称、**无法核实**（未运行），静态核对未见必红断言。另注：评审期间仓库 HEAD 前移且 `TideDock.tsx` 出现未提交改动（并发开发中），本评审全部按固定 SHA 取证，不受影响。

### 中等（会导致错误行为或返工）

1. **说明页事实错误：预设删除守卫不存在** · 「被规则引用的预设不会被静默删掉」为虚构——规则结构上不可能引用预设，`deletePreset` 无任何引用守卫；真正的守卫在 `deleteFlow`（规则 target 与 imageFallbackFlow 引用检查、预置流恒不可删），张冠李戴且违反本提交自己的「只描述 ship 行为」纪律 · help-content.ts:244 vs card-store.ts:388-400、:410-426 · 改文案指向协作流。
2. **防腐烂闸承诺过强：反向闸只查顶层键** · 文件头声称「配置加了字段而说明不补条目→测试红」，实际仅对 schema 顶层成立（顶层键集经核对齐全：version/activePreset/presets/flows/keywordGroups/auxTargets/mode ⊆ 首段∪legacy）；嵌套/可选新字段（`rules[].when.*`、`flows.*`、`auxTargets` 子结构、preset 新可选字段）加多少都不红 · help-content.test.ts:87-94、help-content.ts:7-8 · 注释改口或递归枚举叶子路径。
3. **覆盖闸单向 + 存在性≠挂载正确** · 锚闸只验 DOCK_ELEMENTS ⊆ 渲染出的 `data-kt-el` 并集；新元素挂锚不进 DOCK_ELEMENTS → 全绿（测试标题「新增 dock 元素不补说明条目不挂锚→此处红」方向说反了一半）；按属性存在性匹配，锚挂错元素照样绿 · TideDock.test.tsx:370、:391-395 · 补 `anchors ⊆ DOCK_ELEMENTS` 反向断言。eece851 时点我逐个数过：恰 13 锚=13 项，当下无缺漏，纯靠手工同步。

### 轻微（措辞与完备性）

4. **阈值「等价」不严格** · `round(剩余)` 与旧 `round(已用)` 在 .5 边界不等价（used=89.5% → 旧 danger、新 warn），注释/测试名宣称「等价」· TideDock.tsx:124-130。
5. **负 used 无上限夹取** · `剩120%` 上屏（条宽被剪、数字不夹）；旧版同样未夹，非回归 · TideDock.tsx:119-122。
6. **键盘导航测试未钉 roving** · 只断言 data-tab 变化，不查 tabIndex/aria-selected/activeElement；v4 无协作流页签的路径零测试（实现按 DOM 实查询，结构上正确）· SettingsCard.dom.test.tsx:917-945。
7. **方向键未滤修饰键** · Alt/Shift+←/→ 也被 preventDefault 吞 · SettingsCard.tsx:452-476。
8. **静态 id 唯一性假设** · `kt-tab-*`/`kt-panel-*` 依赖单实例；双实例即撞 id · SettingsCard.tsx:744-768。
9. **反向闸空转风险** · schema 键若不可枚举则循环空转恒绿，无键数下限钉 · help-content.test.ts:88-93。
10. **live 口径不一** · routing-preset 显示预设 id，dock 链显示 name（saving vs 省钱）· help-content.ts:221。
11. **4 条放宽断言可接受但确有收窄** · 「带图兜底」收窄到 aria-label 后，非控件形态误渲不再拦；`· 最少命中词数` 前缀钉仍有效（核对过模板 `第 N 条 · 最少命中词数`）· SettingsCard.test.tsx:239,306,312。

### 七项重点核实结论

1. **容器重构等价**：是。直接子节点逐一对过（route=预设行/编辑器/规则/兜底/操作/关键词组，trial=试一句，flows=v5 门控，help=HelpTab），与旧 route 页可见集逐一相同；`hidden` 由 activeTab 取反驱动，`!important` 作者规则压过 `.kt-flows/.kt-trial` 的 display:flex（同级特异性、靠后生效）；无重复渲染；hidden+tabIndex=0 无聚焦陷阱（display:none 子树不可聚焦，焦点常驻 tab 按钮）。
2. **键盘导航**：←/→ 取模循环、Home/End、focus+setActiveTab 同步正确；v4 缺协作流时按 DOM 实序仍正确（未测，见 6）。
3. **防腐烂闸**：顶层改名/删除会被抓（fullSample 含全部可选字段+TS 逼改）；漏网=嵌套/可选新增字段（见 2）。
4. **覆盖闸真实性**：eece851 时点 13=13 属实；存在性匹配+单向（见 3）。
5. **配额边界**：used>limit→0%/红 ✓；limit 极大精度 ✓；limit=0（该窗单独置灰+「该窗口无数据」）与整快照 null（全置灰+取数失败）分层一致 ✓；唯负 used 与 .5 边界（见 4/5）。
6. **测试质量**：未见恒绿断言（80/90 边界、`not.toContain('width:100%')`/`剩100%` 均真钉）；ClientStyles 双向钉（新规则在、旧链不在）质量高；缺口即 6/9。
7. **只读**：HelpTab 零写路径（纯 createElement，live 纯读+try/catch 降级，dom 测试钉 0 控件）；越权描述=第 1 条；其余行为断言逐条对源码核实为真（特异度排序、词边界、内置 7 组、轮末评审、autoRevise 只呈现、命令清单、两步删除、单在途请求、latch 默认、「打底与保持原样不上屏」、两种空态文案均吻合）。

**无法核实**：测试/typecheck/build 绿色声明（未运行）；zai 积分制取数语义（zai-usage.ts 存在，未逐行核对）。

### 值得保留

- 015147f：remainPct 单点实现、null 三态齐、title/aria 同步、真边界断言。
- 4f7f658：`role=status` 被 display:none 移出无障碍树的根因诊断准确；README 双语同 commit 合规。
- eece851：容器+hidden 一次性消灭一类 bug；!important 兜底+测试双向钉；tab/tabpanel 语义成对完整；HelpTab 真只读；help-content 单一内容源纯函数可单测的设计本身值得留（问题只在两道闸的措辞与一条文案）。

---

## 2. 控制器逐项复核与处置（DSH 主 agent，2026-09-15）

> 依 `docs/agent-collaboration-loop.md` §3.4：审查者也会误报，每条先核源码再进修复循环。

| # | 评审意见 | 复核结论 | 本次实读证据 | 处置 |
|---|---|---|---|---|
| 1 | 预设删除守卫不存在（事实错误） | **成立** | `card-store.ts` 接口文档：`deletePreset` 仅「删激活预设时先写 activePreset: null」，**无任何引用守卫**；`deleteFlow` 才写明「预置流不可删 + 被规则 target 或 imageFallbackFlow 引用拒删」 | **已修**：`routing-ops` 改为「规则指向模型、不指向预设，删预设不牵连别的配置」；新增 `flows-delete-guard` 条目陈述真实的引用守卫 |
| 2 | 反向闸只查顶层键，声明过强 | **成立** | `help-content.test.ts` 反向闸确实只遍历 `Object.keys(parsed)` | **已修**：文件头与测试名收窄为「**顶层**配置字段…（嵌套/可选新字段靠人与评审把关）」 |
| 3 | 覆盖闸单向 | **成立** | 旧断言 `for (const id of DOCK_ELEMENTS) expect(union.has(id))` 只抓漏锚 | **已修**：改为双侧豁免 `notice` 后比**全等**（同时抓「漏锚」与「挂了锚未进清单」），并据实核对当前 15 锚 = 15 项 |
| 4 | 阈值「等价」不严格 | **成立**（.5 半界点确不等价） | `remainPct` 用 `round(剩余)`，旧 `pctClass` 用 `round(已用)` | **已修**：注释删「等价」，改为「同一界、半界点不严格等价（评审 #4）」 |
| 5 | 负 used 未夹取 | **成立** | `remainPct` 仅 `Math.max(0, limit - used)` 下夹 | **已修**：加 `Math.min(100, …)` 上夹 |
| 6 | 键盘测试未钉 roving | **成立** | 原断言只看 `data-tab` | **已修**：补 `aria-selected` / `tabindex` 数组断言（含循环回位） |
| 7 | 方向键未滤修饰键 | **成立** | `onTablistKeyDown` 原无修饰键判断 | **已修**：`altKey/ctrlKey/metaKey/shiftKey` 直接 return；补 Alt+→ 断言 |
| 8 | 静态 id 唯一性假设 | 成立但**非本版必修** | `kt-tab-*`/`kt-panel-*` 为常量 id | 记入风险（宿主单实例渲染是当前事实）；不修，留待出现双实例场景 |
| 9 | 反向闸空转风险 | **成立** | 循环无下限钉 | **已修**：加 `Object.keys(parsed).length >= 5`（当前实测值，作为枚举机制探针） |
| 10 | live 口径不一（id vs name） | **成立** | `routing-preset` 的 live 显示 `activePreset` | **已修**：改用 `presetOf(c)?.name`，与 dock 链口径一致 |
| 11 | 放宽断言确有收窄 | 成立但**可接受** | 四条断言收窄到控件级 a11y 名 | 不改：收窄是恒挂载说明页导致的必然（已在注释写明理由） |

**结论**：评审 3 中等 + 6 项轻微**成立并已修**；1 项（#8 双实例 id）记为风险不修；1 项（#11）说明保留。修复后 **641/641 绿** + typecheck 0 + build 过——评审「无法核实」的绿色声明由控制器在本轮补上实测。
