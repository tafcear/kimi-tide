# dsh-kimi-tide（月汐）

DeepSeek Harness（DSH）的「每一步自动选模型」插件：命名预设 + 有序规则 + 协作流——贴图自动走能看图的模型，代码自动走编码模型，闲聊翻译自动走便宜模型；没有规则命中时使用默认目标（预设默认模型）。带图像护栏、图像转述流、多 plan 配额显示，每次选了谁、为什么，面板上看得见。

> **当前状态**：v2.1.0（2026-10-07，[Releases](https://github.com/tafcear/kimi-tide/releases)），**1084/1084 测试绿**。本版把路由页从「四个并列控件」重排成**一条五档决策链**（显式 @ > 调用方点名 > 分工表 role > 关键词规则 > 默认目标）＋顶部摘要说明，并新增作用域徽标（主会话 / 派发时）、重叠解释条、测试场「派给谁」与统一路由表 `routes`（v7 配置）；同时完成**文案 locale 化**（600 键 × 2 语言，英文界面可用，中文逐字不变）。**路由决策语义零变更**——配置里没有 `routes` 的文档行为逐字节不变。版本历史见仓库根 [CHANGELOG](../../CHANGELOG.md)；项目介绍与快速开始见[根 README](../../README.md)。匹配语义（词边界/特异度排序/最少命中词数）、effort 推理档位、v7 配置全字段与迁移口径，见 [docs/router.md](docs/router.md)；v2.1.0 实机验收清单见 [docs/routing-ia-acceptance.md](docs/routing-ia-acceptance.md)。

0.4.x 起插件**零接入层代码**——Kimi 模型经官方 pi-ai 原生 `kimi-coding` 路由（设置 → Models 配一把 Console API Key）进 DSH LLM 注册表，自研 OAuth 接入层（约 740 行）整体退役。插件只保留官方生态没有的能力：**路由、护栏、协作编排、观测**。

## 模型（经 kimi-coding 路由）

| 模型 | 说明 | 上下文 |
|------|------|--------|
| `kimi-for-coding` | Kimi K2.7 Code（编码任务主力） | 256K |
| `kimi-for-coding-highspeed` | K2.7 Code 高速版 | 256K |
| `k3` | Kimi K3 旗舰 | 1M |
| `k3-256k` | Kimi K3 256K 版 | 256K |

> 模态：以上 4 个模型在 pi-ai 目录中均声明 `input: ["text", "image"]`（能看图）。

## 前置条件

- Node.js ≥ 22、DSH `@deepseek-ai/dsh@0.1.2-rc.1` 及以上（本版实机验证于 `0.1.5-rc.1`；0.4.0 起声明 peer 依赖，设置卡片依赖 `dsh-settings`）
- 一把 **Kimi Code Console API Key**（Kimi 控制台获取）

## 安装

```bash
npm install && npm run build && npm pack
dsh plugin --profile web add ./dsh-kimi-tide-<version>.tgz
```

然后到 DSH「设置 → Models」添加 provider **`kimi-coding`**，`apiKeyEnv` 填
`KIMI_API_KEY`（或自建引用名），在凭据区粘贴你的 Key。模型目录自动就位——密钥由
DSH 托管凭据存储，**不落任何插件配置文件**。重启 `dsh web` 生效。

## 配置（cordis.patch.yml 可覆盖）

| 键 | 默认 | 说明 |
|----|------|------|
| `usagePollMs` | `60000` | 月汐 dock 配额轮询周期（毫秒） |
| `usagePollOnStart` | `true` | 启动时立即轮询配额 |
| `patchFile` | `$DSH_HOME/profiles/web/cordis.patch.yml` | legacy 路由静态种子的部署基座（仅 base 层） |
| `sidecarFile` | `<patch 目录>/kimi-tide-router.yml` | 无设置服务宿主的回退存储 |

> 路由配置本体持久化在官方设置面板「设置 → 月汐」，落在**本插件条目配置的
> `router` 段**（命名空间 `dsh-kimi-tide`，profile 的 `cordis.patch.yml`）。
> 配置形状以 **v7** 为准：`routes`（**统一路由表**——session 行 = 主会话关键词/带图
> 规则，dispatch 行 = 分工角色）＋ `presets`（默认模型 + `imageFallback` 三态）
> / `keywordGroups`（内置 7 组）/ `flows`（协作流注册表）/ `auxTargets` /
> `roles` / `driver` / `driverSticky` / `rulesApplyToChildren`。迁移后 `routes`
> 是**唯一真源**，`presets[*].rules` 与 `roles` 保留为**镜像**（删掉 `routes`
> 段即回退旧字段口径，功能不崩）；**没有 `routes` 的存量文档照旧按旧字段读**，
> 行为逐字节不变。存量配置经迁移链自动桥接并留档。
> 配置全字段见 [docs/router.md](docs/router.md) 的「配置参考（v7 全字段）」与
> 「2.1.0 统一路由表（v7）」两节；迁移链见「迁移链」节。

## 月汐状态行（只读仪表）

输入框**工具行右端**（提交按钮左侧，与权限 / 模型 / 语音并排）的「🌙 月汐」紧凑行提供：

- **预设 → 目标 chip**：`月汐 省钱 → deepseek-flash`——本步有决策时右侧显示**实际路由目标**
  （如 `→ glm-5.3`），否则显示预设默认模型；点击展开**决策面板**（命中规则、理由、
  候选池逐步决策），空态也渲染并解释「暂无本步决策」。
- **配额/余额 chip**：跟随当前命中目标——余额源显示 `¥3.94`，用量源显示 `周剩NN%`；
  点击展开**用量总览**（全部注册源一屏）。刷新配额走 `/kimi-tide refresh`。
- **kimi 接入指示**：kimi-coding 路由未注册或 Key 不可解析时，主 chip 内嵌 ⚠（title 给出
  设置路径）；其它通道（如 moonshotai-cn）不计入这个判据。
- **预设管理**（选择/编辑/新建/复制/删除 + 规则表 + 关键词组）在官方设置页「月汐」
  卡片（`settings.section`，id `kimi-tide-router`）。
- **推理状态**：推理输出已由 DSH 原生渲染（reasoning-delta），无需面板提示。

> 位置沿革（2026-10-03）：原先是 `conversation.composer.dock`（输入框**下方**的两行完整
> 仪表，每条 occupant 占一整行），按用户裁定挪到工具行右端并改为紧凑态；完整态
> （`variant:'full'`）仍保留在组件里，宿主换位即可复用。

面板命令族（也可在输入框直接敲）：

- `/kimi-tide preset <id|off>`（全局切换激活预设）
- `/kimi-tide show`（当前预设 / 默认模型 / 规则数 / 关键词组数 / flows 注册表 / 每预设 imageFallback）
- `/kimi-tide set activePreset <id|off>`（`set` 键白名单仅此一键）
- `/kimi-tide export-config`（打印 resolved 配置 YAML）/ `/kimi-tide import-config <path|内联 YAML>`（文件整表替换，或多行内联 YAML 合并补丁）
- `/kimi-tide refresh`（立即刷新配额）
- `/kimi-tide help`（命令用法一览）

规则驱动路由架构详见 [docs/router.md](docs/router.md)。

## 路由页（v2.1.0：一条决策链 + 统一路由表）

「设置 → 月汐 → 路由」从四个并列控件改为**一条五档决策链**（与 `src/router.ts`
的优先级链逐档对齐）：

- **顶部摘要**：`buildRoutingView().summary` 一句话说清现状（默认目标是谁、命中什么走哪、
  派发到哪、带图走哪种兜底）；规则为空时明写「主会话没有可命中的规则，全部使用默认目标（…）；
  另有 N 组关键词组未接入任何规则，暂不生效」。
- **五档链**：每档三行（触发条件 / 当前取值 / 关闭后的影响）；第 3 档内联
  **分工表**、第 4 档内联**预设编辑器**；**默认目标档显式渲染**（来源：主驱动恒定 /
  预设默认 / 跟随宿主默认）。档位三态徽标：**已就绪** / **按需**（写 `@` 或子代理点名；
  不置灰）/ **未启用**（置灰）——避免「五档里四档都亮着」而看不出谁在决定这一轮。
- **作用域徽标**：规则行「**主会话**」、角色行「**派发时**」；词表行另有接入徽标
  （被 N 条规则引用 / 被协作流认领 / ⚠ 未接入）。
- **重叠解释条**：词表的词同时是某角色身份词且两边目标不同 ⇒ 词表行与角色行各挂一条
  解释条（**不是报错**）＋两个一键动作「规则跟随该角色」/「词并入该角色别名」；
  被协作流认领的规则不参与解释（已被抑制，不为它说假话）。
- **测试场「派给谁」**：按角色 / 队友名预判改道目标与依据（`role` / `unclaimed`），
  与「试一句」（主会话关键词规则）分属**两套作用域**；分工表另有「从词表生成角色」，
  把无规则引用的词表组批量生成角色行。
- **写通道双写**：保存规则 / 角色时同一笔写同时下发 `routes` 与镜像旧字段——scope
  通道上是**三笔序列** `unset routes → set 旧字段 → set routes`（宿主逐笔校验新旧
  字段一致性，顺序是硬约束）；写后比对「意图值 vs 实读值」，被拒明确报错、不静默。

## 带图行为与已知限制

| 项 | 说明 |
|----|------|
| **按图三态** | 每张图按 `native`（视觉模型原生处理）/ `transcribed`（已转述为文字）/ `blind`（当无图）三态跟踪；文本-only 目标面对 native 历史图时按预设 `imageFallback` 处置：`latch` 改道锁存目标 / `blind` 占位盲答 / `transcribe-lazy` 先补转述再放行 |
| **图像转述流** | 省钱姿态的根解：`image` 规则改挂 `flow:transcribe` → vision-exp 读图转文字（eager，缓存+30s 超时+失败不重打）→ 文本模型凭转述文字接力作答；`failurePolicy=latch-image` 转述失败回退原生视觉 |
| **⚠️ 死锁场景（历史）** | 0.5.x 布尔锁存下多模态模型额度/Key 失效后会话无法切文本模型——0.6.0 起按图三态 + 转述流提供盲答/转述两条出路（存量含图会话仍只能新开会话） |
| **面板图像上下文行** | dock 第二行显示「图 原N·述N」，盲答图 >0 时告警色 |

## 文案 locale 化

全部用户可见文案住在 `src/locales/{zh,en}/{shared,settings,panel,help,view}.ts`，按界面分表，**600 键 × 2 语言**。zh 是唯一真源；en 用 `Record<keyof typeof zh, string>` 在类型层钉死键集（`npm run typecheck` 会红）。键命名约定：`<surface>.<area>.<name>`（如 `settings.route.tierExplicitTitle`），占位符用 `{0}` / `{name}`。

- **组件内**：`const t = useCopy()`（来自 `src/client/locale.ts`），写在组件函数顶部（hook 规则）；JSX 文本与可见属性走 `t('key')` 或 `t('key', { 0: value })`。
- **非组件上下文**（事件处理器、模块级拼接）：用模块级 `copy()`（同一份表）。
- **服务缺席回落**：locale 服务不存在时 `copy()` / `t()` 回落中文表，`apply()` 不抛错——旧宿主上中文界面逐字不变。
- **展示元数据**：`locale/zh.json` / `locale/en.json` 提供 `meta.title` / `meta.description`，Plugin Manager 与设置页插件行据此显示标题与描述。
- **界面语言行**：设置卡顶部一行「界面语言」选择器——列出宿主注册的全部语言（当前项选中），切换即调宿主 `setLocale`，整个界面（含月汐卡片本身）立即换语言并由宿主持久化；宿主未提供语言列表（旧宿主）时整行不渲染。
- **门禁**：`scripts/check-client-i18n.mjs`（接进根 `npm run check`）AST 级扫 **18 个会被浏览器打包的源文件**（`src/client/**`、`src/routing-view.ts`，以及客户端同样会 import 的四个共享模块 `src/config.ts` / `src/rules.ts` / `src/roles.ts` / `src/review-verdict.ts`——它们经 `src/copy.ts` 的 `copyNow()` 取文案；宿主侧缺省恒为中文）的硬编码文案（汉字 / 中文标点 / 全角字符 / `——` / `…`，注释豁免），并校验表结构（zh/en 键集相等、跨表无重复键、值非空、占位符一致）与展示元数据完整。
- **边界**：宿主侧拼好的中文串（`/kimi-tide …` 命令输出、工具结果、团队技能描述、`decision.reason` / `configSource`）不在本轮范围——上游只提供浏览器侧 locale 服务，宿主没有对应机制。（评审结论标签已收口：`verdictLabel` 走 `shared.verdict.*`。）

## 使用合规提示

0.4.x 起默认走 **Console API Key 官方路径**，个人使用安心；Kimi Code 订阅条款仍以
官方表述为准，请勿高频批量调用或共享密钥。本仓库**不含任何凭据**。

## 许可

[MIT](../../LICENSE) · 依赖 `@earendil-works/pi-ai`（MIT）
