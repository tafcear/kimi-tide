/**
 * help-content — 说明页签的**单一内容源**（说明页签 spec v2 §5/§7）。
 *
 * 三条纪律：
 * 1. 纯数据 + 纯函数（`live` 只读入配置，不碰 ctx/IO），可脱离 DOM 单测；
 * 2. **只描述本版实际 ship 的行为**——未实施的特性不得出现在这里；
 * 3. `FEATURE_KEYS` 与配置面互锁（`test/help-content.test.ts` 的防腐烂闸）：
 *    **顶层**配置字段加了而说明不补条目 → 测试红（嵌套/可选新字段靠人与评审把关，
 *    见 2026-09-15 评审 #2：反向闸只遍历 schema 顶层键）。
 *
 * `FALLBACK_HINTS` 在此定义并由设置卡片与说明页**共用**（单一内容源，
 * 杜绝「两处真理」——原定义在 SettingsCard.tsx，2026-09-15 迁移）。
 *
 * locale 化（W4）：所有用户可见文案走 `copy()` / `t()`，中文逐字保留自 zh 表。
 * HELP_SECTIONS / WHATS_NEW 改为构建函数 `(t) => …`（模块加载时无语言概念）。
 */
import type { ImageFallback, RouterConfigV4, RouterConfigV5, RouterConfigV5Plus, RouterConfigV6 } from '../config.js'
import { isV5Plus } from '../config.js'
import type { CopyKey, CopyParams } from '../locales/index.js'
import { copy as moduleCopy } from './locale.js'

/** 翻译函数签名（兼容 useCopy() 返回值与 module-level copy）。 */
type T = (key: CopyKey, params?: CopyParams) => string

/** 卡片配置过渡形（与 card-store 的 CardConfig 同形；此处不引入 store 依赖）。 */
export type HelpConfig = RouterConfigV4 | RouterConfigV5 | RouterConfigV6

/**
 * FALLBACK_HINTS 的键映射（冻结契约，W1 import 用）：
 * 三个键固定为 help.fallback.latch / blind / transcribeLazy，不许改。
 */
export const FALLBACK_HINT_KEYS: Record<ImageFallback, CopyKey> = {
  latch: 'help.fallback.latch',
  blind: 'help.fallback.blind',
  'transcribe-lazy': 'help.fallback.transcribeLazy',
}

/** imageFallback 三态的一句话后果提示（原 SettingsCard 常量，说明页与规则行共用）。
 *  值从 locale 表取；服务缺席时回落中文表（copy() 兜底）。 */
export const FALLBACK_HINTS: Record<ImageFallback, string> = {
  latch: moduleCopy(FALLBACK_HINT_KEYS.latch),
  blind: moduleCopy(FALLBACK_HINT_KEYS.blind),
  'transcribe-lazy': moduleCopy(FALLBACK_HINT_KEYS['transcribe-lazy']),
}

/** dock 面板上的可视元素 id（说明页必须逐个讲到；`data-kt-el` 与之同源）。 */
export const DOCK_ELEMENTS = [
  'label', 'preset-chip', 'baseline-chip', 'decision-chip', 'decision-toggle',
  'kimi-warning', 'week-quota', 'fivehour-quota', 'balance-slot', 'overview-toggle', 'image-context',
  'dispatch', 'fetched-at', 'refresh', 'notice', 'dock-states',
] as const

/** 设置页的功能区块 id（说明页必须逐个讲到）。`driver` = 主驱动卡（Task 8 补锚点，
 *  前序 carry②：该条目原先只锚 dock 的 dispatch 元素）。 */
export const SETTINGS_SECTIONS = [
  'presets', 'preset-editor', 'preset-ops', 'rules', 'keyword-groups', 'image-fallback', 'hit-confirm', 'flows', 'trial', 'roles', 'driver',
] as const

/**
 * 说明页引用的配置字段路径（防腐烂闸用）：每条都要能在「含全部可选字段的
 * 样例配置」上走通；反向闸要求 schema 顶层键集 ⊆ 本表首段 ∪ LEGACY_CONFIG_KEYS。
 */
export const FEATURE_KEYS = [
  'version',
  'activePreset',
  'presets',
  'presets.saving.name',
  'presets.saving.default',
  'presets.saving.rules',
  'presets.saving.rules.0.when.group',
  'presets.saving.rules.0.when.minHits',
  'presets.saving.rules.0.target',
  'presets.saving.imageFallback',
  'presets.saving.imageFallbackFlow',
  'keywordGroups',
  'auxTargets',
  'flows',
  'flows.transcribe.visionModel',
  'flows.transcribe.failurePolicy',
  'flows.review.trigger',
  'flows.review.keywordGroup',
  'flows.review.rounds',
  'flows.review.autoRevise',
  'flows.review.recheck',
  // v6（团队派发）顶层键：说明条目见「路由语义」区的 routing-roles / routing-driver。
  'driver',
  'driverSticky',
  'rulesApplyToChildren',
  'roles',
  // v2.2.0 派发护栏：开关是顶层键（说明条目 routing-guard），领域词挂在角色行上
  // （`roles.<id>.keywords`，投影后由 `routes` 的 dispatch 行承载）。
  'dispatchGuard',
  'roles.frontend.keywords',
  // v7（统一路由表）：`routes` 是 v2.1.0 起的**真源**（旧字段降为镜像）。
  // 它不在 routerConfigSchema 的顶层键里（schemastery 未知键透传，实测往返不丢），
  // 所以反向闸扫不到它——这里显式登记，保证「样例配置能走通」这条正向闸覆盖它。
  'routes',
  'routes.0.scope',
  'routes.0.when',
  'routes.0.target',
] as const

/** schema 里有、但不承载「用户可理解特性」的遗留键（反向闸豁免）。 */
export const LEGACY_CONFIG_KEYS = ['mode'] as const

/** 导览条目（与 HelpEntry 同形，但**没有 live**：纯静态说明，不读配置）。 */
export interface HelpWhatsNewEntry {
  id: string
  title: string
  body: string[]
}

export interface HelpEntry {
  id: string
  title: string
  /** 逐行正文（每行一句话；条目 ≤3 行为宜，超出者拆进术语表）。 */
  body: string[]
  /** 关联的 dock 元素 / 设置区块 id（覆盖闸双向校验）。 */
  anchors?: string[]
  /** 状态感知：渲染「当前：…」行；返回 undefined = 该行不渲染（不造噪音）。 */
  live?: (config: HelpConfig) => string | undefined
}

export interface HelpSection {
  id: string
  title: string
  entries: HelpEntry[]
  /** 默认展开（① 面板速览与 ⑦ 常见疑问默认展开：症状优先）。 */
  defaultOpen?: boolean
  /** v5 独有（v4 存量配置下整节隐藏）。 */
  v5Only?: boolean
}

const v5 = (config: HelpConfig): RouterConfigV5Plus | null => (isV5Plus(config) ? config : null)
const presetOf = (config: HelpConfig) => (config.activePreset === null ? undefined : config.presets[config.activePreset])
const targetKey = (target: { provider: string; model: string } | undefined): string =>
  target === undefined ? moduleCopy('help.value.none') : `${target.provider}/${target.model}`

/**
 * 「本次新版」导览构建函数（v2.1.0「路由信息架构统一」）。
 * 静态、只读、无 live 值。下一版若无新版导览，整块替换即可。
 */
export function buildWhatsNew(t: T): readonly HelpWhatsNewEntry[] {
  return [
    {
      id: 'whatsnew-chain',
      title: t('help.whatsNew.chain.title'),
      body: [
        t('help.whatsNew.chain.item0'),
        t('help.whatsNew.chain.item1'),
        t('help.whatsNew.chain.item2'),
        t('help.whatsNew.chain.item3'),
        t('help.whatsNew.chain.item4'),
      ],
    },
    {
      id: 'whatsnew-scope',
      title: t('help.whatsNew.scope.title'),
      body: [
        t('help.whatsNew.scope.item0'),
        t('help.whatsNew.scope.item1'),
        t('help.whatsNew.scope.item2'),
      ],
    },
    {
      id: 'whatsnew-routes',
      title: t('help.whatsNew.routes.title'),
      body: [
        t('help.whatsNew.routes.item0'),
        t('help.whatsNew.routes.item1'),
        t('help.whatsNew.routes.item2'),
        t('help.whatsNew.routes.item3'),
      ],
    },
    {
      id: 'whatsnew-write',
      title: t('help.whatsNew.write.title'),
      body: [
        t('help.whatsNew.write.item0'),
        t('help.whatsNew.write.item1'),
        t('help.whatsNew.write.item2'),
      ],
    },
    {
      id: 'whatsnew-dispatch-preview',
      title: t('help.whatsNew.dispatchPreview.title'),
      body: [
        t('help.whatsNew.dispatchPreview.item0'),
        t('help.whatsNew.dispatchPreview.item1'),
        t('help.whatsNew.dispatchPreview.item2'),
      ],
    },
    {
      id: 'whatsnew-wiring',
      title: t('help.whatsNew.wiring.title'),
      body: [
        t('help.whatsNew.wiring.item0'),
        t('help.whatsNew.wiring.item1'),
        t('help.whatsNew.wiring.item2'),
      ],
    },
  ]
}

/**
 * 说明页 8 分区构建函数。受覆盖闸（锚点双向覆盖）与 FEATURE_KEYS 防腐烂闸约束。
 */
export function buildHelpSections(t: T): readonly HelpSection[] {
  return [
    {
      id: 'dock',
      title: t('help.section.dock.title'),
      defaultOpen: true,
      entries: [
        {
          id: 'dock-label',
          title: t('help.section.dock.label.title'),
          anchors: ['label'],
          body: [t('help.section.dock.label.body0')],
        },
        {
          id: 'dock-chain',
          title: t('help.section.dock.chain.title'),
          anchors: ['preset-chip', 'baseline-chip', 'decision-chip'],
          body: [
            t('help.section.dock.chain.body0'),
            t('help.section.dock.chain.body1'),
            t('help.section.dock.chain.body2'),
            t('help.section.dock.chain.body3'),
          ],
          live: (c) => {
            const preset = presetOf(c)
            if (preset === undefined) return t('help.section.dock.chain.liveClosed')
            return t('help.section.dock.chain.liveActive', { 0: preset.name, 1: targetKey(preset.default) })
          },
        },
        {
          id: 'dock-decision-toggle',
          title: t('help.section.dock.decisionToggle.title'),
          anchors: ['decision-toggle'],
          body: [
            t('help.section.dock.decisionToggle.body0'),
            t('help.section.dock.decisionToggle.body1'),
            t('help.section.dock.decisionToggle.body2'),
          ],
        },
        {
          id: 'dock-quota',
          title: t('help.section.dock.quota.title'),
          anchors: ['week-quota', 'fivehour-quota', 'balance-slot'],
          body: [
            t('help.section.dock.quota.body0'),
            t('help.section.dock.quota.body1'),
            t('help.section.dock.quota.body2'),
            t('help.section.dock.quota.body3'),
          ],
        },
        {
          id: 'dock-image',
          title: t('help.section.dock.image.title'),
          anchors: ['image-context'],
          body: [
            t('help.section.dock.image.body0'),
            t('help.section.dock.image.body1'),
          ],
        },
        {
          id: 'dock-dispatch',
          title: t('help.section.dock.dispatch.title'),
          anchors: ['dispatch'],
          body: [
            t('help.section.dock.dispatch.body0'),
            t('help.section.dock.dispatch.body1'),
            t('help.section.dock.dispatch.body2'),
          ],
        },
        {
          id: 'dock-fetch',
          title: t('help.section.dock.fetch.title'),
          anchors: ['fetched-at', 'refresh'],
          body: [
            t('help.section.dock.fetch.body0'),
            t('help.section.dock.fetch.body1'),
          ],
        },
        {
          id: 'dock-kimi-warning',
          title: t('help.section.dock.kimiWarning.title'),
          anchors: ['kimi-warning'],
          body: [
            t('help.section.dock.kimiWarning.body0'),
            t('help.section.dock.kimiWarning.body1'),
          ],
        },
        {
          id: 'dock-states',
          title: t('help.section.dock.states.title'),
          anchors: ['notice', 'dock-states'],
          body: [
            t('help.section.dock.states.body0'),
            t('help.section.dock.states.body1'),
          ],
        },
      ],
    },
    {
      id: 'faq',
      title: t('help.section.faq.title'),
      defaultOpen: true,
      entries: [
        {
          id: 'faq-review',
          title: t('help.section.faq.review.title'),
          body: [
            t('help.section.faq.review.body0'),
            t('help.section.faq.review.body1'),
            t('help.section.faq.review.body2'),
          ],
        },
        {
          id: 'faq-revise',
          title: t('help.section.faq.revise.title'),
          body: [
            t('help.section.faq.revise.body0'),
            t('help.section.faq.revise.body1'),
            t('help.section.faq.revise.body2'),
          ],
        },
        {
          id: 'faq-at-ignored',
          title: t('help.section.faq.atIgnored.title'),
          body: [
            t('help.section.faq.atIgnored.body0'),
            t('help.section.faq.atIgnored.body1'),
            t('help.section.faq.atIgnored.body2'),
          ],
        },
        {
          id: 'faq-no-decision',
          title: t('help.section.faq.noDecision.title'),
          body: [
            t('help.section.faq.noDecision.body0'),
            t('help.section.faq.noDecision.body1'),
          ],
        },
        {
          id: 'faq-quota-dash',
          title: t('help.section.faq.quotaDash.title'),
          body: [
            t('help.section.faq.quotaDash.body0'),
            t('help.section.faq.quotaDash.body1'),
          ],
        },
        {
          id: 'faq-route-unexpected',
          title: t('help.section.faq.routeUnexpected.title'),
          body: [
            t('help.section.faq.routeUnexpected.body0'),
            t('help.section.faq.routeUnexpected.body1'),
          ],
        },
        {
          id: 'faq-keyword-miss',
          title: t('help.section.faq.keywordMiss.title'),
          body: [
            t('help.section.faq.keywordMiss.body0'),
            t('help.section.faq.keywordMiss.body1'),
          ],
        },
      ],
    },
    {
      id: 'routing',
      title: t('help.section.routing.title'),
      entries: [
        {
          id: 'routing-preset',
          title: t('help.section.routing.preset.title'),
          anchors: ['presets'],
          body: [
            t('help.section.routing.preset.body0'),
            t('help.section.routing.preset.body1'),
          ],
          live: (c) => {
            const name = presetOf(c)?.name ?? (c.activePreset ?? t('view.fallback.closed'))
            return t('help.section.routing.preset.live', { 0: name })
          },
        },
        {
          id: 'routing-rules',
          title: t('help.section.routing.rules.title'),
          anchors: ['rules', 'preset-editor'],
          body: [
            t('help.section.routing.rules.body0'),
            t('help.section.routing.rules.body1'),
            t('help.section.routing.rules.body2'),
          ],
          live: (c) => {
            const preset = presetOf(c)
            if (preset === undefined || preset.rules.length === 0) return undefined
            const first = preset.rules[0]!
            const when = first.when.kind === 'image'
              ? t('help.section.routing.rules.liveImage')
              : t('help.section.routing.rules.liveKeywords', { 0: first.when.group, 1: String(first.when.minHits ?? 1) })
            return t('help.section.routing.rules.live', { 0: String(preset.rules.length), 1: when })
          },
        },
        {
          id: 'routing-hit-confirm',
          title: t('help.section.routing.hitConfirm.title'),
          anchors: ['hit-confirm'],
          body: [
            t('help.section.routing.hitConfirm.body0'),
            t('help.section.routing.hitConfirm.body1'),
            t('help.section.routing.hitConfirm.body2'),
          ],
          live: (c) => {
            const preset = presetOf(c)
            if (preset === undefined) return undefined
            const gate = preset.hitConfirm
            return gate?.enabled === true
              ? t('help.section.routing.hitConfirm.liveOn', { 0: targetKey(preset.default), 1: String(gate.timeoutMs ?? 1200) })
              : t('help.section.routing.hitConfirm.liveOff')
          },
        },
        {
          id: 'routing-ops',
          title: t('help.section.routing.ops.title'),
          anchors: ['preset-ops'],
          body: [
            t('help.section.routing.ops.body0'),
            t('help.section.routing.ops.body1'),
          ],
        },
        {
          id: 'routing-fallback',
          title: t('help.section.routing.fallback.title'),
          anchors: ['image-fallback'],
          body: (Object.entries(FALLBACK_HINTS_KEYS) as [ImageFallback, CopyKey][]).map(
            ([k, key]) => t('help.join.labeled', { 0: k, 1: t(key) }),
          ),
          live: (c) => {
            const preset = presetOf(c)
            if (preset === undefined) return undefined
            const mode = preset.imageFallback ?? 'latch'
            return t('help.section.routing.fallback.live', { 0: mode, 1: t(FALLBACK_HINTS_KEYS[mode]) })
          },
        },
        {
          id: 'routing-roles',
          title: t('help.section.routing.roles.title'),
          anchors: ['roles'],
          body: [
            t('help.section.routing.roles.body0'),
            t('help.section.routing.roles.body1'),
            t('help.section.routing.roles.body2'),
          ],
          live: (c) => {
            const roles = (c as { roles?: Record<string, unknown> }).roles
            const n = roles === undefined ? 0 : Object.keys(roles).length
            return n === 0
              ? t('help.section.routing.roles.liveEmpty')
              : t('help.section.routing.roles.liveCount', { 0: String(n) })
          },
        },
        {
          id: 'routing-driver',
          title: t('help.section.routing.driver.title'),
          anchors: ['driver', 'dispatch'],
          body: [
            t('help.section.routing.driver.body0'),
            t('help.section.routing.driver.body1'),
            t('help.section.routing.driver.body2'),
          ],
        },
        {
          id: 'routing-guard',
          title: t('help.section.routing.guard.title'),
          anchors: ['driver', 'roles'],
          body: [
            t('help.section.routing.guard.body0'),
            t('help.section.routing.guard.body1'),
            t('help.section.routing.guard.body2'),
            t('help.section.routing.guard.body3'),
          ],
        },
      ],
    },
    {
      id: 'keywords',
      title: t('help.section.keywords.title'),
      entries: [
        {
          id: 'keywords-groups',
          title: t('help.section.keywords.groups.title'),
          anchors: ['keyword-groups'],
          body: [
            t('help.section.keywords.groups.body0'),
            t('help.section.keywords.groups.body1'),
          ],
          live: (c) => t('help.section.keywords.groups.live', { 0: String(Object.keys(c.keywordGroups).length) }),
        },
        {
          id: 'keywords-match',
          title: t('help.section.keywords.match.title'),
          anchors: ['rules'],
          body: [
            t('help.section.keywords.match.body0'),
            t('help.section.keywords.match.body1'),
          ],
        },
        {
          id: 'keywords-minhits',
          title: t('help.section.keywords.minhits.title'),
          anchors: ['keyword-groups', 'rules'],
          body: [
            t('help.section.keywords.minhits.body0'),
            t('help.section.keywords.minhits.body1'),
          ],
        },
      ],
    },
    {
      id: 'flows',
      title: t('help.section.flows.title'),
      v5Only: true,
      entries: [
        {
          id: 'flows-transcribe',
          title: t('help.section.flows.transcribe.title'),
          anchors: ['flows'],
          body: [
            t('help.section.flows.transcribe.body0'),
            t('help.section.flows.transcribe.body1'),
          ],
          live: (c) => {
            const flow = v5(c)?.flows.transcribe
            if (flow === undefined || flow.type !== 'transcribe') return undefined
            return t('help.section.flows.transcribe.live', { 0: targetKey(flow.visionModel), 1: flow.failurePolicy })
          },
        },
        {
          id: 'flows-review-fields',
          title: t('help.section.flows.reviewFields.title'),
          anchors: ['flows'],
          body: [
            t('help.section.flows.reviewFields.body0'),
            t('help.section.flows.reviewFields.body1'),
            t('help.section.flows.reviewFields.body2'),
            t('help.section.flows.reviewFields.body3'),
            t('help.section.flows.reviewFields.body4'),
          ],
        },
        {
          id: 'flows-revise',
          title: t('help.section.flows.revise.title'),
          anchors: ['flows'],
          body: [
            t('help.section.flows.revise.body0'),
            t('help.section.flows.revise.body1'),
            t('help.section.flows.revise.body2'),
          ],
          live: (c) => {
            const flow = v5(c)?.flows.review
            if (flow === undefined || flow.type !== 'review') return undefined
            return t('help.section.flows.revise.live', {
              0: flow.autoRevise ? t('help.section.flows.revise.liveOn') : t('help.section.flows.revise.liveOff'),
              1: flow.recheck === false ? t('help.section.flows.revise.liveOff') : t('help.section.flows.revise.liveOn'),
              2: String(flow.rounds),
            })
          },
        },
        {
          id: 'flows-trigger',
          title: t('help.section.flows.trigger.title'),
          anchors: ['flows'],
          body: [
            t('help.section.flows.trigger.body0'),
            t('help.section.flows.trigger.body1'),
          ],
          live: (c) => {
            const flow = v5(c)?.flows.review
            if (flow === undefined || flow.type !== 'review') return undefined
            return flow.trigger === 'keywords'
              ? t('help.section.flows.trigger.liveKeywords', { 0: flow.keywordGroup ?? t('help.section.flows.trigger.liveKeywordsUnselected') })
              : t('help.section.flows.trigger.liveManual')
          },
        },
        {
          id: 'flows-claim',
          title: t('help.section.flows.claim.title'),
          anchors: ['flows', 'rules'],
          body: [
            t('help.section.flows.claim.body0'),
            t('help.section.flows.claim.body1'),
          ],
        },
        {
          id: 'flows-delete-guard',
          title: t('help.section.flows.deleteGuard.title'),
          anchors: ['flows'],
          body: [
            t('help.section.flows.deleteGuard.body0'),
          ],
        },
      ],
    },
    {
      id: 'usage',
      title: t('help.section.usage.title'),
      entries: [
        {
          id: 'usage-sources',
          title: t('help.section.usage.sources.title'),
          anchors: ['week-quota', 'fivehour-quota'],
          body: [
            t('help.section.usage.sources.body0'),
            t('help.section.usage.sources.body1'),
          ],
        },
        {
          id: 'usage-dash',
          title: t('help.section.usage.dash.title'),
          anchors: ['week-quota', 'fivehour-quota', 'fetched-at'],
          body: [
            t('help.section.usage.dash.body0'),
            t('help.section.usage.dash.body1'),
          ],
        },
        {
          id: 'usage-overview',
          title: t('help.section.usage.overview.title'),
          anchors: ['overview-toggle'],
          body: [
            t('help.section.usage.overview.body0'),
            t('help.section.usage.overview.body1'),
          ],
        },
        {
          id: 'usage-monthly',
          title: t('help.section.usage.monthly.title'),
          anchors: ['week-quota', 'fivehour-quota'],
          body: [
            t('help.section.usage.monthly.body0'),
            t('help.section.usage.monthly.body1'),
          ],
        },
        {
          id: 'usage-refresh',
          title: t('help.section.usage.refresh.title'),
          anchors: ['refresh'],
          body: [
            t('help.section.usage.refresh.body0'),
            t('help.section.usage.refresh.body1'),
          ],
        },
      ],
    },
    {
      id: 'glossary',
      title: t('help.section.glossary.title'),
      entries: [
        {
          id: 'glossary-terms',
          title: t('help.section.glossary.terms.title'),
          anchors: ['rules'],
          body: [
            t('help.section.glossary.terms.body0'),
            t('help.section.glossary.terms.body1'),
            t('help.section.glossary.terms.body2'),
            t('help.section.glossary.terms.body3'),
            t('help.section.glossary.terms.body4'),
            t('help.section.glossary.terms.body5'),
            t('help.section.glossary.terms.body6'),
          ],
        },
      ],
    },
    {
      id: 'commands',
      title: t('help.section.commands.title'),
      entries: [
        {
          id: 'commands-list',
          title: t('help.section.commands.list.title'),
          body: [
            t('help.section.commands.list.body0'),
            t('help.section.commands.list.body1'),
            t('help.section.commands.list.body2'),
            t('help.section.commands.list.body3'),
          ],
        },
        {
          id: 'commands-trial',
          title: t('help.section.commands.trial.title'),
          anchors: ['trial', 'preset-editor'],
          body: [
            t('help.section.commands.trial.body0'),
            t('help.section.commands.trial.body1'),
          ],
        },
      ],
    },
  ]
}

/**
 * FALLBACK_HINTS 内部用的键映射（避免循环引用 FALLBACK_HINTS_KEYS 在上面已导出）。
 * 注：上面 buildHelpSections 里的 routing-fallback 使用 FALLBACK_HINTS_KEYS（导出版本）。
 */
const FALLBACK_HINTS_KEYS: Record<ImageFallback, CopyKey> = FALLBACK_HINT_KEYS

/**
 * 向后兼容导出：用模块级 copy()（zh 回落）构建默认实例。
 * 既有测试直接 import HELP_SECTIONS / WHATS_NEW 做结构断言——
 * 无 locale 服务时 copy() 回落中文表，产出的字符串与改动前逐字一致。
 */
export const HELP_SECTIONS: readonly HelpSection[] = buildHelpSections(moduleCopy)
export const WHATS_NEW: readonly HelpWhatsNewEntry[] = buildWhatsNew(moduleCopy)
