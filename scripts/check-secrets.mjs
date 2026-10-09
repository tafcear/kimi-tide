#!/usr/bin/env node
// 密钥门禁：cordis*.yml 全仓严格扫 ＋ 发布面高置信扫。
//
// 为什么不扫全仓：本仓存在大量**讨论密钥前缀的合法文本**——
//   src/client/preset-name.ts 的前缀表与注释、test/preset-name.test.ts 的假值夹具、
//   CHANGELOG 与 release notes 的说明、docs/audit/** 里含 `sk-` 的路径串。
// 判据**宁可窄也不能天天误报**——误报的门禁会被关掉。
//
// 范围 A（严格，四条规则全开）：全仓 cordis*.yml / cordis*.yaml
//   （排除 node_modules/、.git/、.worktrees/、_probe*、tools/asar-probe/out/）。
//   这层文件会随插件包 tarball 分发或被贴进 issue，是「把真实密钥写进配置」的第一落点。
//   1) 赋值型密钥字段：行形如 <字段>: 或 <字段>= 且右侧非空；字段名（去空白、大小写
//      不敏感）恰好等于 FIELD_NAMES 之一才算。右侧为空 / ~ / null / ${…} 占位一律放行；
//      apiKeyEnv / keywords / maxTokens / tokenPlan / tokens 这类带后缀或近形字段
//      由「精确相等」保证不命中。
//   2) 密钥字面量：前缀（sk- / sk_ / ghp_ / gho_ / ghs_ / github_pat_ / xoxb- / xoxp- /
//      xoxa- / xoxr- / xoxs- / AKIA / ASIA）前不得有字母数字（防 Syncdisk- 这类误命中），
//      前缀后须跟 ≥20 位 [A-Za-z0-9_-]。
//   3) PEM 私钥块：-----BEGIN [A-Z ]*PRIVATE KEY-----。
//   4) JWT：eyJ 开头三段点分，各段 ≥10 位。
// 范围 B（发布面，只查高置信形态＝上面第 2/3/4 条，不查字段名规则）：
//   packages/dsh-kimi-tide/src/**、packages/dsh-kimi-tide/locale/**、
//   packages/dsh-kimi-tide/cordis.patch.yml、packages/dsh-kimi-tide/package.json、
//   根 package.json（源码里的密钥会随 lib/ 进 tarball）。
//
// 输出只打印掩码（前 4 字符 ＋ 总长），绝不打印完整值。
// 用法：node scripts/check-secrets.mjs（无参数）
// 退出码：0 干净 / 1 命中 / 2 参数或读取错误。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 参数纪律：未知参数必须 exit 2（参数写错却报绿是最坏的一种失败）──────────────
const argv = process.argv.slice(2);
if (argv.length) {
  console.error(`[check-secrets] 未知参数：${argv.join(' ')}；本脚本无参数。`);
  console.error('用法：node scripts/check-secrets.mjs');
  process.exit(2);
}

// ── 判据 ─────────────────────────────────────────────────────────────────────
/** 规则 1：赋值型密钥字段名（全部转小写后精确相等；带后缀形态天然不命中）。 */
const FIELD_NAMES = new Set([
  'apikey', 'api_key', 'key', 'secret', 'clientsecret', 'client_secret',
  'token', 'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
  'password', 'passwd', 'credential', 'credentials',
  'accesskey', 'access_key', 'secretkey', 'secret_key',
]);
/** 规则 2：密钥字面量（前缀词边界 ＋ ≥20 位载荷；AKIA/ASIA 区分大小写）。 */
const LITERAL_RE =
  /(?<![A-Za-z0-9])(?:sk-|sk_|ghp_|gho_|ghs_|github_pat_|xoxb-|xoxp-|xoxa-|xoxr-|xoxs-|AKIA|ASIA)[A-Za-z0-9_-]{20,}/g;
/** 规则 3：PEM 私钥块。 */
const PEM_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
/** 规则 4：JWT（三段各 ≥10 位）。 */
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

/** 掩码：只给前 4 字符与总长，绝不给完整值。 */
const mask = (value) =>
  `${value.slice(0, 4)}…（屏蔽 ${value.length} 字符）`;

// ── 文件收集 ─────────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.git', '.worktrees']);
const relOf = (file) => relative(root, file).replace(/\\/g, '/');

function walk(dir, out, accept) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_probe')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (relOf(full) === 'tools/asar-probe/out') continue;
      walk(full, out, accept);
    } else if (accept(entry.name)) {
      out.push(full);
    }
  }
}

// 范围 A：全仓 cordis*.yml / cordis*.yaml（排除项见 walk）
const cordisFiles = [];
walk(root, cordisFiles, (name) => /^cordis.*\.ya?ml$/.test(name));

// 范围 B：发布面（src/** 与 locale/** 递归 ＋ 三份显式文件）
const publishFiles = [];
for (const dir of ['packages/dsh-kimi-tide/src', 'packages/dsh-kimi-tide/locale']) {
  walk(join(root, dir), publishFiles, () => true);
}
for (const rel of [
  'packages/dsh-kimi-tide/cordis.patch.yml',
  'packages/dsh-kimi-tide/package.json',
  'package.json',
]) {
  publishFiles.push(join(root, rel));
}

// ── 扫描 ─────────────────────────────────────────────────────────────────────
const findings = [];
let readError = false;

function scan(file, strict) {
  const rel = relOf(file);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`[check-secrets] 读取失败：${rel}（${err.message}）`);
    readError = true;
    return;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    // 规则 1：赋值型密钥字段（仅范围 A）
    if (strict) {
      const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*[:=]\s*(.*)$/);
      if (m) {
        const field = m[1].toLowerCase();
        let value = m[2].trim();
        const quoted = value.match(/^(['"])([\s\S]*)\1$/);
        if (quoted) value = quoted[2].trim();
        const allowed =
          value === '' ||
          value === '~' ||
          value.toLowerCase() === 'null' ||
          /^\$\{[\s\S]*\}$/.test(value);
        if (FIELD_NAMES.has(field) && !allowed) {
          findings.push({ rel, line: lineNo, kind: '赋值型密钥字段', masked: mask(value) });
        }
      }
    }
    // 规则 2/3/4：高置信形态（范围 A 与范围 B 都查）
    for (const lm of line.matchAll(LITERAL_RE)) {
      findings.push({ rel, line: lineNo, kind: '密钥字面量', masked: mask(lm[0]) });
    }
    if (PEM_RE.test(line)) {
      const hit = line.match(PEM_RE)[0];
      findings.push({ rel, line: lineNo, kind: 'PEM 私钥块', masked: mask(hit) });
    }
    for (const jm of line.matchAll(JWT_RE)) {
      findings.push({ rel, line: lineNo, kind: 'JWT', masked: mask(jm[0]) });
    }
  });
}

for (const file of cordisFiles) scan(file, true);
for (const file of publishFiles) scan(file, false);

if (readError) process.exit(2);

if (findings.length) {
  console.error(`[check-secrets] FAIL — ${findings.length} 处疑似密钥（只显示掩码，绝不显示完整值）`);
  for (const f of findings) {
    console.error(`  ${f.rel}:${f.line}  [${f.kind}] ${f.masked}`);
  }
  process.exit(1);
}

console.log(
  `[check-secrets] OK — 范围 A cordis*.yml 共 ${cordisFiles.length} 个（四条规则全开）` +
    `＋ 范围 B 发布面 ${publishFiles.length} 个（字面量/PEM/JWT），0 命中`,
);
