# dsh-kimi-tide v0.1.2 — 凭据写入并发与 home 解析修复

## 修复内容

### 1. `KIMI_CODE_HOME` 之前根本没被读取（文档与实现不符）

`cordis.patch.yml` 与 README 都声明 `kimiHome: ''` 会回退到 `KIMI_CODE_HOME` → `~/.kimi-code`，
但 `oauth.ts` 实际只写了 `options.home || ~/.kimi-code`，环境变量被完全忽略。

现在解析顺序为：配置 `kimiHome` → 环境变量 `KIMI_CODE_HOME` → `~/.kimi-code`。
`kimi-token-refresh.ps1` 同步改为尊重 `KIMI_CODE_HOME`。

### 2. 凭据双写者竞争（refresh token 轮换互踩）

插件（进程内每 10 分钟）与旧方案脚本（计划任务）都会刷新并回写
`~/.kimi-code/credentials/kimi-code.json`，而 Kimi 的 refresh token 每次授权都会轮换。
两者并发时，后写者可能拿一个已被作废的 refresh token，最终被迫重新 `kimi login`。

v0.1.2 引入**共享锁** `<kimi-home>/credentials/kimi-code.json.lock`：

- 插件 `oauth.ts` 刷新前用原子 `openSync(..., 'wx')` 独占创建锁文件，
  5 分钟 stale 检测回收崩溃残留，刷新完成 `finally` 释放；
- `kimi-token-refresh.ps1` 改用同一把锁（原先用 `%TEMP%` 下的私有锁，与插件不互斥）；
- 凭据文件写入改为原子写（同目录临时文件 + `rename`），杜绝半截文件。

### 3. 构建与打包修正

- `src/router.ts`（0.2.0 路由器草稿，未接入）引用了未声明的 `@deepseek-ai/dsh-agent`，
  导致 `npm run build` 失败；已在 `tsconfig.json` 中 exclude，并从 `lib/` 与 tarball
  中清除了过期的 `router.js`/`router.d.ts` 编译产物。

### 已知残留风险（本项目无法消除）

kimi CLI 自身的按需刷新不参与加锁，与插件/脚本存在极小的并发窗口。
由于 CLI 只在显式调用 kimi 工具时刷新，实践中几乎不会与定时器撞车；
若遇到 `invalid_grant`，重新 `kimi login` 即可恢复。

## 安装

```bash
# 下载 Release 中的 dsh-kimi-tide-0.1.2.tgz
dsh plugin --profile web add ./dsh-kimi-tide-0.1.2.tgz
# 重启 dsh web 生效
```
