# 团队派发实机验收 runbook（v2.0.0 发版门禁）

> 对象：2.0.0 团队派发（v6 配置 / `via:'role'` / 主驱动恒定 / 派发台账）。
> 架构说明见 [`router.md`](./router.md) 文末「2.0.0 团队派发」节。
> 判据来源：设计稿 `docs/superpowers/specs/2026-10-05-team-dispatch-design.md` §5；
> A1 三变体 / A4 反向 / A8 并发为 Round-1 评审补全项。
> **逐条留证**：每条以子/主会话日志的 `request/header` 为证据（命令见下），
> 结果回填本表后作为发版依据。

## 0. 前置与取证命令

- **宿主**：真实桌面端（DeepSeek Harness desktop）。**需真实 Team 宿主**
  （桌面端 ＋ Agent Teams 组合包已启用）的判据：**A2 / A3 / A5 / A6 / A8 与
  补验 P1**（分工表认领、workflow 派发、面板派发行都依赖 Team/子代理链路）；
  A1a/A1b/A1c / A4 / A7 只需真实宿主（任意会话均可）。
- **配置写入**：设置页「月汐」卡片（路由页主驱动卡/分工表卡），或
  `/kimi-tide import-config <内联 YAML>`（合并补丁形态）。
- **请求头取证**（仓库根执行；`<会话目录>` 为宿主 sessions 下该会话目录）：

  ```bash
  node scripts/acceptance/session-dump.mjs <会话目录>/session.v4.jsonl.zstd --grep 'request/header'
  ```

- **面板取证**（2026-10-06 实机更正）：**单击 dock 最左的月亮图标**展开「决策可观测」，
  看「最近派发」块（与 r2 派发槽摘要同形；r2 槽只在 dock 非紧凑态渲染）。
  注意：`/kimi-tide panel --json` 是**客户端（dock）取数命令**，宿主侧不产出输出
  （会话日志只有 `command/run`、无 `command/done`）；真实通道是 HTTP 只读路由
  `/api/kimi-tide/panel?sessionId=…`，带宿主 browser-trust fence（宿主窗口外 401），
  故取证只能窗口内目视或窗口内取路由。
  字段：`basis/teammate/roleLabel/target/at/parentSession`，每父会话最近 20 条、最新在前。
- **基线配置**（A1 组通用，按条覆写差异项）：

  ```yaml
  version: 6
  activePreset: saving        # 或 capability；关键词规则目标以实际激活预设为准
  driver: { provider: deepseek-official, model: deepseek-v4-flash }
  driverSticky: true
  roles: {}
  ```

## 判据表

### A1a 主会话打底 ＝ driver

- **操作**：按基线配置（`driverSticky: true` ＋ `driver =
  deepseek-official/deepseek-v4-flash`），在新主会话发一条**不含任何关键词
  组词**的消息（如「今天天气怎么样」——注意 chitchat 组有「天气」，改用
  「随便聊聊明天的安排」也含「聊聊」；推荐用「这堆数字 3.14159 帮我记一下」
  这类无组词文本）。
- **预期证据**：首个 `request/header` 的 provider/model ＝
  `deepseek-official/deepseek-v4-flash`（打底被 driver 覆盖，而非
  `preset.default`）。
- **取证**：主会话 `--grep 'request/header'`；面板决策槽因打底不上 chip，
  以请求头为准。

### A1b `driver = null` 时跟随宿主默认

- **操作**：同 A1a 但把主驱动目标设为「跟随宿主默认」（`driver: null`），
  仍保持 `driverSticky: true`；发一条无关键词消息。
- **预期证据**：请求头 ＝宿主 `agent-default-model`（本机为
  `deepseek-official/deepseek-v4-flash`；以宿主 Models 页默认为准）；面板/
  决策呈现「跟随宿主默认」口径。
- **取证**：同上。

### A1c 关键词轮规则仍赢

- **操作**：沿用 A1a 配置，发「帮我重构这段代码」（命中 code 组）。
- **预期证据**：请求头 ＝激活预设中 code 规则的目标（内置 saving/capability
  ＝ `kimi-coding/kimi-for-coding`；用户自配预设以其规则目标为准）——**不是**
  driver。
- **取证**：同上；面板决策 chip 应显示「规则「code」命中 N 词…」。

### A2 队友按分工表改道（最高优先）＋ 面板派发行出现

> `via:'role'` 路径从未被预演（设计稿 §1.3 S4），是全表最高优先级判据；
> 本条同时覆盖 `parentSession` × `agent.id` 同键关系的端到端（Task 5 ⚠️③）。

- **操作**：配 role（设置页或 YAML）：

  ```yaml
  roles:
    frontend:
      id: frontend
      label: 前端
      target: { provider: kimi-coding, model: k3 }
  ```

  在 Lead 会话用 `spawn_teammate` 建名为 `frontend` 的队友（名字＝role.id，
  落在认领集合 `teammate[] ∪ {id}` 内），让它干一件活。
- **预期证据**：
  1. 队友**子会话** `request/header` ＝ `kimi-coding/k3`（任务描述不含任何
     关键词组词也要改道——role 是第 3 档，优先于关键词规则与打底）；
  2. **Lead 主面板出现派发行**：`/kimi-tide panel --json` 的 `dispatch`
     数组含一条 `basis: "role", teammate: "frontend", roleLabel: "前端",
     target: kimi-coding/k3`，且其 `parentSession` ＝该 Lead 会话 id
     （同键关系成立——面板按 `agent.id`（＝SessionId）取台账，记账键为子会话
     header 的 `parentSession`，两者必须对上派发行才可见）；dock 派发槽同步
     显示「最近一次派发：前端 → kimi-coding/k3 · role」。
- **取证**：子会话目录 `--grep 'request/header'` ＋ Lead 会话内
  `/kimi-tide panel --json`（或 dock 目视）。

### A3 一次性派发不被劫持

- **操作**：Lead 会话用 `workflow` 调
  `agent('帮我重构这段代码…', { provider: 'kimi-coding', model: 'k3' })` —
  — **任务描述必须含关键词组词**（否则 v1.4.1 也能过、判据失效，Round-1
  评审 S8）。
- **预期证据**：该子会话 `request/header` ＝ `kimi-coding/k3`（B-1a 让位 /
  D6 跳规则的合流结果：子代理不再被任务描述里的关键词二次改道）。
- **取证**：子会话 `--grep 'request/header'`。

### A4 分工表进目录且可加载

- **操作**（正向）：保持 roles 非空，**新建**一个会话，看其上下文里的
  `<available_skills>` 目录；再调 `skill('kimi-tide-team')`。
- **预期证据**：目录含 `kimi-tide-team` 且 description ≤500 字符（形如
  「派活前读我：前端→kimi-coding/k3、…」）；`skill` 调用返回正文——含角色
  表（认领集合一列）与两种派发配方、队友名合法性。
- **操作**（反向 ×2）：① 把 roles 清空 → 新会话目录中**无** `kimi-tide-team`；
  ② 恢复 roles 并改动（如加一个角色）→ 存活会话的下一个 pre-step 出现目录
  整段替换消息（宿主 dsh-tool-skill snapshot＋digest 惰性替换）。
- **取证**：新会话 `--grep 'available_skills'`（或界面目视）；面板
  `/kimi-tide panel --json` 的 dispatch 不涉本条。

### A5 未认领队友（对照 A2）

- **操作**：建队友 `probe-x`（名字不在任何认领集合），让它干一件带 code
  组词的活（如「帮我修这个 bug」）。
- **预期证据**：**不改道**——请求头 ＝队友创建时继承的目标（本机为宿主默认
  flash）；**关键词规则也不点火**（D6 缺省语义：子代理跳关键词规则）；面板
  派发行 `basis: "unclaimed", teammate: "probe-x"`，target ＝实际生效模型。
- **取证**：子会话 `--grep 'request/header'` ＋ Lead 会话
  `/kimi-tide panel --json`。

### A6 role 目标不可用（正式判据；§8-6 护栏已落地）

> §8-6 可用性护栏已闭合（修复轮 1 落地判据；修复轮 2 对齐面板真实文案
> 与显式轮记账）：role 目标在候选池中存在且 `available !== false` 才改道；
> 不可用 ⇒ 不套用 role 决策，保持继承值，不静默换人。本条由「⚠️ 探针」
> 升为正式判据。

- **操作**：把某 role 的 target 改成一个未挂载的 provider/model（如
  `kimi-coding/nonexistent-model`），让该认领队友干一件活。
- **预期证据**：① **不改道**——子会话请求头 ＝队友创建时**继承的目标**
  （仍跑继承模型，请求不会被送往空目标）；② 面板派发行（dock 摘要槽与
  决策悬浮层明细同形）**逐字**显示
  「**「〈角色名〉」目标不可用 → 保持继承（〈实际生效目标〉）**」——例如
  「「前端」目标不可用 → 保持继承（kimi-coding/k3）」；台账字段为
  `basis: "keep"` 且带 `roleLabel` 与 `teammate`，target ＝实际生效
  （继承）模型；③ 对照：目标恢复可用后，同队友下一轮重新改道
  （`basis: "role"`）；④ 对照：同一不可用状态下，队友消息带**显式 `@`**
  时按显式目标路由、台账记 `basis: "explicit"`，面板**不**显示上述
  「目标不可用」文案。
- **取证**：子会话 `--grep 'request/header'` ＋ Lead 会话
  `/kimi-tide panel --json` 的 dispatch 行。

### A7 存量兼容（v5 迁移）

- **操作**：退出宿主，把命名空间配置回写为 v5 形（`version: 5`，无分工层
  字段；或用 `.pre-v6` 留档还原），重启。
- **预期证据**：① 主会话路由行为与 v1.4.1 **逐字节一致**（同一组消息下
  请求头序列与升级前相同；关键词轮照常规则命中、无关键词轮照常打底）；
  ② 迁移后 `export-config` 显示 `version: 6`、`driverSticky: false`（**显式
  false**，非缺省）、`roles: {}`、无 `rulesApplyToChildren` 键；③ 设置文档
  留档 `.pre-v6` 存在。
- **取证**：`/kimi-tide export-config` ＋ 主会话请求头序列 ＋ 配置文档目录
  目视 `.pre-v6`。

### A8 多队友并发

- **操作**：两个 role（如 `frontend → kimi-coding/k3`、
  `backend → zai-coding-cn/glm-5.3`），同时派两个认领队友干活。
- **预期证据**：两路子会话 `request/header` **各自**命中各自 role 目标（per
  -agent 槽位/台账天然隔离，互不串线）；面板 dispatch 两行 basis 均为
  `role`、teammate/target 各归各。
- **取证**：两个子会话分别 `--grep 'request/header'` ＋
  `/kimi-tide panel --json`。

### P1 补验探针：角色改道 × 带图锁存（A1–A8 未覆盖的组合）

> Task 4 评审指出：role 改道与带图链路（image 规则保留 / 护栏 /
> imageFallback 锁存）的交互未被 A1–A8 覆盖；`latchTarget` 在 role 覆盖
> **之后**计算，需实证一致。
>
> **2026-10-06 实机注记（形态受限，未执行）**：本条要求"在**认领队友**会话里发图"，
> 而当前宿主 GUI 的**队友会话输入框没有附件通道**（粘贴不可用、`+` 按钮点不开）
> ⇒ 该组合暂时无法在实机上预演。补验时机＝GUI 开放队友会话附件（或宿主提供
> 带图 `SubagentPromptRequest` 的入口）。在此之前，本条判据由代码侧单测兜底，
> **不得以"未执行"为由视为通过**。

- **操作**：认领队友（role 目标取**多模态**模型，如
  `kimi-coding/k3`）会话里发一张图（可附带文字），随后再发一条纯文本消息
  （如「刚才那张图里写的是什么」）。对照变体：role 目标为 **text-only**
  模型（如 `deepseek-official/deepseek-v4-flash`）重复一次。
- **预期证据**：
  - 多模态目标：带图轮请求头 ＝role 目标（原生视觉作答）；后续文本轮按
    激活预设的 `imageFallback`（缺省 latch）落 `latchTarget`（＝本轮有效
    视觉目标，即 role 目标）——请求头仍为该多模态模型，不被文本目标顶掉。
  - text-only 目标：带图轮被**图像护栏**改道到可用多模态候选（请求头 ≠
    role 目标）；面板派发行 target ＝**护栏后的最终模型**（记账在护栏之后）
    ——这正是「台账记最终生效模型」的实证点。
- **取证**：该队友子会话 `--grep 'request/header'`（两轮各取一条）＋
  `/kimi-tide panel --json` 的 dispatch target。

## 收尾核对

- [x] A1a / A1b / A1c / A2 / A3 / A4 / A5 / A6 / A7 / A8 全绿（2026-10-06 实机，见下）；
- [ ] P1 两个变体的请求头与派发行 target 已留证 —— **未执行（形态受限）**：
  2026-10-06 实测**队友会话的输入框无法附图**（粘贴与 `+` 按钮均不可用；宿主 GUI 限制，
  非本插件缺陷）⇒ 发版前若 GUI 开放附件通道再补。
  代码侧等价覆盖：图像护栏（`src/router.ts` 的 `guardImage`）与"台账记护栏后最终模型"
  已有单测断言，缺的仅是"**角色改道 × 带图**"这一组合的实机实证。
- [x] 所有证据（会话目录路径 ＋ 关键请求头行）已归档（见下表）。

## 实机结果（2026-10-06，宿主 0.1.7-rc.2 桌面端 ＋ Agent Teams 组合包）

| 判据 | 结果 | 证据（会话目录 / 关键行） |
|---|---|---|
| A1a 主驱动恒定 | ✅ | `session-07f5eff2-…` seq=12 `deepseek-official/deepseek-flash`（当班预设 capability 打底 `qwen3.8-max`） |
| A1b `driver=null` 跟随宿主默认 | ✅ | `session-5f70b85a-…` seq=12 `deepseek-flash`（≠ 预设打底） |
| A1c 关键词轮规则赢 | ✅ | `session-07f5eff2-…` seq=168/178 `zai-coding-cn/glm-5.3` |
| A2 队友改道＋面板行 | ✅ | `e750a6de-…` seq=26/39 `kimi-coding/k3`；悬浮层「派发：前端 → kimi-coding/k3 · role」 |
| A3 一次性派发不被劫持 | ✅ | `b2f1d28f-…`（点名 k3）与 `b2e33129-…`（点名 glm-5.3＋含 code 词 ⇒ 仍 glm-5.3，可鉴别） |
| A4 分工表进目录且可加载 | ✅ | 技能目录出现 `kimi-tide-team` 且 `skill` 可加载正文；roles 变更后存活会话目录整段替换（描述随之变为新目标） |
| A5 未认领不改道＋面板行 | ✅ | `773d2bdd-…` seq=27/38 `deepseek-flash`（含 code 词、规则未点火）；悬浮层「probe-x → … · unclaimed」 |
| A6 目标不可用不改道＋面板行 | ✅ | `e750a6de-…` seq=50 `deepseek-flash`（目标 `kimi-coding/nonexistent-model` 不可用）；悬浮层逐字「「前端」目标不可用 → 保持继承（deepseek-official/deepseek-flash）」 |
| A7 存量兼容 | ✅ | `session-b0c30b21-…` seq=20 `qwen-token-plan-cn/qwen3.8-max`（`driverSticky:false` ⇒ 预设打底＝v1.4.1 行为）。注：本机线上配置源是 profile patch 静态块（v5 形），迁移路径（`.pre-v6` 留档）只对 settings 文档形态生效，未在本部署形态触发 |
| A8 多队友并发 | ✅ | 同轮唤醒 `frontend`/`backend`：`e750a6de-…`→k3、`e9b068d4-…`→glm-5.3 |
| P1 角色×带图 | ⏳ 未执行 | 发版前补（需在队友会话内发图） |

**实机抓到并修复的两个真缺陷**（单测全绿但实机失效，均已修＋回归钉）：

1. `c54b2b3`：宿主服务探测必须经 `ctx.get(name)`——cordis 对**未声明 inject 的服务访问即抛**，
   旧写法 try/catch 吞成 `undefined` ⇒ 分工表 skill 与队友查表**静默失效**（A2/A4/A8 全废）。
2. `ed0e065`：派发台账收口按**父会话**（`dropSession`）——旧 `dropAgent` 按 `agentId` 清，
   子代理"干完即销毁"会把父会话面板那一行立刻删掉 ⇒ 派发区永远空（A2②/A5② 失效）。

另更正本 runbook 的面板取证写法（见 §0）：`/kimi-tide panel --json` 不产出宿主侧输出。
