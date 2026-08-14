# kimi-token-refresh.ps1 (v3)
# 刷新 Kimi Code OAuth access token（默认 15 分钟过期），并同步到：
#   1. ~/.kimi-code/credentials/kimi-code.json   （kimi CLI 自身凭据）
#   2. ~/.dsh/.credentials.yaml                  （DSH 的 KIMI_API_KEY，供 dsh-llm-pi-ai 使用）
# 由计划任务 KimiTokenRefresh 每 10 分钟运行一次。
#
# v3 改进（kimi 审查后）：
#   - 原子锁（New-Item 独占创建 + stale 检测，崩溃不留死锁）
#   - 凭据原子写（临时文件 + Move-Item）
#   - 响应字段 JWT 结构校验（三段落），拒绝空值覆盖
#   - invalid_grant 从 HTTP 响应体判断，message 正则仅作 fallback
#   - 日志轮转（>1MB 归档 .old）
#   - 凭据文件 ACL 收紧（仅当前用户 + SYSTEM）
#   - $ProgressPreference 静默（计划任务环境防进度条干扰）
#   - ConvertTo-Json 显式 -Depth

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$credFile    = Join-Path $env:USERPROFILE '.kimi-code\credentials\kimi-code.json'
$dshCredFile = Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'
$clientId    = '17e5f671-d194-4dfb-9706-5516cb48c098'
$tokenUrl    = 'https://auth.kimi.com/api/oauth/token'
$logFile     = Join-Path (Split-Path -Parent $PSCommandPath) 'kimi-token-refresh.log'
$lockFile    = Join-Path $env:TEMP 'kimi-token-refresh.lock'
$maxLogBytes = 1MB
$lockStaleMinutes = 5

function Write-Log([string]$msg) {
    # 日志轮转：超过 1MB 归档为 .old（保留上一份即可）
    try {
        if ((Test-Path -LiteralPath $logFile) -and ((Get-Item -LiteralPath $logFile).Length -gt $maxLogBytes)) {
            Move-Item -LiteralPath $logFile -Destination "$logFile.old" -Force -ErrorAction SilentlyContinue
        }
    } catch { }
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    try { Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8 } catch { }
    Write-Host $line
}

# ---- 原子锁：New-Item 独占创建；带 stale 检测，崩溃不会留下死锁 ----
function Try-AcquireLock {
    if (Test-Path -LiteralPath $lockFile) {
        $stale = $false
        try {
            $info = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
            $t = [datetime]$info.time
            if (((Get-Date) - $t).TotalMinutes -gt $lockStaleMinutes) { $stale = $true }
        } catch {
            $stale = $true # 锁文件损坏同样视为 stale
        }
        if ($stale) {
            Write-Log "stale lock detected, removing ($lockFile)"
            Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
        } else {
            Write-Log 'another instance is running (fresh lock), exiting'
            return $false
        }
    }
    try {
        # New-Item 对已存在文件会报错：文件创建是原子的，这就是锁获取
        $null = New-Item -ItemType File -Path $lockFile -ErrorAction Stop
        $info = [ordered]@{ pid = $PID; time = (Get-Date).ToString('o') }
        $info | ConvertTo-Json -Compress -Depth 5 | Set-Content -LiteralPath $lockFile -Encoding UTF8 -ErrorAction Stop
        return $true
    } catch {
        Write-Log "cannot acquire lock: $($_.Exception.Message)"
        return $false
    }
}

# ---- 原子文件写：临时文件 + Move-Item（同目录同卷原子替换） ----
function Write-AtomicFile([string]$path, [string]$content) {
    $dir = Split-Path -Parent $path
    $tmp = Join-Path $dir ('.' + (Split-Path -Leaf $path) + '.tmp-' + [guid]::NewGuid().ToString('N'))
    try {
        Set-Content -LiteralPath $tmp -Value $content -Encoding UTF8 -ErrorAction Stop
        Move-Item -LiteralPath $tmp -Destination $path -Force -ErrorAction Stop
    } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

# ---- JWT 结构校验：三段落、各段非空（替代脆弱的长度启发式） ----
function Test-JwtShape([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return $false }
    $parts = $value.Split('.')
    if ($parts.Count -ne 3) { return $false }
    return ($parts[0].Length -gt 10 -and $parts[1].Length -gt 10 -and $parts[2].Length -gt 10)
}

# ---- invalid_grant 判定：优先 HTTP 响应体，其次异常消息 ----
function Test-InvalidGrant($err) {
    if ($null -ne $err -and $null -ne $err.ErrorDetails -and $null -ne $err.ErrorDetails.Message) {
        if ([string]$err.ErrorDetails.Message -match 'invalid_grant') { return $true }
    }
    if ($null -ne $err -and $null -ne $err.Exception -and [string]$err.Exception.Message -match 'invalid_grant') { return $true }
    return $false
}

if (-not (Try-AcquireLock)) { exit 0 }
try {

    if (-not (Test-Path -LiteralPath $credFile)) {
        Write-Log "FATAL: credential file not found: $credFile — run 'kimi login' first"
        exit 1
    }
    $cred = Get-Content -LiteralPath $credFile -Raw | ConvertFrom-Json
    if (-not $cred.refresh_token) {
        Write-Log 'FATAL: no refresh_token in credential file — run kimi login'
        exit 1
    }

    # ---- refresh token 到期预警（解码 JWT payload 的 exp 字段，提前 7 天告警） ----
    try {
        $payload = $cred.refresh_token.Split('.')[1].Replace('-', '+').Replace('_', '/')
        switch ($payload.Length % 4) { 2 { $payload += '==' } 3 { $payload += '=' } }
        $claims = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
        $now = [long][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $daysLeft = [math]::Floor(($claims.exp - $now) / 86400.0)
        if ($daysLeft -le 7) {
            Write-Log "WARN: refresh token expires in $daysLeft days — run 'kimi login' again soon"
        }
    } catch { }

    $body = "client_id=$clientId&grant_type=refresh_token&refresh_token=$([uri]::EscapeDataString($cred.refresh_token))"

    # ---- 请求：先走系统代理（Clash 等），失败后直连 fallback ----
    $resp = $null
    try {
        $resp = Invoke-RestMethod -Uri $tokenUrl -Method Post -ContentType 'application/x-www-form-urlencoded' -Body $body -TimeoutSec 30
    } catch {
        if (Test-InvalidGrant $_) {
            Write-Log "FATAL: refresh token rejected (invalid_grant) — run 'kimi login' again to re-authenticate"
            exit 1
        }
        Write-Log "proxy-path attempt failed ($($_.Exception.Message)); retrying with -NoProxy"
        try {
            $resp = Invoke-RestMethod -NoProxy -Uri $tokenUrl -Method Post -ContentType 'application/x-www-form-urlencoded' -Body $body -TimeoutSec 30
        } catch {
            if (Test-InvalidGrant $_) {
                Write-Log "FATAL: refresh token rejected (invalid_grant) — run 'kimi login' again to re-authenticate"
                exit 1
            }
            Write-Log "FATAL: token refresh failed on both paths: $($_.Exception.Message)"
            exit 1
        }
    }

    # ---- 响应校验：任一字段异常都不写文件（防止空值覆盖凭据） ----
    $access  = [string]$resp.access_token
    $refresh = [string]$resp.refresh_token
    $expiresIn = 0
    if ($resp.expires_in -is [long] -or $resp.expires_in -is [int]) { $expiresIn = [long]$resp.expires_in }
    elseif ($resp.expires_in) { $expiresIn = [long]([string]$resp.expires_in) }

    if (-not (Test-JwtShape $access) -or -not (Test-JwtShape $refresh) -or $expiresIn -le 0) {
        Write-Log "FATAL: response missing/invalid fields (access_ok=$(Test-JwtShape $access) refresh_ok=$(Test-JwtShape $refresh) expires_in=$expiresIn) — refusing to write, keeping existing credentials"
        exit 1
    }

    $now = [long][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $expiresAt = $now + $expiresIn

    # 1) 更新 kimi CLI 凭据文件（保留字段结构；原子写）
    $newCred = [ordered]@{
        access_token  = $access
        refresh_token = $refresh
        expires_at    = $expiresAt
        scope         = if ($resp.scope) { [string]$resp.scope } else { 'kimi-code' }
        token_type    = if ($resp.token_type) { [string]$resp.token_type } else { 'Bearer' }
        expires_in    = $expiresIn
    }
    $credJson = $newCred | ConvertTo-Json -Depth 10
    Write-AtomicFile -path $credFile -content $credJson

    # 2) 更新 DSH 凭据（KIMI_API_KEY 键，保留其他键如 DEEPSEEK_API_KEY；原子写）
    $lines = if (Test-Path -LiteralPath $dshCredFile) { @(Get-Content -LiteralPath $dshCredFile) } else { @() }
    $out = [System.Collections.Generic.List[string]]::new()
    $found = $false
    foreach ($l in $lines) {
        if ($l -match '^KIMI_API_KEY\s*:') { $out.Add("KIMI_API_KEY: $access"); $found = $true }
        else { $out.Add($l) }
    }
    if (-not $found) { $out.Add("KIMI_API_KEY: $access") }
    Write-AtomicFile -path $dshCredFile -content ($out -join [Environment]::NewLine)

    # 3) 收紧凭据文件 ACL：仅当前用户 + SYSTEM（移除 Administrators 及继承）
    foreach ($f in @($credFile, $dshCredFile)) {
        try {
            $me = "$env:USERDOMAIN\$env:USERNAME"
            icacls $f /inheritance:r /grant:r "${me}:(F)" "SYSTEM:(F)" 2>&1 | Out-Null
        } catch {
            Write-Log "WARN: could not tighten ACL on $f : $($_.Exception.Message)"
        }
    }

    Write-Log "OK: access refreshed (expires in ${expiresIn}s), credentials synced + ACL tightened"

} finally {
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
