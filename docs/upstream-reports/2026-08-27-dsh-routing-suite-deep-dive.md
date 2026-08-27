# dsh-routing-suite 深度调研（2026-08-27）

> 调研人：ZCode 会话（2026-08-27 19:xx）。方法：GitHub 浅克隆逐文件阅读——`injector/src/index.ts`（3319 行，读约 45% + 全部工具面枚举）、`injector/docs/SPEC.md`（全文）、`preset/router-standard` 核心两文件、`preset/docs/` 三件套（paper/blog/experiments）、`install.ps1`、CHANGELOG、测试两件；对照本仓库 `feat/0.8.0-routing-coverage`（d066d8f）现状。
> 克隆副本：`C:\Users\tafce\AppData\Local\Temp\repo-audit\dsh-routing-suite`（commit `21a7260`，2026-08-25；临时目录，可删）。仓库：[yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)（6.9k stars / 137 forks / 43 commits / MIT，查询时点 2026-08-27；**仓库无 CI、无自身 Release**）。
> 结论去向：可借鉴项已立项 → [`docs/superpowers/plans/2026-08-27-hardening-and-packaging.md`](../superpowers/plans/2026-08-27-hardening-and-packaging.md)（0.8.5）。

---

## 1. 对象画像

「注入器 × 思维模式路由」套装：`injector/`（上游 dsh-super-injector v0.3.3 的拍平快照）+ `preset/`（上游 dsh-router-standard v0.3.0 快照；**上游主线 CHANGELOG 已到 v1.27.0**，本仓库是滞后橱窗）。真实身份：**运行时注入基建 + 行为层研究成果的内容展示仓**。

## 2. 机制层发现（按对月汐价值排序）

### 2.1 成本模型与工具面三铁律（SPEC.md §6.3 + index.ts 头注释，最高价值）

- 首轮请求是无前缀缓存的全量 prefill，**工具目录逐字符计费**；实测 6 插件 description 合计 **17.6 万字符**（稀释首轮注意力，且缓存命中比未命中便宜约 10 倍）→ 工具 schema 短句化，详解放 tool result。
- **首轮锚定**：工具面 ≥5 时首轮只露核心 1-2 个，首个 `tool/call` 后放开；阶段从**持久 session events 推导**（存在即晋升，工具失败也算），resume/reload 不丢状态（`system-prompt/assemble` 是 Waterfall，必须 `await next()` 再过滤）。
- **staging 后侧工具区**（index.ts L1408-1414 起）：开发/审计工具不进 schema（缓存零污染）→ `dev_stage_call` 测试 → `dev_stage_promote` 转正只承受一次缓存刷新；staging 持久化到 staging.json 防自重载丢失。

### 2.2 缓存分层的注入位置学（index.ts L13-16）

静态能力提示**固定文本 + order 靠前**（工具 schema 变更时静态段仍缓存命中）；动态内容走尾部/消息尾。另有一条血泪教训（README v0.3.0 变更，issue #34/#36/#55）：近距离引导曾走错通道导致**每轮多 1 次 API 调用 = 费用 2×**，修复后改走 `agent/pre-step` 与用户消息同请求——月汐决策也走 `agent/pre-step`（0.6.0），注入落点同请求这一点已对齐，仍值得核对注入内容体积。

### 2.3 行为分带模型（router-core-v34.mjs L3-25 + paper.md，对 effort 档位直接相关）

21 模式点 × n=2 实测：**行为沿 persona 轴不是连续可调的**，塌缩成三个稳定带——spec [0,0.15] / 过渡带 [0.2,0.45]（不稳定，回避）/ react [0.5,1.0]（11 个内部点行为无差别）。**weak 模式**（模型自分类）最优 persona 模型特定：Pro=spec 句+few-shot（+5.0），Flash=neutral+分类指令（+5.7）；且 Pro 上加锚反而有害（P24：挂锚 83% < 裸奔 87.5%）。**对月汐 0.8.0 effort 档位的启示：档位应按实测稳定带划界而非等分，最优档位文本按模型区分。**

### 2.4 「极简模式 = 训练分布本身」（blog.md 核心论点）

DSH 官方 minimal 预设源码注释 "sends the exact RL prompt and schemas"：46 字符 persona + 2 训练时工具两跑 99/96；完整标准模式 91——**约 10 分差距只来自第一个请求长什么样**。行为是路径承诺的（path-committed）：窄面锚定后再放开全目录，最多扰动一个推理块。对一切 prompt 设计适用：首个请求决定整条会话轨迹。

### 2.5 自毁防护套件（index.ts 自重载段，插件开发救命级）

四层防御各对应真实事故：①自杀前预检（purge 后 import 验证导出有效插件，失败恢复缓存拒绝自杀）②看门狗（自杀后 5s 查重建，挂起触发自愈）③节流锁落盘（内存变量跨 fiber 归零，「实测连续三次自重载都没被拦」）④官方通道优先（touch patch → include.refresh；fallback loader.create 产生幽灵 entry 需仲裁）。配套：故障全程落盘 `self-heal.log`（带轮转）、操作互斥锁（withOpLock promise 链）、原子写（tmp+rename）。**与本机相关：2026-08-27 spike 探针两次杀死 DSH 宿主的事故，预检模式正是解药。**

### 2.6 渐进式工具披露（router-bootstrap-v34.mjs 头注释 + CHANGELOG 五支柱）

T0 首轮 = 46 字符 RL 句 + `phase_begin` 唯一可见工具 → 模型确认后解锁阶段 0 → 闯关 `phase_advance` 逐级解锁；「未解锁工具名称不进入视野」。上游 CHANGELOG 总结为**注意力工程五支柱**：①可见性控制 ②预算与顺序 ③上下文资产化（注意区只留目标+决策+证据，其余沉降/丢弃）④隔离与并行（subagent 独立上下文）⑤主动重定向。

### 2.7 散件

原子写、操作互斥锁、纯函数零依赖路由核心（213 行全纯函数，`advanceStage` 幂等可重放 resume-safe）、19 个 `dev_*` 工具全家桶（scaffold 生产线/自检/自愈/发布）。

## 3. 工程实践对比

| 实践 | dsh-routing-suite | 月汐现状 | 结论 |
|---|---|---|---|
| 契约文档 | SPEC.md：经验补丁逐条映射回 DSH 源码行（「与源码语义冲突的做法即为 bug 来源」）+ 操作矩阵表 | host-platform-map.md 有平台图，无「经验↔契约」双向映射 | 升级 |
| 实验档案 | experiments.md §A-L：固定微任务 × n=、消融、复现节 | B1-B8 功能验收，缺行为级实验档案 | 0.9.0 前补 |
| 内容三件套 | paper（英文）+ blog（「神鬼二相性」叙事）+ experiments（原始数据） | 无 | 0.8.5 起步 |
| 一键安装 | install.ps1：缺失检测→自动构建→fallback 指引→装后布局自检 | 手动多步 | 0.8.5 抄 |
| CI | **无** | Node 22/24 矩阵 + 证据注释 | 月汐领先，保持 |
| 测试 | node:test 26 用例（preset 面） | vitest 385 用例（0.8.0） | 月汐领先 |
| 代码组织 | index.ts 单文件 3319 行 | 19 文件 4227 行 | 月汐领先，勿倒退 |

## 4. 产品包装层（6.9k vs 6 stars 差距主因）

1. **一句话类比定位**：「DSH 生态的 BepInEx」（mod 圈无人不晓）——0.5 秒建立心智。月汐「互补分工层」准确但无画面感。
2. **现象级痛点命名**：「神鬼二相性」把技术发现包装成人人共鸣的现象。月汐痛点（贴图手动切模型/切完忘切回/配额焦虑）在 README 里但未提炼成可传播名词。
3. **传播物料分层**：英文论文立权威 → 中文博客讲人话（钩子：「不是抽卡，是提示词条件化在换挡」）→ 实验数据防杠。
4. **README 轻量化**：中文主文件 + README.en.md 互跳（月汐 65KB 全量对照堆一个文件，应拆）。
5. **反面（不学）**：无 CI、tgz 二进制入库、README 性能数字全是作者自测无第三方验证（P1-P23 自测）、仓库是上游滞后快照。**学它的包装，不学它的草率。**

## 5. 风险提示（竞争重叠）

- 上游 preset 主线 v1.27 的五支柱是「思维模式/注意力」赛道的方法论占位；月汐 0.8.0 effort 档位已进入其腹地。
- **并存兼容未知**：注入器每轮注入 persona/引导（且按模型挑 persona），月汐每步换模型——同时挂载时注入器给 Pro 的 persona 未必匹配月汐该步实际路由到的模型。必须备用 profile 实测，且避开 0.8.0 验收期。
- positioning.md 的红海研判（§3.1）需把 suite/上游补进竞争地图。

## 6. 行动清单（→ 0.8.5 计划）

1. 跟进池五项清偿（终审 deferred）
2. 成本卫生审计（三铁律自查留基线）
3. install.ps1 一键安装 + 布局自检
4. README 拆分 + 一句话类比 + 版本表 + 痛点叙事
5. positioning.md 竞争地图 v2
6. effort 稳定带标定实验设计 + 探针骨架（实测留 0.9.0，需额度裁定）
7. 热重载机制评估报告（只读）
8. 版本收口 0.8.5

---
*溯源说明：本文所有行号/版本/数据均出自克隆副本实读（commit 21a7260）；star/commits 为 GitHub 页面 2026-08-27 查询值，属时点数据。*
