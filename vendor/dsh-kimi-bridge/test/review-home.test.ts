import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildReviewHome, sanitizeText, withReviewOnlyTools } from '../src/review-home.js'

test('withReviewOnlyTools replaces an existing [tools] table', () => {
  const src = '[tools]\ndisabled = ["Bash", "mcp__github__*"]\n\n[background]\nenabled = true\n'
  const out = withReviewOnlyTools(src)
  assert.match(out, /\[tools\]\s*\nenabled = \["Read", "ReadMediaFile", "Grep", "Glob"\]\s*\n\n+\[background\]/)
  assert.ok(!out.includes('disabled = ["Bash"'))
})

test('withReviewOnlyTools appends the allowlist when no [tools] table exists', () => {
  const src = 'default_permission_mode = "manual"\n[providers]\nfoo = "bar"\n'
  const out = withReviewOnlyTools(src)
  assert.match(out, /\[tools\]\s*\nenabled = \["Read", "ReadMediaFile", "Grep", "Glob"\]/)
  assert.ok(out.startsWith('default_permission_mode = "manual"'))
})

test('buildReviewHome writes config + symlinks auth, idempotent', () => {
  const src = mkdtempSync(join(tmpdir(), 'kimi-src-'))
  const dest = mkdtempSync(join(tmpdir(), 'kimi-dest-'))
  try {
    writeFileSync(join(src, 'config.toml'), 'default_permission_mode = "manual"\n[tools]\ndisabled = ["Bash"]\n')
    writeFileSync(join(src, 'credentials'), 'secret')
    buildReviewHome(dest, src)
    assert.ok(existsSync(join(dest, 'config.toml')))
    const cfg = readFileSync(join(dest, 'config.toml'), 'utf8')
    assert.match(cfg, /enabled = \["Read", "ReadMediaFile", "Grep", "Glob"\]/)
    assert.ok(existsSync(join(dest, 'credentials')), 'auth symlink must exist')
    // Idempotent second build.
    buildReviewHome(dest, src)
    assert.ok(readFileSync(join(dest, 'config.toml'), 'utf8').includes('enabled'))
  } finally {
    rmSync(src, { recursive: true, force: true })
    rmSync(dest, { recursive: true, force: true })
  }
})

test('sanitizeText strips ESC and C0 control chars, keeps newline/tab', () => {
  assert.equal(sanitizeText('a\u001b[31mb\u0000c\nd\te'), 'abc\nd\te')
})
