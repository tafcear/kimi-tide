import { describe, expect, it } from 'vitest'
import { EFFORT_REMOTE_CONTRIBUTION, mountEffortCatalog } from '../src/client/effort-remote.js'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

// 2026-08-27 实机验收 B5 缺陷回归：客户端 $mount 的 descriptor 会被 dsh-api-gateway
// 客户端 kernel 以「result 必须 strict codec」强校验（client.js requireStrictCodec 镜像）。
// src-json 只被宿主半链容忍——本测试把 kernel 同款校验钉死在仓库里，防再次回退。

function requireStrictResult(descriptor: InvocationDescriptor): void {
  const codec = descriptor.result as { mode: string; schema?: { parse?: unknown } }
  if (codec.mode !== 'strict' || typeof codec.schema?.parse !== 'function') {
    throw new Error(
      `client api: generated Remote ${descriptor.namespace}/${descriptor.method} field "result" has no strict codec`,
    )
  }
}

describe('effort-remote 客户端半链（实机验收 B5 缺陷回归）', () => {
  it('descriptor result 必须过 kernel strict 校验（src-json 在客户端被拒）', () => {
    for (const descriptor of EFFORT_REMOTE_CONTRIBUTION.descriptors) {
      expect(() => requireStrictResult(descriptor)).not.toThrow()
    }
  })

  it('strict codec parse 对纯 JSON 档位表做恒等解码', () => {
    const descriptor = EFFORT_REMOTE_CONTRIBUTION.descriptors[0]
    const codec = descriptor.result as { mode: 'strict'; schema: { parse: (v: unknown) => unknown } }
    const table = { 'kimi-coding/k3': ['low', 'high', 'max'] }
    expect(codec.schema.parse(table)).toEqual(table)
  })

  it('mount 贡献后取数闭包走 RemoteResult ok 分支', async () => {
    const mounted: unknown[] = []
    const table = { 'kimi-coding/k3': ['low', 'high', 'max'] }
    const remote = {
      async $mount(contribution: unknown) {
        mounted.push(contribution)
        return async () => {}
      },
      kimiTide: {
        async effortCatalog(): Promise<{ ok: true; value: Record<string, string[]> }> {
          return { ok: true, value: table }
        },
      },
    }
    const fetch = await mountEffortCatalog(remote as never)
    expect(mounted).toHaveLength(1)
    await expect(fetch()).resolves.toEqual(table)
  })
})
