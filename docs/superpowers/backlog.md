# 待办队列（spec 之外的排队项）

> **用途**：收纳**已确认但尚未进入 spec/实施**的工程项——评审衍生项、既有缺陷、待核口径。
> **与其它文档的关系**：`docs/superpowers/specs/` 是设计稿，`plans/` 是实施计划，`audit/` 是评审档案；本文件只做**排队与溯源**，不重复它们的正文。
> **正式追踪渠道**：仓库惯例是 GitHub Issues（`docs/agents/issue-tracker.md`）；**当前 `gh` 认证失效**（09-15 实测 token invalid），本文件为过渡队列，恢复后逐条转 issue。
> **维护纪律**：条目带证据锚点（`file:line` 或实测输出）；状态取 `排队 / 进行中 / 完成 / 转出`；完成后在「处置记录」里写落地版本。

---

## 队列

### Q1 · 三份在途 spec 的 v2 回改（22 项必改）

- **来源**：`docs/audit/2026-09-15-review-{semantic-hit-gate,quota-balance-coverage,panel-help-tab}-spec-qwen-review.md`（控制器逐项复核 22/22 成立、0 误报）
- **内容**：语义闸 6 项（含 S1 对象型 schema 注入破坏往返相等、M1 判否集合未穿进 re-decide 三处调用点）／用量余额 7 项（含 S1 三态无通路、M1 `UsageMonitor` 类型契约）／说明页签 9 项（含 M1 route 页签无单一面板节点、M2 `hidden` 语义不自洽）
- **状态**：**排队（最高优先）**
- **处置**：逐份出 v2，头部登记处置表；Q2/Q4 随说明页签 v2 一并处理

### Q2 · 既有 bug：测试场页签藏掉错误横幅

- **来源**：说明页签评审 M3 连带发现；控制器已复核
- **证据**：`packages/dsh-kimi-tide/src/client/styles.ts:163`（flows 行）含 `:not(.kt-error)`，`:164`（trial 行）**缺失** ⇒ `data-tab='trial'` 时错误横幅被 `display:none` 吞掉
- **影响**：UI 评审 P2-5 修复不彻底；用户在测试场页签看不到保存/校验错误
- **方向**：给 trial 行补 `:not(.kt-error)`（另有 `.kt-saved` 同理待核）；新增 help 页签时必须写全
- **状态**：**排队**（小改动，可随 Q1 说明页签 v2 一起进实施）

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
- **状态**：**排队**（用户裁定：并入队列，不单独开 spec）

### Q4 · 文档措辞：「首条命中生效」是错的心智模型

- **来源**：说明页签评审 M4；控制器复核
- **证据**：真实语义是**特异度降序、平手按列表序**（`rules.ts:104-123` 稳定排序；`router.ts:244` 遍历的是**排序后**列表）⇒「位置靠后但命中词更多」的规则会赢
- **影响面**：`README.md` / `README.en.md` / `packages/dsh-kimi-tide/README.md` / `docs/router.md` 同款措辞；说明页签 ② 与 ⑦
- **状态**：**排队**（随 Q1 文档面一起改；README 双语对需同提交）

### Q5 · Kimi 配额口径待核：monthly 与周/5h 的关系

- **来源**：k3 评审中断事件的 403 文案；抢救档案 §2 教训 D
- **证据**：`403 permission_error: "You've reached your monthly usage limit for this billing cycle"` vs dock 显示的两窗为「周 / 5h」（`parseQuotaSnapshot`：`root.usage` → weekly、`limits[0].detail` → fiveHour，`types.ts:139-152`）
- **待核**：`/coding/v1/usages` 是否也报 monthly 窗；若否，面板会在月配额已耗尽时仍显示「剩 N」
- **转出**：并入 Q1 的用量/余额 v2（该稿正在改配额显示面）
- **状态**：**排队**

---

## 处置记录

| 日期 | 条目 | 处置 |
|---|---|---|
| 2026-09-15 | Q3 | 用户裁定「并入既有队列」，不单独开 spec（本文件建立即为此） |
