# 成本卫生 + 安装体验 + 包装强化 + 跟进池清偿（0.8.5）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> 📌 **前置依赖（硬门禁）**：0.8.0 实机验收 B1–B8 全绿 + 用户裁定 → 合并 main + tag v0.8.0 之后，本计划方可开工；执行分支 `feat/0.8.5-hardening-packaging` 自合并后 main 拉出。0.8.0 现状见台账（个人项目库 `01-项目/kimi-tide（月汐）.md`）。
>
> 📌 **来源**：[`docs/upstream-reports/2026-08-27-dsh-routing-suite-deep-dive.md`](../upstream-reports/2026-08-27-dsh-routing-suite-deep-dive.md)（dsh-routing-suite 深度调研，2026-08-27）。本计划无独立 spec——T6 的实验设计文档即本计划产物之一。

**Goal:** 把调研报告的可借鉴项落地为一次「工程与传播强化」小版本——D1 清偿 0.8.x 跟进池五项（终审 deferred）；D2 成本卫生审计留基线（工具 schema 精简 / 注入 order / 首轮可见性三铁律）；D3 安装体验（install.ps1 一键 + 布局自检）；D4 包装强化（README 拆分瘦身 + 一句话类比 + 版本表 + 痛点叙事；positioning.md 竞争地图 v2）；D5 研究起步（effort 稳定带标定实验设计 + 探针骨架——实测出范围；热重载机制评估报告——只读）。

**Architecture:** T1 跟进池清偿涉及 `src/router.ts`（degradation 原因措辞）/ `docs/router.md`（陈旧注释）/ `src/index.ts`（provide+register 单测缝）/ `src/client/SettingsCard.tsx` + `effort-remote.ts`（efforts 目录刷新语义 + EffortSelect 漂移）；T2 审计对象为本插件注册的全部工具、`kimi-tide.catalog` typert 贡献与静态注入文本，产出 `docs/audit/` 报告；T3 新增根目录 `install.ps1`（Windows pwsh 7）；T4/T5 纯文档面；T6 新增 `docs/experiments/` 设计文档 + `scripts/effort-probe.mjs` 骨架；T7 新增 `docs/audit/` 评估报告。

**Tech Stack:** TypeScript + vitest（包目录 `packages/dsh-kimi-tide`）+ React 18 设置卡片（jsdom）+ PowerShell 7（install.ps1，仅本机实测）+ Markdown 文档面。无新运行时依赖。

**Spec:** 无独立 spec（调研报告即依据）。若 T1 中「efforts 目录刷新语义」实施超出小修范围（触及 typert 通道契约），当场升级为独立 spec 并暂停该子项，其余任务不受阻。

## Global Constraints

- 版本定位：0.8.5（patch 位：无 schema 形状变化、无迁移、无配置破坏面）；`packages/dsh-kimi-tide/package.json` version → 0.8.5。
- **路由决策语义不变量**：`rules.ts` 的 `matchingScored`/`previewRoute` 匹配语义、优先级/降级链、图像护栏方向一律不动（T1 措辞类修正除外，且不改变判定结果）。
- 三文档面同步纪律沿用：`docs/router.md`、仓库根 `README.md`、`packages/dsh-kimi-tide/README.md`。
- TDD：每任务先 RED 后 GREEN，全量三绿才 commit，一任务一 commit。
- 全量验证命令（`packages/dsh-kimi-tide` 下）：`npx vitest run --pool=threads` + `npm run typecheck` + `npm run build`；**绝不跑 pnpm install**（误装后 `npm ci` 还原，避坑 2026-08-26）。
- hooks 纪律：SettingsCard 新增 useState 必须置于 `config === null` 提前返回之前（2026-08-20 事故钉）。
- T6/T7 明确出范围：不实跑任何模型额度消耗型实验（用户裁定后归 0.9.0 前置 spike）；不对宿主做任何写入/注入动作（热重载评估仅源码阅读 + 报告）。
- 发布门禁：文档链接全绿 + install.ps1 本机实测通过 + 三绿 + 跟进池五项勾销 + 用户裁定 tag 方可发版。
- 执行环境注意：派发子代理提示词首行显式 `@zai-coding-cn` + 规避 code/plan/chitchat 命中词（2026-08-27 429 连杀事故避坑）。

---

## T1 跟进池五项清偿（终审 deferred，来源：SDD 账本 progress.md）

- [ ] 1.1 degradation 决策原因「特异度最高」措辞修正（`src/router.ts` 词数原因段；先 RED：断言原因文案含命中词数与特异度描述一致）
- [ ] 1.2 `docs/router.md` 陈旧行内注释清理（与 0.8.0 实现不符的行内说明逐条核对）
- [ ] 1.3 宿主 `provide`+`register` 通道补单测（`kimi-tide.catalog` 服务注册→invoke 返回档位表；对齐 spike 实证形状；B5 兜底后仍是零单测缝）
- [ ] 1.4 efforts 档位目录刷新语义：挂载时取一次 → 随 adapters 变化重取（`src/client/effort-remote.ts` + `card-store.ts`；先 RED：adapters 就绪晚于挂载的时序用例）
- [ ] 1.5 EffortSelect 显示层漂移修复（`SettingsCard.tsx`；先 RED：漂移复现用例）
- [ ] 1.6 全量三绿 + 跟进池五项在 SDD 账本勾销

## T2 成本卫生审计（三铁律基线，调研报告 §2.1/§2.2）

- [ ] 2.1 盘点清单：本插件注册的全部工具（router/commands/panel 面）、typert 贡献、静态注入文本——逐项记录 description 字数与注入 order
- [ ] 2.2 三铁律核对：①schema 短句化（详解在 tool result 不在 schema）②静态文本 order 靠前、动态内容走尾部 ③首轮可见工具面盘点（是否存在可收窄项）
- [ ] 2.3 产出 `docs/audit/2026-08-27-cost-hygiene.md`（基线数字留档，供后续版本对照）；超标项当任务修复，无超标则记录「达标」结论
- [ ] 2.4 `agent/pre-step` 注入体积核对（调研报告 §2.2 费用 2× 教训——确认决策注入与用户消息同请求且体积可控）

## T3 一键安装 install.ps1（调研报告 §3）

- [ ] 3.1 复核 README 现行安装路径（pack 产物/tgz + `dsh plugin add` 或 bundle patch），脚本与之对齐
- [ ] 3.2 `install.ps1`：前置检查（node/npm、dsh 不在 PATH → npx fallback）→ 构建（lib/client 产物缺失时 npm run build）→ 装配 → **布局自检**（cordis.patch.yml 条目就位 / lib/client.js 在位 / 版本号一致，失败红字 + 修复指引）
- [ ] 3.3 本机 pwsh 7 实测通过（冒烟记录进 2.3 同款 audit 报告或 README 安装节）；bash 版不做承诺，留 backlog

## T4 README 拆分与包装（调研报告 §4）

- [ ] 4.1 拆分：`README.md` 瘦身为中文主文档；`README.en.md` 独立英文互链（替代现中英全量对照，目标主文档 ≤ 20KB）
- [ ] 4.2 顶部新增：一句话定位类比 + 组件/依赖版本表（DSH 版本窗、peerDeps、安装方式速查）
- [ ] 4.3 痛点叙事段重写（贴图切模型 / 切完忘切回 / 配额焦虑——先讲场景再讲功能）
- [ ] 4.4 全仓库文档相对链接检查全绿（沿 2026-08-18 文档审查惯例）

## T5 positioning.md 竞争地图 v2（调研报告 §5）

- [ ] 5.1 对照表补：dsh-routing-suite、上游 dsh-router-standard v1.27（注意力工程五支柱）、superboy911/dsh-model-router、dsh-auto-gearbox、dsh-omni-router
- [ ] 5.2 重叠区声明：effort 档位 vs 思维分带路由（引用行为分带证据，标注「作者自测、无第三方验证」口径）；差异化钉死：**模型路由 × 协作流编排 × 决策可观测 × 透明规则**
- [ ] 5.3 并存兼容研判段：注入器 + 月汐同时挂载的风险与实测前置条件（备用 profile、避开验收期）

## T6 effort 稳定带标定——实验设计 + 探针骨架（实测出范围，调研报告 §2.3）

- [ ] 6.1 `docs/experiments/2026-08-27-effort-band-design.md`：微任务矩阵（react 型 / spec 型各 ≥6）× 档位全档 × n=3 × deepseek-v4-pro / flash 双模型；评分口径；消融节（档位文本模型特定性）；复现节模板（借 suite experiments.md §A-L 结构）
- [ ] 6.2 `scripts/effort-probe.mjs` 骨架：矩阵展开 + 调用 + 记录 JSONL，**不带凭据不可直接运行**（占位 config + 顶部醒目说明）
- [ ] 6.3 计划头注记：实跑需用户裁定额度消耗 → 归 0.9.0 前置 spike

## T7 热重载机制评估报告（只读，调研报告 §2.5）

- [ ] 7.1 `docs/audit/2026-08-27-hot-reload-assessment.md`：注入器 `dev_*` 面对月汐开发迭代的价值/风险清单（预检后自杀 / 看门狗 / 自愈 / 审计日志可借鉴点）；与 2026-08-27 spike 双杀宿主事故的关联分析；结论给出「是否在 0.9.x 试点、以何种形态」建议（只读评估，不装注入器、不动宿主）

## T8 版本收口 0.8.5

- [ ] 8.1 `package.json` version → 0.8.5；三文档面同步；release notes（沿 `release-notes-v0.1.x.md` 惯例）
- [ ] 8.2 轻量验收清单 C1–C6：文档链接全绿 / install.ps1 本机实测 / 三绿 / 跟进池五项勾销 / audit 两报告在位 / experiments 设计文档在位
- [ ] 8.3 用户裁定 tag `v0.8.5` + Actions 发版（沿用 0.8.0 门禁惯例）

---

## Risks

- T1.4（efforts 刷新语义）是唯一触及 typert 通道契约的改动——若实现发散，按计划头约定升级 spec，不硬写。
- T3 install.ps1 依赖本机 dsh CLI 行为（`plugin add` 对 bundle 型插件的处理），先复核再写脚本，避免重蹈「文档先于实证」。
- 文档面任务（T4/T5）多人/多 agent 并发编辑易冲突——串行执行，每任务独立 commit。

## Non-goals

- 不引入 dsh-super-injector 依赖、不在用户实机做并存实验（T7 仅纸面评估）。
- 不实跑 effort 稳定带实验（额度消耗，用户裁定）。
- 不改匹配语义 / 护栏方向 / 配置 schema 形状。
