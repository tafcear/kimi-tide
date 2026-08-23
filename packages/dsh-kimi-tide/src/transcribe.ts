// src/transcribe.ts — 转述器：图像→文字转述核心引擎
// VisionCaller 缝（生产组装在 Task 9）+ LRU 成功缓存 + 失败不重打。
import type { RouteTarget, TranscribeFlow } from './config.js'

/**
 * Ruling 1（控制端已裁定）：图块是持久引用，ref=ImageAttachmentRef。
 * 本层 opaque——转述器不解包、不改写，VisionCaller 直传 ref 构造
 * `{type:'image', attachment: ref}`，不需要 bytes/mimeType。
 */
export interface ResolvedImage { attachmentId: string; ref: unknown }

/**
 * 视觉调用缝：把若干图块按 prompt 送 target 模型，返回转述文字。
 * `signal`（I-2）：调用方的中止/有界超时信号，实现方须透传到底层流调用；
 * 中止 reject 与 throw 同语义——记入失败集，同图不重打。
 */
export type VisionCaller = (
  target: RouteTarget,
  prompt: string,
  images: readonly ResolvedImage[],
  signal?: AbortSignal,
) => Promise<string>

/**
 * spec §5.5 T2 实证基线提示词（flows.transcribe.prompt 可覆盖）。
 * 语义要素：逐字保留全部文字（含堆栈帧/行号/高亮颜色语义）+ 结构关系 +
 * 关键视觉细节 + 用途声明（供看不到图的文本模型接力）+ 不确定处标注。
 */
export const DEFAULT_TRANSCRIBE_PROMPT: string = [
  '你将看到一张或多张图片。请把它们转述为详实的文字，供一个看不到图的文本模型接力使用——它只能读到你的转述，请确保仅凭文字即可还原图片的关键信息。要求：',
  '1. 逐字保留图中的全部文字，不得概括或省略；若是报错截图，堆栈帧逐字抄录，保留行号，并说明高亮/颜色的语义（例如红色高亮的是哪一行）。',
  '2. 描述结构关系：组件层级、布局位置、元素之间的连接与从属。',
  '3. 记录关键视觉细节：颜色、形状、状态（选中/禁用/报错态）等影响理解的视觉信息。',
  '4. 不确定或看不清的地方明确标注「不确定」，不要编造。',
].join('\n')

/** 成功缓存默认容量（attachmentId → 转述文字）。 */
const DEFAULT_CACHE_CAP = 64

/**
 * 转述器。
 * - 成功结果按 attachmentId 缓存（LRU，超 cap 逐出最旧；命中刷新热度）；
 * - 失败记入失败集：同图不再重打（caller 抛错只发生一次），text 返回 null；
 *   中止/超时 reject 与 throw 同语义，同样入失败集（I-2）；
 * - peek 仅命中成功缓存，不触发调用、不刷新热度。
 */
export class Transcriber {
  private readonly caller: VisionCaller
  private readonly log: (message: string) => void
  private readonly cacheCap: number
  /** Map 迭代序 = 插入序；命中时 delete+set 移到末尾以刷新热度。 */
  private readonly cache = new Map<string, string>()
  private readonly failed = new Set<string>()

  constructor(deps: { caller: VisionCaller; log?: (message: string) => void; cacheCap?: number }) {
    this.caller = deps.caller
    this.log = deps.log ?? (() => {})
    this.cacheCap = deps.cacheCap ?? DEFAULT_CACHE_CAP
  }

  /** 仅命中成功缓存；失败集与未见的图一律 undefined。 */
  peek(attachmentId: string): string | undefined {
    return this.cache.get(attachmentId)
  }

  /** 转述一张图；失败、已标记失败、空白结果或调用中止（signal reject）返回 null。 */
  async text(flow: TranscribeFlow, image: ResolvedImage, signal?: AbortSignal): Promise<string | null> {
    const id = image.attachmentId
    if (this.failed.has(id)) return null
    const hit = this.cache.get(id)
    if (hit !== undefined) {
      // LRU：命中刷新热度（移到末尾）
      this.cache.delete(id)
      this.cache.set(id, hit)
      return hit
    }
    const prompt = flow.prompt ?? DEFAULT_TRANSCRIBE_PROMPT
    try {
      const out = await this.caller(flow.visionModel, prompt, [image], signal)
      // 空白转述视同失败（评审修复 2026-08-23）：模型空响应若当成功缓存，
      // llm/stream 投影会把图块替换成空字符串，文本模型上下文静默缺一块。
      // 裁决放在本层（缓存所有者）——任何 VisionCaller 实现都受这条不变量保护。
      if (out.trim().length === 0) {
        this.failed.add(id)
        this.log(`transcribe failed: attachmentId=${id} target=${flow.visionModel.provider}/${flow.visionModel.model} error=empty transcription`)
        return null
      }
      this.remember(id, out)
      return out
    } catch (err) {
      this.failed.add(id)
      this.log(`transcribe failed: attachmentId=${id} target=${flow.visionModel.provider}/${flow.visionModel.model} error=${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  private remember(id: string, value: string): void {
    this.cache.delete(id)
    this.cache.set(id, value)
    while (this.cache.size > this.cacheCap) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }
}
