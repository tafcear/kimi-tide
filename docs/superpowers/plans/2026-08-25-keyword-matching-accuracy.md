# 关键词匹配准确性升级（0.7.0）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⛔ **开工前置（用户指定，2026-08-25）：实施前必须经过评审**——本计划任何 Task 执行前必须先完成评审并获得通过；评审安排（评审人 / 轮次 / 口径）由用户裁定，默认按本项目惯例 = Kimi k3 独立评审 + 用户审定。评审未通过不得进入实施。
> ✅ **门已解除（用户直接指令，2026-08-26）：「开工，放弃守卫」**——用户裁定放弃独立评审环节，计划直接进入实施；同批裁定守卫（2fc2a9b B 方案兜底，实机验证=结构性死代码）整体放弃（revert `5744144`）。实施记录见当日协作日志。

**Goal:** 升级 kimi-tide 规则链的关键词匹配引擎——纯 ASCII 关键词词边界防误触、命中特异度选优、可选 `minHits` 阈值，并同步调整内置预设与用户实机配置的顺序/词表，消除「chitchat 首序劫持 / 子串误中 / 词表过薄」三类误路由。

**Architecture:** 纯函数改造集中在 `src/rules.ts`（编译型关键词匹配器 + 命中计分排序）；`KimiRouter.decide` 的「按 matchingRules 返回序取首个目标可用者」循环不改——排序即选优；`minHits` 是 `RuleCondition` keywords 变体的可选字段（schema 标量无 default，缺省省略=1 语义），`validateRouterConfig` 校验整数界；设置卡片规则行加「最少命中词数」数字输入；内置预设数据（code 词表 / capability 规则序）与用户实机 saving 配置按同一原则调整。

**Tech Stack:** TypeScript + vitest（`npm test` = `vitest run`，包目录 `packages/dsh-kimi-tide`）；React 18 设置卡片（renderToString 断言）；schemastery schema。

**Spec:** 无独立 spec——设计决策内联于下文「设计决策」节（bounded 任务，brainstorming 2026-08-25 会话定稿：词边界邻接守卫 / 命中数特异度 / minHits / 数据调整；C 路线 LLM 意图分类明确不做）。

## 设计决策（本计划的依据）

1. **词边界（B1）**：关键词为纯 ASCII 词（`^[a-z0-9_]+$`）→ 邻接守卫正则 `(?<![a-z0-9_])<词>(?![a-z0-9_])`（大小写不敏感）。ASCII 邻接阻断（decode/unicode/barcode 不再误中 code），CJK 邻接放行（「3d」仍可命中「3d打印」）。中文/混合/多词短语关键词保持子串匹配（0.5.x 语义）。
2. **特异度选优（B2）**：规则命中分 = 命中关键词**种数**；image 规则分 = `+∞`。`matchingRules` 按（分 desc，列表序 asc）**稳定排序**后返回——路由层现有「首条目标可用者生效」循环不变；平手 = 列表序（保留规则顺序的心智模型）。
3. **minHits（B3）**：`when.kind === 'keywords'` 新增可选 `minHits?: number`（≥1 整数，缺省 1）。schema 不带 default（缺失省略不注入）；`validateRouterConfig` 越界拒写。
4. **数据调整（B4）**：内置 capability 规则序 code→chitchat；code 词表 +9 词；用户实机 saving 配置重排 image→code→plan→chitchat、plan 组补词、plan 规则 `minHits: 2`（Task 4 附注给出 YAML）。
5. **不做**（0.7.x 候选池）：AND 组合条件、排除词组、历史消息上下文、LLM 意图分类——0.3.x 评分引擎因 pre-step 加延迟加成本退役的教训不再重演。

## Global Constraints

- 配置向后兼容：v5 形状不变，新字段全部可选；存量配置导入不迁移、不写回。
- 匹配语义不变量：中文关键词 = 子串；平手 = 列表序；带图轮 image 规则恒优先。
- TDD：每任务先写失败测试（RED）→ 最小实现（GREEN）；每任务一次 commit。
- 全量验证命令（在 `packages/dsh-kimi-tide` 下）：`npm test` + `npm run typecheck` + `npm run build`，三绿才 commit。
- 行为/版本变化处同步三文档面：`docs/router.md`、仓库根 `README.md`（中英镜像）、`packages/dsh-kimi-tide/README.md`。
- 本计划新增约 15 断言；实施后全量回归须全绿（当前基线 354+）。

---

### Task 1: 关键词词边界匹配器

**Files:**
- Modify: `packages/dsh-kimi-tide/src/rules.ts`（matchingRules 内部替换为编译型匹配器）
- Test: `packages/dsh-kimi-tide/test/rules.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）。
- Produces: `matchingRules(config, text, hasImage): RouterRule[]`——签名不变，语义升级为词边界匹配（列表序返回，排序留 Task 2）。

- [ ] **Step 1: 写失败测试**（追加到 `test/rules.test.ts` 的 `describe('matchingRules')` 内）

```ts
  it('0.7.0 词边界：decode/unicode/barcode/planning 不误中英文词；纯词与中文邻接仍命中', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'capability'
    expect(matchingRules(c, '帮我 decode 这段 base64', false).map((r) => r.id)).not.toContain('code-kfc')
    expect(matchingRules(c, 'unicode 转义问题', false).map((r) => r.id)).not.toContain('code-kfc')
    expect(matchingRules(c, '生成 barcode 的脚本', false).map((r) => r.id)).not.toContain('code-kfc')
    expect(matchingRules(c, 'please refactor this function', false).map((r) => r.id)).toContain('code-kfc')
    expect(matchingRules(c, '这段代码有 bug', false).map((r) => r.id)).toContain('code-kfc')
    expect(matchingRules(c, '帮忙重构一下', false).map((r) => r.id)).toContain('code-kfc')
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/rules.test.ts`
Expected: FAIL——`decode`/`unicode`/`barcode` 三行当前子串匹配误中 code 组，`not.toContain` 断言红。

- [ ] **Step 3: 最小实现**（`src/rules.ts`：文件内新增两个私有函数 + 替换 matchingRules 匹配段；签名与返回序不变）

```ts
/** 转义正则元字符。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface KeywordMatcher {
  matches(text: string): boolean
}

/**
 * 编译关键词为匹配器（0.7.0 词边界语义，设计决策 B1）：
 * - 纯 ASCII 词（^[a-z0-9_]+$，大小写不敏感）→ 邻接守卫正则
 *   (?<![a-z0-9_])词(?![a-z0-9_])——decode/unicode/barcode 不误中 code；
 *   CJK 邻接不阻断（「3d」仍命中「3d打印」）。
 * - 其余（中文/混合/多词短语）→ 子串匹配（0.5.x 语义，逐字节兼容）。
 */
function compileKeyword(keyword: string): KeywordMatcher {
  const lowered = keyword.toLowerCase()
  if (/^[a-z0-9_]+$/.test(lowered)) {
    const re = new RegExp(`(?<![a-z0-9_])${escapeRegExp(lowered)}(?![a-z0-9_])`)
    return { matches: (text) => re.test(text) }
  }
  return { matches: (text) => text.includes(lowered) }
}
```

`matchingRules` 的 keywords 分支替换为：

```ts
    const words = config.keywordGroups[rule.when.group]
    if (words === undefined) continue
    // 每组词每轮编译一次（组词量级几十、每轮 decide 仅一次——开销可忽略，
    // 免缓存复杂度的理由与既有 0.5.x 简单路径一致）。
    const matchers: KeywordMatcher[] = words.map((k) => compileKeyword(k))
    if (matchers.some((m, i) => words[i].length > 0 && m.matches(lower))) hits.push(rule)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/rules.test.ts`
Expected: PASS（新 6 断言 + 既有 8 断言全绿；既有「please REFACTOR this」用例在词边界语义下仍命中——REFACTOR 是独立 ASCII 词）。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/rules.ts packages/dsh-kimi-tide/test/rules.test.ts
git commit -m "feat(rules): 关键词词边界匹配（ASCII 邻接守卫，中文保持子串）"
```

### Task 2: 命中特异度排序

**Files:**
- Modify: `packages/dsh-kimi-tide/src/rules.ts`（计分 + 稳定排序）
- Test: `packages/dsh-kimi-tide/test/rules.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `compileKeyword` / `matchingRules`。
- Produces: `matchingRules` 返回序升级为（分 desc，列表序 asc）；`KimiRouter.decide` 不改一行。

- [ ] **Step 1: 写失败测试**

```ts
  it('0.7.0 特异度：命中词数多者优先；平手保持列表序；带图轮 image 规则恒优先', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'capability'
    // code 2 词（重构+测试） vs chitchat 1 词（总结）→ code 反超列表序在前的 chitchat
    expect(matchingRules(c, '帮我总结这次重构，顺便写个测试', false).map((r) => r.id))
      .toEqual(['code-kfc', 'chitchat-flash'])
    // 各命中 1 词 → 平手按列表序（当前内置序 chitchat 在前；Task 4 将调序）
    expect(matchingRules(c, '你好，帮我重构一下', false).map((r) => r.id))
      .toEqual(['chitchat-flash', 'code-kfc'])
    // 带图轮 image 规则分 = +∞：即使关键词规则列表序在前也恒被 image 压过
    const s = DEFAULT_CONFIG_V4(); s.activePreset = 'saving'
    s.presets.saving.rules = [
      { id: 'code-kfc', when: { kind: 'keywords', group: 'code' }, target: { provider: 'kimi-coding', model: 'kimi-for-coding' } },
      { id: 'image-k3', when: { kind: 'image' }, target: { provider: 'kimi-coding', model: 'k3' } },
    ]
    expect(matchingRules(s, '看这个 bug 截图', true).map((r) => r.id)).toEqual(['image-k3', 'code-kfc'])
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/rules.test.ts`
Expected: FAIL——第一段当前返回 `['chitchat-flash', 'code-kfc']`（纯列表序），断言红；第三段当前返回 `['code-kfc', 'image-k3']` 也红。

- [ ] **Step 3: 最小实现**（替换 matchingRules 全文；`lower`/`hits` 局部结构与 Task 1 对齐）

```ts
export function matchingRules(config: RuleMatchConfig, text: string, hasImage: boolean): RouterRule[] {
  if (config.activePreset === null) return []
  const preset = config.presets[config.activePreset]
  if (preset === undefined) return []
  const lower = text.toLowerCase()
  const hits: Array<{ rule: RouterRule; score: number }> = []
  for (const rule of preset.rules) {
    if (rule.when.kind === 'image') {
      // 带图轮 image 规则恒优先（设计决策 B2）
      if (hasImage) hits.push({ rule, score: Number.POSITIVE_INFINITY })
      continue
    }
    const words = config.keywordGroups[rule.when.group]
    if (words === undefined) continue
    let matched = 0
    for (const k of words) {
      if (k.length > 0 && compileKeyword(k).matches(lower)) matched += 1
    }
    // score = 命中关键词种数（同一词多次出现只计一次）
    if (matched > 0) hits.push({ rule, score: matched })
  }
  // ES2019+ 稳定排序：平手（含双 image 规则 ∞−∞=NaN 视同 0）保持列表序。
  hits.sort((a, b) => b.score - a.score)
  return hits.map((h) => h.rule)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/rules.test.ts`
Expected: PASS（新 3 断言 + 既有全部；既有「首命中=image-k3」用例在 ∞ 排序下结果不变）。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/rules.ts packages/dsh-kimi-tide/test/rules.test.ts
git commit -m "feat(rules): 命中特异度排序（词数优先、平手列表序、带图恒优先）"
```

### Task 3: 规则条件 minHits 可选阈值

**Files:**
- Modify: `packages/dsh-kimi-tide/src/config.ts`（RuleCondition 联合）
- Modify: `packages/dsh-kimi-tide/src/settings-schema.ts`（ruleSchema + validateRouterConfig）
- Modify: `packages/dsh-kimi-tide/src/rules.ts`（matchingRules 消费 minHits）
- Test: `packages/dsh-kimi-tide/test/rules.test.ts`、`packages/dsh-kimi-tide/test/settings-schema.test.ts`

**Interfaces:**
- Consumes: Task 2 计分循环。
- Produces: `RuleCondition` keywords 变体带 `minHits?: number`（缺省=1）；`validateRouterConfig` 越界报错串含 `minHits`。

- [ ] **Step 1: 写失败测试**

`test/rules.test.ts`：

```ts
  it('0.7.0 minHits：命中数不足阈值不触发；缺省=1；达标触发', () => {
    const c = DEFAULT_CONFIG_V4(); c.activePreset = 'saving'
    c.presets.saving.rules.unshift({
      id: 'plan-2',
      when: { kind: 'keywords', group: 'plan', minHits: 2 },
      target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
    c.keywordGroups.plan = ['plan', '计划', '方案']
    expect(matchingRules(c, '帮我做个方案', false).map((r) => r.id)).not.toContain('plan-2')
    expect(matchingRules(c, 'plan：帮我做个方案', false).map((r) => r.id)).toContain('plan-2')
    const d = DEFAULT_CONFIG_V4(); d.activePreset = 'saving'
    d.presets.saving.rules.unshift({
      id: 'plan-1',
      when: { kind: 'keywords', group: 'plan' },
      target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
    d.keywordGroups.plan = ['方案']
    expect(matchingRules(d, '帮我做个方案', false).map((r) => r.id)).toContain('plan-1')
  })
```

`test/settings-schema.test.ts`（追加 describe；文件已导入 `validateRouterConfig` 与 `DEFAULT_CONFIG_V5`）：

```ts
describe('validateRouterConfig minHits（0.7.0）', () => {
  const withMin = (mh: number) => {
    const c = structuredClone(DEFAULT_CONFIG_V5()); c.activePreset = 'saving'
    c.presets.saving.rules.unshift({
      id: 'x', when: { kind: 'keywords', group: 'code', minHits: mh },
      target: { provider: 'kimi-coding', model: 'k3' },
    })
    return validateRouterConfig(c)
  }
  it('越界（0/小数/负数）拒写；1/2/缺省通过', () => {
    expect(withMin(0)).toContain('minHits')
    expect(withMin(1.5)).toContain('minHits')
    expect(withMin(-1)).toContain('minHits')
    expect(withMin(1)).toBeUndefined()
    expect(withMin(2)).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/rules.test.ts test/settings-schema.test.ts`
Expected: FAIL——TypeScript 编译错误（`minHits` 不存在于 RuleCondition）+ settings 断言 `toBeUndefined()` 拿到的是 minHits 报错串。

- [ ] **Step 3: 最小实现**

`src/config.ts` RuleCondition：

```ts
export type RuleCondition =
  | { kind: 'image' }                    // 带图（本轮或历史含图，锁存后恒真）
  | { kind: 'keywords'; group: string; minHits?: number }  // 命名关键词组命中；minHits 缺省=1（0.7.0）
```

`src/settings-schema.ts` ruleSchema keywords 分支：

```ts
    Schema.object({ kind: Schema.const('keywords'), group: Schema.string(), minHits: Schema.number() }),
```

（标量无 default：缺失省略不注入、存在即校验——与 imageFallback 同款锚点。）

`src/settings-schema.ts` validateRouterConfig 的规则循环内，把现有一行改块：

```ts
      if (rule.when?.kind === 'keywords') {
        if (!(rule.when.group in raw.keywordGroups)) {
          return `规则 '${rule.id}' 引用的关键词组 '${rule.when.group}' 不存在于 keywordGroups`
        }
        const minHits = rule.when.minHits
        if (minHits !== undefined && (!Number.isInteger(minHits) || minHits < 1)) {
          return `规则 '${rule.id}' 的 minHits 越界（须为 ≥1 的整数）`
        }
      }
```

`src/rules.ts` matchingRules 计分段加阈值门：

```ts
    let matched = 0
    for (const k of words) {
      if (k.length > 0 && compileKeyword(k).matches(lower)) matched += 1
    }
    const minHits = rule.when.minHits ?? 1
    if (matched >= minHits) hits.push({ rule, score: matched })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/rules.test.ts test/settings-schema.test.ts && npm run typecheck`
Expected: PASS + typecheck 0。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/config.ts packages/dsh-kimi-tide/src/settings-schema.ts packages/dsh-kimi-tide/src/rules.ts packages/dsh-kimi-tide/test/rules.test.ts packages/dsh-kimi-tide/test/settings-schema.test.ts
git commit -m "feat(config): 规则条件 minHits 可选阈值（schema+校验+匹配消费）"
```

### Task 4: 内置预设数据调整 + 用户实机配置指引

**Files:**
- Modify: `packages/dsh-kimi-tide/src/config.ts`（DEFAULT_KEYWORD_GROUPS.code、capability rules 序）
- Test: `packages/dsh-kimi-tide/test/config.test.ts`（既有断言适配新数据）

**Interfaces:**
- Consumes: Task 3 类型（`minHits` 可用于内置数据——本任务内置数据不声明 minHits，保持缺省）。
- Produces: 新装默认数据（capability 规则序 code→chitchat；code 词表 17 词）。

- [ ] **Step 1: 改内置数据**

`DEFAULT_KEYWORD_GROUPS`：

```ts
export const DEFAULT_KEYWORD_GROUPS: Record<string, string[]> = {
  code: ['代码', 'code', 'bug', '重构', 'refactor', '实现', '函数', '测试', '接口', '联调', '部署', '性能', '报错', '日志', '编译', '命令', '脚本'],
  chitchat: ['你好', '谢谢', '怎么样', '随便', '聊聊', '翻译', '总结', '天气'],
}
```

`DEFAULT_CONFIG_V4` 的 capability.rules 顺序（chitchat 首序会劫持「你好，帮我写个测试」类混合消息）：

```ts
        rules: [
          { id: 'code-kfc', when: { kind: 'keywords', group: 'code' }, target: { provider: KIMI_PROVIDER, model: 'kimi-for-coding' } },
          { id: 'chitchat-flash', when: { kind: 'keywords', group: 'chitchat' }, target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
        ],
```

（saving 预设 [image-k3, code-kfc] 顺序不变。）

- [ ] **Step 2: 适配既有断言**

Run: `npm test -- test/config.test.ts test/settings-schema.test.ts test/rules.test.ts`
Expected: 先红——config/settings 测试中引用旧词表（8 词）或 capability 旧序的断言失败；逐一更新为新数据（词表 17 词、capability 序 code→chitchat），其余断言不动。rules.test 中「你好，帮我重构一下」平手序断言改为 Task 2 新序后的期望（`['code-kfc', 'chitchat-flash']`），并同步 Task 2 测试内注释。

- [ ] **Step 3: 用户实机配置调整（数据步骤，非代码）**

`saving` 预设（用户 `C:\Users\tafce\.dsh\settings.yaml` 的 `kimi-tide-router` 段）按设计决策 B4 调整：

1. 备份：`Copy-Item C:\Users\tafce\.dsh\settings.yaml C:\Users\tafce\.dsh\settings.yaml.bak-keyword-upgrade`
2. `presets.saving.rules` 整段替换为（顺序 image→code→plan→chitchat，plan 规则带 minHits 2）：

```yaml
      rules:
        - id: image-k3
          when:
            kind: image
          target:
            flow: transcribe
        - id: code-kfc
          when:
            kind: keywords
            group: code
          target:
            provider: qwen-token-plan-cn
            model: qwen3.8-max-preview
        - id: rule-4
          when:
            kind: keywords
            group: plan
            minHits: 2
          target:
            provider: qwen-token-plan-cn
            model: qwen3.8-max-preview
        - id: rule-3
          when:
            kind: keywords
            group: chitchat
          target:
            provider: deepseek-official
            model: deepseek-v4-flash
```

3. `keywordGroups` 段：

```yaml
  keywordGroups:
    code: [代码, code, bug, 重构, refactor, 实现, 函数, 测试, 接口, 联调, 部署, 性能, 报错, 日志, 编译, 命令, 脚本]
    chitchat: [你好, 谢谢, 怎么样, 随便, 聊聊, 翻译, 总结, 天气]
    plan: [plan, 计划, 方案, 规划]
```

4. 效果自查（重启 dsh web 后）：`/kimi-tide show` 确认 saving 预设 4 条规则新序；面板决策抽查「你好，帮我写个测试」→ 应命中 code。
5. 其余字段（activePreset/version/flows/imageFallback）不动。

- [ ] **Step 4: 全量回归**

Run: `npm test && npm run typecheck && npm run build`
Expected: 全绿 + typecheck 0 + build 成功。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/config.ts packages/dsh-kimi-tide/test/config.test.ts packages/dsh-kimi-tide/test/settings-schema.test.ts packages/dsh-kimi-tide/test/rules.test.ts
git commit -m "feat(config): 内置预设数据调整（capability 序 + code 词表扩充）"
```

### Task 5: 设置卡片 minHits 输入

**Files:**
- Modify: `packages/dsh-kimi-tide/src/client/SettingsCard.tsx`（规则行条件 select 后插入数字输入；条件切换保留 minHits）
- Test: `packages/dsh-kimi-tide/test/SettingsCard.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `RuleCondition` minHits 字段、`editActiveRule(index, patch)`。
- Produces: 关键词规则行渲染「最少命中词数」number 输入（min=1 step=1，1..n 整数才写）。

- [ ] **Step 1: 写失败测试**（文件已导入 `renderToString`/`createElement`/`storeWith`/`v4cfg`）

```tsx
  it('0.7.0 minHits 输入：关键词条件行渲染、纯带图规则行不渲染', () => {
    const html = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(v4cfg('saving')) }))
    expect(html).toContain('最少命中词数')
    const imageOnly = v4cfg('saving')
    imageOnly.presets.saving.rules = [
      { id: 'image-k3', when: { kind: 'image' }, target: { provider: 'kimi-coding', model: 'k3' } },
    ]
    const html2 = renderToString(createElement(SettingsCard, { scope: null, connection: null, storeFactory: storeWith(imageOnly) }))
    expect(html2).not.toContain('最少命中词数')
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/SettingsCard.test.tsx`
Expected: FAIL——`toContain('最少命中词数')` 红（组件未渲染该输入）。

- [ ] **Step 3: 最小实现**

规则行（`active.rules.map` 的 `.kt-rule-row` 内）在条件 select 之后插入：

```tsx
                  {rule.when.kind === 'keywords' && (
                    <input
                      aria-label="最少命中词数"
                      className="kt-minhits"
                      type="number"
                      min={1}
                      step={1}
                      value={rule.when.minHits ?? 1}
                      disabled={!writable}
                      onChange={(e) => {
                        const n = Math.round(Number(e.target.value))
                        if (Number.isInteger(n) && n >= 1) {
                          editActiveRule(index, { when: { ...rule.when, minHits: n } })
                        }
                      }}
                    />
                  )}
```

条件 select 的 onChange 改为组切换时保留 minHits（`parseCondition` 本身不含 minHits，组合时补回）：

```tsx
                    onChange={(e) => {
                      const parsed = parseCondition(e.target.value)
                      const when = rule.when.kind === 'keywords' && parsed.kind === 'keywords'
                        ? { ...parsed, minHits: rule.when.minHits }
                        : parsed
                      editActiveRule(index, { when })
                    }}
```

文件头注释补一行：`* 0.7.0 规则行关键词条件增「最少命中词数」输入（minHits，1..n 整数才写）。`

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/SettingsCard.test.tsx && npm run typecheck && npm run build`
Expected: PASS（新断言 + 既有卡片断言全绿；build:client 通过）。

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-kimi-tide/src/client/SettingsCard.tsx packages/dsh-kimi-tide/test/SettingsCard.test.tsx
git commit -m "feat(client): 规则行 minHits 输入（关键词条件，1..n 整数才写）"
```

### Task 6: 文档同步 + 版本号

**Files:**
- Modify: `docs/router.md`、`README.md`（仓库根，中英镜像）、`packages/dsh-kimi-tide/README.md`、`packages/dsh-kimi-tide/package.json`

**Interfaces:**
- Consumes: Task 1–5 的最终语义。
- Produces: 三文档面与实现一致；`version: 0.7.0`（发版 tag 由用户另行裁定）。

- [ ] **Step 1: 更新 `docs/router.md`**

1. 「预设与规则」内置配置示例：code 词表换 17 词版；capability rules 换 code→chitchat 新序。
2. 「决策流程」第 2 步与「规则匹配」bullet 改写为 0.7.0 语义：纯 ASCII 词邻接守卫（decode/unicode/barcode 不中 code）、命中特异度排序（词数 desc、平手列表序、image 恒优先）、`minHits` 缺省 1。
3. 「配置参考」表加一行：`rules[].when.minHits`｜`number \| undefined`｜`undefined`｜命中关键词种数下限（≥1 整数；缺省 1）。
4. 文末「0.6.0 协作编排扩展」节后新增「0.7.0 匹配语义升级」小节：三点语义 + 向后兼容说明（v5 存量逐字节合法、未声明 minHits 行为=旧版）。

- [ ] **Step 2: 更新仓库根 `README.md` 中英镜像**

1. 配置示例（中英两段）：keywordGroups code 17 词 + capability 规则序 + saving 示例补 minHits 用法一行。
2. 路由决策说明（中英）：子串匹配描述改为「ASCII 词边界 + 中文子串 + 命中特异度」。
3. 版本记录/路线图：追加 0.7.0（关键词匹配准确性升级）条目。

- [ ] **Step 3: 更新 `packages/dsh-kimi-tide/README.md`** 同款匹配语义段（保持与根 README 一致口径）。

- [ ] **Step 4: 版本号**

`packages/dsh-kimi-tide/package.json`：`"version": "0.6.1"` → `"0.7.0"`。（tag v0.7.0 / Actions 发版由用户裁定，另行执行。）

- [ ] **Step 5: 全量终验 + Commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: 全绿（约 370+ 断言）+ typecheck 0 + build/pack 通过。

```bash
git add docs/router.md README.md packages/dsh-kimi-tide/README.md packages/dsh-kimi-tide/package.json
git commit -m "docs: 0.7.0 关键词匹配语义同步 + version bump"
```

---

## 自检记录（writing-plans self-review）

1. **Spec 覆盖**：设计决策 B1→Task 1、B2→Task 2、B3→Task 3、B4→Task 4+5（UI）；「不做」清单无对应任务（有意为之）。✅
2. **占位符扫描**：无 TBD/TODO；所有代码块为实际可编译内容。✅
3. **类型一致性**：`minHits?: number` 在 config/rules/schema/SettingsCard 四处口径一致；`compileKeyword`/`KeywordMatcher` 名称 Task 1 定义、Task 2/3 复用；`matchingRules` 签名全程不变。✅

---

## 0.7.0 实机验收清单（发布门禁，2026-08-26 用户裁定增设）

> **门禁语义**：本清单全绿 + 用户裁定 tag，二者齐备方可发版（打 `v0.7.0` / 触发 Actions Release）。
> 门禁成文位置：仓库根 README「开发与测试」节（中英镜像）。执行前置：重启 `dsh web`
> （bundle link 直连仓库源码，重启即装载 0.7.0 构建）；验收记录回写本节与路线图证据锚点。

**执行记录（2026-08-26 23:4x，宿主重启于 23:33:58，PID 22464；profile pnpm `link:` 直连仓库 lib，23:25 构建）**：4 只读路由探针 + 会话日志 `request/header` 解码 + bundle/settings 静态核验。✅=主机侧自证通过；👁=待用户协验（清单未全绿，**发版仍冻结**）。

- [x] **A1 装载回归** ✅：重启后插件加载正常（本会话持续工作、`kimi-tide/panel` 推送 ×11 在会话日志实见）；settings.yaml 逐字段复核（saving 4 条规则新序 image→code→plan→chitchat、code 组 17 词）；`/kimi-tide show` 文本输出未直验（命令面存活由会话日志 command/run 佐证）
- [x] **A2 词边界阴性** ✅：探针「帮我 decode 这段 base64」→ request/header = `deepseek-official/deepseek-v4-pro`（落打底，非 code 目标 glm-5.2）
- [x] **A3 词边界阳性** ✅：探针「please refactor this function」→ request/header = `zai-coding-cn/glm-5.2`（code 规则命中）
- [x] **A4 特异度排序** ✅：探针「帮我总结这次重构，顺便写个测试」（chitchat 1 词列表序在前 vs code 2 词）→ `zai-coding-cn/glm-5.2`（code 反超——旧列表序语义会命中 chitchat 的 deepseek-v4-pro，判别成立）
- [x] **A5 minHits 阈值** ✅（2026-08-26 深夜补验，激活预设=saving）：探针「帮我做个方案」（方案 1 词 < minHits 2）→ request/header = `deepseek-official/deepseek-v4-pro`（落打底，plan 规则未触发）；探针「plan：帮我做个方案」（plan+方案 2 词 ≥ 2）→ `qwen-token-plan-cn/qwen3.8-max-preview`（plan 规则触发）；用户本人消息同文路由一致
- [ ] **A6 设置卡片输入** 👁：产物面 ✅（lib/client.js 含 `kt-minhits` 输入与「最少命中词数」文案，23:25 构建）；视觉渲染待用户目检（设置 → 月汐）
- [x] **A7 存量兼容** ✅：重启后无新增 `.pre-v5` 留档；settings.yaml 复核 version 5、activePreset/flows/presets 字段无增删（code 词表 17/plan 4 词均为本次计划内调整）
- [x] **A8 显式指令回归** ✅：探针「@kimi …」→ request/header = `kimi-coding/k3`（显式路由最高优先，不受匹配语义影响）
- [ ] **A9 带图规则回归** 👁：待用户协验——发任意一张图（capability 内 image 规则 → `qwen-token-plan-cn/qwen3.8-max-preview`；saving 为 transcribe 流目标）
- [x] **A10 决策可观测** ✅（主机侧）：`kimi-tide/panel` 推送实见 ×11；四探针 request/header 与决策语义逐一吻合（A2/A3/A4/A8 各一）；chip 视觉渲染待用户目检

**结论（2026-08-26）**：核心匹配语义（A2/A3/A4 判别项）与回归项（A1/A7/A8/A10 主机侧）全部实锤通过；A5 行为、A6 视觉、A9 带图三项需用户协作。**门禁未解除：三项补齐前不打 tag。**
