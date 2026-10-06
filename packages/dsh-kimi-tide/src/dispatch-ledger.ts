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
    // 按父会话收口：该会话超出 CAP 时淘汰其最旧一条（O(n) 扫描——n ≤ 20×会话数
    // （含历史会话，父会话 dispose 时经 dropSession 即清名下条目，无残留），
    // 量级可忽略）。
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

  /**
   * 父会话销毁时清掉其名下全部条目（agent/disposed 接线用，入参 = 被销毁 agent 的 id）。
   * 口径按 **parentSession** 而非 agentId：记账的 agentId 是子代理自身 id，而面板按
   * 父会话过滤——子代理「干完即销毁」若按 agentId 清，会把它刚写进父会话面板的行
   * 一并删掉（实机缺陷：派发区永远为空）。子代理销毁时其 id 不等于任何 parentSession
   * （除非它自己又派发了孙代理，彼时清掉孙代理行正合语义），父会话行自然保留。
   */
  dropSession(sessionId: string): void {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i]!.parentSession === sessionId) this.entries.splice(i, 1)
  }
}
