import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { DEFAULT_CONFIG_V4, type RouterConfigV4 } from '../src/config.js'
import { mergeResolved } from '../src/settings-schema.js'
import { migrateSidecarIntoScope, type MigrationScope } from '../src/settings-migration.js'

function tmp(): string { return mkdtempSync(join(tmpdir(), 'kt-migrate-')) }
function fakeScope(current: RouterConfigV4) {
  const s: MigrationScope & { replaced: object | null } = {
    replaced: null,
    get: () => current,
    replace: async (section) => { s.replaced = section; current = section as RouterConfigV4 },
  }
  return s
}
const onError = () => {}

describe('migrateSidecarIntoScope', () => {
  it('imports an existing sidecar into the user layer and renames it', async () => {
    const dir = tmp()
    const file = join(dir, 'kimi-tide-router.yml')
    // v4 夹具（Task 4 起 sidecar 返回 v4；Ruling 2：本测试随类型适配收口）
    const cfg: RouterConfigV4 = { ...DEFAULT_CONFIG_V4(), activePreset: 'saving' }
    writeFileSync(file, YAML.stringify(cfg), 'utf8')
    const scope = fakeScope(mergeResolved({}))
    const outcome = await migrateSidecarIntoScope({ sidecarFile: file, scope, entry: {}, onError })
    expect(outcome).toBe('imported')
    expect((scope.replaced as RouterConfigV4).activePreset).toBe('saving')
    expect(existsSync(file)).toBe(false)
    expect(existsSync(file + '.legacy-imported')).toBe(true)
    expect(readFileSync(file + '.legacy-imported', 'utf8')).toContain('activePreset: saving')
    rmSync(dir, { recursive: true, force: true })
  })

  it('is a no-op when the sidecar is absent', async () => {
    const dir = tmp()
    const scope = fakeScope(mergeResolved({}))
    expect(await migrateSidecarIntoScope({ sidecarFile: join(dir, 'nope.yml'), scope, entry: {}, onError })).toBe('no-sidecar')
    expect(scope.replaced).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('skips (dirty) when the entry carries an explicit edited v5 config', async () => {
    const dir = tmp()
    const file = join(dir, 'kimi-tide-router.yml')
    writeFileSync(file, YAML.stringify(DEFAULT_CONFIG_V4()), 'utf8')
    const resolved = mergeResolved({})
    const dirty: RouterConfigV4 = { ...resolved, activePreset: 'saving' }
    const scope = fakeScope(dirty)
    const errors: string[] = []
    // 0.1.7 口径：脏 = 条目带「显式 v5 配置」（hasExplicitV5Config），不再靠结构比对
    // 猜（宿主解析值自带 schema 默认，结构比对在未配置条目上必然不等、会假判脏）。
    expect(await migrateSidecarIntoScope({ sidecarFile: file, scope, entry: {}, hasExplicitEntryConfig: true, onError: (m) => errors.push(m) })).toBe('skipped-dirty')
    expect(scope.replaced).toBeNull()
    expect(errors.some((m) => m.includes('跳过'))).toBe(true)
    expect(existsSync(file)).toBe(true)   // 未改名
    rmSync(dir, { recursive: true, force: true })
  })

  it('imports when the entry has no explicit v5 config even if the resolved value differs', async () => {
    const dir = tmp()
    const file = join(dir, 'kimi-tide-router.yml')
    writeFileSync(file, YAML.stringify({ ...DEFAULT_CONFIG_V4(), activePreset: 'saving' }), 'utf8')
    // 未配置条目 ⇒ 宿主给出的解析值（带 schema 默认）与 entry 基线必然不同结构，
    // 但这不是「用户编辑」——必须照常导入。
    const scope = fakeScope(mergeResolved({}))
    expect(await migrateSidecarIntoScope({
      sidecarFile: file, scope, entry: {}, hasExplicitEntryConfig: false, onError,
    })).toBe('imported')
    expect((scope.replaced as RouterConfigV4).activePreset).toBe('saving')
    rmSync(dir, { recursive: true, force: true })
  })

  it('treats a corrupt sidecar as no-sidecar (load renames it .corrupt)', async () => {
    const dir = tmp()
    const file = join(dir, 'kimi-tide-router.yml')
    writeFileSync(file, '{{{', 'utf8')
    const scope = fakeScope(mergeResolved({}))
    const outcome = await migrateSidecarIntoScope({ sidecarFile: file, scope, entry: {}, onError })
    expect(outcome).toBe('no-sidecar')
    expect(scope.replaced).toBeNull()
    expect(existsSync(file + '.corrupt')).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
