# kimi-tide（月汐）

> 月亮（Moonshot / Kimi）牵引深海（DeepSeek / DSH）的潮汐。

把 **Kimi Code（Moonshot）** 订阅接入 **DeepSeek Harness（DSH）** 的原生 LLM provider 方案。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release: v0.1.3](https://img.shields.io/badge/Release-v0.1.3-blue.svg)](https://github.com/tafcear/kimi-tide/releases/tag/v0.1.3)
![Topics](https://img.shields.io/badge/Topics-dsh--plugin%20%7C%20deepseek--harness%20%7C%20kimi-lightgrey.svg)

---

## 特性一览

- **原生 DSH 插件**：`dsh-kimi-tide` 作为标准 `dsh-plugin` 注册 provider 路由，无需外部脚本或计划任务。
- **OAuth 进程内刷新**：与 `kimi login` 共享登录态，默认每 10 分钟自动刷新 access token。
- **跨平台**：零 Windows 计划任务依赖，Linux / macOS / Windows 均可运行。
- **双通道互补**：provider 路径用于 DSH 模型选择器；`dsh-kimi-bridge` 路径用于显式调用 `kimi` CLI 工具。
- **发布就绪**：v0.1.3 已发布为 GitHub Release，附 `dsh-kimi-tide-0.1.3.tgz` 安装包。
- **月汐 dock 面板（0.2.x，main 已落地）**：`conversation.composer.dock` 面板，模式切换 / 周配额与 5h 窗口用量显示 / 本地 token 统计 / 路由设置折叠区（settings.ts 行级回写 patch yml 持久化）。尚未发布 Release。

---

## 路线图

- **0.1.x（当前发布线）**：DSH 原生 Kimi provider，已发布 v0.1.3。
- **0.2.x（main 已落地，未发布）**：双模型自动分工路由器（`cost` / `capability` 两种模式）已接线（`agent/pre-step` + `agent/request`，自提交 64c22cd 起），「月汐」dock 面板 v2（模式切换 / 配额显示 / 设置折叠）、用量显示（usage.ts 轮询）、设置面板（settings.ts 行级回写）、AUTH 风暴修复均已实现，均在 main 分支上 v0.1.3 之后的提交中；尚未打 tag / 发布 Release。待办：M4 单元测试收尾、M5 实机集成验证、M6 文档发布。设计稿见 [`docs/development-plan-router.md`](docs/development-plan-router.md) 与 [`docs/superpowers/specs/2026-08-17-usage-panel-router-settings-design.md`](docs/superpowers/specs/2026-08-17-usage-panel-router-settings-design.md)。
- **0.3.0（计划中）**：能力评分路由（capability-scored routing），spec v2.2 定稿（[`docs/superpowers/plans/2026-08-17-capability-scored-routing.md`](docs/superpowers/plans/2026-08-17-capability-scored-routing.md)），11 任务 TDD 实施计划成稿（[`docs/superpowers/plans/2026-08-17-capability-routing-implementation.md`](docs/superpowers/plans/2026-08-17-capability-routing-implementation.md)），经 Kimi 三轮审查闭环（[R1](docs/superpowers/reviews/2026-08-17-capability-routing-kimi-review-round1.md) / [R2](docs/superpowers/reviews/2026-08-17-capability-routing-kimi-review-round2.md) / [R3](docs/superpowers/reviews/2026-08-17-capability-routing-kimi-review-round3.md)）评审通过。

---

## 架构

```
┌──────────────────────────────────────────────────────┐
│                  DeepSeek Harness (DSH)               │
│  ┌────────────────────────┐  ┌─────────────────────┐  │
│  │ dsh-kimi-tide          │  │ dsh-kimi-bridge     │  │
│  │ 原生 LLM provider       │  │ kimi CLI 工具桥接    │  │
│  └───────────┬────────────┘  └──────────┬──────────┘  │
│              │                          │             │
│              ▼                          ▼             │
│  https://api.kimi.com/coding          kimi CLI        │
│  Anthropic 兼容协议                    (-p / -S)      │
│              │                          │             │
│              └────────────┬─────────────┘             │
│                           ▼                           │
│          Kimi Code OAuth access_token                 │
│          （由插件进程内自动维护）                        │
└──────────────────────────────────────────────────────┘
```

---

## 快速开始

### 1. 前置条件

- Node.js ≥ 22
- DSH `@deepseek-ai/dsh@0.1.0-rc.6` 及以上（插件 peerDependencies 为 `^0.1.0-rc.6`：**rc.6 起可用，已在 rc.7 实机验证**；rc.6 更早的 rc 版本未验证）
- 已安装 Kimi Code CLI 并完成登录（一次即可）：

  ```powershell
  # Windows PowerShell（macOS/Linux 见官方文档 https://moonshotai.github.io/kimi-code/）
  irm https://code.kimi.com/kimi-code/install.ps1 | iex
  kimi login   # 浏览器完成设备码授权
  ```

### 2. 安装插件

#### 方式 A：直接下载 Release（推荐）

从 [v0.1.3 Release](https://github.com/tafcear/kimi-tide/releases/tag/v0.1.3) 下载 `dsh-kimi-tide-0.1.3.tgz`，然后：

```bash
dsh plugin --profile web add ./dsh-kimi-tide-0.1.3.tgz
```

#### 方式 B：从源码构建

```bash
cd packages/dsh-kimi-tide
npm install && npm run build && npm pack
dsh plugin --profile web add ./dsh-kimi-tide-0.1.3.tgz
```

### 3. 重启并使用

重启 `dsh web`，模型选择器将出现 `kimi-tide` 组。

> **发布规范（重要）**：DSH 插件必须声明 `dsh.bundle.patch`（指向 `cordis.patch.yml`）才能作为 profile 层加载；缺声明时 `dsh plugin add` 只会把它装成普通依赖，手动加进 bundles 会导致 web 启动崩溃。本插件已按官方规范声明，升级版本时请勿移除该字段。

---

## 可用模型

| 模型 ID | 说明 | 上下文 |
|---|---|---|
| `kimi-for-coding` | Kimi K2.7 Code（默认，多模态） | 256K |
| `kimi-for-coding-highspeed` | K2.7 Code 高速版（多模态） | 256K |
| `k3` | Kimi K3 旗舰（多模态，1M 长窗） | 1M |
| `k3-256k` | Kimi K3 256K 版（多模态） | 256K |

> 模态说明：以上 4 个模型在 pi-ai 目录中均声明 `input: ["text", "image"]`（多模态）；`k3` 额外提供 1M 超长上下文窗。

---

## 三条接入路径对照

| 路径 | 推荐度 | 作用 | 依赖计划任务 | 需 `kimi login` |
|---|---|---|---|---|
| **`dsh-kimi-tide` 插件** | ⭐ 首选 | DSH 原生 LLM provider | 否（进程内刷新） | 是 |
| **`dsh-llm-pi-ai` + `settings.yaml`** | 备选 | 旧配置方案，适配老版本 DSH | 是（Windows） | 是 |
| **`dsh-kimi-bridge` 工具桥接** | 互补 | 把 `kimi` CLI 暴露为 DSH 工具 | 否 | 是 |

旧配置方案的详细安装步骤见 [`docs/legacy-setup.md`](docs/legacy-setup.md)；bridge 插件见 [`vendor/dsh-kimi-bridge/README.md`](vendor/dsh-kimi-bridge/README.md)。

---

## 插件配置（可选）

`packages/dsh-kimi-tide/cordis.patch.yml` 中的可覆盖项：

| 键 | 默认 | 说明 |
|---|---|---|
| `providerName` | `kimi-tide` | 注册进 `ctx.llm` 的路由名 |
| `kimiHome` | `''` | Kimi home（空 = `KIMI_CODE_HOME`，再回退 `~/.kimi-code`） |
| `refreshIntervalMs` | `600000` | access token 刷新周期（毫秒） |
| `refreshOnStart` | `true` | 启动时立即刷新一次 |
| `usagePollMs` | `60000` | 月汐 dock 配额轮询周期（毫秒） |
| `usagePollOnStart` | `true` | 启动时立即轮询配额 |
| `router` | 见下 | 路由器配置（`off` / `cost` / `capability`；0.2.x 已接线，默认 `off`） |
| `patchFile` | `$DSH_HOME/profiles/web/cordis.patch.yml` | 路由设置面板回写的目标文件 |

---

## 能力验证摘要

已通过 `scripts/kimi-capabilities.mjs` 与 `scripts/e2e-kimi.mjs` 验证：

| 能力 | 验证模型 | 状态 |
|---|---|---|
| 推理（thinking + 文本） | `kimi-for-coding` / `k3` | ✅ 正常 |
| 代码生成 | `kimi-for-coding` | ✅ 正常 |
| 工具调用 | `kimi-for-coding` / `k3` | ✅ 正常 |
| 工具调用闭环 | `kimi-for-coding` | ✅ 正常 |
| 多模态图片识别 | `kimi-for-coding`（脚本实测）/ `k3`（目录声明 `text+image`） | ✅ 正常 |
| 端到端流式调用 | `kimi-for-coding` | ✅ 正常 |

---

## 项目结构

```
kimi-tide/
├── packages/dsh-kimi-tide/    # 推荐：DSH 原生插件
│   ├── src/index.ts           # 装配：provider + 月汐面板（usage/settings/commands/projection/router）
│   ├── src/router.ts          # 0.2.x 路由器（已接线 agent/pre-step + agent/request；cost/capability 决策）
│   ├── src/usage.ts           # 用量显示（官方 usages 轮询 + 本地 token 桶）
│   ├── src/settings.ts        # 设置面板（行级回写 patch yml 持久化）
│   ├── src/client/            # 月汐 TideDock 面板（browser half）
│   └── src/commands.ts        # /kimi-tide 命令族
├── scripts/                   # 验证与辅助脚本
│   ├── kimi-capabilities.mjs  # 能力矩阵测试
│   ├── e2e-kimi.mjs           # 端到端流式测试
│   ├── plugin-smoke.mjs       # 插件冒烟测试
│   ├── validate-kimi-settings.mjs
│   └── kimi-token-refresh.ps1 # 旧配置方案专用
├── vendor/dsh-kimi-bridge/    # CLI 工具桥接插件（维护 fork）
├── docs/                      # 详细文档与协作模板
│   ├── positioning.md         # 项目定位与维护策略（战略文档）
│   ├── development-plan-router.md  # 0.2.x 双模型自动分工路由器计划
│   ├── agent-collaboration-loop.md
│   ├── legacy-setup.md
│   ├── audit/                 # 两轮审查档案
│   ├── superpowers/           # 0.2.0 扩展设计 + 0.3.0 能力评分路由（specs/plans/reviews）
│   └── templates/
└── LICENSE
```

---

## 协作闭环与文档

本项目实践了一套"实施 → 独立审查 → 修复测试 → 复检验收"的双模型协作流程，并沉淀为方法论资产：

- [`docs/positioning.md`](docs/positioning.md)：项目定位、与 Open Design 的对照、三层价值拆解与退役计划。
- [`docs/agent-collaboration-loop.md`](docs/agent-collaboration-loop.md)：协作闭环的原理、实测数据与操作手册。
- [`docs/development-plan-router.md`](docs/development-plan-router.md)：0.2.x 双模型自动分工路由器设计与里程碑（已接线）。
- [`docs/superpowers/specs/2026-08-17-usage-panel-router-settings-design.md`](docs/superpowers/specs/2026-08-17-usage-panel-router-settings-design.md)：0.2.0 扩展设计稿（用量显示 / 路由设置面板 / 推理状态）。
- [`docs/superpowers/plans/2026-08-17-capability-scored-routing.md`](docs/superpowers/plans/2026-08-17-capability-scored-routing.md)：0.3.0 能力评分路由 spec（v2.2 定稿）。
- [`docs/superpowers/plans/2026-08-17-capability-routing-implementation.md`](docs/superpowers/plans/2026-08-17-capability-routing-implementation.md)：0.3.0 实施计划（11 任务 TDD）。
- [`docs/superpowers/reviews/2026-08-17-capability-routing-kimi-review-round3.md`](docs/superpowers/reviews/2026-08-17-capability-routing-kimi-review-round3.md)：0.3.0 三轮审查闭环档案（R1 13 条 / R2 7 条 / R3 终审）。
- [`docs/templates/review-task.md`](docs/templates/review-task.md)：审查任务书模板。
- [`docs/templates/recheck-task.md`](docs/templates/recheck-task.md)：复检任务书模板。

> 历史经验：插件冒烟测试全绿仍可能因缺少 `dsh.bundle.patch` 声明导致 DSH 启动崩溃——发布规范与静态测试同样重要。

---

## 许可证与合规提示

- **kimi-tide 本体**：[MIT](LICENSE)（Copyright 2026 kimi-tide contributors）
- **第三方组件**：`@earendil-works/pi-ai`（MIT）、`@deepseek-ai/dsh-llm-pi-ai`（MIT, DeepSeek）、`js-yaml`（MIT）、`@iarna/toml`（ISC）、`dsh-kimi-bridge`（MIT）

**Kimi Code 订阅合规提示**：

- ✅ **允许**：个人使用，在自有工具里调用 Kimi Code 能力。
- ⚠️ **风险提示**：Kimi Code 订阅"仅限个人交互式使用"。本方案以非官方客户端 + 自动刷新令牌调用，属于条款灰色地带。个人量级使用风险低，但请勿高频批量调用、多账号共享或将 token 分发他人。
- ✅ **完全合规的替代路径**：需要长期、稳定的 API 集成时，请使用 [Kimi 开放平台](https://platform.kimi.ai) 的 API key。

本仓库**不含任何凭据**；请勿将 `~/.dsh/.credentials.yaml`、`~/.kimi-code/credentials/` 中的内容提交到仓库。

---

## FAQ

**Q: 为什么需要把 OAuth access token 当作 apiKey 使用？**  
A: DSH 的适配器当前只支持 apiKey 鉴权，而 Kimi Code 订阅后端采用 OAuth。插件方案在**进程内**管理 OAuth 令牌并以 Bearer 形式注入请求；旧配置方案则通过定时脚本刷新 token 填充 `KIMI_API_KEY`。

**Q: 可以不装 `dsh-kimi-bridge` 吗？**  
A: 可以。provider 路径（`dsh-kimi-tide` 插件）是核心方案；`dsh-kimi-bridge` 仅用于需要显式控制 Kimi 会话或并行调用的场景。

**Q: 模型 `k3` 与 `k3-256k` 怎么选？**  
A: 需要 1M 长上下文时选 `k3`；常规任务或对上下文长度有明确 256K 上限要求时选 `k3-256k`。

**Q: 插件（进程内刷新）和旧方案的计划任务能同时开吗？**  
A: v0.1.3 起可以安全共存——两者共用凭据锁（`<kimi-home>/credentials/kimi-code.json.lock`），刷新被串行化，refresh token 轮换不会互踩。但仍建议只保留一条路径：首选插件（零计划任务）；计划任务仅在使用旧路由 `kimi-coding`（依赖 `KIMI_API_KEY`）时才需要。

**Q: refresh token 过期怎么办？**  
A: Kimi Code 的 refresh token 约 30 天过期。到期前插件/脚本会告警；到期后只需重新执行 `kimi login` 获取新的 refresh token。
