/**
 * help table (English mirror). Key set pinned to zh via Record<keyof typeof zh, string>.
 * Register: terminology.md §1 English mirrors + §2 product-grade tone.
 *   - Labels = noun phrases; explanations = declarative sentences.
 *   - No metaphors, no colloquialisms, no exclamation marks.
 *   - One concept → one word throughout.
 */
import { zh } from '../zh/help.js'

export const en: Record<keyof typeof zh, string> = {
  /* ======== HelpTab chrome ======== */
  'help.tab.hint': 'This page explains every panel element and every settings field. The top section covers how to read the routing page in this version (five-tier decision chain / scope / unified route table). For deeper design details, see packages/dsh-kimi-tide/docs/router.md in the repository.',
  'help.tab.whatsNewSummary': 'What\'s new: how to read the routing page',

  /* ======== FALLBACK_HINTS (cross-module single source; key names frozen) ======== */
  'help.fallback.latch': 'Locks the vision model after an image turn; subsequent text turns continue through vision',
  'help.fallback.blind': 'Treats text turns as imageless — cannot see prior images; may answer blindly',
  'help.fallback.transcribeLazy': 'Transcribes prior images to text before answering in text turns (one extra vision call)',

  /* ======== WHATS_NEW tour (v2.1.0) ======== */
  'help.whatsNew.chain.title': 'Routing page redesigned from four parallel controls to a five-tier decision chain',
  'help.whatsNew.chain.item0': 'Each message is assigned a model by priority, top to bottom: **explicit @ > caller nomination > role table > keyword rules > default target**.',
  'help.whatsNew.chain.item1': 'Each tier shows three lines: trigger / current value / when disabled. The **role table** is inline at tier 3; the **rule editor** is inline at tier 4.',
  'help.whatsNew.chain.item2': 'Each tier carries a status badge: **ready** (actively participates in decisions) / **on demand** (only when `@` or teammate nomination occurs) / **not enabled** (nothing configured at this tier; shown dimmed).',
  'help.whatsNew.chain.item3': '**The default-target tier is now explicitly visible** (with its source noted: sticky main driver / preset default / host default). Disabled tiers are dimmed, not hidden.',
  'help.whatsNew.chain.item4': 'A one-line summary at the top describes the current state. When no rules are configured it still explains: "No rules match in the main session; all requests use the default target (…); N keyword groups are not wired to any rule and have no effect."',

  'help.whatsNew.scope.title': 'Scope: rule rows apply to the main session; role rows apply on dispatch',
  'help.whatsNew.scope.item0': 'Keyword rules serve the **main session** only; the role table serves **teammates** only (subagents do not participate in keyword rules by default). The two never conflict — the apparent conflict came from unclear labeling.',
  'help.whatsNew.scope.item1': 'Rule rows now carry a "main session" badge and role rows carry an "on dispatch" badge. With scope labeled clearly, what looked like a conflict is actually a division of labor.',
  'help.whatsNew.scope.item2': 'The dispatch ledger uses the same vocabulary: `role` = claimed by role table / `explicit` = explicit nomination / `keep` = kept as-is / `unclaimed` = not in the role table.',

  'help.whatsNew.routes.title': 'Unified route table `routes` (config v7)',
  'help.whatsNew.routes.item0': 'Two row types merge into one table: `scope: session` rows = main-session rules (image / keyword group, with `preset` ownership); `scope: dispatch` rows = role assignments.',
  'help.whatsNew.routes.item1': '**When `routes` exists, it is the source of truth.** Legacy fields (`presets[*].rules` / `roles`) are retained as **mirrors** — removing the `routes` section reverts to legacy semantics without breaking functionality.',
  'help.whatsNew.routes.item2': 'Runtime reads by **field**, not by version number: configs that explicitly declare `version: 5` or `6` work identically, and the settings page never overwrites your `version`.',
  'help.whatsNew.routes.item3': 'If manual edits leave the two representations inconsistent, write-time validation **rejects the change and reports the conflict location** (no silent resolution).',

  'help.whatsNew.write.title': 'Dual-write when saving rules or roles',
  'help.whatsNew.write.item0': 'Saving a rule or role issues **both** `routes` and the mirrored legacy fields in the same write, keeping the file consistent at all times.',
  'help.whatsNew.write.item1': 'The channel performs a **three-step sequence**: remove `routes` → write legacy fields → write back `routes`. The order is a hard constraint: the host validates consistency between the two representations on each step, and rejects intermediate states.',
  'help.whatsNew.write.item2': 'After writing, intended values are compared against actual values as before — rejections report "write rejected" explicitly rather than being swallowed silently.',

  'help.whatsNew.dispatchPreview.title': 'Test bench "dispatch to whom": dispatch-layer preview',
  'help.whatsNew.dispatchPreview.item0': 'Enter or select a role or teammate name to see which model it routes to and why (`role` / `unclaimed`).',
  'help.whatsNew.dispatchPreview.item1': 'This and "try a sentence" operate in **separate scopes**: "try a sentence" evaluates main-session keyword rules; "dispatch to whom" evaluates the dispatch-time role table.',
  'help.whatsNew.dispatchPreview.item2': 'The role table also offers "**generate roles from keyword groups**": batch-create role rows for groups not yet wired to any rule (target defaults to the current preset\'s default model; adjustable via dropdown).',

  'help.whatsNew.wiring.title': 'Keyword-group wiring badges and overlap explanation bars',
  'help.whatsNew.wiring.item0': 'Each keyword group displays its wiring status: `wired to N rules` / `claimed by collaboration flow` / `⚠ not wired`. An empty table is not broken — it is simply not wired yet.',
  'help.whatsNew.wiring.item1': 'When the same word is both a rule target and a role identity token (id / display name / alias) with different targets on each side, both the keyword row and the role row show an **explanation bar (not an error)**:',
  'help.whatsNew.wiring.item2': '"Main session routes \'code\' to A; dispatching to \'backend\' routes to B" — the two scopes operate independently and do not conflict. A one-click action beside the bar can align the rule target with the role target.',

  /* ======== §1 dock — panel overview ======== */
  'help.section.dock.title': 'Panel overview',
  'help.section.dock.label.title': 'Kimi Tide',
  'help.section.dock.label.body0': 'Plugin identity label. Hover tooltip reads "Routing settings: Settings → Kimi Tide".',

  'help.section.dock.chain.title': 'Routing chain chips: preset → default target ⟶ decision target',
  'help.section.dock.chain.body0': 'Preset: the active rule set. "Off" means routing is explicitly disabled, not broken.',
  'help.section.dock.chain.body1': 'Default target: the target used when no rule matches.',
  'help.section.dock.chain.body2': 'Decision target: **the model actually selected for this step**. When it differs from the default target, a rule or explicit @ took effect.',
  'help.section.dock.chain.body3': 'In compact mode the three chips collapse into one button: `economy → deepseek-flash`. When a target appears on the right it is the **decision target**; otherwise it is the **default target**.',
  'help.section.dock.chain.liveClosed': 'Current: routing off',
  'help.section.dock.chain.liveActive': 'Current: {0} → default target {1}',

  'help.section.dock.decisionToggle.title': 'Decision toggle (▸ / ▾)',
  'help.section.dock.decisionToggle.body0': 'Expands the decision-observability overlay to explain why this model was selected.',
  'help.section.dock.decisionToggle.body1': '**Default target and "keep as-is" do not appear on screen** — absence of a reason bar does not indicate an error.',
  'help.section.dock.decisionToggle.body2': 'In compact mode, tapping the "preset → target" button acts as the toggle.',

  'help.section.dock.quota.title': 'Weekly quota / 5h quota slots (usage sources) · balance slot (API billing)',
  'help.section.dock.quota.body0': 'Automatically switches data source and format based on the **current matched target**\'s provider: code plans show two usage windows; API billing sources show balance.',
  'help.section.dock.quota.body1': 'Compact mode shows a single summary (`¥3.94` or `week left NN%`); tap it to expand the **usage overview** for all sources and details.',
  'help.section.dock.quota.body2': 'The usage bar renders the **remaining** proportion, aligned with the adjacent "N% left" label: more remaining = longer bar; near exhaustion = short red bar.',
  'help.section.dock.quota.body3': 'The balance slot shows the total (first currency when multiple exist; others appear in the hover tooltip). When the balance is insufficient for API calls, it is marked "insufficient balance".',

  'help.section.dock.image.title': 'Image context slot (native / transcribed / blind)',
  'help.section.dock.image.body0': 'Three dispositions for images in this session: native vision / transcribed to text / blind (images present but invisible to the text model).',
  'help.section.dock.image.body1': 'When blind > 0 a visible warning is appended — **this line does not render in imageless sessions**.',

  'help.section.dock.dispatch.title': 'Dispatch slot (team dispatch summary)',
  'help.section.dock.dispatch.body0': 'The most recent specialist task dispatch: which role\'s model received it and why (role = role table / explicit = explicit nomination / keep = kept as-is / unclaimed = not in role table).',
  'help.section.dock.dispatch.body1': 'Expand the decision-observability overlay to view the last 20 dispatch entries (newest first).',
  'help.section.dock.dispatch.body2': 'This slot does not render when no dispatch has occurred in this session.',

  'help.section.dock.guard.title': 'Dispatch guard status slot',
  'help.section.dock.guard.body0': '"Guard: active" means the dispatch guard is registered; plain subagent dispatches that hit a role domain are rejected.',
  'help.section.dock.guard.body1': '"Guard: inactive (switch off / no active preset)" renders dimmed — you turned it off yourself; behavior matches having no guard, so it is not an alarm.',
  'help.section.dock.guard.body2': '"Guard: inactive (tools service absent / guard API unavailable / registration failed)" renders as a warning — the switch is on but the environment cannot provide the guard, so dispatches are NOT intercepted; hover for the specific reason.',

  'help.section.dock.fetch.title': 'Fetch time and refresh',
  'help.section.dock.fetch.body0': 'Shows the last successful quota fetch time. "(stale)" indicates the most recent refresh failed.',
  'help.section.dock.fetch.body1': 'The refresh button is equivalent to running `/kimi-tide refresh`.',

  'help.section.dock.kimiWarning.title': '"Kimi not wired" warning',
  'help.section.dock.kimiWarning.body0': 'Configuration guidance when kimi-coding routing or API key is missing — not an error alert.',
  'help.section.dock.kimiWarning.body1': 'Verify provider and apiKeyEnv under Settings → Models.',

  'help.section.dock.states.title': 'Command failure notice and empty states',
  'help.section.dock.states.body0': 'A command failure appends a notice at the end of the second line.',
  'help.section.dock.states.body1': 'Two global empty states: "Loading panel data…" and "No panel data available (routing off or fetch channel unavailable)".',

  /* ======== §2 faq — frequently asked questions ======== */
  'help.section.faq.title': 'Frequently asked questions',
  'help.section.faq.review.title': 'I configured a review model but no review runs',
  'help.section.faq.review.body0': 'Check the trigger mode first: in `manual` mode, keyword matches do **not** trigger review (only `/kimi-tide review` does).',
  'help.section.faq.review.body1': 'Switch to `keyword group` and select a group: the matched turn executes normally, and the review model runs an async review **at turn end**.',
  'help.section.faq.review.body2': 'Other causes: the turn produced no output; the message contained an explicit @; or the review model is unavailable (the UI marks the blind spot).',

  'help.section.faq.revise.title': 'Review says fail but the model did not redo',
  'help.section.faq.revise.body0': 'Check whether **auto-revise** is enabled on the settings page (off by default): when unchecked, review provides feedback only and does not auto-reject.',
  'help.section.faq.revise.body1': 'Manual rejection is always available: tap "**Redo**" on the review card, or run `/kimi-tide revise`.',
  'help.section.faq.revise.body2': 'If enabled but no rejection occurred: check whether the verdict was "pass"; also check whether the **cap has been reached** (per-session limit equals the configured rounds; once hit, the event card reads "stopped (cap reached)").',

  'help.section.faq.atIgnored.title': 'I typed @xxx but routing did not follow it',
  'help.section.faq.atIgnored.body0': '**Only real providers count as instructions**: if `@` is followed by a workspace path reference (`@README.md`) or a scoped package name (`node_modules/@deepseek-ai/…`), it is not treated as an explicit instruction — the turn follows keyword rules as usual.',
  'help.section.faq.atIgnored.body1': 'The decision reason bar states "`@x` is not a known provider for this router (ignored)". To nominate, use `@kimi` or `@provider/model`.',
  'help.section.faq.atIgnored.body2': 'Another case: the provider is recognized but no routable model is currently available (e.g., key not configured). In this case routing does **not** switch; the reason reads "provider known but no routable model available".',

  'help.section.faq.noDecision.title': 'No decision reason bar on the panel',
  'help.section.faq.noDecision.body0': 'This step used the default target or "keep as-is" — neither shows a reason bar by design.',
  'help.section.faq.noDecision.body1': 'A reason bar appears only on rule matches or explicit @.',

  'help.section.faq.quotaDash.title': 'Quota slot shows —',
  'help.section.faq.quotaDash.body0': 'Three causes: the current target\'s provider has no quota source (not applicable); the provider\'s key is not configured; or the fetch failed.',
  'help.section.faq.quotaDash.body1': 'Check whether "fetch time" is marked "(stale)" to distinguish the latter two. A single window showing — means that window has no data (not that it is full).',

  'help.section.faq.routeUnexpected.title': 'Routing did not switch models as expected',
  'help.section.faq.routeUnexpected.body0': 'Rules are sorted by **specificity** (more matched keywords wins; image always first; ties broken by list order). The first entry with an available target takes effect.',
  'help.section.faq.routeUnexpected.body1': 'So a rule later in the list but matching more keywords wins — expand the decision-observability overlay to see the actual match reason.',

  'help.section.faq.keywordMiss.title': 'Keyword did not match',
  'help.section.faq.keywordMiss.body0': 'Pure ASCII tokens match on **word boundaries** (`decode` does not match `code`); Chinese and multi-word phrases match as substrings. Matching is case-insensitive.',
  'help.section.faq.keywordMiss.body1': 'The group may also have been claimed by the review flow (suppressing its rules), or the rule\'s minimum hit count may be set too high.',

  /* ======== §3 routing — routing semantics ======== */
  'help.section.routing.title': 'Routing semantics',
  'help.section.routing.preset.title': 'Presets and activation',
  'help.section.routing.preset.body0': 'A preset is a set of "default model + ordered rules". Only one preset is active at a time.',
  'help.section.routing.preset.body1': '"Off" means no model switching at all — equivalent to disabling routing.',
  'help.section.routing.preset.live': 'Active: {0}',

  'help.section.routing.rules.title': 'Rule chain and specificity',
  'help.section.routing.rules.body0': 'Two rule conditions: image present, or matching the selected keyword group (optionally with a minimum hit count).',
  'help.section.routing.rules.body1': 'Matches are sorted by specificity (more matched keywords wins; image always first; ties broken by list order). The **first entry with an available target** takes effect.',
  'help.section.routing.rules.body2': 'If a target is unavailable in the candidate directory, that entry is skipped and the next one is tried (fallback, not failure).',
  'help.section.routing.rules.liveImage': 'image',
  'help.section.routing.rules.liveKeywords': '{0} group ≥{1} words',
  'help.section.routing.rules.live': 'Current: {0} rules; first condition "{1}"',

  'help.section.routing.hitConfirm.title': 'Semantic hit confirmation (off by default)',
  'help.section.routing.hitConfirm.body0': 'When enabled, a keyword match does not immediately reroute — the **preset\'s default model** first judges whether this is the true intent of the turn.',
  'help.section.routing.hitConfirm.body1': 'Verdict = no ⇒ skip this rule and continue matching subsequent rules. **Unreachable** (timeout / model unavailable / unreadable output) ⇒ fall back to the original keyword result.',
  'help.section.routing.hitConfirm.body2': 'Explicit @ turns and turns where an image rule already ranks first do not invoke the judge (the outcome cannot take effect; would waste one call).',
  'help.section.routing.hitConfirm.liveOn': 'Current: enabled (judge {0}, timeout {1}ms)',
  'help.section.routing.hitConfirm.liveOff': 'Current: off — keyword matches reroute directly by rule',

  'help.section.routing.ops.title': 'Preset operations (create / duplicate / delete)',
  'help.section.routing.ops.body0': 'Deleting a preset requires confirmation (the button changes to "Confirm delete?" first).',
  'help.section.routing.ops.body1': 'Rules point to **models**, not presets, so deleting a preset does not affect other configurations.',

  'help.section.routing.fallback.title': 'Image fallback modes (imageFallback)',
  'help.section.routing.fallback.live': 'Current: {0} — {1}',

  'help.section.routing.roles.title': 'Role table (role = domain → model)',
  'help.section.routing.roles.body0': 'One row per role: display name + id (lower-kebab-case; also the default claimed teammate name) + target model + additionally claimed teammate names + aliases.',
  'help.section.routing.roles.body1': 'Claimed names (the union of id and teammate names) must be unique across roles — duplicates are rejected on save (guard rejection; configuration is not persisted).',
  'help.section.routing.roles.body2': '"Fill in engineering examples" / "Fill in business examples" add the six engineering roles (frontend / backend / devops / QA / data / security) and the six business roles (writing / marketing / sales / support / finance / legal) respectively (target defaults to the current preset\'s default model; adjustable via dropdown).',
  'help.section.routing.roles.liveEmpty': 'Current: role table empty (specialist tasks are not rerouted on dispatch)',
  'help.section.routing.roles.liveCount': 'Current: {0} roles',

  'help.section.routing.driver.title': 'Team dispatch switches (driver / driverSticky / rulesApplyToChildren)',
  'help.section.routing.driver.body0': 'driver = main driver target (null / omitted = follow host default model). When driverSticky is enabled, the main session\'s default target is always the driver.',
  'help.section.routing.driver.body1': 'When rulesApplyToChildren is off (default), subagent requests do not participate in keyword rules — only teammates claimed by the role table are rerouted.',
  'help.section.routing.driver.body2': 'See the dispatch slot on the dock for dispatch reasons: role = role table / explicit = explicit nomination / unclaimed = not in role table / keep = kept as-is.',

  'help.section.routing.guard.title': 'Dispatch guard (dispatchGuard)',
  'help.section.routing.guard.body0': 'dispatchGuard is off by default; once on, two kinds of dispatch are **rejected**: a task that matches a role\'s domain but goes to a bare subagent (subagent / subagent_fork), or a workflow script whose agent() calls never name a target (every subagent in such a script runs on the default target).',
  'help.section.routing.guard.body1': 'The bare-subagent match uses the role\'s domain words (keywords); when a role has none, the match falls back to its label, aliases and id.',
  'help.section.routing.guard.body2': 'After a rejection, create that role\'s teammate with spawn_teammate and dispatch the task to it; in a workflow script, name provider / model on agent() (when the default target is genuinely intended, write it in explicitly and the call passes).',
  'help.section.routing.guard.body3': '**The guard can only reject; it never reroutes**: rerouting still takes another spawn_teammate call.',

  /* ======== §4 keywords — keywords and matching ======== */
  'help.section.keywords.title': 'Keywords and matching',
  'help.section.keywords.groups.title': 'Keyword groups and word lists',
  'help.section.keywords.groups.body0': 'Seven built-in groups (code / review / writing / translation / long-form / math / chat). Word lists are editable and new groups can be created.',
  'help.section.keywords.groups.body1': 'Separate words with commas or line breaks; saved on blur.',
  'help.section.keywords.groups.live': 'Current: {0} groups',

  'help.section.keywords.match.title': 'Match semantics',
  'help.section.keywords.match.body0': 'Pure ASCII tokens match on word boundaries (`decode` does not match `code`). Chinese, mixed, and multi-word phrases match as substrings.',
  'help.section.keywords.match.body1': 'Case-insensitive. Duplicate occurrences of the same word count once.',

  'help.section.keywords.minhits.title': 'Minimum hit count (minHits)',
  'help.section.keywords.minhits.body0': 'Per-rule floor: a sentence must match at least this many **distinct** words from the group to trigger.',
  'help.section.keywords.minhits.body1': 'Setting to 2 avoids incidental mentions such as "draft a plan" triggering the rule.',

  /* ======== §5 flows — collaboration flows ======== */
  'help.section.flows.title': 'Collaboration flows',
  'help.section.flows.transcribe.title': 'Transcribe flow',
  'help.section.flows.transcribe.body0': 'Uses a vision model to convert images to text, then hands off to the text model for the answer.',
  'help.section.flows.transcribe.body1': 'Failure policy has two modes: `latch on failure` (keep native vision answering) or `blind` (treat as imageless).',
  'help.section.flows.transcribe.live': 'Current: vision model {0}, failure policy {1}',

  'help.section.flows.reviewFields.title': 'Review flow fields',
  'help.section.flows.reviewFields.body0': 'Review model = **who reviews**; trigger mode = **when to review** (two distinct fields; do not conflate).',
  'help.section.flows.reviewFields.body1': 'Tier = the review model\'s **reasoning strength** (same control as the transcribe flow: the dropdown lists only tiers declared by the host catalog. "Follow default (model declares no tier)" means the model makes no declaration and the adapter default applies).',
  'help.section.flows.reviewFields.body2': 'Rounds = number of review passes; **also the per-session cap on reject-and-redo**.',
  'help.section.flows.reviewFields.body3': 'Auto-revise = when the verdict is "fail" or "conditional pass", **automatically ask the main model to revise per feedback**. Recheck = run another review pass after revision.',
  'help.section.flows.reviewFields.body4': 'Both switches incur additional calls: reject adds one main-model turn; recheck adds one review-model turn.',

  'help.section.flows.revise.title': 'Reject and redo: automatic and manual',
  'help.section.flows.revise.body0': 'The review card has a "**Redo**" button: available even without auto-revise; rejects per the most recent review feedback.',
  'help.section.flows.revise.body1': 'Rejection injects a message carrying the review feedback so the main model **fixes only the cited issues**. The original output remains in the session log for reference.',
  'help.section.flows.revise.body2': 'Per-session cap is the configured rounds (1–3). Once reached, the event card reads "stopped (cap reached)" and no further automatic redos occur.',
  'help.section.flows.revise.live': 'Current: auto-revise {0} · recheck {1} · cap {2}',
  'help.section.flows.revise.liveOn': 'on',
  'help.section.flows.revise.liveOff': 'off',

  'help.section.flows.trigger.title': 'Trigger mode: manual vs keyword group',
  'help.section.flows.trigger.body0': '`Manual`: only `/kimi-tide review` triggers review — **keyword matches do nothing**.',
  'help.section.flows.trigger.body1': '`Keyword group`: matching ≥1 word from the selected group arms the flow; the turn executes normally and an async review runs **at turn end**.',
  'help.section.flows.trigger.liveKeywords': 'Current: keyword group "{0}" — match triggers end-of-turn review',
  'help.section.flows.trigger.liveKeywordsUnselected': '(none selected)',
  'help.section.flows.trigger.liveManual': 'Current: manual — keyword matches do not trigger review; only /kimi-tide review does',

  'help.section.flows.claim.title': 'Claim: groups selected by the review flow disable their routing rules',
  'help.section.flows.claim.body0': 'Once a group is claimed by the review flow, its bound **routing rules** are statically suppressed (no whole-turn model switching).',
  'help.section.flows.claim.body1': 'This is by design: when a review keyword matches, the turn proceeds with its normal work and review is deferred to turn end.',

  'help.section.flows.deleteGuard.title': 'Flow deletion guarded by reference check',
  'help.section.flows.deleteGuard.body0': 'Built-in flows cannot be deleted. Custom flows still referenced by a rule target or the lazy-transcribe flow are **rejected with a reason** (clear references first, then delete).',

  /* ======== §6 usage — usage and balance ======== */
  'help.section.usage.title': 'Usage and balance',
  'help.section.usage.sources.title': 'Data sources',
  'help.section.usage.sources.body0': 'Fetched per provider: Kimi Code shows weekly / 5h windows; Z.ai coding plans show two credit-based windows.',
  'help.section.usage.sources.body1': 'The quota slot switches source automatically based on the current matched target. Models without a plan do not display values.',

  'help.section.usage.dash.title': 'Why — is displayed',
  'help.section.usage.dash.body0': 'Three causes: not applicable (current target has no quota source) / no credentials (key not configured) / fetch failed.',
  'help.section.usage.dash.body1': 'When fetch time is marked "(stale)", the last refresh failed and an older snapshot is shown.',

  'help.section.usage.overview.title': 'Usage overview (overview button on the second line)',
  'help.section.usage.overview.body0': 'Lists **all registered sources** on one screen: usage windows, balance, and why a particular source has no data.',
  'help.section.usage.overview.body1': '"No data" falls into three cases, stated per row: no public API for this plan / key not configured / fetch failed — no guessing required.',

  'help.section.usage.monthly.title': 'Panel shows remaining quota but reports "limit reached"',
  'help.section.usage.monthly.body0': 'The panel displays the server-reported **weekly / 5h window**. If the account also has a **monthly cap**, it is outside this window.',
  'help.section.usage.monthly.body1': 'Kimi\'s 403 message reads `monthly usage limit for this billing cycle` — the weekly window may be below its cap while the monthly cap blocks requests.',

  'help.section.usage.refresh.title': 'Refresh cadence',
  'help.section.usage.refresh.body0': 'Background polling runs on a fixed cadence (at most one in-flight request at a time).',
  'help.section.usage.refresh.body1': 'To refresh immediately: tap the refresh button or run `/kimi-tide refresh`.',

  /* ======== §7 glossary — glossary ======== */
  'help.section.glossary.title': 'Glossary',
  'help.section.glossary.terms.title': 'Terms seen on the panel and in settings',
  'help.section.glossary.terms.body0': 'Default target: the target used by the main session when no rule matches (no match ≠ no action).',
  'help.section.glossary.terms.body1': 'Default model: a preset configuration field (`presets.<id>.default`). When sticky main driver is off, the default target equals this value.',
  'help.section.glossary.terms.body2': 'Main driver target: the persistent default target for the main session when "sticky main driver" is enabled (empty = follow host default model).',
  'help.section.glossary.terms.body3': 'Hit / specificity: the number of **distinct** matched keywords; used for sorting.',
  'help.section.glossary.terms.body4': 'Claim: a keyword group taken over by the review flow; its routing rules are suppressed.',
  'help.section.glossary.terms.body5': 'Latch / blind / lazy transcribe: the three fallback postures for sessions with images.',
  'help.section.glossary.terms.body6': 'Stale: the most recent fetch failed; the currently displayed values are from an older snapshot.',

  /* ======== §8 commands — command reference ======== */
  'help.section.commands.title': 'Command reference',
  'help.section.commands.list.title': '/kimi-tide subcommands',
  'help.section.commands.list.body0': '`show` status overview · `panel [--json]` panel data · `refresh` re-fetch quotas immediately.',
  'help.section.commands.list.body1': '`export-config` / `import-config <path|inline YAML>` export and import presets.',
  'help.section.commands.list.body2': '`review` manually review the last turn (uses cache when available; states explicitly when not).',
  'help.section.commands.list.body3': '`revise` manual reject-and-redo: asks the main model to redo per the most recent review feedback (same path as the review card button).',

  'help.section.commands.trial.title': '"Try a sentence" test bench',
  'help.section.commands.trial.body0': 'Enter a sentence to preview which rule matches and which model is ultimately selected.',
  'help.section.commands.trial.body1': '**Text probe only**: image input shows rule matches only; final rerouting still depends on image guardrails and collaboration flows.',

  'help.value.none': '—',
  'help.join.labeled': '{0}: {1}',
}
