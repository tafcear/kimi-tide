// src/client/effort-remote.ts — 客户端半链（0.8.0）：$mount 手工贡献 + 调用面。
// 与宿主侧 src/effort-catalog.ts 的 descriptor 逐字段一致（同一 endpoint）。
// 2026-08-27 实机验收 B5 缺陷修复：客户端 kernel（dsh-api-gateway client.js
// requireStrictDescriptor）强制 result 为 strict codec——src-json 只被宿主半链
// 容忍，客户端挂载即抛 "field \"result\" has no strict codec"，档位下拉全体禁用。
// 档位表是纯 JSON（Record<string, string[]>），strict codec 恒等解码即可。
import type { RemoteResult, TypertCodec, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

const EFFORT_CATALOG_RESULT_CODEC = {
  mode: 'strict',
  typeSymbol: 'Record<string, string[]>',
  schema: {
    parse: (value: unknown): Record<string, string[]> => value as Record<string, string[]>,
  },
} as const satisfies TypertCodec

export const EFFORT_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: 'dsh-kimi-tide',
  descriptors: [{
    id: 'dsh-kimi-tide#effortCatalog',
    service: 'kimi-tide.catalog',
    namespace: 'kimiTide',
    method: 'effortCatalog',
    invocation: { kind: 'direct' },
    parameters: [],
    result: EFFORT_CATALOG_RESULT_CODEC,
  }],
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    kimiTide: {
      effortCatalog(): Promise<RemoteResult<Record<string, string[]>>>
    }
  }
}

export type EffortCatalogFetcher = () => Promise<Record<string, string[]>>

/**
 * $mount 贡献并返回取数闭包。挂载失败/调用失败一律 reject——调用方
 * （client/index.ts）捕获后降级为空表（卡片显示「跟随默认」禁用态）。
 */
export async function mountEffortCatalog(remote: {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>
} & Record<'kimiTide', { effortCatalog(): Promise<RemoteResult<Record<string, string[]>>> }>): Promise<EffortCatalogFetcher> {
  await remote.$mount(EFFORT_REMOTE_CONTRIBUTION)
  return async () => {
    const result = await remote.kimiTide.effortCatalog()
    if (!result.ok) throw new Error(`effort 档位目录取数失败：${result.error.message}`)
    return result.value
  }
}
