#!/usr/bin/env node
// 四处版本面一致性校验：CHANGELOG 最新版本 == 包版本 == 根 README 当前版本行 == 包 README 首屏状态行
//
// 为什么带上包 README：它随 npm 包一起发布（`npm pack` 把仓库里这份文件打进 tarball，
// npm 包页显示的就是它），而双语对门禁只管根 README.md / README.en.md——包 README 的
// 版本面此前没有任何门禁：v2.1.2 / v2.1.3 两轮发版只升了状态行、正文停在 v2.1.1 的内容面。
// 日期也一并判（状态行日期 != CHANGELOG 标题日期 = 发版日写错），取不到日期时只判版本号。
//
// 用法：node scripts/check-changelog.mjs（CI 与发版前手工均可）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const changelog = read('CHANGELOG.md');
const pkg = JSON.parse(read('packages/dsh-kimi-tide/package.json'));
const readme = read('README.md');
const pkgReadme = read('packages/dsh-kimi-tide/README.md');

// CHANGELOG 倒序，第一个版本标题即最新；README「版本与路线」首行「当前版本：**v1.0.0（…）**」；
// 包 README 首屏状态行「> **当前状态**：v1.0.0（2026-09-04，…）」。
const head = changelog.match(/^##\s+v([\w.\-+]+)/m);
const headDate = changelog.match(/^##\s+v[\w.\-+]+\s*[（(]\s*(\d{4}-\d{2}-\d{2})\s*[）)]/m);
const cur = readme.match(/当前版本：\*\*(v[\w.\-+]+)/);
const pkgCur = pkgReadme.match(/当前状态\*\*：v([\w.\-+]+)/);
const pkgCurDate = pkgReadme.match(/当前状态\*\*：v[\w.\-+]+\s*[（(]\s*(\d{4}-\d{2}-\d{2})/);

const problems = [];
if (!head) problems.push('CHANGELOG.md 未找到版本标题（## vX.Y.Z 形态）');
if (!cur) problems.push('README.md 未找到「当前版本：**v…」行');
if (!pkgCur)
  problems.push(
    'packages/dsh-kimi-tide/README.md 未找到首屏状态行（应形如「> **当前状态**：vX.Y.Z（YYYY-MM-DD，…）」）',
  );
if (head && cur && 'v' + head[1] !== cur[1])
  problems.push(`CHANGELOG 最新 v${head[1]} != README ${cur[1]}`);
if (head && 'v' + head[1] !== 'v' + pkg.version)
  problems.push(`CHANGELOG 最新 v${head[1]} != package.json v${pkg.version}`);
if (cur && cur[1] !== 'v' + pkg.version)
  problems.push(`README ${cur[1]} != package.json v${pkg.version}`);
if (pkgCur && pkgCur[1] !== pkg.version)
  problems.push(
    `包 README 状态行 v${pkgCur[1]} != package.json v${pkg.version}（包 README 随 npm 包发布，发版时必须与状态行一起升）`,
  );
if (headDate && pkgCurDate && headDate[1] !== pkgCurDate[1])
  problems.push(`包 README 状态行日期 ${pkgCurDate[1]} != CHANGELOG v${head[1]} 日期 ${headDate[1]}`);

if (problems.length) {
  console.error('[check-changelog] FAIL\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log(
  `[check-changelog] OK — CHANGELOG / README / 包 README / package.json 均为 v${pkg.version}`,
);
