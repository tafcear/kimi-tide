# 旧配置方案（备选）：settings.yaml + 外部刷新脚本

> 仅当无法使用 [`dsh-kimi-tide`](../packages/dsh-kimi-tide) 插件时（如 DSH 版本过旧）才推荐此路径。
> 插件方案（进程内 OAuth 刷新）是当前首选。

## 1. 前置条件

- 已安装 Kimi CLI 并完成登录：`kimi login`
- DSH `@deepseek-ai/dsh@0.1.0-rc.6`

## 2. 配置自动刷新（Windows 计划任务）

Kimi Code 的 OAuth access token 默认约 15 分钟过期。运行以下命令创建每 10 分钟执行一次的计划任务：

```powershell
# 以管理员身份运行 PowerShell
$action = New-ScheduledTaskAction -Execute "C:\Program Files\PowerShell\7\pwsh.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"D:\Data\kimi-tide\scripts\kimi-token-refresh.ps1`""
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

**请勿同时启用插件方案与本方案的自动刷新**：插件与计划任务脚本会并发刷新同一凭据文件，产生 refresh token 轮换竞态（两个进程各持旧 token 刷新，后到者会 invalid_grant）。选用插件后应禁用计划任务 `KimiTokenRefresh`。
