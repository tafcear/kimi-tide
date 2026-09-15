# 待办队列（spec 之外的排队项）

> **用途**：收纳**已确认但尚未进入 spec/实施**的工程项——评审衍生项、既有缺陷、待核口径。
> **与其它文档的关系**：`docs/superpowers/specs/` 是设计稿，`plans/` 是实施计划，`audit/` 是评审档案；本文件只做**排队与溯源**，不重复它们的正文。
> **正式追踪渠道**：仓库惯例是 GitHub Issues（`docs/agents/issue-tracker.md`）；**当前 `gh` 认证失效**（09-15 实测 token invalid），本文件为过渡队列，恢复后逐条转 issue。
> **维护纪律**：条目带证据锚点（`file:line` 或实测输出）；状态取 `排队 / 进行中 / 完成 / 转出`；完成后在「处置记录」里写落地版本。

---

## 队列

### Q1 · 三份在途 spec 的 v2 回改（22 项必改）

- **来源**：`docs/audit/2026-09-15-review-semantic-hit-gate-spec-glm-review.md`、`docs/audit/2026-09-15-review-panel-help-tab-spec-glm-review.md`、`docs/audit/2026-09-15-review-quota-balance-coverage-spec-qwen-review.md`（控制器逐项复核 22/22 成立、0 误报；**评审者署名已于 2026-09-15 更正**——前两份实为 glm-5.3 完成，见各档案头部「更正记录」与 Q6）
- **内容**：语义闸 6 项（含 S1 对象型 schema 注入破坏往返相等、M1 判否集合未穿进 re-decide 三处调用点）／用量余额 7 项（含 S1 三态无通路、M1 `UsageMonitor` 类型契约）／说明页签 9 项（含 M1 route 页签无单一面板节点、M2 `hidden` 语义不自洽）
- **附带同步**（2026-09-15 配额条改语义后新增）：用量/余额稿 §6.1 与说明页签稿 §3① 的「配额槽」描述须改写为**剩余语义**（条=剩余比例、数字=剩余百分比、警示色含条身、`limit=0` 显示 `—`）；说明页签稿 ⑦ 的「额度槽显示 `—`」病因行需补「该窗无数据」这一因
- **状态**：**进行中（2026-09-15）**——① 说明页签：spec v2 + **实施完毕**（`eece851`）；② 用量/余额：spec v2 + **实施完毕**（`36ff9ee` 数据层与自适应槽、`bb24af4` 总览面板、`909577d` Q5 结论与文档）——四源注册表、`QuotaLike` 拓宽、余额解析与三段 baseURL 链、`quotaSources` 三态元数据、dock 余额单槽 + 用量总览面板；③ 语义闸：spec v2 + **主体实施完毕**（`ccf82e1`：hit-confirm.ts 判官闸、`preset.hitConfirm` 不入 schema、`decide` 第 4 参与标注解耦、pre-step 前置短路、三处调用同带判否集），**设置页开关已落地（`b2ebecc`）**；余实机验收 A1–A8（用户执行，需先重启宿主）
- **处置**：逐份出 v2，头部登记处置表；Q2/Q4 随说明页签 v2 一并处理（**二者已完成**）

### Q2 · 既有 bug：测试场页签藏掉错误横幅

- **来源**：说明页签评审 M3 连带发现；控制器已复核
- **证据**：`packages/dsh-kimi-tide/src/client/styles.ts:163`（flows 行）含 `:not(.kt-error)`，`:164`（trial 行）**缺失** ⇒ `data-tab='trial'` 时错误横幅被 `display:none` 吞掉
- **影响**：UI 评审 P2-5 修复不彻底；用户在测试场页签看不到保存/校验错误
- **方向**：给 trial 行补 `:not(.kt-error)`（另有 `.kt-saved` 同理待核）；新增 help 页签时必须写全
- **状态**：**完成**（2026-09-15）——实测确认 `.kt-saved` 同样被 flows 行藏住，且 `role="status"` 被 `display:none` 后**不在无障碍树里 ⇒ 保存静默不播报**，故一行修两处：flows/trial 两行均补 `:not(.kt-error):not(.kt-saved)`；两条 CSS 结构钉测试（先红后绿）；597/597 绿

### Q3 · 显式 `@` 指令的模型选择缺陷（三项）

- **来源**：用户提问「显式命令是不是不应该写死某个模型」+ 本会话实测探针
- **证据链**：
  - **写死的是 provider 别名**：`config.ts:14` `KIMI_PROVIDER = 'kimi-coding'`；`rules.ts:14-21` 把 `@kimi`/`@kimi-tide` 映射到该常量
  - **模型是隐式的池内首个**：`router.ts:236-243` `pool = metas.filter(provider === explicit && available)` → `target = pool[0]`；池序来自宿主 `llm.listModels()`（`index.ts:158-161`），即 settings 模型列表顺序
  - **决策原因不写选了谁**：`router.ts:242` 仅 `显式 @<provider> 指令`
  - **实测**：探针 `@qwen-token-plan-cn` → `model: "MiniMax-M2.5"`（非 qwen3.8-max）→ `403 AccessDenied.Unpurchased`（套餐未购买该模型）⇒ 整轮失败
- **三项毛病**：① 不可解释（点名 Qwen 实跑 MiniMax）② 顺序耦合（列表改序即换模型）③ 无权益感知（`available` 只表示「目录里有」，不等于「套餐已购」；请求期失败不在规则链降级兜底范围内）
- **方向**（四选，未定）：
  - **A** 支持 `@provider/model` 精确寻址（正则现为 `[\w-]{2,20}`，不接受 `/`）
  - **C** 池内首选确定化 + 写进决策原因（优先「预设内已用目标」> 目录序；原因串带实际模型与依据）
  - **D** 请求期失败兜底：宿主有 `agent/request-error`（waterfall，可返回 `{ kind: 'retry' }`，`dsh-agent/lib/types/runtime-types.d.ts:357-363`）——可识别 403 类错误换候选，需做重试上限
  - **B** `@kimi` 别名去硬编码（可配映射或废弃）——今日 Kimi 月配额耗尽后该别名已无可用目标，且 provider 改名时会静默落进「未知 provider → keep」宽容分支
- **状态**：**完成（2026-09-15，`5452713`）**——`@provider/model` 精确寻址 + 池内确定化 + 原因可解释 + 试一句同款语义；实机验证随 A6 探针（需重启宿主）

### Q4 · 文档措辞：「首条命中生效」是错的心智模型

- **来源**：说明页签评审 M4；控制器复核
- **证据**：真实语义是**特异度降序、平手按列表序**（`rules.ts:104-123` 稳定排序；`router.ts:244` 遍历的是**排序后**列表）⇒「位置靠后但命中词更多」的规则会赢
- **影响面**：`README.md` / `README.en.md` / `packages/dsh-kimi-tide/README.md` / `docs/router.md` 同款措辞；说明页签 ② 与 ⑦
- **状态**：**完成**（2026-09-15）——实测只有 `README.md`（2 处：正文 + mermaid 节点）与 `README.en.md`（2 处同位置）含该措辞，包 README 与 `router.md` 无；历史文档（`plans/`、`specs/`、`audit/`、`.superpowers/`）按「时点记录不改写」原则保留原文。双语同提交，`check-readme-sync` 通过
- **附带**：说明页签 ② 与 ⑦ 的措辞在 Q1 的 v2 里按同一口径改写（该稿尚未实施）

### Q5 · Kimi 配额口径待核：monthly 与周/5h 的关系

- **来源**：k3 评审中断事件的 403 文案；抢救档案 §2 教训 D
- **证据**：`403 permission_error: "You've reached your monthly usage limit for this billing cycle"` vs dock 显示的两窗为「周 / 5h」（`parseQuotaSnapshot`：`root.usage` → weekly、`limits[0].detail` → fiveHour，`types.ts:139-152`）
- **待核**：`/coding/v1/usages` 是否也报 monthly 窗；若否，面板会在月配额已耗尽时仍显示「剩 N」
- **转出**：并入 Q1 的用量/余额 v2（该稿正在改配额显示面）
- **状态**：**已处置（2026-09-15）**——可核查部分已实证：该 403 文案确为 `monthly usage limit for this billing cycle`，而面板显示的是服务端返回的周/5h 两窗 ⇒ **月上限不在面板口径内**是设计事实而非 bug；已写入说明页（「为什么显示还有额度却报已达上限」）与 CHANGELOG。**未做**：无法在本机验证「服务端是否另有可取的月窗」——需带 key 实测（与 qwen 那条同性质，留给用户或后续版）

---

### Q6 · `@` 指令误判面过宽：`@scope/pkg`、`@路径` 类文本静默关掉规则路由

- **来源**：用户提问「coding 的时候是谁在 coding，评审的时候为什么又变成了 glm」→ 控制器核查 workflow 三份 spec 评审的实际落点，发现两份落在 glm-5.3 而非请求的 qwen3.8-max；根因追到显式 `@` 分支（连带更正两份 audit 档案署名）
- **证据链**（2026-09-15，构建产物 `lib/rules.js` 实跑）：
  - **误判**：`请读 node_modules/@deepseek-ai/dsh-session 的导出` → `{provider:'deepseek-ai', model:'dsh-session'}`；`见 @README.md 的说明` → `{provider:'README'}`；`npm i @scope/pkg@1.2.3` → `{provider:'scope', model:'pkg'}`；`文件在 E:\…\@deepseek-ai\dsh\lib\index.js` → `{provider:'deepseek-ai'}`
  - **正确项**（不受影响）：`@kimi 帮我看这段代码` → `kimi-coding`；`@qwen-token-plan-cn/qwen3.8-max 你好` → 精确寻址；`联系 user@example.com` → `null`
  - **短路点** `packages/dsh-kimi-tide/src/router.ts:247`：`if (pool.length === 0) return { kind: 'keep', reason: 'explicit @x: no available candidate' }` ⇒ 未知 provider **不落规则链**，直接保持当前路由
  - **连带** `packages/dsh-kimi-tide/src/router.ts:681`：`if (explicitProvider(turnText) === null)` ⇒ 同一误判还会**跳过语义确认闸**
- **影响面**：本 Harness 的系统提示即把 `@` 前缀定义为**工作区路径引用**；本仓提示词又大量出现 `@deepseek-ai/…`、`@earendil-works/pi-ai` 等 scoped 包名 ⇒ **任何提到包名或 `@文件` 的轮次都会静默失去规则路由**（落回打底/派发时请求的目标），且原因串只写 `explicit @x: no available candidate`，用户看不出规则被跳过
- **实机案例**：workflow 三 agent 同传 `qwen3.8-max`——用量余额那份 prompt 含 `@deepseek-ai` ⇒ 保持 qwen3.8-max；语义闸/说明页签两份无 `@` ⇒ 命中 `code` 组 ⇒ glm-5.3（两处子会话 `request/header` 实锤）
- **方向**（未定，须先出 spec）：
  - **A 收紧识别**：要求 `@` 为独立 token（行首或空白后，且其后跟行尾/空白/标点），或对 `/` 后模型段加约束（scoped 包名的斜杠后是包名而非模型）
  - **B 未知 provider 不短路**：`pool.length === 0` 时**继续走规则链**，`keep` 只留给「router off / activePreset 缺失」这类真·非路由场景，原因串写明「`@x` 非已知 provider，已按规则链决策」
  - **C 至少可解释**：原因串区分「已知 provider 但无可用候选」与「未知 provider」两类
  - **建议组合 A + B**（A 减误判面，B 兜住漏网的误判）；注意 `keep` 对未知 provider 是否**有意为之**（Q3 选项 B 曾把它记为「宽容分支」）须在 spec 里先定性
- **状态**：**完成（2026-09-15，并入 v1.3.0）**——用户裁定「Q6 并入这一版，完成后再发」⇒ spec `docs/superpowers/specs/2026-09-15-at-directive-known-provider-design.md` + TDD 实施。**方向定案 A + C（B 被 A 吸收）**：新增 `effectiveExplicitDirective(text, known)` 与 `configuredProviders(preset)`，`known = 目录全部 provider（含不可用）∪ 预设已配置目标 ∪ KIMI_PROVIDER`；四处调用点同源（decide 显式分支 / 语义闸前置短路 / reviewTriggerHit / previewRoute）；取**首个已知匹配**（前面包名不吞后面真指令）；原因串前缀「`@x` 非本路由器已知 provider（已忽略）」；已知 provider 无候选仍 `keep`（Q3 语义保持）。**一处有意变更**：未识别的 `@provider`（如 `@anthropic`）由 keep 改落打底 + 说明——词法上与 `@README` 不可区分，必须在两种降级里选一边（原测试 `router.test.ts` 那条断言已按新语义改写并注明理由）。**验证**：659/659 绿（改前 641，+18 用例——含评审修复波补的 4 条）、typecheck 0、build 过

---

### Q7 · 用量归属账本与路由生效判据（**挂账**：设计稿已出、未实施）

- **来源**：用户 2026-09-15 提出「每次对话都有这个用量统计，可以用这个信息」→ 追问后裁定 **A（按模型/规则/预设的真实用量账）+ C（用量接回路由）**，并追加最关键的用途：**用「用量归属」当路由是否真的生效的判据**；随后裁定「**这个设计挂账吧**」。
- **设计稿**：`docs/superpowers/specs/2026-09-15-usage-attribution-ledger-design.md`（提交 `411c9b2`，状态「待评审 / 挂账」）
- **已裁定的三问**：① **只报 token，不算钱**（系统里没有任何 token 单价，`LlmModelInfo`/`LlmResolvedModelInfo` 只有 `context/defaultMaxTokens/reasoning`，全库唯一的价是图片请求计价）② **时间窗只本会话** ③ **一次做完、判据优先**
- **依据（均已实机取证，写进稿子 §1.2）**：`assistant/message` 事件**同时**带 `data.usage`（未缓存输入/缓存读/输出，语义由 `dsh-llm types.d.ts:131-150` 背书）与 `data.message.source.{provider,model}`（**真正答话的模型**）；一发探针会话实测唯一归属 `zai-coding-cn/glm-5.3`、合计 771,250 token、缓存命中率 92.0%
- **为什么值得做**：① 判据在线零成本，每轮自动跑（现有判据是离线解码 `request/header`，今天验 A7 就是这么做的）② 宿主那张卡是**聚合数**，答不了「哪个模型/哪条规则在烧钱」③ 缓存命中率才是真省钱杠杆，只有按模型拆开才看得见
- **状态**：**挂账（2026-09-15，用户裁定）**——设计稿已出，未实施。**恢复时**：先按 §6 剩余未决项（是否按规则记账、C 组落点）确认，再走「评审 → TDD 实施」
- **恢复入口**：稿子 §5 改动面（新 `usage-ledger.ts` 纯函数 fold + router 的 `session/event` 监听扩宽 + 面板快照字段 + dock/说明页）、§7 验收面（4 条单测 + 2 条实机）

---

### Q8 · 协作流设置的并发写栅栏（F-A4b 的落点，**部分定性、未修**）

- **来源**：09-04 实机验收候选缺陷 F-A4b（切触发方式后 `settings.yaml` 的 `autoRevise: true` 被静默写成 `false`，而页内复选框仍显示 on）；2026-09-15 两次只读复查（第二次见 `plans/2026-09-04-review-flow-orchestration.md` 原位追加段）
- **已排除**：① 客户端 payload 不丢字段（`SettingsCard.dom.test.tsx` 的 F-A4b 用例 + 两次切换断言 `autoRevise: true`）；② 「草稿陈旧」那条路（协作流表单**没有本地草稿**，每次 `onChange` 都从当前快照组装并立即写；关键词组那类形态已在 P2-4 修过）
- **已定性**：`saveFlows` 是**整段覆盖**（`card-store.ts` → `saveTop('flows', flows)`，payload 由卡片快照组装）；宿主侧的乐观并发栅栏是齐的（`dsh-settings` 的 `update/replace/mutate` 收 `expectedRevision`，前移即抛 `SettingsConflictError`），**但 kimi-tide 没用上**——`saveTop` 走 `scope.set(field, value)`，而 owner scope 的公开面只有 `get/watch/update/replace`，**`SettingsScope` 上既无 `set` 也无 `revision`**（revision 只在 `describe()` 的 descriptor 上）
- **未证（恢复时先做这一步）**：`scope.set` 在 rc.1 真机上的实际形状（`Object.keys(scope)` 探针 / 读 `ctx.settings.register` 返回对象的构造处）——**不确定它就写不出正确的栅栏改法**
- **最可能场景（推断，附复现步骤）**：同页两张设置卡（或他端）并发提交时互相整段回滚。复现：开两张设置卡 → A 改 `rounds`、B 改 `trigger` → 看是否有一方的改动被回滚
- **方向（待 scope 面核实后定）**：① 走 provider 面 `update(patch)` 做**局部写**（只带变更的字段）替掉整段覆盖，天然规避回滚；② 或给 scope 路径补 `expectedRevision`（前提是能拿到 revision，否则要先解决取数面）
- **状态**：**排队（2026-09-15）**——定性完成、修复未做（缺真机核实与一个复现）

---

### Q9 · 评审闭环：让「干不好退回重做」成真（`autoRevise` 死开关 + 退回入口）

- **来源**：用户 2026-09-15 的定位提议（「一般模型干活、顶级模型评审、干不好退回」）+ 控制器源码核查
- **证据（真 bug 级：UI 承诺了不存在的行为）**——`autoRevise` 全部引用仅 6 处、**无一处是运行时消费者**：
  - `config.ts:77`（类型）/ `:179`（默认 `false`）
  - `settings-schema.ts:59`（schema，可存可校验）
  - `client/SettingsCard.tsx:390-392`（**设置页有一个可勾可存的复选框**）
  - `commands.ts:265`（`/kimi-tide show` 会显示「自动修订」）、`client/help-content.ts:62`（说明页字段清单）
  - 评审编排只有一条路：`router.ts:1106-1116`（`agent/turn-stopping` → `finishReview`）→ `review.ts:71-100`（单发评审请求、60s、单段截断 12k）→ 评审卡；**无任何分支读 `autoRevise`、无 steer 回主模型**；客户端除该复选框外**没有"让它重做"入口**
- **目标**：评审判「不通过／有条件通过」⇒ 按意见让主模型**修订** ⇒（可选）**复检**；并提供**一键退回**（即使不勾自动，也能手动触发）
- **施工要点（初判，未定稿，需 spec）**：① 接入 `agent.steer` 起新一轮——评审发生在**轮关闭后**，时序与幂等要处理 ② **防环**：复用 `flows.review.rounds`（1–3）+ 每轮次数上限 ③ **配额护栏**：自动修订**默认不开** ④ 终止条件：连续 N 次不通过即停并上报，不无限重做 ⑤ 可回滚：修订前留档
- **口径绑定**：**实现前 README 不得写"自动退回重做"**（当前双语 README 已如实标注「仍在规划中」）
- **状态**：**排队（2026-09-15）**——等用户裁定是否与 Q10 绑定（C2 路线：Q9 做完后用产品自身跑对照）

### Q10 · 转移效率对照实验（v1.4.0 发布前证据）

- **来源**：`kimi-tide-research` §5.4 / §5.5 自陈的测量空白——评审**端**质量有数据（三轮约 55 项闭环），**转移效率完全无数据**（意见接受率／驳回率、每轮 premium token、与「强模型独立完成」的对照基线、修复引入新问题的比率）+ 用户 2026-09-15 的定位决定
- **四个待测指标**：① 评审意见**接受率／驳回率** ② **每轮 premium token** ③ 与「**强模型独立完成**」的**对照基线** ④ **修复引入新问题的比率（回归率）**
- **两臂**：① 弱模型单独（打底 `deepseek-official/deepseek-flash`）② 弱模型 + 强评审 + 按意见修订（+ 复检）
- **方法**：**先定任务集再跑**（12–20 个有明确验收判据的真实任务，落 `docs/superpowers/plans/2026-09-1x-transfer-efficiency-experiment.md`）；**盲评**（未参与生成的模型打分，或本人按验收判据打勾）
- **产物**：`docs/audit/…-transfer-efficiency.md`（结果 + 原始数据 + **反例**）；必要时把脚本固化进 `scripts/acceptance/`
- **预算**：回路按研究引用的业界量级约 2–3× token；**kimi 月配额已尽**（09-15 实测 403）⇒ 评审臂走 zai / qwen 侧
- **两条路线**：**C1** 手动执行修订即可起跑（不依赖 Q9）；**C2（推荐）** Q9 落地后用产品自身跑，顺带验收 Q9
- **状态**：**排队（2026-09-15）**——**不阻塞** README 文案合并（文案已按"尚未度量"如实写）

---

## 处置记录

| 日期 | 条目 | 处置 |
|---|---|---|
| 2026-09-15 | Q3 | 用户裁定「并入既有队列」，不单独开 spec（本文件建立即为此） |
| 2026-09-15 | 配额条语义 | 用户裁定「逻辑反了」→ **已实施**（条=剩余、数字=剩余百分比、警示色含条身、`limit=0` 显示 `—`；595/595 绿 + typecheck 0 + build 过）；CHANGELOG 未发布节已记；Q1 附带同步项见上 |
| 2026-09-15 | Q2 | **已完成**（trial 行补 `:not(.kt-error):not(.kt-saved)`，flows 行补 `:not(.kt-saved)`；+2 CSS 结构钉测试；597/597 绿） |
| 2026-09-15 | Q4 | **已完成**（README 双语 4 处措辞改为特异度降序语义；`check-readme-sync` 通过） |
| 2026-09-15 | 语义闸 + 用量余额 + 说明页 | **全部完成**（`ccf82e1` / `36ff9ee`+`bb24af4`+`909577d` / `eece851`）；三份 spec 均升 v2 |
| 2026-09-15 | v1.3.0 版本面 | **完成**（`eecd86d`：包 1.3.0 + README 双语 + CHANGELOG + `release-notes-v1.3.0.md` 门禁过 + 验收清单 A1–A8 + router.md 三节） |
| 2026-09-15 | 代码评审修复波 | **完成**（`b2ebecc`：glm-5.3 对三提交的 3 中等 + 6 轻微全部处置；档案 `docs/audit/2026-09-15-review-implementation-3commits-glm-review.md`） |
| 2026-09-15 | 语义闸设置页开关 | **完成**（`b2ebecc`，spec §8.1） |
| 2026-09-15 | 评审者署名更正 | **完成**——语义闸/说明页签两份档案实由 **glm-5.3** 评审（原标 qwen3.8-max）；文件更名 `…-spec-glm-review.md` 并加「更正记录」，用量余额一份署名经核对无误；引用同步 spec ×2、抢救档案 ×3、本文件 ×1 |
| 2026-09-15 | Q6 `@` 误判面 | **完成**——并入 v1.3.0（用户裁定）；spec + TDD 实施 + 版本面同步（README 双语 / CHANGELOG / Release 正文 / router.md / 验收 A9） |
| 2026-09-15 | 旧面板载荷容忍（交接单两单） | **投影层那半闭环**——新工具 `scripts/acceptance/panel-legacy-scan.mjs` 离线复验：`session-4fb0f4d5` 543/543、`session-6ca2f899` 53/53 旧载荷全部可投影（**596 条全过**）；顺带实证面板事件已停写（近 24h 会话里 `kimi-tide/panel` **0 条**）。**已确认损失**：第三样例 `c01dab3c` 与 09-10 修复工具目录 `~\.dsh\tmp\dsh-session-repair-20260910\` 均毁于 09-14 事故。**待用户**：开一个 08-25 前的老会话看评审卡渲染（需眼睛那一半） |
| 2026-09-15 | Q7 用量归属账本 | **挂账**（用户裁定）——设计稿 `docs/superpowers/specs/2026-09-15-usage-attribution-ledger-design.md`（`411c9b2`）已出；三问已裁定（只报 token / 只本会话 / 一次做完判据优先），未实施 |
| 2026-09-15 | 定位重定位（A′ 文案） | **已完成**——双语 README 同提交：标语改「主力用便宜模型跑，关键处请强模型把关」+ 第一屏场景块（专业活派专家／混着用也不怕／产出由强模型把关）+ 新增 `## 多模型协作评审（强模型把关）` 一节（诚实口径：`autoRevise` 未实现、转移效率未度量）；`check-readme-sync` 骨架 19 节双语一致，三处数字均为实现事实或标注来源 |
| 2026-09-15 | Q9 / Q10 | **立账排队**（用户裁定「A′ 先合并 + D/C 立为下一版」）；Q9 附带口径绑定：实现前 README 不写「自动退回重做」 |
