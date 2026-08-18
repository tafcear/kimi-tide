# dsh-kimi-tide（月汐）

Kimi Code (Moonshot) 订阅 → DeepSeek Harness 原生 LLM provider 插件。

一个 Cordis 插件 = LLM 适配器 + OAuth 凭据管理：

- **零外部脚本**：OAuth access token（~15 分钟寿命）由插件进程内定时刷新（默认 10 分钟），与 kimi CLI 共享同一份登录态（`kimi login` 一次即可）
- **零计划任务**：跨平台，无 Windows 专属耦合
- **标准 DSH 插件**：`dsh.bundle.patch` 声明、`attributionHeaders()` 应用归因、`LlmAdapter` 完整实现（流协议翻译 / 模型元数据 / reasoning 档位）

## 模型

| 模型 | 说明 | 上下文 |
|------|------|--------|
| `kimi-for-coding` | Kimi K2.7 Code（默认） | 256K |
| `kimi-for-coding-highspeed` | K2.7 Code 高速版 | 256K |
| `k3` | Kimi K3 旗舰 | 1M |
| `k3-256k` | Kimi K3 256K 版 | 256K |

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
| `patchFile` | `$DSH_HOME/profiles/web/cordis.patch.yml` | 路由设置面板回写的目标文件 |

`router` 子配置（settings schema 已含）：`primary` / `premium` / `premiumLong`（provider+model）、`escalateWhen.patterns`（cost 模式关键词升级）、`premiumBudget`（默认 0.2）、`budgetWindow`（默认 20）、`textOnlyProviders`（图像护栏用，71b1d18 新增：声明文本-only 的 provider，缺省 = `primary`；带图步骤自动改道多模态 premium）。

## 使用合规提示

Kimi Code 订阅仅供个人交互式使用。本插件以订阅凭据直连官方后端，属于条款灰色地带——个人量级使用风险低，但请勿用于高频批量调用、多账号共享或转售。需要长期稳定的 API 集成时请改用 [Kimi 开放平台](https://platform.kimi.ai) 的 API key。

## 月汐 dock 面板（0.2.0）

会话输入框下方的「🌙 月汐」面板提供：

- **用量显示**：周配额 / 5 小时窗口百分比（≥80% 黄、≥90% 红），会员等级与重置倒计时在展开区；`upd HH:MM` 为上次刷新时间，凭据失效时灰化显示「过期」。
- **本地 token 统计**：今日 input/output/cache 命中率（按调用次数口径，与官方配额分开展示，不做换算）。
- **路由模式切换**：off / cost / capability 一键切换，保存即写入用户 `cordis.patch.yml` 并即时生效（重启保持）。
- **设置表单**：展开区逐项编辑预算占比、升级阈值、模型选择等，回车保存。
- **推理状态**：推理输出已由 DSH 原生渲染（reasoning-delta），面板仅提示「已启用」。

面板命令族（也可在输入框直接敲，0.3.0 起为 v2 键表）：
- `/kimi-tide mode off|cost|capability`
- `/kimi-tide set <key> <value>`（v2 键：`lambda` / `routeThreshold` / `premiumBudget` / `budgetWindow` / `charsPerToken` / `default.model`）
- `/kimi-tide export-config`（打印 sidecar YAML）/ `/kimi-tide import-config <path|内联 YAML>`（文件整表替换，或多行内联 YAML 合并补丁——面板「保存评分」走的就是这条通道）
- `/kimi-tide refresh`（立即刷新配额）

0.3.0 起路由配置改存 sidecar 文件（`$DSH_HOME/profiles/web/kimi-tide-router.yml`，与 patch 文件互邻），优先级 sidecar > patch 静态块 > 内置默认；面板保存不再回写 `cordis.patch.yml`。评分路由架构详见 [docs/router-v3.md](docs/router-v3.md)。

## 0.3.0 手工验收清单（约 5 分钟）

1. **重启生效**：`npm run build` 后重启 `dsh web`，模型选择器出现 kimi-tide 组；月汐面板折叠区「配置来源」显示 ⚙️ 内置默认（首次）或 📄 sidecar 文件（保存过）。
2. **面板保存（模式）**：面板切 mode → capability，展开区「配置来源」变为 📄 sidecar 文件；重启 `dsh web` 后模式保持（sidecar 持久化）。
3. **面板保存（评分，端到端）**：展开「能力评分」，为某个候选拖动滑杆后点「保存评分」——面板经 remote 通道把多行 sidecar YAML 发给 `/kimi-tide import-config`（内联文本形态），换行保真、合并补丁生效；`sidecar` 文件出现对应 `scores:` 覆盖，未触碰的字段（lambda/routeThreshold 等）保持不变。
4. **chip 显示实际路由**：capability 模式下发一条「请审查这段代码 review」，决策 chip 显示实际路由（`kimi-tide/kimi-for-coding` + scoreDelta）；发一条「今天天气不错」则回到默认路由。
5. **带图消息改道**：默认路由为 text-only（deepseek）时发送带图消息，该步自动改道多模态 premium（护栏），不抛 UNSUPPORTED_CONTENT。
6. **export/import 往返**：`/kimi-tide export-config` 打印 YAML → 保存为文件并修改（如改 `lambda`）→ `/kimi-tide import-config <path>` 整表导入，面板快照与重启后均反映新值。
7. **mode off 逃生**：面板切 off 或 `/kimi-tide mode off`，后续消息不再改道（决策 chip 清空），行为回到 0.1.x 直通。

## 许可

[MIT](../../LICENSE) · 依赖 `@earendil-works/pi-ai`（MIT）
