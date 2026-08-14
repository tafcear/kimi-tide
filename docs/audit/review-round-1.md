# 审查档案 · 第一轮（初审）

> 审查者：Kimi（kimi-for-coding，via dsh-kimi-bridge `call_kimi`）
> 会话：kimi-49604187（2026-08-15）
> 范围：kimi-tide 项目初版（scripts/ 4 个脚本 + vendor/dsh-kimi-bridge/src/review-home.ts + README.md）
> 结论：早期 beta / 本机可用，未达团队投产标准。
> 完整原文见会话记录；本文件为问题清单归档。

## 严重（3 项）

| # | 位置 | 问题 | 修复后状态 |
|---|------|------|-----------|
| 1 | review-home.ts / kimi-manager.ts | Windows copy fallback 导致 auth 文件陈旧（buildReviewHome 只在构造时调用一次） | ✅ spawn 前刷新 + mtime/size 比较 |
| 2 | 3 个 .mjs | 硬编码 C:/Users/tafce 与 npx 缓存哈希路径，不可移植 | ✅ os.homedir()/DSH_HOME + 本地依赖 |
| 3 | review-home.ts | process.env.HOME 在 Windows 未定义 → 错误回落 cwd() | ✅ os.homedir() |

## 中等（8 项）

| # | 位置 | 问题 | 修复后状态 |
|---|------|------|-----------|
| 4 | kimi-token-refresh.ps1 | 锁非原子 + 无 stale 检测（崩溃永久静默跳过） | ✅ New-Item 独占 + stale 自愈 |
| 5 | kimi-token-refresh.ps1 | 凭据原地覆写（中途崩溃可能损坏） | ✅ tmp + Move-Item 原子写 |
| 6 | kimi-token-refresh.ps1 | YAML 正则行匹配 | ✅ 保持（简单格式，评估可接受） |
| 7 | kimi-capabilities.mjs | 工具闭环丢失真实 tool call id | ✅ 保留 id 回传 |
| 8 | e2e/capabilities | streamSimple 无 try/catch | ✅ 包 try/catch |
| 9 | review-home.ts | mklink /J 无 EEXIST 竞态处理 | ✅ existsSync 幂等 |
| 10 | review-home.ts | [tools] TOML 正则 hack | ✅ @iarna/toml 真解析 |
| 11 | kimi-token-refresh.ps1 | ConvertTo-Json 缺 -Depth | ✅ -Depth 10 |

## 轻微（12 项）

| # | 位置 | 问题 | 修复后状态 |
|---|------|------|-----------|
| 12 | refresh.ps1 | token 长度 <100 启发式 | ✅ JWT 三段结构校验 |
| 13 | refresh.ps1 | invalid_grant 靠 message 正则 | ✅ 响应体优先 |
| 14 | refresh.ps1 | 日志不轮转 | ✅ 1MB 归档 |
| 15 | validate.mjs | 读取无 try/catch | ✅ 加 |
| 16 | capabilities.mjs | ev.delta 可能 undefined | ✅ ?? '' |
| 17 | e2e/capabilities | .credentials.yaml 正则解析 | ✅ js-yaml |
| 18 | review-home.ts | 写回无 TOML 校验 | ✅ fail-loud |
| 19 | review-home.test.ts | 未覆盖 win32 fallback | ✅ 新增 review-home-win.test.ts |
| 20 | review-home.ts | AUTH_FILES 硬编码 | ✅ 注释文档化（fail-safe 设计） |
| 21 | refresh.ps1 | 凭据 ACL 过宽 | ✅ icacls 收紧 |
| 22 | README | 计划任务路径缺引号 | ✅ 补引号 |
| 23 | refresh.ps1 | 未设 $ProgressPreference | ✅ SilentlyContinue |
