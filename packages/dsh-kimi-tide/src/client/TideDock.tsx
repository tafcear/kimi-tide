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
  useProjection: (key: 'kimi-tide/panel') => KimiTidePanelProjection | null | undefined
  /** 测试缝/深链：初始即展开决策可观测面板（默认折叠，点「决策」开）。 */
  defaultExpanded?: boolean
}

/** Wired in client/index.ts apply(): the dock component calls back into cordis ctx. */
export interface TideDockBridge {
  execute: (sessionId: string, line: string) => Promise<unknown>
}
export const tideDockBridge: TideDockBridge = { execute: async () => undefined }

function pct(used: number, limit: number): number {
  return limit > 0 ? Math.round((used / limit) * 100) : 0
}

/** Color by USAGE percentage: hot when little remains. */
function pctClass(usedPct: number): string {
  if (usedPct >= 90) return 'kt-danger'
  if (usedPct >= 80) return 'kt-warn'
  return ''
}

function fmtClock(ts: number): string {
  if (ts <= 0) return '--:--'
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 悬浮面板宽度上限与定位（fixed；贴 dock 下缘右对齐，视口内钳位）。 */
const POP_WIDTH = 430

export function TideDock(props: TideDockProps) {
  const panel = props.useProjection('kimi-tide/panel')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? false)
  const [popPos, setPopPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)

  const run = async (line: string) => {
    setBusy(true)
    setNotice('')
    try {
      const result = await tideDockBridge.execute(props.sessionId, line) as
        | { ok?: boolean; message?: string; error?: { message?: string } }
        | undefined
      const errMessage = result?.error?.message
      if (result !== undefined && result.ok === false) {
        // rc.8 命令 RPC 失败形态：error/result 字段可读时展示原文，否则提示通道。
        setNotice(`命令执行失败：${errMessage ?? result.message ?? '命令通道不可用（需 dsh-api-remotes）'}`)
      } else if (errMessage !== undefined) {
        // 0.6.x池#d：error-only 形态（无 ok 字段带 error）不再按成功静默吞掉。
        setNotice(`命令执行失败：${errMessage}`)
      }
    } catch (error) {
      console.error('kimi-tide dock execute failed:', error)
      setNotice(`命令执行失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
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
        <span className="kt-dim">面板数据加载中…</span>
      </div>
    )
  }

  const { quota, router, kimi } = panel
  const weekUsedPct = quota === null ? 0 : pct(quota.weekly.used, quota.weekly.limit)
  const fiveUsedPct = quota === null ? 0 : pct(quota.fiveHour.used, quota.fiveHour.limit)
  const weekRemain = quota === null ? 0 : Math.max(0, quota.weekly.limit - quota.weekly.used)
  const fiveRemain = quota === null ? 0 : Math.max(0, quota.fiveHour.limit - quota.fiveHour.used)
  // 0.8.x⑨：限额区跟随当前路由目标——末次决策目标优先，回落激活预设默认。
  // ⑥-B 打磨改语义（用户裁定 2026-08-29）：非 kimi 目标时槽位仍渲染但置灰
  // 「—」占位（结构恒定防跳动），数据点亮仅限目标 = 配额来源 provider。
  const targetProvider = panel.decision?.chosen.provider
    ?? (router.activePreset !== null ? router.defaultTarget?.provider ?? null : null)
  const quotaSource = panel.quotaProvider ?? 'kimi-coding'
  const quotaRelevant = targetProvider !== null && targetProvider === quotaSource
  const quotaDim = !quotaRelevant || quota === null
  const showValues = quota !== null && quotaRelevant
  // 评审 P2-10：置灰槽的「—」对读屏是零语义破折号，title 又不可达——
  // 把原因进 aria-label（仅置灰态；点亮态保留自然文本朗读，避免吞掉剩 N 数字）。
  const weekTitle = !quotaRelevant
    ? `周配额仅 kimi 目标适用（当前目标 ${targetProvider ?? '—'}）`
    : quota === null
      ? '周配额（取数失败，配额不可用）'
      : '周配额已用比例'
  const fiveTitle = !quotaRelevant
    ? `五小时窗仅 kimi 目标适用（当前目标 ${targetProvider ?? '—'}）`
    : quota === null
      ? '五小时窗配额（取数失败，配额不可用）'
      : '五小时窗已用比例'
  const clockTitle = quota !== null && quotaRelevant
    ? `配额取数时间${quota.stale ? '（已过期）' : ''}`
    : '配额取数时间（当前目标不适用 kimi 限额）'

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
            className="kt-decision-chip kt-decision-toggle"
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
              剩{weekRemain}
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
              剩{fiveRemain}
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
            {quota !== null && quotaRelevant
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
