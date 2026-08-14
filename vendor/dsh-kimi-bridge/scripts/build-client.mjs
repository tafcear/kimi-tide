/**
 * Build the browser half (lib/client.js) with esbuild, replicating the
 * harness's client bundle protocol:
 *
 *   window.__ModuleLoader__.load({ id: "<plugin id>", factory: (require) => {
 *     var module = { exports: {} }; var exports = module.exports;
 *     <CJS bundle; externals resolved through the injected require>
 *     return module.exports;
 *   } });
 *
 * Externals = the browser platform module table (packages/client/web/src/
 * platform.ts) plus the runtime exemption — everything else is inlined. The
 * shell kernel serves this file at /plugins/<id>/client.js.
 */

import { build } from 'esbuild'

const PLUGIN_ID = 'dsh-kimi-bridge'

/** The module table the shell shares into the frozen loader (platform.ts). */
const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
]

/** Runtime store engine exemption (runtime is an immediately-tier row). */
const RUNTIME_EXTERNALS = ['@deepseek-ai/dsh-client-runtime/client']

await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  outfile: 'lib/client.js',
  sourcemap: true,
  external: [...PLATFORM_EXTERNALS, ...RUNTIME_EXTERNALS],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      'var module = { exports: {} }; var exports = module.exports;',
    ].join('\n'),
  },
  footer: {
    js: 'return module.exports; } });',
  },
})

console.log('[dsh-kimi-bridge] built lib/client.js (browser half)')
