@echo off
rem 手动立即刷新一次 Kimi token（无需管理员），双击即可运行
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kimi-token-refresh.ps1"
echo.
pause
