import type { Agent } from '@deepseek-ai/dsh-agent'
import type { RouteTarget } from './config.js'

/** 单图处理态：native = 视觉模型原生处理；transcribed = 转写为文本；blind = 当无图。 */
export type ImageHandling = 'native' | 'transcribed' | 'blind'

export interface ImageStateEntry {
  state: ImageHandling
  /** 仅 native 态有意义：该图 native 化时的视觉改道目标。 */
  latchTarget?: RouteTarget
}

/**
 * 按 agent 隔离的 per-image 三态状态表（0.6.0 协作编排：布尔锁存的替代基元）。
 * WeakMap 键 = Agent 实例（引用语义，不阻止 GC）；值 = attachmentId → 条目。
 * Task 8（imageFallback）/ Task 9（转述接线）消费。
 */
export class ImageStateStore {
  private readonly perAgent = new WeakMap<Agent, Map<string, ImageStateEntry>>()

  /** 记录/覆盖单图状态；mark 整体替换条目——覆盖为 transcribed/blind 时未传 latchTarget 即清除。 */
  mark(agent: Agent, attachmentId: string, state: ImageHandling, latchTarget?: RouteTarget): void {
    let table = this.perAgent.get(agent)
    if (!table) {
      table = new Map()
      this.perAgent.set(agent, table)
    }
    table.set(attachmentId, { state, latchTarget })
  }

  get(agent: Agent, attachmentId: string): ImageStateEntry | undefined {
    return this.perAgent.get(agent)?.get(attachmentId)
  }

  /** 仅 native 态条目，保持插入序（Map 迭代序）；「最近 native」= 末位（调用方取）。 */
  native(agent: Agent): Array<readonly [string, ImageStateEntry]> {
    const table = this.perAgent.get(agent)
    if (!table) return []
    const out: Array<readonly [string, ImageStateEntry]> = []
    for (const [id, entry] of table) {
      if (entry.state === 'native') out.push([id, entry])
    }
    return out
  }

  counts(agent: Agent): { native: number; transcribed: number; blind: number } {
    const table = this.perAgent.get(agent)
    const counts = { native: 0, transcribed: 0, blind: 0 }
    if (!table) return counts
    for (const entry of table.values()) counts[entry.state]++
    return counts
  }
}
