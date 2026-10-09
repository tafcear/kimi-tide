/**
 * 派发护栏执行面探测（probeGuardFace）的回归钉。
 *
 * 牙口（2026-10-09 真机回归，d749c4c 引入）：宿主 `tools.guard` 是**用 this
 * 的方法**（`@deepseek-ai/dsh-tools/lib/index.js:2921`——方法体读 `this.ctx`
 * 与 `this.layers.effect`）。探测时把方法**摘出来当裸引用**带出（旧写法
 * `guard: tools.guard as …`），调用方再调会丢 `this` ⇒
 * `TypeError: Cannot read properties of undefined (reading 'effect')` ⇒
 * 注册抛错归 `register-failed` ⇒ 开关开着而护栏静默装不上（dock 显示
 * 「未在岗（注册失败）」）。本文件第一组用例造一个与宿主**同形**（guard
 * 方法体走 this）的假件，钉死「ready 面带出的调用器必须保住接收者」。
 *
 * 其余用例钉三态语义（ready / no-tools / no-guard）与「探测绝不抛」红线。
 */
import { describe, expect, it } from 'vitest'
import { probeGuardFace } from '../src/guard-status.js'
import type { ToolGuardFn } from '../src/index.js'

/**
 * 宿主形状的 tools 假件：`guard` 是**用 this 的方法**，与
 * `@deepseek-ai/dsh-tools/lib/index.js:2921` 同形——方法体经
 * `this.layers.effect(this.ctx, …)` 把 check 追加进注册表。裸引用调用
 * （this 丢失）会在 `.effect` 上抛 TypeError，正是本次回归的故障形态。
 */
function hostLikeTools() {
  const registry: ToolGuardFn[] = []
  const svc = {
    ctx: {},
    layers: {
      effect(_ctx: unknown, cb: (layer: { guards: { append: (g: ToolGuardFn) => void } }) => unknown): () => void {
        cb({ guards: { append: (g: ToolGuardFn) => { registry.push(g) } } })
        return () => {}
      },
    },
    guard(check: ToolGuardFn): () => void {
      return this.layers.effect(this.ctx, (layer) => layer.guards.append(check))
    },
  }
  return { svc, registry }
}

describe('probeGuardFace（this 假件：ready 面必须保住接收者）', () => {
  it('宿主形状假件（guard 用 this）⇒ ready，调用不抛且 check 真的落进注册表', () => {
    const { svc, registry } = hostLikeTools()
    const face = probeGuardFace({ get: () => svc })
    expect(face.state).toBe('ready')
    if (face.state !== 'ready') return
    const check: ToolGuardFn = () => undefined
    // 旧写法（裸方法引用）在这里抛 TypeError: Cannot read properties of
    // undefined (reading 'effect') —— 本用例即牙口。
    expect(() => face.guard(check)).not.toThrow()
    // 走 this 的那条路径被真的走到：check 进了假件注册表
    expect(registry).toEqual([check])
  })

  it('注册返回的 disposer 原样带出（宿主契约：guard 的返回值即注销面）', () => {
    const { svc } = hostLikeTools()
    const face = probeGuardFace({ get: () => svc })
    if (face.state !== 'ready') throw new Error('预期 ready')
    const dispose = face.guard(() => undefined)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
  })
})

describe('probeGuardFace（三态语义与「绝不抛」红线）', () => {
  it('tools 服务缺席（undefined / null / 连 get 都没有）⇒ no-tools', () => {
    expect(probeGuardFace({ get: () => undefined })).toEqual({ state: 'no-tools' })
    expect(probeGuardFace({ get: () => null })).toEqual({ state: 'no-tools' })
    expect(probeGuardFace({})).toEqual({ state: 'no-tools' })
  })

  it('tools 在但 guard 不是函数 ⇒ no-guard', () => {
    expect(probeGuardFace({ get: () => ({}) })).toEqual({ state: 'no-guard' })
    expect(probeGuardFace({ get: () => ({ guard: 42 }) })).toEqual({ state: 'no-guard' })
  })

  it('get 自身抛错 ⇒ 吞成 no-tools，绝不冒泡', () => {
    const ctx = { get: () => { throw new Error('boom') } }
    expect(probeGuardFace(ctx)).toEqual({ state: 'no-tools' })
  })

  it('cordis 形态（属性访问即抛）⇒ 经 get 正常取到并保住接收者', () => {
    const { svc, registry } = hostLikeTools()
    const ctx = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'get') return (name: string) => (name === 'tools' ? svc : undefined)
        throw new Error(`cannot get property "${String(prop)}" without inject`)
      },
    })
    const face = probeGuardFace(ctx)
    expect(face.state).toBe('ready')
    if (face.state !== 'ready') return
    const check: ToolGuardFn = () => undefined
    face.guard(check)
    expect(registry).toEqual([check])
  })
})
