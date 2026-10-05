/**
 * 派发台账（设计稿 D7）。
 * 插件级、活过路由器配置重挂载（对照 imageStates，`index.ts` apply 作用域）、不落盘、
 * 不跨宿主重启。用可枚举的全局数组按写入序保存（面板按父会话聚合，WeakMap 不可枚举）；
 * 条目只存字符串 id，不持 Agent 引用。
 *
 * 收口口径：**每个父会话各保留最近 20 条**（与评审/退回投影的「每会话 20 条」同额）——
 * 全局数组只是枚举载体，不按全局条数截断，他会话的记账不挤占本会话名额。
 */
import type { RouteTarget } from './config.js'
import type { DispatchBasis } from './roles.js'

export interface DispatchEntry {
  basis: DispatchBasis
  teammate?: string
  roleLabel?: string
  target: RouteTarget
  at: number
  parentSession?: string
  agentId?: string
}

/** 每个父会话保留的最近条数。 */
const CAP = 20

export class DispatchLedger {
  private readonly entries: DispatchEntry[] = []

  record(entry: DispatchEntry): void {
    this.entries.push(entry)
    // 按父会话收口：该会话超出 CAP 时淘汰其最旧一条（O(n) 扫描——n ≤ 20×存活会话数，量级可忽略）。
    let count = 0
    for (const e of this.entries) if (e.parentSession === entry.parentSession) count++
    if (count > CAP) {
      const oldest = this.entries.findIndex((e) => e.parentSession === entry.parentSession)
      if (oldest >= 0) this.entries.splice(oldest, 1)
    }
  }

  /** 某会话（通常 = Lead 会话 id）名下的最近 20 条，最新在前；每次调用返回新数组。 */
  recentFor(sessionId: string): DispatchEntry[] {
    return this.entries.filter((e) => e.parentSession === sessionId).reverse()
  }

  dropAgent(agentId: string): void {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i]!.agentId === agentId) this.entries.splice(i, 1)
  }
}
