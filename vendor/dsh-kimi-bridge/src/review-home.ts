/**
 * Review-only Kimi home builder (dsh-kimi-bridge, kimi-tide maintained fork).
 *
 * `kimi -p` runs with permission:"auto" internally — there is no CLI sandbox
 * flag, so the only Kimi-layer control is the config `[tools]` switch, which
 * is enforced again before tool execution. The plugin therefore builds a
 * MANAGED home whose config.toml allows only read-only built-in tools
 * (Read/ReadMediaFile/Grep/Glob) and reuses the real home's auth, so login
 * keeps working. A config `reviewOnly: false` opts out and uses the real home
 * directly (explicit operator choice — never call that a sandbox).
 *
 * kimi-tide fork notes:
 * - Home resolution uses `os.homedir()` instead of `process.env.HOME`, which
 *   is unset on stock Windows and previously fell back to `process.cwd()`.
 * - Windows without Developer Mode / admin cannot create symlinks (EPERM).
 *   Directories fall back to junctions (`mklink /J`, no admin needed) which
 *   auto-sync content; files fall back to copies that are refreshed whenever
 *   the source mtime/size change.
 * - `[tools]` rewriting uses a real TOML parser (`@iarna/toml`) with a
 *   conservative regex fallback for unparseable configs.
 * - AUTH_FILES is intentionally a closed list: kimi's auth surface is
 *   `credentials`, `oauth`, and `device_id`; a new auth entry would be
 *   deliberately ignored until this list is extended (fail-safe default).
 */

import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import os from 'node:os'
import toml from '@iarna/toml'

/** The built-in read-only tools allowed in the review home. */
export const REVIEW_ONLY_TOOLS = ['Read', 'ReadMediaFile', 'Grep', 'Glob'] as const

/** Auth entries shared from the real home (see the fork note above). */
const AUTH_FILES = ['credentials', 'oauth', 'device_id'] as const

/** Replace the `[tools]` table of a config.toml text with the allowlist. */
export function withReviewOnlyTools(configText: string): string {
  // Preferred path: real TOML round-trip (handles `[tools] # comment` and
  // any inline-table shapes the regex hack would miss).
  try {
    const parsed = toml.parse(configText) as Record<string, unknown>
    const out: Record<string, unknown> = { ...parsed }
    out.tools = { enabled: [...REVIEW_ONLY_TOOLS] }
    return toml.stringify(out as unknown as toml.JsonMap)
  } catch {
    // Fallback for configs the parser rejects: conservative section rewrite.
    const allowlist = `[tools]\nenabled = [${REVIEW_ONLY_TOOLS.map(t => JSON.stringify(t)).join(', ')}]\n`
    // A TOML section runs from a `[table]` line (optional inline comment) to
    // the next `[` section line.
    const section = /^\[tools\]\s*(?:#.*)?\r?\n(.*?)(?=^\[|\z)/ms
    if (section.test(configText)) return configText.replace(section, allowlist)
    return `${configText.replace(/\s*$/, '')}\n\n${allowlist}`
  }
}

/** Resolve the real Kimi home (KIMI_CODE_HOME env, else ~/.kimi-code). */
export function realKimiHome(): string {
  const env = process.env.KIMI_CODE_HOME
  if (env !== undefined && env.length > 0) return env
  return join(os.homedir(), '.kimi-code')
}

/** A managed home directory under $DSH_HOME (or ~/.dsh as a fallback). */
export function defaultReviewHomeDir(): string {
  const dshHome = process.env.DSH_HOME ?? join(os.homedir(), '.dsh')
  return join(dshHome, 'kimi-review-home')
}

/** True when a copied auth file needs refreshing (missing or changed source). */
export function copyNeeded(source: string, dest: string): boolean {
  if (!existsSync(dest)) return true
  try {
    const s = statSync(source)
    const d = statSync(dest)
    return s.mtimeMs !== d.mtimeMs || s.size !== d.size
  } catch {
    return true
  }
}

/** Link or junction a directory auth entry (auto-syncs; idempotent). */
function linkAuthDir(source: string, link: string): void {
  if (existsSync(link)) return // symlink/junction already there → auto-sync
  try {
    symlinkSync(source, link)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return
    if (process.platform !== 'win32') throw error
  }
  try {
    execFileSync('cmd.exe', ['/c', 'mklink', '/J', link, source], { stdio: 'ignore' })
  } catch (fallbackError) {
    if (existsSync(link)) return // lost the EEXIST race → idempotent success
    throw new Error(`kimi-tide: cannot create junction for "${link}": ${(fallbackError as Error).message}`)
  }
}

/** Link or (on Windows without symlink rights) copy a file auth entry. */
function syncAuthFile(source: string, link: string): void {
  // A symlink/junction never needs refreshing.
  try {
    if (existsSync(link) && lstatSync(link).isSymbolicLink()) return
  } catch {
    // Treat unreadable links as absent; rebuild below.
  }
  if (!copyNeeded(source, link)) return
  // Existing plain copy (any platform) that needs refreshing: overwrite it
  // directly and restore the source mtime so the next build can skip it.
  if (existsSync(link)) {
    copyFileSync(source, link)
    try {
      const s = statSync(source)
      utimesSync(link, s.atime, s.mtime)
    } catch { /* best-effort timestamp restore */ }
    return
  }
  try {
    symlinkSync(source, link)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return // lost the race: another instance built it
    if (process.platform !== 'win32') throw error
    // Windows fallback: plain copy; copyNeeded() above keeps it fresh by
    // comparing mtime/size on every build (mtime restored after each copy).
    copyFileSync(source, link)
    try {
      const s = statSync(source)
      utimesSync(link, s.atime, s.mtime)
    } catch { /* best-effort timestamp restore */ }
  }
}

/**
 * Build (or refresh) the review-only home at `destDir` from `sourceHome`.
 * Idempotent and refresh-safe: config.toml is rewritten each call, junctions
 * are created once, and copied files are refreshed when the source changed.
 * Call before every kimi spawn so auth stays current.
 * @param sourceHome - the real home carrying config + auth (default: realKimiHome()).
 * @param destDir - the managed review home directory (created if absent).
 * @returns the review home path.
 */
export function buildReviewHome(destDir: string, sourceHome: string = realKimiHome()): string {
  mkdirSync(destDir, { recursive: true })
  const sourceConfig = join(sourceHome, 'config.toml')
  const sourceText = existsSync(sourceConfig) ? readFileSync(sourceConfig, 'utf8') : ''
  const nextText = withReviewOnlyTools(sourceText)
  // Validate what we are about to write (kimi-tide: fail loud, never write
  // an unparseable config that breaks every kimi spawn).
  try {
    toml.parse(nextText)
  } catch (error) {
    throw new Error(`kimi-tide: generated review config.toml failed TOML validation: ${(error as Error).message}`)
  }
  writeFileSync(join(destDir, 'config.toml'), nextText)
  for (const name of AUTH_FILES) {
    const source = join(sourceHome, name)
    if (!existsSync(source)) continue
    const link = join(destDir, name)
    if (statSync(source).isDirectory()) linkAuthDir(source, link)
    else syncAuthFile(source, link)
  }
  return destDir
}

/** Sanitize recorded text: strip ANSI sequences and C0 control chars except \n and \t. */
export function sanitizeText(text: string): string {
  return text
    // ANSI CSI sequences (ESC [ params letter), e.g. color codes.
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    // OSC sequences (ESC ] … BEL / ESC \).
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    // Remaining ESC and C0 controls except \n and \t.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u001B]/g, '')
}
