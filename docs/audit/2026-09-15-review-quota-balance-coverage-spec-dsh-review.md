# 评审档案：用量/余额源全覆盖设计稿（2026-09-15）

> **评审人**：DSH 主 agent（deepseek-flash）——**自评，非独立评审**（作者即评审者，独立性弱于仓库惯例：09-11 由独立模型 k3 评审、09-04 由 kimi 评审；见 §1.D 的建议）
> **评审对象**：`docs/superpowers/specs/2026-09-15-quota-balance-coverage-design.md`（v1，246 行，commit `c189be5`）
> **评审结论**：**有条件同意**进入实施（条件见 §1.D）；成熟度 **可用级偏成熟**（封堵 S1/S2 后可达成熟级）
> **证据基础**：评审实读 9 个源码/测试文件（`usage.ts`、`zai-usage.ts`、`types.ts`、`projection.ts`、`projection-quotas.test.ts`、`index.ts` 四段、`TideDock.tsx` 三段、`client/index.ts` 两段）+ `dsh-llm-deepseek/lib/index.js`（key/baseURL 链）+ `dsh-app-boot/lib/index.js`（env 层策略）；外网取证 2 次（DeepSeek 官方余额文档全文、阿里 token plan 端点探针含对照组）

---

## 1. 评审报告

### A. 稿件核心主张逐项复核

| # | 稿件主张 | 结论 | 证据 / 反证 |
|---|---|---|---|
| 1 | `UsageMonitor` 是注入式通用轮询器（§1 行18） | **成立** | `usage.ts:13-26` options 面 `{pollMs, onUpdate, resolveKey, url?, parse?, fetchFn?, now?}` |
| 2 | kimi/zai 双源既有形态（§1 行19） | **成立** | `usage.ts:8` URL；`zai-usage.ts:12` URL + `:28-53` 双形态解析 |
| 3 | `resolveProviderKey` 三段解析（§1 行20） | **成立** | `index.ts:325-343`（settings `llm-pi-ai.providers.<id>.apiKeyEnv` → `credentials.resolve` → `process.env`） |
| 4 | `quotas: Record<string, QuotaSnapshot\|null>`（§1 行21、§3 行82） | **成立** | `types.ts:81`；组装 `index.ts:594-597` |
| 5 | **zod schema（`projection.ts:60`）是新字段的校验边界（§3 行82）** | **不成立（归属错误）** | 实时通道 = `index.ts:694-708` HTTP 路由，`JSON.stringify({ok,panel})` **零校验**；客户端 `client/index.ts:141-160` 仅 `as` 断言 + 手写分支；projection zod 自 v1.2.0 起**只服务历史会话 fold**（`projection.ts:13-18` 自述），历史载荷全是 usage ⇒ union 非必需。`projection-quotas.test.ts:27-32` 是**直接调用 wire.viewSchema** 的 schema 单测，不构成实时路径有守卫的证据 |
| 6 | deepseek key/baseURL 来自 `llm-deepseek` 节（§1 行35、§4 表行108、§4.1 行121） | **部分成立** | `apiKeyEnv` 成立（`:1885` schema 默认 `DEEPSEEK_API_KEY`、`:1992` `credentialRef`）；**baseURL 链不完整**：真实优先级 `config.baseURL ?? env DEEPSEEK_BASE_URL ?? https://api.deepseek.com`（`:1992`；`BASE_URL_ENV="DEEPSEEK_BASE_URL"`），且该名属 `dsh-app-boot` 的 `BOOTSTRAP_NAMES`（**只来自启动环境，不进 .env/settings**） |
| 7 | DeepSeek `/user/balance` 契约（§5.1 行132-142） | **成立（逐字段实证）** | 官方文档全文实拉：`GET /user/balance`；`is_available` boolean；`balance_infos[]`：`currency`(CNY\|USD)/`total_balance`/`granted_balance`/`topped_up_balance` 全字符串；示例与稿内 JSON 一致 |
| 8 | qwen「无 API 面」取证链（§5.2） | **成立** | pi-usage-bars `provider-research.md`（Blocked + 8 路径 404 + 无配额头 + 禁止估算警告）实拉；CodexBar 文档实拉（Coding Plan ≠ Token Plan + cookie + `ConsoleNeedLogin`）；本机 11 路径 404 + 401 对照证伪（本次评审复现对照组：deepseek 侧同款「对照也 401」） |
| 9 | 投影 wire 承载新字段（§7、§8 测试行） | **部分成立** | 实时路径不经 wire；历史路径经 wire 但不需要 balance 分支。⇒ §8「union 快照往返」用例测的是 schema 自身，不是产品路径 |
| 10 | 锚点准确性（全文行号引用） | **成立** | 抽检 12 条（`usage.ts:13-26/71-79/93-95`、`zai-usage.ts:28-53`、`index.ts:330-343/594-597/694-708/658-659/852-860`、`TideDock.tsx:284-296/391-422/463-477`、`commands.ts:142`、`projection.ts:57-60`、`types.ts:81`）**全部命中** |

### B. 分级问题清单

**严重**

- **S1 · 「三态显示」无数据通路——本稿最新、最重要的改进在实现层落空**。§6.2（行190-193）要求总览区分「①无 API 面／②无凭据／③取数失败」三态，§10#3（行242）断言「拆分靠 descriptor 静态位 + 凭据可解析性，**不需要新快照字段**」——但 §3 定义的唯一通道是 `quotas: Record<string, QuotaLike|null>`：客户端只拿得到「有没有这个键」与「值是不是 null」（`TideDock.tsx:287-296` 逐行实证：`Object.hasOwn` + `?? null`），**拿不到 reason、也拿不到凭据位**。按稿实现，qwen 行只能显示笼统「无数据（key 未配置或取数失败）」——正是 §5.2 花整节想要避免的误导。
  **处置（二选一，推荐 B）**：**A** `quotas` 值域扩变体 `{ kind:'unavailable', reason } | { kind:'no-credential' }`；**B**（推荐，元数据/数据分离，且总览列表不再依赖「null 也占键」的隐含约定）新增并列字段 `quotaSources: Array<{ provider, kind, state:'ok'|'failed'|'no-credential'|'no-api', reason?: string }>`——随 panel 快照下发，客户端据此渲染三态与注册表序。两方案都不需要新**快照**字段，§10#3 的结论可保留、但必须补上「元数据从哪来」。

**中等**

- **S2 → M 级 · baseURL 取值链漏 env 层**（§4 表行108、§4.1 行121）：稿写 `<llm-deepseek.baseURL ?? 官方>`，真实链是 `config.baseURL ?? DEEPSEEK_BASE_URL ?? 官方`（`dsh-llm-deepseek/lib/index.js:1992`），且 `DEEPSEEK_BASE_URL` 是 bootstrap-only（`.env`/settings 均设不了）。按稿实现，用户改了 `DEEPSEEK_BASE_URL`（走代理/中转）时余额会打到官方域：轻则 401/404 → 显示「无数据」，重则**显示另一账号视图**。
  **处置**：§4.1 明确三段优先级（settings 节 → `process.env.DEEPSEEK_BASE_URL` → 官方），与 adapter 同源；测试表补该用例。
- **M1 · 契约边界写错位置**（见 A 表 #5）：稿把 zod 当新字段的守卫，实际**实时路径零运行期校验**，唯一守卫是同 build 的 TS 类型。后果：宿主/客户端版本错配（旧 bundle 或半更新）时静默渲染错，比抛错更难查。
  **处置**：§3 改写为「`types.ts` 是唯一契约；projection schema 同步为可选（历史诚恳性）；实时路径无运行期守卫——客户端建议对 `kind` 做一次轻量分支守卫（缺省当 usage）」，并在 §8 把「union 往返」用例的定位说清楚（schema 自测，不是产品路径）。
- **M2 · 目标与 §5.2 自相矛盾**：§2 目标 1（行43）、用户裁定表 #3（行12）、§1 关键事实（行37 尾）都写「**四源收齐**」，而 §5.2 结论是 qwen **默认无 API 面、置灰**。实施者可能被驱动去硬找一个不存在的端点（正是本稿 §5.2 劝退的行为）。
  **处置**：统一改为「**四 provider 全覆盖：三源实取 + 一源如实标注（无 API 面）**」；§9 验收 Q3 同步（见 m2）。
- **M3 · 改造点清单不全**：§4「编排变化」（行110）只列了「遍历建 monitors」与命令 composite，实读 `index.ts` 有**三处**按源展开：① `:654-660` **凭据落盘即生效**监听（`credentials/reference-updated` → `void monitor.refresh(); void zaiMonitor.refresh()`）——漏这处的后果对余额源格外重：用户刚填进 DeepSeek key 后面板要等到下一个 5min tick 才亮，与既有「凭据落盘即生效」承诺相悖；② `:852-856` `usagePollOnStart` 门控的 `start()`；③ `:857-860` 停止 effect。且**余额源是否受 `usagePollOnStart` 管未定义**。
  **处置**：三处并入清单；`usagePollOnStart=false` 的语义写死（建议：同时关停余额源，不新增开关——YAGNI）。
- **M4 · 余额源超时预算缺失**：`UsageMonitor` 的超时 = `0.8 × pollMs`（`usage.ts:93-95`）。balancePollMs=300s ⇒ 单次挂起最长 **240s**，且 in-flight 去重（`:57-69`）会把期间所有刷新折叠进那一次。稿只定义了节奏，没定义超时。
  **处置**：descriptor 增 `timeoutMs?`，余额源给 15s 量级；或按 `min(pollMs*0.8, 15_000)` 钳制。`UsageMonitor` 改动仍限于新增可选参数。
- **M5 · `is_available` 语义写反了**：官方文档原文「**Whether the user's balance is sufficient for API calls**」= **余额是否够用**，不是「账号是否可用」。§3 注释（行72）与 §6.1 UI 文案「（账号不可用）」（行172）都会向用户说假话——恰是本稿反复强调要避免的事。
  **处置**：语义改「余额是否充足」；UI 文案 `余额不足`，title 补「余额不足以调用 API」。

**轻微**

- **m1 · `kind?: 'usage'` 可选判别字段是 TS 反模式**（§3 行81）：判别键不该可选（`'usage'` 分支永远窄化不到，`snap.kind === 'usage'` 无法排除 undefined）。且「新快照一律写 kind」隐含要改 kimi/zai 两个既有解析器，清单未列。**建议**：`QuotaSnapshot` 不加 kind；`QuotaLike = QuotaSnapshot | BalanceSnapshot`，只让 balance 带 `kind`，读侧用 `snap.kind === 'balance'` 或 `'balances' in snap` 守卫——少改两个解析器，判别也干净。
- **m2 · §8/§9 与 §5.2 未同步**：§8（行214）仍写「qwen parser 契约钉死后…」、§9 Q3（行231）仍写「面板两窗显示；钉不死则置灰」。两处默认预期应改为「无 API 面」，带 key 探针列为可选动作。
- **m3 · 客户端分支顺序未点明**：`TideDock.tsx:299-302` 在拿到快照后**先无条件**计算 `weekly/fiveHour` 的 pct 与剩余量；balance 快照没有这两个字段 → 分支必须在这几行**之前**。TS 会拦（类型面），但稿里写明可省一次踩坑。
- **m4 · `stale` 不等于陈旧度**：`stale` 仅在「本次刷新失败」时置位（`usage.ts:71-79`），不是「距上次成功超过 N 个周期」。余额源 5min 周期下，最坏可见 ~10min 前的余额且无任何提示。**建议**：总览行已有取数时钟（够用），可选加「超 2× 周期未更新」的轻标注。
- **m5 · 收尾 copy/a11y 未列全**：`refresh` 按钮 title「刷新配额」（`TideDock.tsx:453`）需随语义中性化；余额槽与总览 chip 的 aria 文案要与三态措辞一致（稿内只提了 `aria-expanded`）。

### C. 未覆盖失败模式

| # | 失败模式 | 处置归属 |
|---|---|---|
| 1 | 三态无数据通路（功能级） | S1 |
| 2 | baseURL 指向网关：网关不实现 `/user/balance` → 404 → 与「无凭据」不可分 | S2 + S1（修好 S1 后自然可分） |
| 3 | 密钥有效但无权访问计费接口（403） | 与 ② 同源：S1 的 state 位需含「有凭据但取数被拒」 |
| 4 | 宿主/客户端版本错配无运行期守卫 | M1 |
| 5 | 余额陈旧度无上界提示 | m4 |
| 6 | `usagePollOnStart` 与余额源语义未定 | M3 |

### D. 结论

**有条件同意**进入实施，条件：

1. **封堵 S1**：补元数据通路（推荐 `quotaSources` 并列字段，state 至少含 `ok|failed|no-credential|no-api`），使 §6.2 三态可实现；
2. **修 M2（原 S2）**：baseURL 三段优先级与 adapter 同源（settings → `DEEPSEEK_BASE_URL` → 官方），测试补该用例；
3. **改 M2 措辞**（四源收齐 → 三源实取 + 一源如实标注）与 **M5 语义/文案**（余额不足，非账号不可用）；
4. **补 M1/M3/M4**：契约边界归属、三处接线点 + `usagePollOnStart` 语义、超时预算；
5. **m1/m2 一并对齐**（判别字段收窄 + §8/§9 与 §5.2 同步）。

**独立性声明（必须记入）**：本次为**自评**。仓库惯例是独立模型评审（09-11 k3 / 09-04 kimi），自评的盲区恰在「作者自己的隐含假设」——本稿 A 表 #5（把 zod 当契约边界）就是这类错误，是**核源码**才发现的，不是靠再审一遍稿子。**建议**：本自评作第一轮，实施前再派一次独立模型评审（成本约一次会话）；或由用户明确接受自评并承担该风险。

### E. 应保留的优点（不得在改稿时丢失）

- **DeepSeek 契约经官方文档逐字段实证**（非二手转述），§5.1 可直接进实现；
- **qwen 取证链扎实且克制**：社区 Blocked 结论 + 本机 11 路径 404 + **401 对照证伪**（方法论上加分），并把「不得用本地观测估算账号配额」写进非目标——宁缺勿假；
- **向后兼容策略正确**：缺席 ≠ 非法、旧载荷回落 usage，与 1.1.0/0.6.0 的既有兼容手法一致；
- **复用 `UsageMonitor` 注入面、不改其内部**：改动面小、测试缝现成；
- **⑥-B「结构恒定防跳动」语义延续到新槽位**：UI 稳定性思考到位；
- **非目标划分克制**：不做自定义源配置面、不做 cookie 路径、不做余额告警、不做 per-model——YAGNI 判断准确。

---

## 2. 逐项复核与处置（评审人 = 作者时的自查替代）

> 依 `docs/agent-collaboration-loop.md` §3.4 精神：审查者也会误报，**每条先核源码再决定是否进修复循环**。本次每条均已带行号证据（§1.A/B），无需二次核实；下表只登记「是否改稿」的决定。

| # | 意见 | 复核结论 | 处置 |
|---|---|---|---|
| S1 | 三态无通路 | 成立（`types.ts:81` + `TideDock.tsx:287-296` 双证） | **必改稿**：补 `quotaSources` 元数据通路（或 A 变体） |
| M2(S2) | baseURL 漏 env 层 | 成立（`dsh-llm-deepseek:1992` + app-boot `BOOTSTRAP_NAMES`） | **必改稿**：三段优先级 |
| M1 | 契约边界归属错误 | 成立（`index.ts:706` 零校验 + `client/index.ts:141-160` as 断言） | **必改稿**：§3 重写 + §8 用例定位 |
| M2 | 「四源收齐」自相矛盾 | 成立 | **必改稿**：措辞统一 |
| M3 | 接线点清单不全 | 成立（`index.ts:658-659/852-860`） | **必改稿**：补三处 + 开关语义 |
| M4 | 超时预算缺失 | 成立（`usage.ts:93-95`） | **必改稿**：descriptor 增 `timeoutMs` |
| M5 | `is_available` 语义写反 | 成立（官方文档原文） | **必改稿**：语义 + UI 文案 |
| m1 | 可选判别字段 | 成立（TS 语义） | 建议改（收窄为只 balance 带 kind） |
| m2 | §8/§9 未与 §5.2 同步 | 成立 | **必改稿** |
| m3 | 客户端分支顺序 | 成立（`TideDock.tsx:299-302`） | 建议改（写明顺序） |
| m4 | `stale` 语义边界 | 成立 | 建议改（可选标注） |
| m5 | copy/a11y 收尾 | 成立（`TideDock.tsx:453`） | 建议改 |

**结论**：7 项必改 + 5 项建议改，均不需推翻设计骨架——**注册表 + 自适应槽 + 总览面板的主体判断成立**，问题集中在「元数据通路、契约边界表述、取值链完整性、文案准确性」四处。
