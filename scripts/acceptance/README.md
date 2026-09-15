# 实机验收哨兵

这里放**读已运行宿主留下的痕迹**做判定的验收工具——与 [`../e2e/`](../e2e/README.md) 互补：那边的 E2E 自己拉起一个隔离宿主跑启动级断言，这边的哨兵不启动任何东西，只解析真实会话日志。

## 语义闸哨兵（`hit-confirm-sentinel.mjs`）

### 它治的是什么

语义命中确认闸（`preset.hitConfirm`）的失效是**静默**的：判官问不到结论时一律 fail-open（按原关键词结果走），而这与「闸门压根没开」的行为**完全等价**。判词本身又只写进程 stdout、不落文件，判否还会让规则出链、最终落打底，而打底按既有取舍不上报面板——于是「判否」这个最该被看见的结果反而完全不可见。

2026-09-15 的 v1.3.0 实机验收就是这样：闸门开了、每轮关键词语义都发判官调用、每次都吃满 1.2s 有界超时，但**一次有效判词都没产出过**，而单元测试 659/659 全绿——因为 mock 永远返回理想判词。

### 为什么「连发两次」能当探针

`HitConfirmGate` 的 LRU 缓存**只写有结论的结果**（hit / omit）；失败 / 超时 / 判词解析失败一律不写，缓存还是**进程级**、跨会话共享。所以对同一句话开两个新会话：

- 判官成功过 ⇒ 第二次命中缓存 ⇒ pre-step 耗时**骤降到无闸基线**；
- 判官从未成功 ⇒ 第二次照样重跑 ⇒ 耗时与第一次同量级。

### 怎么跑

```bash
# 1) 先连发两次同一句话（都要含关键词，例如「重构」），每次一个新会话
# 2) 再跑哨兵
node scripts/acceptance/hit-confirm-sentinel.mjs --minutes 30 --text 重构

# 只看某个会话的全部请求头
node scripts/acceptance/hit-confirm-sentinel.mjs --session ~/.dsh/sessions/--<工作区>--/<会话id>

# 机器可读
node scripts/acceptance/hit-confirm-sentinel.mjs --json
```

退出码：`0` 未发现可疑 · `1` 同文本多次出现却毫无耗时下降 · `2` 参数或读取错误。

| 选项 | 作用 |
| --- | --- |
| `--minutes <n>` | 只看最近 n 分钟更新过的会话，默认 30 |
| `--text <片段>` | 只统计首条真实用户文本含该片段的会话（做同文本对照时必用） |
| `--session <路径>` | 直接指定会话目录或 `session.v3.jsonl.zstd` |
| `--json` | 输出完整结构（sessions / verdicts / suspicious） |

### 判据的边界（诚实声明）

- **「未下降」是可疑信号，不是定罪**：缓存容量 64 条，被 LRU 逐出后同文本会重新判。
- **「下降」可以确证**判官至少成功过一次。
- 判据字段是 `turn/start → 首个 request/header`。**不要用「首条 user 消息 → 首个请求」**——`user/message` 与 `request/header` 几乎同刻写入，两者之差恒为个位数毫秒，测不到 pre-step。这个坑是拿 2026-09-15 那 5 次真实探针当反例跑出来的：初版用错字段，把「判官从未成功」误判成了「至少成功过一次」。
- 哨兵报出的可疑要结合**面板决策原因串里的「语义闸…」注记**确认——那是 v1.3.0 可观测性补链新加的面。

### 反例验证（这个哨兵自己也被验证过）

用 2026-09-15 实机验收留下的 5 次同文本探针（A7/B1/C1/C2/C3，逐字节相同的 38 字消息）当夹具，哨兵必须报可疑：

```
文本: 请只回复 OK，不要调用任何工具。我昨天那个重构早就写完了，今天想聊点别的。
  出现 5 次 · 首次 1408ms · 其后 [1166, 1199, 1371, 1069]ms（最快 1069ms）
  ⚠️  毫无下降（判官可能从未成功）
```

这 5 次的会话日志被 LRU 语义确证过：缓存**一次都没命中**，因此 hit/omit 两种「成功」都被排除，只剩「无结论」与「判词不可解析」两种失败形态。

## 旧面板载荷离线验收（`panel-legacy-scan.mjs`）

治的是交接单里那句「待实机验收」——**「老会话能不能投影出来」是纯函数问题**（`panelSchema.parse`），不必开界面：把样例会话里**真实的**旧面板事件喂给发货中的同一份 schema 即可判定。

```bash
node scripts/acceptance/panel-legacy-scan.mjs         # 三个样例（交接单材料指针③）
node scripts/acceptance/panel-legacy-scan.mjs --json
```

退出码：`0` 抽到的旧载荷全部可投影 · `1` 有载荷被拒（附 zod issues） · `2` 取不到 schema（产物形状变了）。

**2026-09-15 实测**：`session-4fb0f4d5` 543/543 旧载荷通过、`session-6ca2f899` 53/53 通过（该会话另有 310 条现代载荷）⇒ **596 条旧载荷全过**，投影层那半闭环；剩「评审卡渲染」那半要眼睛。第三个样例 `session-c01dab3c` **已确认丢失**（09-14 `~\.dsh` 整目录删除事故，全盘扫描不复存在），脚本按「记录在案」处理、不判失败——把它算失败会掩盖真正要盯的两个。

同批顺带确认了**面板事件已停写**：全库 245 个会话，近 24h 更新的会话里 `kimi-tide/panel` 事件 **0 条**（v1.2.0 解耦生效的期望值）。

## 会话日志普查（`session-dump.mjs`）

排障与取证的**第一站**：读已运行的宿主留下的会话日志，回答「这卷日志里到底有什么」。

```bash
node scripts/acceptance/session-dump.mjs --list [--minutes 30]   # 不传路径：列最近更新的会话
node scripts/acceptance/session-dump.mjs <会话目录|文件>           # 概览（事件类型普查）
node scripts/acceptance/session-dump.mjs <路径> --positions       # ★ 哪些事件类型带 turn/step
node scripts/acceptance/session-dump.mjs <路径> --users           # 用户消息形状（source/块型）
node scripts/acceptance/session-dump.mjs <路径> --errors          # 错误/失败扫描
node scripts/acceptance/session-dump.mjs <路径> --grep <文本>     # 任意事件原文匹配（字面量子串）
node scripts/acceptance/session-dump.mjs <路径> --json
```

**`--grep` 是字面量子串匹配，不是正则**（2026-09-15 修正）：把命令行传进来的字符串编译成正则，会让仓库常驻一条高风险告警（CodeQL `js/regexp-injection`，CWE-400 / CWE-730 —— 安全页告警 #4）。而这个入口真正要回答的几乎只有「这段原文在不在」，字面量匹配把它 100% 覆盖，还天然免于 ReDoS：正则元字符按字面处理，`--grep 'a.*b'` 找的就是字面 `a.*b`。

同会话改前/改后对照实测（`session-42005dc1`，3503 事件）：`--grep 'step/start'` **279 条**（常用面不变）；`--grep 'step/(start|end)'` 改前 **558 条** → 改后 **0 条**；`--grep '.+'` 改前 **1660 条** → 改后 **8 条**（元字符已按字面处理）。

**为什么 `--positions` 值得单独存在**：跨事件对齐的前提。2026-09-15 做「路由是否落地」判据时，
按 `turn` 配对 `request/header` 与 `assistant/message` 得到 **3.2% 假阳性**——因为
**`request/header` 与 `user/message` 都不带 turn/step**（只有 `turn/start`/`step/start`/`assistant/message` 带），
必须按**事件序游标**归集。这一页把该事实一次打出来，省掉重踩。

**与既有工具的分工**：`hit-confirm-sentinel.mjs` / `panel-legacy-scan.mjs` / `q6-gating-check.mjs` 是
**面向具体判据**的；本工具是**面向「日志内容本身」**的通用入口。实现上逐帧解析 zstd frame header
（不是扫 magic——那会在压缩数据里误命中），尾帧截断容忍（日志正在写），坏帧跳过并计数，
v3 与 v0 两种磁盘形态都支持。

**2026-09-15 实测**：v3 会话 56 帧 / 108 事件 · v0 样例 2 帧 / 547 事件（543 条 `kimi-tide/panel`）均正常。

## 发布前一致性自检（`prepush-coherence.mjs`）

已有的 `scripts/check-*.mjs` 各查一角（版本号 / README 双语骨架 / 发布正文四段 / 本地链接），但**没有一处**回答「**这次要发的新东西，有没有全部被讲到**」。本检查补这一角，五项：

```bash
node scripts/acceptance/prepush-coherence.mjs              # 含跑全量测试取实测数
node scripts/acceptance/prepush-coherence.mjs --skip-tests # 只查一致性（快）
node scripts/acceptance/prepush-coherence.mjs --json
```

| # | 查什么 |
| --- | --- |
| ① | 版本三方一致：`package.json` / CHANGELOG 首节 / README 双语版本行 |
| ② | 发布正文条目数与 CHANGELOG 该节不背离（正文不应凭空多出 2 条以上） |
| ③ | 发布正文里的**测试数 == 实测**（实跑 vitest 取数） |
| ④ | **用户可见新特性逐条被讲到**：每条特性在「说明页 / README / README.en / CHANGELOG / 发布正文」里至少命中 N 个面 |
| ⑤ | 干净度：仓库无 `.tmp-*`/`.bak` 残留、`src/` 无调试开关残留 |

退出码：`0` 全过 · `1` 有项不过（逐条列出） · `2` 读取/环境错误。

**2026-09-15 实测**（v1.3.0 推前）：版本三方一致、正文 14 条 vs CHANGELOG 25 条、**正文声称 691 = 实测 691**、7 条新特性全部 5/5 面命中、零残留 —— 全过。**并做过反例验证**：把正文测试数临时改成 12345 ⇒ ③ 精确报红并 exit 1（绿的检查不算证据）。

## Q6 门控离线验收（`q6-gating-check.mjs`）

`@` 在本 Harness 里同时是**工作区路径引用**语法与**路由指令**语法。修之前任何含 `@` 的文本都被当成显式指令；provider 不在候选池时 `decide` 返回 `keep` 并**整条跳过关键词规则链**（连带跳过语义确认闸、关掉评审流武装），界面上完全看不出规则被跳过。

这个检查能离线跑完，是因为门控判据是纯函数、效果面（`decide`）也是纯函数（注入 metas 即可）——不必起宿主：

```bash
node scripts/acceptance/q6-gating-check.mjs          # 判据 10 例 + decide 三态 4 例
node scripts/acceptance/q6-gating-check.mjs --json
```

退出码：`0` 全过 · `1` 有用例失败（附期望/实得） · `2` 取不到构建产物。

**2026-09-15 实测全过**，四类关键行为：未识别 `@x`（`@README.md`/`@anthropic`）**落打底 + 原因串写明已忽略**；已知 provider 但无可用候选**仍 `keep`**（保 Q3「点了名就不静默改道」）；真指令且候选可用 ⇒ 精确寻址；`@kimi` 等内置别名不受影响。

## 判官离线探针（`judge-probe.mjs`）

哨兵能告诉你「判官没成功」，**不能告诉你为什么**——判词在宿主进程内产出、只写 stdout。这个探针把**判官那一发请求**原样复现到进程外：用 `lib` 里真实的 `buildConfirmInput`，同样的 `maxTokens`、同样的线缆参数，只把传输换成本机 HTTP 直连。

```bash
node scripts/acceptance/judge-probe.mjs                          # 默认探针句 + 宿主现状参数
node scripts/acceptance/judge-probe.mjs --thinking disabled      # 关掉思考（= 修复后的行为）
node scripts/acceptance/judge-probe.mjs --max-tokens 256 --runs 3
node scripts/acceptance/judge-probe.mjs --text "帮我重构这段代码"  # 换句子
```

它一次问清三件事：真实耗时多少、预算够不够、模型到底吐了什么形状。**2026-09-15 的 A7 根因就是它定死的**：不关思考时 `completion_tokens` 全部计入 reasoning、正文 0 字符、`finish_reason=length`（64 与 256 都一样）；关掉思考后同预算下 450–850ms 返回合法判词。

两条踩过的线缆细节（探针注释里也写着）：

- 宿主的 `reasoningEffort: 'off'` 经 `dsh-llm-deepseek` 的 `resolveThinking` 映射为线缆上的 **`thinking: {type:'disabled'}`**；直传 `reasoning_effort: 'off'` 会被 DeepSeek 以 400 `unknown variant 'off'` 拒绝（它只认 `none|minimal|low|medium|high|xhigh|max`）。
- 凭据取 `DEEPSEEK_API_KEY`（环境变量优先，回落 `~/.dsh/.credentials.yaml` 的 refs 段），探针从不打印 key。
