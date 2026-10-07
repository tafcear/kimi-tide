# 启动级 E2E：会话事件类型注册

这里只有一个 E2E，但它测的是产品真实启动路径，而不是单元里的替身：**「库里存着本插件自定义事件类型的会话，重启后还读得出来吗？」**（2026-09-10 实机事故 `历史加载失败: … unknown to this harness` 的回归防线。）

单元测试能证明 `apply()` 往 `KNOWN_SESSION_EVENT_TYPES` 里加了类型；它证明不了「真 `dsh web` 启动 → 真插件装载 → 真 `sessionQuery.observeSession()` 读历史会话」这条链。这个脚本补的就是这一段。

## 怎么跑

```bash
# 正例：当前构建（应全绿）
node scripts/e2e/session-events-boot.mjs --expect ok

# 反例（falsify）：把 panel 注册那一行剥掉的插件副本挂上去，必须复现「整卷拒载」
node scripts/e2e/session-events-boot.mjs --expect refused --pre-fix
```

退出码 0 = 断言全过；1 = 有断言失败（或没等到判定文件，日志尾部会打出来）。
两个都跑才算完整：正例证明修好了，反例证明这个 E2E **会失败**——不会失败的 E2E 等于没有 E2E。

实测单次耗时（2026-10-07，本机）：正例 ≈ 10 s；反例 ≈ 25 s（v4 拒绝有 15 s 注册宽限期，防插件 apply 时序误判，见下）。

常用选项：

| 选项 | 作用 |
| --- | --- |
| `--expect <ok\|refused>` | 断言方向，默认 `ok` |
| `--pre-fix` | 复制一份插件、剥掉 `known.add(KIMI_TIDE_PANEL_EVENT)`，用作反例（**不碰仓库构建产物**） |
| `--plugin <dir>` | 直接指定要挂载的 `dsh-kimi-tide` 包目录 |
| `--source-home <dir>` | 提供 `profiles/` 的 DSH home，默认 `$DSH_HOME` 或 `~/.dsh` |
| `--timeout <ms>` | 等判定文件的预算，默认 120000 |
| `--keep` | 保留隔离 home 与启动日志（内含 `boot.log`、`verdict.json`） |
| `--out <dir>` | 隔离 home 落在哪，默认系统临时目录 |

前置：本机存在可用 DSH 安装（需含 `profiles/web` 与 `profiles/node_modules`），Node ≥ 24（`node:zlib` 的 zstd API）。

## 它到底做了什么

1. **隔离 DSH home**（临时目录，绝不碰你的 `~/.dsh` 数据）：`profiles/node_modules` 与 `profiles/web/node_modules/@deepseek-ai` 用 junction 指回真实安装，`dsh-kimi-tide` 指向 profile 里装的那份（realpath 后即本仓库的包目录；`--pre-fix` 时为剥皮副本）。bundle 列表只留 `dsh-base` + `dsh-web-app` + `dsh-kimi-tide`，结果可复现。
2. **合成夹具**：两代格式 × 对照/自定义，共 4 份——
   - v3（历史格式）：`session-e2e-control`（仅已发布类型）与 `session-e2e-custom-event`（外加一条不带 `ignorable` 的 `kimi-tide/panel`，payload 形制与 1.2.0 之前插件写的一致）；
   - v4（**当前格式**）：`session-e2e-v4-control` 与 `session-e2e-v4-custom-event`，事件集与 v3 夹具相同，按 `session.v4.jsonl.zstd` 落盘。
   行格式两代同形（`{type,seq,time,data}` 逐行 JSONL、多 zstd 帧追加），与本机 111 份真实生产 v4 会话逐项核对过；目录名按 header 的 `cwd` 编码（`--E-kimi-tide-e2e--`），否则存储层会判 corrupt——这一点本身就是踩过的坑。
3. **真启动**：`node <dsh>/lib/bin.js --profile web --no-open --port 0`，`DSH_HOME` 指向隔离 home，stdout/stderr 落 `boot.log`。
4. **进程内取证**：`probe-plugin.mjs` 作为 profile 插件在**同一个进程**里读 4 份夹具，走 `ctx.sessionQuery.observeSession(id, { projectionMode: 'none' })`——产品历史加载用的就是这条调用；顺带读**宿主自己那份** `KNOWN_SESSION_EVENT_TYPES` 与 `settings.describe()` 的命名空间列表。探针的裸 `import('@deepseek-ai/dsh-session')` 经隔离 profile 的 junction 解析到部署真实模块（verdict 的 `catalog.resolvedFrom`），与宿主校验、插件注册三者同一物理实例——同源性有直接证据，不是推断。
5. **判定与收尾**：轮询到 `verdict.json`；命中上游冻结/未注册拒绝消息的条目按终态收敛（v3 立即、v4 过 15 s 宽限），避免反例空跑 45 s；teardown 平台分支（Windows `taskkill /T /F`，POSIX `child.kill('SIGKILL')`）。

## 断言表（2026-10-07 起）

| 检查 | `--expect ok` | `--expect refused` |
| --- | --- | --- |
| 插件装载（命名空间 = 插件 `package.json` 的 `name`，不写死字符串；失败打印实际列表） | PASS | PASS |
| 宿主目录含 `kimi-tide/panel` | true | false |
| 宿主目录含 `kimi-tide/review` | true | true |
| v3 control 可读 | PASS | PASS |
| v3 自定义 ⇒ **上游按设计拒载**，消息点名 `kimi-tide/panel` | PASS（同一行为） | PASS（同一行为） |
| v4 control 可读 | PASS | PASS |
| v4 自定义会话 | **可读（注册生效 ⇒ v4 历史可读，本 E2E 真正守的承诺）** | 拒载，消息含 `unknown to this harness and not marked ignorable` 且点名类型 |

## 为什么 v3 自定义类型那条是「上游设计使然」

- v3 读取判据 = `@deepseek-ai/dsh-session-format-v3-to-v4` 内**冻结的字面量 Set** `RELEASED_V3_EVENT_TYPES`（拒绝消息 `format v3 contains unknown event type "…" at seq N`）；
- 插件改写的是另一套**可变目录** `KNOWN_SESSION_EVENT_TYPES`（`@deepseek-ai/dsh-session`），它只约束 v4；
- ⇒ 任何注册都救不回「v3 里带自定义类型的事件」。插件无法修复，也**不该**为此改产品代码。
  该 check 把这一事实钉成显式断言（必须拒载 + 消息必须点名类型），不许静默放过。

## 已记录结果（2026-10-07，本机，v4 世代改造后）

正例 7/7 PASS（`catalog: panel=true review=true revise=true size=62`；v4 custom `OPENS (6 events)`，elapsed ≈ 3 s）；
反例 7/7 PASS（`panel=false size=61`；v4 custom 拒载，消息与 09-10 用户实机报的「历史加载失败」逐字同源，elapsed ≈ 16 s）。
历史版本（09-10，v3-only、旧命名空间断言）的记录见 git 历史。

## 进 CI 的建议

1. **该进，且两条都进**（正例 + 反例缺一不可：只有正例测不出「注册没生效也绿」的空过）。本 E2E 自 09-10 写就后不在 CI（`ci.yml` 只跑 `npm test`），静默腐烂近一个月——根因就是没进 CI。
2. **放哪**：独立 job（如 `e2e`），与单测 job 并行；`timeout-minutes: 10`，预计整 job 3–5 分钟（装机 + 两条 E2E）。
3. **前置（主要成本）**：runner 必须先装一份真实 DSH 宿主——全局安装 `@deepseek-ai/dsh` 并 bootstrap 出 `~/.dsh/profiles/web`（含 `dsh-base` / `dsh-web-app` bundles 与 `profiles/node_modules` 扁平区），再把 `profiles/web/node_modules/dsh-kimi-tide` 链接到 `packages/dsh-kimi-tide`。没有这份安装，脚本在锚点检查处直接报错退出，不会假绿。
4. **平台差异（会假红，需先处理再上 mac/linux）**：旧版 teardown 只有 `taskkill` ⇒ 已改平台分支；`symlinkSync(..., 'junction')` 在 POSIX 退化为普通 symlink（目录可用，但 CI 需允许 symlink）；夹具 `cwd` 是 Windows 风格字符串，仅作编码用，跨平台无害；zstd 帧编解码跨平台一致。**建议先只上 `windows-latest`**（与开发环境一致、零额外适配），mac/linux 待真实 runner 验证后再开矩阵。
5. **版本对齐**：宿主与格式代（v3/v4）强相关，上游升 v5 时 v4 夹具构造与拒绝文案都可能变——CI 里把宿主版本钉住（与本地开发同版），升宿主时同步重跑本 E2E 校准。
