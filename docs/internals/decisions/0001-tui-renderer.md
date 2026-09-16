# ADR 0001: contain OpenTUI behind TUI adapters

Status: provisional until the renderer and runtime checks pass

## Context

T3's client state and contracts are TypeScript. The web client already consumes Effect atoms through
React. A terminal renderer that keeps those types and subscriptions avoids a second client-runtime
implementation.

OpenTUI React supplies terminal layout, input, Markdown, code, diff, scroll, and in-memory testing.
Its current release requires Node 26.4 or later. The pinned T3 monorepo declares Node 24.13.1, and
OpenTUI remains a pre-1.0 dependency.

## Decision

Start the TUI with `@opentui/react` pinned to the Phase 0 tested version. Keep OpenTUI host elements
inside `apps/tui/src/renderer` and `apps/tui/src/ui`. Feature code consumes local components and
renderer-neutral projections.

The embedded-terminal adapter may use OpenTUI Core directly because it must register the terminal
emulator with the React renderer.

## Alternatives considered

- OpenTUI Core without React retains TypeScript but needs a custom Effect atom adapter and more UI
  lifecycle code.
- Ink has a mature React model but would require more application code for diffs, streaming Markdown,
  virtualization, and terminal emulation.
- Bubble Tea or Ratatui would duplicate client state or require a new protocol bridge.

## Consequences

Phase 0 must measure streaming input latency, cleanup, native packaging, and Node compatibility before
feature work starts. If React reconciliation fails but OpenTUI Core passes, the fork may replace the
React adapter. Feature code must not support both renderers at once.
