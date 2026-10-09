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
import type { BalanceSnapshot, KimiTidePanelProjection, QuotaSnapshot } from '../types.js'
import type { GuardStatus } from '../guard-status.js'
import { formatDispatch, ReasonPanel } from './ReasonPanel.js'
import { Icon } from './icons.js'
import { copy, currentLanguage, useCopy } from './locale.js'

// Task 6：摘要格式化纯函数经本模块转出口（定义在 ReasonPanel.tsx，避免组件互引成环）。
export { formatDispatch }

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
  /**
   * 形态（v1.4.x 位置调整，2026-10-03 用户裁定「挪到工具行右端」）：
   * - `'full'`（默认）：composer 下方状态区的两行完整仪表（历史位置）；
   * - `'compact'`：输入工具行右端（提交按钮左侧）的一行紧凑态——只有
   *   「预设→目标」与「配额/余额」两个小按钮，点开仍是同一套 portal 面板。
   * 两个形态共用数据与 portal，故行为（取数节流/开合/空态）完全一致。
   */
  variant?: 'full' | 'compact'
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
      : typeof envelope.message === 'string' ? envelope.message : copy('panel.dock.commandFailed')
    return { ok: false, text: message }
  }
  if (Object.hasOwn(envelope, 'error')) {
    const error = envelope.error
    const message = typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message)
      : typeof error === 'string' ? error : copy('panel.dock.commandFailed')
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
  if (outcome.kind === 'error') return { ok: false, text: text === '' ? copy('panel.dock.commandFailed') : text }
  if (outcome.kind === 'success') return { ok: true, text }
  return text === '' ? (envelope.ok === true ? { ok: true, text: '' } : null) : { ok: true, text }
}

/**
 * 剩余比例（2026-09-15 用户裁定「逻辑反了」）：条宽与数字同源于**剩余**——
 * 剩得多条就长、剩得少条就短，与「剩 N%」同向；快耗尽 = 短红条。
 * limit<=0 = 该窗无数据 → null（不许算成「剩余 100%」把缺席窗伪装成满额）。
 */
function remainPct(used: number, limit: number): number | null {
  if (!(limit > 0)) return null
  const pct = Math.round((Math.max(0, limit - used) / limit) * 100)
  // 夹取到 0..100：used 为负（异常快照）时不许出现「剩 120%」这种上屏数字（评审 #5）。
  return Math.min(100, Math.max(0, pct))
}

/** Color by REMAINING percentage: hot when little remains。阈值取自「已用 ≥80/≥90」的同一界，但取整半界点与旧实现不严格等价（评审 #4）。 */
function remainClass(remain: number | null): string {
  if (remain === null) return ''
  if (remain <= 10) return 'kt-danger'
  if (remain <= 20) return 'kt-warn'
  return ''
}

/** 中文短格式（2026-08-29 用户裁定）：zai 周期为亿级 token 计数，不撑爆 dock 行。
 *  locale 化（W2）：单位进表（fmtYi/fmtWan）；en 路径同键不同缩放（1e9→B / 1e6→M），
 *  zh 路径保持 1e8→亿 / 1e4→万，产出与改动前逐字节一致。 */
export function fmtRemain(n: number): string {
  if (currentLanguage() === 'en') {
    if (n >= 1e9) return copy('panel.dock.fmtYi', { 0: (n / 1e9).toFixed(1) })
    if (n >= 1e6) return copy('panel.dock.fmtWan', { 0: (n / 1e6).toFixed(1) })
    return String(n)
  }
  if (n >= 1e8) return copy('panel.dock.fmtYi', { 0: (n / 1e8).toFixed(1) })
  if (n >= 1e4) return copy('panel.dock.fmtWan', { 0: (n / 1e4).toFixed(1) })
  return String(n)
}

/** 币种符号（未收录币种退化为「代码 + 空格」前缀，不臆造符号）。 */
function currencySymbol(currency: string): string {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return currency === '' ? '' : `${currency} `
}

/** 余额槽正文：取首币种（多币种进 tooltip）。 */
function fmtBalance(balance: BalanceSnapshot): string {
  const first = balance.balances[0]
  if (first === undefined) return copy('panel.dock.noValue')
  return `${currencySymbol(first.currency)}${first.total}`
}

/**
 * 余额槽 title：主币种金额 + 赠送/充值分项 +（多币种时）全币种清单。
 * `is_available === false` 的官方语义 = **余额不足以调用 API**（不是账号停用）。
 */
function balanceTitleOf(balance: BalanceSnapshot): string {
  const first = balance.balances[0]
  const head = balance.available === false ? copy('panel.dock.balanceInsufficient') : copy('panel.dock.balance')
  const primary = first === undefined ? '' : ` ${currencySymbol(first.currency)}${first.total}`
  const bits: string[] = []
  if (first?.granted !== undefined) bits.push(copy('panel.dock.balanceGranted', { 0: `${currencySymbol(first.currency)}${first.granted}` }))
  if (first?.toppedUp !== undefined) bits.push(copy('panel.dock.balanceToppedUp', { 0: `${currencySymbol(first.currency)}${first.toppedUp}` }))
  const detail = bits.length === 0 ? '' : copy('panel.dock.balanceDetail', { 0: bits.join(' · ') })
  const all = balance.balances.length > 1
    ? copy('panel.dock.balanceAll', { 0: balance.balances.map((b) => `${b.currency} ${b.total}`).join(' · ') })
    : ''
  return `${head}${primary}${detail}${all}`
}

/** 总览行（spec §6.2）。 */
export interface OverviewRow {
  provider: string
  kindLabel: string
  value: string
  when: string
  dim: boolean
}

/**
 * 派发护栏在岗槽（issue #9，纯函数可单测）：三态文案与视觉分层。
 * - 在岗：普通槽；
 * - 用户关闭（开关未开 / 无激活预设）：置灰槽——是用户意图，不告警；
 * - 环境不满足（tools 缺席 / guard 不可用 / 注册失败）：警示槽（kt-warn，
 *   与 kimi 未接入同款既有令牌）——开关已开而护栏不在岗，必须显眼。
 * register-failed 的 detail 进 title（宿主侧截断 ≤200 的原文，不在 locale 范围，透传）。
 */
export interface GuardChip {
  text: string
  title: string
  warn: boolean
  dim: boolean
}

export function guardChipOf(guard: GuardStatus): GuardChip {
  if (guard.state === 'installed') {
    return { text: copy('panel.dock.guardInstalled'), title: copy('panel.dock.guardInstalledTitle'), warn: false, dim: false }
  }
  if (guard.state === 'off') {
    return guard.reason === 'no-preset'
      ? { text: copy('panel.dock.guardOffNoPreset'), title: copy('panel.dock.guardOffNoPresetTitle'), warn: false, dim: true }
      : { text: copy('panel.dock.guardOffSwitch'), title: copy('panel.dock.guardOffSwitchTitle'), warn: false, dim: true }
  }
  if (guard.reason === 'no-tools') {
    return { text: copy('panel.dock.guardUnavailNoTools'), title: copy('panel.dock.guardUnavailNoToolsTitle'), warn: true, dim: false }
  }
  if (guard.reason === 'no-guard') {
    return { text: copy('panel.dock.guardUnavailNoGuard'), title: copy('panel.dock.guardUnavailNoGuardTitle'), warn: true, dim: false }
  }
  return {
    text: copy('panel.dock.guardUnavailRegisterFailed'),
    title: copy('panel.dock.guardUnavailRegisterFailedTitle', { 0: guard.detail ?? copy('panel.dock.noValue') }),
    warn: true,
    dim: false,
  }
}

/**
 * 用量总览行（纯函数，可单测）：按注册表序（`quotaSources`）逐源一行。
 * 三态来自元数据（S1）：无 API 面 ⇒ 显示静态真话；无凭据/取数失败 ⇒ 各自文案；
 * 有数据 ⇒ 用量源给两个窗的剩余百分比、余额源给金额。无数据的行置灰但**恒渲染**
 * （结构恒定，且「注册了但没数据」本身是可观测状态）。
 */
export function overviewRows(panel: KimiTidePanelProjection): OverviewRow[] {
  const rows: OverviewRow[] = []
  for (const meta of panel.quotaSources ?? []) {
    const snap = panel.quotas?.[meta.provider] ?? null
    const kindLabel = meta.kind === 'balance' ? copy('panel.dock.balance') : copy('panel.dock.kindUsage')
    // meta.reason 是宿主侧拼好的中文串（/api/kimi-tide/panel 数据），本轮不在 locale 范围，原样透传。
    const when = snap === null ? '' : (snap.stale ? copy('panel.dock.whenStale', { 0: fmtClock(snap.fetchedAt) }) : fmtClock(snap.fetchedAt))
    if (meta.state === 'no-api') {
      rows.push({ provider: meta.provider, kindLabel, value: meta.reason ?? copy('panel.dock.noPublicApi'), when: '', dim: true })
      continue
    }
    if (snap === null) {
      rows.push({ provider: meta.provider, kindLabel, value: meta.reason ?? copy('panel.dock.noData'), when: '', dim: true })
      continue
    }
    if ((snap as { kind?: unknown }).kind === 'balance') {
      const b = snap as BalanceSnapshot
      const first = b.balances[0]
      const value = first === undefined
        ? copy('panel.dock.noValue')
        : `${currencySymbol(first.currency)}${first.total}${b.available === false ? copy('panel.dock.balanceShort') : ''}`
      rows.push({ provider: meta.provider, kindLabel, value, when, dim: false })
      continue
    }
    const usage = snap as QuotaSnapshot
    const w = remainPct(usage.weekly.used, usage.weekly.limit)
    const f = remainPct(usage.fiveHour.used, usage.fiveHour.limit)
    const parts: string[] = []
    if (w !== null) parts.push(copy('panel.dock.weekRemain', { 0: w }))
    if (f !== null) parts.push(copy('panel.dock.fiveHourRemain', { 0: f }))
    rows.push({
      provider: meta.provider, kindLabel,
      value: parts.length > 0 ? parts.join(' · ') : copy('panel.dock.windowNoData'),
      when, dim: parts.length === 0,
    })
  }
  return rows
}

function fmtClock(ts: number): string {
  if (ts <= 0) return '--:--'
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 悬浮面板宽度上限与定位（fixed；贴 dock 下缘右对齐，视口内钳位）。 */
const POP_WIDTH = 430

/**
 * 事件是否来自悬浮层自身（面板本体或其触发按钮）。
 * 抽成模块级单点判据：决策面板与用量总览两处监听共用，避免两套判据各自漂移。
 * why：window 上的 scroll 监听必须用捕获相位（页面内滚动容器发出的 scroll 不冒泡，
 * 只有捕获相位收得到），但不区分来源就会「面板一滚即自关」
 * （2026-10-08 用户报告「上下滑动的条没法滚动，点一下 dock 就没了」）。
 * 判据只留「target 落在面板或其触发按钮内」：滚动条上的 mousedown 目标即滚动容器本身
 * （2026-10-08 真机实测：target=`#pop`、offsetX > clientWidth），故 contains 足够；
 * 面板矩形坐标判断是多余分支，已删。
 */
function fromFloatingPanel(event: Event, panel: HTMLElement | null, toggle: HTMLElement | null): boolean {
  const target = event.target
  return target instanceof Node && (panel?.contains(target) === true || toggle?.contains(target) === true)
}

export function TideDock(props: TideDockProps) {
  // 文案（W2 locale 化；P3 接回 useCopy）：useCopy() 取当前语言，服务缺席回落中文表；
  // 语言切换由 locale 订阅触发重渲染。模块级纯函数（overviewRows/fmtRemain 等）仍用 copy()。
  const t = useCopy()
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
  // 用量总览（spec §6.2）：与决策面板同款 portal + 外点/Esc 关闭。
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [ovPos, setOvPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const ovRef = useRef<HTMLDivElement | null>(null)
  const ovToggleRef = useRef<HTMLButtonElement | null>(null)
  /** 紧凑态（v1.4.x 位置调整）：工具行右端一行，只留两个按钮。 */
  const compact = props.variant === 'compact'

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
        setNotice(copy('panel.dock.commandFailedDetail', { 0: outcome.text }))
      }
      // outcome === null：无法识别的回包（如命令未匹配 value=undefined）——不打扰。
    } catch (error) {
      console.error('kimi-tide dock execute failed:', error)
      setNotice(copy('panel.dock.commandFailedDetail', { 0: error instanceof Error ? error.message : String(error) }))
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

  /** 总览悬浮层定位（与决策面板同款：右对齐、下方不够则翻到上方）。 */
  const placeOv = () => {
    const el = ovToggleRef.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
    const width = Math.min(POP_WIDTH, vw - 16)
    const left = Math.max(8, Math.min(rect.right - width, vw - width - 8))
    const spaceBelow = vh - rect.bottom
    const maxH = Math.min(320, vh * 0.6)
    if (spaceBelow < maxH && rect.top > spaceBelow) setOvPos({ left, bottom: vh - rect.top + 6 })
    else setOvPos({ left, top: rect.bottom + 6 })
  }

  const toggleOverview = () => {
    const next = !overviewOpen
    setOverviewOpen(next)
    if (next) placeOv()
  }

  // 总览悬浮层生命周期：外点/Esc/滚动/缩放关闭（与决策面板同款约束）。
  useEffect(() => {
    if (!overviewOpen) return
    if (ovPos === null) placeOv()
    const close = () => { setOverviewOpen(false) }
    const onDown = (event: MouseEvent) => {
      // 窗口级直派事件 target 非 Node（jsdom 实测）⇒ 直接按面板外关闭
      if (fromFloatingPanel(event, ovRef.current, ovToggleRef.current)) return
      close()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    // 总览自身滚动不关（body/聊天区滚动仍关：fixed 定位会漂移）
    const onScroll = (event: Event) => {
      if (fromFloatingPanel(event, ovRef.current, ovToggleRef.current)) return
      close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
    // placeOv 不入依赖：定位只在展开动作/缺省补位时计算（同决策面板）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewOpen, ovPos])

  // 悬浮层生命周期：外点/Esc/滚动/缩放关闭（滚动会拖走 fixed 定位，直接收起）。
  useEffect(() => {
    if (!expanded) return
    if (popPos === null) placePop()
    const close = () => { setExpanded(false) }
    const onDown = (event: MouseEvent) => {
      // 窗口级直派事件 target 非 Node（jsdom 实测）⇒ 直接按面板外关闭
      if (fromFloatingPanel(event, popRef.current, toggleRef.current)) return
      close()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    // 面板自身滚动不关（面板就是 overflow:auto 滚动容器，「最近派发」超 20 行即出条）；
    // body/聊天区滚动仍关：fixed 定位会漂移，这是原设计意图。
    const onScroll = (event: Event) => {
      if (fromFloatingPanel(event, popRef.current, toggleRef.current)) return
      close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
    // popPos 不入依赖：定位只在展开动作/缺省补位时计算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  if (panel === undefined || panel === null) {
    const stateText = settled
      ? (degraded !== '' ? t('panel.dock.panelEmptyReason', { 0: degraded }) : t('panel.dock.panelEmpty'))
      : t('panel.dock.panelLoading')
    return (
      <div className={`kimi-tide-dock${compact ? ' kt-dock-c' : ''}`} data-kt-el="dock-states">
        {/* 紧凑态：状态文案收进 title（工具行只有一行），面上只留「月汐」，不挤掉别的控件。 */}
        <span
          className={`kt-label kt-slot${compact ? ' kt-c-state' : ''}`}
          title={compact ? stateText : undefined}
        >
          <Icon name="moon" className="kt-ic-moon" /> {t('shared.nav')}
        </span>
        {!compact && <span className="kt-dim">{stateText}</span>}
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
  // 余额源判别（用量/余额 spec v2 §6.1，评审 L3）：判别**必须早于**任何 weekly/
  // fiveHour 读取——余额快照没有这两个窗，先读会直接崩（实测 TypeError）。
  // 判别键只用 BalanceSnapshot 的 kind（用量快照不带 kind）。
  const balance = quota !== null && (quota as { kind?: unknown }).kind === 'balance'
    ? (quota as BalanceSnapshot)
    : null
  const usage = balance === null ? quota : null
  // 条=剩余（2026-09-15）：两窗各自取剩余比例；该窗无数据（limit<=0）时 pct=null。
  const weekWindow = usage === null ? null : usage.weekly
  const fiveWindow = usage === null ? null : usage.fiveHour
  const weekPct = weekWindow === null ? null : remainPct(weekWindow.used, weekWindow.limit)
  const fivePct = fiveWindow === null ? null : remainPct(fiveWindow.used, fiveWindow.limit)
  const weekDim = quotaDim || weekPct === null
  const fiveDim = quotaDim || fivePct === null
  // 评审 P2-10：置灰槽的「—」对读屏是零语义破折号，title 又不可达——
  // 把原因进 aria-label（仅置灰态；点亮态保留自然文本朗读，避免吞掉剩 N 数字）。
  const weekTitle = weekWindow !== null && weekPct !== null
    ? t('panel.dock.weekTitleRemain', { 0: fmtRemain(Math.max(0, weekWindow.limit - weekWindow.used)), 1: fmtRemain(weekWindow.limit) })
    : usage !== null
      ? t('panel.dock.weekTitleNoData')
      : targetHasSource
        ? t('panel.dock.weekTitleFailed')
        : t('panel.dock.weekTitleNa', { 0: targetProvider ?? t('panel.dock.noValue') })
  const fiveTitle = fiveWindow !== null && fivePct !== null
    ? t('panel.dock.fiveTitleRemain', { 0: fmtRemain(Math.max(0, fiveWindow.limit - fiveWindow.used)), 1: fmtRemain(fiveWindow.limit) })
    : usage !== null
      ? t('panel.dock.fiveTitleNoData')
      : targetHasSource
        ? t('panel.dock.fiveTitleFailed')
        : t('panel.dock.fiveTitleNa', { 0: targetProvider ?? t('panel.dock.noValue') })
  const clockTitle = quota !== null
    ? `${t('panel.dock.clockTitle')}${quota.stale ? t('panel.dock.clockTitleStale') : ''}`
    : targetHasSource
      ? t('panel.dock.clockTitleFailed')
      : t('panel.dock.clockTitleNoQuota')
  // ---- 紧凑态（v1.4.x，工具行右端）派生值 ----
  // 目标链：本步决策目标优先，回落预设默认目标（与 r1 的 ⟶/→ 同语义，只是合成一个按钮）。
  const compactTarget = panel.decision?.chosen ?? (router.activePreset !== null ? router.defaultTarget ?? null : null)
  // 配额摘要一格：余额源给 `¥xx`，用量源给 `周剩NN%`，无数据给 null（退化为 ▤ 图标）。
  const compactQuota = balance !== null
    ? fmtBalance(balance)
    : weekPct === null ? null : t('panel.dock.weekRemain', { 0: weekPct })
  const compactQuotaTitle = balance !== null
    ? balanceTitleOf(balance)
    : weekPct === null
      ? t('panel.dock.compactQuotaNoData')
      : t('panel.dock.compactQuotaOpen', { 0: weekTitle })
  // Task 6 派发台账（面板 v7）：每父会话最近 20 条、新在前；旧载荷缺席 → 空数组
  // → 摘要槽与明细区都不渲染（空态不挂锚点，不是渲染空字符串）。
  const dispatch = panel.dispatch ?? []
  // 投影 v8 派发护栏在岗状态（issue #9）：旧载荷缺席（投影回退的历史快照）→ 不渲染
  // 该槽；实时快照恒有值 → 三态槽（在岗 / 用户关闭置灰 / 环境不满足警示）。
  const guardChip = panel.guard === undefined ? null : guardChipOf(panel.guard)

  return (
    <div className={`kimi-tide-dock ${compact ? 'kt-dock-c' : 'kt-dock-b'}`} ref={dockRef} role="region" aria-label={t('panel.dock.regionLabel')}>
      {compact ? (
        <>
          {/* 紧凑态（工具行右端，仅一行空间）：① 预设→目标（点开决策面板）
              ② 配额/余额（点开用量总览）。额度条/刷新按钮不进这一行——额度明细
              在总览里，「刷新配额」走 `/kimi-tide refresh`（工具行放不下第三个控件）。 */}
          <button
            type="button"
            data-kt-el="compact-toggle"
            ref={toggleRef}
            className={`kt-c-main kt-slot${expanded ? ' kt-armed' : ''}`}
            aria-expanded={expanded}
            title={panel.decision === null
              ? t('panel.dock.toggleTitleNoDecisionCompact', { 0: expanded ? t('panel.dock.collapse') : t('panel.dock.expand'), 1: router.presetName ?? t('panel.dock.closed') })
              : t('panel.dock.toggleTitleDecision', { 0: expanded ? t('panel.dock.collapse') : t('panel.dock.expand'), 1: panel.decision.reason })}
            onClick={toggleExpand}
          >
            <Icon name="moon" className="kt-ic-moon" />
            <span className="kt-c-preset">{router.presetName ?? t('panel.dock.closed')}</span>
            {compactTarget !== null && (
              <>
                <span className="kt-route-arrow" aria-hidden>→</span>
                <span className="kt-ellip kt-route-target">{compactTarget.model}</span>
              </>
            )}
            {(!kimi.route || !kimi.key) && (
              <span data-kt-el="kimi-warning" className="kt-c-warn" title={t('panel.dock.kimiMissingTitleCompact')}>
                <Icon name="warn" />
              </span>
            )}

            {/* 投影 v8 派发护栏在岗标记（issue #9）：紧凑态只有一个按钮的空间，
                收进主按钮内（与 kimi 警示同款的内嵌标记，不占第三个控件）——
                在岗 / 用户关闭置灰 / 环境不满足警示，文案与完整态 r2 同一来源。 */}
            {guardChip !== null && (
              <span
                data-kt-el="guard-status"
                className={`kt-c-guard${guardChip.warn ? ' kt-warn' : ''}${guardChip.dim ? ' kt-dim' : ''}`}
                title={guardChip.title}
              >
                {guardChip.warn && <Icon name="warn" />}
                {guardChip.text}
              </span>
            )}
          </button>

          <button
            type="button"
            data-kt-el="compact-quota"
            ref={ovToggleRef}
            className={`kt-c-quota kt-slot${overviewOpen ? ' kt-armed' : ''}${quotaDim ? ' kt-dim' : ''}`}
            aria-expanded={overviewOpen}
            aria-controls="kt-quota-overview"
            title={compactQuotaTitle}
            onClick={toggleOverview}
          >
            {compactQuota === null ? <Icon name="stacks" /> : compactQuota}
          </button>
        </>
      ) : (
      <>
      {/* ⑥-B 第一行（锁单行）：身份 + 路由链（预设 → 默认目标 ⟶ 决策目标）+ 右贴决策开关。
          决策原因不进文本流（只在开关 title 与悬浮面板），长原因不再把 r1 挤换行。 */}
      <div className="kt-dock-r1">
        <span
          data-kt-el="label"
          className="kt-label kt-slot"
          title={t('panel.dock.labelTitle')}
        >
          <Icon name="moon" className="kt-ic-moon" /> {t('shared.nav')}
        </span>

        <span data-kt-el="preset-chip" className="kt-chip kt-slot" title={t('panel.dock.presetChipTitle')}>
          <Icon name="route" className="kt-ic-route" /> {router.presetName ?? t('panel.dock.closed')}
        </span>

        {router.activePreset !== null && (
          <>
            <span className="kt-route-arrow" aria-hidden>→</span>
            <span
              data-kt-el="baseline-chip"
              className="kt-chip kt-slot"
              title={t('panel.dock.baselineChipTitle', { 0: router.defaultTarget?.provider ?? '', 1: router.defaultTarget?.model ?? '' })}
            >
              <Icon name="base" className="kt-ic-base" /> <span className="kt-ellip">{router.defaultTarget?.model}</span>
            </span>
          </>
        )}

        {panel.decision !== null && (
          <>
            <span className="kt-route-arrow" aria-hidden>⟶</span>
            <span
              data-kt-el="decision-chip"
              className="kt-chip kt-slot kt-route-target"
              title={t('panel.dock.decisionChipTitle', { 0: panel.decision.chosen.provider, 1: panel.decision.chosen.model })}
            >
              <Icon name="target" className="kt-ic-target" /> <span className="kt-ellip">{panel.decision.chosen.model}</span>
            </span>
          </>
        )}

        {(!kimi.route || !kimi.key) && (
          <span
            data-kt-el="kimi-warning"
            className="kt-chip kt-slot kt-warn"
            title={t('panel.dock.kimiMissingTitle')}
          >
            <Icon name="warn" /> {t('panel.dock.kimiMissing')}
          </span>
        )}

        {/* 评审 P2-12（2026-08-29）：开关常驻——无决策时面板走空态解释分支，
            消除「为什么没有决策」的可观测性空窗（原 decision!==null 门控使
            空态文案成死代码）。 */}
        <span className="kt-dock-r1-end">
          <button
            type="button"
            ref={toggleRef}
            data-kt-el="decision-toggle"
            className={`kt-decision-chip kt-decision-toggle${expanded ? ' kt-armed' : ''}`}
            title={panel.decision === null
              ? t('panel.dock.toggleTitleNoDecision', { 0: expanded ? t('panel.dock.collapse') : t('panel.dock.expand') })
              : t('panel.dock.toggleTitleDecision', { 0: expanded ? t('panel.dock.collapse') : t('panel.dock.expand'), 1: panel.decision.reason })}
            aria-expanded={expanded}
            onClick={toggleExpand}
          >
            {expanded ? '▾' : '▸'} <Icon name="compass" className="kt-ic-compass" /> {t('panel.dock.decision')}
          </button>
        </span>
      </div>

      {/* ⑥-B 第二行（槽位常驻）：左=额度槽（用量双槽 | 余额单槽）+ 图像上下文；
          右贴=取数时间 + 刷新。非 kimi 目标/取数失败 → 额度与时钟槽置灰「—」，槽数不变。
          2026-09-15：额度条改为**剩余**语义；同日 v2 起按源类型自适应——API 计费源
          （余额）画单槽 ¥ 金额，不画进度条（用量/余额 spec §6.1）。 */}
      <div className="kt-dock-r2">
        {balance === null ? (
        <>
        <span
          data-kt-el="week-quota"
          className={`kt-slot kt-quota-slot ${remainClass(weekPct)}${weekDim ? ' kt-dim' : ''}`}
          title={weekTitle}
          aria-label={weekDim ? weekTitle : undefined}
        >
          <Icon name="calendar" className="kt-ic-calendar" /> {t('panel.dock.week')}{' '}
          {weekPct === null ? (
            t('panel.dock.noValue')
          ) : (
            <>
              <span className="kt-quota-bar"><i style={{ width: `${weekPct}%` }} /></span>
              {t('panel.dock.remainPct', { 0: weekPct })}
            </>
          )}
        </span>

        <span
          data-kt-el="fivehour-quota"
          className={`kt-slot kt-quota-slot ${remainClass(fivePct)}${fiveDim ? ' kt-dim' : ''}`}
          title={fiveTitle}
          aria-label={fiveDim ? fiveTitle : undefined}
        >
          <Icon name="gauge" className="kt-ic-gauge" /> 5h{' '}
          {fivePct === null ? (
            t('panel.dock.noValue')
          ) : (
            <>
              <span className="kt-quota-bar"><i style={{ width: `${fivePct}%` }} /></span>
              {t('panel.dock.remainPct', { 0: fivePct })}
            </>
          )}
        </span>
        </>
        ) : (
        <span
          data-kt-el="balance-slot"
          className={`kt-slot kt-quota-slot${balance.available === false ? ' kt-warn' : ''}`}
          title={balanceTitleOf(balance)}
        >
          <Icon name="wallet" className="kt-ic-calendar" /> {t('panel.dock.balanceSlot', { 0: fmtBalance(balance) })}
          {balance.available === false && <span className="kt-warn"> {t('panel.dock.balanceInsufficientWord')}</span>}
        </span>
        )}

        {/* 0.6.x 池#1：投影 v6 图像上下文行客户端消费（spec §8）。缺席 = 无图
            会话不渲染；blind>0 警示态（盲答图在历史里，文本模型看不到）。 */}
        {panel.imageContext !== undefined && (
          <span
            data-kt-el="image-context"
            className={`kt-slot${panel.imageContext.blind > 0 ? ' kt-warn' : ''}`}
            title={t('panel.dock.imageContextTitle')}
          >
            <Icon name="image" className="kt-ic-image" /> {t('panel.dock.imageContext', { 0: panel.imageContext.native, 1: panel.imageContext.transcribed, 2: panel.imageContext.blind })}
            {panel.imageContext.blind > 0 && (
              <span className="kt-warn">{t('panel.dock.imageBlind')}</span>
            )}
          </span>
        )}

        {/* Task 6 派发摘要槽：有派发才渲染（空态不挂锚点）；取最新一条 [0]，
            明细在决策悬浮层。内层 .kt-ellip 承担截断（评审 A6：flex 容器上
            text-overflow 无效）。终审 M8①：title 含完整格式化文案——摘要被
            截断后 hover 仍可读全文（定值「最近一次派发」只有槽位名）。 */}
        {dispatch.length > 0 && (
          <span className="kt-slot kt-dispatch" data-kt-el="dispatch" title={t('panel.dock.dispatchTitle', { 0: formatDispatch(dispatch[0]!) })}>
            <span className="kt-ellip">{formatDispatch(dispatch[0]!)}</span>
          </span>
        )}

        {/* 投影 v8 派发护栏在岗槽（issue #9）：实时快照恒渲染——在岗 = 普通槽；
            用户关闭 = 置灰（不告警）；环境不满足 = 警示态（kt-warn 既有令牌，
            与 kimi 未接入同款）。紧凑态同款标记内嵌在主按钮里（见上）。 */}
        {guardChip !== null && (
          <span
            data-kt-el="guard-status"
            className={`kt-slot${guardChip.warn ? ' kt-warn' : ''}${guardChip.dim ? ' kt-dim' : ''}`}
            title={guardChip.title}
          >
            {guardChip.warn && <Icon name="warn" />} {guardChip.text}
          </span>
        )}

        <span className="kt-dock-r2-end">
          <button
            type="button"
            data-kt-el="overview-toggle"
            ref={ovToggleRef}
            className={`kt-ov-toggle${overviewOpen ? ' kt-armed' : ''}`}
            aria-expanded={overviewOpen}
            aria-controls="kt-quota-overview"
            title={overviewOpen ? t('panel.dock.overviewCollapse') : t('panel.dock.overviewExpand')}
            onClick={toggleOverview}
          >
            <Icon name="stacks" className="kt-ic-refresh" />
          </button>
          <span
            data-kt-el="fetched-at"
            className={`kt-slot kt-h${quotaDim ? ' kt-dim' : ''}`}
            title={clockTitle}
            aria-label={quotaDim ? clockTitle : undefined}
          >
            <Icon name="clock" className="kt-ic-clock" />{' '}
            {showValues
              ? (quota.stale ? t('panel.dock.clockStale', { 0: fmtClock(quota.fetchedAt) }) : fmtClock(quota.fetchedAt))
              : t('panel.dock.noValue')}
          </span>
          <button
            type="button"
            data-kt-el="refresh"
            className="kt-refresh"
            disabled={busy}
            title={t('panel.dock.refreshTitle')}
            onClick={() => void run('/kimi-tide refresh')}
          >
            <Icon name="refresh" className="kt-ic-refresh" />
          </button>
        </span>
      </div>
      </>
      )}

      {/* 用量总览（用量/余额 spec §6.2）：一屏列出全部注册源——用量/余额/三态。
          portal 到 body（与决策面板同款，开合零推挤）；只读，无写路径。 */}
      {overviewOpen && createPortal(
        <div
          className="kt-dock-pop kt-ov"
          id="kt-quota-overview"
          role="dialog"
          aria-label={t('panel.dock.overviewTitle')}
          ref={ovRef}
          style={{ left: ovPos?.left ?? 8, top: ovPos?.top, bottom: ovPos?.bottom }}
        >
          <span className="kt-h">{t('panel.dock.overviewTitle')}</span>
          <ul className="kt-ov-list">
            {overviewRows(panel).map((row) => (
              <li key={row.provider} className={row.dim ? 'kt-ov-row kt-dim' : 'kt-ov-row'}>
                <span className="kt-ov-provider">{row.provider}</span>
                <span className="kt-ov-kind">{row.kindLabel}</span>
                <span className="kt-ov-value">{row.value}</span>
                <span className="kt-ov-when">{row.when}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}

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
            dispatch={panel.dispatch}
          />
        </div>,
        document.body,
      )}

      {notice !== '' && (
        <span data-kt-el="notice" className="kt-warn kt-slot" role="status"><Icon name="warn" /> {notice}</span>
      )}
    </div>
  )
}
