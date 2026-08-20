# dsh-kimi-tide（月汐）

DeepSeek Harness 的**规则驱动模型路由插件**（0.5.0）：命名预设（省钱/能力/可自建）
+ 有序规则（带图 / 关键词组），按任务在 Kimi（`kimi-coding`）与 DeepSeek 之间自动
选路，未命中走预设默认模型（打底），带图像护栏、官方配额显示与决策可观测。

0.4.x 起插件**零接入层代码**——Kimi 模型经官方 pi-ai 原生 `kimi-coding` 路由
（设置 → Models 配一把 Console API Key）进 DSH LLM 注册表，自研 OAuth 接入层
（约 740 行）整体退役。插件只保留官方生态没有的能力：**路由、护栏、观测**。

> **当前状态（2026-08-21）**：0.5.0「规则驱动路由」已实施（分支
> `feat/0.5.0-rule-driven-routing`，未发布）——能力评分引擎（scores/classify/预算窗）
> 整体退役，预设+规则承接；v1-v3 存量配置自动迁移留档 `.pre-v4`。路由架构详见
> [docs/router.md](docs/router.md)，带图会话限制见文末「已知限制」节。

## 模型（经 kimi-coding 路由）

| 模型 | 说明 | 上下文 |
|------|------|--------|
| `kimi-for-coding` | Kimi K2.7 Code（默认候选） | 256K |
| `kimi-for-coding-highspeed` | K2.7 Code 高速版 | 256K |
| `k3` | Kimi K3 旗舰 | 1M |
| `k3-256k` | Kimi K3 256K 版 | 256K |

> 模态：以上 4 个模型在 pi-ai 目录中均声明 `input: ["text", "image"]`（多模态）。

## 前置条件

- Node.js ≥ 22、DSH `@deepseek-ai/dsh@0.1.0-rc.7` 及以上（设置卡片依赖 rc.7 的 `dsh-settings`）
- 一把 **Kimi Code Console API Key**（Kimi 控制台获取）

## 安装

```bash
npm install && npm run build && npm pack
dsh plugin --profile web add ./dsh-kimi-tide-0.5.0.tgz
```

然后到 DSH「设置 → Models」添加 provider **`kimi-coding`**，`apiKeyEnv` 填
`KIMI_API_KEY`（或自建引用名），在凭据区粘贴你的 Key。模型目录自动就位——密钥由
DSH 托管凭据存储，**不落任何插件配置文件**。重启 `dsh web` 生效。

## 配置（cordis.patch.yml 可覆盖）

| 键 | 默认 | 说明 |
|----|------|------|
| `usagePollMs` | `60000` | 月汐 dock 配额轮询周期（毫秒） |
| `usagePollOnStart` | `true` | 启动时立即轮询配额 |
| `patchFile` | `$DSH_HOME/profiles/web/cordis.patch.yml` | legacy 路由静态种子的部署基座（仅 base 层） |
| `sidecarFile` | `<patch 目录>/kimi-tide-router.yml` | 无设置服务宿主的回退存储 |

> 0.4.0 起路由配置持久化在官方设置面板「设置 → 月汐」（DSH 设置命名空间
> `kimi-tide-router`，base/user 分层 + revision 冲突检测）；`router` 静态块仅为
> 部署基座（base 层），用户编辑落 user 层。无 settings 服务时（rc.6）回退 sidecar
> 文件。**0.5.0 起配置形状为 v4**（`activePreset` / `presets`（默认模型 + 有序规则）
> / `keywordGroups`）；v1-v3 存量配置经迁移链自动桥接并留档 `.pre-v4`。

## 使用合规提示

0.4.x 起默认走 **Console API Key 官方路径**，个人使用安心；Kimi Code 订阅条款仍以
官方表述为准，请勿高频批量调用或共享密钥。本仓库**不含任何凭据**。

## 月汐 dock 面板（只读仪表）

会话输入框下方的「🌙 月汐」面板提供：

- **预设徽标**：只读显示当前预设名（或「关闭」，📡 chip）与预设默认模型（⚡ chip）；
  预设管理（选择/编辑/新建/复制/删除 + 规则表 + 关键词组）在官方设置页「月汐」
  卡片（`settings.section`，id `kimi-tide-router`）。
- **kimi 接入指示**：kimi-coding 路由未注册或 Key 不可解析时显示「⚠️ Kimi 未接入：
  设置 → Models」指引。
- **官方配额显示**：周配额 / 5 小时窗口（≥80% 黄、≥90% 红），`upd HH:MM` 为上次
  刷新时间，凭据失效时灰化显示「过期」。
- **决策 chip**：规则命中 / 显式 @ 指令路由时显示实际路由 + 理由（打底与 keep 不上屏）。
- **刷新配额**：主行只读侧保留「🔄 刷新配额」按钮（`/kimi-tide refresh`，不写配置）。
- **推理状态**：推理输出已由 DSH 原生渲染（reasoning-delta），面板仅提示「已启用」。

面板命令族（也可在输入框直接敲，0.5.0 起为 v4 键表）：
- `/kimi-tide preset <id|off>`（全局切换激活预设）
- `/kimi-tide show`（当前预设 / 默认模型 / 规则数 / 关键词组数）
- `/kimi-tide set activePreset <id|off>`（`set` 键白名单仅此一键）
- `/kimi-tide export-config`（打印 resolved 配置 YAML）/ `/kimi-tide import-config <path|内联 YAML>`（文件整表替换，或多行内联 YAML 合并补丁）
- `/kimi-tide refresh`（立即刷新配额）

规则驱动路由架构详见 [docs/router.md](docs/router.md)。

## 已知限制（带图会话）

| 项 | 说明 |
|----|------|
| **带图会话锁存** | 图片一旦进入会话历史，文本-only 模型无法承接该会话（适配器序列化全量历史拒绝图片块）→ 路由器把会话锁存到多模态模型（`hasImageOverride` 强制按带图处理：带图规则必命中 + 护栏兜底） |
| **⚠️ 死锁场景** | 锁存后若多模态模型额度/Key 失效（AUTH 报错），会话无法切文本模型继续（`model-unavailable`：历史含图片）——存量会话只能新开会话 |
| **根解（规划中）** | 图片不进主会话历史：图像转述模式（模型级 pre-step 转述，rc.8 改设计中）——同时解决成本与死锁；子代理图片外包已裁撤（官方子代理仅文本） |

## 许可

[MIT](../../LICENSE) · 依赖 `@earendil-works/pi-ai`（MIT）
