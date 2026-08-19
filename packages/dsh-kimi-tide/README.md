# dsh-kimi-tide（月汐）

Kimi Code (Moonshot) 订阅 → DeepSeek Harness 原生 LLM provider 插件。

一个 Cordis 插件 = LLM 适配器 + OAuth 凭据管理：

- **零外部脚本**：OAuth access token（~15 分钟寿命）由插件进程内定时刷新（默认 10 分钟），与 kimi CLI 共享同一份登录态（`kimi login` 一次即可）
- **零计划任务**：跨平台，无 Windows 专属耦合
- **标准 DSH 插件**：`dsh.bundle.patch` 声明、`attributionHeaders()` 应用归因、`LlmAdapter` 完整实现（流协议翻译 / 模型元数据 / reasoning 档位）

> **当前状态（2026-08-19）**：main 已含 0.2.x 双模型路由器/月汐面板与 0.3.0 能力评分路由（均未发布 Release）；路由架构详见 [docs/router-v3.md](docs/router-v3.md)，带图会话限制见文末「已知限制」节。

## 模型

| 模型 | 说明 | 上下文 |
|------|------|--------|
| `kimi-for-coding` | Kimi K2.7 Code（默认） | 256K |
| `kimi-for-coding-highspeed` | K2.7 Code 高速版 | 256K |
| `k3` | Kimi K3 旗舰 | 1M |
| `k3-256k` | Kimi K3 256K 版 | 256K |

> 模态：以上 4 个模型在 pi-ai 目录中均声明 `input: ["text", "image"]`（多模态）。

## 前置条件

- Node.js ≥ 22、DSH `@deepseek-ai/dsh@0.1.0-rc.6`
- 已安装 Kimi Code CLI 并登录（一次即可）：

  ```powershell
  # Windows PowerShell（macOS/Linux 见官方文档 https://moonshotai.github.io/kimi-code/）
  irm https://code.kimi.com/kimi-code/install.ps1 | iex
  kimi login   # 浏览器完成设备码授权
  ```

## 安装

```bash
# 构建
npm install && npm run build && npm pack

# 安装到 DSH profile（自动加入 bundles）
dsh plugin --profile web add ./dsh-kimi-tide-0.1.3.tgz

# 重启 dsh web，模型选择器出现 kimi-tide 组
```

## 配置（cordis.patch.yml 可覆盖）

| 键 | 默认 | 说明 |
|----|------|------|
| `providerName` | `kimi-tide` | 注册进 `ctx.llm` 的路由名 |
| `kimiHome` | `''` | Kimi home（空 = `KIMI_CODE_HOME`，再回退 `~/.kimi-code`） |
| `refreshIntervalMs` | `600000` | access token 刷新周期 |
| `refreshOnStart` | `true` | 启动时立即刷新一次 |
| `usagePollMs` | `60000` | 月汐 dock 配额轮询周期（毫秒） |
| `usagePollOnStart` | `true` | 启动时立即轮询配额 |
| `router` | `off` | 路由器配置（`off` / `cost` / `capability`；0.2.x 已接线，默认 `off`） |
| `settingsNamespace` | `kimi-tide-router` | 路由配置的 DSH 设置命名空间（0.4.0；sidecar 已迁移为 `.legacy-imported` 留档） |
| `patchFile` | `$DSH_HOME/profiles/web/cordis.patch.yml` | 路由静态种子的 legacy 来源（0.4.0 起仅作 base 层，不再回写） |

`router` 子配置（settings schema 已含）：`primary` / `premium` / `premiumLong`（provider+model）、`escalateWhen.patterns`（cost 模式关键词升级）、`premiumBudget`（默认 0.2）、`budgetWindow`（默认 20）、`textOnlyProviders`（图像护栏用，71b1d18 新增：声明文本-only 的 provider，缺省 = `primary`；带图步骤自动改道多模态 premium）。

> 注：0.4.0 起路由配置持久化在官方设置面板 → 月汐（DSH 设置命名空间 `kimi-tide-router`，base/user 分层 + revision 冲突检测）；`router` 静态块为部署基座（base 层），用户编辑落 user 层。

## 使用合规提示

Kimi Code 订阅仅供个人交互式使用。本插件以订阅凭据直连官方后端，属于条款灰色地带——个人量级使用风险低，但请勿用于高频批量调用、多账号共享或转售。需要长期稳定的 API 集成时请改用 [Kimi 开放平台](https://platform.kimi.ai) 的 API key。

## 月汐 dock 面板（0.2.0）

会话输入框下方的「🌙 月汐」面板提供：

- **用量显示**：周配额 / 5 小时窗口百分比（≥80% 黄、≥90% 红），会员等级与重置倒计时在展开区；`upd HH:MM` 为上次刷新时间，凭据失效时灰化显示「过期」。
- **本地 token 统计**：今日 input/output/cache 命中率（按调用次数口径，与官方配额分开展示，不做换算）。
- **路由模式徽标**：只读显示当前 mode（📡 chip）；路由设置表单 0.4.0 起迁至官方设置面板「月汐」卡片（settings.section，id `kimi-tide-router`）。
- **刷新配额**：主行只读侧保留「🔄 刷新配额」按钮（`/kimi-tide refresh`，不写配置）。
- **推理状态**：推理输出已由 DSH 原生渲染（reasoning-delta），面板仅提示「已启用」。

面板命令族（也可在输入框直接敲，0.3.0 起为 v2 键表）：
- `/kimi-tide mode off|cost|capability`
- `/kimi-tide set <key> <value>`（v2 键：`lambda` / `routeThreshold` / `premiumBudget` / `budgetWindow` / `charsPerToken` / `default.model`）
- `/kimi-tide export-config`（打印 resolved 配置 YAML）/ `/kimi-tide import-config <path|内联 YAML>`（文件整表替换，或多行内联 YAML 合并补丁）
- `/kimi-tide refresh`（立即刷新配额）

0.4.0 起路由配置持久化在 DSH 设置命名空间 `kimi-tide-router`（base/user 分层 + revision 冲突检测），sidecar 文件一次性迁移为 `.legacy-imported` 留档；无 settings 服务时（rc.6）回退 sidecar（优先级 sidecar > patch 静态块 > 内置默认）。评分路由架构详见 [docs/router-v3.md](docs/router-v3.md)。

## 0.3.0 手工验收清单（约 5 分钟）

1. **重启生效**：`npm run build` 后重启 `dsh web`，模型选择器出现 kimi-tide 组；dock「决策可观测」区「配置来源」显示 🛠 设置命名空间（settings，迁移后）或 ⚙️ 内置默认（尚未保存）。
2. **设置卡片保存（模式）**：官方设置面板 → 月汐卡片，切 mode → capability 并保存；重启 `dsh web` 后模式保持（设置命名空间 `kimi-tide-router` 持久化）。
3. **设置卡片保存（评分，端到端）**：月汐卡片「能力评分」区为某个候选拖动滑杆后保存——嵌套 `scores` 字段经 `settings.mutate` 多段 path 写入 user 层（revision 冲突检测）；设置文档出现对应 `scores:` 覆盖，未触碰的字段（lambda/routeThreshold 等）保持不变。
4. **chip 显示实际路由**：capability 模式下发一条「请审查这段代码 review」，决策 chip 显示实际路由（`kimi-tide/kimi-for-coding` + scoreDelta）；发一条「今天天气不错」则回到默认路由。
5. **带图消息改道**：默认路由为 text-only（deepseek）时发送带图消息，该步自动改道多模态 premium（护栏），不抛 UNSUPPORTED_CONTENT。
6. **export/import 往返**：`/kimi-tide export-config` 打印 resolved YAML → 保存为文件并修改（如改 `lambda`）→ `/kimi-tide import-config <path>` 整表导入（写入设置命名空间），dock 快照与重启后均反映新值。
7. **mode off 逃生**：月汐卡片切 off 或 `/kimi-tide mode off`，后续消息不再改道（决策 chip 清空），行为回到 0.1.x 直通。

## 已知限制（带图会话，2026-08-19）

| 项 | 说明 |
|----|------|
| **带图会话锁存** | 图片一旦进入会话历史，文本-only 模型无法承接该会话（适配器序列化全量历史拒绝图片块）→ 路由器把会话锁存到多模态模型（fcbf421，`hasImageOverride` 强制 vision 评分） |
| **⚠️ 死锁场景** | 锁存后若多模态模型额度/Key 失效（AUTH 报错），会话无法切文本模型继续（`model-unavailable`：历史含图片）——存量会话只能新开会话 |
| **根解（0.3.x 规划）** | 图片不进主会话历史：图像转述模式（模型级 pre-step 转述）/ 子代理图片外包（子代理读图回传文字，前置=kimi 子代理后端）——同时解决成本与死锁 |

## 许可

[MIT](../../LICENSE) · 依赖 `@earendil-works/pi-ai`（MIT）
