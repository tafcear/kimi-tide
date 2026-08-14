# dsh-kimi-bridge

[English](README.md) | 中文

面向 DeepSeek Harness（dsh）的双面（宿主 + 浏览器）插件：把 Kimi CLI（kimi-code）桥接进 harness——`dsh-codex-bridge` 的 Kimi 对偶，同一套架构。

## 为什么需要它

dsh agent 经常想找外部编码 agent（Moonshot Kimi）要一个第二意见或并行编码一遍。手动做这件事——spawn `kimi -p`、抓流、轮询、把输出接回来——正是 harness 插件存在的意义。本插件让 Kimi 成为 dsh 的一等公民：

1. **把 Kimi 当工具调用** — `call_kimi` 在会话工作目录运行 `kimi -p <prompt> --output-format stream-json`，支持 `async`（立即返回；多次调用并行）与 `block`（等待最终答案）两种模式，另有 `kimi_status` 轮询、`kimi_abort` 取消。
2. **同一会话续跑** — `kimi_steer` 用新消息恢复已 settle 的 Kimi 会话（`kimi -S <session_id> -p …`）。Kimi 会话**绑定工作目录**——插件把 cwd 锁定到会话工作目录，同 dsh session 内 resume 天然成立。会话是线性的：父必须是该会话最新记录，且同一会话只允许一个进行中的延续。
3. **展示整个 agent loop** — 会话 pane 里的 Kimi 标签（与 Chat/Trajectory/Codex 平级）实时观察每个会话：状态、提示词、**Agent Loop waterfall**（消息、带参数的工具行、可折叠的工具输出、回合分隔）、transcript 与最终回答——经 session projection 通道推送。

**定位：UX 通道，不是安全边界——而且 `kimi -p` 内部就是 `permission:"auto"`，没有 CLI sandbox flag。** 默认 `reviewOnly` 模式因此让 Kimi 跑在一个托管 home 下，其 `[tools]` 白名单只读（`Read`/`ReadMediaFile`/`Grep`/`Glob`；无 Bash/Write/Edit/MCP），执行前再次强制。设 `reviewOnly: false` 才用用户不受限的 home——显式运维选择，绝不称之为 sandbox。`allowedAgents`/`maxParallel`/`maxSessionsPerSession` 约束资源放大；有限的 `defaultTimeoutMs` 约束 Kimi print 模式（否则后台任务可等约 25 天）。

## 安装

前置条件：Node.js 22 或更高版本、`@deepseek-ai/dsh@0.1.0-rc.6`，以及已完成认证且可通过 `kimi` 调用的 Kimi CLI（也可配置 `kimiPath`）。插件不会把凭据复制进仓库或 dsh telemetry；`reviewOnly` 模式只把 CLI 现有认证文件链接进托管 home，凭据仍由 Kimi CLI 管理。

在插件目录内构建、校验并打包独立 bundle：

```bash
npm install
npm run check
npm pack
```

把生成的 tarball 安装进 DSH profile，然后重启 `dsh web`。不要把源码目录作为 link 安装，因为宿主 peer 依赖由 DSH profile 提供：

```bash
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add ./dsh-kimi-bridge-0.1.0.tgz
npx @deepseek-ai/dsh@0.1.0-rc.6 web
```

浏览器端由 `/plugins/dsh-kimi-bridge/client.js` 提供，并显示在会话 pane 中。对运行中的默认 Web profile 验证：

```bash
curl -s http://127.0.0.1:3080/plugins/dsh-kimi-bridge/client.js | head
```

更新时先提高 package 版本并重新打包，再移除旧 bundle、添加新 tarball 并重启。卸载命令：

```bash
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web remove dsh-kimi-bridge
```

## 配置

| Key | 默认 | 含义 |
|-----|------|------|
| `kimiPath` | `kimi` | kimi 可执行文件（绝对路径或 PATH 查找） |
| `reviewOnly` | `true` | 在托管 home 下运行 kimi，其 `[tools]` 白名单只读 |
| `kimiHome` | `''` | 携带配置/登录态的源 Kimi home（`''` = `KIMI_CODE_HOME`，否则 `~/.kimi-code`） |
| `reviewHomeDir` | `''` | 托管 review home（`''` = `$DSH_HOME/kimi-review-home`） |
| `maxTimeoutMs` | `1800000` | 任何会话超时的硬上限（30 分钟） |
| `defaultTimeoutMs` | `600000` | 每个 kimi 会话的默认生命周期（10 分钟） |
| `maxParallel` | `3` | 并发 kimi 进程的全局上限 |
| `maxSessionsPerSession` | `8` | 每个 dsh session 的活跃 kimi 会话上限 |
| `maxRetained` | `16` | 每个 dsh session 保留的（已 settle）记录数（淘汰最旧） |
| `maxPromptChars` | `16384` | 提示词长度上限（argv prompt；拒绝 NUL；超长拒绝） |
| `maxTranscriptChars` | `16384` | 记录进事件/投影的 transcript 上限 |
| `maxLoopSteps` | `32` | agent loop 有界窗口（记录/投影中保留的步数） |
| `maxLoopBytes` | `16384` | loop 窗口的序列化字节上限（UTF-8；淘汰最旧已完成步） |
| `allowedAgents` | `roots` | 谁可调用 `call_kimi`：`roots` \| `all` |
| `killGraceMs` | `10000` | abort 时 SIGTERM → SIGKILL 宽限（kimi headless 清理最长 8 秒） |

## 工具

- **`call_kimi`** — `{ prompt, mode?: async|block, model?, timeout_ms?, kimi_session_id? }`。`async` 立即返回（并行）；`block` 等待答案（带 `kimi_session_id` 时等待此前启动的会话）。被取消的阻塞等待会中止该 kimi 会话。
- **`kimi_status`** — 列出当前 session 的 kimi 会话（状态、提示词摘要、进度）。
- **`kimi_abort`** — `{ kimi_session_id }`；对进程组 SIGTERM，`killGraceMs` 后 SIGKILL。
- **`kimi_steer`** — `{ kimi_session_id, prompt, mode?: async|block, model?, timeout_ms? }`。继续已 settle 的父会话（`kimi -S <session_id> -p …`；必须同目录，插件保证）；新记录经 `parent` 链接并继承父模型。宿主重启后的父记录只要带有 kimi session id 也能 steer。

## 模型体验（UI）

Kimi 标签（会话 pane，Codex 之后）：

- **左列** — 当前 dsh session 的每个 kimi 会话：状态点、提示词摘要、相对时间。点击选择。
- **右列** — 状态徽标、元信息（id/kimiId/cwd/model/耗时/退出码/错误）、提示词，以及 **Activity | Text** 切换：
  - **Activity** — Agent Loop waterfall：消息、工具行（工具名、running/done/failed、耗时、退出码、`truncated` 标记；失败自动展开输出）、回合分隔、窗口淘汰时显示「此前 N 步未保留」。
  - **Text** — 流式 transcript 与最终回答。

状态变化走 session projection 通道（`kimi/session` 事件、`kimi/sessions` 投影），标签页实时更新并可从历史重放恢复（刷新页面不丢）。

## 已知限制与后续工作

- **一次调用一次运行，之后靠延续。** `call_kimi` 每次运行新的 `kimi -p`；运行中实时 steer CLI 不支持（kimi-code 的 thinking 也不写入 `stream-json`，标签页不从 stderr 猜测推理）。
- **loop 窗口是「最近活动」而非审计轨迹。** 旧步骤在 `maxLoopSteps`/`maxLoopBytes` 下物理淘汰；dsh 会话日志仍保留 whole-value 快照，但标签页只展示保留窗口。
- **`reviewOnly` 是工具白名单，不是 sandbox。** 由 kimi `[tools]` 开关在执行前强制；真正的 sandbox 化 `workspace-write` 需要 OS 级隔离（容器/namespace）。
- **仅 POSIX 进程组。** abort 使用 `detached` + 负 pid `kill`；Windows 移植需要 Job Object / `taskkill /T` 整树终止。
- **telemetry 脱敏只覆盖 dsh 导出。** Kimi 自身 telemetry 通过子进程 `KIMI_DISABLE_TELEMETRY=1` 关闭。

## 开发

```bash
npm run check    # typecheck + 测试 + compliance
npm run build    # 宿主（tsc）+ 客户端 bundle（esbuild，__ModuleLoader__ ABI）
```

客户端 bundle 遵循 harness 的 `__ModuleLoader__.load({id, factory})` 协议，以平台模块表为 externals；宿主半遵循 `create-dsh-plugin` 的 bundle 格式。

## License

MIT
