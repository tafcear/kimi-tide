# kimi-tide 0.2.0 扩展设计 — 用量显示 · 路由设置面板 · 推理状态

> 状态：设计已确认（2026-08-17，逐节 OK）
> 上游计划：[`docs/development-plan-router.md`](../development-plan-router.md)（M1 草稿已存在）
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
│ client/index.ts   slots.register('conversation.view',       │
│                   { id:'kimi-tide', order:40, label:'月汐' })│
│ client/TideView.tsx                                        │
│   ├─ 用量卡片：周配额 / 5h窗口 / 会员等级 / 本地 token       │
│   ├─ 路由设置表单：RouterConfig 全字段                      │
│   └─ 推理状态行："推理输出已启用（DSH 原生渲染）"            │
└────────────────────────────────────────────────────────────┘
```

**关键取舍**：面板数据走 **session projection**（框架自带推送，bridge 已验证），不新增 HTTP 端点、不新增 WebSocket。配置回写用**行级文本锚点替换**（js-yaml 全量 parse→dump 会丢用户注释，不可接受）。

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

### 3.4 `client/TideView.tsx` — 月汐标签页

- 布局：上=用量卡片网格（周配额进度条 / 5h 窗口进度条 / 会员徽章 / 本地 token 三行），中=路由设置表单，底=推理状态行
- 表单受控于 projection 的 `router` 字段；保存按钮 → **client→host 通道**
  - ⚠️ bridge 当前是单向（host→browser projection）。保存需要反向通道：调研 DSH client 是否暴露 command/action 机制（`dsh-client-runtime`）；若无，fallback = 表单生成 YAML 片段让用户粘贴进 patch 文件 + "已复制到剪贴板"提示。**M5 实机验证时定案**。
- 样式：复用 bridge 的 CSS 变量体系（`--dsw-alias-*`）

### 3.5 与上游路由器计划（M1-M3）的关系

本扩展**不改** M1 的 `KimiRouter` 决策逻辑；M2 图片检测、M3 index 集成按上游计划进行。`settings.ts` 重建 router 时调用与 M3 相同的装配入口（单一 `buildRouter(config)` 函数）。

---

## 4. 文件改动清单

```
packages/dsh-kimi-tide/
├── src/
│   ├── usage.ts            新增 ~120 行
│   ├── settings.ts         新增 ~150 行
│   ├── projection.ts       新增 ~60 行
│   ├── client/index.ts     新增 ~20 行
│   ├── client/TideView.tsx 新增 ~250 行
│   ├── index.ts            修改：装配新单元 + inject 增加 'sessionProjections'
│   └── adapter.ts          修改：usage tap（~10 行）
├── scripts/build-client.mjs 新增（照搬 bridge，PLUGIN_ID 改为 dsh-kimi-tide）
├── package.json            修改：+files lib/client.js，+exports "./client"，+dsh.client 字段
│                            （inject: dsh-client-runtime / dsh-client-ui-conversation, platform: web），
│                            +devDep esbuild schemastery @types/react react，+scripts build:client
└── cordis.patch.yml        修改：补 usagePollMs 与 router 示例（注释，默认 off）
```

**客户端发现机制**（从 bridge package.json 确认）：shell 通过 package.json 的 `dsh.client` 字段发现并加载 `lib/client.js`——这是双端化的必要声明，缺它浏览器端不会拉取 client bundle。

依赖变更：`esbuild`（dev）、`schemastery`（runtime，bridge 已用同库）。peerDependencies 不变。

---

## 5. 测试策略

| 层 | 内容 | 工具 |
|---|---|---|
| 单元 | QuotaSnapshot 解析（含缺字段/字符串数字如 `"used":"9"`）、LocalTokenStats 累计与日界归零、settings 行级替换（含注释保留、缺行 append、.bak 生成） | vitest（新增，对齐 bridge 的测试布局） |
| 单元 | projection fold 幂等 | vitest |
| 集成 | usages 轮询 mock fetch（200/401→refresh/500） | vitest + mock |
| 实机 | M5 扩展：标签页渲染、保存→patch 文件变化→重启保持、 quota 卡片与 `kimi` CLI 数据一致 | 手工 5 分钟 |

---

## 6. 风险与决策点

| 风险/决策 | 分析 | 决定 |
|---|---|---|
| usages 接口未文档化 | 逆向接口，可能无预警变更 | 解析层宽容（字符串/数字双兼容，字段缺失降级显示）；`stale` 兜底 |
| client→host 保存通道未验证 | bridge 只用了单向 projection | M5 实机调研；fallback = 复制 YAML 片段方案 |
| patch yml 注释保留 | js-yaml 往返丢注释 | 行级锚点文本替换（不 parse 全量） |
| 进程级用量放进 session projection | 语义不符但数据无 session 差异 | 接受：所有 session 共享同一快照；UI 无歧义 |
| Web profile HMR 被官方禁用 | patch 改动需重启 `dsh web` | 内存即时生效 + 提示文案；重启后从 patch 恢复 |
| 本地 token 统计与官方配额口径不同 | 官方按"次数"，本地按 token | UI 分开展示，标注口径，不做换算 |

---

## 7. 里程碑映射（并入上游计划）

| 里程碑 | 变化 |
|---|---|
| M1-M3 | 不变（上游计划） |
| **M3.5 双端化** | build-client.mjs + client 骨架 + projection 注册（本设计 §3.3/§3.4） |
| **M3.6 用量显示** | usage.ts + 用量卡片（本设计 §3.1） |
| **M3.7 设置面板** | settings.ts + 表单 + 持久化（本设计 §3.2） |
| M4 单元测试 | 范围扩展到本设计 §5 |
| M5 实机验证 | 增加面板三项验证 + client→host 通道定案 |
| M6 文档发布 | README 加「月汐标签页」章节 |

推理过程显示：无里程碑（零代码），仅在 M6 文档中说明"已原生支持"。
