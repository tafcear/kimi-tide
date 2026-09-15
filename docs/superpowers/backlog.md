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
- **状态**：**完成（2026-09-15，并入 v1.3.0）**——用户裁定「Q6 并入这一版，完成后再发」⇒ spec `docs/superpowers/specs/2026-09-15-at-directive-known-provider-design.md` + TDD 实施。**方向定案 A + C（B 被 A 吸收）**：新增 `effectiveExplicitDirective(text, known)` 与 `configuredProviders(preset)`，`known = 目录全部 provider（含不可用）∪ 预设已配置目标 ∪ KIMI_PROVIDER`；四处调用点同源（decide 显式分支 / 语义闸前置短路 / reviewTriggerHit / previewRoute）；取**首个已知匹配**（前面包名不吞后面真指令）；原因串前缀「`@x` 非本路由器已知 provider（已忽略）」；已知 provider 无候选仍 `keep`（Q3 语义保持）。**一处有意变更**：未识别的 `@provider`（如 `@anthropic`）由 keep 改落打底 + 说明——词法上与 `@README` 不可区分，必须在两种降级里选一边（原测试 `router.test.ts` 那条断言已按新语义改写并注明理由）。**验证**：655/655 绿（改前 641，+14 用例）、typecheck 0、build 过

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
