/**
 * 显示名守卫（dracpet UX#3，2026-08-21 回访）：预设显示名与角色显示名（label）
 * 是同一条「用户输入 → 逐字落盘 settings.yaml」通道——剪贴板里的 API key
 * 一旦被当显示名粘贴，会随 `/kimi-tide export-config`、截图、issue 附件外泄。
 *
 * 「疑似密钥」判据只写在这一个文件里，SettingsCard 的预设名输入与角色 label
 * 输入共用 `checkDisplayName`；需要调判据时改这里，不要在调用处复制启发式。
 */

/** 显示名长度上限（字符数，trim 后计）——顺带挡住「整条剪贴板」粘贴。 */
export const DISPLAY_NAME_MAX = 40

/**
 * 常见密钥前缀（一律小写存储，比较前对输入取 lowercase）：
 * `sk-`/`sk_`（OpenAI、Anthropic 等）、GitHub 令牌族（`ghp_`/`gho_`/`ghs_`/
 * `github_pat_`）、AWS 访问密钥 id（`AKIA`/`ASIA`）、Slack 令牌（`xoxb-`/
 * `xoxp-`）、Google API key（`AIza`）、HTTP 头形态（`Bearer `，含尾空格）。
 *
 * `minLength`（对 trim 后长度生效）：AWS 访问密钥 id 恒为 `AKIA`/`ASIA` +
 * 16 位 = 20 字符，故这两个前缀带 20 字符下限——否则「Asia 团队」「Akia」
 * 这类普通名会被前缀误杀（task-1 复核发现的真误报，加下限零召回损失）。
 */
const SECRET_PREFIXES: ReadonlyArray<{ prefix: string; minLength?: number }> = [
  { prefix: 'sk-' },
  { prefix: 'sk_' },
  { prefix: 'ghp_' },
  { prefix: 'gho_' },
  { prefix: 'ghs_' },
  { prefix: 'github_pat_' },
  { prefix: 'akia', minLength: 20 },
  { prefix: 'asia', minLength: 20 },
  { prefix: 'xoxb-' },
  { prefix: 'xoxp-' },
  { prefix: 'aiza' },
  { prefix: 'bearer ' },
]

/** 长随机串判据的字符集：base64/十六进制/令牌常见字符。 */
const TOKEN_ALPHABET = /[A-Za-z0-9_\-+/=]/g

/**
 * `true` = 疑似密钥。两条独立判据，任一命中即判：
 * ① 以小写比较命中常见密钥前缀之一（`akia`/`asia` 另要求长度 ≥ 20，
 *    见 SECRET_PREFIXES 注释；长度按传入串计，调用方 checkDisplayName 已 trim）；
 * ② 长度 ≥32、不含空白、且 `[A-Za-z0-9_\-+/=]` 占比 ≥90%（长随机串形态）。
 */
export function looksLikeSecret(name: string): boolean {
  const lower = name.toLowerCase()
  if (SECRET_PREFIXES.some(({ prefix, minLength }) =>
    lower.startsWith(prefix) && (minLength === undefined || name.length >= minLength))) return true
  if (name.length >= 32 && !/\s/.test(name)) {
    const hits = name.match(TOKEN_ALPHABET)?.length ?? 0
    if (hits / name.length >= 0.9) return true
  }
  return false
}

/** 显示名校验结论：`ok` 可写盘；`secret` 疑似密钥；`tooLong` 超过长度上限。 */
export type DisplayNameVerdict = 'ok' | 'secret' | 'tooLong'

/**
 * 校验显示名（内部先 trim）。疑似密钥优先于超长上报——贴了一整段密钥时，
 * 「像密钥」比「太长」更能解释为什么被拒。
 */
export function checkDisplayName(raw: string): DisplayNameVerdict {
  const name = raw.trim()
  if (looksLikeSecret(name)) return 'secret'
  if (name.length > DISPLAY_NAME_MAX) return 'tooLong'
  return 'ok'
}
