# 宿主 0.1.1-rc.2 升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（本计划由父会话内联执行）。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把宿主从 0.1.0-rc.8 升到 0.1.1-rc.2，kimi-tide 完成三处契约迁移，图像准入探针补丁重移植，行为保持不变（锁存/路由逻辑不动）。

**Architecture:** 先仓库后宿主：kimi-tide 代码迁移（TDD）→ 宿主 npm 全局升级 → apiproxy 补丁重移植 → 文档刷新 → 用户重启后实机验收。本体会话全程跑在 rc.8 内存中，升级文件不影响当前会话。

**Spec:** 调研结论见协作日志 2026-08-22「宿主 0.1.1-rc.2 更新调研」条目 + 台账同日进度记录（三破/稳定面/两机遇/peer 陷阱，全部 tarball 实证）。

## Global Constraints

- 本计划只做**行为保持**升级：锁存退役、vision 模型接入、pi-ai OAuth 接入**明确出 scope**（后续迭代）
- 宿主安装路径 `$DSH = C:\Users\tafce\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`，子包根 `$DSH\node_modules\@deepseek-ai\<pkg>`
- 插件挂载：profile 符号链接直达工作区包（`profiles\web\node_modules\dsh-kimi-tide` → `packages\dsh-kimi-tide`），重建 lib 即生效，无重装步骤
- dsh-web-fetch-http 的 `latest` tag 停在 0.0.1-rc.5（官方 stale），升级必须**显式钉版本** `@0.1.1-rc.2`
- 官方包从未包含 `agent/image-admission` 探针（rc.8 官方 tarball grep 零 + 哈希不符实证）——每次升级都须重移植补丁
- peer 范围 semver 陷阱：`^0.1.0-rc.8` 不含 `0.1.1-rc.2`（prerelease 元组规则）
- 备份目录：工作区根 `.dsh-rc2-upgrade\`（沿用 8/20 `.dsh-rc8-upgrade\` 惯例，不入 git）
- 回滚：`npm i -g @deepseek-ai/dsh@0.1.0-rc.8 @deepseek-ai/dsh-web-fetch-http@0.1.0-rc.8` + 恢复 `.dsh-rc2-upgrade\apiproxy-index.js.rc8-patched` + kimi-tide `git revert`

---

### Task 1: 前置提交——上一会话遗留的 reasoning-efforts 修复

**Files:**
- Modify（提交既有改动）: `packages/dsh-kimi-tide/src/config.ts`、`src/index.ts`、`src/router.ts`、`test/router.test.ts`
- 顺带改注释日期笔误：`src/index.ts` 内「2026-08-25」→「2026-08-21」（8/21 全库扫描已裁定的笔误）

**背景**：8/21「kimi 思考排查」会话的修复（候选枚举采集 `reasoning.efforts` + router applyTo 等级映射）测试通过但未提交（该会话收尾缺失，8/21 全库扫描记录在案）。本会话基线实证 **216/216 绿**（00:52 实跑）。不提交它会让升级 diff 混入无关改动。

- [ ] **Step 1**: 修正注释日期笔误（index.ts 一处）
- [ ] **Step 2**: `git add` 上述 4 文件，提交：`fix(router): 推理等级能力采集与映射——CandidateMeta.reasoningEfforts + applyTo 保留/钳制/剥离（2026-08-21 会话遗留，216/216 基线实证）`
- [ ] **Step 3**: 推送 origin/main

### Task 2: package.json 依赖抬升

**Files:**
- Modify: `packages/dsh-kimi-tide/package.json`（peerDependencies L53-59 ×4 → `^0.1.1-rc.2`；devDependencies L68-72 ×5 → `0.1.1-rc.2`）

- [ ] **Step 1**: 编辑 package.json（peer: dsh-commands/dsh-llm/dsh-session-projection/dsh-settings；dev: 同四包 + dsh-session）
- [ ] **Step 2**: `npm install`（包目录）
- [ ] **Step 3**: 实证 `npm ls @deepseek-ai/dsh-session-projection` = 0.1.1-rc.2
- [ ] **Step 4**: 跑 `npm run typecheck`——**预期失败**（ProjectionDefinition 旧形），此即 Task 3 的 RED 驱动；不提交

### Task 3（TDD）: projection.ts 迁移到 rc.2 投影契约

**Files:**
- Test: `packages/dsh-kimi-tide/test/projection.test.ts`（L32-37 schema 引用、L36-37 stateVersion 钉桩、L102-103 view 断言）
- Modify: `packages/dsh-kimi-tide/src/projection.ts`（全文件改写定义对象）

**Interfaces（rc.2 官方契约，锚点 dsh-session-projection rc.2 lib/types/index.d.ts:37-74 + 官方范例 dsh-tool-todo rc.2 lib/index.js:80-96）:**
- `ProjectionDefinition = { key, stateSchema: ZodType<S>, init(), apply(state,event), wire?: { viewSchema: ZodType<Map[K]>, view(state): Map[K] }, stateVersion }`
- client-visible key（在 `SessionProjectionMap` 声明）必须带 `wire`；新表 `SessionProjectionStateMap` 声明宿主状态类型
- kimi-tide 的 state 与 wire 同形（`KimiTidePanelProjection | null`）

- [ ] **Step 1（RED）**: 改测试：`kimiTideProjectionDefinition.schema` → `.stateSchema`（L32-33）；stateVersion 钉桩 4→**5**；`view` 断言改 `wire.view`（L102-103）；新增 `wire.viewSchema.parse` 合法/非法载荷各一断言。跑 `npx vitest run test/projection.test.ts` 确认失败（属性 undefined/类型错）
- [ ] **Step 2（GREEN）**: 改写 `src/projection.ts`：
  - module augmentation 增 `SessionProjectionStateMap`（与 `SessionProjectionMap` 同型条目；同一 subpath `@deepseek-ai/dsh-session-projection/types`）
  - 定义对象改：`stateSchema: bridgedSchema`、`wire: { viewSchema: bridgedSchema, view: (state) => state }`、`stateVersion: 5`（定义形状变更，弃旧缓存行）
  - zod v3→v4 桥接断言保留（stateSchema/viewSchema 各一次 unknown 桥）
- [ ] **Step 3**: `npx vitest run test/projection.test.ts` 绿 → 全量 `npm test` 216+ 绿 → `npm run typecheck` 0
- [ ] **Step 4**: 提交 `feat(projection): 迁移 rc.2 投影契约——stateSchema + wire:{viewSchema,view}，stateVersion 4→5`

### Task 4（TDD）: credentials 事件改名

**Files:**
- Test: `packages/dsh-kimi-tide/test/index-apply.test.ts`（L200/L207/L211/L225/L230，`credentials/updated` ×5）
- Modify: `packages/dsh-kimi-tide/src/index.ts`（L494 监听器 + L282 注释）

**契约**：rc.2 拆分改名 `credentials/updated` → `credentials/reference-updated`（ref 半）+ `credentials/record-updated`（record 半，新增）。kimi-tide 只关心 env key 引用落盘 → 只听 `reference-updated`（锚点：dsh-credentials rc.2 README + api-remotes 转发表 diff + tool-cordis 目录）

- [ ] **Step 1（RED）**: 测试 5 处 `credentials/updated` → `credentials/reference-updated`（含测试名/注释）。跑确认失败（监听器未注册=节流测试挂）
- [ ] **Step 2（GREEN）**: index.ts L494 改名 + 注释刷新
- [ ] **Step 3**: 全量绿 + typecheck 0
- [ ] **Step 4**: 提交 `fix(host): credentials/updated → credentials/reference-updated（rc.2 事件拆分改名跟进）`

### Task 5: 宿主升级 + 图像准入探针补丁重移植

**Files:**
- Create（备份）: `.dsh-rc2-upgrade\apiproxy-index.js.rc8-patched`、`apiproxy-index.js.rc2-orig`、`MANIFEST.txt`（哈希清单）
- Modify（宿主安装，不入 git）: `$DSH\node_modules\@deepseek-ai\dsh-host-apiproxy\lib\index.js`（2 处）

**补丁内容**（与 rc.7→rc.8 同构；rc.2 插入点实证同形）：
- 导入行（rc.2 L8）：`import { installModelSelection } from "@deepseek-ai/dsh-agent";` → `import { agentCarrier, installModelSelection } from "@deepseek-ai/dsh-agent";`（agentCarrier 在 rc.2 dsh-agent L323/L794 实证仍导出）
- 准入门（rc.2 L2755-2759）：

```js
// rc.2 原文：
if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image")) return err(request, {
    code: "attachment-error",
    message: `Model "${current.model}" does not support image input.`,
    details: { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" }
});

// 补丁后：
if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image")) {
    // HOTFIX 2026-08-18, reapplied 2026-08-22 for 0.1.1-rc.2 (kimi-tide image admission):
    // per-step routing plugins (dsh-kimi-tide router) reroute image steps
    // to a multimodal route INSIDE the agent loop, but this pre-check
    // runs before the message enters the loop — a fresh session whose
    // default model is text-only (deepseek) would be rejected before
    // the router could act. Defer via an agent-scoped serial probe:
    // a listener returning a truthy bail value claims the image will
    // be rerouted; no claimant keeps the friendly rejection
    // (upstream-identical behavior when no plugin subscribes).
    const claimed = await ctx.serial(agentCarrier(agent), "agent/image-admission", {
        provider: current.provider,
        model: current.model
    });
    if (claimed === void 0) return err(request, {
        code: "attachment-error",
        message: `Model "${current.model}" does not support image input.`,
        details: { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" }
    });
}
```

- [ ] **Step 1**: 备份当前 rc.8 补丁版 → `.dsh-rc2-upgrade\apiproxy-index.js.rc8-patched`，记 MD5
- [ ] **Step 2**: `npm i -g @deepseek-ai/dsh@0.1.1-rc.2` + `npm i -g @deepseek-ai/dsh-web-fetch-http@0.1.1-rc.2`
- [ ] **Step 3**: 实证版本：dsh/package.json=0.1.1-rc.2、web-fetch-http=0.1.1-rc.2、嵌套 dsh-host-apiproxy=0.1.1-rc.2；rc.2 官方 apiproxy 哈希 = 调研期 tarball 哈希（一致=未被其他补丁污染）
- [ ] **Step 4**: 备份 rc.2 原版 → `apiproxy-index.js.rc2-orig`
- [ ] **Step 5**: 打补丁（2 处编辑；C: 盘非同步盘，edit 工具即可，打完复核哈希已变）
- [ ] **Step 6**: 冒烟：`node --check` 过；grep 锚点（agentCarrier 导入 ×1、agent/image-admission ×1）；`git diff --no-index` orig vs patched 恰 2 hunk

### Task 6: 文档刷新 + 终验 + 提交

**Files:**
- Modify: `docs/host-platform-map.md`（锚点 rc.2 化 + 新增「2026-08-22 rc.2 复核」节）
- Modify: `docs/dev-plan.md` / README 若含宿主版本事实（先 grep `rc\.8` 定位）

- [ ] **Step 1**: host-platform-map 刷新：1.3 节探针改为「本地补丁（官方从无），rc.2 已重移植」+ rc.2 新行号；1.5 prepareCall 补 modalities/generation 语义；新增 rc.2 delta 节（投影契约变形、credentials 事件拆分、vision 模型、canonical 编码、占位投影=锁存前提失效、pi-ai OAuth 缝、read_image originalDimensions）
- [ ] **Step 2**: 终验三件套：`npm test` 全绿 + `npm run typecheck` 0 + `npm run build` 过（lib + client bundle 重建——symlink 挂载即时生效）
- [ ] **Step 3**: 提交推送（migration 与 docs 分开）

### Task 7: 实机验收清单（用户重启 dsh web 后执行）

- [ ] ① GUI 加载无插件注入错误；dock 面板渲染（投影 wire 通路实锤）
- [ ] ② `/kimi-tide show` 输出正常（预设/规则/候选）
- [ ] ③ 带图会话：text-only 默认 + 附图 → 准入 bail 放行 + 路由 k3（探针补丁实锤，会话日志 request/header）
- [ ] ④ 凭据热生效：编辑 key → 无需重启状态刷新（reference-updated 监听器实锤）
- [ ] ⑤ 回归：预设切换热重载 / @kimi 显式 / off 逃生舱
- [ ] ⑥ 浏览器控制台无 stateSchema/ProjectionDefinition 报错
