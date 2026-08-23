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

  /**
   * 把缓存背书落空（transcriber LRU 逐出）的 transcribed 条目降级回 native
   * （评审修复 2026-08-23：进程级 LRU 与 per-agent 状态表容量脱节——逐出后
   * llm/stream 投影 peek 落空，图块原样进 text-only 请求）。latchTarget 随
   * 条目保留（latch 不回溯更早条目，条目必须自带 latchTarget 才可改道）。
   * 返回被降级的 attachmentId（插入序），供调用方观测。
   */
  demoteUnbackedTranscribed(agent: Agent, backed: (attachmentId: string) => boolean): string[] {
    const table = this.perAgent.get(agent)
    if (!table) return []
    const demoted: string[] = []
    for (const [id, entry] of table) {
      if (entry.state !== 'transcribed' || backed(id)) continue
      table.set(id, { ...entry, state: 'native' })
      demoted.push(id)
    }
    return demoted
  }

  counts(agent: Agent): { native: number; transcribed: number; blind: number } {
    const table = this.perAgent.get(agent)
    const counts = { native: 0, transcribed: 0, blind: 0 }
    if (!table) return counts
    for (const entry of table.values()) counts[entry.state]++
    return counts
  }
}
