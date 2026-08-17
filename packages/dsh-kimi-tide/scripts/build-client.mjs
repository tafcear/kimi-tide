/**
 * Build the browser half (lib/client.js) with esbuild, replicating the
 * harness's client bundle protocol (same as vendor/dsh-kimi-bridge).
 */
import { build } from 'esbuild'

const PLUGIN_ID = 'dsh-kimi-tide'

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

console.log('[dsh-kimi-tide] built lib/client.js (browser half)')
