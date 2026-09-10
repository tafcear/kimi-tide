# 启动级 E2E：会话事件类型注册

这里只有一个 E2E，但它测的是产品真实启动路径，而不是单元里的替身：**「库里存着本插件自定义事件类型的会话，重启后还读得出来吗？」**

单元测试能证明 `apply()` 往 `KNOWN_SESSION_EVENT_TYPES` 里加了两个类型；它证明不了「真 `dsh web` 启动 → 真插件装载 → 真 `sessionQuery.observeSession()` 读历史会话」这条链。这个脚本补的就是这一段。

## 怎么跑

```bash
# 正例：当前构建（应全绿）
node scripts/e2e/session-events-boot.mjs --expect ok

# 反例（falsify）：把 panel 注册那一行剥掉的插件副本挂上去，必须复现「整卷拒载」
node scripts/e2e/session-events-boot.mjs --expect refused --pre-fix
```

退出码 0 = 断言全过；1 = 有断言失败（或没等到判定文件，日志尾部会打出来）。
两个都跑才算完整：正例证明修好了，反例证明这个 E2E **会失败**——不会失败的 E2E 等于没有 E2E。

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

## 它到底做了什么

1. **隔离 DSH home**（临时目录，绝不碰你的 `~/.dsh` 数据）：`profiles/node_modules` 与 `profiles/web/node_modules/@deepseek-ai` 用 junction 指回真实安装，`dsh-kimi-tide` 指向本仓库的包目录（或 `--pre-fix` 的剥皮副本）。bundle 列表只留 `dsh-base` + `dsh-web-app` + `dsh-kimi-tide`，去掉无关第三方插件，结果可复现。
2. **合成夹具**：写两个当前代（v3）会话——
   - `session-e2e-control`：只有 `permission/preset`、`sandbox/mode`、`approval/policy`、`turn/start|end`；
   - `session-e2e-custom-event`：同上，另加一条 **不带 `ignorable: true`** 的 `kimi-tide/panel`（seq 3，payload 形制与 1.2.0 之前插件写的一致）。
   目录名按 header 的 `cwd` 编码（`--E-kimi-tide-e2e--`），否则存储层会判 corrupt——这一点本身就是踩过的坑。
3. **真启动**：`node <dsh>/lib/bin.js --profile web --no-open --port 0`，`DSH_HOME` 指向隔离 home，stdout/stderr 落 `boot.log`。
4. **进程内取证**：`probe-plugin.mjs` 作为 profile 插件（`e2e-probe.mjs` 行）在**同一个进程**里读两个夹具，走 `ctx.sessionQuery.observeSession(id, { projectionMode: 'none' })`——产品历史加载用的就是这条调用；顺带用 `import('@deepseek-ai/dsh-session')` 报出宿主自己那份 catalog，以及 `settings.describe()` 里的命名空间（`kimi-tide-router` / `kimi-tide-catalog` = 插件确实装载了）。
5. **判定**：轮询到 `verdict.json` 为止（失败会重试到超时，所以反例要跑满 ~45s），然后 `taskkill /T /F` 收进程树、按 `--expect` 断言、清理隔离 home。

## 断言表

| 检查 | `--expect ok` | `--expect refused` |
| --- | --- | --- |
| 插件装载（`kimi-tide-router` 命名空间） | PASS | PASS |
| catalog 含 `kimi-tide/panel` | true | false |
| catalog 含 `kimi-tide/review` | true | true |
| control 会话可读 | PASS | PASS |
| 自定义事件会话 | 可读（6 事件） | 拒载，且错误里点名 `kimi-tide/panel` |
| 错误文本含 `not marked ignorable` | — | PASS |

## 已记录结果（2026-09-10，本机）

正例（`--expect ok`）：

```
catalog        : panel=true review=true size=58
settings ns    : …, kimi-tide-router, kimi-tide-catalog, …
control        : OPENS (5 events)
custom event   : OPENS (6 events)
probe attempts : 1 (elapsed 4197 ms)
PASS  plugin mounted / catalog panel=true / catalog review / control loads / custom-event loads
```

反例（`--expect refused --pre-fix`）：

```
catalog        : panel=false review=true size=57
control        : OPENS (5 events)
custom event   : REFUSED -> failed to observe session "session-e2e-custom-event":
                 session "session-e2e-custom-event" contains event type "kimi-tide/panel" (seq 3)
                 unknown to this harness and not marked ignorable; refusing to interpret the log
                 — it was likely written by a newer harness
probe attempts : 42 (elapsed 45483 ms)
```

反例那条文本与 2026-09-10 用户实机报的「历史加载失败」逐字同源，所以这个 E2E 锚的是真实故障面，不是自造的场景。

## 与 CI 的关系

CI（`.github/workflows/ci.yml`）跑不了这个 E2E：它要一台装了 DSH 的机器（`$DSH_HOME/profiles`）才能 compose 出 profile。所以它不进 CI，属于**发版前人工验收**那一类，和 `docs/release-evidence.md` 里记录的实机验收同性质。
