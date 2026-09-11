dsh-kimi-tide v1.2.1 —— 设置页模型下拉修复：目录通道跟上宿主升级 · Settings model dropdown fixed: catalog channel catches up with the host

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- 修复「设置页模型下拉里没有 DeepSeek」：DSH 0.1.5-rc.1 起宿主移除了插件原先使用的模型目录接口，取数失败被静默降级成「只列配置里出现过的模型」——DeepSeek 通常只出现在辅助请求目标里，于是整组从下拉消失。目录改走宿主官方模型目录接口（与模型选择器同一条），旧接口保留作回退，升级宿主不再丢模型
- 下拉名称与官方「模型」设置页一致：按提供方分组（DeepSeek / Kimi / Z.ai 等官方显示名），选项显示模型友好名（如 DeepSeek-V41-Flash 而不是 `deepseek-official/deepseek-flash`）；鼠标悬停可见完整 `provider/model` 键
- 目录里没收录、但配置在用的目标照旧回显原键并保留可选，不会误标「未挂载」
- 写入与配置格式零变化：`settings.yaml` 无需改动，选择结果仍按 `provider/model` 记录，路由行为与 1.2.0 逐字一致

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-1.2.1.tgz
# 或从本 Release 资产安装同名 tgz；装完重启 dsh web 生效（web profile 的 HMR 被官方禁用）
```

兼容：DSH ≥ 0.1.2-rc.1（0.1.5-rc.1 实测）；路由配置格式未变，`settings.yaml` 无需改动，历史会话数据零迁移。

### 验证与验收

- 测试：590/590 通过（新增 6 条回归用例：目录通道换道 4 条 + 显示名渲染 2 条，均先红后绿）；typecheck 0；build 通过；CHANGELOG / README 双语门禁过
- 实机验收：在运行中的 0.1.5-rc.1 宿主上复验设置页「月汐」卡片——模型下拉恢复 DeepSeek 全组（deepseek-flash / v4-flash / v4-pro / vision-exp）并按提供方分组显示官方友好名（2026-09-11，用户目检）

---

## English

### What's new

- Fixed "the settings model dropdown has no DeepSeek": DSH 0.1.5-rc.1 removed the catalog endpoint the plugin used, and the failed fetch degraded silently to "list only models already referenced by config" — DeepSeek typically appears only as an auxiliary-request target, so the whole group vanished. The catalog now goes through the host's official model-directory endpoint (the same one the model picker uses), with the old endpoint kept as fallback, so a host upgrade can no longer drop models
- Dropdown names now match the official Models settings page: grouped by provider (DeepSeek / Kimi / Z.ai display names), options show the friendly model name (e.g. DeepSeek-V41-Flash instead of `deepseek-official/deepseek-flash`), and hovering reveals the full `provider/model` key
- Targets that are referenced in config but absent from the catalog still render their raw key and stay selectable — never mislabelled as "not mounted"
- No change to writes or config format: `settings.yaml` needs no edits, selections are still recorded as `provider/model`, and routing behaviour is byte-for-byte the same as 1.2.0

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-1.2.1.tgz
# or install the same tgz from this Release's assets; restart dsh web afterwards (HMR is disabled for the web profile)
```

Compatibility: DSH ≥ 0.1.2-rc.1 (verified on 0.1.5-rc.1); the routing config format is unchanged, `settings.yaml` needs no edits, and legacy session data migrates nowhere.

### Verification & acceptance

- Tests: 590/590 passing (6 new regression cases: 4 for the catalog channel migration, 2 for display-name rendering — each written red first); typecheck clean; build passing; CHANGELOG / README bilingual gates green
- Live acceptance: re-checked on a running 0.1.5-rc.1 host — the 月汐 settings card's model dropdown shows the full DeepSeek group again (deepseek-flash / v4-flash / v4-pro / vision-exp) with official friendly names grouped by provider (2026-09-11, user-verified on screen)
