/**
 * preset-name.ts 纯函数边界（dracpet UX#3，2026-08-21 回访）：
 * 显示名「疑似密钥」判据 + 40 字符上限。每条用例标注「会使其失败的生产改动」。
 */
import { describe, expect, it } from 'vitest'
import { checkDisplayName, DISPLAY_NAME_MAX, looksLikeSecret } from '../src/client/preset-name.js'

describe('looksLikeSecret 前缀判据（大小写不敏感）', () => {
  it.each([
    ['sk-proj-AbC123', 'OpenAI 形态 sk-'],
    ['SK-LIVE-XYZ789', '大写 SK-（大小写不敏感）'],
    ['sk_test_key', 'sk_ 下划线变体'],
    ['ghp_0123456789abcdef', 'GitHub PAT ghp_'],
    ['gho_0123456789abcdef', 'GitHub OAuth gho_'],
    ['ghs_0123456789abcdef', 'GitHub server ghs_'],
    ['github_pat_11AAAABBBB', 'GitHub fine-grained PAT'],
    ['AKIAIOSFODNN7EXAMPLE', 'AWS AKIA（前缀 4 + 16 位 = 20 字符，恰达长度下限）'],
    ['ASIAIOSFODNN7EXAMPLE', 'AWS ASIA 临时密钥（ASIA + 16 位 = 20 字符，恰达下限）'],
    ['xoxb-1234-5678-abcd', 'Slack bot token'],
    ['xoxp-1234-5678-abcd', 'Slack user token'],
    ['AIzaSyD4iE2something', 'Google API key'],
    ['Bearer eyJhbGciOiJIUzI1Ni', 'HTTP Bearer 头形态'],
    ['bearer eyJhbGciOiJIUzI1Ni', 'bearer 小写（大小写不敏感）'],
  ])('命中：%s（%s）', (value) => {
    // Fails if: 任一前缀被移出 SECRET_PREFIXES，或比较不再小写化。
    expect(looksLikeSecret(value)).toBe(true)
  })

  it.each([
    ['sk', '裸 sk 无连字符'],
    ['ski 雪板', 'sk 开头的普通词（sk- 需带连字符）'],
    ['github_patio', 'github_pat_ 需带尾下划线，patio 是 io'],
    ['省钱', '中文预设名'],
    ['前端', '中文角色名'],
    ['Frontend Team', '英文普通名（含空格）'],
    ['kimi-coding/k3', 'provider/model 短形态'],
    ['Asia 团队', 'asia 前缀但仅 7 字符 < 20（task-1 复核误报，长度下限修复）'],
    ['asia-pacific-team', 'asia 开头 17 字符普通名 < 20'],
    ['AKIAIOSFODNN7EXAMPL', 'AKIA + 15 位 = 19 字符，差 1 位不达下限'],
  ])('不命中：%s（%s）', (value) => {
    // Fails if: 前缀判据放宽成「包含」而非「前缀」，或 akia/asia 的 20 字符
    // 下限被去掉——普通命名（如「Asia 团队」）会被误杀。
    expect(looksLikeSecret(value)).toBe(false)
  })

  it('已知代价：≥32 字符的无空格 provider/model 串按规格命中（spec 判据如此）', () => {
    // 'deepseek-official/deepseek-v4-flash' = 35 字符、无空白、100% 令牌字符集
    // ⇒ 长随机串判据命中。这是规格的有意取舍（宁可误伤长机读名，不漏密钥），
    // 钉在此防止有人「顺手修掉」导致判据悄悄失效。
    // 更正（task-2）：原报告 ⑤.1 的另一半误报「asia/akia 前缀误杀普通名」
    // 已由 20 字符下限消除（真实 AWS 密钥 id 恒 20 字符），不再是代价；
    // 现存的刻意取舍只剩本条长随机串判据。
    expect(looksLikeSecret('deepseek-official/deepseek-v4-flash')).toBe(true)
  })
})

describe('looksLikeSecret 长随机串判据（≥32、无空白、字符集占比 ≥90%）', () => {
  it('32 个纯字符集字符 ⇒ 命中', () => {
    // Fails if: 长度阈值被抬高（32 是最低门槛）。
    expect(looksLikeSecret('a'.repeat(32))).toBe(true)
  })

  it('31 个字符 ⇒ 不命中（长度边界下沿）', () => {
    // Fails if: 长度阈值被压低，31 字符普通串被误伤。
    expect(looksLikeSecret('a'.repeat(31))).toBe(false)
  })

  it('32 字符但含空格 ⇒ 不命中（长句/短语不是密钥）', () => {
    // Fails if: 空白豁免被去掉（人话长名会被误伤）。
    expect(looksLikeSecret(`${'a'.repeat(31)} `)).toBe(false)
    expect(looksLikeSecret(`${'a'.repeat(16)} ${'b'.repeat(15)}`)).toBe(false)
  })

  it('32 字符中 29 个在字符集（90.6% ≥ 90%）⇒ 命中（占比边界上沿）', () => {
    // Fails if: 占比阈值被抬到 >90%，混入少量非字符集字符的密钥漏网。
    expect(looksLikeSecret(`${'a'.repeat(29)}密钥名`)).toBe(true)
  })

  it('32 字符中 28 个在字符集（87.5% < 90%）⇒ 不命中（占比边界下沿）', () => {
    // Fails if: 占比阈值被压低，中英混排长名被误伤。
    expect(looksLikeSecret(`${'a'.repeat(28)}密钥名字`)).toBe(false)
  })
})

describe('checkDisplayName 合成结论', () => {
  it('普通名 / 空名 / 纯空白 ⇒ ok（空名走调用方既有兜底，不在此拦截）', () => {
    expect(checkDisplayName('省钱')).toBe('ok')
    expect(checkDisplayName('')).toBe('ok')
    expect(checkDisplayName('   ')).toBe('ok')
  })

  it('Asia 团队 ⇒ ok（task-1 复核误报的合成层回归钉：asia 前缀 + 长度下限 < 20）', () => {
    // Fails if: akia/asia 的 20 字符长度下限被去掉（普通中文名被守卫误杀）。
    expect(checkDisplayName('Asia 团队')).toBe('ok')
  })

  it('trim 后判定：首尾空白包裹的 sk- 仍判 secret', () => {
    // Fails if: 判定前不 trim（用户粘贴带空格即绕过）。
    expect(checkDisplayName('  sk-proj-AbC123  ')).toBe('secret')
  })

  it('疑似密钥优先于超长上报：53 字符 sk- 串 ⇒ secret 而非 tooLong', () => {
    // Fails if: 判据顺序颠倒（贴了整段密钥却只看到「太长」，不知道为什么）。
    expect(checkDisplayName(`sk-${'a'.repeat(50)}`)).toBe('secret')
  })

  it('恰好 40 字符 ⇒ ok；41 字符 ⇒ tooLong（DISPLAY_NAME_MAX 边界）', () => {
    // 40 个 CJK 字符：不在令牌字符集、无空白误判，专钉长度边界。
    expect(DISPLAY_NAME_MAX).toBe(40)
    expect(checkDisplayName('预设'.repeat(20))).toBe('ok')
    // Fails if: 上限偏离 40（剪贴板整段文本应被长度闸挡住）。
    expect(checkDisplayName(`${'预设'.repeat(20)}x`)).toBe('tooLong')
  })
})
