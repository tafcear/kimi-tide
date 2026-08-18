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

面板命令族（也可在输入框直接敲）：
- `/kimi-tide mode off|cost|capability`
- `/kimi-tide set <key> <value>`（key 见面板表单）
- `/kimi-tide refresh`（立即刷新配额）

## 许可

[MIT](../../LICENSE) · 依赖 `@earendil-works/pi-ai`（MIT）
