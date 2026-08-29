# Upstream report draft: pi-ai adapter ignores purpose=session-title; title aux requests to thinking models blow the 60s deadline and surface as server-side 499 (rc.2)

> 状态：待用户手动发至 deepseek-ai/deepseek-harness GitHub Discussions（官方反馈渠道；Issues 已关闭）。可与《k3 encrypted-reasoning signature 400》上报稿分帖或同帖附注。
> 起草：2026-08-28，DSH（kimi-tide 项目）；7 天本机会话日志取证 + 宿主源码锚点。

## 标题建议

`dsh-llm-pi-ai (rc.2): session-title aux requests to thinking models (k3) hit SESSION_TITLE_TIMEOUT and are aborted mid-stream — Kimi backend logs HTTP 499`

## 正文

**环境**
- DSH v0.1.1-rc.2（npm）；Node v24.19.0；Windows
- kimi-coding/k3 经 `@deepseek-ai/dsh-llm-pi-ai` + `@earendil-works/pi-ai` 接入（Anthropic 协议）
- 会话标题：`@deepseek-ai/dsh-session-title-first-prompt-llm`（dsh-base 内置组合，`timeoutMs: 60000`、`maxOutputTokens: 64`、未配置 provider/model → 路由跟随主请求 `request.route`）

**现象**
每个新会话创建时，标题辅助请求携带 `purpose: "session-title"` 派发。当会话主路由为思考模型（kimi-coding/k3）时，标题请求同样打到 k3，且 pi-ai 适配器不禁思考：k3 思考流轻松超过 60s `SESSION_TITLE_TIMEOUT`（`deadline(request.signal, config.timeoutMs, ...)` 的 signal 直接挂在 `ctx.llm.stream` 上），截止触发即 abort 流 → 客户端断连 → **Kimi Code 后台记录 HTTP 499（client closed connection）**。用户侧仅表现为标题回退（首条消息兜底），失败被静默吞掉，因此观感是「Kimi 后台经常出现 499 但客户端没有任何报错」。

7 天本机会话日志取证（150 会话全量解码）：

| 标题请求路由 | 成功 | 失败 | 备注 |
|---|---|---|---|
| kimi-coding/k3 | 4 | **11** | 成功者全部 2.8–4.3s 秒回；失败者无任何 provider 标题帧（静默） |
| deepseek-official（v4-pro/flash） | 15 | 2 | 成功 1s 级；2 次失败恰为 deepseek 配额耗尽日（429，完整响应非 499） |
| zai-coding-cn / qwen-token-plan-cn | 9 | 0 | 非思考/快模型 |

**源码锚点（rc.2）**
- 截止信号挂流：`@deepseek-ai/dsh-session-title-llm/lib/index.js` — `deadline(request.signal, config.timeoutMs, SESSION_TITLE_TIMEOUT_CODE)` → `options.signal = callDeadline.signal` → `ctx.llm.stream(options)`（L207/L216/L228）。
- DeepSeek 适配器有 purpose 映射：`@deepseek-ai/dsh-llm-deepseek/lib/index.js` L31 — `if (options.purpose === "session-title") return { thinking: "disabled" };`（README 明说「有界输出保留给可见标题文本」）。
- **pi-ai 适配器无 purpose 处理**：`@deepseek-ai/dsh-llm-pi-ai/lib/index.js` 全文 grep `purpose` / `session-title` 零命中——`dsh-session-title-llm` README 所述「other adapters own their purpose-specific behavior」在 pi-ai 侧落空。
- 附带同族机制：`dsh-llm-pi-ai/lib/index.js` L1767 `LLM_STREAM_IDLE_TIMEOUT`（300s）对 k3 挂起同样以客户端 abort 收场（7 天实锤 1 例）。

**影响**
- 功能面无害（标题回退兜底），但每个 kimi 路由会话产生：①Kimi 后台脏 499 记录 ②被 abort 的思考 tokens 计费浪费 ③用户误判服务端故障。
- 行为性补充：用户中断 k3 长思考回合（aborted turn）同样产生 499，属正常交互语义；但「标题请求必然超时」是系统性来源，占比最高（7 天 11 次 vs 中断 13 轮跨全部 cwd）。

**建议方向**
1. **镜像 DeepSeek 的 purpose 映射**：pi-ai（anthropic-messages）对 `purpose === "session-title"` 禁思考/收窄思考预算（kimi API 侧对应 thinking 参数关闭），使 64-token 输出预算全部用于标题文本——与 `dsh-session-title-llm` README 的描述对齐。
2. 或在 `session-title-llm` 侧加护栏：解析到的 route 命中思考模型时告警/自动改道快模型（需暴露「模型是否思考型」的目录判定）。
3. 文档面：在 `dsh-session-title-llm` README 明示「未实现 purpose 映射的适配器 + 思考模型组合必然超时回退」，避免用户侧误判。

**本机规避（已验证可行，供其他用户参考）**
用户 profile `cordis.patch.yml` 顶层行整值覆盖 `session-title-llm` config（5 个数值字段保持原值 + 显式 `provider/model` 指向非思考快模型）→ 标题请求不再跟随主路由，499 消失。重启宿主后可经新会话日志 `session/title-llm-request` 帧的 `route` 字段验证。

**附（取证材料）**
- 7 天标题请求时间线全表（42 条：发出时刻 / route / 下一帧间隔 / 结局帧），及 kimi 11 次静默失败会话 ID 清单。
- 对照证据：同一时段 kimi 主链请求 `request/header`（`reasoningEffort: max`）与 reasoning-chunks 流帧，证明 k3 思考流在主链正常工作的同会话内仍撑爆标题截止。
