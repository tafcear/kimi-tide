dsh-kimi-tide v1.3.1 —— 适配 DSH 0.1.7 · DSH 0.1.7 compatibility

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **跟上宿主 0.1.7（本版主题）**：DSH 0.1.7 起插件依赖改由宿主运行时解析，月汐原来随包携带的旧依赖会向新版宿主导入一个已改名的内部符号，导致**每次启动都静默装载失败**（控制台只有一行「did not activate」）。本版把依赖整体对齐到 0.1.7，月汐重新可用。
- **设置改住插件自己的条目配置（上游强制换道）**：0.1.7 起「设置」由当前 Profile 的插件配置保存，`dsh-settings` 不再提供「插件自建命名空间」这条通道。你的路由配置（预设/规则/协作流/关键词组）现在是**本插件条目配置里的 `router` 段**，标记为可实时更新字段——在设置页保存**即时生效、不重载插件**；面板卡片读写同一条数据，落盘仍是 profile 的 `cordis.patch.yml`。**从旧版升级**：插件首次启动会把旧的 `kimi-tide-router.yml`（若有）一次性导入；更早的 `settings.yaml` 写法需按下面「安装与升级」一节手工搬迁。
- **档位表改随配置下发**：每个模型支持哪些推理档位，原来单开一个隐藏设置节推送，现在并入插件配置，面板卡片读配置时一并拿到——少一次请求，也不再往设置文件里塞运行数据。
- **工具结果里的图片能认出来了**：0.1.7 把工具结果从「消息里的一个块」升格为独立消息，带图转述与图像护栏的遍历方式随之更新（不跟上的话，工具产出/截图类图片会**不再被识别**，属静默功能退化）。
- **修掉一个会让会话开不了的隐患**：`agent/created` 钩子的旧写法把返回值漏了出去——0.1.7 该钩子是串行分发、返回值非空即**短路后续监听器**（含宿主的会话初始化链），而钩子体内一旦抛错会**直接让会话创建失败**。现在改为显式返回空值并兜住异常。这个隐患在旧宿主上一直潜伏着。
- **判「路由是否开启」的判据统一**：0.1.7 对「没配过 router 的条目」给出的空值是 `undefined`（不是 schema 声明的 `null`），旧代码只认 `null` ⇒ 那种情况下会拿着非法预设去挂路由器。现在统一走一个判据，未配置就是干净的不路由。
- **设置卡读写通道适配 0.1.7 的严格参数校验**：宿主的设置接口在 0.1.7 改成了「零参读 / 三位置参写」，且**参数个数严格校验**（传 `undefined` 也算传了一个）——本版把读与写的全部调用路径统一到新形态，设置卡恢复可读可写。

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-1.3.1.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web 生效
```

兼容：DSH ≥ `0.1.7-rc.1`（本版实机验证于 `0.1.7-rc.2`）。**0.1.7 起宿主不再读 `settings.yaml`**（仅首启尝试导入一次），因此：

- 若你此前的路由配置住在 `settings.yaml` 的 `kimi-tide-router:` 节：把它整节搬进 profile 的 `cordis.patch.yml` 里 `- id: dsh-kimi-tide` 行的 `config.router`（缩进层级照抄路由节内容），腾空后重启即可；`settings.yaml` 原件可留作备份。
- 若你用的是插件的 `kimi-tide-router.yml` 旧存储：无需手工处理，插件首次启动会导入并把原文件留档为 `.legacy-imported`。
- 其余配置项（`usagePollMs` / `balancePollMs` / `usagePollOnStart`）语义不变。

### 验证与验收

- 测试：**700/700 通过**；typecheck 0 报错；build 通过（host + client）；仓库门禁 `npm run check` 三连过（CHANGELOG/README/package.json 三方版本一致、107 个 md 零断链、双语骨架与徽章集合一致）
- **干跑树复验**（隔离 `DSH_HOME` + 临时端口起真宿主）：启动 stderr **零月汐相关报错**；证据 `docs/audit/2026-09-28-0.1.7-dryrun-verify.stdout.txt` / `.stderr.txt`（stderr 为 0 字节）
- **真实 profile 镜像复验**：把真实 `~/.dsh` 文本层复制成隔离 home（依赖树用目录联接）起宿主，同样零报错；证据 `docs/audit/2026-09-28-0.1.7-realprofile-mirror.stdout.txt` / `.stderr.txt`
- **实机验收（用户执行，2026-09-28 通过）**：宿主 0.1.7-rc.2 上装载正常；**设置 → 月汐卡片可读可写**（预设/规则/轨道档位/语义确认闸均正常显示，保存生效）

---

## English

### What's new

- **Catching up with DSH 0.1.7 (the theme of this release)**: since 0.1.7 the host resolves plugin dependencies at runtime, and 月汐's bundled legacy dependencies imported an internal symbol the host had renamed — so the plugin **silently failed to load on every start** (the console showed a single "did not activate" line). Dependencies are now aligned to 0.1.7 and the plugin loads again.
- **Settings now live in the plugin's own entry config (an upstream-mandated move)**: from 0.1.7 "settings" are stored in the current Profile's plugin configuration, and `dsh-settings` no longer offers the "plugin-defined namespace" channel. Your routing config (presets / rules / collaboration flows / keyword groups) now lives in the **`router` section of this plugin's entry config**, marked as a live-update field: saving in the settings page **takes effect immediately without reloading the plugin**, the panel card reads and writes the same data, and persistence still goes to your profile's `cordis.patch.yml`. **Upgrading from older versions**: the plugin imports a legacy `kimi-tide-router.yml` (if present) once at first start; an even older `settings.yaml` layout needs the manual move described under Install & upgrade.
- **Effort catalog now rides along with the config**: which reasoning levels each model supports used to be pushed through a separate hidden settings section; it is now part of the plugin config the panel card already reads — one request less, and no runtime data in your settings file.
- **Images inside tool results are recognized again**: 0.1.7 promoted tool results from "a block inside a message" to standalone messages, so image transcription and the image guard had to change how they walk the payload (not doing so would **silently stop recognizing** tool-produced/screenshot images).
- **Fixed a latent defect that could block session creation**: the old `agent/created` handler leaked its return value — in 0.1.7 this hook dispatches serially, a non-empty return **short-circuits every later listener** (including the host's session-initialization chain), and a throw inside the handler **fails session creation outright**. It now returns empty explicitly and swallows its own errors. The defect had been dormant on older hosts.
- **One predicate for "is routing on"**: for an entry with no router configured, 0.1.7 hands the plugin `undefined` (not the schema-declared `null`), and the old code only checked for `null` — in that state it would mount the router with an invalid preset. A single predicate now covers it, and an unconfigured entry means cleanly "no routing".
- **Settings card adapted to 0.1.7's strict argument validation**: the host's settings interface became "zero-arg read / three-positional-arg write" with **strict arity** (passing `undefined` also counts as an argument) — every read and write path is now aligned, and the settings card is readable and writable again.

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-1.3.1.tgz
# or install the same tgz from the Release assets; restart dsh web afterwards
```

Compatible with DSH ≥ `0.1.7-rc.1` (verified on `0.1.7-rc.2`). **Since 0.1.7 the host no longer reads `settings.yaml`** (it attempts a one-time import on first boot), so:

- If your routing config lived in the `kimi-tide-router:` section of `settings.yaml`: move that whole section into `config.router` of the `- id: dsh-kimi-tide` row in your profile's `cordis.patch.yml` (keep the relative indentation of the section body), then restart. The original `settings.yaml` can stay as a backup.
- If you used the plugin's legacy `kimi-tide-router.yml` store: nothing to do — the plugin imports it at first start and archives the original as `.legacy-imported`.
- The remaining options (`usagePollMs` / `balancePollMs` / `usagePollOnStart`) keep their meaning.

### Verification & acceptance

- Tests: **700/700 passing**; typecheck 0 errors; build passing (host + client); repo gates `npm run check` all green (three-way version agreement, 107 markdown files with zero broken links, bilingual skeleton and badge parity)
- **Dry-run verification** (isolated `DSH_HOME` + a real host on a scratch port): **zero 月汐-related stderr output** at startup; evidence in `docs/audit/2026-09-28-0.1.7-dryrun-verify.stdout.txt` / `.stderr.txt` (stderr is 0 bytes)
- **Real-profile mirror verification**: the real `~/.dsh` text layer copied into an isolated home (dependency tree junctioned) booted with the same clean result; evidence in `docs/audit/2026-09-28-0.1.7-realprofile-mirror.stdout.txt` / `.stderr.txt`
- **On-device acceptance (run by the maintainer, passed 2026-09-28)**: loads cleanly on host 0.1.7-rc.2; **Settings → 月汐 card is readable and writable** (presets, rules, effort levels and the semantic confirmation gate all render, and saving takes effect)
