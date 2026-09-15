# 评审档案：用量/余额源全覆盖设计稿（2026-09-15，独立模型评审）

> **评审人**：**qwen3.8-max**（provider `qwen-token-plan-cn`；经 workflow 显式 provider/model 覆盖派发）
> **批次核对（2026-09-15）**：同批三份 spec 评审中**仅本份**的 `request/header` 确为 `qwen-token-plan-cn/qwen3.8-max`；另两份（语义闸、说明页签）实际落在 `zai-coding-cn/glm-5.3`，已在该两份档案头部加「更正记录」。差异根因见 `docs/superpowers/backlog.md` Q6。
> **评审对象**：`docs/superpowers/specs/2026-09-15-quota-balance-coverage-design.md`（246 行，commit `c189be5`）
> **评审结论**：**有条件同意**进入实施；成熟度 **可用级偏成熟**（核心架构判断成立，数据通路与类型契约有实质缺口）
> **独立性**：与作者（deepseek-flash）不同族；评审被要求「先独立形成结论，再读作者自评，最后给重合/分歧/自评漏项」——**无实质分歧，额外发现 1 条自评漏项**
> **证据基础**：spec + `usage.ts`/`zai-usage.ts`/`types.ts`/`projection.ts`/`index.ts`/`commands.ts`/`client/TideDock.tsx`/`client/index.ts`/`test/projection-quotas.test.ts` + 宿主 `dsh-llm-deepseek`、`dsh-app-boot` + DeepSeek 官方文档

---

## 1. 评审报告全文（评审模型产出，未删改结论）

**结论**：**有条件同意**进入实施；成熟度 **可用级偏成熟**（核心架构判断成立，但数据通路与类型契约有实质性缺口，封堵后可达成熟级）。

### 严重

**S1 · 三态区分在给定数据模型下不可实现**
· §6.2 要求总览面板区分「无 API 面 / 无凭据 / 取数失败」三态，§10#3 断言「不需要新快照字段」；但唯一数据通道 `quotas: Record<string, QuotaLike|null>` 只传递「键是否存在」与「值是否 null」——客户端拿不到 reason、也拿不到凭据状态位。`TideDock.tsx:287-296` 实证：`Object.hasOwn(panel.quotas, targetProvider)` + `?? null` 是唯一消费路径，null 就是 null，无法再分。
· 证据：`types.ts:81`（`quotas?: Record<string, QuotaSnapshot | null>`）、`TideDock.tsx:288-290`（取值逻辑）、`index.ts:594-597`（组装点只有 monitor.snapshot().quota）。
· 建议：新增并列元数据字段（如 `quotaSources: Array<{provider, kind, state, reason?}>`），或扩展 quotas 值域为 discriminated union 含 `unavailable` / `no-credential` 变体。两者都不需要改 `QuotaSnapshot` 本身，§10#3 的「不需要新快照字段」可保留但必须补上元数据来源。

### 中等

**M1 · UsageMonitor 类型签名不支持 BalanceSnapshot——「零改动」主张不成立**
· §4 行110 称「UsageMonitor 零改动」，但 `usage.ts:21` 的 `parse` 类型为 `(json: unknown, now: number) => QuotaSnapshot | null`，`:36` 私有字段同型，`:81` `snapshot()` 返回 `{ quota: QuotaSnapshot | null }`。余额解析器返回 `BalanceSnapshot` 会被 TS 拒绝。至少需将三处类型拓宽为 `QuotaLike`。
· 证据：`usage.ts:21,36,81`。
· 建议：明确列出 UsageMonitor 的类型改动面（3 处签名 + snapshot 返回形），并评估对既有 kimi/zai 调用点的类型影响。

**M2 · baseURL 取值链漏 DEEPSEEK_BASE_URL 环境层**
· §4.1 写 `<llm-deepseek.baseURL ?? https://api.deepseek.com>`，真实优先级是 `config.baseURL ?? process.env.DEEPSEEK_BASE_URL ?? https://api.deepseek.com`（`dsh-llm-deepseek/lib/index.js:1992`）。且 `DEEPSEEK_BASE_URL` 属 bootstrap-only 名（`dsh-app-boot/lib/index.js:987`），`.env`/settings 均设不了，只来自启动继承环境。按稿实现，代理/中转用户的余额请求会打到官方域。
· 证据：`dsh-llm-deepseek/lib/index.js:1992`（`config.baseURL ?? environment?.get(BASE_URL_ENV)?.value ?? "https://api.deepseek.com"`）、`dsh-app-boot/lib/index.js:987`（BOOTSTRAP_NAMES 含 DEEPSEEK_BASE_URL）。
· 建议：§4.1 写明三段优先级并与 adapter 同源；测试补该用例。注意：kimi-tide 作为第三方插件无法直接读 dsh-app-boot 的 environment 对象，可能需要通过 `process.env.DEEPSEEK_BASE_URL` 直读（bootstrap 保证它在 process.env 里）。

**M3 · 改造点清单遗漏三处按源展开的接线点**
· §4「编排变化」（行110）只列了遍历建 monitors 和命令 composite。实读 index.ts 另有三处必须改：① `:654-660` `credentials/reference-updated` 监听（当前硬编码 `monitor.refresh(); zaiMonitor.refresh()`），漏改则余额源凭据落盘后不即时生效；② `:852-856` `usagePollOnStart` 门控的 `start()` 调用；③ `:857-860` 停止 effect。且余额源是否受 `usagePollOnStart` 管未定义。
· 证据：`index.ts:654-660,852-860`。
· 建议：三处并入改造清单；明确 `usagePollOnStart=false` 同时关停余额源（不新增开关）。

**M4 · 余额源超时预算缺失，有挂起风险**
· `UsageMonitor` 超时 = `0.8 × pollMs`（`usage.ts:93-95`）。balancePollMs=300s ⇒ 单次挂起最长 240s，期间 in-flight 去重（`:57-69`）折叠所有刷新。稿只定义了节奏没定义超时上限。
· 证据：`usage.ts:93-95`（`AbortSignal.timeout(Math.max(1, Math.floor(this.options.pollMs * 0.8)))`）。
· 建议：descriptor 增 `timeoutMs?`，余额源给 15s 量级；或在 UsageMonitor 内按 `min(pollMs*0.8, maxTimeout)` 钳制。

**M5 · `is_available` 语义误读**
· §3 注释（行72）写「账号是否可用」，§6.1 UI 文案写「（账号不可用）」。DeepSeek 官方文档原文是「Whether the user's balance is sufficient for API calls」= **余额是否充足**，不是账号状态。
· 证据：[DeepSeek API docs](https://api-docs.deepseek.com/api/get-user-balance/)。
· 建议：语义改「余额是否充足」；UI 文案改「余额不足」。

**M6 · 实时面板通道无运行期校验——契约边界归属错误**
· §3 行82 把 zod schema 当作新字段的守卫。实际实时快照走 `index.ts:694-708` HTTP 路由 → `JSON.stringify({ok:true, panel: rememberPanel(agent)})`，**零 zod 校验**。客户端 `client/index.ts:141-156` 仅 `as` 类型断言 + 手写 ok 分支。projection zod 自 v1.2.0 起只服务历史会话 fold（`projection.ts:13-18` 自述）。
· 证据：`index.ts:706`（`JSON.stringify` 直出）、`client/index.ts:151`（`as { ok?, error?, panel? }`）、`projection.ts:13-18`（v1.2.0 解耦声明）。
· 建议：§3 改写为「types.ts 是唯一契约；projection schema 同步为可选（历史兼容）；实时路径无运行期守卫」。§8 测试用例定位说清楚（schema 自测 ≠ 产品路径守卫）。

### 轻微

**L1 · `kind?: 'usage'` 可选判别字段是 TS 反模式** — §3 行81 给 QuotaSnapshot 加 `kind?: 'usage'`。可选判别键使 `snap.kind === 'usage'` 无法排除 undefined 分支。且「新快照一律写 kind」隐含要改 kimi/zai 两个既有解析器，改造清单未列。建议：QuotaSnapshot 不加 kind；QuotaLike 判别靠 `'balances' in snap` 或只让 BalanceSnapshot 带 `kind: 'balance'`。少改两个解析器。

**L2 · §8/§9 与 §5.2 结论未同步** — §8 行214 仍写「qwen parser 契约钉死后…」，§9 Q3 行231 仍写「面板两窗显示」。§5.2 已结论 qwen 默认无 API 面。建议统一改为「无 API 面」默认预期，带 key 探针列为可选动作。

**L3 · 客户端分支顺序未点明** — `TideDock.tsx:299-302` 无条件计算 `weekly/fiveHour` 的 pct 与剩余量。balance 快照没有这些字段，kind 分支必须在这些行之前。TS 会拦但稿里写明可省踩坑。

**L4 · copy/a11y 收尾不全** — `TideDock.tsx:453` refresh 按钮 title「刷新配额」需中性化；余额槽 aria 文案要与三态措辞一致。

### 未覆盖的失败模式

| # | 失败模式 | 稿件应补位置 |
|---|---|---|
| 1 | 网关/中转不实现 `/user/balance` → 404 → 与「无凭据」不可分 | §6.2 + S1 修好后自然可分 |
| 2 | 密钥有效但无权访问计费接口（403）| §6.2 三态应含「有凭据但被拒」 |
| 3 | 宿主/客户端版本错配时 balance 字段被旧 bundle 静默忽略 | §3 契约边界节 |
| 4 | UsageMonitor 类型不兼容 BalanceSnapshot（编译期阻断） | §4 改造清单 |
| 5 | 余额陈旧度无上界提示（stale 仅标记最近一次失败） | §6.2 可选标注 |

### 应保留的优点

- DeepSeek 余额契约经官方文档逐字段实证，§5.1 可直接进实现；
- qwen 取证链扎实且克制：社区 Blocked + 本机 11 路径 404 + 401 对照证伪，方法论严谨；
- 「不得用本地观测估算账号配额」写入非目标——宁缺勿假；
- 向后兼容策略正确：缺席 ≠ 非法、旧载荷回落 usage；
- 复用 UsageMonitor 注入面思路正确（虽然类型需拓宽）；
- ⑥-B「结构恒定防跳动」语义延续到新槽位；
- 非目标划分克制（不做 cookie / 不做自定义源 / 不做告警 / 不做 per-model）。

### 与既有自评的关系

**重合**：S1（三态无通路）、M2/baseURL 漏 env 层、M3/接线点不全、M4/超时预算、M5/is_available 语义、M6/契约边界归属、L1-L4 —— 本评审与自评在这些问题上**独立得出相同结论**，证据链互相印证。

**分歧**：无实质分歧。本评审额外发现 **M1（UsageMonitor 类型签名不兼容）**，自评未提及此点——自评 A 表 #1 只验证了「注入式通用轮询器」的 options 面，未核查 parse/snapshot 的返回类型签名。这是一个实施时会直接编译报错的问题，应补入必改清单。

**自评漏掉但本评审认为重要的**：
1. UsageMonitor 的 `parse` / `snapshot` 类型签名为 `QuotaSnapshot` 而非 `QuotaLike`，「零改动」主张在类型层面不成立（上述 M1）；
2. `DEEPSEEK_BASE_URL` 是 bootstrap-only 这一事实的具体含义：kimi-tide 作为第三方插件无法通过 dsh-app-boot 的 environment 接口读取它，只能直读 `process.env.DEEPSEEK_BASE_URL`——这需要在 §4.1 的实现指引中明确写出，否则实施者可能尝试走 settings 或 credentials 通道而碰壁。

**自评的可信度评估**：自评质量较高，主动标注了独立性弱、建议再派独立评审。其核心发现（S1、baseURL、契约边界）均经本评审源码核实确认。唯一盲区是类型层面的兼容性检查——这正是「作者自己的隐含假设」类盲区的典型案例（假设 UsageMonitor 天然接受任何返回类型）。

---

## 2. 控制器逐项复核（DSH 主 agent，2026-09-15）

| # | 评审意见 | 复核结论 | 本次实读证据 | 处置 |
|---|---|---|---|---|
| S1 | 三态无数据通路 | **成立**（三方独立同结论：作者自评 + 中断的 k3 轮 + 本轮） | `types.ts:81`；`TideDock.tsx:287-296` | **必改**：补 `quotaSources` 元数据 |
| M1 | `UsageMonitor` 类型不接受 `BalanceSnapshot`，**「零改动」不成立** | **成立（新发现）** | `usage.ts:21` `parse?: (...) => QuotaSnapshot \| null`；`:36` 私有字段同型；`:81` `snapshot(): { quota: QuotaSnapshot \| null }` | **必改**：三处类型拓宽为 `QuotaLike`（实施时即编译报错） |
| M2 | baseURL 漏 `DEEPSEEK_BASE_URL` 层 | **成立** | `dsh-llm-deepseek/lib/index.js:1992` 三段链；`dsh-app-boot` 的 BOOTSTRAP_NAMES | **必改**：三段优先级 + 直读 `process.env` 的实现指引 |
| M3 | 接线点漏三处 | **成立** | `index.ts:654-660`（凭据落盘监听）、`:852-856`、`:857-860` | **必改** |
| M4 | 超时预算缺失 | **成立** | `usage.ts:93-95`（`0.8 × pollMs`） | **必改** |
| M5 | `is_available` 语义误读 | **成立** | DeepSeek 官方文档原文（控制器亦实拉过同一文档核对） | **必改** |
| M6 | 契约边界归属错误 | **成立** | `index.ts:706`（`JSON.stringify` 零校验）、`client/index.ts:151`（`as` 断言） | **必改** |
| L1-L4 | 表述与完备性 | **成立/合理** | `config.ts` 两个既有解析器确需改或改为不加 kind | 采纳，进 v2 |
| 「无实质分歧 + M1 为自评盲区」 | 交叉验证结论 | **采纳** | — | 记入 v2 头部 |

**结论**：评审意见 **7 项必改全部成立、0 条误报**；新增 1 条自评盲区（M1 类型契约）。本稿与作者自评合并后出 **v2**。
