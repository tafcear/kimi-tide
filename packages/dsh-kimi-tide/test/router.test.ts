// test/router.test.ts（骨架；消息夹具同 T2）
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG_V4, type CandidateMeta } from '../src/config.js'
import { KimiRouter, reasoningEffortFor } from '../src/router.js'

const log = { info: () => {} }
const METAS: CandidateMeta[] = [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], available: true },
  { provider: 'deepseek-official', model: 'deepseek-v4-pro', modalities: ['text'], available: true },
  { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available: true },
  { provider: 'kimi-coding', model: 'kimi-for-coding', modalities: ['text', 'image'], available: true },
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
  it('flow 目标规则被显式跳过（legacy 决策链不消费协作流引用，Task 8 接管）', () => {
    const c = cfg('saving')
    c.presets.saving.rules.unshift({ id: 'flow-first', when: { kind: 'image' }, target: { flow: 'transcribe' } })
    const r = new KimiRouter(c, METAS, log)
    // 首条 image 规则指向协作流 → 跳过，落到下一条 image-k3 规则（0.5.x 行为不变）
    expect(r.decide([imageMsg()], 1)).toMatchObject({
      kind: 'route', target: { provider: 'kimi-coding', model: 'k3' }, via: 'rule',
    })
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
      { provider: 'kimi-coding', model: 'text-only-x', modalities: ['text'], available: true },
      { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available: true },
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
  // rc.2 实机回归（2026-08-22）：deepseek 目录新增 deepseek-v4-flash-vision-exp 后，
  // provider 级 textOnlyProviders 判定把 deepseek-official 整体视为「有图能力」，
  // 带图轮停在文本模型 flash 上，被宿主 projectImagesForTextModel 投影成 hash 占位。
  const MIXED: CandidateMeta[] = [
    { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], available: true },
    { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', modalities: ['text', 'image'], available: true },
    { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available: true },
  ]
  it('混合模态目录：文本模型目标仍被改道（模型级判定）', () => {
    const r = new KimiRouter(cfg('capability'), MIXED, log)
    const g = r.guardImage({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, true)
    expect(g).not.toBeNull()
    expect(g?.target.model).not.toBe('deepseek-v4-flash')
  })
  it('混合模态目录：目标模型自身多模态 → 不改道；未知目标 → 保持宽容', () => {
    const r = new KimiRouter(cfg('capability'), MIXED, log)
    expect(r.guardImage({ provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' }, true)).toBeNull()
    expect(r.guardImage({ provider: 'ghost', model: 'x' }, true)).toBeNull()
  })
  it('改道目标按用户意图序：预设默认（多模态）优先于目录序候选', () => {
    // capability 默认 k3（多模态）→ k3 优先于目录序在前的 vision-exp
    const r = new KimiRouter(cfg('capability'), MIXED, log)
    expect(r.guardImage({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, true)?.target)
      .toEqual({ provider: 'kimi-coding', model: 'k3' })
    // saving 默认 flash（文本）→ 规则目标序中首个多模态（image-k3 规则目标 k3）
    const r2 = new KimiRouter(cfg('saving'), MIXED, log)
    expect(r2.guardImage({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, true)?.target)
      .toEqual({ provider: 'kimi-coding', model: 'k3' })
  })
})

describe('推理等级映射（2026-08-25）', () => {
  const K3 = { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available: true, reasoningEfforts: ['low', 'high', 'max'] }
  const HIGHSPEED = { provider: 'kimi-coding', model: 'kimi-for-coding-highspeed', modalities: ['text', 'image'], available: true, reasoningEfforts: ['minimal', 'low', 'medium', 'high'] }
  const NON_REASONING = { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], available: true, reasoningEfforts: ['off'] }
  const UNKNOWN = { provider: 'kimi-coding', model: 'k3-256k', modalities: ['text', 'image'], available: true }

  it('reasoningEffortFor：支持集包含继承等级 → 原样保留', () => {
    expect(reasoningEffortFor([K3], K3, 'max')).toBe('max')
    expect(reasoningEffortFor([K3], K3, 'low')).toBe('low')
  })
  it('reasoningEffortFor：继承等级越级 → 向下钳制到最高支持等级', () => {
    expect(reasoningEffortFor([HIGHSPEED], HIGHSPEED, 'max')).toBe('high')
    expect(reasoningEffortFor([HIGHSPEED], HIGHSPEED, 'xhigh')).toBe('high')
    expect(reasoningEffortFor([K3], K3, 'xhigh')).toBe('high')
  })
  it('reasoningEffortFor：目标能力未知 → 剥离', () => {
    expect(reasoningEffortFor([UNKNOWN], UNKNOWN, 'max')).toBeUndefined()
    expect(reasoningEffortFor([K3], UNKNOWN, 'max')).toBeUndefined()
  })
  it('reasoningEffortFor：目标仅支持 off（非推理模型）→ 剥离', () => {
    expect(reasoningEffortFor([NON_REASONING], NON_REASONING, 'max')).toBeUndefined()
  })
  it('reasoningEffortFor：继承等级为 off → 剥离', () => {
    expect(reasoningEffortFor([K3], K3, 'off')).toBeUndefined()
    expect(reasoningEffortFor([K3], K3, undefined)).toBeUndefined()
  })
  it('applyTo：路由到 k3 保留 max；路由到 highspeed 钳制为 high', () => {
    const r = new KimiRouter(cfg('capability'), [K3, HIGHSPEED, ...METAS], log)
    const base = { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' }
    const toK3 = r.applyTo(base, { kind: 'route', target: { provider: 'kimi-coding', model: 'k3' }, reason: 'x', via: 'default' })
    expect(toK3).toEqual({ provider: 'kimi-coding', model: 'k3', reasoningEffort: 'max' })
    const toFast = r.applyTo(base, { kind: 'route', target: { provider: 'kimi-coding', model: 'kimi-for-coding-highspeed' }, reason: 'x', via: 'rule' })
    expect(toFast).toEqual({ provider: 'kimi-coding', model: 'kimi-for-coding-highspeed', reasoningEffort: 'high' })
  })
  it('applyTo：keep/无决策 → 原样返回；目标能力未知 → 剥离 effort', () => {
    const r = new KimiRouter(cfg('capability'), [UNKNOWN, ...METAS], log)
    const base = { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' }
    expect(r.applyTo(base, { kind: 'keep', reason: 'x' })).toBe(base)
    expect(r.applyTo(base, undefined)).toBe(base)
    expect(r.applyTo(base, { kind: 'route', target: { provider: 'kimi-coding', model: 'k3-256k' }, reason: 'x', via: 'default' }))
      .toEqual({ provider: 'kimi-coding', model: 'k3-256k' })
  })
})
