/**
 * §9 官方 UI 规则的**机器检查**（棘轮式，2026-10-07 新增）。
 *
 * 依据（本机官方文档副本 `~\.dsh\skills\dsh-plugin-guide\references\official-docs\docs\ui-radius.md`）：
 * - 普通控件与卡片必须**消费具名 token**（`--dsw-radius-*` / `--dsw-alias-*`），
 *   不得新引入 `10px/14px/18px/24px` 这类本地字面量（`ui-radius.md:50`）；
 * - 设置卡片材质 = R20 + `0.5px solid var(--dsw-alias-settings-card-stroke)` +
 *   `var(--dsw-alias-settings-card-fill)`（`ui-radius.md:97-104`）；
 * - **不得靠第二道中性边框或阴影**给卡片/页签做分组（`ui-radius.md:106`）。
 *
 * 现状与本测试的取舍：本插件的样式表**早于**该规则写入，历史里有 21 处字面量圆角与
 * 3 处阴影（见基线常量）。一次性重写全部历史样式风险大于收益，故采取**棘轮**：
 * **只许减不许增**；同时把 A/B 新增的决策链相关块钉死在 token 上、且不得带阴影——
 * 那条规则正是本次改造最容易被后人破坏的地方（"给档位加个阴影区分一下"）。
 *
 * Fails if:
 * - 新增任何字面量圆角，或遮蔽掉已有的 token 圆角；
 * - 决策链/徽标/重叠解释块里出现 `box-shadow`（§9.2 禁分组阴影）；
 * - 有新的选择器带上阴影（阴影集合只允许收缩到基线子集）。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLIENT_CSS } from '../src/client/styles.js'

/** 基线（2026-10-07 实测）：25 处 border-radius = 21 字面量 + 4 token；3 处阴影。 */
const BASELINE_LITERAL_RADIUS = 21
const BASELINE_TOKEN_RADIUS = 4
const BASELINE_SHADOW_SELECTORS = ['.kt-card', '.kt-dock-pop', '.kt-review-card']

const HERE = dirname(fileURLToPath(import.meta.url))

/** 直接读源文件：断言必须针对**写进仓库的样式**，不是构建产物。 */
const SOURCE_CSS = readFileSync(resolve(HERE, '../src/client/styles.ts'), 'utf8')

const radiusValues = (css: string): string[] =>
  [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim())

/** 规则块（本样式表无 @media，平铺，可用「选择器 { 声明 }」逐块取）。 */
const ruleBlocks = (css: string): Array<{ selector: string; body: string }> =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }))

describe('§9 官方 UI 规则：圆角 token 棘轮', () => {
  it('字面量圆角只许减不许增；token 圆角不许减少', () => {
    const values = radiusValues(SOURCE_CSS)
    const literal = values.filter((v) => !v.startsWith('var(--dsw-radius-'))
    const tokens = values.filter((v) => v.startsWith('var(--dsw-radius-'))
    // Fails if: 有人新写 border-radius: 10px（§9 明禁的本地字面量）。
    expect(literal.length, `字面量圆角数（基线 ${BASELINE_LITERAL_RADIUS}，只许减）`).toBeLessThanOrEqual(BASELINE_LITERAL_RADIUS)
    expect(tokens.length, `token 圆角数（基线 ${BASELINE_TOKEN_RADIUS}，只许增）`).toBeGreaterThanOrEqual(BASELINE_TOKEN_RADIUS)
  })
})

describe('§9 官方 UI 规则：阴影不得用于分组', () => {
  it('决策链 / 档位 / 接入徽标 / 重叠解释块内不得出现 box-shadow', () => {
    const chainBlocks = ruleBlocks(SOURCE_CSS).filter((b) =>
      /kt-chain|kt-tier|kt-wire|kt-overlap/.test(b.selector))
    expect(chainBlocks.length, '决策链相关规则块应存在').toBeGreaterThan(0)
    // Fails if: 有人给档位加阴影来做"未启用/异常"的视觉区分（§9.2 明文禁止）。
    const offenders = chainBlocks.filter((b) => b.body.includes('box-shadow')).map((b) => b.selector)
    expect(offenders).toEqual([])
  })

  it('虚线描边不得出现在卡片类规则上（§9.2 裁定，2026-10-07 复核 #7-①）', () => {
    // 复核者把 `.kt-overlap { border: 1px dashed … }` 列为"需人眼裁定是否算第二道边框"。
    // 裁定：**合规**——§9.2 禁的是"在设置卡片那道 stroke 上再加一道中性边框/阴影"来分组；
    // `.kt-overlap` 是**行内解释条**（不是 kt-card），虚线是刻意的**语义标记**（区分
    // 「解释」与 kt-conflict-banner 的警示实底）。本用例把边界钉住：虚线**只能**留在
    // 非卡片元素上；一旦有人给卡片加虚线描边，即红。
    const dashedOnCards = ruleBlocks(SOURCE_CSS)
      .filter((b) => /kt-card/.test(b.selector) && /dashed/.test(b.body))
      .map((b) => b.selector)
    expect(dashedOnCards).toEqual([])
  })

  it('阴影选择器集合不得新增（只允许收缩到基线子集）', () => {
    const withShadow = ruleBlocks(SOURCE_CSS)
      .filter((b) => b.body.includes('box-shadow'))
      .flatMap((b) => b.selector.split(',').map((s) => s.trim().split('\n').pop()!.trim()))
      .filter((s) => s.startsWith('.'))
    // 选择器是复合的（如 `.kimi-tide-settings .kt-card`），按"最后一段"比对基线。
    const tails = [...new Set(withShadow.map((s) => `.${s.split('.').pop()!}`))]
    const unexpected = tails.filter((t) => !BASELINE_SHADOW_SELECTORS.includes(t))
    // Fails if: 新增一处阴影（例如给设置卡再加一层"浮起"效果）。
    expect(unexpected).toEqual([])
  })
})

describe('§9 官方 UI 规则：宿主 token 与卡片材质', () => {
  it('样式表消费宿主别名 token（--dsw-alias-*），而非全部自造色', () => {
    const aliasUses = (SOURCE_CSS.match(/var\(--dsw-alias-/g) ?? []).length
    expect(aliasUses).toBeGreaterThan(0)
  })

  it('客户端样式常量非空且为字符串（构建/导出面未被破坏）', () => {
    expect(typeof CLIENT_CSS).toBe('string')
    expect(CLIENT_CSS.length).toBeGreaterThan(1000)
    expect(CLIENT_CSS).toContain('--dsw-radius-')
  })
})
