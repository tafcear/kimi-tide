/**
 * 清空 lib/（host 构建前置步骤）。
 *
 * 【为什么需要】`build:host` 就是一句 `tsc -p tsconfig.build.json`，而 tsc
 * **从不删除源文件已消失的产物**——于是 lib/ 会累积「已删模块的残骸」。
 * 2026-10-03 实测：`adapter` / `classify` / `context` / `oauth` / `scores` /
 * `scoring` / `stream` 七个早已删除的模块，其 `.js` + `.d.ts` 仍躺在 lib/ 里
 * （本地 `npm pack` 会一并打进包里；CI 是干净 checkout，所以线上发布资产不受
 * 影响——但本地验证与「包内容 = 源码」的直觉会被破坏）。
 *
 * 【安全】只删由本脚本位置推导出的 `<包根>/lib`，且删前断言路径以
 * `/dsh-kimi-tide/lib` 结尾——脚本被搬走/包被改名时宁可报错也不误删。
 */
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lib = join(pkgRoot, 'lib')

if (!lib.replace(/\\/g, '/').toLowerCase().endsWith('/dsh-kimi-tide/lib')) {
  console.error(`[dsh-kimi-tide] 拒绝清理可疑路径（预期 …/dsh-kimi-tide/lib）：${lib}`)
  process.exit(1)
}

rmSync(lib, { recursive: true, force: true })
console.log('[dsh-kimi-tide] cleaned lib/')
