# AGENTS.md

Guidance for AI agents working in this repo — kimi-tide（月汐）, a preset-and-rule model router for DeepSeek Harness.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `tafcear/kimi-tide`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary — label string equals role name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`); category roles use GitHub's built-in `bug` / `enhancement`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root, created lazily by `/domain-modeling`. See `docs/agents/domain.md`.

## Project rules

### Release page — bilingual, four sections, every release

Every new version's GitHub Release body must be **bilingual** (a 简体中文 block first, an English block below) and four sections inside each language: ① one-line positioning ② `本次更新` / `What's new` ③ `安装与升级` / `Install & upgrade` ④ `验证与验收` / `Verification & acceptance`, with the title line carrying both themes (`dsh-kimi-tide vX.Y.Z —— <中文主题> · <English theme>`). The body comes from the **annotated tag message** (not something typed on the web page), and the release workflow runs `scripts/check-release-notes.mjs` before `gh release create` — a non-conforming body stops the release. Template, per-section requirements, and the release order: `docs/agents/release-notes.md`.

### README pair — both languages, same commit

`README.md` (Chinese, primary) and `README.en.md` (English) are one document in two languages: any user-visible change must land in both in the same commit. CI enforces the version line, section skeleton, badges, and local doc-link set through `scripts/check-readme-sync.mjs`. Rules and the human-judgement half: `docs/agents/readme-pair.md`.

### Terminology & copy register — one concept, one word, product-grade tone

**User-visible copy is product text, not agent narration.** One concept gets exactly one word, labels are noun phrases, explanations are declarative — no colloquialisms, anthropomorphism, or metaphors. The word table, the register rules, the rename procedure, and the list of history that must **not** be rewritten live in `docs/agents/terminology.md`; `scripts/check-terminology.mjs` (wired into `npm run check`) fails the build on a banned word in any scanned surface. Why it exists: a phrase improvised in a design doc once travelled "design → dispatch → review → test assertion → four doc surfaces" and shipped to users as protocol — **no link in that chain asked "does this read like product copy?"**. The other half (is it *good* copy?) is human: review tasks must quote the rewritten strings and check them against the register rules.

**Client UI copy is locale-owned.** All user-visible strings live in the typed dictionaries `packages/dsh-kimi-tide/src/locales/{zh,en}/{shared,settings,panel,help,view}.ts` (zh is the single source of truth; key shape `<surface>.<area>.<name>`, placeholders `{0}`/`{name}` — see `docs/agents/terminology.md` §7) and render through `useCopy()`/`copy()` from `src/client/locale.ts`. Never write Chinese text, Chinese/full-width punctuation, or `——`/`…` directly in string literals, template literals, or JSX text under `src/client/**`, `src/routing-view.ts`, or the four shared modules the browser half bundles (`src/config.ts`, `src/rules.ts`, `src/roles.ts`, `src/review-verdict.ts` — 18 scanned files; shared modules read copy through `copyNow()` from `src/copy.ts`): `scripts/check-client-i18n.mjs` (also wired into `npm run check`) fails the build on hardcoded copy and on dictionary-structure defects (zh/en keyset mismatch, cross-surface duplicate keys, empty values, placeholder mismatch, missing `locale/*.json` display metadata). What a good sentence looks like is judged against the gold-standard samples in `docs/agents/style-samples.md` — samples outrank any prose description of tone.
