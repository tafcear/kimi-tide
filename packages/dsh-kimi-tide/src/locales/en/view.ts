/**
 * view 表（英文镜像）：键集必须与 zh/view.ts 完全相等（Record 类型钉住）。
 * 术语镜像遵循 docs/agents/terminology.md §1：默认目标 = default target、
 * 主会话 = main session、派发 = dispatch、已接入 = wired。
 */
import { zh } from '../zh/view.js'

export const en: Record<keyof typeof zh, string> = {
  'view.fallback.closed': 'Routing is off',
  'view.fallback.presetMissing': 'Active preset does not exist',
  'view.fallback.driverFollowHost': 'Driver follows the host default',
  'view.fallback.driverSticky': 'Driver pinned ({0})',
  'view.fallback.presetDefault': 'Preset "{0}" default',
  'view.tier.at.title': 'Explicit @mention',
  'view.tier.at.detail': 'On demand: participates in routing only when @provider or @provider/model is written in the message',
  'view.tier.caller.title': 'Caller-named model',
  'view.tier.caller.detail': 'On demand: subagents only; a caller-named model different from the default target is kept unchanged',
  'view.tier.role.title': 'Assignment table roles',
  'view.tier.role.detailClosedWithRoles': 'Routing is off: the assignment table\'s {0} role(s) cause no rerouting (archived only)',
  'view.tier.role.detailClosedEmpty': 'Routing is off (no assignment table configured)',
  'view.tier.role.detailActive': '{0} role(s) participate in dispatch rerouting',
  'view.tier.role.detailEmpty': 'No assignment table configured (teammates are not rerouted)',
  'view.tier.rule.title': 'Keyword rules',
  'view.tier.rule.detailInactive': 'Routing is not active',
  'view.tier.rule.detailRules': 'Preset "{0}" has {1} rule(s) (main session only)',
  'view.tier.rule.detailEmpty': 'Preset "{0}" has no rules; a miss uses the default target',
  'view.tier.fallback.title': 'Default target',
  'view.tier.fallback.detail': '{0} ({1})',
  'view.join.list': ', ',
  'view.join.chunk': ' · ',
  'view.label.image': 'with image',
  'view.label.flow': 'flow {0}',
  'view.fallbackShort.latch': 'latch vision model',
  'view.fallbackShort.blind': 'blind answer',
  'view.fallbackShort.transcribeLazy': 'lazy transcription',
  'view.summary.closed': 'Routing is off: all requests keep the host\'s current model.',
  'view.summary.presetMissing': 'Routing is off: the active preset does not exist.',
  'view.summary.hostDefault': 'host default',
  'view.summary.noRules': 'The main session has no matchable rules; everything uses the default target ({0})',
  'view.summary.orphanSuffix': '; another {0} keyword group(s) are not wired into any rule and stay inactive',
  'view.summary.ruleItem': '"{0}" switches to {1}',
  'view.summary.mainRules': 'The main session uses {0} as the default target; {1}',
  'view.summary.dispatch': 'Dispatch: {0}',
  'view.summary.dispatchItem': '{0}→{1}',
  'view.summary.image': 'With image: {0}',
}
