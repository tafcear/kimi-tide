# Upstream report draft: k3 encrypted-reasoning signature 400 after long tool rounds (rc.8)

> 状态：待用户手动发至 deepseek-ai/deepseek-harness GitHub Discussions（官方反馈渠道；Issues 已关闭）。
> 起草：2026-08-20，DSH（kimi-tide 项目）；双会话复现。

## 标题建议

`dsh-llm-pi-ai (rc.8): k3 multi-step tool turns fail with 400 "malformed encrypted reasoning content: invalid base64url encoding"`

## 正文

**环境**
- DSH v0.1.0-rc.8（npm next tag，2026-08-19 发布）；Node v24.19.0；Windows
- kimi-coding/k3 经 `@deepseek-ai/dsh-llm-pi-ai` 0.1.0-rc.8 + `@earendil-works/pi-ai` 接入（Anthropic 协议）
- k3 目录声明 `forceAdaptiveThinking: true`、`compat.allowEmptySignature: true`

**现象**
子代理任务（同一 turn 内连续多轮工具调用）在第 6–9 步时，下一步 LLM 请求被服务端拒绝：

```
400 {"error":{"type":"invalid_request_error","message":"messages.3.content.0.signature: malformed encrypted reasoning content: invalid base64url encoding"},"type":"error"}
```

turn 以 error 结束，子代理运行终止。同型失败连续复现两次（两个独立子代理会话）；单步对话（无工具轮）不受影响。

**源码锚点（rc.8）**
- 回传链存在且原样回传签名：`packages/llm/llm-pi-ai/src/index.ts` 的 `replayedAssistant`——reasoning 块转 `thinking` 块时携带 `thinkingSignature`（编译产物 lib/index.js L190-194）。
- 签名校验只查字符串类型、不查 base64url 合法性（lib/index.js L119-126）。
- 设计逃生口「replay state 不可用 → 降级为 provider-neutral history」不触发（lib/index.js L221-224）——坏签名通得过校验。
- 会话日志中 replayState 可见的 thinkingSignature 含 `+` `/` 字符（标准 base64 特征），疑为 pi-ai 流处理层对签名做了 base64 重编码，回传时已非 base64url。

**与 rc.8 发布说明的关系**
rc.8 修复了「推理内容回传可能缺失」；本问题似为其**损坏变体**（缺失修复未覆盖）。

**建议方向**
1. 签名校验补 base64url 合法性检查，非法签名走「降级为中性历史」逃生口（让 thinking 转文本回放），而不是上送坏签名。
2. 定位 pi-ai 流处理层是否对 thinkingSignature 做了重编码（base64 ↔ base64url），如有则修复保真。

**附（复现与排查材料）**
- 两次失败会话日志解码摘录（request/header=kimi-coding/k3、step 序列、turn/end error 原文）
- 官方错误参考对应条目：kimi.com/code/docs/kimi-code/error-reference.html「思维链字段缺失」类（thinking 模式 reasoning 内容必须回传）
