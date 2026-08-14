# dsh-kimi-tide v0.1.1 — 首个正式 Release

> 月汐：月亮（Moonshot/Kimi）牵引深海（DeepSeek/DSH）的潮汐。

## 这是做什么的

把 **Kimi Code 订阅** 接入 **DeepSeek Harness** 的标准插件：一个 Cordis 插件 = LLM 适配器 + OAuth 凭据管理。安装后 `kimi-tide` 成为 DSH 原生 provider，与 kimi CLI 共享同一份登录态。

## 特性

- **零外部脚本 / 零计划任务**：access token（~15 分钟寿命）由插件进程内定时刷新（默认 10 分钟），跨平台
- **完整 LlmAdapter 实现**：流协议翻译、模型元数据、reasoning 档位、`attributionHeaders()` 应用归因
- **符合官方发布规范**：`dsh.bundle.patch` 声明 + exports 映射 + files 打包清单
- **模型**：`kimi-for-coding`（K2.7 Code）/ `kimi-for-coding-highspeed` / `k3`（1M 上下文）/ `k3-256k`

## 安装

```bash
# 方式一：本 Release 附件（推荐）
dsh plugin --profile web add dsh-kimi-tide-0.1.1.tgz

# 方式二：源码构建
cd packages/dsh-kimi-tide && npm install && npm run build && npm pack
```

安装后重启 `dsh web`，模型选择器出现 `kimi-tide` 组。

## 配置（cordis.patch.yml 可覆盖）

| 键 | 默认 | 说明 |
|----|------|------|
| `providerName` | `kimi-tide` | 注册进 `ctx.llm` 的路由名 |
| `kimiHome` | `''` | Kimi home（空 = `KIMI_CODE_HOME` → `~/.kimi-code`） |
| `refreshIntervalMs` | `600000` | access token 刷新周期 |
| `refreshOnStart` | `true` | 启动时立即刷新 |

## 与 kimi-tide 项目的关系

本插件是 [kimi-tide](https://github.com/tafcear/kimi-tide) 项目的推荐接入路径。项目还包含：

- `vendor/dsh-kimi-bridge`：Kimi CLI 桥接插件维护 fork（Windows junction/copy fallback 等修复）
- `docs/`：Agent 协作闭环方法论 + 审查档案 + 任务书模板

## 使用合规提示

Kimi Code 订阅仅供个人交互式使用。本插件以订阅凭据直连官方后端，属于条款灰色地带——个人量级使用风险低，但请勿用于高频批量调用、多账号共享或转售。需要长期稳定的 API 集成时请改用 [Kimi 开放平台](https://platform.kimi.ai) 的 API key。

## 许可

MIT（依赖 `@earendil-works/pi-ai`，MIT）
