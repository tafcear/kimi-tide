# dsh-kimi-tide v0.1.3 — 模型选择器凭据门控

## 修复内容

### 未登录时不再向模型选择器投放模型

DSH 的模型目录（`llm.models` RPC）会丢弃"一个模型都不投放"的 provider 分组，
而此前插件无条件注册并始终列出 4 个模型——即使用户从未执行过 `kimi login`，
选择器里也会出现一个必然以 `AUTH` 失败的死分组。

v0.1.3 起，`KimiAdapter.listModels()` 会先安静探测凭据文件
（`~/.kimi-code/credentials/kimi-code.json` 或 `KIMI_CODE_HOME` 指向的路径）：

- **没有登录态**（文件不存在 / 无 refresh_token）→ 投放空列表 → 分组从模型选择器消失；
- **有登录态** → 正常列出 4 个模型（token 过期不影响列出，插件会按需自动刷新）。

探测是每次打开选择器时的一次同步小文件读取，无性能影响；登录后无需重启，
下一次打开选择器即恢复显示。

## 配合的配置清理

本次同时从 `~/.dsh/settings.yaml` 移除了旧路由 `llm-pi-ai.providers.kimi-coding`
（其 `KIMI_API_KEY` 静态凭据依赖外部计划任务刷新，已废弃）。重启 `dsh web` 后：

- 模型选择器不再出现 `kimi-coding` 分组（该路由退化为休眠的目录条目）；
- 仅保留 `Kimi Code (kimi-tide)` 一个 Kimi 入口，凭据由插件进程内维护。

## 安装

```bash
dsh plugin --profile web add ./dsh-kimi-tide-0.1.3.tgz
# 重启 dsh web 生效
```
