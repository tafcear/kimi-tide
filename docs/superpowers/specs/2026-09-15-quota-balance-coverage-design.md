# 用量/余额源全覆盖设计（四源注册表 + 自适应槽位 + 总览面板）v1.3.0

> 状态：v1 待独立评审（按仓库惯例先出稿；评审档案落 `docs/audit/`）
> 版本归属：**v1.3.0**（与语义命中确认闸 `2026-09-15-semantic-hit-gate-design.md` 合流同版——待用户裁定，也可拆 v1.4.0）
> 前置：0.8.x⑨ 配额槽跟随命中目标、多 plan 配额（2026-08-29 用户裁定「所有 code plan 的余额」，kimi/zai 双源）
> 用户裁定（2026-09-15 本会话）：
>
> | # | 议题 | 裁定 |
> |---|---|---|
> | 1 | 需求 | **支持所有模型的用量：code plan 显示用量，API 显示余额** |
> | 2 | 展示形态 | **B 自适应槽位 + 总览面板**——额度槽跟随命中目标按源类型切换（用量条/余额），另加总览面板一屏看全部源 |
> | 3 | v1 源范围 | **A 四源收齐 + 可扩展注册表**——内置 kimi/zai/qwen/deepseek 四源，代码结构留扩展位，本版不做自定义源配置面 |

## 1. 背景与现状

**现有机制**（实读锚点）：

- `usage.ts` 的 `UsageMonitor` 是通用轮询器：`{pollMs, resolveKey, url?, parse?, fetchFn?, now?}` 注入式（`usage.ts:13-26`），单实例单源；in-flight 去重 + 0.8 周期有界超时 + 2s 节流通知。
- 两源已挂：kimi（`https://api.kimi.com/coding/v1/usages`，`parseQuotaSnapshot`——周/5h 窗）与 zai（`https://api.z.ai/api/monitor/usage/quota/limit`，`parseZaiQuota`——CREDIT_LIMIT/TOKENS_LIMIT 双形态，`zai-usage.ts:28-53`）。
- key 解析 `resolveProviderKey`（`index.ts:330-343`）：读 settings `llm-pi-ai.providers.<id>.apiKeyEnv` → `ctx.credentials.resolve`（per-operation read，dsh-credentials 契约）→ `process.env` 兜底。
- 投影 `quotas: Record<string, QuotaSnapshot|null>`（`index.ts:594-597` 组装；`types.ts:81`；zod schema `projection.ts:57-60`）。
- dock 第二行「周/5h」双进度条**跟随当前命中目标 provider** 取源快照（`TideDock.tsx:284-296`），无源置灰「—」（⑥-B 防跳动语义）。

**宿主四 provider 对照**（`~/.dsh/settings.yaml` 实读，2026-09-15）：

| provider | 性质 | 模型（节选） | key 引用 | 配额现状 |
|---|---|---|---|---|
| `kimi-coding` | code plan | k3、kimi-for-coding | `KIMI_CODING_API_KEY`（llm-pi-ai） | ✅ 用量 |
| `zai-coding-cn` | code plan | glm-5.3 | `ZAI_CODING_CN_API_KEY`（llm-pi-ai） | ✅ 用量 |
| `qwen-token-plan-cn` | code plan（百炼 token plan，聚合 qwen/deepseek/glm/kimi/minimax） | qwen3.8-max、MiniMax-M2.5 等 | `QWEN_TOKEN_PLAN_CN_API_KEY`（llm-pi-ai） | ❌ 无源 |
| `deepseek-official` | **API 计费** | deepseek-flash、deepseek-v4-pro | `DEEPSEEK_API_KEY` 缺省（**llm-deepseek 节**，非 pi-ai） | ❌ 无源 |

**关键事实**：

1. `deepseek-official` 不走 pi-ai——宿主 harness 自带 `dsh-llm-deepseek` 接入，key 引用 = `llm-deepseek.apiKeyEnv`（缺省 `DEEPSEEK_API_KEY`，`dsh-llm-deepseek/lib/index.js:1838/1885/1992`），baseURL 可配（缺省 `https://api.deepseek.com`，:1992 同行）。解析契约与 `resolveProviderKey` 完全同源（`ctx.credentials.resolve(ref)`）。
2. 用量/余额都是 **provider 级**（订阅和钱包挂账号），provider 级显示天然覆盖其下全部模型——「所有模型的用量」由源注册表覆盖所有已配 provider 达成。
3. `qwen-token-plan-cn` = 阿里云百炼 token plan（baseUrl `token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，pi-ai catalog 实读）；用量端点无官方文档，生态有实现先例（§5.2）。

## 2. 目标与非目标

**目标**：

1. 四源收齐：kimi/zai（既有）+ qwen-token-plan-cn 用量（新）+ deepseek-official 余额（新）。
2. 源注册表结构：新源 = 注册表加一项（provider/kind/url/parse/resolveKey/节奏），不再散落 index.ts 手工挂 monitor。
3. 自适应槽位：目标源为用量 → 周/5h 条（现状不动）；目标源为余额 → 余额槽（¥总额 + tooltip 分项）。
4. 总览面板：dock 内新入口，portal 悬浮层一屏列出全部注册源的用量/余额/无数据态。
5. 存量零突变：无新源 key 的宿主上，行为与 v1.2.1 逐字节一致。

**非目标（本版明确不做）**：

- 自定义源配置面（用户在设置页自填 url/解析模板）——解析器形状无法用户自定义，配置面易做成半吊子；
- moonshotai/openrouter/xiaomi-token-plan 等更多内置源（注册表加一行即可，按需后续版）；
- per-model 用量（订阅与钱包都是 provider 级，无 per-model 数据源）；
- **用本地观测到的请求量估算账号用量**（`@hk_net/pi-usage-bars` 的明确警告：其它客户端与会话会让该值不完整且误导）——宁可不显示，也不给一个错的数；
- 持有浏览器会话 cookie 去读控制台配额（凭据面止于 API key 级，§5.2）；
- 余额低水位告警/自动切预设（余额只是展示，不进路由决策）。

## 3. 数据模型（`types.ts` / `projection.ts`）

```ts
/** 单币种余额分项（DeepSeek /user/balance 契约形状，字符串金额）。 */
export interface BalanceEntry {
  currency: string        // 'CNY' 等
  total: string           // 总额
  granted?: string        // 赠送
  toppedUp?: string       // 充值
}

export interface BalanceSnapshot {
  kind: 'balance'
  balances: BalanceEntry[]   // 多币种并列（DeepSeek 按币种一条）
  /** 端点 is_available 透传（DeepSeek 语义：账号是否可用）；缺席 = 端点未报。 */
  available?: boolean
  fetchedAt: number
  stale: boolean
}

export type QuotaLike = QuotaSnapshot | BalanceSnapshot
```

- `QuotaSnapshot` 增可选判别字段 `kind?: 'usage'`——**新快照一律写 kind，读侧缺席视同 usage**（历史 `kimi-tide/panel` 事件载荷与 v1.2.x 投影无 kind，向后兼容；同款策略：字段缺席≠非法）。
- 投影 `quotas: Record<string, QuotaLike | null>`；zod schema 改 union：`z.union([quotaSnapshotSchema, balanceSnapshotSchema]).nullable()`（`projection.ts:60`）。
- legacy `quota` + `quotaProvider` 双字段不动（旧客户端回落通道）。

## 4. 源注册表（新文件 `quota-sources.ts`）

```ts
export interface QuotaSourceDescriptor {
  provider: string
  kind: 'usage' | 'balance'
  url: string
  parse: (json: unknown, now: number) => QuotaLike | null
  resolveKey: () => Promise<string | null>
  pollMs?: number   // 缺省 = config.usagePollMs；余额源建议 config.balancePollMs
}

/** 宿主配置感知的内置源表（ctx 注入 settings 读取，纯函数可单测）。 */
export function buildQuotaSources(ctx: Context, config: Config): QuotaSourceDescriptor[]
```

四内置源：

| # | provider | kind | url | parse | key |
|---|---|---|---|---|---|
| 1 | `kimi-coding` | usage | `https://api.kimi.com/coding/v1/usages` | `parseQuotaSnapshot`（既有） | `resolveProviderKey('kimi-coding', 'KIMI_API_KEY')`（既有） |
| 2 | `zai-coding-cn` | usage | `https://api.z.ai/api/monitor/usage/quota/limit` | `parseZaiQuota`（既有） | 既有 |
| 3 | `qwen-token-plan-cn` | usage | 无 API 面（§5.2 取证结论）——仅带 key 实测推翻后才有 url/parse | `parseQwenTokenPlanQuota`（同上，条件存在） | `resolveProviderKey('qwen-token-plan-cn', 'QWEN_TOKEN_PLAN_CN_API_KEY')` |
| 4 | `deepseek-official` | balance | `<llm-deepseek.baseURL ?? https://api.deepseek.com>/user/balance` | `parseDeepSeekBalance`（§5.1） | `resolveLlmDeepseekKey()`（§4.1） |

**编排变化**（`index.ts`）：monitor 从两个手工实例改为 `buildQuotaSources()` 遍历建 `UsageMonitor[]`（`UsageMonitor` 零改动——url/parse/resolveKey/pollMs 本就注入式）；`panelSnapshot.quotas` 改为遍历 monitors 组装（`index.ts:594-597` 重写，键 = descriptor.provider）；`/kimi-tide refresh` 的 composite 覆盖全部 monitors（`commands.ts:69-70` 注释语义「refresh 需覆盖全部已配源」落地）。

### 4.1 key 解析泛化

`resolveProviderKey` 只会读 `llm-pi-ai.providers`。新增：

```ts
/** 读 llm-deepseek 节的 apiKeyEnv（缺省 DEEPSEEK_API_KEY）+ baseURL（缺省官方），credentials 同契约解析。 */
const resolveLlmDeepseekKey = (): () => Promise<string | null>
```

实现与 `resolveProviderKey` 同构（`index.ts:330-343` 的三段：settings 读引用 → credentials.resolve → env 兜底），只是 settings 节从 `llm-pi-ai.providers.<id>` 换成 `llm-deepseek`（字段名同为 `apiKeyEnv`）。**余额 URL 的 baseURL 必须与模型请求同源**——用户改过 `llm-deepseek.baseURL`（如代理/中转）时，`/user/balance` 跟随，不写死官方域名。

### 4.2 轮询节奏

- 用量源：`config.usagePollMs`（既有，缺省 60s）。
- 余额源：新配置 `balancePollMs`，**缺省 300s**——余额接口是计费端点，60s×1440 次/天偏激进；余额变化频率远低于用量窗。配置项进 `Config` 接口 + cordis.patch.yml 注释块同步。

## 5. 端点契约

### 5.1 deepseek-official 余额（官方文档，契约先行）

`GET <baseURL>/user/balance`，`Authorization: Bearer <key>`（官方文档 [Get User Balance](https://api-docs.deepseek.com/api/get-user-balance/)）：

```json
{
  "is_available": true,
  "balance_infos": [
    { "currency": "CNY", "total_balance": "110.00",
      "granted_balance": "10.00", "topped_up_balance": "100.00" }
  ]
}
```

`parseDeepSeekBalance`：`balance_infos` 数组缺失/空 → null；字段宽读（字符串金额原样透出，不 parseFloat——精度与币种符号归 UI）；`is_available` 透传快照（UI 可显示停用态）。

### 5.2 qwen-token-plan-cn 用量（**取证结论：无可用 API 面，如实降级**）

**取证已做（2026-09-15，绕代理取证：Clash fake-ip 拦截期的 `curl -x http://127.0.0.1:7897` 通道）**：

1. **社区先例（结论级）**：`@hk_net/pi-usage-bars`（专做用量条的项目）docs/provider-research.md 明确把 Qwen Token Plan 标为 **"Status: Blocked — no account-usage surface found as of 2026-08-13"**：国际站 `token-plan.ap-southeast-1.maas.aliyuncs.com` 上**独立探测 8 条疑似用量路径全部 404**，且成功推理响应**不含任何配额/限流头**。同文警告：**不得用本地观测到的请求量去估算账号配额**（其它客户端与会话会让该值不完整且误导）——本设计采纳为明确非目标。
2. **CodexBar `docs/alibaba-coding-plan.md`**：给出的是**阿里 Coding Plan**（`bailian.console.aliyun.com` 控制台）的 RPC 契约——`POST /data/api.json?action=zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2&product=broadscope-bailian`，字段 `per5HourUsedQuota/TotalQuota/NextRefreshTime`、`perWeek*`、`perBillMonth*`。但：① 这是**与 Token Plan 不同的产品**；② 走**控制台会话 cookie**（`ALIBABA_CODING_PLAN_COOKIE`）而非 API key；③ 文档自陈国内账号常见 **`ConsoleNeedLogin`**（配了 API key 仍要求控制台登录）——与 oh-my-pi issue #8509「北京区 Token Plan 凭据配额上报不工作」互相印证。
3. **本机实测探针（本设计新增证据，2026-09-15）**：对宿主实际使用的 `token-plan.cn-beijing.maas.aliyuncs.com` 无鉴权探测 11 条候选路径——`/usage`、`/api/v1/usage`、`/v1/usage`、`/quota`、`/api/v1/quota`、`/user/quota`、`/api/v1/user/quota`、`/api/v1/quota/usage`、`/v1/dashboard/billing/usage`、`/v1/dashboard/billing/subscription` **全部 404**；仅 `/compatible-mode/v1/*` 前缀返回 401。
   **对照组证伪**：同前缀下探必然不存在的路径（`/compatible-mode/v1/zzz-not-a-real-path-9f3a`）返回**完全相同**的 401 + `{"code":"InvalidApiKey","message":"No API-key provided."}` ⇒ 该前缀是「先鉴权后路由」的兜底，**401 不构成「端点存在」的信号**。（记录此对照的意义：无对照时极易把 401 误读为端点存在。）

**据此的设计（取代原「实施期钉契约」）**：

- 该源**默认以「已知但无 API 面」注册**：descriptor 携带 `unavailableReason`（静态、文档化的真话），总览面板显示「该套餐无公开用量 API（需控制台查看）」——**与「取数失败」「key 未配置」是三种不同状态**（§6.2）。
- 唯一能推翻上述结论的实验是**带 key 的实测**：对 `/compatible-mode/v1/usage` 发一次带 `Authorization: Bearer` 的 GET——200 带数据 = 推翻结论、立刻按实测形状实现解析器；404 = 确认无此 API；401 `InvalidApiKey` = key 侧问题。**该实验需用户凭据，实施期征得同意后执行**（不由本设计擅自取用密钥）。
- 若实验证伪（大概率）：qwen 源保持登记 + 置灰 + `unavailableReason`，**本版交付面不受影响**（其余三源照常）。
- 控制台 cookie 路径（CodexBar 的 Coding Plan 走法）**不实现**：让插件持有浏览器会话 cookie 是能力与风险的错配（本插件的凭据面止于 API key 级 per-operation read）。

## 6. UI（`TideDock.tsx` / `icons.tsx` / `styles.ts`）

### 6.1 自适应槽位（第二行，`TideDock.tsx:391-422`）

```
目标源 usage  → [📅 周 ▓▓▓░ 剩N] [⚡ 5h ▓░░ 剩N]   （现状不动）
目标源 balance → [👛 余 ¥110.00]                    （单槽替换双槽）
```

- 判定：`quotas[targetProvider]` 的 `kind`（缺席视同 usage——旧载荷回落现行为）。
- 余额槽：新图标 `wallet`；正文 `¥110.00`（首币种；多币种 tooltip 全列）；title/aria-label = `余额（赠送 ¥10.00 · 充值 ¥100.00）`；`is_available === false` 追加「（账号不可用）」。
- **防跳动语义保持**：结构按 kind 恒定（usage 恒双槽、balance 恒单槽），同类快照间不跳；kind 切换是目标切换的自然结果，与现有置灰切换同粒度。
- 取数时间/刷新按钮对两种 kind 通用；时钟槽文案统一中性化「配额取数时间」→「取数时间」（余额不是配额，a11y 同步改）。

### 6.2 总览面板（新入口 + portal 悬浮层）

- **入口**：第二行右端（时钟左侧）新 chip 按钮「总览」（图标 `stacks` + 文案；`aria-expanded` + `aria-controls`），复用决策 popover 的 portal 定位机制（`TideDock.tsx:463-477` 同款：fixed + 外点/Esc 关闭）。
- **内容**：注册表序（§4 表序）每源一行：

```
kimi-coding         用量  周 62% · 5h 12%        14:32
zai-coding-cn       用量  周 38% · 5h 4%         14:32
qwen-token-plan-cn  用量  该套餐无公开用量 API（需控制台查看）   —
deepseek-official   余额  ¥110.00（赠10+充100）   14:30
<无数据源>           —    无数据（key 未配置 / 取数失败）
```

- 每行：provider 名 + kind 徽标 + 主值 + 取数时间（`stale` 标「过期」）；usage 行 title 带剩余量与 resetTime，balance 行 title 带分项。
- **三种「没数」必须可区分**（本设计的诚实性要求，§5.2 是其存在理由）：
  1. **无 API 面**——descriptor 的静态 `unavailableReason`（如 qwen：「该套餐无公开用量 API（需控制台查看）」）⇒ 显示真话，不暗示故障；
  2. **无数据（key 未配置）**——有源、无凭据；
  3. **无数据（取数失败/过期）**——有源、有凭据、这次没拿到（含 `stale`）。
- 无数据行置灰但**恒渲染**（⑥-B 同语义：结构恒定防跳动，且「注册了但没数据」是可观测状态而非空白）。
- 面板 role="dialog"/region + 标题「用量总览」；行用列表语义（ul/li）。

### 6.3 图标与样式

- `icons.tsx` 新增 `wallet`（余额：圆角矩形 + 卡片线条，24 viewBox / stroke currentColor / round cap，与现集同风格）与 `stacks`（总览：三层叠片）。
- `styles.ts`：余额槽复用 `kt-quota-slot` 尺寸（无进度条）；总览面板复用 `kt-dock-pop` 容器样式 + 新行样式（`kt-ov-row` 等，月汐品牌色同源）。

## 7. 命令与可观测

- `/kimi-tide refresh`：composite 覆盖全部 monitors（四源并发 refresh）；帮助文案 `re-poll code plan quotas (kimi/zai)` → `re-poll quota sources (kimi/zai/qwen/deepseek)`（`commands.ts:142`）。
- `/kimi-tide show` 输出增补源注册表概览（每源 kind + 有无快照）——最小面：一行一源。
- 日志：源失败不刷屏——沿用 monitor 静默 null（现有行为），仅 refresh 命令回执不变。

## 8. 测试面

| 文件 | 用例 |
|---|---|
| `test/quota-sources.test.ts`（新） | 四内置源齐全性（provider/kind/url/parse 非空）；`resolveLlmDeepseekKey` 三段解析（settings 引用 → credentials → env 兜底；`llm-deepseek` 节缺席走缺省）；余额 url 跟随 `llm-deepseek.baseURL` 覆盖；余额源 pollMs 取 `balancePollMs`、用量源取 `usagePollMs` |
| `test/usage.test.ts`（扩） | `parseDeepSeekBalance`：文档形状夹具（多币种/单币种）→ 快照；`balance_infos` 缺失/空/字段畸形 → null；`is_available:false` 透传 |
| （qwen parser） | 契约钉死后：实测夹具 → 快照；畸形 → null（契约未钉期间该文件缺席不阻塞） |
| `test/projection.test.ts` / `projection-quotas.test.ts` | union 快照往返；**旧载荷（无 kind）容忍**；balance 源进 `quotas` 记录 |
| `test/TideDock.dom.test.tsx` | balance 目标 → 余额槽渲染（¥ 文本 + tooltip 分项）；usage 目标 → 周/5h 不变（回归）；无 kind 旧载荷 → usage 渲染；总览面板开/关（外点/Esc）、四行齐、无数据行置灰恒渲染、aria-expanded/列表语义 |
| `test/index-wiring.test.ts` / `index-apply.test.ts`（扩） | monitors 由注册表遍历构建；panelSnapshot.quotas 键 = 四 provider；refresh composite 覆盖全部（fake monitors 断言全被 refresh） |
| `test/commands.test.ts` | refresh 帮助文案与回执；show 概览行 |

**回归红线**：宿主无 qwen/deepseek key 时（快照恒 null），kimi/zai 路径与 dock 渲染与 v1.2.1 逐字节一致。

## 9. 版本与发布面

- 版本：v1.3.0（与语义命中确认闸合流）或拆 v1.4.0——**待用户裁定**（两特性零耦合，可独立发布；合流则一次验收）。
- 根 `CHANGELOG.md` + `README.md`/`README.en.md` 同提交（双语对，`AGENTS.md` 强制）：README「多 plan 配额」节升级为「用量/余额全覆盖」表述。
- `docs/router.md` 新节「用量与余额源」：注册表、四源契约锚点、qwen 取证记录、`balancePollMs`。
- cordis.patch.yml 注释块：`balancePollMs` 补一行（与 usagePollMs 同款文档化）。
- 实机验收清单（发布门槛）：
  - Q1 kimi/zai 双源行为与 v1.2.1 一致（回归探针）；
  - Q2 deepseek-official 余额实取：解码响应与面板 ¥ 额一致，tooltip 分项正确；`llm-deepseek.baseURL` 覆盖场景（若有代理）跟随；
  - Q3 qwen 用量：探针钉契约记录归档（router.md），面板两窗显示；钉不死则置灰留痕 + issue；
  - Q4 自适应切换：路由目标在 code plan 与 API 间切换，槽位形态正确切换无残影；
  - Q5 总览面板：四行齐、开合、Esc/外点关闭、读屏可遍历；
  - Q6 节奏：余额源 5min 轮询实测不超频（日志时间戳抽样）。

## 10. 未决与风险

| # | 项 | 处置 |
|---|---|---|
| 1 | qwen 无可用用量 API（取证充分：社区 Blocked + 本机 11 路径 404 + 401 对照证伪） | §5.2：默认按「无 API 面」如实标注；带 key 实测是唯一推翻路径，实施期征得同意后执行 |
| 2 | 北京区账号即便有 API 也可能 `ConsoleNeedLogin`（oh-my-pi #8509 + CodexBar 文档双重印证） | 同上归入「无 API 面」处置；不做 cookie 路径 |
| 3 | key 未配置 vs 取数失败不可区分（快照同为 null） | 本版总览分三态显示（§6.2：无 API 面/无凭据/取数失败）；拆分靠 descriptor 静态位 + 凭据可解析性，不需要新快照字段 |
| 4 | 余额低水位不告警 | 非目标（§2）；后续版若做，进决策可观测而非路由 |
| 5 | 60s 内多次面板取数命中同一快照 | 现状即如此（按需现读 + 2s 节流），不因本版改变 |
| 6 | 多币种展示 | 正文取首条，tooltip 全列；DeepSeek 实际单币种 CNY，过度设计风险低 |
| 7 | 无鉴权探测的 401 误读风险（本次差点误判端点存在） | 已写入 §5.2 对照实验记录；后续任何端点探测必须带「必然不存在」的对照组 |

---

## 11. v2 修订（2026-09-15 独立评审处置）

评审：`docs/audit/2026-09-15-review-quota-balance-coverage-spec-qwen-review.md`（qwen3.8-max；**1 严重 + 6 中等 + 4 轻微**；控制器复核 7 项必改全部成立、0 误报）。**本表即实施依据，与上文冲突处以本表为准。**

### 11.1 必改项处置

| # | 评审意见 | 处置（改后的设计） |
|---|---|---|
| **S1** | 三态（无 API 面 / 无凭据 / 取数失败）**没有数据通路**——`quotas` 只传「键是否存在 + 值是否 null」 | 面板投影**新增并列字段** `quotaSources: Array<{ provider, kind, state, reason? }>`（元数据/数据分离），`state ∈ 'ok' \| 'failed' \| 'no-credential' \| 'no-api'`。客户端据此渲染三态与注册表序；`quotas` 仍只承载快照（`QuotaLike \| null`）。**§10#3「不需要新快照字段」保留**——新增的是元数据而非快照字段 |
| **M1** | `UsageMonitor` 三处类型写死 `QuotaSnapshot`，「零改动」在类型层不成立（实施即编译报错） | `usage.ts` 三处拓宽为 `QuotaLike`：`parse?: (json, now) => QuotaLike \| null`、私有字段同型、`snapshot(): { quota: QuotaLike \| null }`。**内部逻辑零改动**（仍是「取数→存快照→节流通知」） |
| **M2** | `baseURL` 漏 `DEEPSEEK_BASE_URL` 环境层；且该名 bootstrap-only，第三方插件读不到 dsh-app-boot 的 environment 对象 | 取值链按 adapter 同源三段：settings `llm-deepseek.baseURL` → `process.env.DEEPSEEK_BASE_URL` → `https://api.deepseek.com`。**直读 `process.env`**（bootstrap 保证它在进程环境里），不走 settings/credentials 通道 |
| **M3** | 改造点漏三处；`usagePollOnStart` 与余额源的语义未定 | 三处一并改：① 凭据落盘监听（`credentials/reference-updated` → 全部源 refresh，**漏它则用户刚填的 key 要等一个轮询周期才亮**）② `usagePollOnStart` 门控的 `start()` ③ 停止 effect。**语义定死：`usagePollOnStart: false` 同时关停用量源与余额源**（不新增开关） |
| **M4** | 余额源超时 = `0.8 × pollMs`（300s 周期 ⇒ 单次挂起 240s） | descriptor 增 `timeoutMs?`；**余额源 15s**、用量源沿用 `0.8 × pollMs`。`UsageMonitor` 只增一个可选参数 |
| **M5** | `is_available` 语义写反（官方文档：**余额是否充足**） | 语义改「余额是否充足」；UI 文案 `余额不足`（title 补「余额不足以调用 API」） |
| **M6** | 契约边界写错位置（实时通道是 HTTP 路由，零 zod 校验） | §3 改写：**`types.ts` 是唯一契约**；实时路径（`index.ts` HTTP 路由 `JSON.stringify`）**无运行期守卫**，projection zod 自 v1.2.0 起只服务历史 fold（schema 同步为可选、为历史诚恳性）；§8 用例定位说明「schema 自测 ≠ 产品路径守卫」 |

### 11.2 轻微项处置

| # | 处置 |
|---|---|
| L1 `kind?: 'usage'` 可选判别键 | 采纳：**`QuotaSnapshot` 不加 `kind`**；判别只靠 `BalanceSnapshot.kind === 'balance'`（缺席即用量）——少改两个既有解析器，判别也干净 |
| L2 §8/§9 与 §5.2 未同步 | 采纳：qwen 行统一为「无 API 面」默认预期；带 key 探针列为**可选**动作 |
| L3 客户端分支顺序 | 采纳并写死：kind 分支**必须早于** `pct()`/剩余量计算（否则读 `weekly` 得 undefined） |
| L4 copy/a11y 收尾 | 采纳：refresh 按钮 title 中性化；余额槽 aria 文案与三态措辞一致 |

### 11.3 与其它在途项的关系

- **说明页签稿 §5⑤**：其展示措辞与本稿的 `state` 枚举**同源**（本稿定枚举，说明页只做措辞）；
- **Q5（Kimi monthly 口径）**：并入本稿实施时核查——若 `/coding/v1/usages` 不报月窗，面板会在月配额耗尽时仍显示「剩 N」，需在文档明说或补窗；
- 版本：随 v1.3.0 一起发（用户 2026-09-15 裁定「把前面的做完一起发」）。
