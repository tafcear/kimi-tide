/**
 * Browser half of dsh-kimi-tide: registers the 月汐 dock panel into the
 * conversation composer dock band (read-only dashboard under the composer
 * card, beside the shipped stats line), and the 月汐 settings card into the
 * official settings panel (settings.section). Panel data rides the
 * 'kimi-tide/panel' session projection; dock actions go back through
 * ctx.remote.commands.execute(sessionId, '/kimi-tide …'), while settings-card
 * writes go through the settings namespace (scope.set / connection.api.settings.mutate).
 */
import type { Context } from '@deepseek-ai/cordis'
import { TideDock, tideDockBridge } from './TideDock.js'
import { SettingsCard } from './SettingsCard.js'
import { fetchEffortsViaDescribe } from './effort-remote.js'
import { CLIENT_CSS } from './styles.js'

export const inject = ['slots', 'remote', 'remote.commands']

/** Minimal structural face of the browser locale service (dsh-client-locale). */
interface LocaleFace {
  register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(ns: string): (key: string, params?: Record<string, unknown>) => string
}

const LOCALE_NS = 'settings.kimi-tide'

export function apply(ctx: Context): void {
  // 0.8.0 effort 档位表（B5 换道 2026-08-27）：客户端经 settings.describe 读
  // kimi-tide-catalog 命名空间（宿主枚举刷新时写入）。原 typert $mount 手工
  // 贡献通道实机证伪（vendored kernel 静默挂起），已弃用——见 effort-remote.ts
  // 头注。取数失败由 card-store.loadEfforts 降级（下拉「跟随默认」禁用态）。

  // Wire the bridge so TideDock can call remote commands without receiving ctx as a prop.
  // The commands/execute contract differs by host version:
  //   - rc.8 (web): (agent, line, images) — images is a required business arg;
  //     a 2-arg call rejects with "expected 3 business argument(s)... got 2".
  //   - desktop 4.0.1+ (dsh-api-gateway): (agent, line) plus an OPTIONAL trailing
  //     caller AbortSignal — a third positional [] is parsed as the signal and
  //     every call fails with "Failed to convert value to 'AbortSignal'"
  //     (2026-08-21 live diagnosis: all panel commands dead on desktop).
  // Try the 2-arg form first; fall back to the rc.8 3-arg form only when the
  // gateway reports the 3-business-argument arity error.
  const commands = (ctx as unknown as { remote: { commands: { execute: (sid: string, l: string, images?: never[]) => Promise<unknown> } } }).remote.commands
  tideDockBridge.execute = (sessionId, line) =>
    commands.execute(sessionId, line).catch((cause: unknown) =>
      /expected 3 business argument/.test(String(cause)) ? commands.execute(sessionId, line, []) : Promise.reject(cause))

  // Settings-card nav label (spec §3.1): locale-bound `t('nav')` like the
  // official Models section, falling back to the hardcoded copy when the
  // locale service is absent (it is not in this plugin's inject, so its
  // absence must not block activation).
  const locale = ctx.get('locale') as LocaleFace | undefined
  let navLabel = (): string => '月汐'
  if (locale?.register !== undefined && locale?.bind !== undefined) {
    ctx.effect(() => locale.register(LOCALE_NS, {
      zh: { nav: '月汐' },
      en: { nav: 'Kimi Tide' },
    }))
    const t = locale.bind(LOCALE_NS)
    navLabel = () => t('nav')
  }

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'kimi-tide',
    order: 10, // after the shipped stats line (order 0)
    label: '月汐',
  }, TideDock))

  // 设置页「月汐」卡片。settingsScope / connection 均为可选读取：bind 在
  // inject 内惰性执行（挂载到卡片时才绑定，不因宿主缺服务而阻塞本插件激活）。
  // 候选「不可用」灰态：settings.section 是 root 作用域 slot，拿不到 session
  // 级 'kimi-tide/panel' 投影，故由 card-store 经 connection.api.llm.models
  // （宿主模型目录，session 无关，设置页 Models 官方先例同通道）拉取可用性
  // （验收⑥修复）；无 connection 通道时降级为无灰态。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'kimi-tide-router',
    order: 100,
    label: navLabel,
    inject: () => ({
      scope: (ctx.get('settingsScope') as { bind?: (spec: { namespace: string }) => unknown } | undefined)
        ?.bind({ namespace: 'kimi-tide-router' }) ?? null,
      connection: (ctx.get('connection') as unknown) ?? null,
      fetchEfforts: () => fetchEffortsViaDescribe(
        (ctx.get('connection') as Parameters<typeof fetchEffortsViaDescribe>[0]) ?? null,
      ).catch(() => ({})),
      // 0.8.x④：绑 catalog 命名空间 scope 作变更信号（官方 document-updated
      // 推送缝）——宿主 adapters 刷新重写档位表时卡片重取 efforts。
      catalogScope: ((ctx.get('settingsScope') as { bind?: (spec: { namespace: string }) => unknown } | undefined)
        ?.bind({ namespace: 'kimi-tide-catalog' }) ?? null) as { subscribe(listener: () => void): () => void } | null,
    }),
  }, SettingsCard))

  // Plugin-scoped styles; the slot/loader lifecycle removes them on unload.
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-kimi-tide'
  style.textContent = CLIENT_CSS
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove())
}
