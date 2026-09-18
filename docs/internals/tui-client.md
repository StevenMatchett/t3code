# TUI client boundary

This fork adds a terminal client to T3 Code. The TUI is another authenticated client of the
environment server. It does not replace provider adapters, orchestration, persistence, Git,
workspace, or terminal services.

The first implementation stays on the upstream base recorded in [`UPSTREAM_BASE`](../../UPSTREAM_BASE)
until the renderer and runtime checks pass. Upstream synchronization is a deliberate merge, not an
automatic fast-forward.

The initial decisions are recorded separately:

- [renderer containment](./decisions/0001-tui-renderer.md);
- [server topology and authentication](./decisions/0002-tui-server-topology-and-auth.md);
- [state ownership](./decisions/0003-tui-state-ownership.md).

## Runtime boundary

The TUI runs as a separate process from `apps/server` and connects through the existing HTTP and
WebSocket RPC contracts. It may start a loopback-only child server or attach to an existing server.
It does not import server services into screen components.

The server remains the owner of provider processes, durable threads, requests, terminals, files,
worktrees, Git state, checkpoints, and source-control operations. `packages/client-runtime` owns
connection supervision, authenticated transport, cached projections, and typed commands. The TUI
owns only view state such as route, focus, open panels, selection, scroll anchors, and drafts.

## Local authentication

Default startup attaches to an existing T3 Code environment so the TUI and installed clients share
server-owned sessions and history. Initial pairing takes an explicitly supplied T3 credential from
stdin and stores only the derived bearer. It neither copies the database nor borrows another client's
credential.

An explicitly requested separate environment passes a bootstrap secret to the server child through
an inherited descriptor. The client exchanges that secret for a scoped attach credential and then
clears the bootstrap buffer. The bootstrap secret must not appear in argv, environment variables,
logs, runtime state, or a file.

Later TUI processes use a protected, derived credential bound to the environment identity and
origin. A missing or rejected credential enters repair state. It does not make a loopback server
trusted, kill the live process, or start a second server against the same state directory.

Phase 0 must prove that the current server session model supports this attachment lifetime. If it
does not, the fork may add a revocable local reattach grant. It must not persist the original
bootstrap secret or enable no-auth mode.

## Renderer containment

The initial renderer candidate is `@opentui/react`, behind local components and adapters under
`apps/tui`. Feature code must not depend directly on OpenTUI host elements. The embedded-terminal
adapter is the only exception because it registers OpenTUI's terminal emulator with the React
renderer.

OpenTUI currently requires Node 26.4 or later, while the pinned T3 monorepo declares Node 24.13.1.
Phase 0 tests both requirements before the fork changes its root runtime. A failed renderer check
does not authorize a broad server rewrite.

## Terminal ownership

The server continues to own `node-pty`, terminal IDs, retained history, process lifecycle, resize,
and input RPC. The TUI feeds those byte streams to a real terminal emulator and routes emulator
input back through typed terminal commands. Provider text, tool output, filenames, and logs never
enter the emulator as trusted terminal bytes.

## Fork rules

- Keep provider behavior behind existing adapters and advertised capabilities.
- Keep server and client-runtime state canonical. Do not add a second domain store in the TUI.
- Put new code under `apps/tui` unless a reviewed export or contract change is required.
- Record every modification to an upstream-owned file in the
  [patch ledger](../operations/upstream-patches.md).
- Keep the upstream MIT license and copied-source notices intact.
- Do not ship upstream logos or imply that this fork is an official T3 Code client.
