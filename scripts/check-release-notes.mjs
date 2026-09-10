#!/usr/bin/env node
// Release 页面门禁：双语 × 四段式。Release 正文 = 附注 tag 消息（见
// .github/workflows/release.yml），因此这里校验的就是那段消息。
// 规则与模板见 docs/agents/release-notes.md。
//
// 结构（顺序固定）：
//   dsh-kimi-tide vX.Y.Z —— <中文主题> · <English theme>
//   ## 简体中文     ### 本次更新 / ### 安装与升级 / ### 验证与验收
//   ## English      ### What's new / ### Install & upgrade / ### Verification & acceptance
//
// 用法：
//   node scripts/check-release-notes.mjs --file release-notes.md   # 草稿文件
//   node scripts/check-release-notes.mjs --tag v1.2.0              # 已存在的附注 tag
//   node scripts/check-release-notes.mjs --stdin < notes.md
//   可选：--version 1.2.0 覆盖期望版本号（默认取包版本；--tag 模式下取自 tag 名）
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const value = (flag) => {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const next = argv[index + 1];
  return next === undefined || next.startsWith('--') ? '' : next;
};

const pkg = JSON.parse(readFileSync(join(root, 'packages', 'dsh-kimi-tide', 'package.json'), 'utf8'));
const tag = value('--tag');
const file = value('--file');
const useStdin = argv.includes('--stdin');

// 双语 × 四段：语言块顺序固定，每块内的三段标题固定
const LANGUAGES = [
  { heading: '简体中文', label: '中文', sections: ['本次更新', '安装与升级', '验证与验收'] },
  { heading: 'English', label: '英文', sections: ["What's new", 'Install & upgrade', 'Verification & acceptance'] },
];
const CONTENT_RULE = {
  0: {
    check: (body) => (/^\s*[-*]\s+\S/m.test(body) ? null : '至少要有一条 `- ` 列表项（用户视角说清楚新增/修复/变更/兼容）'),
  },
  1: {
    check: (body) => {
      const fences = body.match(/```[\s\S]*?```/g) ?? [];
      if (fences.length === 0) return '要有围栏代码块（```bash … ```）';
      if (!fences.some((fence) => fence.includes('dsh plugin'))) return '命令块里要给出 `dsh plugin --profile web add …` 安装命令';
      return null;
    },
  },
  2: {
    check: (body) => {
      const text = body.replace(/^#{3,6}.*$/gm, '').trim();
      if (text === '') return '不能为空（写测试数、typecheck/build、实机验收记录）';
      if (!/(\d+\s*\/\s*\d+)|测试|验收|typecheck|test|acceptance/i.test(text))
        return '要给出可核对的证据（如「NNN/NNN 测试 + typecheck 0 + build」或实机验收记录链接）';
      return null;
    },
  },
};

// ── 输入与期望版本 ──────────────────────────────────────────────────────────
let text;
let expected = value('--version') || pkg.version;
if (tag !== undefined) {
  if (tag === '') usage('--tag 需要一个 tag 名');
  try {
    text = execFileSync('git', ['tag', '-l', tag, '--format=%(contents)'], { cwd: root, encoding: 'utf8' });
  } catch (error) {
    console.error(`[check-release-notes] FAIL — 读取 tag ${tag} 失败：${error.message}`);
    process.exit(1);
  }
  if (text.trim() === '') {
    console.error(`[check-release-notes] FAIL — tag ${tag} 不存在，或不是附注 tag（Lightweight tag 没有正文；发版约定 = git tag -a）`);
    process.exit(1);
  }
  const fromTag = tag.replace(/^v/, '');
  if (value('--version') === undefined) expected = fromTag;
  if (fromTag !== pkg.version) {
    console.error(`[check-release-notes] FAIL — tag v${fromTag} 与 package.json v${pkg.version} 不一致（发版前先对齐版本号）`);
    process.exit(1);
  }
} else if (file !== undefined) {
  if (file === '') usage('--file 需要一个路径');
  // 相对路径按仓库根解析（文档与 CI 都以仓库根为基准），绝对路径原样使用
  text = readFileSync(isAbsolute(file) ? file : resolve(root, file), 'utf8');
} else if (useStdin) {
  text = readFileSync(0, 'utf8');
} else {
  usage('需要 --file <路径>、--tag <tag> 或 --stdin 之一');
}

// ── 校验 ────────────────────────────────────────────────────────────────────
const problem = [];
const lines = text.replace(/\r\n/g, '\n').split('\n');
const firstContent = lines.findIndex((line) => line.trim() !== '');
if (firstContent === -1) {
  console.error('[check-release-notes] FAIL — 正文为空');
  process.exit(1);
}

// 第一段：标题行 = dsh-kimi-tide vX.Y.Z —— <中文主题> · <English theme>
const titleLine = lines[firstContent].trim();
const title = titleLine.match(/^dsh-kimi-tide\s+v([\w.\-+]+)\s*(?:——|--)\s*(.+)$/);
if (!title) {
  problem.push(`第一段缺标题行：首行须形如「dsh-kimi-tide v${expected} —— <中文主题> · <English theme>」，当前首行 =「${titleLine.slice(0, 60)}」`);
} else {
  if (title[1] !== expected) problem.push(`标题行版本 v${title[1]} != 期望 v${expected}`);
  const theme = title[2];
  const halves = theme.split(/\s*[·|｜]\s*|\s+\/\s+/).filter((part) => part.trim() !== '');
  if (halves.length < 2) problem.push('标题行主题要中英双语，用「·」分隔，例如「—— 会话事件退场 · Session events step aside」');
  else if (halves.some((part) => part.replace(/[\s*_`]/g, '').length < 2)) problem.push('标题行的中文主题与英文主题都不能为空');
}

// 语言块：恰好两个二级标题，顺序固定
const languageHeadings = [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => ({ title: match[1].trim(), index: match.index }));
const wanted = LANGUAGES.map((language) => language.heading);
if (languageHeadings.map((heading) => heading.title).join(' | ') !== wanted.join(' | ')) {
  problem.push(
    `双语结构要求二级标题恰好是「## ${wanted.join('」「## ')}」且按序排列（中文在上、English 在下）；当前二级标题 =「${languageHeadings.map((heading) => heading.title).join('」「') || '(无)'}」`,
  );
}

const bulletCounts = {};
for (let index = 0; index < LANGUAGES.length; index += 1) {
  const language = LANGUAGES[index];
  const at = languageHeadings.findIndex((heading) => heading.title === language.heading);
  if (at === -1) continue;
  const blockStart = languageHeadings[at].index;
  const blockEnd = at + 1 < languageHeadings.length ? languageHeadings[at + 1].index : text.length;
  const block = text.slice(blockStart, blockEnd);

  const sectionHeadings = [...block.matchAll(/^###\s+(.+?)\s*$/gm)].map((match) => ({ title: match[1].trim(), index: match.index }));
  if (sectionHeadings.map((heading) => heading.title).join(' | ') !== language.sections.join(' | ')) {
    problem.push(
      `${language.heading} 块内的三段必须是且仅是「### ${language.sections.join('」「### ')}」且按序排列；当前 =「${sectionHeadings.map((heading) => heading.title).join('」「') || '(无)'}」`,
    );
    continue;
  }
  for (let seat = 0; seat < language.sections.length; seat += 1) {
    const start = sectionHeadings[seat].index;
    const end = seat + 1 < sectionHeadings.length ? sectionHeadings[seat + 1].index : block.length;
    const body = block.slice(start, end);
    const failure = CONTENT_RULE[seat].check(body);
    if (failure) problem.push(`${language.heading} ·「${language.sections[seat]}」${failure}`);
    if (seat === 0) bulletCounts[language.label] = (body.match(/^\s*[-*]\s+\S/gm) ?? []).length;
  }
}

// 模板占位符必须全部替换掉
const leftover = text.match(/<(一句话[^>]*|主题|要点|清单|日期|版本|链接|theme|theme-en)>/g);
if (leftover) problem.push(`仍有未替换的模板占位符：${[...new Set(leftover)].join(', ')}`);

if (problem.length) {
  console.error('[check-release-notes] FAIL\n' + problem.map((entry) => ' - ' + entry).join('\n'));
  console.error('\n模板与要求（双语 × 四段）：docs/agents/release-notes.md');
  process.exit(1);
}
console.log(
  `[check-release-notes] OK — v${expected} 双语四段齐备（中文 ${bulletCounts['中文']} 条 / English ${bulletCounts['英文']} 条；两侧安装命令与验收证据在位）`,
);

function usage(message) {
  console.error(`[check-release-notes] ${message}`);
  console.error(`用法：
  node scripts/check-release-notes.mjs --file release-notes.md
  node scripts/check-release-notes.mjs --tag v1.2.0
  node scripts/check-release-notes.mjs --stdin < notes.md
可选：--version 1.2.0 覆盖期望版本号。模板见 docs/agents/release-notes.md`);
  process.exit(1);
}
