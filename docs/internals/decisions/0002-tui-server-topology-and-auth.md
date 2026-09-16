# ADR 0002: keep the TUI outside the environment server

Status: provisional until local bootstrap and reattachment pass on each reference operating system

## Context

T3 already separates clients from the environment that owns provider processes, files, terminals,
Git, and durable orchestration state. An in-process TUI would couple renderer failure and terminal
mode cleanup to the server lifecycle. Disabling authentication for a loopback client would also
create a different trust model from every other T3 client.

## Decision

Run the TUI and `apps/server` as separate processes. The TUI may start a loopback-only child server
or connect to a compatible existing environment through authenticated HTTP and WebSocket RPC.

First startup sends a bootstrap secret over an inherited descriptor. The client exchanges it for a
scoped, environment-bound attach credential and clears the original buffer. Later clients use only
the protected derived credential. Missing or rejected credentials enter repair state without
killing the live server or starting a second server against the same state directory.

## Alternatives considered

- Importing server services into the TUI would bypass the tested client boundary and tie server
  lifetime to the terminal renderer.
- A no-auth loopback mode would trust unrelated local processes and would not generalize to remote
  environments.
- Persisting the original bootstrap secret would turn a one-time process handoff into a durable root
  credential.

## Consequences

The launcher needs explicit server ownership, readiness, reattachment, and signal handling. Phase 0
must prove the current bearer session lifetime or add a narrow, revocable local reattach grant. The
fork reuses WebSocket tickets and RPC scope checks.
