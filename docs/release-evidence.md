# 发布证据链（release evidence）

> **用途**：发布门禁 convention 的证据锚点——任何版本发版（打 tag / 触发 Actions Release）前，该版本实机验收清单必须全绿 + 用户裁定 tag；**执行记录回写本文件锚点**。用户视角的版本史见仓库根 [CHANGELOG](../CHANGELOG.md)。
> **来源**：2026-08-31 自 README「路线图」节**原样迁移**（结构方案 C，见 [`docs/superpowers/specs/2026-08-31-zero-basis-docs-design.md`](superpowers/specs/2026-08-31-zero-basis-docs-design.md) §4.5）；除相对链接路径调整、头部门禁句并入用途横幅、0.8.5 计划悬空链去链接化（补注分支位置）、v1.0.0 表行补「auxTargets/」（同步本文件末行 bullet 与英文表行，清偿旧 README 自身口径不一）外，条目零删改。

> 当前版本：**v1.0.0（2026-08-29）**——大版本：0.7.0 关键词匹配 + 0.8.0 规则体系/effort/决策可观测 + 品牌主题化 + 多 plan 配额。[Release](https://github.com/tafcear/kimi-tide/releases) · [Actions 流水线](https://github.com/tafcear/kimi-tide/actions)（tag 触发全自动）

| 版本线 | 状态 | 证据锚点 |
|---|---|---|
| v0.1.3 | ✅ 已发布（仅凭据门控 + OAuth 加固） | tag `e2a2eb4`，[Release 页](https://github.com/tafcear/kimi-tide/releases/tag/v0.1.3) |
| 0.2.x 双模型路由器 | ✅ 已随 v0.4.0 发布 | `71b1d18` / `16a75d0` / `fcbf421`，M5 双探针 + 带图闭环 |
| 0.3.0 能力评分路由 | ✅ 已随 v0.4.0 发布 | `86da918`（203/203 绿） |
| 0.4.0 设置界面迁移 + API key 直连 | ✅ 已发布（2026-08-20） | tag `v0.4.0`，[Release](https://github.com/tafcear/kimi-tide/releases/tag/v0.4.0)，216/216 绿 |
| 0.5.0 规则驱动路由 | ✅ 已发布（2026-08-21） | tag `v0.5.0`，[Release](https://github.com/tafcear/kimi-tide/releases/tag/v0.5.0)，209/209 绿 |
| 0.6.0 协作编排 | ✅ 已发布（2026-08-23） | tag `v0.6.0`，[Release](https://github.com/tafcear/kimi-tide/releases/tag/v0.6.0)，337/337 绿 + typecheck 0 + build 过；实机验收 10 项全过（含 T4 门）；验收修复 `e2d3c68`（rc.2 宿主 model-selection 覆盖） |
| 0.6.1 评审修复波 | ✅ 已发布（2026-08-23） | tag `v0.6.1`，[Release](https://github.com/tafcear/kimi-tide/releases/tag/v0.6.1)，354/354 绿 + typecheck 0 + build 过；转述并发 / 轮询有界 / 面板去重 / LRU 对账 / 空转述裁决 / 决策按会话隔离（`13ede6e`）+ CI 版本窗修正（`f4fde04`） |
| 0.7.0 关键词匹配准确性 | ✅ 已实施 + 实机验收清单全绿（2026-08-26）+ **已随 v1.0.0 发布**（无独立 tag，并入大版本；分支 `feat/0.7.0-keyword-matching`） | 词边界 + 特异度排序 + minHits（`ec90a37`/`6f014a8`/`f76bbd0`/`45ab5dc`/`4765a19`），359/359 绿 + typecheck 0 + build 过；**A1–A10 全过**：六探针 request/header 解码实锤（A2 阴性→deepseek-v4-pro / A3 阳性→glm-5.2 / A4 特异度→glm-5.2 / A8 @kimi→k3 / A5 阴性→deepseek-v4-pro、阳性→qwen3.8-max-preview）+ A6/A9 用户实机目检与带图转述链路实走 + A7 存量兼容（清单见 [`superpowers/plans/2026-08-25-keyword-matching-accuracy.md`](superpowers/plans/2026-08-25-keyword-matching-accuracy.md) 末节） |
| 0.8.0 规则覆盖面 + 可解释性 + effort | ✅ 已实施 + **实机验收 B1–B8 全绿**（2026-08-27）+ **已随 v1.0.0 发布**（分支 `feat/0.8.0-routing-coverage`） | 关键词组 2→7 组 + 预设接组 + effort 三入口 + 条件摘要/试一句/决策词数（`515218c`/`eed3cb2`/`f18cdbf` 等 6 任务）；验收清单 B1–B8 见 [`superpowers/plans/2026-08-27-routing-coverage-effort.md`](superpowers/plans/2026-08-27-routing-coverage-effort.md) 末节（全绿回填） |
| **v1.0.0 大版本** | ✅ **已发布（2026-08-29）** | tag `v1.0.0`，[Release](https://github.com/tafcear/kimi-tide/releases/tag/v1.0.0)，497/497 绿 + typecheck 0 + build 过；内含 0.8.x 池全清（499 根治/auxTargets/限额跟随/布局重构）+ 打磨三连 + UI 交叉评审批次 + 月汐品牌主题化 + 设置导航月牙图标 + 多 plan 配额（kimi/GLM 跟随命中目标，CREDIT_LIMIT 积分制适配） |
| 1.1.0 评审流认领语义 | ⏸ **已实施 + 实机验收 A1–A8 全绿（2026-09-05）**，tag/Release 待用户执行 | 认领组静态抑制 / 轮末 turn-stopping 异步评审（零阻塞+防环）/ `kimi-tide/review` 投影+事件卡双端 / `/kimi-tide review` 手动命令 / 设置页认领提示+试一句预测 / 试一句盲区标注（评审模型不可用）/ L7 校验加固（`2d1ebd5`..`f8d236e`，含 A6/A8 实机缺陷修复）；验收逐项记录见 [`superpowers/plans/2026-09-04-review-flow-orchestration.md`](superpowers/plans/2026-09-04-review-flow-orchestration.md) 末节；555/555 绿 + typecheck 0 |

- **0.1.x**：DSH 原生 Kimi provider，v0.1.3（凭据门控 + OAuth 加固）。
- **0.2.x**：双模型路由器 + dock 面板 + 用量显示；失效修复闭环与 M5 实机验证 ✅。
- **0.3.0**：能力评分路由（11 任务 TDD，`86da918`），手工验收 7/7 ✅。
- **0.4.0**：设置界面迁移（`bc31b69`）+ **API key 直连**（pi-ai 原生 `kimi-coding` 路由，自研 OAuth 接入层退役，provider 改名自动迁移，[设计稿](superpowers/specs/2026-08-20-api-key-direct-design.md)）；配套 GitHub Actions Release 流水线 ✅（tag 触发全自动）；滑杆步进修 ✅（a45d722）。
- **0.5.0**：**规则驱动路由**——命名预设（省钱/能力/可自建）+ 有序规则（带图 / 关键词组）+ 打底语义 + 不可用降级，一键全局切换；能力评分引擎整体退役（scores/classify/预算窗/评分滑杆全删），候选池改全量枚举，v1-v3 存量配置自动迁移留档 `.pre-v4`（[设计稿](superpowers/specs/2026-08-20-rule-driven-routing-design.md)，发布版 209/209 绿 + typecheck 0 + build 过；实机验收含迁移缺陷修复）。
- **0.6.0**：**协作编排**——规则目标泛化为「模型 | 协作流」，预置图像转述流（vision-exp，eager/lazy）与评审流（P2 触发）注册但不绑定；按图三态状态表退役布尔锁存；预设级 `imageFallback` 三态（锁存/盲答/懒转述）；`llm/stream` 智能投影（已转述图块 → 转述文字）；面板 v6 图像上下文行 + 流事件；v4 存量配置自动迁移留档 `.pre-v5`（[设计稿](superpowers/specs/2026-08-22-collaboration-flows-design.md)，发布版 337/337 绿 + typecheck 0 + build 过；实机验收 10 项全过含 T4 门，验收中修复 rc.2 宿主 model-selection 覆盖路由缺陷 `e2d3c68`）。
- **0.6.1**：**评审修复波**——eager/lazy 转述 `Promise.all` 并发（多图延迟不再按图数叠加）；配额轮询 fetch 有界超时 + in-flight 去重（端点挂起不再泄漏 socket）；面板推送语义签名去重（会话日志不再按分钟膨胀）；转述 LRU 逐出对账降级回 native 重转述；空白转述视同失败进失败集；决策/流事件观测按会话隔离（不再串台）；`@指令` 前导锚定（邮箱不误判）；settings v1 写入面冻结；新增 CI（push/PR 触发，Node 22/24 双腿）。354/354 绿 + typecheck 0 + build 过。
- **0.7.0**：**关键词匹配准确性升级**——三类误路由对症修复：①纯 ASCII 关键词词边界匹配（`decode`/`unicode`/`barcode` 不再误中 `code`，中文保持子串）；②命中特异度排序（命中词数多者优先、平手按列表序、带图恒优先），内置能力预设调序 code→chitchat、code 词表 8→17 词；③规则条件可选 `minHits` 最少命中词数（≥1 整数，缺省 1；设置卡片带输入）。v5 形状不变、新字段全可选，存量配置逐字节兼容。359/359 绿 + typecheck 0 + build 过。
- **0.8.0**：**规则体系补全 + 可解释性 + 推理程度配置**——内置关键词组 2→7 组（新增 review/writing/translate/longdoc/math，chitchat 瘦身为纯寒暄，「翻译」「总结」迁入专组），能力预设序 带图→审查→代码→数学→长文→写作→翻译→闲聊（审查意图优先于泛 code 词）、省钱预设加翻译规则；`effort` 可选推理档位（规则目标/预设默认/转述流视觉模型三入口；运行期按模型档位支持集判定——支持携带、不支持剥离记日志，不做写入期档位校验；护栏改道与显式 `@` 不带规则 effort，review 流 reviewer 无此字段）；设置卡片规则行条件摘要（「命中 code 组 ≥1 词」）+ 目标 effort 档位下拉 + 「试一句」测试器（实时预演命中规则与最终目标）；dock 决策原因带命中词数（`规则「code」命中 2 词（特异度最高）`）。385/385 绿 + typecheck 0 + build 过；**已随 v1.0.0 发布**（实机验收 B1–B8 全绿）。
- **v1.0.0**：**大版本合流**——0.7.0 关键词匹配 + 0.8.0 规则体系/effort/决策可观测 + 0.8.x 池全清（499 根治/auxTargets 辅助改道/限额跟随/布局重构两行+三页签）+ 打磨三连 + UI 交叉评审批次 + 月汐品牌主题化 + 设置导航月牙图标 + 多 plan 配额（kimi/GLM 跟随命中目标自动切源，GLM CREDIT_LIMIT 积分制适配）。497/497 绿 + typecheck 0 + build 过；Release 流水线两连败后 run#8 成功（gh 新版两坑已写入 workflow 注释）。
- **1.1.0**：**评审流认领语义**——认领组静态抑制（评审关键词组的词不再接管主轮路由，组认领后路由与试一句预演同步排除）/ 轮末 turn-stopping 异步评审（零阻塞+防环，普通消息不触发）/ `kimi-tide/review` 投影 + 会话流评审事件卡双端渲染（卡头徽标=评审模型）/ `/kimi-tide review` 手动命令（有缓存评审上一轮，无缓存报「无可评审的上一轮」）/ 设置页认领提示（keywords 触发下被认领组规则行标灰+提示）/ L7 校验加固（拒绝 reviewer.effort）。实机验收 A1–A7 全绿、A8 缺陷挂起（试一句缺「评审模型不可用」标注）（2026-09-04）；544/544 绿 + typecheck 0。
- **规划中**：子代理转述机制（P3，S2 契约 GO）——远期；发版后跟进：池⑩（随发布后收录）、池⑪（转述治本：整页截图逐字转述撞 30s 有界超时的治本候选）、0.8.5「强化与包装」八任务（已立项，计划文件 `docs/superpowers/plans/2026-08-27-hardening-and-packaging.md` 在 `docs/085-planning` 分支，未并入 main）。~~0.6.x 跟进池~~（12/12 已全清：面板图像上下文行客户端渲染、M-3 校验加固、lazy 失败直测、建流 UI 等 18 条全部落地）。~~模式预设~~（现有设置卡片已满足，不立项）、~~子代理图片外包~~（官方子代理仅文本，裁撤）、~~kimi 子代理后端~~（经路由已实现，关闭）、~~review 流命令式触发~~（P2，`/kimi-tide review` 已随 1.1.0 落地）。
