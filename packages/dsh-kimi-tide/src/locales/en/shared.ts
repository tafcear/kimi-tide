/**
 * shared 表（英文镜像）：键集必须与 zh/shared.ts 完全相等（Record 类型钉住）。
 * 术语镜像遵循 docs/agents/terminology.md §1：默认目标 = default target、
 * 主会话 / 派发时 = main session / on dispatch、已接入 = wired / not wired、
 * 当前取值 = current value；标签用名词短语，说明用陈述句。
 */
import { zh } from '../zh/shared.js'

export const en: Record<keyof typeof zh, string> = {
  'shared.nav': 'Kimi Tide',
  'shared.panel.fetchFailed': 'Network request failed: {0}',
  'shared.panel.httpError': 'HTTP {0}',
  'shared.panel.invalidJson': 'Response body is not valid JSON',
  'shared.panel.okNotTrue': 'Route returned ok!=true',
  'shared.panel.noPanel': 'Route returned no panel data',
  'shared.diag.describeUnavailable': 'settings.describe channel unavailable (connection api face absent and loopback not mounted)',
  'shared.diag.mutateUnavailable': 'settings.mutate channel unavailable (connection api face absent and loopback not mounted)',
  'shared.diag.modelsUnavailable': 'Model catalog channel unavailable (session/llm loopback and connection api both absent)',
  /* ---- config.ts read-boundary warnings (host-side diagnostics) ---- */
  'shared.diag.routesRowMalformedRead': 'dsh-kimi-tide: routes row {0} is malformed (not an object or invalid scope); conservatively dropped on the read path',
  'shared.diag.routesNotArray': 'dsh-kimi-tide: routes is not an array (treated as absent on the read path; falling back to the presets[*].rules / roles projection)',
  'shared.diag.routesRowMalformedProject': 'dsh-kimi-tide: routes row {0} is malformed (not an object or invalid scope); conservatively dropped during projection',
  /* ---- rules.ts ---- */
  'shared.rules.image': 'With image',
  'shared.rules.condition': 'Group {0}: ≥{1} word(s) hit',
  'shared.rules.off': 'Routing is off',
  'shared.rules.presetMissing': 'Active preset does not exist',
  'shared.rules.explicit.unknownCatalog': 'Explicit @{0} mention (candidate catalog cannot be judged)',
  'shared.rules.explicit.directive': 'Explicit @{0}{1} mention',
  'shared.rules.explicit.fallback': 'Explicit @{0}{1} mention (unavailable → fallback)',
  'shared.rules.explicit.configured': 'Explicit @{0} mention → configured target in the preset',
  'shared.rules.explicit.catalogFirst': 'Explicit @{0} mention → first in catalog order',
  'shared.rules.ruleHitFlow': 'Rule "{0}" hit {1} word(s) (flow {2})',
  'shared.rules.ruleHit': 'Rule "{0}" hit {1} word(s)',
  'shared.rules.reviewFlow': 'Review flow {0} triggers at the end of the turn',
  'shared.rules.reviewFlowUnavailable': 'Review flow claimed but the reviewer model is unavailable',
  'shared.rules.presetDefault': 'Preset "{0}" default',
  /* ---- roles.ts ---- */
  'shared.roles.teammateNameRule': 'lower-kebab-case (lowercase letters/digits/hyphens), ≤64 characters, must not be lead',
  'shared.roles.claimConflict': 'Claimed name "{0}" belongs to both role "{1}" and "{2}"',
  'shared.roles.listJoin': ', ',
  'shared.roles.readFirst': 'Read before dispatching: {0}',
  'shared.roles.readFirstOverflow': 'Read before dispatching: {0} role(s) in total ({1}…)',
  'shared.roles.effortSuffix': ' (effort {0})',
  /* ---- dispatch guard: denial reason when a role's domain goes to a bare subagent.
     The guard is host `ctx.tools.guard` — deny only, never reroute — so the copy must
     carry the next step itself; {0}=role id/teammate name {1}=role label {2}=fix hint. ---- */
  'shared.roles.guard.rejectSubagent': 'This task matches role "{1}": dispatch it to that role\'s teammate `{0}`. A bare subagent never takes part in assignment-table rerouting and runs on the default model. Do: `spawn_teammate(name="{0}", …)` to create the teammate (dispatch straight to it when it already exists), then send the same task; when the task does not belong to that role, drop the "{1}" domain word and dispatch again. Alternative: {2}',
  'shared.roles.guard.fixHint': 'give role "{0}" a keywords list (comma-separated): once set it takes precedence over the domain match, and an empty list falls back to the label and aliases.',
  'shared.roles.guard.roleKeywordsFallback': 'Role "{0}" declares no keywords, so this match fell back to its label and aliases; add keywords for that role in settings to tighten or widen it.',
  /* ↑ both {0}s above are the role LABEL: one denial reason keeps one name for the role
     (the id appears only as rejectSubagent's {0}, i.e. the teammate name to dispatch to). */
  'shared.roles.skill.title': '# Kimi Tide assignment table (team dispatch)',
  'shared.roles.skill.intro': 'When a task belongs to a specific domain, **spawn the role\'s teammate with `spawn_teammate`** (the teammate name comes from the "Teammate names (claimed)" column above or the role id) instead of doing it yourself — and never hand it to a bare subagent.',
  'shared.roles.skill.tableHeader': '| Role | id | Target model | Teammate names (claimed) | Aliases | Note |',
  'shared.roles.skill.howto': '## How to dispatch (both forms required)',
  'shared.roles.skill.oneShot': '1. **One-shot tasks** (disposed when done): use `workflow`\'s `agent(prompt, { provider, model })` with a target from the table above; the prompt must carry all context the task needs.',
  'shared.roles.skill.persistent': '2. **Standing teammates** (reusable across turns): create one with `spawn_teammate`; **the teammate name must come from the "Teammate names (claimed)" column above** (or the role id) — Kimi Tide reroutes its requests to the target model accordingly.',
  'shared.roles.skill.nameRuleTitle': '## Teammate name validity',
  'shared.roles.skill.nameRule': 'A teammate name must satisfy: {0}; names are never reused, and a failed attempt still consumes the name.',
  'shared.roles.skill.whenNot': '## When not to dispatch',
  'shared.roles.skill.whenNot1': '- Work too trivial to justify a subagent (fixing a typo, a one-line question);',
  'shared.roles.skill.whenNot2': '- Domains with no matching role — answer it yourself, or ask the user to add a role in settings first;',
  'shared.roles.skill.whenNot3': '- Continuous operations tightly coupled to the current context (a subagent only has the prompt you give it).',
  /* ---- review-verdict.ts ---- */
  'shared.verdict.pass': 'Pass',
  'shared.verdict.conditional': 'Conditional pass',
  'shared.verdict.fail': 'Fail',
  'shared.verdict.unknown': 'No clear verdict',
  'shared.verdict.wordNotPassed': 'Not passed',
  'shared.verdict.wordNeedsChanges': 'Changes needed',
  /* ---- config.ts built-in defaults ---- */
  'shared.config.preset.saving': 'Saving',
  'shared.config.preset.capability': 'Capability',
  'shared.config.kw.code': 'code\nbug\nrefactor\nimplement\nfunction\ntest\ninterface\nintegration\ndeploy\nperformance\nerror\nlog\ncompile\ncommand\nscript',
  'shared.config.kw.chitchat': 'hello\nthanks\nhow are you\nwhatever\nchat\nweather',
  'shared.config.kw.review': 'review\ncritique\nrecheck\ncheck\naudit\nfeedback\nscore',
  'shared.config.kw.writing': 'writing\ncopy\npolish\nrewrite\nexpand\nheadline\npost\nweekly report\nspeech\nsummary',
  'shared.config.kw.translate': 'translate\ntranslation\nlocalize\nlocalization',
  'shared.config.kw.longdoc': 'long document\nread through\nsection by section\nfull text\nlong file',
  'shared.config.kw.math': 'math\nproof\nderivation\nsolve\nformula\nnumber theory\nprobability\nlogic puzzle',
}
