#!/usr/bin/env node
// README 双语对门禁：README.md（中文主文档）与 README.en.md（英文）是同文两语，
// 用户可见的改动必须成对落地。规则见 docs/agents/readme-pair.md。
// 机器可判的四项：版本行一致 / 章节骨架一致 / 徽章一致 / 本地文档链接集合一致。
// 用法：node scripts/check-readme-sync.mjs（CI 与本地均可）
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problem = [];

// ── 读入两份文档 ────────────────────────────────────────────────────────────
const pair = [
  { file: 'README.md', label: '中文', version: /当前版本：\*\*v([\w.\-+]+)[（(]\s*([^）)]+?)\s*[）)]\*\*/ },
  { file: 'README.en.md', label: '英文', version: /Current version:\s*\*\*v([\w.\-+]+)\s*[（(]\s*([^）)]+?)\s*[）)]\*\*/ },
];
for (const side of pair) {
  const path = join(root, side.file);
  if (!existsSync(path)) {
    problem.push(`${side.file} 不存在——双语对必须两份都在`);
    continue;
  }
  side.text = readFileSync(path, 'utf8');
}
if (problem.length) fail();

// ── 1. 版本行：版本号与日期都必须相同（分隔符/全半角括号不算差异）────────────
for (const side of pair) {
  const match = side.text.match(side.version);
  if (!match) {
    problem.push(`${side.file} 未找到版本行（中文应形如「当前版本：**v1.1.0（2026-09-04）**」，英文应形如「Current version: **v1.1.0 (2026-09-04)**」）`);
    continue;
  }
  side.version = match[1];
  side.date = match[2].replace(/\s+/g, ' ');
}
if (pair[0].version && pair[1].version) {
  if (pair[0].version !== pair[1].version)
    problem.push(`版本号不一致：README.md v${pair[0].version} != README.en.md v${pair[1].version}`);
  if (pair[0].date !== pair[1].date)
    problem.push(`版本日期不一致：README.md「${pair[0].date}」!= README.en.md「${pair[1].date}」`);
}

// ── 2. 章节骨架：## / ### 的层级序列必须一一对应（标题文字按语言不同）────────
const skeleton = (text) => [...text.matchAll(/^(#{2,3})\s+\S/gm)].map((m) => m[1].length);
const zhSkeleton = skeleton(pair[0].text ?? '');
const enSkeleton = skeleton(pair[1].text ?? '');
if (zhSkeleton.join(',') !== enSkeleton.join(',')) {
  const divergent = Math.max(zhSkeleton.length, enSkeleton.length);
  let at = 0;
  while (at < divergent && zhSkeleton[at] === enSkeleton[at]) at += 1;
  problem.push(
    `章节骨架不一致（第 ${at + 1} 个 ## / ### 起分叉）：README.md 共 ${zhSkeleton.length} 节、README.en.md 共 ${enSkeleton.length} 节——新增/删除章节必须两份同步`,
  );
}

// ── 3. 徽章：远程图片（shields.io / actions badge）集合必须一致 ───────────────
const remoteImages = (text) =>
  [...text.matchAll(/<img\s+src="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).sort().join('\n');
if (remoteImages(pair[0].text ?? '') !== remoteImages(pair[1].text ?? ''))
  problem.push('顶部徽章不一致：两份 README 的远程 <img src> 集合必须相同（语言资产如 hero.gif 不受此限）');

// ── 4. 本地文档链接：两侧引用的仓库内文件集合必须一致 ────────────────────────
const localLinks = (text) =>
  [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1])
    .filter((target) => !/^(https?:|mailto:|#|obsidian:)/.test(target))
    .sort()
    .join('\n');
const zhLinks = localLinks(pair[0].text ?? '');
const enLinks = localLinks(pair[1].text ?? '');
if (zhLinks !== enLinks) {
  const zhSet = new Set(zhLinks.split('\n').filter(Boolean));
  const enSet = new Set(enLinks.split('\n').filter(Boolean));
  const onlyZh = [...zhSet].filter((target) => !enSet.has(target));
  const onlyEn = [...enSet].filter((target) => !zhSet.has(target));
  if (onlyZh.length) problem.push(`README.md 引用了英文版没有的本地文件：${onlyZh.join(', ')}`);
  if (onlyEn.length) problem.push(`README.en.md 引用了中文版没有的本地文件：${onlyEn.join(', ')}`);
}

if (problem.length) fail();
console.log(
  `[check-readme-sync] OK — 版本行 v${pair[0].version}（${pair[0].date}）、章节骨架 ${zhSkeleton.length} 节、徽章与本地链接集合两侧一致`,
);

function fail() {
  console.error('[check-readme-sync] FAIL\n' + problem.map((entry) => ' - ' + entry).join('\n'));
  console.error('\n规则与判定口径：docs/agents/readme-pair.md');
  process.exit(1);
}
