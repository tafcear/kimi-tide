// test/router.test.ts（骨架；消息夹具同 T2）
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONFIG_V4, DEFAULT_CONFIG_V5, DEFAULT_FLOWS,
  type CandidateMeta, type CollaborationFlow, type RouteTarget, type RouterConfigV5, type RouterPreset,
} from '../src/config.js'
import type { ImageStateEntry } from '../src/image-state.js'
import type { ResolvedImage } from '../src/transcribe.js'
import { createStreamVisionCaller, effortForTarget, KimiRouter, reasoningEffortFor, resolveImageFallback } from '../src/router.js'

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
    // 夹具更正（T5，报告备案，同 T4 rules.test.ts 先例）：计划原文「帮我重构这个函数」
    // 命中 code 组 重构+函数 2 词，与本块断言「1 词」不兼容；改等义句（重构×1）。
    expect(r.decide([textMsg('帮我重构这段周报')], 1)).toEqual({
      kind: 'route', target: { provider: 'kimi-coding', model: 'kimi-for-coding' },
      reason: '规则「code」命中 1 词', via: 'rule',
    })
  })
  it('带图（消息含图）→ image 规则', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    const d = r.decide([imageMsg()], 1)
    expect(d).toMatchObject({ kind: 'route', target: { provider: 'kimi-coding', model: 'k3' }, via: 'rule' })
  })
  it('v4 存量（无 flows 注册表）：flow 目标按「不存在」跳过，降级到后续模型规则（行为保持）', () => {
    const c = cfg('saving')
    c.presets.saving.rules.unshift({ id: 'flow-first', when: { kind: 'image' }, target: { flow: 'transcribe' } })
    const r = new KimiRouter(c, METAS, log)
    // v4 配置没有 flows 注册表 → flow 查找落空 → 跳过，落到下一条 image-k3 规则（0.5.x 行为不变）
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
    // 0.8.0 math 组含「推导」——原「推导这个式子」夹具改无命中说法，钉「未命中→打底」语义
    expect(r.decide([textMsg('给我讲讲这个思路')], 1)).toMatchObject({ via: 'default', target: { model: 'k3' } })
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

/* ---- Task 8：flow 规则目标决策 + resolveImageFallback 四态 ---- */

const VISION_METAS: CandidateMeta[] = [
  ...METAS,
  { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', modalities: ['text', 'image'], available: true },
]
const cfg5 = (active: string | null): RouterConfigV5 => { const c = DEFAULT_CONFIG_V5(); c.activePreset = active; return c }
/** saving 预设队首插入 image → {flow} 规则的 v5 配置。 */
const cfg5WithFlowRule = (flowId: string): RouterConfigV5 => {
  const c = cfg5('saving')
  c.presets.saving.rules.unshift({ id: 'flow-first', when: { kind: 'image' }, target: { flow: flowId } })
  return c
}

describe('flow 规则目标决策（Task 8）', () => {
  it('flow 存在 + transcribe 型 + visionModel 可用 → flow 决策（via:rule）', () => {
    const c = cfg5WithFlowRule('transcribe')
    const r = new KimiRouter(c, VISION_METAS, log)
    expect(r.decide([imageMsg()], 1)).toEqual({
      kind: 'flow', flowId: 'transcribe', flow: c.flows.transcribe,
      reason: '规则「带图」命中（协作流 transcribe）', via: 'rule',
    })
  })
  it('flow 不存在 → 跳过该规则，降级到后续模型规则', () => {
    const r = new KimiRouter(cfg5WithFlowRule('ghost'), VISION_METAS, log)
    expect(r.decide([imageMsg()], 1)).toMatchObject({
      kind: 'route', target: { provider: 'kimi-coding', model: 'k3' }, via: 'rule',
    })
  })
  it('flow 类型为 review → 跳过该规则降级（P1 仅 transcribe 可作规则目标）', () => {
    const r = new KimiRouter(cfg5WithFlowRule('review'), VISION_METAS, log)
    expect(r.decide([imageMsg()], 1)).toMatchObject({
      kind: 'route', target: { provider: 'kimi-coding', model: 'k3' }, via: 'rule',
    })
  })
  it('visionModel 不可用 → 跳过该规则降级（与模型目标不可用的降级语义一致）', () => {
    const metas = VISION_METAS.map((m) =>
      m.model === 'deepseek-v4-flash-vision-exp' ? { ...m, available: false } : m)
    const r = new KimiRouter(cfg5WithFlowRule('transcribe'), metas, log)
    expect(r.decide([imageMsg()], 1)).toMatchObject({
      kind: 'route', target: { provider: 'kimi-coding', model: 'k3' }, via: 'rule',
    })
  })
  it('visionModel 不在候选目录 → 跳过该规则降级（不宽容劫持，目录须读得到且可用）', () => {
    const r = new KimiRouter(cfg5WithFlowRule('transcribe'), METAS, log)
    expect(r.decide([imageMsg()], 1)).toMatchObject({
      kind: 'route', target: { provider: 'kimi-coding', model: 'k3' }, via: 'rule',
    })
  })
  it('v5 存量行为保持：flows 预置未绑定时 decide 与 v4 逐字节一致', () => {
    const r = new KimiRouter(cfg5('saving'), METAS, log)
    // 夹具更正（T5，报告备案）：同上——「帮我重构这个函数」命中 2 词，改等义句（重构×1）。
    expect(r.decide([textMsg('帮我重构这段周报')], 1)).toEqual({
      kind: 'route', target: { provider: 'kimi-coding', model: 'kimi-for-coding' },
      reason: '规则「code」命中 1 词', via: 'rule',
    })
    expect(r.decide([imageMsg()], 1)).toEqual({
      kind: 'route', target: { provider: 'kimi-coding', model: 'k3' },
      reason: '规则「带图」命中', via: 'rule',
    })
    expect(r.decide([textMsg('今天天气不错')], 1)).toEqual({
      kind: 'route', target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      reason: '预设「省钱」默认', via: 'default',
    })
  })
})

describe('resolveImageFallback 四态（Task 8）', () => {
  const T1 = { provider: 'kimi-coding', model: 'k3' }
  const T2 = { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' }
  const FLOWS = DEFAULT_FLOWS()
  const preset = (over: Partial<RouterPreset>): RouterPreset => ({
    name: '测试', default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, rules: [], ...over,
  })
  const nativeOf = (...entries: ImageStateEntry[]): Array<readonly [string, ImageStateEntry]> =>
    entries.map((e, i) => [`att-${i}`, e] as const)

  it('native 为空 → null（latch/blind/transcribe-lazy 一致短路）', () => {
    expect(resolveImageFallback(preset({}), FLOWS, [])).toBeNull()
    expect(resolveImageFallback(preset({ imageFallback: 'latch' }), FLOWS, [])).toBeNull()
    expect(resolveImageFallback(preset({ imageFallback: 'blind' }), FLOWS, [])).toBeNull()
    expect(resolveImageFallback(preset({ imageFallback: 'transcribe-lazy' }), FLOWS, [])).toBeNull()
  })
  it('imageFallback 缺席 → 按 latch：取 native 列表末位（最近）的 latchTarget', () => {
    const native = nativeOf({ state: 'native', latchTarget: T1 }, { state: 'native', latchTarget: T2 })
    expect(resolveImageFallback(preset({}), FLOWS, native)).toEqual({ kind: 'latch', target: T2 })
    expect(resolveImageFallback(preset({ imageFallback: 'latch' }), FLOWS, native)).toEqual({ kind: 'latch', target: T2 })
  })
  it('latch：末位条目 latchTarget 缺席 → null（不回溯更早条目）', () => {
    const native = nativeOf({ state: 'native', latchTarget: T1 }, { state: 'native' })
    expect(resolveImageFallback(preset({ imageFallback: 'latch' }), FLOWS, native)).toBeNull()
  })
  it('blind → { kind: blind }（不消费 latchTarget）', () => {
    const native = nativeOf({ state: 'native', latchTarget: T1 })
    expect(resolveImageFallback(preset({ imageFallback: 'blind' }), FLOWS, native)).toEqual({ kind: 'blind' })
  })
  it('transcribe-lazy：imageFallbackFlow 缺席 → 解析预置 transcribe 流', () => {
    const native = nativeOf({ state: 'native', latchTarget: T1 })
    expect(resolveImageFallback(preset({ imageFallback: 'transcribe-lazy' }), FLOWS, native))
      .toEqual({ kind: 'lazy', flowId: 'transcribe', flow: FLOWS.transcribe })
  })
  it('transcribe-lazy：显式 imageFallbackFlow 解析指定流', () => {
    const flows: Record<string, CollaborationFlow> = {
      ...FLOWS,
      tc2: { type: 'transcribe', visionModel: T2, failurePolicy: 'blind' },
    }
    const native = nativeOf({ state: 'native', latchTarget: T1 })
    expect(resolveImageFallback(preset({ imageFallback: 'transcribe-lazy', imageFallbackFlow: 'tc2' }), flows, native))
      .toEqual({ kind: 'lazy', flowId: 'tc2', flow: flows.tc2 })
  })
  it('transcribe-lazy：flow 不存在或类型非 transcribe → null', () => {
    const native = nativeOf({ state: 'native', latchTarget: T1 })
    expect(resolveImageFallback(preset({ imageFallback: 'transcribe-lazy', imageFallbackFlow: 'ghost' }), FLOWS, native)).toBeNull()
    expect(resolveImageFallback(preset({ imageFallback: 'transcribe-lazy', imageFallbackFlow: 'review' }), FLOWS, native)).toBeNull()
  })
})

describe('决策原因词数（0.8.0）', () => {
  it('单命中：reason 带词数；多命中：加（特异度最高）', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    // 夹具更正（T5，报告备案，同 T4 先例）：计划原文「帮我重构这个函数」命中 code 组
    // 重构+函数 2 词，与本块断言「1 词」不兼容；改等义句（重构×1，saving 无 writing 规则）。
    expect(r.decide([textMsg('帮我重构这段周报')], 1).reason).toBe('规则「code」命中 1 词')
    const c = cfg('capability')
    const r2 = new KimiRouter(c, METAS, log)
    const d = r2.decide([textMsg('帮我总结这次重构，顺便写个测试')], 1)
    expect(d.reason).toBe('规则「code」命中 2 词（特异度最高）')
  })
  it('image 规则：不带词数（∞ 无语义）', () => {
    const r = new KimiRouter(cfg('saving'), METAS, log)
    expect(r.decide([imageMsg()], 1).reason).toBe('规则「带图」命中')
  })
})

describe('effortForTarget / replaceRoute（0.8.0）', () => {
  const K3 = { provider: 'kimi-coding', model: 'k3', modalities: ['text', 'image'], available: true, reasoningEfforts: ['low', 'high', 'max'] }
  const FLASH = { provider: 'deepseek-official', model: 'deepseek-v4-flash', modalities: ['text'], available: true, reasoningEfforts: ['off'] }
  const UNKNOWN = { provider: 'kimi-coding', model: 'k3-256k', modalities: ['text', 'image'], available: true }

  it('显式 effort 支持 → 覆盖继承值；不支持/能力未知 → 剥离（不钳制）', () => {
    expect(effortForTarget([K3], K3, 'low', 'max')).toBe('max')
    expect(effortForTarget([K3], K3, undefined, 'low')).toBe('low')
    expect(effortForTarget([K3], K3, 'low', 'xhigh')).toBeUndefined()
    expect(effortForTarget([UNKNOWN], UNKNOWN, 'low', 'max')).toBeUndefined()
    expect(effortForTarget([FLASH], FLASH, undefined, 'max')).toBeUndefined()
    expect(effortForTarget([K3], K3, undefined, undefined)).toBeUndefined()
  })
  it('无显式 effort → 继承语义不变（reasoningEffortFor 全量回归）', () => {
    expect(effortForTarget([K3], K3, 'max', undefined)).toBe('max')
    expect(effortForTarget([K3], K3, 'xhigh', undefined)).toBe('high')  // 越级钳制
    expect(effortForTarget([FLASH], FLASH, 'max', undefined)).toBeUndefined()  // 仅 off → 剥离
  })
  it('replaceRoute：规则 target.effort=max 覆盖继承 low；护栏目标（无 effort）保持继承钳制', () => {
    const r = new KimiRouter(cfg('saving'), [K3, FLASH, ...METAS], log)
    const base = { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' }
    expect(r.replaceRoute(base, { provider: 'kimi-coding', model: 'k3', effort: 'max' }))
      .toEqual({ provider: 'kimi-coding', model: 'k3', reasoningEffort: 'max' })
    expect(r.replaceRoute(base, { provider: 'kimi-coding', model: 'k3' }))
      .toEqual({ provider: 'kimi-coding', model: 'k3', reasoningEffort: 'low' })
  })
})

describe('createStreamVisionCaller effort 注入（0.8.0 M6）', () => {
  it('visionModel.effort 支持 → options.reasoningEffort 携带；不支持/未配置 → 不携带', async () => {
    const stream = vi.fn(async function* () { yield { type: 'finish' as const, reason: { kind: 'stop' as const } } })
    const ctx = { llm: { stream } } as never
    const resolveEfforts = (t: RouteTarget) => t.model === 'vision-exp' ? ['low', 'high'] : undefined
    const caller = createStreamVisionCaller(ctx, resolveEfforts)
    const images: ResolvedImage[] = [{ attachmentId: 'a1', ref: {} }]
    await caller({ provider: 'deepseek-official', model: 'vision-exp', effort: 'high' }, 'p', images)
    expect(stream.mock.calls[0][0]).toMatchObject({ provider: 'deepseek-official', model: 'vision-exp', reasoningEffort: 'high' })
    await caller({ provider: 'deepseek-official', model: 'vision-exp', effort: 'max' }, 'p', images)
    expect(stream.mock.calls[1][0].reasoningEffort).toBeUndefined()
    await caller({ provider: 'deepseek-official', model: 'vision-exp' }, 'p', images)
    expect(stream.mock.calls[2][0].reasoningEffort).toBeUndefined()
  })
})
