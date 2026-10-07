// @vitest-environment jsdom
/**
 * 评审卡注册接入回归锁（1.1.0 A6 实机缺陷，2026-09-04）。
 *
 * 实机缺陷：bundle 装载时序下 uiConversation 服务晚于本插件 client apply
 * （dsh-web-app 系服务异步就绪）——一次性守卫读 `ctx.get('uiConversation')`
 * 得 undefined 后静默放弃，评审事件永不折叠成 chat 节点。实机证据：host 侧
 * 已投影 kimi-tide/review 事件（session jsonl seq 12387，reviewer k3，含
 * 问题/结论结构），但会话流刷新后仍无评审卡；控制台零报错。
 *
 * 修复契约：服务就绪 → 立即注册（原路径不变）；服务缺席 → 必须经
 * ctx.inject(['uiConversation'], cb) 延迟驱动补注册（better-sidebar
 * L3830 先例同款），不允许静默放弃。每个用例注释标注「会使其失败的生产改动」。
 */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'
import { REVIEW_NODE_KIND, REVISE_NODE_KIND } from '../src/client/ReviewCard.js'

type RegisterSpy = ReturnType<typeof vi.fn>

interface FakeCtxOptions {
  uiConversation?: {
    events: { register: RegisterSpy }
  }
  onInject?: (deps: string[], callback: (lateCtx: FakeCtx) => void) => unknown
}

interface FakeCtx {
  get: (key: string) => unknown
  effect: (fn: () => unknown) => unknown
  inject?: (deps: string[], callback: (lateCtx: FakeCtx) => void) => unknown
  slots: {
    inject: (key: string, callback: () => unknown) => void
    register: (spec: unknown, component: unknown) => unknown
  }
  remote: { commands: { execute: () => Promise<unknown> } }
}

function makeFace(): { events: { register: RegisterSpy } } {
  return { events: { register: vi.fn(() => () => {}) } }
}

function makeCtx(opts: FakeCtxOptions = {}): FakeCtx {
  const slotsInjected: Record<string, unknown> = {}
  const ctx: FakeCtx = {
    get: (key: string) => (key === 'uiConversation' ? opts.uiConversation : undefined),
    effect: (fn) => fn(),
    ...(opts.onInject === undefined ? {} : { inject: opts.onInject }),
    slots: {
      inject: (key, callback) => {
        slotsInjected[key] = callback
      },
      register: vi.fn(),
    },
    remote: { commands: { execute: () => Promise.resolve({}) } },
  }
  void slotsInjected
  return ctx
}

describe('client apply：评审卡注册接入（A6 实机缺陷回归锁）', () => {
  it('uiConversation 已就绪：立即注册 review + revise 两个 Definition（原路径不回退）', () => {
    const face = makeFace()
    const ctx = makeCtx({ uiConversation: face })
    apply(ctx as never)
    // Fails if: 就绪路径不再立即注册（延迟到 inject 才注册也算合规但必须注册）；
    //           v1.4.0 起是**两个** Definition（评审卡 + 退回卡），少一个即退回事件
    //           落 JsonBlock 兜底而不是退回卡。
    expect(face.events.register).toHaveBeenCalledTimes(2)
    const kinds = face.events.register.mock.calls.map((call) => (call[0] as { kind?: string }).kind)
    expect(kinds).toContain(REVIEW_NODE_KIND)
    expect(kinds).toContain(REVISE_NODE_KIND)
  })

  it('uiConversation 缺席：必须 ctx.inject(["uiConversation"], cb) 延迟驱动，不得静默放弃', () => {
    const onInject = vi.fn()
    const ctx = makeCtx({ onInject })
    apply(ctx as never)
    // Fails if: apply 在服务缺席时既不立即注册也不挂延迟驱动（实机缺陷本体）
    // 阶段 P 起 apply 还会为 locale 服务挂同款延迟驱动（attachLocaleService），
    // 故按「存在 ['uiConversation'] 这次调用」断言，不再钉死调用总数。
    const injectedDeps = onInject.mock.calls.map((call) => call[0])
    expect(injectedDeps).toContainEqual(['uiConversation'])
  })

  it('延迟回调执行时服务已就绪：完成注册且经 effect 挂 fiber（停用可反注销）', () => {
    let captured: ((lateCtx: FakeCtx) => void) | null = null
    const ctx = makeCtx({
      onInject: (deps, callback) => {
        void deps
        captured = callback
      },
    })
    apply(ctx as never)

    const face = makeFace()
    const lateEffects: Array<() => unknown> = []
    const lateCtx: FakeCtx = {
      get: (key) => (key === 'uiConversation' ? face : undefined),
      effect: (fn) => {
        lateEffects.push(fn)
        return fn()
      },
      slots: ctx.slots,
      remote: ctx.remote,
    }
    captured?.(lateCtx)
    // Fails if: 延迟回调拿到服务却不注册（或注册不经 effect——fiber 卸载无法反注销）
    expect(face.events.register).toHaveBeenCalledTimes(2)
    expect(lateEffects.length).toBe(1)
  })

  it('两条路径都缺席（极旧宿主）：不抛错、不阻塞激活', () => {
    const ctx = makeCtx({})
    expect(() => apply(ctx as never)).not.toThrow()
  })

  it('无论服务状态如何，chat.node keyed 渲染器槽位都注册（与 a) 相互独立）', () => {
    const ctx = makeCtx({})
    const seen: Array<{ key: string; spec?: { id?: string; name?: string } }> = []
    ;(ctx.slots as unknown as { inject: (key: string, cb: () => unknown) => void }).inject = (key, callback) => {
      seen.push({ key })
      void callback
    }
    apply(ctx as never)
    // Fails if: 槽位注册被服务状态牵连（b) 必须独立成立）
    expect(seen.map((s) => s.key)).toContain('conversation.chat.node')
  })

  it('月汐行挂到输入工具行右端（v1.5.0 位置调整），不再占 composer 下方整行', () => {
    const ctx = makeCtx({})
    const registered: Array<{ slot: string; spec: { id?: string; name?: string; inject?: () => unknown } }> = []
    ;(ctx.slots as unknown as {
      inject: (key: string, cb: () => unknown) => void
      register: (spec: unknown, component: unknown) => unknown
    }).inject = (key, callback) => { void callback; void key }
    ctx.slots.register = (spec) => { registered.push({ slot: 'x', spec: spec as never }); return () => {} }
    // inject 回调里 register 才是真的注册点：把 inject 变成立即执行并把 slot 名带上
    ;(ctx.slots as unknown as { inject: (key: string, cb: () => unknown) => void }).inject = (key, callback) => {
      const inner = ctx.slots.register
      ctx.slots.register = (spec) => { registered.push({ slot: key, spec: spec as never }); return () => {} }
      callback()
      ctx.slots.register = inner
    }
    apply(ctx as never)

    const dock = registered.find((r) => r.spec.id === 'kimi-tide')
    // Fails if: 又挪回 composer.dock（占下方一整行）或丢了紧凑态 variant
    expect(dock?.slot).toBe('conversation.input.right')
    expect(dock?.spec.inject?.()).toEqual({ variant: 'compact' })
  })
})
