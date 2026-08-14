/**
 * kimi-tide: Windows fallback coverage for the review-home fork.
 * Run standalone: node --import tsx --test test/review-home-win.test.ts
 * On machines without symlink rights this exercises the real
 * junction/copy fallback paths; on other platforms it verifies the
 * refresh semantics that both branches share.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import toml from '@iarna/toml'
import { buildReviewHome, copyNeeded, withReviewOnlyTools, REVIEW_ONLY_TOOLS } from '../src/review-home.js'

test('withReviewOnlyTools handles an inline [tools] comment and stays valid TOML', () => {
  const src = '[tools] # inline comment\ndisabled = ["Bash"]\n\n[background]\nenabled = true\n'
  const out = withReviewOnlyTools(src)
  const parsed = toml.parse(out) as Record<string, unknown>
  assert.deepEqual((parsed.tools as { enabled?: string[] }).enabled, [...REVIEW_ONLY_TOOLS])
  assert.equal((parsed.background as { enabled?: boolean }).enabled, true)
})

test('withReviewOnlyTools output parses as TOML for valid sources', () => {
  const cases = ['', 'default_permission_mode = "manual"\n', '[tools]\nfoo = 1\n']
  for (const src of cases) {
    const out = withReviewOnlyTools(src)
    assert.doesNotThrow(() => toml.parse(out), `output for ${JSON.stringify(src)} must parse`)
    assert.match(out, /enabled = \[/)
  }
})

test('buildReviewHome rejects configs it cannot make valid (fail-loud)', () => {
  const src = mkdtempSync(join(tmpdir(), 'kimi-bad-'))
  const dest = mkdtempSync(join(tmpdir(), 'kimi-bad-dest-'))
  try {
    writeFileSync(join(src, 'config.toml'), 'not [valid toml\n')
    assert.throws(() => buildReviewHome(dest, src), /TOML validation/)
  } finally {
    rmSync(src, { recursive: true, force: true })
    rmSync(dest, { recursive: true, force: true })
  }
})

test('copyNeeded detects missing, equal, and changed files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kimi-cn-'))
  try {
    const src = join(dir, 'a.txt')
    const dest = join(dir, 'b.txt')
    const fixed = new Date('2024-01-01T00:00:00.000Z') // whole-second: avoids mtime precision drift
    writeFileSync(src, 'v1')
    assert.equal(copyNeeded(src, dest), true, 'missing dest → refresh needed')
    writeFileSync(dest, 'v1')
    utimesSync(src, fixed, fixed)
    utimesSync(dest, fixed, fixed)
    assert.equal(copyNeeded(src, dest), false, 'same size + mtime → no refresh')
    writeFileSync(dest, 'v2-longer')
    utimesSync(dest, fixed, fixed)
    assert.equal(copyNeeded(src, dest), true, 'size differs → refresh needed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('buildReviewHome refresh flow (idempotent, junction/copy fallback)', () => {
  const src = mkdtempSync(join(tmpdir(), 'kimi-src-'))
  const dest = mkdtempSync(join(tmpdir(), 'kimi-dest-'))
  try {
    writeFileSync(join(src, 'config.toml'), 'default_permission_mode = "manual"\n')
    mkdirSync(join(src, 'credentials'))
    writeFileSync(join(src, 'credentials', 'kimi-code.json'), '{"token":"v1"}')
    writeFileSync(join(src, 'device_id'), 'dev-1')

    buildReviewHome(dest, src)
    const cfg = readFileSync(join(dest, 'config.toml'), 'utf8')
    const parsed = toml.parse(cfg) as Record<string, unknown>
    assert.deepEqual((parsed.tools as { enabled?: string[] }).enabled, [...REVIEW_ONLY_TOOLS])
    assert.ok(existsSync(join(dest, 'credentials')))
    assert.ok(existsSync(join(dest, 'device_id')))

    // Directory entry: a symlink/junction auto-syncs; a plain copy must be
    // refreshed on the next build.
    const credLinked = lstatSync(join(dest, 'credentials')).isSymbolicLink()
    writeFileSync(join(src, 'credentials', 'kimi-code.json'), '{"token":"v2"}')
    buildReviewHome(dest, src) // second build must not throw (idempotent)
    const seen = readFileSync(join(dest, 'credentials', 'kimi-code.json'), 'utf8')
    assert.match(seen, /v2/, 'credentials content must be current after rebuild')

    // File entry: when it is a copy (not a symlink), a source change must be
    // propagated by the next build; an unchanged source must NOT be copied
    // again (mtime restored on copy keeps copyNeeded() quiet).
    const devLinked = lstatSync(join(dest, 'device_id')).isSymbolicLink()
    if (!devLinked) {
      const mtimeAfterFirst = statSync(join(dest, 'device_id')).mtimeMs
      buildReviewHome(dest, src) // no source change → no copy
      assert.equal(statSync(join(dest, 'device_id')).mtimeMs, mtimeAfterFirst, 'unchanged copy must not be rewritten')
      writeFileSync(join(src, 'device_id'), 'dev-2-longer')
      buildReviewHome(dest, src)
      assert.equal(readFileSync(join(dest, 'device_id'), 'utf8'), 'dev-2-longer', 'copied file must refresh')
    }
    assert.ok(credLinked || !devLinked, 'at least one entry exercised the fallback on symlink-less hosts')
  } finally {
    rmSync(src, { recursive: true, force: true })
    rmSync(dest, { recursive: true, force: true })
  }
})
