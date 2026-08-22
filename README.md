<details open>
<summary><b>🇨🇳 中文</b></summary>

<p align="center">
  <img src="docs/assets/readme/hero.svg" width="100%" alt="kimi-tide 月汐 — DSH 模型路由插件：每步自动选模型，每个决策看得见">
</p>

DSH 里一个会话从头到尾只用一个模型：**DeepSeek V4** 便宜、快，但**看不懂图片**；**Kimi K3** 多模态、1M 超长上下文、编码强，但**有额度与成本**。写代码到一半想贴张截图，得手动切模型；切完又忘了切回来，额度哗哗流走。**月汐就是这笔账的自动交警**：你只管干活，它按任务类型、预算和模型长板，在每个步骤自动选路——选谁、为什么选，全都摆在面板上。

---

## 架构

[![kimi-tide 0.4.x 架构图](docs/assets/readme/architecture-overview.png)](docs/assets/readme/kimi-tide-architecture.html)

> 点击查看大图；`docs/assets/readme/kimi-tide-architecture.html` 下载后用浏览器打开，是可平移缩放/搜索/导出的**交互式架构图**（含明暗双主题）。

一次请求的决策流：

```mermaid
flowchart LR
    A["💬 你的消息<br>（本轮新消息）"] --> B{"显式 @模型？"}
    B -- "@kimi 等" --> H["🎯 显式指令<br>最高优先"]
    B -- 否 --> C["📏 预设规则链<br>带图 / 关键词组<br>首条命中生效"]
    C -- 命中 --> D["🌙 规则目标<br>（未接入则降级跳过）"]
    C -- 未命中 --> E["💰 预设默认模型<br>（打底）"]
    H --> J
    D --> F{"带图且目标<br>文本-only？"}
    E --> F
    F -- 是 --> G["🖼️ 图像护栏<br>改道多模态候选"]
    F -- 否 --> J["📋 dock 面板留痕<br>选谁 + 为什么"]
    G --> J
```

---

## 特性一览

- 🚦 **预设路由**：内置「省钱」「能力」两种预设，也可自建命名预设，设置卡片一键全局切换；按**每个步骤**决策，不是一会话绑定到死。
- 🎯 **规则引擎**（0.5.0）：规则 = `带图` / 命名关键词组（内置「代码」「闲聊」两组，词表可改、可自建）；首条命中生效，未命中走预设打底，不可用目标自动降级跳过。
- 🖼️ **图像护栏**：带图消息自动改道多模态模型；会话锁存防止历史含图后文本模型崩溃（`UNSUPPORTED_CONTENT`）。
- 👁️ **决策可观测**：dock 面板实时显示「这步选了谁、为什么」，会话日志留痕可复查——不黑箱。
- ⚙️ **官方设置卡片**：路由配置就在 DSH「设置 → 月汐」里编辑，原生分层持久化，重启保持。
- 🔌 **官方接入层**（0.4.x）：Kimi 模型经 pi-ai 原生 `kimi-coding` 路由接入，**一把 Console API Key 即可**，不再需要 Kimi CLI 登录与令牌刷新。
- 📊 **官方配额显示**：dock 面板轮询 Kimi Code 用量接口，周配额 / 5h 窗口一目了然。
- ⌨️ **`/kimi-tide` 命令族**：`preset` / `show` / `set` / `export-config` / `import-config` / `refresh`，配置可导出备份、可导入恢复。

---

## 快速开始

> 旧 OAuth 方案已退役，历史存档见 [`docs/legacy-setup.md`](docs/legacy-setup.md)。

### 1. 前置条件

- Node.js ≥ 22
- DSH `@deepseek-ai/dsh@0.1.0-rc.7` 及以上（设置卡片依赖 rc.7 的 `dsh-settings`）
- 一把 **Kimi Code Console API Key**（Kimi 控制台获取）

### 2. 配置 Kimi 路由（官方 Models 页）

DSH「设置 → Models」添加 provider **`kimi-coding`**，`apiKeyEnv` 填 `KIMI_API_KEY`（或自建引用名），在凭据区粘贴你的 Key。模型目录（k3 / k3-256k / kimi-for-coding / kimi-for-coding-highspeed）自动就位——密钥由 DSH 托管凭据存储，**不落任何插件配置文件**。

### 3. 安装插件

```bash
cd packages/dsh-kimi-tide
npm install && npm run build && npm pack
dsh plugin --profile web add ./dsh-kimi-tide-<version>.tgz
```

### 4. 用起来

重启 `dsh web`：

- **设置 → 月汐**：在预设行选「省钱」或「能力」，路由器即刻上岗；
- 消息里 **`@kimi`** 显式点将，或靠内置关键词组（如「代码」）自动改道；
- dock 面板的 chip 实时显示每一步选了谁、为什么。

> **发布规范（重要）**：DSH 插件必须声明 `dsh.bundle.patch`（指向 `cordis.patch.yml`）才能作为 profile 层加载。本插件已按官方规范声明，升级版本时请勿移除该字段。

---

## 项目思路

> 为什么做这个插件、以及它往哪里去——三段演进，三条原则。

```mermaid
timeline
    title 月汐演进路线
    0.1.x 接入 : 自研 OAuth 适配器把 Kimi Code 接进 DSH（能用了）
    0.2.x 路由 : 双模型自动分工 + dock 面板（会选了）
    0.3.0 评分 : 6 维能力评分引擎 + 决策留痕（选得有依据）
    0.4.x 收敛 : 官方设置卡片 + API key 直连，自研接入层退役（不重复造轮）
    0.5.0 规则 : 预设 + 规则驱动，评分引擎退役（好配、好懂）
    0.5.x+ 转述 : 图像转述模式（读图付费、正文省钱，rc.8 改设计）
```

- **第一段（自研接入）**：当初 DSH 没有 Kimi 通道，我们自研了 OAuth 适配器把订阅接进来。
- **第二段（路由与评分）**：接进来之后发现真正的痛点是「哪个任务该用谁」——于是有了双模型路由、能力评分和图像护栏。
- **第三段（收敛聚焦）**：宿主平台调研实锤 pi-ai 已**原生内置** kimi-coding 路由（API key + 订阅 OAuth 双凭据）。自研接入层成了重复造轮，果断退役——**月汐只做官方没有的事：路由、护栏、观测**。0.5.0 更进一步：六维评分引擎整体退役，换成你能读懂、能改动的**预设 + 规则**。

三条原则：

1. **官方优先**：动手前先查官方生态；官方已提供的（适配器/设置页/模型选择器），坚决不重造。
2. **规则透明**：路由依据是人能读懂的预设与关键词组，不经黑箱打分；每条规则都可改、可排序、可删除。
3. **决策可观测**：每一次自动选路都有理由、有留痕、可复盘。

---

## 路由器详解

### 内置预设

| 预设 | 默认模型（打底） | 规则 | 适合谁 |
|---|---|---|---|
| 关闭 | — | — | 想完全手动选模型的人 |
| 省钱 | `deepseek-v4-flash` | 带图 → `k3`；代码关键词 → `kimi-for-coding` | 额度敏感、日常杂活多 |
| 能力 | `k3` | 闲聊关键词 → `deepseek-v4-flash`；代码关键词 → `kimi-for-coding` | 追求最佳产出质量 |

预设即数据：内置预设与自定义预设同构，可在设置卡片新建/复制/删除命名预设、编辑规则与关键词组；`activePreset` 一键全局切换。

### 规则引擎（0.5.0）

- **规则条件**：`带图` / 命名关键词组（内置「代码」「闲聊」两组，词表可改、可自建组）。
- **决策流**：显式 `@provider`（最高优先）→ 预设规则链（列表顺序、首条目标可用者命中）→ 打底（预设默认模型）——未命中 ≠ 不动，而是路由到打底。
- **降级**：规则目标未接入（不在全量枚举池）→ 自动跳过该规则，继续匹配/落打底；面板标灰提示。
- **候选枚举**：从 `ctx.llm` 实时目录**全量**枚举所有 provider 的模型并解析模态（0.5.0 起无白名单）；配了但未接入的模型在面板标灰，不参与路由。

> 0.5.0 起能力评分引擎（六维评分/评分基线/预算窗口）整体退役——路由依据从「分数」变为「你写的规则」。v3 评分配置升级时自动迁移为预设（留档 `.pre-v4`），架构细节见 [`packages/dsh-kimi-tide/docs/router.md`](packages/dsh-kimi-tide/docs/router.md)。

### 图像护栏与锁存

- **per-step 护栏**：带图步骤命中文本-only 路由时按模态改道多模态候选（正确性护栏）。
- **宿主准入声明**（`agent/image-admission`，配合宿主补丁）：新会话默认模型为文本-only 时，入口层先放行「会改道」的声明，带图轮才进得了 agent 循环。
- **会话锁存**：图片一旦进入会话历史，该会话后续轮次强制按带图处理（带图规则必命中 + 护栏兜底改道多模态），防止文本模型序列化图片历史时崩溃。

### 已知限制

1. **带图会话锁存死锁**：锁存后整会话走多模态模型；若 Kimi 额度/Key 失效，会话**无法切回文本模型**（历史含图片）→ 只能新开会话。**根解 = 图片不进主历史**：「图像转述模式」改设计中（rc.2 宿主已提供 Modality/准入机制；子代理图片外包已裁撤——官方子代理仅文本）。

---

## 可用模型（经 kimi-coding 路由）

| 模型 ID | 说明 | 上下文 |
|---|---|---|
| `k3` | Kimi K3 旗舰（多模态，1M 长窗） | 1M |
| `k3-256k` | Kimi K3 256K 版（多模态） | 256K |
| `kimi-for-coding` | Kimi K2.7 Code（多模态） | 256K |
| `kimi-for-coding-highspeed` | K2.7 Code 高速版（多模态） | 256K |

> 模态：4 模型在 pi-ai 目录均声明 `input:["text","image"]`；DeepSeek 侧（`deepseek-v4-flash` / `deepseek-v4-pro`）为文本-only、1M 窗（pi-ai 目录实读）——多模态正是路由器要补偿的核心缺口。

---

## 配置

### 路由配置（设置 → 月汐，命名空间 `kimi-tide-router`，v4）

| 键 | 默认 | 说明 |
|---|---|---|
| `activePreset` | `null` | 激活预设 id（`saving` / `capability` / 自定义）；`null` = 关闭 |
| `presets` | 内置「省钱」「能力」 | 预设表：显示名 + 默认模型 + 有序规则表 |
| `presets.<id>.default` | — | 打底模型（未命中规则时的路由目标） |
| `presets.<id>.rules` | — | 规则表：条件（`带图` / 关键词组）+ 目标模型，首条命中生效 |
| `keywordGroups` | 内置 `code` / `chitchat` | 命名关键词组词表（用户可增删改） |

> **持久化**：设置命名空间（base 层 = 部署基座 / user 层 = 用户编辑，revision 冲突检测）→ 无设置服务的宿主回退 sidecar 文件 → 旧 sidecar 迁移后留档 `.legacy-imported`；0.4.x 升级时 `kimi-tide/*` 命名自动迁移为 `kimi-coding/*` 并留档 `.pre-v3`；**0.5.0 升级时 v1-v3 评分配置自动迁移为预设/规则（v4）并留档 `.pre-v4`**（scores/预算参数不迁移）。

### 插件级配置（`cordis.patch.yml`，0.4.x 起大幅精简）

| 键 | 默认 | 说明 |
|---|---|---|
| `usagePollMs` | `60000` | dock 配额轮询周期（毫秒） |
| `usagePollOnStart` | `true` | 启动时立即轮询配额 |
| `patchFile` | `$DSH_HOME/profiles/web/cordis.patch.yml` | legacy 静态种子的部署基座（仅 base 层） |
| `sidecarFile` | `<patch 目录>/kimi-tide-router.yml` | 无设置服务宿主的回退存储 |

---

## 文档索引

- [`docs/superpowers/specs/2026-08-20-api-key-direct-design.md`](docs/superpowers/specs/2026-08-20-api-key-direct-design.md)：0.4.x API key 直连设计稿（已定稿）。
- [`docs/host-platform-map.md`](docs/host-platform-map.md)：DSH 宿主平台契约调研（0.4.x/rc.2 升级的认知基线）。
- [`docs/positioning.md`](docs/positioning.md)：项目定位与维护策略。
- [`docs/development-plan-router.md`](docs/development-plan-router.md)：路由器开发计划（M1-M7）。
- [`packages/dsh-kimi-tide/docs/router.md`](packages/dsh-kimi-tide/docs/router.md)：0.5.0 规则驱动路由架构（预设/规则/打底/降级/迁移链）。
- [`docs/agent-collaboration-loop.md`](docs/agent-collaboration-loop.md)：双模型协作闭环方法论（本项目自己的开发方式）。
- [`docs/legacy-setup.md`](docs/legacy-setup.md)：旧接入方案存档（0.4.x 起被官方路由取代）。

---

## 开发与测试

```bash
cd packages/dsh-kimi-tide
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest（当前 209/209 通过，22 个测试文件）
npm run build       # tsc 宿主 + esbuild 浏览器 half
```

质量基线：全量测试绿 + typecheck 0 错误 + build 通过方可提交。本仓库实践「实施 → 独立审查（Kimi 真身）→ 修复 → 复检验收」双模型协作闭环（见 [`docs/agent-collaboration-loop.md`](docs/agent-collaboration-loop.md)）。

---

## 路线图

> 当前版本：**v0.5.0（2026-08-21 发布）**——规则驱动路由。[Release](https://github.com/tafcear/kimi-tide/releases/tag/v0.5.0) · [Actions 流水线 run 32442349528](https://github.com/tafcear/kimi-tide/actions/runs/32442349528)

| 版本线 | 状态 | 证据锚点 |
|---|---|---|
| v0.1.3 | ✅ 已发布（仅凭据门控 + OAuth 加固） | tag `e2a2eb4`，[Release 页](https://github.com/tafcear/kimi-tide/releases/tag/v0.1.3) |
| 0.2.x 双模型路由器 | ✅ 已随 v0.4.0 发布 | `71b1d18` / `16a75d0` / `fcbf421`，M5 双探针 + 带图闭环 |
| 0.3.0 能力评分路由 | ✅ 已随 v0.4.0 发布 | `86da918`（203/203 绿） |
| 0.4.0 设置界面迁移 + API key 直连 | ✅ 已发布（2026-08-20） | tag `v0.4.0`，[Release](https://github.com/tafcear/kimi-tide/releases/tag/v0.4.0)，216/216 绿 |
| 0.5.0 规则驱动路由 | ✅ 已发布（2026-08-21） | tag `v0.5.0`，[Release](https://github.com/tafcear/kimi-tide/releases/tag/v0.5.0)，209/209 绿 |
| 0.6.0 协作编排 | 🚧 已实施（2026-08-22，未发布） | 分支 `feat/collaboration-flows`，330/330 绿 + typecheck 0 + build 过 |

- **0.1.x**：DSH 原生 Kimi provider，v0.1.3（凭据门控 + OAuth 加固）。
- **0.2.x**：双模型路由器 + dock 面板 + 用量显示；失效修复闭环与 M5 实机验证 ✅。
- **0.3.0**：能力评分路由（11 任务 TDD，`86da918`），手工验收 7/7 ✅。
- **0.4.0**：设置界面迁移（`bc31b69`）+ **API key 直连**（pi-ai 原生 `kimi-coding` 路由，自研 OAuth 接入层退役，provider 改名自动迁移，[设计稿](docs/superpowers/specs/2026-08-20-api-key-direct-design.md)）；配套 GitHub Actions Release 流水线 ✅（tag 触发全自动）；滑杆步进修 ✅（a45d722）。
- **0.5.0**：**规则驱动路由**——命名预设（省钱/能力/可自建）+ 有序规则（带图 / 关键词组）+ 打底语义 + 不可用降级，一键全局切换；能力评分引擎整体退役（scores/classify/预算窗/评分滑杆全删），候选池改全量枚举，v1-v3 存量配置自动迁移留档 `.pre-v4`（[设计稿](docs/superpowers/specs/2026-08-20-rule-driven-routing-design.md)，发布版 209/209 绿 + typecheck 0 + build 过；实机验收含迁移缺陷修复）。
- **0.6.0**：**协作编排**——规则目标泛化为「模型 | 协作流」，预置图像转述流（vision-exp，eager/lazy）与评审流（P2 触发）注册但不绑定；按图三态状态表退役布尔锁存；预设级 `imageFallback` 三态（锁存/盲答/懒转述）；面板 v6 图像上下文行 + 流事件；v4 存量配置自动迁移留档 `.pre-v5`（[设计稿](docs/superpowers/specs/2026-08-22-collaboration-flows-design.md)，330/330 绿 + typecheck 0 + build 过）。
- **规划中（rc.8 重议后）**：图像转述模式（改设计——复用宿主 Modality/准入机制，端点不支持时转述降级；前置 deepseek vision 端点实测）。~~模式预设~~（现有设置卡片已满足，不立项）、~~子代理图片外包~~（官方子代理仅文本，裁撤）、~~kimi 子代理后端~~（经路由已实现，关闭）。

---

## FAQ

**Q：v0.4.0 之前 README 说的 OAuth 接入去哪了？**  
A：退役了。宿主调研实锤 pi-ai 原生内置 `kimi-coding` 路由（API key + 订阅 OAuth 双凭据），自研接入层属于重复造轮，0.4.x 整体删除（约 740 行），插件只保留路由/护栏/观测这些官方没有的能力。旧方案存档见 [`docs/legacy-setup.md`](docs/legacy-setup.md)。

**Q：我还需要装 Kimi CLI 并 `kimi login` 吗？**  
A：v0.4.0 起不需要。一把 Console API Key + 官方 Models 页配置即可。

**Q：带图会话有什么限制？**  
A：图片进入会话历史后会话锁存多模态模型；若 Kimi 额度/Key 失效，会话无法切回文本模型 → 死锁，只能新开。根解（图像转述模式）改设计中（子代理外包已裁撤）；落地前重要带图任务请保持 Kimi 侧额度健康。

**Q：0.5.0 的能力评分引擎去哪了？**  
A：退役了。规则驱动取代六维评分：预设（默认模型 + 有序规则）+ 关键词组，命中即路由、未命中走打底——每个决策你都能读懂、改得动。v3 评分配置升级时自动迁移为预设（`.pre-v4` 留档），评分表本身不迁移。

**Q：路由配置存在哪里？**  
A：DSH 设置命名空间 `kimi-tide-router`（设置 → 月汐编辑）；无设置服务的宿主回退 sidecar 文件；0.4.x 升级自动把 `kimi-tide/*` 改名为 `kimi-coding/*`（留档 `.pre-v3`），0.5.0 升级自动迁移为 v4 预设/规则形状（留档 `.pre-v4`）。

---

<p align="center">
  <a href="https://github.com/oil-oil/beautify-github-readme"><img src="docs/assets/readme/made-with-beautify.svg" width="300" alt="README made with beautify-github-readme"></a>
</p>

## 许可证与合规提示

- **kimi-tide 本体**：[MIT](LICENSE)（Copyright 2026 kimi-tide contributors）
- **第三方组件**：`@earendil-works/pi-ai`（MIT）、`@deepseek-ai/dsh-llm-pi-ai`（MIT, DeepSeek）、`schemastery`（MIT）、`yaml`（MIT）、`dsh-kimi-bridge`（MIT）
- **合规**：0.4.x 起默认走 **Console API Key 官方路径**，个人使用安心；Kimi Code 订阅条款仍以官方表述为准，请勿高频批量调用或共享密钥。
- 本仓库**不含任何凭据**；请勿将 `~/.dsh/.credentials.yaml`、环境变量中的密钥提交到仓库。

</details>

<details>
<summary><b>🇬🇧 English</b></summary>

<p align="center">
  <img src="docs/assets/readme/hero-en.svg" width="100%" alt="kimi-tide — a model router plugin for DeepSeek Harness: picks the right model for every step, and shows you exactly why">
</p>

In DSH, a session sticks to one model from start to finish. But in reality: **DeepSeek V4** is cheap and fast, but **cannot see images**; **Kimi K3** is multimodal with a 1M context window and strong coding, but it **costs quota and money**. Mid-task you want to paste a screenshot — switch models by hand; then you forget to switch back and quota burns away. **kimi-tide is the automatic traffic controller for that trade-off**: you just do the work; it picks the route per step based on task type, budget, and each model's strengths — and shows you who it picked and why, right on the panel.

---

## Architecture

[![kimi-tide 0.4.x architecture](docs/assets/readme/architecture-overview.png)](docs/assets/readme/kimi-tide-architecture.html)

> Click for the full-size image; open `docs/assets/readme/kimi-tide-architecture.html` in a browser for the **interactive diagram** (pan/zoom/search/export, light & dark themes).

The decision flow of one request:

```mermaid
flowchart LR
    A["💬 Your message<br>(new this turn)"] --> B{"Explicit @model?"}
    B -- "@kimi etc." --> H["🎯 Explicit directive<br>highest priority"]
    B -- no --> C["📏 Preset rule chain<br>image / keyword groups<br>first hit wins"]
    C -- hit --> D["🌙 Rule target<br>(skipped if unavailable)"]
    C -- miss --> E["💰 Preset default<br>(baseline)"]
    H --> J
    D --> F{"Image step on a<br>text-only target?"}
    E --> F
    F -- yes --> G["🖼️ Image guard<br>reroute to multimodal"]
    F -- no --> J["📋 dock trail<br>who + why"]
    G --> J
```

---

## Features

- 🚦 **Preset-based routing**: built-in "saving" and "capability" presets, plus your own named presets, switched globally from the settings card; decisions are made **per step**, not per session.
- 🎯 **Rule-driven routing** (0.5.0): a rule is *image-bearing* or a *named keyword group* (built-in "code" and "chitchat", custom groups allowed); first hit in list order wins; a miss routes to the preset default (baseline), and unavailable rule targets are skipped automatically.
- 🖼️ **Image guard**: image-bearing steps reroute to multimodal candidates automatically; session latching prevents text-model crashes (`UNSUPPORTED_CONTENT`) once images enter history.
- 👁️ **Observable decisions**: the dock panel shows "who was picked and why" for every step, with session-log traceability — no black box.
- ⚙️ **Official settings card**: router config lives in DSH "Settings → 月汐", natively persisted with layered overrides and restart-safe storage.
- 🔌 **Official access layer** (0.4.x): Kimi models arrive via the pi-ai native `kimi-coding` route — **one Console API key is all you need**; no Kimi CLI login or token refresh anymore.
- 📊 **Official quota display**: the dock polls the Kimi Code usage endpoint — weekly quota and 5h window at a glance.
- ⌨️ **`/kimi-tide` command family**: `preset` / `show` / `set` / `export-config` / `import-config` / `refresh` — export, back up, and restore your config.

---

## Quick Start

> The old OAuth form is retired; archived in [`docs/legacy-setup.md`](docs/legacy-setup.md).

### 1. Prerequisites

- Node.js ≥ 22
- DSH `@deepseek-ai/dsh@0.1.0-rc.7` or newer (the settings card needs rc.7's `dsh-settings`)
- A **Kimi Code Console API key** (from the Kimi console)

### 2. Configure the Kimi route (official Models page)

In DSH "Settings → Models", add provider **`kimi-coding`**, set `apiKeyEnv` to `KIMI_API_KEY` (or your own reference name), and paste your key into the credential area. The model catalog (k3 / k3-256k / kimi-for-coding / kimi-for-coding-highspeed) appears automatically — the secret lives in the DSH managed credential store, **never in any plugin config file**.

### 3. Install the plugin

```bash
cd packages/dsh-kimi-tide
npm install && npm run build && npm pack
dsh plugin --profile web add ./dsh-kimi-tide-<version>.tgz
```

### 4. Use it

Restart `dsh web`:

- **Settings → 月汐**: pick the "saving" or "capability" preset — the router is on duty;
- Type **`@kimi`** in a message for an explicit pick, or let the built-in keyword groups (e.g. "code") reroute automatically;
- The dock chip shows who was picked and why, for every step.

> **Release rule (important)**: a DSH plugin must declare `dsh.bundle.patch` (pointing at `cordis.patch.yml`) to load as a profile layer. This plugin follows the official spec — do not remove the field when bumping versions.

---

## Project Story

> Why this plugin exists and where it is heading — three phases, three principles.

```mermaid
timeline
    title kimi-tide evolution
    0.1.x Access : Self-built OAuth adapter brings Kimi Code into DSH (it works)
    0.2.x Routing : Dual-model auto-routing + dock panel (it picks)
    0.3.0 Scoring : 6-dim capability engine + decision trails (picks with evidence)
    0.4.x Convergence : Official settings card + API-key direct; self-built access retired (no reinvented wheels)
    0.5.0 Rules : Rule-driven routing — named presets + keyword groups; scoring engine retired (simple to configure)
    0.5.x+ Transcription : Image transcription mode (pay for vision, not the body; redesigned for rc.8)
```

- **Phase 1 (self-built access)**: DSH had no Kimi channel, so we built an OAuth adapter to bring the subscription in.
- **Phase 2 (routing & scoring)**: once connected, the real pain became "which model should take which task" — hence the dual-model router, capability scoring, and the image guard.
- **Phase 3 (convergence)**: host-platform research proved pi-ai **natively ships** the `kimi-coding` route (API key + subscription OAuth). The self-built access layer became a reinvented wheel and was retired — **kimi-tide now does only what the official ecosystem lacks: routing, guarding, and observability**. In 0.5.0 we went one step further: the six-dimension scoring engine is retired in favor of **presets + rules** you can read and edit.

Three principles:

1. **Official first**: check the official ecosystem before writing code; never rebuild what it already provides (adapters / settings pages / model pickers).
2. **Transparent rules**: routing decisions come from presets and keyword groups a human can read — no black-box scoring; every rule is editable, reorderable, deletable.
3. **Observable decisions**: every automatic routing choice has a reason, a trail, and a replay path.

---

## Router in Detail

### Built-in Presets

| Preset | Default model (baseline) | Rules | Best for |
|---|---|---|---|
| Off | — | — | full manual control |
| Saving (省钱) | `deepseek-v4-flash` | image → `k3`; code keywords → `kimi-for-coding` | quota-sensitive daily work |
| Capability (能力) | `k3` | chitchat keywords → `deepseek-v4-flash`; code keywords → `kimi-for-coding` | best output quality |

Presets are data: built-ins and custom presets share one shape — create/duplicate/delete named presets and edit rules and keyword groups in the settings card; `activePreset` switches globally in one click.

### Rule Engine (0.5.0)

- **Rule conditions**: `image` / a named keyword group (built-in "code" and "chitchat"; editable word lists, custom groups allowed).
- **Decision flow**: explicit `@provider` (highest priority) → preset rule chain (list order, first hit with an available target wins) → baseline (preset default) — a miss is not "do nothing", it routes to the baseline.
- **Degradation**: a rule target absent from the full enumeration pool is skipped automatically (fall through to later rules / baseline) and greyed out in the panel.
- **Candidate enumeration**: models are enumerated live from the `ctx.llm` catalog across **all** providers (no whitelist since 0.5.0), with modalities resolved; configured-but-unavailable models render greyed out and are skipped when routing.

> Since 0.5.0 the capability scoring engine (six dimensions / score baselines / budget window) is fully retired — routing now follows "rules you wrote", not scores. v3 scoring configs auto-migrate into presets on upgrade (`.pre-v4` backup); architecture details: [`packages/dsh-kimi-tide/docs/router.md`](packages/dsh-kimi-tide/docs/router.md).

### Image Guard and Latching

- **Per-step guard**: an image step hitting a text-only route is rerouted to a multimodal candidate by modality (a correctness guard).
- **Host admission claim** (`agent/image-admission`, with a host hotfix): on a fresh session whose default model is text-only, the router claims "will reroute" at the entry gate so the image step reaches the agent loop.
- **Session latching**: once an image enters history, later turns are forced to be treated as image-bearing (image rules always hit + the guard reroutes to multimodal), preventing text-only serialization from crashing on image history.

### Known Limitations

1. **Image-latch deadlock**: after latching, the whole session runs on the multimodal model; if the Kimi quota/key fails, the session **cannot switch back to a text model** (history contains images) → open a new session. **Root fix = images never enter the main history**: the "image transcription mode" is being redesigned (the rc.2 host now ships the modality/admission machinery; subagent image outsourcing was dropped — official subagents are text-only).

---

## Available Models (via the kimi-coding route)

| Model ID | Description | Context |
|---|---|---|
| `k3` | Kimi K3 flagship (multimodal, 1M window) | 1M |
| `k3-256k` | Kimi K3 256K (multimodal) | 256K |
| `kimi-for-coding` | Kimi K2.7 Code (multimodal) | 256K |
| `kimi-for-coding-highspeed` | K2.7 Code high-speed (multimodal) | 256K |

> Modalities: all 4 models declare `input: ["text", "image"]` in the pi-ai catalog; the DeepSeek side (`deepseek-v4-flash` / `deepseek-v4-pro`) is text-only with a 1M window (catalog verified) — multimodality is the router's core gap to compensate.

---

## Configuration

### Router config (Settings → 月汐, namespace `kimi-tide-router`, v4)

| Key | Default | Description |
|---|---|---|
| `activePreset` | `null` | active preset id (`saving` / `capability` / custom); `null` = off |
| `presets` | built-in saving/capability | preset table: display name + default model + ordered rules |
| `presets.<id>.default` | — | baseline model (route target when no rule hits) |
| `presets.<id>.rules` | — | rule table: condition (`image` / keyword group) + target model, first hit wins |
| `keywordGroups` | built-in `code` / `chitchat` | named keyword-group word lists (user-editable) |

> **Persistence**: settings namespace (base layer = deployment seed / user layer = edits, revision conflict detection) → sidecar fallback on hosts without a settings service → the old sidecar is archived as `.legacy-imported`; on 0.4.x upgrade, `kimi-tide/*` names auto-migrate to `kimi-coding/*` with a `.pre-v3` backup; **on 0.5.0 upgrade, v1-v3 scoring configs auto-migrate into the v4 preset/rule shape with a `.pre-v4` backup** (scores/budget knobs are not migrated).

### Plugin-level (`cordis.patch.yml`, greatly slimmed since 0.4.x)

| Key | Default | Description |
|---|---|---|
| `usagePollMs` | `60000` | dock quota poll period (ms) |
| `usagePollOnStart` | `true` | poll quota at startup |
| `patchFile` | `$DSH_HOME/profiles/web/cordis.patch.yml` | legacy static seed, base layer only |
| `sidecarFile` | `<patch dir>/kimi-tide-router.yml` | fallback store without a settings service |

---

## Documentation Index

- [`docs/superpowers/specs/2026-08-20-api-key-direct-design.md`](docs/superpowers/specs/2026-08-20-api-key-direct-design.md): 0.4.x API-key direct-connection design (finalized).
- [`docs/host-platform-map.md`](docs/host-platform-map.md): DSH host-platform contract research (the cognitive baseline for 0.4.x and the rc.2 upgrade).
- [`docs/positioning.md`](docs/positioning.md): project positioning & maintenance strategy.
- [`docs/development-plan-router.md`](docs/development-plan-router.md): router development plan (M1-M7).
- [`packages/dsh-kimi-tide/docs/router.md`](packages/dsh-kimi-tide/docs/router.md): 0.5.0 rule-driven routing architecture (presets / rules / baseline / degradation / migration chain).
- [`docs/agent-collaboration-loop.md`](docs/agent-collaboration-loop.md): the dual-model collaboration loop this project itself is built with.
- [`docs/legacy-setup.md`](docs/legacy-setup.md): legacy access paths archive (superseded by the official route in 0.4.x).

---

## Development & Testing

```bash
cd packages/dsh-kimi-tide
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest (currently 209/209 passing across 22 test files)
npm run build       # tsc host build + esbuild browser bundle
```

Quality bar: full test suite green + zero typecheck errors + successful build before committing. This repository practices an "implement → independent review (real Kimi) → fix → re-check" dual-model loop (see [`docs/agent-collaboration-loop.md`](docs/agent-collaboration-loop.md)).

---

## Roadmap

> Current version: **v0.5.0 (released 2026-08-21)** — rule-driven routing. [Release](https://github.com/tafcear/kimi-tide/releases/tag/v0.5.0) · [Actions run 32442349528](https://github.com/tafcear/kimi-tide/actions/runs/32442349528)

| Line | Status | Evidence |
|---|---|---|
| v0.1.3 | ✅ Released (credential gating + OAuth hardening only) | tag `e2a2eb4`, [Release page](https://github.com/tafcear/kimi-tide/releases/tag/v0.1.3) |
| 0.2.x dual-model router | ✅ Shipped with v0.4.0 | `71b1d18` / `16a75d0` / `fcbf421`, M5 dual-probe + image roundtrip |
| 0.3.0 capability-scored routing | ✅ Shipped with v0.4.0 | `86da918` (203/203 green) |
| 0.4.0 settings migration + API-key direct | ✅ Released (2026-08-20) | tag `v0.4.0`, [Release](https://github.com/tafcear/kimi-tide/releases/tag/v0.4.0), 216/216 green |
| 0.5.0 rule-driven routing | ✅ Released (2026-08-21) | tag `v0.5.0`, [Release](https://github.com/tafcear/kimi-tide/releases/tag/v0.5.0), 209/209 green |
| 0.6.0 collaboration flows | 🚧 Implemented (2026-08-22, unreleased) | branch `feat/collaboration-flows`, 330/330 green + typecheck 0 + build ok |

- **0.1.x**: native DSH Kimi provider, v0.1.3 (credential gating + OAuth hardening).
- **0.2.x**: dual-model router + dock panel + usage display; failure-fix loop closed and M5 live verification ✅.
- **0.3.0**: capability-scored routing (11 TDD tasks, `86da918`), manual acceptance 7/7 ✅.
- **0.4.0**: settings migration (`bc31b69`) plus **API-key direct connection** (pi-ai native `kimi-coding` route, self-built OAuth access retired, provider-rename auto-migration — [design spec](docs/superpowers/specs/2026-08-20-api-key-direct-design.md)); GitHub Actions release pipeline ✅ (fully automatic on tag); slider step fix ✅ (a45d722).
- **0.5.0**: **rule-driven routing** — named presets (saving/capability/custom) + ordered rules (image / keyword groups) + baseline semantics + unavailable-target degradation, one-click global switch; the capability scoring engine is fully retired (scores/classify/budget window/score sliders all removed), the candidate pool is now a full enumeration, and v1-v3 stored configs auto-migrate with a `.pre-v4` backup ([design spec](docs/superpowers/specs/2026-08-20-rule-driven-routing-design.md); release version: 209/209 green + typecheck 0 + build ok; live acceptance included a migration-defect fix).
- **0.6.0**: **collaboration flows** — rule targets generalize to "model | collaboration flow"; the built-in image-transcribe flow (vision-exp, eager/lazy) and review flow (P2 trigger) ship registered but unbound; the per-image three-state table retires the boolean latch; per-preset `imageFallback` (latch/blind/transcribe-lazy); panel v6 gains the image-context line + flow events; v4 stored configs auto-migrate with a `.pre-v5` backup ([design spec](docs/superpowers/specs/2026-08-22-collaboration-flows-design.md); 330/330 green + typecheck 0 + build ok).
- **Planned (after the rc.8 re-review)**: image transcription mode (redesign — reuse the host modality/admission machinery, with transcription fallback until the DeepSeek vision endpoint is proven). ~~Mode presets~~ (the existing settings card suffices — not planned), ~~subagent image outsourcing~~ (official subagents are text-only — dropped), ~~kimi subagent backend~~ (achieved via routing — closed).

---

## FAQ

**Q: Where did the OAuth access described in the old README go?**  
A: Retired. Host research proved pi-ai natively ships the `kimi-coding` route (API key + subscription OAuth), so the self-built access layer was a reinvented wheel — removed wholesale in 0.4.x (~740 lines). The plugin keeps only what the official ecosystem lacks: routing, guarding, observability. Legacy paths: [`docs/legacy-setup.md`](docs/legacy-setup.md).

**Q: Do I still need the Kimi CLI and `kimi login`?**  
A: Not since v0.4.0. One Console API key + the official Models page is all it takes.

**Q: What are the image-session limitations?**  
A: Once an image enters history, the session latches onto the multimodal model; if the Kimi quota/key fails, the session cannot switch back → deadlock; open a new session. The root fix (image transcription mode, redesigned for rc.8) is planned; until then keep the Kimi quota healthy for important image tasks.

**Q: Where did the capability scoring engine go in 0.5.0?**  
A: Retired. Rule-driven routing replaces six-dimension scoring: a preset (default model + ordered rules) plus keyword groups — a hit routes, a miss falls to the baseline, and every decision is readable and editable. v3 scoring configs auto-migrate into presets on upgrade (`.pre-v4` backup); the score tables themselves are not migrated.

**Q: Where is the router configuration stored?**  
A: In the DSH settings namespace `kimi-tide-router` (edited via Settings → 月汐); hosts without a settings service fall back to the sidecar file; on 0.4.x upgrade, `kimi-tide/*` names auto-migrate to `kimi-coding/*` (`.pre-v3` backup), and on 0.5.0 upgrade configs auto-migrate into the v4 preset/rule shape (`.pre-v4` backup).

---

<p align="center">
  <a href="https://github.com/oil-oil/beautify-github-readme"><img src="docs/assets/readme/made-with-beautify.svg" width="300" alt="README made with beautify-github-readme"></a>
</p>

## License & Compliance

- **kimi-tide itself**: [MIT](LICENSE) (Copyright 2026 kimi-tide contributors)
- **Third-party components**: `@earendil-works/pi-ai` (MIT), `@deepseek-ai/dsh-llm-pi-ai` (MIT, DeepSeek), `schemastery` (MIT), `yaml` (MIT), `dsh-kimi-bridge` (MIT)
- **Compliance**: since 0.4.x the default path is the **official Console API key**, which is safe for personal use; Kimi Code subscription terms still apply as officially stated — no high-frequency batch calls or key sharing.
- This repository contains **no credentials**; never commit `~/.dsh/.credentials.yaml` or any key from your environment.

</details>
