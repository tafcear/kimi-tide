# dsh-kimi-tide（月汐）

DeepSeek Harness（DSH）的「每一步自动选模型」插件：命名预设 + 有序规则 + 协作流——贴图自动走能看图的模型，代码自动走编码模型，闲聊翻译自动走便宜模型；没有规则命中时走预设默认模型（打底）。带图像护栏、图像转述流、多 plan 配额显示，每次选了谁、为什么，面板上看得见。

> **当前状态**：v1.1.0 已发布（[Release](https://github.com/tafcear/kimi-tide/releases/tag/v1.1.0)），555/555 测试绿。新增：评审流（认领组静态抑制 + 轮末异步评审 + 评审事件卡 + `/kimi-tide review` 手动命令）。版本历史见仓库根 [CHANGELOG](../../CHANGELOG.md)；项目介绍与快速开始见[根 README](../../README.md)。匹配语义（词边界/特异度排序/最少命中词数）、effort 推理档位与路由配置全字段，见 [docs/router.md](docs/router.md)。

0.4.x 起插件**零接入层代码**——Kimi 模型经官方 pi-ai 原生 `kimi-coding` 路由（设置 → Models 配一把 Console API Key）进 DSH LLM 注册表，自研 OAuth 接入层（约 740 行）整体退役。插件只保留官方生态没有的能力：**路由、护栏、协作编排、观测**。

## 模型（经 kimi-coding 路由）

| 模型 | 说明 | 上下文 |
|------|------|--------|
| `kimi-for-coding` | Kimi K2.7 Code（编码任务主力） | 256K |
| `kimi-for-coding-highspeed` | K2.7 Code 高速版 | 256K |
| `k3` | Kimi K3 旗舰 | 1M |
| `k3-256k` | Kimi K3 256K 版 | 256K |

> 模态：以上 4 个模型在 pi-ai 目录中均声明 `input: ["text", "image"]`（能看图）。

## 前置条件

- Node.js ≥ 22、DSH `@deepseek-ai/dsh@0.1.1-rc.2` 及以上（0.6.0 起 peer 依赖；设置卡片依赖 `dsh-settings`）
- 一把 **Kimi Code Console API Key**（Kimi 控制台获取）

## 安装

```bash
npm install && npm run build && npm pack
dsh plugin --profile web add ./dsh-kimi-tide-<version>.tgz
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

> 路由配置本体持久化在官方设置面板「设置 → 月汐」（DSH 设置命名空间
> `kimi-tide-router`），配置形状为 v5（`activePreset` / `presets`（默认模型 +
> 有序规则 + `imageFallback` 三态）/ `keywordGroups`（内置 7 组）/ `flows`
> （协作流注册表）/ `auxTargets` 辅助请求改道表）；存量配置经迁移链自动桥接并留档。
> 配置全字段见 [docs/router.md](docs/router.md) 的「配置参考」与「0.6.0 协作编排扩展」（v5 增量速览）两节；迁移链见「迁移链」节。

## 月汐 dock 面板（只读仪表）

会话输入框下方的「🌙 月汐」面板提供：

- **预设徽标**：只读显示当前预设名（或「关闭」，📡 chip）与预设默认模型（⚡ chip）；
  预设管理（选择/编辑/新建/复制/删除 + 规则表 + 关键词组）在官方设置页「月汐」
  卡片（`settings.section`，id `kimi-tide-router`）。
- **kimi 接入指示**：kimi-coding 路由未注册或 Key 不可解析时显示「⚠️ Kimi 未接入：
  设置 → Models」指引。
- **多 plan 配额显示**：额度槽跟随当前命中目标自动切换——Kimi Code 周配额 / 5 小时
  窗口，或 GLM Coding Plan 5h token 窗 / 7 天周窗；`upd HH:MM` 为上次刷新时间，凭据失效时
  灰化显示「过期」，无套餐目标自动置灰。
- **决策 chip**：规则命中 / 显式 @ 指令路由时显示实际路由 + 理由（原因带命中词数，
  如「规则「code」命中 2 词（特异度最高）」；打底与 keep 不上屏）。
- **刷新配额**：主行只读侧保留「🔄 刷新配额」按钮（`/kimi-tide refresh`，不写配置）。
- **推理状态**：推理输出已由 DSH 原生渲染（reasoning-delta），面板仅提示「已启用」。

面板命令族（也可在输入框直接敲）：

- `/kimi-tide preset <id|off>`（全局切换激活预设）
- `/kimi-tide show`（当前预设 / 默认模型 / 规则数 / 关键词组数 / flows 注册表 / 每预设 imageFallback）
- `/kimi-tide set activePreset <id|off>`（`set` 键白名单仅此一键）
- `/kimi-tide export-config`（打印 resolved 配置 YAML）/ `/kimi-tide import-config <path|内联 YAML>`（文件整表替换，或多行内联 YAML 合并补丁）
- `/kimi-tide refresh`（立即刷新配额）
- `/kimi-tide help`（命令用法一览）

规则驱动路由架构详见 [docs/router.md](docs/router.md)。

## 带图行为与已知限制

| 项 | 说明 |
|----|------|
| **按图三态** | 每张图按 `native`（视觉模型原生处理）/ `transcribed`（已转述为文字）/ `blind`（当无图）三态跟踪；文本-only 目标面对 native 历史图时按预设 `imageFallback` 处置：`latch` 改道锁存目标 / `blind` 占位盲答 / `transcribe-lazy` 先补转述再放行 |
| **图像转述流** | 省钱姿态的根解：`image` 规则改挂 `flow:transcribe` → vision-exp 读图转文字（eager，缓存+30s 超时+失败不重打）→ 文本模型凭转述文字接力作答；`failurePolicy=latch-image` 转述失败回退原生视觉 |
| **⚠️ 死锁场景（历史）** | 0.5.x 布尔锁存下多模态模型额度/Key 失效后会话无法切文本模型——0.6.0 起按图三态 + 转述流提供盲答/转述两条出路（存量含图会话仍只能新开会话） |
| **面板图像上下文行** | dock 第二行显示「图 原N·述N」，盲答图 >0 时告警色 |

## 使用合规提示

0.4.x 起默认走 **Console API Key 官方路径**，个人使用安心；Kimi Code 订阅条款仍以
官方表述为准，请勿高频批量调用或共享密钥。本仓库**不含任何凭据**。

## 许可

[MIT](../../LICENSE) · 依赖 `@earendil-works/pi-ai`（MIT）
