#!/usr/bin/env node
// 仓库文档相对链接检查（发布门禁「文档链接全绿」的机器化）
// 覆盖 [text](target) 与 ![](src)；http(s)/mailto/#锚点/obsidian: 跳过；不支持 ](<..>) 尖括号形态（本仓库未使用）
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git']);
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(join(dir, e.name));
    } else if (e.name.endsWith('.md')) {
      files.push(join(dir, e.name));
    }
  }
})(root);

let broken = 0;
for (const f of files) {
  let text = readFileSync(f, 'utf8');
  // 围栏代码块与行内代码不是渲染态链接（文档/脚本示例常含 ]( 形态字面量），跳过
  text = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#|obsidian:)/.test(target)) continue;
    const path = target.split('#')[0];
    if (!path) continue; // 纯页内锚点
    if (!existsSync(resolve(dirname(f), path))) {
      console.error(`断链: ${f} -> ${target}`);
      broken++;
    }
  }
}
if (broken) {
  console.error(`[check-doc-links] FAIL — ${broken} 处断链（${files.length} 个 md 已扫）`);
  process.exit(1);
}
console.log(`[check-doc-links] OK — ${files.length} 个 md 文件 0 断链`);
