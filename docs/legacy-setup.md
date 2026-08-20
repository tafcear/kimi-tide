# 旧配置方案（备选）：settings.yaml + 外部刷新脚本

> ⚠️ **已被 0.4.x 取代**：v0.4.0 起 kimi-tide 走 pi-ai 原生 `kimi-coding` 路由 + Console API Key（见 README 快速开始），本文档的定时任务/OAuth 方案仅作历史存档，不再适用。

> 仅当无法使用 [`dsh-kimi-tide`](../packages/dsh-kimi-tide) 插件时（如 DSH 版本过旧）才推荐此路径。
> 插件方案（进程内 OAuth 刷新）是当前首选。

## 1. 前置条件

- 已安装 Kimi CLI 并完成登录：`kimi login`
- DSH `@deepseek-ai/dsh@0.1.0-rc.6` 及以上（rc.6 起可用；已在 rc.7 实机验证）

## 2. 配置自动刷新（Windows 计划任务）

Kimi Code 的 OAuth access token 默认约 15 分钟过期。运行以下命令创建每 10 分钟执行一次的计划任务：

```powershell
# 以管理员身份运行 PowerShell
$action = New-ScheduledTaskAction -Execute "C:\Program Files\PowerShell\7\pwsh.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"E:\BaiduSyncdisk\Data\vibe-coding\kimi-tide\kimi-tide\scripts\kimi-token-refresh.ps1`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -TaskName "KimiTokenRefresh" -Action $action -Trigger $trigger -User "$env:USERDOMAIN\$env:USERNAME" -RunLevel Highest
```

脚本会：

- 读取 `~/.kimi-code/credentials/kimi-code.json` 中的 `refresh_token`
- 向 `https://auth.kimi.com/api/oauth/token` 换取新的 access token
- 同步更新 `~/.kimi-code/credentials/kimi-code.json` 与 `~/.dsh/.credentials.yaml` 中的 `KIMI_API_KEY`

> 如果脚本报 `FATAL: credential file not found`，先执行 `kimi login` 生成初始凭据。

## 3. 配置 DSH Provider

编辑 `~/.dsh/settings.yaml`，加入：

```yaml
llm-pi-ai:
  providers:
    kimi-coding:
      apiKeyEnv: KIMI_API_KEY
```

DSH 的 `settings.yaml` 支持热加载，保存后无需重启即可生效。

## 4. 验证配置

```bash
node scripts/validate-kimi-settings.mjs
```

预期输出类似：

```text
schema OK, providers: kimi-coding
  kimi-coding: apiKeyEnv=KIMI_API_KEY api=(catalog) baseURL=(catalog)
```

## 5. 端到端流式测试

```bash
node scripts/e2e-kimi.mjs
```

预期输出：模型元信息、流式响应文本以及 `stream ok, done = true`。

> 脚本通过 `DSH_HOME` / `os.homedir()` 自动解析 `~/.dsh` 路径，无需修改即可在其他机器上运行（依赖在项目根 `npm install` 安装）。

## 6. 可选备用路由（Moonshot 开放平台 API key）

在 `~/.dsh/.credentials.yaml` 加 `MOONSHOT_API_KEY` 后，取消 `settings.yaml` 中对应注释即可启用（`moonshotai-cn` 国内 / `moonshotai` 国际）。这是完全合规的替代路径（按量付费，条款明确允许 API 集成）。

## 重要提醒

**优先只保留一条路径**：插件方案（进程内刷新，零计划任务）是首选，本旧方案仅在插件不可用（如 DSH 版本过旧）时使用。

自 v0.1.3 起，插件与计划任务脚本**共用同一把凭据锁**（`<kimi-home>/credentials/kimi-code.json.lock`），刷新被串行化，refresh token 轮换不会互踩——两者可以安全共存（详见根 README FAQ）。但并存时两套刷新仍在同一进程组里冗余运行，仍建议：启用插件后停用计划任务 `KimiTokenRefresh`，避免无谓的双刷新。
