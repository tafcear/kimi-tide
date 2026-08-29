# kimi-tide 0.8.0 B1–B8 实机验收执行方案（Runbook）

> 编制：2026-08-27 晚（验收窗口已开启）。配套计划：`2026-08-27-routing-coverage-effort.md`（验收清单定义在 Task 8 Step 4，回填区在文末 L1452-1467）。
> 性质：执行手册——每条探针给「发什么 / 预期落点 / 证据锚点」，验收时逐项对照打钩，结果回填主计划。

## 0. 当前状态快照（已核实）

| 项 | 状态 |
|----|------|
| 代码 | `feat/0.8.0-routing-coverage` @ `d066d8f`，385/385 测试 + typecheck 0，终审 merge-ready |
| 实机配置 | `settings.yaml`（4955B @ 21:33）已进入验收窗口：`activePreset: capability`，capability 含 5 条 tmp 规则（review/math/longdoc/writing/translate）+ plan(rule-3) + chitchat(rule-3 同名 id 注意) + image→flow transcribe |
| 恢复点 | `settings.yaml.bak-b1b8-window`（4003B @ 19:00，`activePreset: saving`，用户真实配置）——验收后逐字节恢复 |
| 插件运行码 | profiles `package.json` link 直连仓库 `lib`（= 0.8.0 tip），宿主 PID 38040 @ 18:56 起 |
| 组词表 | 已与 0.8.0 内置逐字一致（19:0x A 步）：review(9)/writing(10)/translate(6)/longdoc(6)/math(8)，chitchat 6 词；plan 组 [plan, 计划, 方案, 规划] 为用户自建保留组 |

**临时配置目标表（验收预期落点以此为准，非计划文档 spec 目标）：**

| 规则 | 组 | 目标 | effort |
|------|----|------|--------|
| image-k3 | （带图） | flow: transcribe（visionModel kimi-coding/k3） | max（flow 级） |
| review-tmp | review | deepseek-official/deepseek-v4-flash | — |
| code-kfc | code | kimi-coding/k3 | — |
| math-tmp | math | deepseek-official/deepseek-v4-pro | **max** |
| longdoc-tmp | longdoc | kimi-coding/kimi-for-coding-highspeed | — |
| writing-tmp | writing | zai-coding-cn/glm-5.3 | — |
| translate-tmp | translate | zai-coding-cn/glm-5.3-flash | — |
| rule-3 | plan | kimi-coding/k3 | — |
| chitchat-flash | chitchat | kimi-coding/k3（临时值，恢复后消失） | — |

## 1. 观测手段（四项证据通道）

1. **决策 chip**（dock 面板）：每条探针发出后看本会话 chip——应显示命中规则理由，且 0.8.0 起理由含**命中词数**（B8 证据同此）。
2. **宿主日志**：`kimi-router: agent request → <provider>/<model> (<reason>)`，request/header 解码的落点实锤。
3. **「试一句」测试器**（设置卡片）：输入同款文本，preview 的组/词数/目标/effort 应与实机一致（B4）。
4. **设置卡片目检**：规则区真语义标题、minHits 标签、行级摘要、effort 下拉态（B3/B5）。

探针纪律：每条探针**单独一条消息**；不带显式 @；消息短（回答内容不是证据，chip/log 才是——发出即可取证，不必等长回答，注意 math→v4-pro effort max 的额度消耗）；若目标 provider 未挂载/429 → 按「目标不可用跳过」降级处理，对应项记「降级」而非失败。

## 2. B1 新组命中阳性（五探针）

| # | 探针（逐字发） | 预期命中 | 预期落点 |
|---|---------------|---------|---------|
| 1 | `请评审这份设计稿，给个意见` | review 2 词（评审/意见） | deepseek-official/deepseek-v4-flash |
| 2 | `帮我润色一下这段文案` | writing 2 词（润色/文案） | zai-coding-cn/glm-5.3 |
| 3 | `把这句话翻译成英文` | translate 1 词（翻译） | zai-coding-cn/glm-5.3-flash |
| 4 | `请通读这份长文档，帮我列出要点` | longdoc 2 词（通读/长文档） | kimi-coding/kimi-for-coding-highspeed |
| 5 | `帮我推导这个概率公式` | math 3 词（推导/概率/公式） | deepseek-official/deepseek-v4-pro（**B5 兼证：请求携带 reasoningEffort: max**） |

探针均已核对不触其他组词（如「设计稿」「列出要点」「这句话」均不在任何组）。

## 3. B2 特异度与新组交叉（三探针）

| # | 探针 | 预期 | 依据 |
|---|------|------|------|
| 1 | `帮我审查这段代码` | review 1 词 ∥ code 1 词平手 → **序级裁定落 review-tmp**（review 序在 code 前）→ deepseek-v4-flash | first-match 序级 |
| 2 | `帮我重构这段代码` | code 2 词（重构/代码）→ code-kfc → kimi-coding/k3 | 词数特异度 |
| 3 | `plan：帮我做个方案` | plan 2 词（plan/方案）→ rule-3 → kimi-coding/k3 | 用户自建组交叉 |

> ★ 探针 3 即触发本方案编制的这条用户消息（2026-08-27 21:3x）——**父会话当场即可截取 chip/log 证据**，无需重发。

## 4. B3 / B4（设置卡片）

- **B3** 目检：设置 → kimi-tide 卡片——规则区真语义标题渲染；各规则行级条件摘要（组名 + minHits）；minHits 可见标签。
- **B4** 「试一句」：把 B1 五条 + B2 前两条逐条输入测试器——preview 的命中组/词数/目标须与 §2/§3 实机结果**逐条一致**；带图输入只展示命中、不承诺改道（preview 语义边界）。

## 5. B5 / B6（effort）

- **B5 阳性**：B1 探针 5（math）已兼证——deepseek-v4-pro 目标 `effort: max` 须出现在出网请求（reasoningEffort: max）。证据优先级：宿主日志/请求详情 > 试一句 preview 显示 effort > 单测锚点。
- **B5 禁用态**：卡片逐个目标检查 effort 下拉——目录无档位支持的目标应呈**禁用「跟随默认」**（预期候选：deepseek-official 系；glm-5.3/glm-5.3-flash 今日热修后已有五档，k3 有档位——以卡片实际渲染为准，记录哪个目标禁用）。
- **B6 转述流 effort**：发一条**带图**消息（任意图）→ image 规则第一序命中 → flow transcribe → 视觉调用 k3 带 `effort: max`（flows.transcribe.visionModel 已配）。证据：转述文字成功回传 + 视觉请求 effort 观测（观测受限时以 preview/单测兜底）。
- **B6 护栏改道**：当前配置带图必中 image 规则（第一序），「文本目标+带图被护栏改道」路径**实机不可达**——标「配置形态不可达」，证据以单测 385/385 + T4 门实测记录兜底，不为此破坏验收窗口配置。

## 6. B7 / B8（兼容与词数）

- **B7 存量兼容**：① 启动/运行日志无新迁移 warn（v5 迁移早已完成，无留档动作）；② saving 预设与 19:0x 用户配置逐字一致（本窗口未动 saving）；③ 恢复备份（§7）后补一条回归探针：`你好` → chitchat → glm-5.3-flash（saving 旧行为不变）。
- **B8 chip 词数**：B2 探针 2 chip 应显示 code 命中 **2 词**；B2 探针 3（本条触发消息）chip 显示 plan 命中 **2 词**；B1 各探针 chip 词数与 §2 表一致。

## 7. 收尾：恢复 → 回填 → 门禁

1. **恢复配置**（验收全部取证后）：
   ```powershell
   Copy-Item C:\Users\tafce\.dsh\settings.yaml C:\Users\tafce\.dsh\settings.yaml.bak-b1b8-done   # 验收窗口存证（可选）
   Copy-Item C:\Users\tafce\.dsh\settings.yaml.bak-b1b8-window C:\Users\tafce\.dsh\settings.yaml
   Get-FileHash C:\Users\tafce\.dsh\settings.yaml, C:\Users\tafce\.dsh\settings.yaml.bak-b1b8-window  # 两 hash 必须一致（逐字节恢复）
   ```
   恢复后执行 B7③ 回归探针。
2. **回填**：主计划文档 `2026-08-27-routing-coverage-effort.md` 文末回填区逐项记「通过/跳过/降级 + 证据锚点」，commit。
3. **门禁**：B1–B8 全绿 + **用户裁定** → 合并 main → tag `v0.8.0` → Actions 发版（0.7.0 发版已随用户裁定取消，不补 tag）。
4. **记忆落账**：协作日志完成条目 + 台账进度 + Daily；SDD 账本 `.superpowers/sdd/2026-08-27-routing-coverage-effort/` 随验收闭环归档。

## 8. 风险与注意

- **额度**：math 探针走 v4-pro + effort max，消息务必短；昨日 qwen 429 事故的前车之鉴——若 deepseek-official 异常，记「降级」不硬闯。
- **同名 rule id**：capability 与 saving 各有 `rule-3`（plan/chitchat 指向不同）——验收窗口临时态，恢复后消失，不视为缺陷。
- **chitchat→k3**：临时配置如此（名不副实），B1 无 chitchat 探针；恢复后回到 glm-5.3-flash。
- **热加载**：kimi-tide-router 配置经 dsh-settings onSaved 生效，改 settings.yaml 免重启；若取证异常先重启 `dsh web` 一次再重跑对应项。
