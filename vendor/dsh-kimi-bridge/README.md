# dsh-kimi-bridge

English | [中文](README.zh.md)

A dual-face (host + browser) plugin for DeepSeek Harness (dsh) that bridges the
Kimi CLI (kimi-code) into the harness — the Kimi counterpart of
`dsh-codex-bridge`, built on the same architecture.

## Why

A dsh agent often wants a second opinion or a parallel coding pass from an
external coding agent (Moonshot Kimi). Doing that by hand — spawning
`kimi -p`, capturing the stream, polling, wiring the output back — is exactly
the kind of scaffolding a harness plugin exists to remove. This plugin makes
Kimi a first-class dsh citizen:

1. **Calls Kimi as a tool** — `call_kimi` runs
   `kimi -p <prompt> --output-format stream-json` in the session's working
   directory, with `async` (returns immediately; multiple calls run in
   parallel) and `block` (waits for the final answer) modes, plus
   `kimi_status` to poll and `kimi_abort` to cancel.
2. **Continues the same session** — `kimi_steer` resumes a settled Kimi
   session with a new message (`kimi -S <session_id> -p …`). Kimi sessions are
   **bound to their working directory** — the plugin locks cwd to the session
   working directory, so resume inside one dsh session holds. The session is
   linear: the parent must be the latest record, and one session can have only
   one active continuation.
3. **Shows the whole agent loop** — the Kimi tab in the conversation pane
   (on par with Chat, Trajectory, and Codex) observes each session live:
   status, prompt, an **Agent Loop waterfall** (messages, tool rows with
   arguments, collapsible tool output, turn separators), the transcript, and
   the final answer — pushed through the session projection channel.

**Design stance: this is a UX channel, not a security boundary — and
`kimi -p` runs with `permission:"auto"` internally, so there is no CLI sandbox
flag.** The default `reviewOnly` mode therefore runs Kimi under a managed home
whose `[tools]` allowlist is read-only (`Read`/`ReadMediaFile`/`Grep`/`Glob`;
no Bash/Write/Edit/MCP), enforced again before tool execution. Setting
`reviewOnly: false` opts into the user's unrestricted home — an explicit
operator choice, never called a sandbox. `allowedAgents`, `maxParallel`, and
`maxSessionsPerSession` bound resource amplification, and a finite
`defaultTimeoutMs` bounds Kimi's print mode (which can otherwise wait ~25 days
on background work).

## Installation

Requirements: Node.js 22 or newer, `@deepseek-ai/dsh@0.1.0-rc.6`, and an
authenticated Kimi CLI available as `kimi` (or set `kimiPath`). The plugin
does not copy credentials into the repository or dsh telemetry. In
`reviewOnly` mode, the managed Kimi home symlinks the CLI's existing auth files
so the CLI remains the credential owner.

Build, validate, and pack the standalone bundle from the plugin directory:

```bash
npm install
npm run check
npm pack
```

Install the generated tarball into a DSH profile, then restart `dsh web`.
Installing the source directory as a link is not supported because host peers
are supplied by the DSH profile:

```bash
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add ./dsh-kimi-bridge-0.1.0.tgz
npx @deepseek-ai/dsh@0.1.0-rc.6 web
```

The browser half is served at `/plugins/dsh-kimi-bridge/client.js` and appears
in the conversation pane. Verify it against a running default Web profile:

```bash
curl -s http://127.0.0.1:3080/plugins/dsh-kimi-bridge/client.js | head
```

To update, build a tarball with a newer package version, remove the installed
bundle, add the new tarball, and restart. To uninstall:

```bash
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web remove dsh-kimi-bridge
```

## Config

| Key | Default | Meaning |
|-----|---------|---------|
| `kimiPath` | `kimi` | kimi executable (absolute path or PATH lookup) |
| `reviewOnly` | `true` | run kimi under a managed home whose `[tools]` allowlist is read-only |
| `kimiHome` | `''` | source Kimi home for config/auth (`''` = `KIMI_CODE_HOME`, else `~/.kimi-code`) |
| `reviewHomeDir` | `''` | managed review home (`''` = `$DSH_HOME/kimi-review-home`) |
| `maxTimeoutMs` | `1800000` | hard cap on any session timeout (30 min) |
| `defaultTimeoutMs` | `600000` | default lifetime per kimi session (10 min) |
| `maxParallel` | `3` | global cap on concurrent kimi processes |
| `maxSessionsPerSession` | `8` | cap on live kimi sessions per dsh session |
| `maxRetained` | `16` | retained (settled) records per dsh session (oldest evicted) |
| `maxPromptChars` | `16384` | prompt length cap (argv prompt; NUL rejected; longer prompts are rejected) |
| `maxTranscriptChars` | `16384` | transcript cap recorded in events/projections |
| `maxLoopSteps` | `32` | bounded agent-loop window (steps kept in the record/projection) |
| `maxLoopBytes` | `16384` | serialized-byte cap for the loop window (UTF-8; oldest completed steps evicted) |
| `allowedAgents` | `roots` | who may call `call_kimi`: `roots` \| `all` |
| `killGraceMs` | `10000` | SIGTERM → SIGKILL grace (kimi headless cleanup takes up to 8s) |

## Tools

- **`call_kimi`** — `{ prompt, mode?: async|block, model?, timeout_ms?,
  kimi_session_id? }`. `async` starts and returns immediately (parallel);
  `block` waits for the answer (or, with `kimi_session_id`, waits on a
  previously started session). A cancelled blocking wait aborts the kimi
  session.
- **`kimi_status`** — list the current session's kimi sessions (status, prompt
  preview, progress).
- **`kimi_abort`** — `{ kimi_session_id }`; SIGTERM the process group, then
  SIGKILL after `killGraceMs`.
- **`kimi_steer`** — `{ kimi_session_id, prompt, mode?: async|block, model?,
  timeout_ms? }`. Continue a **settled** parent session (`kimi -S <session_id>
  -p …`; must run from the same directory, which the plugin guarantees); the
  new record links back via `parent` and inherits the parent's model. A
  post-restart parent works as long as its record carries the kimi session id.

## Model Experience

The Kimi tab (conversation pane, after Codex):

- **Left column** — every kimi session of the current dsh session, with status
  dot, prompt preview, and relative time. Click to select.
- **Right column** — status badge, meta (id/kimiId/cwd/model/duration/exit/
  error), the prompt, and an **Activity | Text** toggle:
  - **Activity** — the Agent Loop waterfall: messages, tool rows (tool name,
    running/done/failed, duration, exit code, `truncated` marker; output
    auto-expands on failure), turn separators, and a "N steps dropped" marker
    when the bounded window evicted older steps.
  - **Text** — the streamed transcript and the final answer.

State changes ride the session projection channel (`kimi/session` events,
`kimi/sessions` projection), so the tab updates live and survives page refresh
(history replay).

## Known Limitations and Deferred Work

- **One shot per call, then continuation.** `call_kimi` runs a fresh
  `kimi -p`; live mid-run steering is not available in the CLI (kimi-code's
  thinking is not written to `stream-json` either, so the tab never guesses
  reasoning from stderr).
- **The loop window is recent-activity, not an audit trail.** Older steps are
  physically evicted under `maxLoopSteps`/`maxLoopBytes`; the canonical dsh
  session log still holds the whole-value snapshots, but the tab only shows
  the retained window.
- **`reviewOnly` is a tool allowlist, not a sandbox.** It is enforced by the
  kimi `[tools]` switch before execution; a genuinely sandboxed
  `workspace-write` needs OS-level isolation (container/namespace).
- **POSIX-only process groups.** Abort uses `detached` + negative-pid `kill`;
  a Windows port needs Job Object / `taskkill /T` tree termination.
- **Telemetry redaction covers dsh exports only.** Kimi's own telemetry is
  disabled via `KIMI_DISABLE_TELEMETRY=1` on the child.

## Development

```bash
npm run check    # typecheck + tests + compliance
npm run build    # host (tsc) + client bundle (esbuild, __ModuleLoader__ ABI)
```

The client bundle speaks the harness `__ModuleLoader__.load({id, factory})`
protocol with the platform module table as externals; the host half follows
the bundle format from `create-dsh-plugin`.

## License

MIT
