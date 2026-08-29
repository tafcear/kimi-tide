# dsh-kimi-tide（月汐）

DeepSeek Harness 的**预设 + 规则 + 协作流模型路由插件**（0.8.0）：命名预设（省钱/能力/可自建）
+ 有序规则（带图 / 关键词组 / **协作流引用**），按任务在 Kimi（`kimi-coding`）与 DeepSeek 之间自动
选路，未命中走预设默认模型（打底），带图像护栏、图像转述流、官方配额显示与决策可观测。

**匹配语义（0.7.0）**：纯 ASCII 关键词按词边界匹配（`decode`/`unicode`/`barcode` 不误中
`code`），中文关键词保持子串；命中规则按特异度排序（命中词数多者优先、平手按列表序、
带图恒优先）；关键词条件可选 `minHits` 最少命中词数（≥1 整数，缺省 1）。

**0.8.0**：内置关键词组扩到 **7 组**（新增 review / writing / translate / longdoc / math，
chitchat 瘦身纯寒暄）；能力预设序 带图→审查→代码→数学→长文→写作→翻译→闲聊、省钱加翻译；
规则目标/预设默认/转述流视觉模型可选 **`effort` 推理档位**（运行期按模型档位支持集判定，
不支持剥离记日志；reviewer 不接收）；设置卡片规则行条件摘要 + effort 下拉 + **「试一句」**
测试器；dock 决策原因带命中词数。

0.4.x 起插件**零接入层代码**——Kimi 模型经官方 pi-ai 原生 `kimi-coding` 路由
（设置 → Models 配一把 Console API Key）进 DSH LLM 注册表，自研 OAuth 接入层
（约 740 行）整体退役。插件只保留官方生态没有的能力：**路由、护栏、协作编排、观测**。

> **当前状态（2026-08-27）**：0.8.0「规则体系补全 + 可解释性 + effort」**已实施、待实机验收
> B1–B8 门禁**（分支 `feat/0.8.0-routing-coverage`；发版 = 实机验收清单全绿 + 用户裁定 tag，
> 门禁成文见仓库根 README「开发与测试」节）——7 组词表 + 预设接组 + effort 三入口 + 条件
> 摘要/试一句/决策词数；385/385 绿 + typecheck 0 + build 过。
> 0.6.0「协作编排」已发布（tag `v0.6.0`，[Release](https://github.com/tafcear/kimi-tide/releases/tag/v0.6.0)）——规则目标泛化为
> 「模型 | 协作流」，预置图像转述流（vision-exp，eager/lazy）与评审流（P2 触发）注册但不绑定；
> 按图三态（native/transcribed/blind）退役布尔锁存；预设级 `imageFallback` 三态（锁存/盲答/懒转述）；
> `llm/stream` 智能投影（已转述图块 → 转述文字）；实机验收 10 项全过（含 T4 门）。路由架构详见
> [docs/router.md](docs/router.md)，带图行为见文末「带图行为与已知限制」节。

## 模型（经 kimi-coding 路由）

| 模型 | 说明 | 上下文 |
|------|------|--------|
| `kimi-for-coding` | Kimi K2.7 Code（默认候选） | 256K |
| `kimi-for-coding-highspeed` | K2.7 Code 高速版 | 256K |
| `k3` | Kimi K3 旗舰 | 1M |
| `k3-256k` | Kimi K3 256K 版 | 256K |

> 模态：以上 4 个模型在 pi-ai 目录中均声明 `input: ["text", "image"]`（多模态）。

## 前置条件

- Node.js ≥ 22、DSH `@deepseek-ai/dsh@0.1.1-rc.2` 及以上（0.6.0 起 peer 依赖；设置卡片依赖 `dsh-settings`）
- 一把 **Kimi Code Console API Key**（Kimi 控制台获取）

## 安装

```bash
npm install && npm run build && npm pack
dsh plugin --profile web add ./dsh-kimi-tide-0.8.0.tgz
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
> 文件。**0.6.0 起配置形状为 v5**（`activePreset` / `presets`（默认模型 + 有序规则 +
> `imageFallback` 三态）/ `keywordGroups`（内置 7 组，0.8.0）/ `flows`（协作流注册表））；
> **0.8.0 起三处可选 `effort` 推理档位**（规则 target / 预设 default / 转述流
> visionModel；运行期按模型支持集判定，不支持剥离，reviewer 不接收）；v1-v4 存量配置经
> 迁移链自动桥接并留档 `.pre-v4` / `.pre-v5`（行为保持：预置流注册但不绑定，缺省维持
> 0.5.x 锁存语义）。

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
- **决策 chip**：规则命中 / 显式 @ 指令路由时显示实际路由 + 理由（0.8.0 起原因带命中词数，
  如「规则「code」命中 2 词（特异度最高）」；打底与 keep 不上屏）。
- **刷新配额**：主行只读侧保留「🔄 刷新配额」按钮（`/kimi-tide refresh`，不写配置）。
- **推理状态**：推理输出已由 DSH 原生渲染（reasoning-delta），面板仅提示「已启用」。

面板命令族（也可在输入框直接敲，0.6.0 起为 v5 键表）：
- `/kimi-tide preset <id|off>`（全局切换激活预设）
- `/kimi-tide show`（当前预设 / 默认模型 / 规则数 / 关键词组数 / flows 注册表 / 每预设 imageFallback）
- `/kimi-tide set activePreset <id|off>`（`set` 键白名单仅此一键）
- `/kimi-tide export-config`（打印 resolved 配置 YAML）/ `/kimi-tide import-config <path|内联 YAML>`（文件整表替换，或多行内联 YAML 合并补丁）
- `/kimi-tide refresh`（立即刷新配额）

规则驱动路由架构详见 [docs/router.md](docs/router.md)。

## 带图行为与已知限制

| 项 | 说明 |
|----|------|
| **按图三态**（0.6.0 起替代会话锁存） | 每张图按 `native`（视觉模型原生处理）/ `transcribed`（已转述为文字）/ `blind`（当无图）三态跟踪；文本-only 目标面对 native 历史图时按预设 `imageFallback` 处置：`latch` 改道锁存目标 / `blind` 占位盲答 / `transcribe-lazy` 先补转述再放行 |
| **图像转述流** | 省钱姿态的根解：`image` 规则改挂 `flow:transcribe` → vision-exp 读图转文字（eager，缓存+30s 超时+失败不重打）→ 文本模型凭转述文字接力作答（T4 门已实测通过）；`failurePolicy=latch-image` 转述失败回退原生视觉 |
| **⚠️ 死锁场景（0.5.x 遗留，0.6.0 已解）** | 0.5.x 布尔锁存下多模态模型额度/Key 失效后会话无法切文本模型——0.6.0 起按图三态 + 转述流提供盲答/转述两条出路（存量含图会话仍只能新开会话） |
| **面板图像上下文行** | 投影 v6 已推送 `imageContext` 计数 + `lastFlowEvent`（宿主侧）；**客户端渲染降级 0.6.x 跟进**（dock 暂不显示该行，以决策 chip + 会话日志为准） |

## 许可

[MIT](../../LICENSE) · 依赖 `@earendil-works/pi-ai`（MIT）
