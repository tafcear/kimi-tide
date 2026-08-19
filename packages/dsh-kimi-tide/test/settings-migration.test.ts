import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { DEFAULT_CONFIG_V2, type RouterConfigV2 } from '../src/config.js'
import { mergeResolved } from '../src/settings-schema.js'
import { migrateSidecarIntoScope, type MigrationScope } from '../src/settings-migration.js'

function tmp(): string { return mkdtempSync(join(tmpdir(), 'kt-migrate-')) }
function fakeScope(current: RouterConfigV2) {
  const s: MigrationScope & { replaced: object | null } = {
    replaced: null,
    get: () => current,
    replace: async (section) => { s.replaced = section; current = section as RouterConfigV2 },
  }
  return s
}
const onError = () => {}

describe('migrateSidecarIntoScope', () => {
  it('imports an existing sidecar into the user layer and renames it', async () => {
    const dir = tmp()
    const file = join(dir, 'kimi-tide-router.yml')
    const cfg = { ...DEFAULT_CONFIG_V2('kimi-tide'), mode: 'capability' as const }
    writeFileSync(file, YAML.stringify(cfg), 'utf8')
    const scope = fakeScope(mergeResolved({}, 'kimi-tide'))
    const outcome = await migrateSidecarIntoScope({ sidecarFile: file, scope, entry: {}, providerName: 'kimi-tide', onError })
    expect(outcome).toBe('imported')
    expect((scope.replaced as RouterConfigV2).mode).toBe('capability')
    expect(existsSync(file)).toBe(false)
    expect(existsSync(file + '.legacy-imported')).toBe(true)
    expect(readFileSync(file + '.legacy-imported', 'utf8')).toContain('mode: capability')
    rmSync(dir, { recursive: true, force: true })
  })

  it('is a no-op when the sidecar is absent', async () => {
    const dir = tmp()
    const scope = fakeScope(mergeResolved({}, 'kimi-tide'))
    expect(await migrateSidecarIntoScope({ sidecarFile: join(dir, 'nope.yml'), scope, entry: {}, providerName: 'kimi-tide', onError })).toBe('no-sidecar')
    expect(scope.replaced).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('skips (dirty) when the user layer already differs from defaults+base', async () => {
    const dir = tmp()
    const file = join(dir, 'kimi-tide-router.yml')
    writeFileSync(file, YAML.stringify(DEFAULT_CONFIG_V2('kimi-tide')), 'utf8')
    const resolved = mergeResolved({}, 'kimi-tide')
    const dirty = { ...resolved, routeThreshold: 0.5 }
    const scope = fakeScope(dirty)
    const errors: string[] = []
    expect(await migrateSidecarIntoScope({ sidecarFile: file, scope, entry: {}, providerName: 'kimi-tide', onError: (m) => errors.push(m) })).toBe('skipped-dirty')
    expect(scope.replaced).toBeNull()
    expect(errors.some((m) => m.includes('跳过'))).toBe(true)
    expect(existsSync(file)).toBe(true)   // 未改名
    rmSync(dir, { recursive: true, force: true })
  })
})
