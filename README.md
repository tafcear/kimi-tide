# kimi-tide（月汐）

> 月亮（Moonshot / Kimi）牵引深海（DeepSeek / DSH）的潮汐。

`kimi-tide` 是一套把 **Kimi Code（Moonshot）** 接入 **DeepSeek Harness（DSH）** 的集成方案。它让 Kimi 的订阅后端 `https://api.kimi.com/coding` 以原生 LLM provider 的形式出现在 DSH 中，同时通过第三方插件 `dsh-kimi-bridge` 把 Kimi CLI 桥接为 DSH 工具，两条路径互补使用。

---

## 目录

- [架构总览](#架构总览)
- [快速开始](#快速开始)
- [组件说明](#组件说明)
- [使用方式](#使用方式)
- [能力验证结果](#能力验证结果)
- [已知限制与升级路径](#已知限制与升级路径)
- [FAQ](#faq)

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                         DeepSeek Harness (DSH)                   │
│  ┌─────────────────────┐      ┌──────────────────────────────┐  │
│  │  dsh-llm-pi-ai      │      │  dsh-kimi-bridge (plugin)    │  │
│  │  通用 LLM 适配器     │      │  Kimi CLI 工具桥接            │  │
│  └──────────┬──────────┘      └──────────────┬───────────────┘  │
│             │                                │                   │
│             ▼                                ▼                   │
│  provider: kimi-coding              call_kimi / kimi_status      │
│  model: kimi-for-coding             kimi_abort / kimi_steer      │
└──────────────────────┬───────────────────────┬──────────────────┘
                       │                       │
                       ▼                       ▼
         https://api.kimi.com/coding         kimi CLI
         Anthropic 兼容协议                   (kimi -p / -S)
                       │                       │
                       └───────────┬───────────┘
                                   ▼
                  Kimi Code OAuth access_token
                  （以 Bearer apiKey 形式注入）
```

两条接入路径：

1. **★ `dsh-kimi-tide` 插件（推荐，标准 DSH 插件）**：`packages/dsh-kimi-tide`——自带 OAuth 凭据管理与进程内定时刷新，注册原生 provider 路由 `kimi-tide`。零外部脚本、零计划任务、跨平台。
2. **LLM Provider 配置路径（旧方案，已降级为备选）**：通过 DSH 内置的 `dsh-llm-pi-ai` 适配器配置 `kimi-coding` 路由，依赖 `scripts/kimi-token-refresh.ps1` + Windows 计划任务。
3. **CLI 工具桥接路径（互补）**：`vendor/dsh-kimi-bridge` 插件把 `kimi` CLI 作为 DSH 工具，适合“第二意见”、并行编码 pass。

---

## 快速开始

### 方式 A（推荐）：安装 dsh-kimi-tide 插件

零脚本、零计划任务——OAuth 凭据管理与定时刷新全部内置在插件里：

```bash
# 1. 构建插件（或直接使用仓库中已打包的 tarball）
cd packages/dsh-kimi-tide
npm install && npm run build && npm pack

# 2. 安装到 DSH profile（自动加入 bundles）
dsh plugin --profile web add ./dsh-kimi-tide-0.1.1.tgz

# 3. 重启 dsh web，模型选择器即出现 kimi-tide 组
```

> **发布规范（重要）**：DSH 插件必须声明 `dsh.bundle.patch`（指向 `cordis.patch.yml`）
> 才能作为 profile 层加载；缺声明时 `dsh plugin add` 只会把它装成普通依赖，手动加进
> bundles 会导致 web 启动崩溃。本项目插件包已按官方规范声明（参考
> `docs/user/develop/basic/publish.md`），升级版本时请勿移除该字段。

插件与 kimi CLI 共享同一份登录态（`~/.kimi-code/credentials/`），`kimi login` 一次即可；token 每 10 分钟由插件进程内自动刷新（`refreshIntervalMs` 可配）。

### 方式 B（备选）：settings.yaml 配置 + 外部刷新脚本

> 仅当无法使用插件时（如 DSH 版本过旧）才推荐此路径。

### 1. 前置条件

- 已安装 Kimi CLI 并完成登录：`kimi login`
- 已安装 DSH（本方案在 `@deepseek-ai/dsh@0.1.0-rc.6` 验证通过）
- Windows 环境（PowerShell 脚本部分；核心配置思路同样适用于其他平台）

### 2. 配置自动刷新（Windows，仅方式 B 需要）

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

### 3. 配置 DSH Provider（仅方式 B 需要）

编辑 `~/.dsh/settings.yaml`，加入：

```yaml
llm-pi-ai:
  providers:
    kimi-coding:
      apiKeyEnv: KIMI_API_KEY
```

DSH 的 `settings.yaml` 支持热加载，保存后无需重启即可生效。

### 4. 验证配置

```bash
node scripts/validate-kimi-settings.mjs
```

预期输出类似：

```text
schema OK, providers: kimi-coding
  kimi-coding: apiKeyEnv=KIMI_API_KEY api=(catalog) baseURL=(catalog)
```

### 5. 端到端流式测试

```bash
node scripts/e2e-kimi.mjs
```

预期输出：模型元信息、流式响应文本以及 `stream ok, done = true`。

> 脚本通过 `DSH_HOME` / `os.homedir()` 自动解析 `~/.dsh` 路径，无需修改即可在其他机器上运行（依赖在项目根 `npm install` 安装）。

---

## 组件说明

### `packages/dsh-kimi-tide`（★ 插件，推荐）

标准 DSH 插件（`dsh-plugin`）：一个 Cordis 插件 = LLM 适配器 + OAuth 凭据管理。

- **注册路由** `kimi-tide`（可配 `providerName`），模型与订阅后端一致：`kimi-for-coding` / `kimi-for-coding-highspeed` / `k3`（1M 上下文）/ `k3-256k`
- **内置 OAuth 生命周期**：读取 kimi CLI 登录态 → 定时刷新（默认 10 分钟，进程内 `ctx.setInterval`）→ 写回轮换凭据（与 kimi CLI 保持单点登录）
- **符合官方插件规范**：`LlmAdapter` 实现（流协议翻译、模型元数据、reasoning 档位）、`attributionHeaders()` 应用归因、Cordis `ctx.effect` 生命周期
- **零外部依赖运行**：不需要计划任务、不需要 `.credentials.yaml` 同步、跨平台
- 验证：`node scripts/plugin-smoke.mjs`（OAuth 刷新 / 模型列表 / 文本流 / 工具调用）

### `scripts/kimi-token-refresh.ps1`（仅方式 B 使用）

OAuth access token 自动刷新脚本，由计划任务 `KimiTokenRefresh` 每 10 分钟调用一次。

主要特性：

- **双写凭据**：同时更新 Kimi CLI 凭据文件和 DSH 凭据文件。
- **响应字段校验**：`access_token`、`refresh_token`、`expires_in` 任一异常时拒绝写入，防止空值覆盖旧凭据。
- **网络 fallback**：先走系统代理，失败后自动转直连。
- **单实例锁**：通过 `%TEMP%\kimi-token-refresh.lock` 防止计划任务重叠执行。
- **refresh token 到期预警**：解析 JWT `exp` 字段，剩余 7 天内写入日志告警。
- **明确错误提示**：`invalid_grant` 时提示重新执行 `kimi login`。

日志文件：`scripts/kimi-token-refresh.log`。

### `scripts/validate-kimi-settings.mjs`

校验 `~/.dsh/settings.yaml` 中的 `llm-pi-ai` 分节是否符合 `dsh-llm-pi-ai` 的 `Config` schema，并打印已注册的 provider 明细。

### `scripts/e2e-kimi.mjs`

模拟 DSH `dsh-llm-pi-ai` 适配器路径，端到端调用 `kimi-coding` provider 的 `kimi-for-coding` 模型，验证流式响应可达。

### `scripts/kimi-capabilities.mjs`

针对 `kimi-coding` 订阅后端的能力矩阵测试，覆盖：

- 推理（thinking）
- 代码生成
- 工具调用
- 工具调用闭环（把工具结果回传后模型总结）
- 多模态图片识别（使用脚本内生成的 8×8 纯红色 PNG，无第三方依赖）

### `vendor/dsh-kimi-bridge`

第三方插件 `pandashere/dsh-kimi-bridge`，与 provider 方案互补。它将 Kimi CLI 桥接为以下 DSH 工具：

| 工具 | 作用 |
|------|------|
| `call_kimi` | 运行 `kimi -p <prompt>`，`async` / `block` 两种模式 |
| `kimi_status` | 查询当前 DSH 会话中的 Kimi 会话状态 |
| `kimi_abort` | 终止指定 Kimi 会话 |
| `kimi_steer` | 在已结束的 Kimi 会话上继续对话（`kimi -S <session_id>`） |

构建与安装：

```bash
cd vendor/dsh-kimi-bridge
npm install
npm run check
npm pack

# 在 DSH 目标 profile 中安装 tarball（版本号以 npm pack 实际产出为准，当前 0.1.1），然后重启 dsh web
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add ./dsh-kimi-bridge-0.1.1.tgz
npx @deepseek-ai/dsh@0.1.0-rc.6 web
```

> **Windows 说明（本仓库已处理）**：上游插件的 `reviewOnly` 模式用符号链接共享 Kimi 认证文件，Windows 非管理员 / 未开开发者模式时 symlink 会报 `EPERM`。本仓库的 `vendor` 副本已打补丁：symlink 失败时目录改用 junction（`mklink /J`，无需管理员）、文件改用复制。同时上游 `npm run check` 的测试也包含 symlink 用例，在同样环境下会失败——**Windows 下可直接 `npm run build && npm pack` 跳过测试**。另外 `dsh plugin add` 内部依赖 `pnpm`，需先 `npm install -g pnpm`。

卸载：

```bash
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web remove dsh-kimi-bridge
```

插件默认启用 `reviewOnly: true`，仅允许 Kimi 使用只读工具（`Read` / `ReadMediaFile` / `Grep` / `Glob`）。设置 `reviewOnly: false` 会切换到用户主目录的完整权限，需由操作员显式决策。

---

## 使用方式

### 在 DSH 中指定 Kimi 模型

配置完成后，DSH 会把 `kimi-coding` 识别为 provider。可用模型：

| 模型 ID | 说明 |
|---------|------|
| `kimi-for-coding` | Kimi K2.7 Code，默认模型，代码能力最强 |
| `kimi-for-coding-highspeed` | K2.7 Code 高速版 |
| `k3` | Kimi K3，支持 1M 上下文 |
| `k3-256k` | Kimi K3，256k 上下文版本 |

调用示例（DSH 内部请求体语义）：

```yaml
provider: kimi-coding
model: kimi-for-coding
# apiKey 由 DSH 从环境变量 KIMI_API_KEY 读取
```

### 复跑能力验证

```bash
node scripts/kimi-capabilities.mjs
```

脚本会输出每个测试项的 `stopReason`、耗时、token 用量（input / output / reasoning / cacheRead / cacheWrite）以及关键摘要。

### 安装 CLI 桥接插件

参考 [组件说明](#组件说明) 中 `vendor/dsh-kimi-bridge` 的构建与安装命令。安装后，DSH agent 即可通过 `call_kimi` 等工具调用 Kimi CLI。

---

## 能力验证结果

已通过 `scripts/kimi-capabilities.mjs` 在 `kimi-coding` 订阅后端验证：

| 能力 | 模型 | 状态 |
|------|------|------|
| 推理（thinking + 文本） | `kimi-for-coding` / `k3` | ✅ 正常 |
| 代码生成 | `kimi-for-coding` | ✅ 正常 |
| 工具调用 | `kimi-for-coding` / `k3` | ✅ 正常 |
| 工具调用闭环 | `kimi-for-coding` | ✅ 正常 |
| 多模态图片识别 | `kimi-for-coding` | ✅ 正常 |

端到端流式调用亦通过 `scripts/e2e-kimi.mjs` 验证。

---

## 已知限制与升级路径

1. **OAuth 适配限制**
   - DSH 的 `dsh-llm-pi-ai` 适配器本身不支持 OAuth，当前把 Kimi 的 OAuth access token 以 `Bearer apiKey` 形式注入，属于 workaround。
   - 升级路径：等待 DSH 原生支持 OAuth provider，或迁移到官方 ACP 子代理方案。

2. **refresh token 30 天过期**
   - 脚本会在 refresh token 剩余 7 天内写入日志告警，但无法自动续期。
   - 到期后需重新执行 `kimi login` 获取新的 refresh token。

3. **ACP 原生子代理尚未就绪**
   - 官方 `@deepseek-ai/dsh-subagent-acp` 目前还没有与 DSH `0.1.0-rc.6` 兼容的版本。
   - 一旦兼容版本发布，ACP 子代理将成为更原生的升级路径。

4. **脚本路径已可移植**
   - 所有脚本通过 `DSH_HOME` / `os.homedir()` 解析本地路径，依赖在项目根安装（`npm install`），不依赖特定用户名或 npx 缓存位置。

---

## FAQ

**Q: 为什么需要把 OAuth access token 当作 apiKey 使用？**  
A: 因为 DSH `dsh-llm-pi-ai` 适配器只支持 apiKey 鉴权。Kimi Code 的订阅后端采用 OAuth，因此用定时刷新的 access token 填充 `KIMI_API_KEY`，让适配器以 Bearer token 的形式发送出去。

**Q: 计划任务失败怎么排查？**  
A: 查看 `scripts/kimi-token-refresh.log` 中的时间戳和错误信息。常见问题：

- `credential file not found` → 未执行 `kimi login`。
- `invalid_grant` → refresh token 已失效，需重新 `kimi login`。
- 网络超时 → 检查系统代理或脚本是否成功 fallback 到直连。

**Q: 可以不装 `dsh-kimi-bridge` 吗？**  
A: 可以。provider 路径是核心方案，`dsh-kimi-bridge` 只是提供 CLI 工具桥接，用于需要显式控制 Kimi 会话或并行调用的场景。

**Q: 模型 `k3` 与 `k3-256k` 怎么选？**  
A: 需要 1M 长上下文时选 `k3`；常规任务或对上下文长度有明确 256k 上限要求时选 `k3-256k`。

**Q: 修改 `~/.dsh/settings.yaml` 后需要重启 DSH 吗？**  
A: 不需要。DSH 会热加载 `settings.yaml`，保存后即可生效。

---

## 许可证

- **kimi-tide 本体**：[MIT](LICENSE)（Copyright 2026 kimi-tide contributors）
- **第三方组件许可**（均为宽松许可，允许集成与分发）：

| 组件 | 许可 | 用途 |
|------|------|------|
| `@earendil-works/pi-ai` | MIT | 多提供方 LLM 适配库 |
| `@deepseek-ai/dsh-llm-pi-ai` 等 DSH 包 | MIT (DeepSeek) | DSH 通用适配器 |
| `js-yaml` | MIT | YAML 解析 |
| `@iarna/toml` | ISC | TOML 解析 |
| `dsh-kimi-bridge`（vendor fork） | MIT（上游，我们的 patch 同 MIT） | Kimi CLI 桥接 |

## 使用合规提示（Kimi Code 订阅）

本项目使用你的 Kimi Code 订阅凭据直连官方后端，请遵守 [Kimi Code 社区倡议](https://www.kimi.com/code/docs/kimi-code/community-guidelines.html)：

- ✅ **允许**：个人使用，在自己习惯的工具里调用 Kimi Code 能力（官方明确兼容第三方工具与 Agent 框架）
- ⚠️ **风险提示**：订阅"仅限个人交互式使用"；本方案以非官方客户端（pi-ai 适配器）+ 自动刷新令牌调用，属于条款灰色地带。个人量级使用风险低，但请勿用于高频批量调用、多账号共享或将 token 分发他人——那类行为属于倡议明令禁止的"非个人交互式使用 / 转售"，可能导致账号被限制
- ✅ **完全合规的替代路径**：需要长期、稳定的 API 集成时，使用 [Kimi 开放平台](https://platform.kimi.ai) 的 API key（见上文"可选备用路由"的 `moonshotai-cn` 配置），按量付费、条款明确允许集成到自有应用
- 本仓库**不含任何凭据**；请勿将 `~/.dsh/.credentials.yaml`、`~/.kimi-code/credentials/` 中的内容提交到任何代码仓库
