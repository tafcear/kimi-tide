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
