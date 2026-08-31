#!/usr/bin/env node
// 三处版本一致性校验：CHANGELOG 最新版本 == 包版本 == README 当前版本行
// 用法：node scripts/check-changelog.mjs（CI 与发版前手工均可）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const changelog = read('CHANGELOG.md');
const pkg = JSON.parse(read('packages/dsh-kimi-tide/package.json'));
const readme = read('README.md');

// CHANGELOG 倒序，第一个版本标题即最新；README「版本与路线」首行「当前版本：**v1.0.0（…）**」
const head = changelog.match(/^##\s+v([\w.\-+]+)/m);
const cur = readme.match(/当前版本：\*\*(v[\w.\-+]+)/);

const problems = [];
if (!head) problems.push('CHANGELOG.md 未找到版本标题（## vX.Y.Z 形态）');
if (!cur) problems.push('README.md 未找到「当前版本：**v…」行');
if (head && cur && 'v' + head[1] !== cur[1])
  problems.push(`CHANGELOG 最新 v${head[1]} != README ${cur[1]}`);
if (head && 'v' + head[1] !== 'v' + pkg.version)
  problems.push(`CHANGELOG 最新 v${head[1]} != package.json v${pkg.version}`);
if (cur && cur[1] !== 'v' + pkg.version)
  problems.push(`README ${cur[1]} != package.json v${pkg.version}`);

if (problems.length) {
  console.error('[check-changelog] FAIL\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log(`[check-changelog] OK — CHANGELOG / README / package.json 均为 v${pkg.version}`);
