# t3-tui — Handoff

Keyboard-first terminal client (`@t3tools/tui`) built on T3 Code's existing environment server.
It attaches to a user's already-running T3 Code environment and shares the same projects,
threads, history, and running work. It does **not** copy the database or start a second server
against live state.

## How to run

```bash
./start-tui.sh                 # attach to the saved T3 environment (default)
```

First-time pairing (once), reading the credential from stdin rather than argv:

```bash
npx --yes t3@<version> pair --base-dir "$HOME/.t3" \
  | awk '/^Token: / { print $2 }' \
  | ./start-tui.sh --connect http://localhost:3773 --pair-stdin
```

- Requires Node **26.4+** (launcher pins this; `scripts/run-with-node-ffi.mjs` sets FFI flags).
- `--new-environment` is the only way to start a separate private environment.
- Credentials are bound to the environment ID + origin and stored derived-only.

## Stack

- `@opentui/react` (pinned `0.5.11`), React `19.2`, `@effect/atom-react`, Effect.
- Shared logic reused from `@t3tools/client-runtime`, `@t3tools/contracts`, `@t3tools/shared`.
- All wire types come from `packages/contracts`; no provider integrations were rebuilt.

## What works today (macOS, verified)

- **Connection/pairing** to an existing T3 environment; second-client reattachment.
- **Browse** projects and threads; live-updating conversation history; scroll + follow.
- **Add projects** (`p` or the header action): browse folders on the connected environment or clone
  a GitHub URL into an editable destination. New servers clone in the background; older servers use
  the blocking clone RPC before creating the project.
- **Send prompts and interact**: composer with draft preservation, stop turn (Ctrl+X),
  approvals, and agent questions (opaque option values preserved).
- **Models & skills** (no function keys):
  - Visible **model** and **reasoning** dropdowns on the composer — click or Tab+Enter.
  - Typing **`/`** opens an inline skill search; filter, Enter/click to insert (never auto-sends);
    Esc dismisses and keeps the draft. Cursor-accurate token replacement (Unicode/tabs safe).
- **New thread** (`n` or the header `[+ New thread]`): title, provider/model, and
  **Current checkout** vs **New worktree** (base ref defaults to `HEAD`). Server-side worktree
  creation via `vcs.createWorktree`; failed creation retries the same thread ID / recovers the
  same worktree instead of duplicating; never falls back silently. Worktree threads show `[WT]`
  and their directory.
- **Tool calls + code changes** in the conversation:
  - Tool rows shown by default with `[status]`, tool name/command, and touched files.
    Reasoning/other chatter stays behind `T`.
  - Per-turn checkpoint blocks list changed files with `+adds -dels` and a turn total.
- **Activity indicators**: spinner while an agent is actively working, in the conversation header
  and next to each thread + its project in the sidebar. Waiting states show steady markers
  (`[!]` approval, `[?]` input) so you can tell working vs. needs-input at a glance. Animation is
  bounded (~4Hz, only while a visible thread works, stops when idle), disabled on dumb terminals
  or via `T3_TUI_ANIMATION=0` — honors the repo's no-idle-repaint rule.
- **Embedded terminal path** proven server→emulator (Unicode, paste, mouse, function keys,
  resize, reconnect, Vim/less/Node REPL). Not yet wired into the interactive app shell UI.
- **Packaging** artifact that runs outside the checkout (excludes GUI bundles; Node 26.4+, does
  not bundle Node).

## Key files

- `src/connection/clientRuntime.ts` — client atoms, thread merge, new-thread + worktree wiring,
  `settings` atom.
- `src/features/chat/`
  - `interactions.ts` — prompt/stop/approval/question + skill insertion actions.
  - `providerChoices.ts` — model/skill capability validation, opaque IDs.
  - `skillCompletion.ts` — `/`-trigger token detection + draft rewriting.
  - `newThread.ts` — server-backed create with checkout/worktree, retry/recovery semantics.
  - `timeline.ts` — projects messages/activities/**checkpoints** into ordered rows
    (tool status, command, files; checkpoint file diffs).
  - `activityDetails.ts` — extracts tool name/command/changed files from activity payloads.
  - `threadActivity.ts` — maps thread shell → phase via shared `agentAwareness`.
- `src/renderer/`
  - `Conversation.tsx` — history, composer host, activity header.
  - `ProviderPicker.tsx` — `ComposerControls` (dropdowns + slash menu).
  - `PromptEditor.tsx` — textarea wrapper with cursor snapshot/replace.
  - `NewThreadForm.tsx` — new-thread modal.
  - `AppShell.tsx` (renderer) — wires `ActivityClockProvider`, live flag, env id.
- `src/app/AppShell.tsx` — presentational shell, sidebar list with activity phases.
- `src/app/state.ts` — shell navigation reducer (routes, modals, open-thread).
- `src/ui/`
  - `conversationLines.ts` — turns timeline rows into rendered lines (tools + diffs).
  - `ThreadActivityIndicator.tsx` + `activityClock.ts` — bounded spinner via
    `useSyncExternalStore`, Effect-based timer (no `setInterval`).
  - `capabilities.ts` — adds `animation` capability.

## Tests

Run focused suites through the FFI launcher, e.g.:

```bash
node apps/tui/scripts/run-with-node-ffi.mjs apps/tui/node_modules/vite-plus/bin/vp test run <files>
```

Package scripts: `test`, `test:live`, `test:prompts`, `test:terminal`, `test:new-thread`,
`test:artifact`, `test:pty`, `test:cli`, `test:backend`, `test:staging`,
`test:windows-credentials`, `typecheck`.

Real-server integration tests spin up a disposable T3 server + synthetic Codex peer against a
temporary HOME (`scripts/*.test.mjs`); they set `TUI_TEST_SERVER_ENTRY` to the server bin. They
never open `~/.t3` or use real provider accounts. `new-thread.test.mjs` verifies worktree files,
that the original checkout/branch is untouched, and that the first prompt runs in the worktree.

Latest local run: renderer/unit + integration suites green; typecheck, targeted lint, and a dist
build clean.

## Known gaps / not yet integrated

- Switching **provider accounts** within an existing thread (model picker stays within the
  thread's current provider/account).
- **Attachments**, **Git review/actions**, and the **embedded-terminal UI** inside the app shell.
- **Cross-platform certification**: Linux and Windows are unverified. Windows credential storage
  uses a protected-store path tested only with a stand-in encryption provider (real DPAPI test is
  skipped on macOS). CI config intentionally **not** changed; needs Linux/Windows runners.
- Skill catalog on T3 `0.0.35` is provider-level only; workspace-specific skill discovery may need
  a newer server.

## Constraints to preserve

- Never write to / start a server against `~/.t3/userdata`.
- No idle repaints (AGENTS.md perf rule) — animation must stay bounded and stop when idle.
- Keep everything server-backed; do not rebuild provider logic or load skills locally.
- Reuse `packages/contracts` types for anything crossing the wire.
