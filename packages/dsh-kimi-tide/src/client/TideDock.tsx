/**
 * TideDock — the 月汐 composer-dock panel, degraded to a read-only dashboard.
 *
 * Task 5（设置界面迁移）：路由设置表单整体迁至官方设置页「月汐」卡片
 * （settings.section，见 SettingsCard）。本 dock 只渲染只读信息。
 * ⑥-B（0365d34/3cc6a6d）：两行布局——r1 身份+路由链、r2 可观测条。
 *
 * ⑥-B 打磨（2026-08-29，用户报告「不居中/弹出推挤/每轮乱跳/emoji 语义不清」）：
 * - 骨架恒定：r1 锁单行（决策原因移出文本流只进 title）、r2 槽位常驻——
 *   决策目标非配额来源时额度/时钟槽置灰「—」占位而非整组消失（⑨ 语义
 *   微调经用户裁定 2026-08-29：结构保留、数据点亮仅限 kimi 目标）；
 * - r2 右端组（时钟/刷新）margin-left:auto 右贴（对比稿欠账补齐）；
 * - 决策面板改 createPortal(document.body) + fixed 悬浮层——开合零文档流
 *   变动；Esc/面板外 mousedown/滚动/缩放关闭；
 * - emoji 全量退役改内联 SVG 图标（icons.tsx）。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { KimiTidePanelProjection } from '../types.js'
import { ReasonPanel } from './ReasonPanel.js'
import { Icon } from './icons.js'

export interface TideDockProps {
  sessionId: string
  /**
   * 旧通道（会话投影）：仍是历史会话的面板数据源，也仍是宿主缺命令通道时的
   * 回退。v1.2.0 起本插件不再写 `kimi-tide/panel` 会话事件，新会话该投影恒为
   * null——故它缺席（undefined）时不阻塞激活。
   */
  useProjection?: (key: 'kimi-tide/panel') => KimiTidePanelProjection | null | undefined
  /**
   * 1.2.0 取数面（dock 拉模型，会话事件解耦）：返回本会话面板快照；路由关闭 /
   * 通道不可用时返回 null。取到即**优先于**投影（现算数据比日志回放新）。
   */
  fetchPanel?: (sessionId: string) => Promise<KimiTidePanelProjection | null>
  /** 测试缝/深链：初始即展开决策可观测面板（默认折叠，点「决策」开）。 */
  defaultExpanded?: boolean
}

/** client/index.ts apply() 注入的真实取数实现（走 remote commands 通道）。 */
export const tideDockPanelSource: { fetch: (sessionId: string) => Promise<KimiTidePanelProjection | null> } = {
  fetch: async () => null,
}

/**
 * 面板取数节流（会话事件解耦后 dock 恒为拉模型）：面板数据是进程级的，配额
 * 轮询 60s 一轮、路由决策按步发生——几秒的轮询延迟不可感知，而每次取数都要过
 * 一次命令 RPC，故不追随每次渲染。
 */
const PANEL_POLL_MS = 8_000

/** Wired in client/index.ts apply(): the dock component calls back into cordis ctx. */
export interface TideDockBridge {
  execute: (sessionId: string, line: string) => Promise<unknown>
}
export const tideDockBridge: TideDockBridge = { execute: async () => undefined }

/** 剥壳后的命令结果：ok=false 时 text 是可展示的失败原因。 */
export interface CommandOutcome {
  ok: boolean
  text: string
}

/**
 * 把命令回包剥成 `{ ok, text }`，线形按新旧全覆盖（2026-09-10 dock 空转根因）：
 *
 * ① rc.1+ typert 远端信封 `{ ok, value }`：value = CommandExecution | undefined
 *    （`{ commandId, result: { kind: 'success'|'error', text } }`）。产品侧同款
 *    读法见 dsh-api-session-controller client.js `command()`（result.ok /
 *    result.value）。**v1.2.0 dock 永远「面板数据加载中」的根因**：旧解析只认
 *    `payload.result.text` / `payload.text`，而信封里这两个字段都不存在——
 *    每次取数都被解析成 null，dock 又不再有投影兜底（新会话无面板事件）。
 * ② 裸 CommandExecution `{ commandId, result }`（宿主直连 / 旧客户端）。
 * ③ 裸 `{ text }` / `{ result: { text } }`（更旧的直连形态与测试替身）。
 * ④ error-only `{ error: { message } }`（0.6.x池#d 形态，无 ok 字段）。
 * ⑤ `{ ok: false, error?: { message } }`（远端拒绝）。
 *
 * 解不出任何已知形态返回 null——调用方走各自的降级分支，不为空值编造状态。
 */
export function unwrapCommandOutcome(payload: unknown): CommandOutcome | null {
  if (payload === null || typeof payload !== 'object') return null
  const envelope = payload as Record<string, unknown>
  if (envelope.ok === false) {
    const error = envelope.error
    const message = typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message)
      : typeof envelope.message === 'string' ? envelope.message : '命令执行失败'
    return { ok: false, text: message }
  }
  if (Object.hasOwn(envelope, 'error')) {
    const error = envelope.error
    const message = typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message)
      : typeof error === 'string' ? error : '命令执行失败'
    return { ok: false, text: message }
  }
  const execution: unknown = Object.hasOwn(envelope, 'value') ? envelope.value : (envelope.result ?? envelope)
  if (execution === null || typeof execution !== 'object') {
    if (typeof envelope.text === 'string') return { ok: true, text: envelope.text }
    // { ok: true, value: undefined }（命令未匹配）= 被识别的成功、无输出
    return envelope.ok === true ? { ok: true, text: '' } : null
  }
  const record = execution as { result?: unknown; text?: unknown }
  const outcome = (record.result ?? record) as { kind?: unknown; text?: unknown } | null
  if (outcome === null || typeof outcome !== 'object') {
    return typeof record.text === 'string' ? { ok: true, text: record.text } : null
  }
  const text = typeof outcome.text === 'string' ? outcome.text : ''
  if (outcome.kind === 'error') return { ok: false, text: text === '' ? '命令执行失败' : text }
  if (outcome.kind === 'success') return { ok: true, text }
  return text === '' ? (envelope.ok === true ? { ok: true, text: '' } : null) : { ok: true, text }
}

function pct(used: number, limit: number): number {
  return limit > 0 ? Math.round((used / limit) * 100) : 0
}

/** Color by USAGE percentage: hot when little remains. */
function pctClass(usedPct: number): string {
  if (usedPct >= 90) return 'kt-danger'
  if (usedPct >= 80) return 'kt-warn'
  return ''
}

/** 中文短格式（2026-08-29 用户裁定）：zai 周期为亿级 token 计数，不撑爆 dock 行。 */
export function fmtRemain(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return String(n)
}

function fmtClock(ts: number): string {
  if (ts <= 0) return '--:--'
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 悬浮面板宽度上限与定位（fixed；贴 dock 下缘右对齐，视口内钳位）。 */
const POP_WIDTH = 430

export function TideDock(props: TideDockProps) {
  const projected = props.useProjection?.('kimi-tide/panel')
  const [fetched, setFetched] = useState<KimiTidePanelProjection | null | undefined>(undefined)
  /** 首次取数是否落定（成功或失败）：落定前才是「加载中」，落定后无数据是降级态。 */
  const [settled, setSettled] = useState(false)
  /** 取数失败原因（空 = 未失败，只是无数据）——降级文案带上它，不让人猜。 */
  const [degraded, setDegraded] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? false)
  const [popPos, setPopPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)

  // 面板数据面（v1.2.0）：优先命令通道现算（fetchPanel ?? 全局自注入面），
  // 挂载即取一次 + 定时轻轮询；取不到（路由关闭 / 通道缺席）→ 投影回退。
  // 旧宿主无命令通道时 fetched 恒为 null → 行为与解耦前一致。
  // 失败/空结果保留上一帧（不清屏）：路由关闭时面板数据源为空，清屏会让
  // 「关了路由」看起来像「面板坏了」。投影回退由 `??` 兜住首帧。
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const fetchPanel = props.fetchPanel ?? tideDockPanelSource.fetch
  useEffect(() => {
    let live = true
    const pull = async () => {
      try {
        const next = await fetchPanel(props.sessionId)
        if (live) {
          setSettled(true)
          setDegraded('')
          if (next !== null) setFetched(next)
        }
      } catch (error) {
        // 通道失败：保留已有帧，但把原因带进降级文案——不让人对着「加载中」猜。
        if (live) {
          setSettled(true)
          setDegraded(error instanceof Error ? error.message : String(error))
        }
      }
    }
    refreshRef.current = pull
    void pull()
    const timer = setInterval(() => { void pull() }, PANEL_POLL_MS)
    return () => { live = false; clearInterval(timer) }
  }, [fetchPanel, props.sessionId])

  const panel = fetched ?? projected ?? null

  const run = async (line: string) => {
    setBusy(true)
    setNotice('')
    try {
      const outcome = unwrapCommandOutcome(await tideDockBridge.execute(props.sessionId, line))
      if (outcome !== null && !outcome.ok) {
        // ok=false：远端拒绝（{ok:false,error}）或处理器报错（kind:'error'）——展示原文。
        setNotice(`命令执行失败：${outcome.text}`)
      }
      // outcome === null：无法识别的回包（如命令未匹配 value=undefined）——不打扰。
    } catch (error) {
      console.error('kimi-tide dock execute failed:', error)
      setNotice(`命令执行失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
      // 动作已改变路由/配额：立刻重取，不干等下一轮轮询。
      void refreshRef.current()
    }
  }

  /**
   * 悬浮层定位：右对齐（视口钳位）；下方空间不足且上方更宽裕时改锚 bottom
   * 向上展开——dock 位于输入区下缘，恒向下开 320px 面板会整块出屏
   * （2026-08-29 评审 P1-2）。锚 bottom 无需预知面板高度，max-height 兜底。
   * jsdom 零矩形也安全（下方空间全屏 → 走向下分支）。
   */
  const placePop = () => {
    const el = dockRef.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
    const width = Math.min(POP_WIDTH, vw - 16)
    const left = Math.max(8, Math.min(rect.right - width, vw - width - 8))
    const spaceBelow = vh - rect.bottom
    const maxH = Math.min(320, vh * 0.6)
    if (spaceBelow < maxH && rect.top > spaceBelow) {
      setPopPos({ left, bottom: vh - rect.top + 6 })
    } else {
      setPopPos({ left, top: rect.bottom + 6 })
    }
  }

  const toggleExpand = () => {
    const next = !expanded
    setExpanded(next)
    if (next) placePop()
  }

  // 悬浮层生命周期：外点/Esc/滚动/缩放关闭（滚动会拖走 fixed 定位，直接收起）。
  useEffect(() => {
    if (!expanded) return
    if (popPos === null) placePop()
    const close = () => { setExpanded(false) }
    const onDown = (event: MouseEvent) => {
      const target = event.target
      // window/document 级派发事件 target 非 Node（jsdom 实测），直接按面板外关闭
      if (target instanceof Node && (popRef.current?.contains(target) === true || toggleRef.current?.contains(target) === true)) return
      close()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
    // popPos 不入依赖：定位只在展开动作/缺省补位时计算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  if (panel === undefined || panel === null) {
    return (
      <div className="kimi-tide-dock">
        <span className="kt-label kt-slot"><Icon name="moon" className="kt-ic-moon" /> 月汐</span>
        <span className="kt-dim">
          {settled
            ? (degraded !== '' ? `暂无面板数据（${degraded}）` : '暂无面板数据（路由关闭或取数通道不可用）')
            : '面板数据加载中…'}
        </span>
      </div>
    )
  }

  const { router, kimi } = panel
  // 多 plan 配额（2026-08-29 用户裁定「所有 code plan 的余额」）：quotas map
  // 按当前命中目标 provider 取源快照（kimi/zai 自动跟随）；旧载荷（无 map）
  // 回落 legacy quota+quotaProvider 通道，⑨ 语义不变。
  // 0.8.x⑨：限额区跟随当前路由目标——末次决策目标优先，回落激活预设默认。
  // ⑥-B 打磨改语义（用户裁定 2026-08-29）：无数据时槽位仍渲染但置灰「—」
  // 占位（结构恒定防跳动）。
  const quotaSourceProvider = panel.quotaProvider ?? 'kimi-coding'
  const targetProvider = panel.decision?.chosen.provider
    ?? (router.activePreset !== null ? router.defaultTarget?.provider ?? null : null)
  const quota = panel.quotas !== undefined
    ? (targetProvider !== null && Object.hasOwn(panel.quotas, targetProvider)
        ? panel.quotas[targetProvider] ?? null
        : null)
    : targetProvider === quotaSourceProvider ? panel.quota : null
  // 置灰二态：目标无配额源（不适用）vs 有源但取数失败（配额不可用）——语义分开。
  const targetHasSource = targetProvider !== null && (
    panel.quotas !== undefined
      ? Object.hasOwn(panel.quotas, targetProvider)
      : targetProvider === quotaSourceProvider)
  const quotaDim = quota === null
  const showValues = quota !== null
  const weekUsedPct = quota === null ? 0 : pct(quota.weekly.used, quota.weekly.limit)
  const fiveUsedPct = quota === null ? 0 : pct(quota.fiveHour.used, quota.fiveHour.limit)
  const weekRemain = quota === null ? 0 : Math.max(0, quota.weekly.limit - quota.weekly.used)
  const fiveRemain = quota === null ? 0 : Math.max(0, quota.fiveHour.limit - quota.fiveHour.used)
  // 评审 P2-10：置灰槽的「—」对读屏是零语义破折号，title 又不可达——
  // 把原因进 aria-label（仅置灰态；点亮态保留自然文本朗读，避免吞掉剩 N 数字）。
  const weekTitle = quota !== null
    ? '周配额已用比例'
    : targetHasSource
      ? '周配额（取数失败，配额不可用）'
      : `周配额不适用于当前目标（${targetProvider ?? '—'}）`
  const fiveTitle = quota !== null
    ? '五小时窗已用比例'
    : targetHasSource
      ? '五小时窗（取数失败，配额不可用）'
      : `五小时窗不适用于当前目标（${targetProvider ?? '—'}）`
  const clockTitle = quota !== null
    ? `配额取数时间${quota.stale ? '（已过期）' : ''}`
    : targetHasSource
      ? '配额取数时间（取数失败，配额不可用）'
      : '配额取数时间（当前目标无配额数据）'

  return (
    <div className="kimi-tide-dock kt-dock-b" ref={dockRef} role="region" aria-label="月汐路由状态">
      {/* ⑥-B 第一行（锁单行）：身份 + 路由链（预设 → 打底 ⟶ 决策目标）+ 右贴决策开关。
          决策原因不进文本流（只在开关 title 与悬浮面板），长原因不再把 r1 挤换行。 */}
      <div className="kt-dock-r1">
        <span
          className="kt-label kt-slot"
          title="推理输出已启用 · 路由设置见 设置 → 月汐"
        >
          <Icon name="moon" className="kt-ic-moon" /> 月汐
        </span>

        <span className="kt-chip kt-slot" title="当前路由预设">
          <Icon name="route" className="kt-ic-route" /> {router.presetName ?? '关闭'}
        </span>

        {router.activePreset !== null && (
          <>
            <span className="kt-route-arrow" aria-hidden>→</span>
            <span
              className="kt-chip kt-slot"
              title={`预设打底模型 ${router.defaultTarget?.provider ?? ''}/${router.defaultTarget?.model ?? ''}（未命中规则时）`}
            >
              <Icon name="base" className="kt-ic-base" /> <span className="kt-ellip">{router.defaultTarget?.model}</span>
            </span>
          </>
        )}

        {panel.decision !== null && (
          <>
            <span className="kt-route-arrow" aria-hidden>⟶</span>
            <span
              className="kt-chip kt-slot kt-route-target"
              title={`本步决策目标 ${panel.decision.chosen.provider}/${panel.decision.chosen.model}`}
            >
              <Icon name="target" className="kt-ic-target" /> <span className="kt-ellip">{panel.decision.chosen.model}</span>
            </span>
          </>
        )}

        {(!kimi.route || !kimi.key) && (
          <span
            className="kt-chip kt-slot kt-warn"
            title="缺少 kimi-coding 路由或 API key（设置 → 模型 配置，apiKeyEnv 指向你的凭据）"
          >
            <Icon name="warn" /> Kimi 未接入：设置 → 模型
          </span>
        )}

        {/* 评审 P2-12（2026-08-29）：开关常驻——无决策时面板走空态解释分支，
            消除「为什么没有决策」的可观测性空窗（原 decision!==null 门控使
            空态文案成死代码）。 */}
        <span className="kt-dock-r1-end">
          <button
            type="button"
            ref={toggleRef}
            className={`kt-decision-chip kt-decision-toggle${expanded ? ' kt-armed' : ''}`}
            title={panel.decision === null
              ? `${expanded ? '收起' : '展开'}决策可观测（本步无决策）`
              : `${expanded ? '收起' : '展开'}决策可观测：${panel.decision.reason}`}
            aria-expanded={expanded}
            onClick={toggleExpand}
          >
            {expanded ? '▾' : '▸'} <Icon name="compass" className="kt-ic-compass" /> 决策
          </button>
        </span>
      </div>

      {/* ⑥-B 第二行（槽位常驻）：左=额度槽×2 + 图像上下文；右贴=取数时间 + 刷新。
          非 kimi 目标/取数失败 → 额度与时钟槽置灰「—」，槽数不变。 */}
      <div className="kt-dock-r2">
        <span
          className={`kt-slot kt-quota-slot ${pctClass(weekUsedPct)}${quotaDim ? ' kt-dim' : ''}`}
          title={weekTitle}
          aria-label={quotaDim ? weekTitle : undefined}
        >
          <Icon name="calendar" className="kt-ic-calendar" /> 周{' '}
          {showValues ? (
            <>
              <span className="kt-quota-bar"><i style={{ width: `${weekUsedPct}%` }} /></span>
              剩{fmtRemain(weekRemain)}
            </>
          ) : (
            '—'
          )}
        </span>

        <span
          className={`kt-slot kt-quota-slot ${pctClass(fiveUsedPct)}${quotaDim ? ' kt-dim' : ''}`}
          title={fiveTitle}
          aria-label={quotaDim ? fiveTitle : undefined}
        >
          <Icon name="gauge" className="kt-ic-gauge" /> 5h{' '}
          {showValues ? (
            <>
              <span className="kt-quota-bar"><i style={{ width: `${fiveUsedPct}%` }} /></span>
              剩{fmtRemain(fiveRemain)}
            </>
          ) : (
            '—'
          )}
        </span>

        {/* 0.6.x 池#1：投影 v6 图像上下文行客户端消费（spec §8）。缺席 = 无图
            会话不渲染；blind>0 警示态（盲答图在历史里，文本模型看不到）。 */}
        {panel.imageContext !== undefined && (
          <span
            className={`kt-slot${panel.imageContext.blind > 0 ? ' kt-warn' : ''}`}
            title="本会话图像三态计数：原生视觉 / 已转述 / 盲答（盲>0 = 有图文本模型看不到）"
          >
            <Icon name="image" className="kt-ic-image" /> 图 原{panel.imageContext.native}·述{panel.imageContext.transcribed}·盲{panel.imageContext.blind}
            {panel.imageContext.blind > 0 && (
              <span className="kt-warn">有图文本模型看不到</span>
            )}
          </span>
        )}

        <span className="kt-dock-r2-end">
          <span
            className={`kt-slot kt-h${quotaDim ? ' kt-dim' : ''}`}
            title={clockTitle}
            aria-label={quotaDim ? clockTitle : undefined}
          >
            <Icon name="clock" className="kt-ic-clock" />{' '}
            {showValues
              ? `${fmtClock(quota.fetchedAt)}${quota.stale ? ' (过期)' : ''}`
              : '—'}
          </span>
          <button
            type="button"
            className="kt-refresh"
            disabled={busy}
            title="刷新配额（/kimi-tide refresh）"
            onClick={() => void run('/kimi-tide refresh')}
          >
            <Icon name="refresh" className="kt-ic-refresh" />
          </button>
        </span>
      </div>

      {/* 决策可观测面板：portal 到 body 的悬浮层（fixed 定位），开合零推挤。
          评审 P2-12：无决策也渲染——ReasonPanel 空态分支解释「暂无本步决策」。 */}
      {expanded && createPortal(
        <div
          className="kt-dock-pop"
          ref={popRef}
          style={{ left: popPos?.left ?? 8, top: popPos?.top, bottom: popPos?.bottom }}
        >
          <ReasonPanel
            configSource={panel.configSource}
            decision={panel.decision}
            presetName={router.presetName}
            lastFlowEvent={panel.lastFlowEvent}
          />
        </div>,
        document.body,
      )}

      {notice !== '' && (
        <span className="kt-warn kt-slot" role="status"><Icon name="warn" /> {notice}</span>
      )}
    </div>
  )
}
