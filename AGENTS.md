# AGENTS.md

Guidance for AI agents working in this repo — kimi-tide（月汐）, a preset-and-rule model router for DeepSeek Harness.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `tafcear/kimi-tide`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary — label string equals role name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`); category roles use GitHub's built-in `bug` / `enhancement`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root, created lazily by `/domain-modeling`. See `docs/agents/domain.md`.
