/**
 * 评审结论解析（v1.4.0 评审闭环 spec §3.3）：**纯函数**，无 ctx、无 IO。
 *
 * 为什么是纯函数：结论判据决定「要不要退回重做」——一个误判会多花一轮
 * （评审 + 主模型各一次调用），所以在把自然语言结论接进编排之前，先把判据
 * 做成可穷举单测的纯函数面（spec §5 验收判据 1）。
 *
 * 口径（spec §3.3 保守优先）：
 * - 只看**最后一条非空行**——评审指令要求「最后一行结论」，正文里出现的
 *   「不通过」不算（判据 1「结论出现在正文而非末行」= 不触发）；
 * - 只认下面词表里的词，**解析不出＝unknown＝不触发**（不猜）；
 * - 「有条件通过」也触发（用户 2026-10-02 裁定 ①）。
 *
 * 词表优先级是刻意的：CJK 里「不通过」/「未通过」都以「通过」结尾，先判
 * 「通过」会把全部否定判成通过，所以顺序恒为 conditional → fail → pass。
 */
import { copyNow } from './copy.js'
import { zh as zhCopy } from './locales/index.js'

export type ReviewVerdict = 'pass' | 'conditional' | 'fail' | 'unknown'

/** 触发回退的结论（spec §3.3 + 用户裁定 ①）。 */
export function isRevisableVerdict(verdict: ReviewVerdict): boolean {
  return verdict === 'conditional' || verdict === 'fail'
}

/** 结论的标签（注入文本与面板摘要共用单源，避免两处措辞漂移）。 */
export function verdictLabel(verdict: ReviewVerdict): string {
  switch (verdict) {
    case 'pass': return copyNow('shared.verdict.pass')
    case 'conditional': return copyNow('shared.verdict.conditional')
    case 'fail': return copyNow('shared.verdict.fail')
    case 'unknown': return copyNow('shared.verdict.unknown')
  }
}

/** 英文变体（词边界 + 大小写不敏感；`failure` 不误中 `fail`）。 */
const EN_CONDITIONAL = /\bconditional(?:ly)?\b/i
const EN_FAIL = /\b(?:fail(?:ed|s)?|reject(?:ed|s)?|not\s+approved|needs?\s+work|request(?:s|ed)?\s+changes?|changes\s+requested)\b/i
const EN_PASS = /\bpass(?:ed|es)?\b/i

/**
 * 「通过」被否定包裹的常见写法（v1.4.0 复核补：`结论：本方案无法通过` 若只按
 * 子串判会被读成 pass ⇒ 该退不退）。命中即判 fail，优先于 pass。
 */
const CJK_NEGATED_PASS = /(?:无法|不能|未能|没能|难以|尚未|暂不|不予|没有)通过/

/**
 * 取评审文本的**最后一条非空行**（尾随空行/空白不算一行）。
 * @returns 该行原文（未 trim 内容，仅用于判据与对账）；无内容时返回 ''。
 */
export function lastVerdictLine(text: string): string {
  const lines = text.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trim()
    if (line !== '') return line
  }
  return ''
}

/**
 * 解析评审结论（spec §3.3）。传入失败载荷（reviewText 为空）⇒ unknown。
 *
 * 解析词表读 **zh 表直引**（非 copyNow）：它匹配的是评审模型的产出文本——
 * 英文界面下中文评审照样要写中文结论，词表不随界面语言走（W6 裁定，
 * review-verdict.test.ts 钉住这条语言无关性）。
 */
export function parseReviewVerdict(reviewText: string): ReviewVerdict {
  const line = lastVerdictLine(reviewText)
  if (line === '') return 'unknown'
  // 1) 有条件通过（含「有条件地通过」的英文 conditional）。
  if (line.includes(zhCopy['shared.verdict.conditional']) || EN_CONDITIONAL.test(line)) return 'conditional'
  // 2) 否定结论（「不通过」「未通过」「需要修改」「无法通过」「fail」「reject」
  //    「not approved」…）。
  if (line.includes(zhCopy['shared.verdict.fail']) || line.includes(zhCopy['shared.verdict.wordNotPassed']) || line.includes(zhCopy['shared.verdict.wordNeedsChanges'])
    || CJK_NEGATED_PASS.test(line) || EN_FAIL.test(line)) return 'fail'
  // 3) 通过（无否定前缀的「通过」/「pass」）。
  if (line.includes(zhCopy['shared.verdict.pass']) || EN_PASS.test(line)) return 'pass'
  return 'unknown'
}
