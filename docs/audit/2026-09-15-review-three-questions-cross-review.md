# 交叉评审：kimi-tide「三问」分析（2026-09-15）

> **评审对象**：本会话对 kimi-tide（月汐）三问的分析结论——① README 是否已脱离初版功能 ② awesome 列表中的插件分类是否准确 ③ 刚接触 vibecoding 的新手能否看懂 README。
> **方式**：两个**独立模型**只读复核同一组命题（C1–C9），控制器逐条回核源码/字节/网络。
> **评审员身份**（按子会话 `request/header` 核验，不取模型自述）：
> - 评审员 A：subagent `94009f37` → `zai-coding-cn / glm-5.3 / reasoningEffort=max`
> - 评审员 B：subagent `9f86a930` → `qwen-token-plan-cn / qwen3.8-max / reasoningEffort=xhigh`
> **硬约束**（对两位相同）：禁文件写、禁 git 写、禁重启进程、禁跑 `npm test|build|pack`；`%TEMP%` 临时下载用完即删。
> **总判**：**方向成立（三问结论均未被推翻），但三处口径必须修正；控制器自身一处数字错误被评审员纠正。**

---

## 1 合并判定表（C1–C9）

| 命题 | A（glm-5.3） | B（qwen3.8-max） | 控制器回核 | 最终口径 |
|---|---|---|---|---|
| **C1** 初版 README＝「Kimi Code 接入 DSH 的完整方案」（`6e337fe`，08-15 03:42），三条接入路径 | 属实 | 属实（措辞需精确化） | 成立 | 成立；「**两条**接入路径」是原文措辞，1/2/3 是编号（第 3 条标「互补」），说「三条路径」属转述而非引用 |
| **C2** 转向有据（CHANGELOG 项目演进 / FAQ 三问 / legacy 存档 / vendor 已删） | 属实 | 属实（补删除 commit `ba9bfc3`） | 成立 | 成立 |
| **C3** `lib/` 有 14 个退役模块产物，`src/` 无同名源、入口不引用，`files:[lib]` 且 build 无 clean | 属实 | 属实 + **决定性限定**：`lib/` 被 `.gitignore:6 packages/*/lib/` 排除，**从未进版本库** | `git ls-files packages/dsh-kimi-tide/lib` = **0** ⇒ 限定成立 | 成立但**降级**：这是**本机陈旧构建产物**（`adapter/classify/scores/scoring` 无人 import，`adapter.js L8-10` 引 `./context.js ./oauth.js ./stream.js` ⇒ 从 `index.js` 不可达的死簇），不是仓库/发布残留 |
| **C4** 官方 Release 资产 45 文件且不含退役产物；本地 `npm pack` 会打出 59 | 属实（本地为推算） | 属实（发布侧实测）+ **59 不可外推** | `tsconfig.build.json`＝include `src`／exclude `src/client`；src 顶层 `.ts` **20** ⇒ 20×2=40 + `client.js` + `client.js.map` = 42；+3（package.json/README/patch）= **45**，与官方 tgz 的 lib=42 逐文件吻合 | **发布侧成立；本地 59 只属于"有陈旧 lib 的开发机"**。全新 clone 按 README 流程同样得到干净的 45 ⇒ 不能拿 59 论证「README 流程有问题」 |
| **C5** awesome 条目 `kimi-tide#dsh-kimi-tide`／owner `tafcear`／category `model`／added 08-30／stars 6／npm·version·downloads 均 null；该分类内有数十个路由类插件 | 属实 | 属实 + **补 `tarball` 字段** + 补生态基线 | 独立复算：目录 3722 条；带 `tarball` **242** 条；`model` 170 条；`model` 带 tarball **13** 条；`model` 中 `npm=null` **69 条（41%）**；路由语义条目 **62** 条（B 用更严正则得 51，量级一致） | 成立；**基线补齐**：`npm=null` 是该分类的常态（41%），未走 npm 不是收录缺陷 |
| **C6** npm registry 上 `dsh-kimi-tide` 与 `kimi-tide` 均 404 | 属实 | 属实 | 成立 | 成立 |
| **C7** README 安装节是源码构建，全文无一行远端安装命令 | 属实 | 属实（补：全仓 md 与 Release 正文同样只写本地 `./tgz`） | 成立；另：`clone` 在初版与当前 README 命中数**均为 0** | 成立，且比原结论更硬：**安装段隐含"仓库已检出"却从未提 clone** |
| **C8** 新手可读性（首屏能懂；卡点＝安装／门槛／术语／无量化／下半噪音） | 部分同意（①属实且更糟；②大体属实但"≥2 模型"系引申；③⑤过重；④属实） | 部分同意（①②④属实；③⑤需削弱；**框架性反例**：README L23 主动劝退零基础读者） | 两位的锚点全部复现（L87/88/89、L97–101、零控制台 URL、零量化收益） | **降级为限定条件下成立**，口径见 §4③ |
| **C9** `避坑记录.md` 含 CRCRLF 且全库唯一 | 属实（374 个 md 全扫） | 属实（补自洽校验：`CRLF 1046 + CRCRLF 12 = LF 1058`；`CR 1070 = 1058 + 12`） | 成立 | 成立（我方首扫 284 个 md 系漏计 `00-暂存`，评审员全量 374 个更完整，结论一致） |

---

## 2 控制器回核（实测，全部本轮亲自复现）

| 回核项 | 结果 |
|---|---|
| **我的一处真错：初版 README 行数** | 我报「234 行」，实为 **340 行**。错因：我用 `Measure-Object -Line` 统计，该 cmdlet **不计空行**（340 行含 106 空行 ⇒ 234）。评审员 A 用数组计数得 340，正确 |
| `lib/` 未进版本库 | `git ls-files packages/dsh-kimi-tide/lib` = **0**；`.gitignore:6 packages/*/lib/`；`git check-ignore -v` 命中该行 |
| 「本地 59」可外推性 | `src` 顶层 `.ts` = 20、`tsconfig.build.json` exclude `src/client`、本地 lib 56 − 14 = 42、+3 = 45 ⇒ **与官方 tgz 一致**；59 仅本机态 |
| 初版 README 措辞 | `两条接入路径：`（原文）→ 其后 1/2/3 编号；`方式 A（推荐）` 原文即 `npm pack` + `dsh plugin add ./dsh-kimi-tide-0.1.1.tgz` ⇒ **源码构建安装自第一天就在** |
| `clone` 命中 | 初版 README = 0；当前 README.md = 0 |
| 目录统计（独立复算） | 3722 条 / 带 tarball 242 / `model` 170 / `model`+tarball 13 / `model` 中 `npm=null` 69（41%）/ 路由语义 62 |
| 分类英文标签出处（B 标"未核实"） | 由我方补上：`plugins.json` → `categories.model = {"en":"Models & Providers","zh":"模型与账号接入"}`。B 找的 `/categories.json` 确实 404，但释义源就在同一份 JSON 里 |
| 仓库状态 | `origin/main..HEAD` = **1 个未推送提交**（`5ce77f0`，21:24 UI 目检落账）；本地 5 个分支；工作区干净 |
| README 双语硬约束 | `scripts/check-readme-sync.mjs` 存在；`AGENTS.md`「README pair — both languages, same commit」 |

---

## 3 评审员新增事实与处置

| # | 新增事实 | 提出者 | 处置 |
|---|---|---|---|
| 1 | `lib/` 被 gitignore，残留对 git 全隐形；`release.yml` 在干净 checkout 里 `npm pack` ⇒ 官方包结构性干净；本机残留随构建史单调累积（无 clean） | A + B（B 补 `git ls-files`=0 与删除 commit） | **采纳**（显著改变 C3/C4 的严重性定性） |
| 2 | 「59」不可外推给普通用户；全新 clone 也是 45 | B | **采纳**（我原表述属"证据不足下强结论"） |
| 3 | README 安装段隐含"已 clone"却零处提及 clone | A(S1) + B | **采纳**（比原结论更具体，且更好修） |
| 4 | 14 个退役文件构成自引用死簇而非 14 个孤立产物 | A + B（B 补配置键名假阳性核对） | **采纳**（表述精确化） |
| 5 | 条目还有 `tarball` 字段直指 Release 资产；生态中走 tarball 分发是成建制做法（全库 242 条，model 类 13 条） | A + B | **采纳**（把"README 需要改"的论据换成更直接的一条） |
| 6 | `npm=null` 在 model 类占 41% ⇒ 三个 null 不是收录异常 | B | **采纳**（补基线） |
| 7 | README 改动必须中英双语同提交，否则 `check-readme-sync` 红 | B | **采纳**（施工约束，原结论漏） |
| 8 | 「分类没问题」原论证是"同类共存"，不等于"分类正确性" | B | **采纳**（结论保留，口径改硬，见 §4②） |
| 9 | C8 的③术语密度与⑤下半噪音过重；真正维护者向内容 ≈ L218–257（35 行/14%） | A + B（行号一致） | **采纳**（削弱） |
| 10 | README L23 主动劝退零基础读者 ⇒ 以"零基础"为唯一尺子与文档自我定位不符 | B | **采纳**（框架性修正） |
| 11 | 本地 1 个未推送提交（`5ce77f0`）；4 个未清理本地分支 + 远端多 1 个分支 | A + B | **采纳为背景**（不影响九条结论） |
| 12 | 发布正文写「691/691」，README L230 不带测试数字；历史上 README 曾写 497/497、597/597 | B | **采纳为待办**（若补量化需先定口径） |

---

## 4 修正后的三问结论（最终口径）

### ① 是否脱离初版 README 的功能 ⇒ **是**（结论不变，证据加强）
初版 `6e337fe`（2026-08-15 03:42）标题即「kimi-tide（月汐）— Kimi Code 接入 DeepSeek Harness 的完整方案」，README **340 行**，原文自述「两条接入路径」并列 1/2/3（自研 OAuth provider / pi-ai + 计划任务 / `vendor/dsh-kimi-bridge` 桥接 Kimi CLI）；当前 v1.3.0 的功能主体是逐步模型路由 + 规则/协作流/配额面板/语义闸。
转向**有据可查**：CHANGELOG「项目演进」三段；README FAQ 三问（OAuth 退役 / 不再需要 `kimi login` / 评分引擎退役）；`docs/legacy-setup.md`（80 行，开头即「⚠️ 已被 0.4.x 取代」）；桥接删除 commit `ba9bfc3`（08-23）、`git ls-files vendor/` = 0。
**残留结论修正**：① 名字与功能错位（成立）② 退役模块产物**不是仓库残留**，而是你本机 `lib/` 的陈旧构建产物（`lib/` 被 gitignore，从未入库；官方包与全新 clone 都是干净的 45 文件）③ 初版三条承诺全部退役（成立）。

### ② awesome 分类是否准确 ⇒ **与目录现状一致，无需改**（口径改硬）
不是「同类共存即证明正确」，而是：`model`（模型与账号接入）一类**同时**容纳"接入"与"选路"两种东西——170 条中路由语义 62 条、`npm=null` 69 条（41%）、走 Release tarball 13 条；kimi-tide 在其中属主流形态。条目本身字段、描述、stars 与 GitHub 实时值（`stargazers_count=6`）一致。
**能提的只有目录粒度问题**（该分类名不传达"路由"），这不是 kimi-tide 的错，也不是必须改的事。

### ③ 新手能否看明白 ⇒ **限定条件下成立**（降级）
README **L23 自己写了「不适合：只用一个模型，或还没跑起 DSH 的人」**——它主动把零基础读者排除在目标受众外。因此：
- 对**还没跑起 DSH 的人**：会卡住，且卡点就是安装路径（源码构建 + 未提 clone）与前置门槛（自取 API Key 无链接）。这也说明 README 的自我定位是诚实的。
- 对**已在用 DSH、接了 ≥2 个模型的用户**：首屏到可用只差 4 步，真实卡点**只剩一条**——「没有一行安装命令」。
- **削弱的两点**：术语高密度区在 L141–160（首屏 L16–73 有白话兜底，L73 还自带术语表）；维护者向内容约 L218–257 共 35 行（≈14%），不足以说"下半是噪音"。
- **成立的三点**：安装段是源码构建（且从未提 clone）；前置条件缺 Kimi 控制台链接（全文零 URL）；收益全文无量化（正则扫 `\d+%|省\s*\d|快\s*\d|减少\s*\d|节省` 唯一命中是 hero 的 `width="100%"`）。

---

## 5 修复清单（按价值排序，均可直接施工）

1. **安装段一行命令**（价值最高、成本最低）：`README.md L100` 与 `README.en.md L100` 的本地 `./dsh-kimi-tide-<version>.tgz` 换成已实测可用的
   `dsh plugin --profile web add "https://github.com/tafcear/kimi-tide/releases/latest/download/dsh-kimi-tide.tgz"`；v1.3.0 Release 正文的安装段同源问题一并改。**必须中英双语同提交**（`check-readme-sync` 门禁）。
2. **补 Kimi 控制台链接**（`README.md L89`）——现在是"自取 Console API Key"却零 URL。
3. **构建卫生**：给包 build 加 clean（或一次性删除本机 `lib/` 里 14 个死簇文件：`adapter/classify/context/oauth/scores/scoring/stream` 的 `.js`+`.d.ts`）——防止本机再次产出 59 文件的包。
4. **（可选）量化收益**：若要写"省多少"，先与 `README.md L230` / Release 正文的测试数口径统一（Release 写 691/691，README 不带数字）。

---

## 6 未核实 / 未覆盖

- **未实跑 `npm pack`**（硬约束）：59 为算术推算；但「全新 clone = 45」有 `tsconfig.build.json` + 文件数 + 官方 tgz 三方一致支撑。
- **`hero.gif` 逐帧内容未核**：A 的模型不支持读图（只有 alt 文本）；B 只读了同源 `hero.svg` 的文本节点。控制器读到的首帧文本与 `hero.svg` 一致（「每步自动选模型，每个决策看得见」），**动图后续帧未核**。
- **awesome 分类释义无官方文档源**：`/categories.json` = 404；释义只能取 `plugins.json` 的 `categories` 映射与列表页渲染结果。
- **CRCRLF 的成因未取证**（仅存在性：12 处，全库唯一）。
- **评审员 B 未见原分析全文**（只收到 9 条命题转述）⇒ 若原报告另有断言未被转述，本轮不覆盖。

---

## 7 方法论留档

- **身份核验只认子会话 `request/header`**：A=`zai-coding-cn/glm-5.3`（max）、B=`qwen-token-plan-cn/qwen3.8-max`（xhigh）——与派发意图一致；模型自述不作证据（09-15 已两次实证）。
- **交叉评审的实际收益（本轮实证）**：两位评审员**分别**纠正了我不同维度的问题——A 抓到我的**统计方法错误**（行数少算空行）、B 抓到我的**证据外推错误**（59 不可外推）与**缺失基线**（npm=null 占 41%）；同时 B 的"未核实项"（分类英文标签出处）由控制器用同一份 JSON 补上 ⇒ **三方互补，无一方单独完备**。
- **本轮零文件改动被评审对象污染**：两位评审员全程只读，未触碰工作区（`git status --porcelain` 空）。
