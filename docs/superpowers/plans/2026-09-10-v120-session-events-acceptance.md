# v1.2.0 实机验收记录（2026-09-10）

版本主题：**会话事件解耦**——面板数据退出会话日志，dock 取数换不落日志的安静通道；修复升级期两个实机回归。

验收环境：真实宿主 `dsh web`（DSH 0.1.5-rc.1，Node 24，本机 127.0.0.1:3080），就地升级路径（1.1.0 → 1.2.0，进程重启 2026-09-10 18:39）。验收手段：进程内探针（动态插件直调 `commands` / `sessionQuery` 宿主服务）、会话日志取证（帧解码全量扫描）、启动级 E2E、CI。

## 清单（V1–V9 全绿）

- **V1 ✅ 面板取数换道（命令通道 → `/api/kimi-tide/panel` 只读路由，零持久化）**：当前会话日志全量取证——`kimi-tide/panel` 事件 **0 条**（本会话横跨 1.2.0 全天开发）；kimi-tide 命令生命周期事件共 61 条，**全部发生在重启/换道之前，其后零新增**（dock 8s 轮询照常工作，面板数据实时）。修复前形态：会话流被 kimi-tide 命令节点刷屏（用户截图 3+ 条）、日志按每天上万条重新膨胀。
- **V2 ✅ 历史会话可读（事件类型注册修复）**：受影响的 3 个会话在运行中宿主进程内经 `sessionQuery.observeSession` 逐一打开成功（1493 / 540 / 1012 事件）——修复前全部「历史加载失败：… unknown to this harness and not marked ignorable」。全库盘点：551 个会话目录权威代工件 100% 可读。
- **V3 ✅ dock 降级文案**：DOM 用例——取数落定且无数据 → 「暂无面板数据（路由关闭或取数通道不可用）」，未落定 → 「面板数据加载中…」；路由挂载实机验证：裸请求 `/api/kimi-tide/panel` 得 401（鉴权拦截）而非 404，冷会话带 cookie 访问由路由返回 409（浏览器 cookie 流程下的降级行为属用户目检项，见末节）。
- **V4 ✅ dock 动作失败可见**：`unwrapCommandOutcome` 单测覆盖 error-only / 信封 kind=error / `{ok:false,error}` 三形态 → 上浮原文；实机 `/kimi-tide refresh` → `success · quota refreshed`。
- **V5 ✅ 评审事件保留 + 手动评审**：`/kimi-tide review` 发起（admission `success · 评审已发起`）→ 有界异步评审完成 → `kimi-tide/review` 事件落会话日志（reviewer `kimi-coding/k3`，结构化问题清单/结论），评审卡在会话流渲染（目检）。
- **V6 ✅ 路由核心不回归**：面板快照 `activePreset=saving（省钱）· 5 规则 · 8 候选 · quotaProvider=kimi-coding · quotaStale=false`；`/kimi-tide show` → 「预设「省钱」· 默认 zai-coding-cn/glm-5.3-flash · 规则 5 条 · 关键词组 8 个」。
- **V7 ✅ 启动级 E2E 正反例双跑**：`--expect ok` 5/5（插件装载 + catalog 注册 + control/custom 双夹具 OPENS）；`--expect refused --pre-fix` 6/6（剥掉注册行的副本复现原故障，错误文本与实机逐字同源——E2E 自带 falsification）。
- **V8 ✅ CI**：三次推送（`5de6a24..1b3a2b8`、`4aa720d`、`b7cf1a0`）Node 22/24 双矩阵全绿。
- **V9 ✅ 打包物**：`npm pack` → `dsh-kimi-tide@1.2.0`；`lib/client.js`、`lib/index.js`、`cordis.patch.yml` 在包内；`src/`、`test/`、`node_modules` 零泄漏。

## 附加证据

- **升级路径实机**：本宿主即 1.1.0 → 1.2.0 就地升级（2026-09-10 两次进程重启），升级后历史会话与 dock 行为经上述 V1–V3 复核。
- **单元面**：582/582 通过 + typecheck 0（含信封剥壳回归锁 `client-panel-fetch-envelope.test.ts`、事件类型注册回归用例 `index-apply.test.ts`）。
- **kimi 独立评审**：评审流对本轮验收工作自身出具结构化评审（k3，问题清单/结论），评审卡渲染即 V5 的双证之一。

## 1.2.0 周期内发现并已修复的缺陷（记录备查）

| 缺陷 | 根因 | 修复 |
| --- | --- | --- |
| 历史会话整卷拒载（实机事故，gateway/internal） | 会话事件解耦时把注册清单从 panel+review 收缩成只 review；停写不等于停注册，目录外类型 fail-closed | `5de6a24` 恢复两类型注册 + 回归用例（去行即红，已实跑验证） |
| dock 永远「面板数据加载中」 | 命令回包解析只认裸形，rc.1+ 信封是 `{ok, value}`——信封内取不到 text，取数恒 null；新会话无投影兜底 | `6a3f476` `unwrapCommandOutcome` 统一剥壳 + 降级文案 |
| 会话日志重新膨胀 + 时间线刷屏 | dock 8s 轮询走命令通道，每次执行被宿主持久化为 command/run+done（done 含整份面板 JSON） | `4aa720d` 取数换 `/api/kimi-tide/panel` 只读路由（connection.fetch，自带 browser-trust fence，零持久化） |

## 用户目检项（随本验收一并完成 / 发版后可复看）

- dock 两行视觉（身份+路由链 / 额度槽+取数时间+刷新）与决策弹窗。
- 对话时间线清洁度（V1 修复后不再新增命令节点）。
- 评审卡渲染（V5 实测已产生一张）。
- 冷会话打开时 dock 降级文案（V3）。
