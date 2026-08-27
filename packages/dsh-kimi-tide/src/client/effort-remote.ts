// src/client/effort-remote.ts — 客户端半链（0.8.0）：$mount 手工贡献 + 调用面。
// 与宿主侧 src/effort-catalog.ts 的 descriptor 逐字段一致（同一 endpoint）。
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

export const EFFORT_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: 'dsh-kimi-tide',
  descriptors: [{
    id: 'dsh-kimi-tide#effortCatalog',
    service: 'kimi-tide.catalog',
    namespace: 'kimiTide',
    method: 'effortCatalog',
    invocation: { kind: 'direct' },
    parameters: [],
    result: { mode: 'src-json' },
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
