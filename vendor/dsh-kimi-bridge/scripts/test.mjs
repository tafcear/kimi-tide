/**
 * Test runner for dsh-kimi-bridge.
 *
 * Standalone (no harness): run projection / manager / client-bundle tests —
 * they do not import @deepseek-ai/* runtime values. The tools tests import
 * @deepseek-ai/dsh-tools, which resolves only inside the harness (via the
 * harness's tsx tsconfig-paths hook), so they run only when that probe passes.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

const probe = spawnSync(
  process.execPath,
  [
    '--import', 'tsx',
    '--eval',
    "import('@deepseek-ai/dsh-tools').then(() => process.exit(0)).catch(() => process.exit(1))",
  ],
  { stdio: 'ignore' },
)

const files = [
  'test/projection.test.ts',
  'test/kimi-manager.test.ts',
  'test/redact.test.ts',
  'test/review-home.test.ts',
  'test/client-bundle.test.ts',
]
if (probe.status === 0) {
  files.push('test/tools.test.ts')
} else {
  console.log(
    '[test] @deepseek-ai/dsh-tools is not resolvable outside the harness — ' +
      'tools.test.ts skipped (runs inside the harness).\n' +
      '[test] Typecheck and compliance checks still run standalone.',
  )
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...files],
  { stdio: 'inherit', cwd: projectRoot },
)
process.exit(result.status ?? 1)
