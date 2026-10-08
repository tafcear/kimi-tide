dsh-kimi-tide v2.1.2 —— 修掉决策面板「一滚动就消失」 · Fix: the decision panel closed itself while scrolling

**简体中文** ｜ [English ↓](#english)

## 简体中文

### 本次更新

- **修复 · 面板自己的滚动不再被当成「页面在滚」**：dock 的决策可观测面板与用量总览是 portal 悬浮层，面板自带 `max-height: min(320px, 60vh); overflow: auto`——**它自己就是滚动容器**；而关闭监听是捕获相位的 `window.addEventListener('scroll', close, true)`，会把面板自身发出的滚动一并当成「面板外滚动」而立刻收起。用户看到的就是**滚动条拖不动**（一拖面板消失）、**点一下滚动条面板就没了**。现在两个悬浮层共用一处判据：事件源落在面板（或其触发按钮）内就不关闭；页面／聊天区滚动仍照旧收起（面板是 fixed 定位，页面一滚就会漂——原设计意图保留）。
- **顺带 · 滚到边界不再漏给页面**：面板加 `overscroll-behavior: contain`，「已滚到底还继续滚」的滚轮动作被拦在面板内，不会再去滚页面、反过来把面板关掉。
- **判据来自真机实测，不是推断**：Chromium 实测确认——滚轮与拖滚动条都会在滚动容器上发出 `scroll`（不冒泡，只有捕获相位收得到），且**滚动条上的按下事件目标就是滚动容器本身**。因此判据只需「事件源是否落在面板内」，**没有**引入按坐标兜底的分支。
- **兼容性**：只影响上述两个悬浮层的行为；配置、路由、命令、设置页一律未改。**无需迁移、无需改配置。**

### 安装与升级

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.1.2.tgz
# 或从 Release 资产安装同名 tgz；装完重启 dsh web / 桌面端生效
```

兼容：DSH ≥ `0.1.7-rc.1`（本版与 v2.1.0／v2.1.1 实机验证于 `0.2.0-rc.2` 桌面端）。桌面端以 link 方式安装的用户：更新代码后重跑 `npm run build`（产物先于重启）。

### 验证与验收

- 测试：**1089/1089 通过**（60 个测试文件，比 v2.1.1 多 3 条）；`typecheck` 0 报错；仓库门禁 `npm run check` **五闸全绿**（changelog / doc-links / readme-sync / terminology / client-i18n）；Release 正文双语四段门禁本地通过。
- **负控有牙**：把两处关闭判据还原成旧写法 ⇒ 2 条新用例变红；去掉 scroll 监听的捕获相位 ⇒ 「面板外元素滚动仍关闭」变红。两轮都只改生产代码、未动任何期望值。
- **真机依据**：修复前用 Chromium 复现——拖动面板滚动条会在容器上产生 `scroll`（`target`＝容器、不冒泡）并命中 `window` 的捕获监听，正是旧代码的关闭点。

---

## English

### What's new

- **Fix — the panel's own scroll is no longer mistaken for "the page scrolling"**: the dock's decision panel and quota overview are portal overlays carrying `max-height: min(320px, 60vh); overflow: auto` — **the panel itself is the scroll container** — while the dismiss listener was a capture-phase `window.addEventListener('scroll', close, true)`, so the panel's own scroll events were read as "scrolled outside" and closed it instantly. What users saw: **the scrollbar would not drag** (one drag and the panel vanished) and **a single click on the scrollbar made it disappear**. Both overlays now share one predicate — when the event source lies inside the panel (or its trigger button) it does not close; page/chat scrolling still closes as before (the panel is fixed-positioned and would drift, which was the original intent).
- **Also — the wheel no longer leaks to the page**: the panel now sets `overscroll-behavior: contain`, so scrolling past the end of the list is absorbed instead of scrolling the page and thereby closing the panel.
- **The predicate comes from a real browser, not a guess**: measured in Chromium — the wheel and scrollbar drags both emit `scroll` on the scroll container (non-bubbling, reachable only in the capture phase), and **the mousedown on a scrollbar targets the scrolling container itself**. So "is the event source inside the panel" is sufficient; no coordinate-based fallback was added.
- **Compatibility**: only those two overlays change behaviour; config, routing, commands and the settings page are untouched. **No migration, no config edits.**

### Install & upgrade

```bash
dsh plugin --profile web add ./dsh-kimi-tide-2.1.2.tgz
# or install the same tgz from the Release assets; restart dsh web / the desktop app afterwards
```

Compatibility: DSH ≥ `0.1.7-rc.1` (this release, like v2.1.0/v2.1.1, was verified live on the `0.2.0-rc.2` desktop app). Desktop users installed via `link:`: re-run `npm run build` after updating the code (build before restart).

### Verification & acceptance

- Tests: **1089/1089 passing** (60 test files, three more than v2.1.1); `typecheck` 0 errors; repo gate `npm run check` **all five gates green** (changelog / doc-links / readme-sync / terminology / client-i18n); the bilingual four-section release-note gate passes locally.
- **Negative controls with teeth**: restoring the old dismissal predicate turns 2 new cases red; dropping the capture flag from the scroll listener turns "an outside element scroll still closes" red. Both rounds changed production code only, never the expectations.
- **Real-browser evidence**: before the fix, Chromium reproduced the failure — dragging the panel's scrollbar emits `scroll` on the container (`target` = the container, non-bubbling) which reaches the `window` capture listener, i.e. exactly where the old code closed the panel.
