# 0.4.x「API key 直连」设计稿

- 日期：2026-08-20
- 状态：**已实施（2026-08-20，commit `ec7909e..123d4e7`，分支 `feat/0.4.0-api-key-direct`），发布待定（随 v0.4.0）**
- 决策出处：2026-08-19 晚「四点方向讨论」（评分退役 / 接入层换官方 API Key 直连 / 路径 3 收敛版 / 排期 0.4.x→0.5.0，见 vault 协作日志 2026-08-19）+ 2026-08-20 本会话三项裁决
- 前置调研：[`docs/host-platform-map.md`](../../host-platform-map.md)（DSH 宿主平台契约，Kimi k3 实跑，commit 648ed87）

---

## 1. 背景与目标

kimi-tide 现行接入层为自研 `KimiAdapter`（OAuth 进程内刷新 + pi-ai 兼容适配器，约 740 行 src）。宿主平台契约调研实锤：**pi-ai 原生内置 `kimi-coding` provider，且双凭据路径**——`apiKey: envApiKeyAuth("Kimi API key", ["KIMI_API_KEY"])`（`@earendil-works/pi-ai` `dist/providers/kimi-coding.js:12`）+ Kimi Code 订阅 OAuth（RFC 8628 设备流，`dist/auth/oauth/kimi-coding.js`）。自研接入层属重复造轮。

**目标**：接入层切换为 pi-ai catalog 原生 `kimi-coding` 路由 + API key 凭据（Kimi Code Console Key，`https://api.kimi.com/coding`，anthropic-messages 协议），自研接入层整体退役；路由器/评分/护栏/观测等 kimi-tide 独占价值全部保留。

**非目标**（0.4.x 不做）：模式预设（0.5.0）；图像转述/子代理图片外包（规划中，独立待办）；kimi 子代理后端；moonshotai 开放平台第二路由（用户已选「不单设双轨」）。

### 三项已批裁决（2026-08-20）

| # | 问题 | 裁决 |
|---|---|---|
| 1 | 接入层形态 | **pi-ai catalog 路由 + 环境变量**：复用 pi-ai 内置 `kimi-coding` provider，凭据 = apiKeyEnv 引用；kimi-tide 插件零接入层代码 |
| 2 | 自研接入层处置 | **退役删除**（oauth.ts / adapter.ts / context.ts / stream.ts 及对应测试） |
| 3 | provider 命名 | **改名 `kimi-coding/*`** + sidecar/设置命名空间存量迁移（v2→v3） |

---

## 2. 现状事实（实施基线，全部实读锚点）

### 2.1 pi-ai 原生 kimi-coding（catalog 实读）

- catalog `@earendil-works/pi-ai/dist/providers/data/kimi-coding.json`：四模型 `k3` / `k3-256k` / `kimi-for-coding` / `kimi-for-coding-highspeed`；`api: anthropic-messages`；`baseUrl: https://api.kimi.com/coding`；`headers.User-Agent: KimiCLI/1.5`；全部 `input: ["text","image"]`；k3 `contextWindow 1048576` + `thinkingLevelMap`（low/high/max）。
- 凭据：`envApiKeyAuth("Kimi API key", ["KIMI_API_KEY"])`（ambient 发现读 `KIMI_API_KEY` 环境变量，`dist/env-api-keys.js:100`）；OAuth 为惰性加载备选。
- dsh-llm-pi-ai 凭据语义（README.md:11/108/126）：`apiKeyEnv` 是**引用**而非密钥本体，按请求解析；引用配了但解析不到 → `MISSING_CREDENTIAL` 失败（不回退到无关环境变量）；Models 页打的 key 写入托管凭据文档，不落 settings.yaml。

### 2.2 本机部署实况（2026-08-20 实读）

- `dsh-base/cordis.patch.yml:95`：`llm-pi-ai` 以 **dormant** 挂载——零路由，直到 `settings.yaml` 的 `llm-pi-ai:` 分节供给 provider profile（web Models 页即写此分节）。
- 凭据服务 `dsh-credentials-local`（dsh-base/cordis.patch.yml 注释）：环境变量 > 托管 `$DSH_HOME/.credentials.yaml` > 项目/用户 `.env` 回退；**Models 页只写托管文档，从不物化进进程环境**。
- **本机 `settings.yaml` 已存在 kimi-coding 路由**（用户此前经 Models 页配置）：

  ```yaml
  llm-pi-ai:
    providers:
      kimi-coding:
        apiKeyEnv: KIMI_CODING_API_KEY
        models: [k3, kimi-for-coding-highspeed]  # 当前仅 2 个
  ```

  另有 `qwen-token-plan-cn` 自声明路由（与本次无关）。
- `kimi-tide-router` 用户层现状（迁移对象，实读）：`mode: off`；candidates 含 `kimi-tide/k3`、`kimi-tide/k3-256k`、`kimi-tide/kimi-for-coding`、`kimi-tide/kimi-for-coding-highspeed` 四项；`scores` 覆盖五条 `kimi-tide/*` 键；`allowedProviders: [kimi-tide, deepseek-official]`。
- 另存在 `qwen-token-plan-cn` 路由内嵌 kimi-k2.x 模型（hand-declared 先例，佐证形态可行）。

### 2.3 现行插件接线（`src/index.ts` 实读）

- `KimiOAuthManager`（oauth.ts 246 行）→ `KimiAdapter`（adapter.ts 162 行）注册 provider 路由 `kimi-tide`（index.ts:319-327）；OAuth 刷新环（index.ts:588-594）。
- `UsageMonitor`（usage.ts）轮询 `https://api.kimi.com/coding/v1/usages`（usage.ts:11），鉴权 = OAuth access token（usage.ts:78）；本地 token 桶由适配器 `onUsage` 回调喂（index.ts:321）。
- 面板 kimi 下拉模型源 = `adapter.listModelIds()`（index.ts:468）。
- 路由器/护栏/锁存/设置命名空间机制与 provider 名解耦良好（候选枚举走 `ctx.llm` 实时目录，index.ts:162-222）。

---

## 3. 设计

### 3.1 新接入形态（零插件接入层代码）

- Kimi 模型进 DSH LLM 注册表的路径：**`settings.yaml` → `llm-pi-ai.providers.kimi-coding`**（官方 Models 页维护，本机已就绪）。dsh-llm-pi-ai 监测分节变化即原子换路由注册（README.md:108）。
- 凭据：apiKeyEnv 引用（本机 `KIMI_CODING_API_KEY`；文档默认建议 pi-ai ambient 名 `KIMI_API_KEY`），值存托管凭据文档（Models 页）或真实环境变量。kimi-tide **永不触碰密钥本体**。
- 插件 README/文档改写为「Console Key 获取 + Models 页配 kimi-coding」指引；`docs/legacy-setup.md`（旧定时任务方案）标注「已被 0.4.x 取代」。

### 3.2 退役删除面（约 740 行 src + 对应测试）

| 文件 | 行数 | 处置 |
|---|---|---|
| `src/oauth.ts` | 246 | 删除（KimiOAuthManager 整体） |
| `src/adapter.ts` | 162 | 删除（KimiAdapter） |
| `src/context.ts` | 173 | 删除（pi-ai 上下文转换） |
| `src/stream.ts` | 155 | 删除（流式解析） |
| `src/index.ts` | −80 左右 | 拆线：oauth/adapter 装配、`ctx.llm.registerAdapter`、OAuth 刷新环；Config 删除 `providerName`/`kimiHome`/`refreshIntervalMs`/`refreshOnStart` |
| `src/commands.ts` | 局部 | 凭据/OAuth 状态相关命令段落改写 |
| `src/client/*` | 局部 | 凭据门控（OAuth 状态）UI 改写为「路由+key 二态」（见 3.5） |
| `test/adapter|context|stream|oauth*.test.ts` | — | 删除 |

`scripts/`（kimi-capabilities / e2e / token 维护脚本）中直接调 OAuth 的脚本同步退役或改写（实施时逐个定）。

### 3.3 命名迁移 kimi-tide/\* → kimi-coding/\*（RouterConfig v2→v3）

- `RouterConfigV2.version` 升 `3`（类型改 `version: 3`），新增 `migrateV2(raw)`：把 `default`/`candidates`/`allowedProviders` 中的 provider `kimi-tide` 改写为 `kimi-coding`；`scores`、`costTiers` 的键前缀 `kimi-tide/` 改写为 `kimi-coding/`；其余字段原样。幂等（无 kimi-tide 残留即 no-op）。
- 迁移作用面（沿用 0.3.0 设置迁移先例）：sidecar 加载链 + 设置命名空间 `kimi-tide-router` 的 base 层与 user 层存量（2.2 实读的 4 候选 + 5 scores 键全覆盖）；迁移前留档 `.pre-v3` 备份（沿用 `.legacy-imported`/`.corrupt` 留档先例）。
- **命名空间名 `kimi-tide-router` 不变**（插件身份，非 provider 名）。
- 代码默认值：`DEFAULT_CONFIG_V2()` 调用点与 `migrate.ts` 内 `'kimi-tide'` 参数改 `'kimi-coding'`；`scores.ts` BASELINE 键改名 + `SCORES_VERSION` 2→3；`DEFAULT_ROUTER_CONFIG`（v1 视图）premium/premiumLong provider 改 `kimi-coding`。
- `Config.providerName` 配置项删除（不再注册适配器，无需命名路由）；路由器默认候选 provider 固定 `kimi-coding`（用户可经路由配置改任意已注册 provider，机制不变）。

### 3.4 配额与本地统计

- **官方配额（保留）**：`UsageMonitor` 鉴权从 OAuth token 改为 API key——经 `ctx.credentials` 缝解析 `kimi-coding` 路由的 apiKeyEnv 引用（解析 API 形状待核实，见 §6）；无该缝回退 `process.env[<apiKeyEnv>]`。401/失败语义不变（stale 标记）。
  - **待核实**：`/coding/v1/usages` 是否接受 Console Key Bearer（OAuth token 与 Console Key 是否同权）。实机验收项；若拒绝 → 配额区显示「未接入」指引文案，**不阻塞发布**。
- **本地 token 统计（删除）**：数据源 = 自研适配器 `onUsage` 回调，随退役消失；面板本地区整块移除（YAGNI；日后如需可基于会话日志聚合重做，另立项）。
- `Config.usagePollMs`/`usagePollOnStart` 保留（配额轮询仍在）。

### 3.5 面板与命令

- 面板 kimi 模型下拉：`adapter.listModelIds()` → `ctx.llm.listModels('kimi-coding')`（与 deepseek 路径统一，皆走 llm 服务异步枚举）。
- 凭据门控改写为二态指示：**kimi-coding 路由已注册（`ctx.llm.listProviders()` 含 `kimi-coding`）+ key 可解析**；缺任一则面板显示配置指引（Models 页链接 + apiKeyEnv 说明）。
- `/kimi-tide` 命令族：mode/set/export-config/import-config/refresh 全部保留；输出中的 provider 名随迁移自然更新。

### 3.6 路由器与护栏（机制零改动）

- 候选枚举/图像护栏/会话锁存/image-admission bail **代码路径不变**——`resolveModelInfo('kimi-coding', *)` 的 `inputModalities` 来自 pi-ai catalog 声明（text+image），模态数据天然正确。
- 已知限制（带图锁存死锁）不因本次改动改变；README 已知限制节维持。

### 3.7 测试计划

- 删除：adapter/context/stream/oauth 测试文件。
- 改名：router/wiring/settings/projection/commands 测试中的 `kimi-tide` provider 名 → `kimi-coding`。
- 新增（TDD）：`migrateV2` 迁移测试——provider 改写全字段覆盖 / scores+costTiers 键改写 / 幂等 / 留档 / 与 sidecar 链及设置命名空间两处的集成；UsageMonitor key 鉴权测试（fetchFn 缝）。
- 质量基线不变：全量测试绿 + typecheck 0 + build 过方可提交。

### 3.8 验收标准（实机）

1. 迁移后设置卡片显示 `kimi-coding/*` 候选与 scores 覆盖完好；`.pre-v3` 留档存在。
2. capability 模式探针：会话日志 `request/header = kimi-coding/k3`。
3. 带图改道无 `UNSUPPORTED_CONTENT`（护栏+锁存路径回归）。
4. 配额区：Console Key 下 `/usages` 出数（待核实项落锤）；若拒绝则指引文案可见。
5. key 缺失（临时改错 apiKeyEnv 名）：请求报 `MISSING_CREDENTIAL` 且面板指引可见。
6. `k3-256k`/`kimi-for-coding` 未在本机路由声明的模型：候选池 `available:false` 标灰（枚举兜底机制回归）。

---

## 4. 发布范围（v0.4.0，预计 2026-08-21）

- 含：0.4.0 设置界面迁移（已合并 `bc31b69`）+ 本设计（API key 直连）。
- 配套：GitHub Actions Release 流水线（台账既有待办，尽量同次落地）；README 全量刷新（接入指引/特性表/架构图/FAQ 的 OAuth 表述）。
- 版本号：`packages/dsh-kimi-tide/package.json` → `0.4.0`；README 徽章同步。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| `/usages` 不接受 Console Key | 验收④判定；拒绝则配额区降级为指引，不阻塞发布 |
| 迁移改写用户评分覆盖出错 | migrateV2 幂等 + `.pre-v3` 留档 + TDD 全覆盖 |
| 他机部署无 kimi-coding 路由（fresh 安装） | 面板二态门控给配置指引；README 快速开始重写为先配路由 |
| `ctx.credentials` 缝无私有解析 API | 回退 `process.env`；差的情况：托管凭据文档用户需补设同名环境变量（文档写明） |

## 6. 待核实项

1. ~~`/coding/v1/usages` 对 Console Key 的接受性~~ **已落锤（2026-08-20 验收④实机探针）**：Console Key Bearer 实返 200（`authentication.method=METHOD_API_KEY`、`scope=FEATURE_CODING`）；响应五小时窗数字嵌套在 `limits[0].detail` 下（与实施夹具的平铺假设不符），解析修复见 `d5256d8`。
2. ~~`dsh-credentials-local` 对插件暴露的解析 API 形状~~ **已落锤（实施时实读）**：`ctx.credentials.resolve(CredentialRef) → { value, source }`（`@deepseek-ai/dsh-credentials` lib/types/index.d.ts:46-56）；apiKeyEnv 引用名从 `ctx.settings.get('llm-pi-ai')` 的 `providers['kimi-coding'].apiKeyEnv` 读取（`@deepseek-ai/dsh-llm-pi-ai` lib/types/config.d.ts:40-42，README.md:108），兜底 `'KIMI_API_KEY'` 与 `process.env`。
3. ~~`k3-256k`/`kimi-for-coding` 是否需在本机 kimi-coding 路由补声明~~ **已决策（2026-08-20 用户）：暂不补**，保持路由声明 k3 + kimi-for-coding-highspeed 两模型；未声明两模型候选池 `available:false` 已实机验证（投影帧 + 设置卡片置灰「（不可用）」，灰态通道修复见 `84f9b72`）。
