import assert from 'node:assert/strict'
import { test } from 'node:test'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Verifies the built browser half speaks the harness client-bundle protocol:
 *   window.__ModuleLoader__.load({ id, factory })  with factory returning
 *   { apply, inject }. Skips with a message when lib/client.js is not built
 *   (run `npm run build` first).
 */

const BUNDLE = fileURLToPath(new URL('../lib/client.js', import.meta.url))

test('client bundle registers under the __ModuleLoader__ protocol', async () => {
  let built = true
  try {
    await access(BUNDLE)
  } catch {
    built = false
  }
  if (!built) {
    console.log('[client-bundle] lib/client.js not built — run `npm run build` first; skipping')
    return
  }
  const code = await readFile(BUNDLE, 'utf8')
  const handoffs: Array<{ id: string; factory: (require: (spec: string) => unknown) => unknown }> = []
  const window = { __ModuleLoader__: { load: (h: typeof handoffs[number]) => handoffs.push(h) } }
  // The bundle references only window.__ModuleLoader__ at the top level.
  // eslint-disable-next-line no-new-func
  new Function('window', code)(window)
  assert.equal(handoffs.length, 1)
  assert.equal(handoffs[0]?.id, 'dsh-kimi-bridge')
  const surface = handoffs[0]!.factory((spec) => {
    // react / react/jsx-runtime are the only runtime externals the bundle uses.
    if (spec === 'react' || spec === 'react/jsx-runtime') return {}
    throw new Error(`unexpected external require: ${spec}`)
  }) as { apply?: unknown; inject?: unknown }
  assert.equal(typeof surface.apply, 'function')
  assert.deepEqual(surface.inject, ['slots'])
})
