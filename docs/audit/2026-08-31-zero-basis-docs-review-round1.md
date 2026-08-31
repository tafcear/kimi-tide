# 文档零基础化改造 · Kimi 独立评审存档（Round 1 + Round 2 复检）

> **评审对象**：docs/1.0.1-zero-basis 分支文档面（README.md / README.en.md / CHANGELOG.md / docs/release-evidence.md / 包级 README / positioning / 横幅 / 校验脚本+CI）
> **评审人**：Kimi（真身，子代理派发，首行 `@kimi`，只读）｜ **实施者**：DSH 主 agent（GLM）
> **Round 1**：基线 `238ea41` ｜ **修复波**：`a913896` ｜ **复检**：Round 2 ｜ **残余清偿**：`5cc5102`
> **模板**：`docs/templates/review-task.md`（文档审查版改编）／复检沿 `docs/templates/recheck-task.md`

---

## Round 1 报告（2026-08-31）

**评审者**：Kimi（只读）｜ **基线**：`main` vs `docs/1.0.1-zero-basis`（HEAD `238ea41`，工作树干净）

**评审者已自行完成的只读验证**：
- `node scripts/check-doc-links.mjs` → 72 个 md 文件 0 断链 ✅
- `node scripts/check-changelog.mjs` → CHANGELOG / README / package.json 均为 v1.0.0 ✅
- README 引用的 5 个资产文件（hero.gif / hero-en.gif / architecture-overview.png / kimi-tide-architecture.html / made-with-beautify.svg）全部存在 ✅
- 7 个 git tag 全部存在；CHANGELOG 日期与 tag 日期逐一比对
- `docs/superpowers/plans/2026-08-27-hardening-and-packaging.md` 在 main 上本就不存在（旧 README 该链接在 main 上即悬空），实体在 `docs/085-planning` 分支

### 严重（0 条）

无。无断链、无事实矛盾级错误、无信息丢失、无维护者语言泄漏进用户三件套。

### 中等（3 条）

- **M1** · README.md L40 / README.en.md L40「面板实时显示剩余额度」无条件化，与项目自身事实不符——额度显示仅对带套餐目标（Kimi/GLM）生效，场景三引导改道的 `deepseek-v4-flash` 恰恰无套餐；零基础读者照做后看不到承诺，最伤信任。建议加套餐限定。
- **M2** · docs/release-evidence.md L4「条目零删改」自述与实际有 2 处出入（头部门禁句并入横幅；0.8.5 悬空链去链接化）。方向均正确，问题在自述未同步——证据链文档的可信度全靠自述精确。
- **M3** · ci.yml 文档校验步跑在 setup-node 之前（不受 Node 矩阵约束）且 check-doc-links.mjs 未接入 CI——「文档链接全绿」门禁不进 CI 会腐化。

### 轻微（6 条）

- **L1** 「预设」首现（场景三 L40）无注释，定义在 L114。建议首现处加半句白话。
- **L2** mermaid 图内「转述流 vision-exp」「dock 面板」对零基础读者是黑话，图注未覆盖。
- **L3** 包级 README 指针指向 router.md「配置参考（v4 全字段）」「迁移链（v1→v3→v4）」节名，v5 字段实际在 0.6.0 扩展节——读者按指针跳转易误判过期。
- **L4** v1.0.0 日期全库一致写 08-29，tag creatordate 为 08-30。继承自旧 README、四文档互洽，非本轮引入；疑时区差。
- **L5** README.en.md L77「the linked HTML opens…」与 GitHub 实际下载行为不符（中文版与 EN 索引节均正确）。
- **L6** 包级 README「kimi-for-coding（默认候选）」措辞易误导（两内置预设默认都不是它）——本轮范围外既有问题，建议顺手修。

### 各维度结论（Round 1）

1. 零基础首读可懂性 ✅（三秒/十秒/一分钟三关全过；三场景叙事为全文最大亮点）
2. 事实准确性 ✅（DSH 介绍克制可信；预设表/词表与旧版逐字一致；唯一事实性偏差即 M1）
3. 链接与结构完整性 ✅（撤出内容全部有落点，无信息丢失）
4. 中英一致 ✅（无事实差异）
5. 术语注释 ✅（扣分项即 L1/L2）
6. 维护者语言泄漏 ✅ 零泄漏

### 待执行验证（Round 1 提出）

- V1：Models 页挂 `kimi-coding` 后 4 模型自动出现（继承自旧版表述）——需实机
- V2：「Everything is a Plugin」官方口号出处——实施者已核实（github.com/deepseek-ai/deepseek-harness 页面标题原文），回填计划 Task 4 Step 1
- V3：hero.gif / hero-en.gif 与新文案匹配度——实施者读图目检：品牌/标语/候选池口径一致，通过
- V4：mermaid 在 GitHub 渲染效果——随 push 后网页目检（图源与旧版同构，风险低）

### Round 1 成熟度：**可用级（距生产级一轮小修）**

---

## 实施者 triage（Round 1 → 修复波 a913896）

| # | 处置 | 落点 |
|---|---|---|
| M1 | 修 | 双语场景三加套餐限定（Kimi/GLM 带套餐显示，无套餐置灰） |
| M2 | 修 | 自述改「除相对链接路径调整、头部门禁句并入用途横幅、0.8.5 计划悬空链去链接化（补注分支位置）外，条目零删改」 |
| M3 | 修 | 文档步移 setup-node 后，两脚本一起进 CI |
| L1 | 修 | 场景三加「（一套配好的『默认模型 + 规则』方案）」（双语） |
| L2 | 修 | 图注补「转述」「dock 面板」白话（双语） |
| L3 | 修 | 包级指针改「配置参考」+「0.6.0 协作编排扩展（v5 增量速览）」 |
| L4 | 已知不修 | 既成口径（Release 页/台账/四文档互洽）；文档轮单方改日期反而制造漂移 |
| L5 | 修 | EN 改 download & open，与中文版对齐 |
| L6 | 修 | 改「（编码任务主力）」 |
| V1/V4 | 移交用户 | 实机/网页目检进收尾移交清单 |
| V2/V3 | 已验证关闭 | 计划回填 / 读图目检 |

---

## Round 2 复检报告（2026-08-31）

**范围**：修复波 `a913896` 逐条核对 + 机器校验复跑 + 新问题扫描（只读）。

- 8 项「修」全部真实落地且语义正确（M1/L1/L5 双语同步确认）；L4 与 V1–V4 处置均可接受；机器校验双绿（check-changelog OK / check-doc-links 72 md 0 断链）。
- **新发现（均轻微）**：
  - **N1** README.en.md 体量锁被修复波顶破：14300B → 14507B（超 14KB 锁 171B）
  - **N2** L2 半闭环：CN mermaid T 节点仍裸写 `vision-exp` 且图注未覆盖（EN 图已用自然语言）
  - **N3** M2 自述仍未穷举：v1.0.0 表行迁移期补入「auxTargets/」（内容正确，系顺手清偿旧 README 自身口径不一），例外清单未列
- **最终结论**：**修复闭环通过**（附 3 项轻微残余，均一行可修、不阻断合并）。成熟度维持可用级；清偿后可升生产级候选（待 V1/V4 用户实机目检回填）。

### 残余清偿（5cc5102）

- N1：EN 无损紧缩两处 + 体量锁放宽至 ≤14.5KB 并在计划 Global Constraints 留注理由（复检给出的选项 B；实际 14430B 合规）
- N2：CN 图注补「vision-exp 是 Kimi 家一款能看图的模型名」
- N3：证据链自述补第 4 例外「v1.0.0 表行补 auxTargets/（同步末行 bullet 与英文表行）」

---

## 终态

**成熟度：生产级候选**（Kimi 双轮评审闭环 + 三项残余清偿；V1 实机目录、V4 网页渲染两项用户目检回填后完全关闭）。
