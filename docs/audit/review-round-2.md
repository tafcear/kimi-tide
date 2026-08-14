# 审查档案 · 第二轮（复检）

> 审查者：Kimi（kimi-for-coding，via dsh-kimi-bridge `call_kimi`）
> 会话：kimi-50834229（2026-08-15）
> 范围：修复后的全部改动文件（scripts/ 4 个 + review-home.ts + kimi-manager.ts + 新测试）
> 结论：23 项全部确认修复；新发现 5 项，均随后修复。
> 完整原文见会话记录；本文件为新发现问题清单归档。

## 23 项复核结果

全部 ✅ 已修复（逐项对照见第一轮档案"修复后状态"列）。

## 新发现 5 项（已全部修复）

| # | 位置 | 问题 | 严重度 | 修复 |
|---|------|------|--------|------|
| R2-1 | review-home.ts syncAuthFile | copyFileSync 不保留 mtime → 每次 build 都重复制（幂等语义失效） | 轻微 | ✅ copy 后 utimesSync 恢复源 mtime |
| R2-2 | README.md 第 115 行 | 过期的硬编码路径警告（脚本已可移植） | 轻微 | ✅ 改为"无需修改"说明 |
| R2-3 | README.md 第 255-257 行 | "脚本硬编码路径"限制条目已失效 | 轻微 | ✅ 改为"路径已可移植" |
| R2-4 | README.md 第 174 行 | tarball 文件名仍写 0.1.0（实为 0.1.1） | 轻微 | ✅ 更新为 0.1.1 |
| R2-5 | vendor package-lock.json | lockfile 版本号未随 0.1.1 同步 | 轻微 | ✅ npm install 刷新 |

## 测试抓到的隐藏 bug（审查双方均未提前发现）

- 位置：review-home.ts syncAuthFile
- 现象：文件副本需要刷新时，symlinkSync 抛 EEXIST 直接 return → copy 刷新永不执行
- 发现方式：新增的 review-home-win.test.ts「buildReviewHome refresh flow」用例断言"源变化后副本必须刷新"失败
- 修复：已存在普通副本时直接覆盖复制（跨平台），EEXIST 仅保留为"竞态幂等"分支

## 最终评价（复检原文节选）

> "核心安全问题已全部关闭……修复可接受，建议合并前处理 README/package-lock 版本号，
> 并手动跑一次 test/review-home-win.test.ts 确认绿通；处理后可视为达到可用成熟度。"
