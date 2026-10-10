dsh-kimi-tide v2.2.2 —— 路由目标「装不下」不再白等一轮 · stop routing turns into empty 400s

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **规则目标的上下文窗口纳入路由判定**：此前规则链只判「目标在候选目录里可用」与「带图时支持图像」，**从不读目标的上下文窗口**——会话一旦累积超过规则目标的窗口，整轮请求在网关侧就被拒，而报错信息是**空的**（`{"code":400,"message":""}`，一个 token 都没计）。现在装不下就**跳过该条规则**继续降级链、全部装不下则落默认目标；面板的决策原因会写明「哪条规则因窗口被跳过、目标窗口多大、当时占用多少」。
- **空报错可归因**：默认目标自身装不下时也会预警（仍照旧路由，不替你改道）；另注册宿主 `agent/request-error`，在「空 message 的 400 ＋ 本插件选定的目标 ＋ 该目标窗口已知」时记一条可检索的归因日志。**不改写那条报错、不重试**——宿主的失败事实原样保留。
- **占用与窗口未知一律放行**：占用读宿主令牌度量（`totalTokens`），预留输出 32,000 token；宿主没挂度量、度量抛错、目标未披露窗口——三种情况都按修前行为路由。**不传占用时决策与决策原因逐字节与修前一致**。
- **派发护栏在岗可见 ＋ 环境不满足时不再静默**（派发护栏开关开着而护栏装不上时，dock 标记会显示「未在岗（…）」并说明原因；开关未开仍是用户意图、不告警），并修掉一处**真机抓到的注册回归**：环境探测把宿主的 `tools.guard` 摘成裸引用，调用时 `this` 丢失 ⇒ 注册必抛、护栏静默装不上（dock 显示「未在岗（注册失败）」）。
- **dock 紧凑态的显示错位修复**：紧凑态主按钮是固定尺寸芯片却不会自收，长 provider/model 会溢出按钮、**盖到右侧宿主的模型选择控件上**（观感：目标被截成上下两截、模型名压到「护栏」那一列）。现在溢出被剪、目标文本收缩出省略号（悬停仍可读全文），护栏与提示标记不再被挤掉。

### 安装与升级

```bash
# 从 Release 资产安装（版本名或稳定名 dsh-kimi-tide.tgz 均可）
dsh plugin --profile web add ./dsh-kimi-tide-2.2.2.tgz
# 或直接走 npm
dsh plugin --profile web add dsh-kimi-tide
# 装完重启 dsh web 生效
```

兼容：DSH 0.2.0-rc.2 及以上的 0.2.x；**无需改动 `settings.yaml`**——本版没有新增配置项，也没有配置结构变更（存量预设与规则照常读取）。窗口判定只在候选目录枚举完成后生效，插件刚重挂的那一小段窗口内按修前行为路由。

### 验证与验收

- 测试：**1209/1209 通过**（64 个测试文件，v2.2.1 为 1170）；`tsc --noEmit` 0 错；`npm run build` 双端通过；`npm run check` **六闸全过**。
- 回归钉：窗口边界（刚好装下 / 差 1 token）、窗口未知、占用未知、不传占用时决策逐字节一致；派发护栏的三种环境失败与注册回归各有用例；紧凑态容纳契约三条（缺 `overflow` / 缺收缩基础值 / 护栏标记被改成可压缩，任一处即红）。
- 实机验收：两条缺陷都由**真机现象**定位——护栏注册回归是**重启宿主后**实测抓到的；窗口缺陷来自外部用户报告（规则目标 256K、会话累积 33 万 token，整轮 `400 INVALID_REQUEST` 且报错为空）。**如实标注未验项**：窗口降级的**真机触发**尚未完成目检（需要在长会话里用一个小于会话占用的规则目标跑一轮），本版以单元与集成测试覆盖该路径。

---

## English

### What's new

- **A rule target's context window is now part of the routing decision**: the rule chain used to check only "is the target available in the candidate catalog" and "does it accept images" — it **never read the target's context window**. Once a session grew past a rule target's window, the whole turn was rejected at the gateway with an **empty** error message (`{"code":400,"message":""}`, zero tokens billed). Now a target that cannot fit is **skipped** and the chain keeps falling through; if nothing fits, the turn lands on the default target. The panel's decision reason says which rule was skipped, how big the window is and how full the session was.
- **Empty 400s are now attributable**: when even the default target cannot fit, a warning note is written (it is still routed there — the plugin never reroutes on your behalf); and a host `agent/request-error` listener logs one searchable line when an empty-message 400 happens on a target this plugin picked and whose window is known. The original error is **left untouched and never retried**.
- **Unknown occupancy or unknown window always passes**: occupancy comes from the host token meter (`totalTokens`) plus a reserved output of 32,000 tokens. No meter, a throwing meter, or a target that never discloses its window — all three route exactly as before. **Without occupancy the decision and its reason are byte-for-byte identical to the previous version.**
- **The dispatch guard is now visibly armed, and no longer degrades silently**: when the guard switch is on but the guard cannot be installed, the dock chip says "not armed (…)" with the reason (switch off stays silent — that is user intent). This release also fixes an **install-blocking regression caught on a real machine**: the environment probe handed out the host's `tools.guard` as a bare reference, losing `this` on call ⇒ registration always threw and the guard was silently never armed.
- **Compact dock alignment fix**: the compact dock button is a fixed-size chip that did not contain its content, so a long provider/model overflowed it and **covered the host's model selector next to it**. Overflow is now clipped, the target text truncates with an ellipsis (hover still shows the full value), and the guard/hint chips are no longer squeezed out.

### Install & upgrade

```bash
# Install from the Release assets (versioned name or the stable dsh-kimi-tide.tgz)
dsh plugin --profile web add ./dsh-kimi-tide-2.2.2.tgz
# or straight from npm
dsh plugin --profile web add dsh-kimi-tide
# restart dsh web afterwards
```

Compatibility: DSH 0.2.0-rc.2 and later 0.2.x; **`settings.yaml` needs no edits** — no new options and no config-shape changes (existing presets and rules load as-is). The window check applies once the candidate catalog has been enumerated; during the brief window right after a remount the plugin routes as before.

### Verification & acceptance

- Tests: **1209/1209 passing** (64 test files; v2.2.1 was 1170); `tsc --noEmit` clean; `npm run build` passes on both halves; `npm run check` **all six gates green**.
- Regression pins: window boundaries (exactly fits / one token short), unknown window, unknown occupancy, and byte-identical decisions without occupancy; the dispatch guard's three environment failures and the registration regression each have cases; three compact-dock containment cases (missing overflow, missing shrink basis, or a squashed guard chip each turn red).
- Live acceptance: both defects were found from **real-machine evidence** — the guard regression was caught on a restarted host; the window defect came from an external report (256K rule target, a session grown to ~330K tokens, the whole turn failing with `400 INVALID_REQUEST` and an empty message). **Stated honestly, still unverified**: the window downgrade has not yet been eyeballed on a real machine (it needs a long session plus a rule target smaller than that session); this release covers that path with unit and integration tests.
