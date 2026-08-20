// test/router.test.ts（骨架；消息夹具同 T2）
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_V4, type CandidateMeta } from '../src/config.js'
import { KimiRouter } from '../src/router.js'

const log = { info: () => {} }
// Ruling 7：costTier 字段 T9 才删，夹具必须带 costTier: 'mid'
const METAS: CandidateMeta[] = [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], costTier: 'mid', available: true },
  { provider: 'deepseek-official', model: 'deepseek-v4-pro', modalities: ['text'], costTier: 'mid', available: true },
  { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], costTier: 'mid', available: true },
  { provider: 'kimi-coding', model: 'kimi-for-coding', modalities: ['text', 'image'], costTier: 'mid', available: true },
]
const textMsg = (t: string) => ({ role: 'user', content: [{ type: 'text', text: t }] }) as never
const imageMsg = () => ({ role: 'user', content: [{ type: 'image', attachment: 'a' }] }) as never
const cfg = (active: string | null) => { const c = DEFAULT_CONFIG_V4(); c.activePreset = active; return c }

describe('KimiRouter v4 decide', () => {
  it('activePreset null → keep router off', () => {
    const r = new KimiRouter(cfg(null), METAS, log)
    expect(r.decide([textMsg('代码')], 1)).toEqual({ kind: 'keep', reason: 'router off' })
  })
  it('未命中规则 → via:default 路由到预设默认（打底语义）', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    expect(r.decide([textMsg('今天天气不错')], 1)).toEqual({
      kind: 'route', target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      reason: '预设「省钱」默认', via: 'default',
    })
  })
  it('规则命中 → via:rule，reason 含条件名', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    expect(r.decide([textMsg('帮我重构这个函数')], 1)).toEqual({
      kind: 'route', target: { provider: 'kimi-coding', model: 'kimi-for-coding' },
      reason: '规则「code」命中', via: 'rule',
    })
  })
  it('带图（消息含图）→ image 规则', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    const d = r.decide([imageMsg()], 1)
    expect(d).toMatchObject({ kind: 'route', target: { provider: 'kimi-coding', model: 'k3' }, via: 'rule' })
  })
  it('带图锁存：hasImageOverride=true 时纯文本轮也按带图处理', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    const d = r.decide([textMsg('继续')], 2, true)
    expect(d).toMatchObject({ kind: 'route', target: { provider: 'kimi-coding', model: 'k3' }, via: 'rule' })
  })
  it('规则目标不可用 → 跳过该规则落默认', () => {
    const metas = METAS.filter((m) => m.model !== 'kimi-for-coding')
    const r = new KimiRouter(cfg('saving'), metas, log)
    expect(r.decide([textMsg('重构函数')], 1)).toMatchObject({ via: 'default', target: { model: 'deepseek-v4-flash' } })
  })
  it('能力预设：闲聊→flash，其余→k3 打底', () => {
    const r = new KimiRouter(cfg('capability'), METAS, log)
    expect(r.decide([textMsg('你好呀')], 1)).toMatchObject({ via: 'rule', target: { model: 'deepseek-v4-flash' } })
    expect(r.decide([textMsg('推导这个式子')], 1)).toMatchObject({ via: 'default', target: { model: 'k3' } })
  })
  it('显式 @kimi 优先于规则与默认', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    const d = r.decide([textMsg('@kimi 随便聊聊')], 1)
    expect(d).toMatchObject({ kind: 'route', via: 'explicit', reason: '显式 @kimi-coding 指令' })
    expect((d as { target: { provider: string } }).target.provider).toBe('kimi-coding')
  })
  it('显式 @provider 无可用候选 → keep', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    expect(r.decide([textMsg('@anthropic 你好')], 1)).toMatchObject({ kind: 'keep' })
  })
  it('显式 @kimi 且带图：池限定多模态候选', () => {
    const metas: CandidateMeta[] = [
      { provider: 'kimi-coding', model: 'text-only-x', modalities: ['text'], costTier: 'mid', available: true },
      { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], costTier: 'mid', available: true },
      ...METAS.filter((m) => m.provider !== 'kimi-coding'),
    ]
    const r = new KimiRouter(cfg('saving'), metas, log)
    const d = r.decide([textMsg('@kimi 看图')], 1, true)
    expect((d as { target: { model: string } }).target.model).toBe('k3')
  })
  it('activePreset 指向缺失预设 → keep + warn 日志', () => {
    const c = cfg('ghost')
    const infos: string[] = []
    const r = new KimiRouter(c, METAS, { info: (m) => infos.push(m) })
    expect(r.decide([textMsg('x')], 1)).toEqual({ kind: 'keep', reason: 'active preset not found' })
    expect(infos.some((m) => m.includes('ghost'))).toBe(true)
  })
})

describe('图像护栏（v4 词汇）', () => {
  it('带图且目标文本-only → 换首个多模态可用候选', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    const g = r.guardImage({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, true)
    expect(g?.target.provider).toBe('kimi-coding')
  })
  it('不带图 / 目标已多模态 / 池内无多模态 → null', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    expect(r.guardImage({ provider: 'kimi-coding', model: 'k3' }, true)).toBeNull()
    expect(r.guardImage({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, false)).toBeNull()
    const textOnly = METAS.map((m) => ({ ...m, modalities: ['text'] }))
    expect(new KimiRouter(cfg('saving'), textOnly, log).guardImage({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, true)).toBeNull()
  })
})
