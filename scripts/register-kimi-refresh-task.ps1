# register-kimi-refresh-task.ps1
# 重建计划任务 KimiTokenRefresh：每 10 分钟刷新 Kimi Code OAuth token 并同步到
#   ~/.kimi-code/credentials/kimi-code.json 与 ~/.dsh/.credentials.yaml
# 用法：在普通 PowerShell 窗口运行（当前用户即可，无需管理员）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Data\kimi-tide\scripts\register-kimi-refresh-task.ps1"
# 或：
#   pwsh -NoProfile -ExecutionPolicy Bypass -File "D:\Data\kimi-tide\scripts\register-kimi-refresh-task.ps1"

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$refreshScript = 'D:\Data\kimi-tide\scripts\kimi-token-refresh.ps1'
$taskName      = 'KimiTokenRefresh'

if (-not (Test-Path -LiteralPath $refreshScript)) {
    Write-Error "刷新脚本不存在: $refreshScript"
    exit 1
}

$pwshPath = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
if (-not $pwshPath) { $pwshPath = 'powershell.exe' }

Write-Host "使用解释器: $pwshPath"

$action = New-ScheduledTaskAction -Execute $pwshPath -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$refreshScript`""
$tStart = New-ScheduledTaskTrigger -AtStartup
$tEvery = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 10) `
    -RepetitionDuration ([TimeSpan]::FromDays(3650))
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($tStart, $tEvery) `
    -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "任务 $taskName 已注册（开机时 + 每 10 分钟触发，错过触发时间会补跑）。"

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 12

$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host ("状态: {0} | 上次运行: {1} | 结果代码: {2} | 下次运行: {3}" -f $info.State, $info.LastRunTime, $info.LastTaskResult, $info.NextRunTime)
if ($info.LastTaskResult -ne 0) {
    Write-Warning "上次运行失败（结果代码 $($info.LastTaskResult)），请检查日志："
    Write-Host "  D:\Data\kimi-tide\scripts\kimi-token-refresh.log"
} else {
    Write-Host '刷新日志最近 3 行：'
    Get-Content 'D:\Data\kimi-tide\scripts\kimi-token-refresh.log' -Tail 3
}
