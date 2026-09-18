# ADR 0002: keep the TUI outside the environment server

Status: provisional until local bootstrap and reattachment pass on each reference operating system

## Context

T3 already separates clients from the environment that owns provider processes, files, terminals,
Git, and durable orchestration state. An in-process TUI would couple renderer failure and terminal
mode cleanup to the server lifecycle. Disabling authentication for a loopback client would also
create a different trust model from every other T3 client.

## Decision

Run the TUI and `apps/server` as separate processes. By default, attach to the user's existing T3
Code environment through authenticated HTTP and WebSocket RPC. Both clients must use the same
environment to share projects, threads, history, and running work. The TUI must not copy the live
database, read another client's credentials, or launch another server against T3's state directory.

First-time attachment exchanges an explicitly supplied T3 pairing credential for a scoped bearer
session. Later launches use only the protected derived credential, bound to origin and environment
identity. Missing or rejected credentials enter repair state without killing or replacing the server.
HTTP redirects are rejected during discovery and authentication.

A separate loopback-only environment requires `--new-environment` and uses its own state and
credential directory. Only this path sends a bootstrap secret over an inherited descriptor. It
exchanges that secret for a scoped attach credential and clears the original buffer. Existing T3
servers remain externally owned and survive TUI exit.

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
