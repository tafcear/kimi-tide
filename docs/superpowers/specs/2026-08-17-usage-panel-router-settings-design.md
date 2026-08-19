# kimi-tide 0.2.0 扩展设计 — 用量显示 · 路由设置面板 · 推理状态

> 状态：设计已确认（2026-08-17，逐节 OK）
> 实施状态（2026-08-19 更新）：✅ 0.2.x 面板已落地 main（M3.5-M3.7，当时设置为行级回写 patch yml）；0.3.0 起设置持久化迁至 sidecar 文件、面板升级为 v3（候选管理/评分滑杆/决策理由）——现时架构见 `packages/dsh-kimi-tide/docs/router-v3.md`
> 上游计划：[`../../development-plan-router.md`](../../development-plan-router.md)（M1 草稿已存在）
> 本文档为 0.2.0 的**增量设计**：在原路由器计划之上新增三个用户可见能力。

---

## 1. 需求与范围

| 需求 | 结论 | 工作量 |
|---|---|---|
| Kimi Code 用量显示 | **官方配额（`GET /coding/v1/usages`）+ 本地 token 统计**，两者都展示 | 新增 |
| 推理过程显示 | **DSH Web 已原生渲染 reasoning-delta**（实测确认），kimi-tide 的 `stream.ts` 已对接；面板仅加一行状态提示 | 零（仅 UI 提示） |
| 路由行为设置面板 | 会话区新标签页（复用 bridge 验证过的 `conversation.view` slot），**回写配置文件持久化** | 新增 |

### 1.1 已验证的外部事实

- **官方配额接口实测 200**：`GET https://api.kimi.com/coding/v1/usages`，Bearer = 插件已持有的 OAuth access_token。返回 `usage`（周配额 used/limit/resetTime）、`limits[]`（5 小时窗口）、`user.membership.level`（会员等级）。参考：[kimi-code-usage](https://github.com/Golden0Voyager/kimi-code-usage)、[OpenTokenUsage kimi 文档](https://github.com/PowerUserZ/OpenTokenUsage/blob/main/docs/providers/kimi.md)。
- **客户端双端机制**：`vendor/dsh-kimi-bridge` 已验证完整链路——host 注册 session projection（`kimi/sessions`），browser 通过 `ctx.slots.register('conversation.view', …)` 注册 React 标签页，esbuild 打包 `lib/client.js` 挂 `window.__ModuleLoader__`。
- **用户 patch 文件**：`$DSH_HOME/profiles/web/cordis.patch.yml` 已存在且含大量其他插件行（MCP 等），改动必须是**行级局部替换**，不能全量重写。

### 1.2 非目标（本扩展明确不做）

- ❌ 月度额度（`totalQuota` 为空；月额度需 WebBridge 浏览器扩展，超范围）
- ❌ 跨设备/跨进程用量汇总（本地统计仅本进程内存 + 可选当日持久化到 `$DSH_HOME`）
- ❌ 推理过程的自定义渲染面板（依赖 DSH 原生；未来 DSH 改渲染再议）
- ❌ 设置面板的 settings 页面 slot（未验证存在；用 conversation.view）

---

## 2. 架构

```
┌─ host (dsh-kimi-tide, Node) ──────────────────────────────┐
│ index.ts      apply(): 装配下列全部单元                     │
│ ├─ usage.ts    UsageMonitor                                │
│ │   ├─ 轮询 GET /coding/v1/usages（60s + 手动刷新）         │
│ │   └─ 拦截 adapter usage chunk → 本地 token 桶（今日/总会话）│
│ ├─ settings.ts RouterSettingsStore                         │
│ │   ├─ 读/行级写 $DSH_HOME/profiles/web/cordis.patch.yml   │
│ │   └─ 校验（schemastery）→ 重建 KimiRouter（即时生效）      │
│ ├─ projection.ts kimiTideProjectionDefinition              │
│ │   key 'kimi-tide/panel'，whole-value 推送                 │
│ └─ (M1-M3) router.ts + index.ts 集成（上游计划已有）        │
└──────────────┬────────────────────────────────────────────┘
               │ session/projection frames（框架自带通道）
┌──────────────▼────────────────────────────────────────────┐
│ browser (dsh-kimi-tide client bundle)                      │
│ client/index.ts   slots.register('conversation.composer.dock',│
│                   { id:'kimi-tide' }, TideDock)            │
│ client/TideDock.tsx   composer 下方紧凑面板（非整页标签）    │
│   ├─ 模式 toggle：off/cost/capability（segmented 按钮）      │
│   ├─ 当前路由 chip + 预算占用                                │
│   ├─ 用量行：周配额 / 5h窗口（百分比 + 重置倒计时 + 变色阈值）│
│   ├─ 本地 token 行：miss/out/cache%（仿 dsh-model-router）  │
│   ├─ <details> 展开：会员等级 + 完整路由设置表单             │
│   └─ 推理状态行："推理输出已启用（DSH 原生渲染）"            │
└────────────────────────────────────────────────────────────┘
```

**关键取舍**：面板数据走 **session projection**（框架自带推送，bridge 已验证），不新增 HTTP 端点、不新增 WebSocket。配置回写用**行级文本锚点替换**（js-yaml 全量 parse→dump 会丢用户注释，不可接受）。

### 2.1 形态修订（2026-08-17，检索后）

**从 `conversation.view` 整页标签页改为 `conversation.composer.dock` 紧凑面板**。依据两个已验证的先例：

| 先例 | 证明了什么 |
|---|---|
| [dsh-model-router](https://github.com/tianji-qingtian/dsh-model-router) | dock slot 注册方式；**`ctx.remote.commands.execute(sessionId, '/cmd')` 作为 client→host 通道（零自定义协议）**；projection 驱动的实时 token/cache/成本面板；`locale` 服务 i18n；`<style data-plugin>` 样式注入 |
| [dsh-opencode-go-usage](https://github.com/v587d/dsh-opencode-go-usage) | 订阅用量 chip 形态（`5h 0% (1h23m) · wk 65%`）；80%/90% 变色阈值；`upd HH:MM` 新鲜度；host 缓存 + 失败冷却；**界面内 Set 面板持久化配置** |

理由：dock 与内置 token 统计同位、无需切标签页、常态可见——比整页标签更适合"用量一眼看 + 模式随手切"。完整路由表单收进 `<details>` 展开区，保持 dock 紧凑。

---

## 3. 组件设计

### 3.1 `usage.ts` — UsageMonitor

```ts
interface QuotaSnapshot {
  weekly: { used: number; limit: number; resetTime: string }      // usage
  fiveHour: { used: number; limit: number; resetTime: string }    // limits[0] (300min)
  membershipLevel: string                                          // user.membership.level
  fetchedAt: number                                                // 本地时戳
  stale: boolean                                                   // 上次刷新是否失败
}
interface LocalTokenStats {
  today: TokenUsage        // 按自然日归零
  session: TokenUsage      // 进程生命周期累计
  calls: number
}
```

- 轮询：60s（可配 `usagePollMs`），`refreshOnStart` 后立即拉一次
- 本地统计来源：`stream.ts` 已 yield `{ type:'usage', usage }`；在 adapter 外层包一个 tap（不改动 stream 翻译层）或监听 `agent/response` 事件——**实现时二选一，优先 tap（不依赖事件时机）**
- 失败兜底：401 → 触发 `oauth.refresh()` 重试一次；仍失败 → `stale: true`，UI 灰化并显示"凭据失效，请 kimi login"

### 3.2 `settings.ts` — RouterSettingsStore

- **读**：启动时解析用户 patch yml，提取 `dsh-kimi-tide` 行的 `config.router` 段（缺省 = `mode: 'off'`）
- **写**（面板保存）：
  1. schemastery 校验 RouterConfig
  2. 读文件 → 行级锚点定位 `id: dsh-kimi-tide` 的 `config:` 块
  3. 替换/插入 `router:` 子段（保持其他行与注释原样）
  4. 原子写回：写 `.tmp` → `rename`；写前复制 `.bak`
  5. 内存中重建 `KimiRouter`（当前会话即时生效）
- **锚点策略**：正则匹配 `- id: dsh-kimi-tide` 行 → 向下找同级 `config:` → 在其缩进块内操作 `router:` 键。找不到行则 append 完整 insert 块。

### 3.3 `projection.ts` — 面板数据通道

- key：`'kimi-tide/panel'`
- whole-value payload：
  ```ts
  interface KimiTidePanelProjection {
    quota: QuotaSnapshot | null
    local: LocalTokenStats
    router: RouterConfig            // 当前生效配置（面板表单初值）
    reasoning: { enabled: true }    // 静态状态行
  }
  ```
- 推送时机：quota 刷新后 / 本地 token 桶变化后（节流 2s）/ router 配置重建后
- 注意：projection 是 **session 级**；用量是**进程级**全局数据——在所有 session 的 projection 里放同一份快照引用即可（数据本身无 session 差异）。

### 3.4 `client/TideDock.tsx` — composer dock 面板

- 布局（紧凑单行 + 展开区，仿 dsh-model-router）：
  - 主行：`🌙月汐` label + 模式 toggle（off/cost/capability segmented）+ 当前路由 chip + 预算占用 + 用量摘要（`wk 9% · 5h 10%`）+ 本地 token（`miss/out/cache%`）+ `upd HH:MM` 新鲜度
  - `<details>` 展开：会员徽章 + 重置倒计时 + 完整 RouterConfig 表单 + 推理状态行
- 变色阈值（仿 dsh-opencode-go-usage）：正常 → ≥80% 黄 → ≥90% 红
- **client→host 通道（已定案）**：`ctx.remote.commands.execute(sessionId, '/kimi-tide <subcommand>')`——host 侧注册 slash command 处理保存/刷新/toggle，**零自定义 wire 协议**（dsh-model-router 已验证此机制）。host command handler 调用 `settings.ts` 完成校验+回写+重建。
  - 子命令设计：`/kimi-tide mode off|cost|capability`、`/kimi-tide set <key> <value>`（表单逐字段）、`/kimi-tide refresh`（手动刷 quota）
- i18n：`locale.register('dsh-kimi-tide', 'zh'|'en', …)` + `locale.bind`
- 样式：注入 `<style data-plugin="dsh-kimi-tide">`（loader 卸载自动清理），CSS 变量用 `--dsw-alias-*`
- client inject：`['slots', 'timer', 'locale', 'remote', 'remote.commands']`

### 3.5 与上游路由器计划（M1-M3）的关系

本扩展**不改** M1 的 `KimiRouter` 决策逻辑；M2 图片检测、M3 index 集成按上游计划进行。`settings.ts` 重建 router 时调用与 M3 相同的装配入口（单一 `buildRouter(config)` 函数）。

---

## 4. 文件改动清单

```
packages/dsh-kimi-tide/
├── src/
│   ├── usage.ts            新增 ~120 行
│   ├── settings.ts         新增 ~150 行
│   ├── commands.ts         新增 ~80 行：/kimi-tide slash command（mode/set/refresh）
│   ├── projection.ts       新增 ~60 行
│   ├── client/index.ts     新增 ~15 行（dock slot 注册 + style 注入 + locale）
│   ├── client/TideDock.tsx 新增 ~280 行
│   ├── index.ts            修改：装配新单元 + inject 增加 'sessionProjections' 'commands'
│   └── adapter.ts          修改：usage tap（~10 行）
├── scripts/build-client.mjs 新增（esbuild 方案同 bridge；或 tsdown 单配置，实现时择一）
├── package.json            修改：+files lib/client.js，+exports "./client"，+dsh.client 字段
│                            （inject: dsh-client-ui-conversation / dsh-api-remotes, platform: web），
│                            +devDep esbuild schemastery @types/react react，+scripts build:client
└── cordis.patch.yml        修改：补 usagePollMs 与 router 示例（注释，默认 off）
```

**客户端发现机制**（从 bridge / dsh-model-router package.json 确认）：shell 通过 package.json 的 `dsh.client` 字段发现并加载 `lib/client.js`——这是双端化的必要声明，缺它浏览器端不会拉取 client bundle。inject 列表对齐 dsh-model-router（`dsh-client-ui-conversation` 提供 dock slot；`dsh-api-remotes` 提供 `remote.commands`）。

依赖变更：`esbuild`（dev）、`schemastery`（runtime，bridge 已用同库）。peerDependencies 增加 `@deepseek-ai/dsh-commands`、`@deepseek-ai/dsh-session-projection`（均为 rc.6 线）。

---

## 5. 测试策略

| 层 | 内容 | 工具 |
|---|---|---|
| 单元 | QuotaSnapshot 解析（含缺字段/字符串数字如 `"used":"9"`）、LocalTokenStats 累计与日界归零、settings 行级替换（含注释保留、缺行 append、.bak 生成） | vitest（新增，对齐 bridge 的测试布局） |
| 单元 | projection fold 幂等 | vitest |
| 集成 | usages 轮询 mock fetch（200/401→refresh/500） | vitest + mock |
| 实机 | M5 扩展：dock 渲染、保存→patch 文件变化→重启保持、quota 卡片与 `kimi` CLI 数据一致、/kimi-tide 命令往返 | 手工 5 分钟 |

---

## 6. 风险与决策点

| 风险/决策 | 分析 | 决定 |
|---|---|---|
| usages 接口未文档化 | 逆向接口，可能无预警变更 | 解析层宽容（字符串/数字双兼容，字段缺失降级显示）；`stale` 兜底 |
| ~~client→host 保存通道未验证~~ | **已解决**：`ctx.remote.commands.execute` + host slash command（dsh-model-router 验证） | 采用 `/kimi-tide` 命令族；fallback（commands remote 不可用）= 表单禁用 + 提示 |
| patch yml 注释保留 | js-yaml 往返丢注释 | 行级锚点文本替换（不 parse 全量） |
| 进程级用量放进 session projection | 语义不符但数据无 session 差异 | 接受：所有 session 共享同一快照；UI 无歧义 |
| Web profile HMR 被官方禁用 | patch 改动需重启 `dsh web` | 内存即时生效 + 提示文案；重启后从 patch 恢复 |
| 本地 token 统计与官方配额口径不同 | 官方按"次数"，本地按 token | UI 分开展示，标注口径，不做换算 |
| dock 空间拥挤 | 多个插件共用一个 dock | 单行紧凑 + `<details>` 收拢；与 dsh-model-router 并存时自然换行 |

---

## 7. 里程碑映射（并入上游计划）

| 里程碑 | 变化 |
|---|---|
| M1-M3 | 不变（上游计划） |
| **M3.5 双端化** | build-client.mjs + dock 骨架 + projection 注册 + commands 挂载（本设计 §3.3/§3.4） |
| **M3.6 用量显示** | usage.ts + dock 用量行（本设计 §3.1） |
| **M3.7 设置面板** | settings.ts + `/kimi-tide` 命令族 + 展开区表单（本设计 §3.2/§3.4） |
| M4 单元测试 | 范围扩展到本设计 §5 |
| M5 实机验证 | 增加 dock 渲染 / 命令往返 / 持久化三项 |
| M6 文档发布 | README 加「月汐 dock 面板」章节 |

推理过程显示：无里程碑（零代码），仅在 M6 文档中说明"已原生支持"。
