# ADR 0003: keep domain state in the server and client runtime

Status: accepted for the first TUI implementation

## Context

T3 clients reconnect, resume subscriptions, and control several environments. Duplicating server
projections in a TUI-specific store would create conflicting sources of truth for threads, requests,
terminals, Git state, and provider status.

## Decision

The environment server owns durable domain state and external side effects. `packages/client-runtime`
owns authenticated connections, subscriptions, caches, and typed commands. The TUI owns only local
presentation state such as route, focus, modal stack, open panels, selection, expansion, scroll
anchors, theme, and drafts.

Projection functions transform client-runtime values into stable terminal rows. Screen components
dispatch command IDs. They do not call provider processes, Git, the filesystem, or RPC endpoints
directly.

## Alternatives considered

- A TUI-specific domain store would make reconnect and multi-environment behavior diverge from the
  other clients.
- Direct RPC calls in screens would bypass shared concurrency, authentication, cursor, and stale-data
  behavior.
- Importing web state would make the terminal client depend on DOM-specific code.

## Consequences

Some renderer-neutral presentation helpers may move into shared packages after two clients need them.
Public contract and client-runtime changes require integration review. The TUI can replace its
renderer without replacing domain behavior.
