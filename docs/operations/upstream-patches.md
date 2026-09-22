# Upstream patch ledger

This ledger covers fork changes to files inherited from T3 Code. New files under `apps/tui` and
TUI-only documentation do not need entries. Update an entry when an upstream merge changes its
conflict risk or makes it unnecessary.

The ledger lives under operations because it is part of the fork maintenance runbook.

`UP-004` adds `Connection.layerWithResolver` in `packages/client-runtime/src/connection/layer.ts`
so a pre-authorized terminal host can reuse registry, supervision, and RPC sessions without
constructing unsupported cloud or SSH authorization services. This is an additive, upstreamable
API extension with low conflict risk; remove it when upstream exposes the same composition point.

| ID       | Category     | Paths                                                   | Reason                                                                      | Upstreamable | Upstream PR | Conflict risk | Removal condition                                                  |
| -------- | ------------ | ------------------------------------------------------- | --------------------------------------------------------------------------- | ------------ | ----------- | ------------- | ------------------------------------------------------------------ |
| `UP-001` | Branding     | `README.md`                                             | Identify the unaffiliated fork and document prototype usage and artifacts.  | No           | N/A         | Low           | The repository stops being a public fork.                          |
| `UP-002` | Build policy | `package.json`                                          | Check that fork history descends from the recorded full upstream SHA.       | No           | N/A         | Low           | The fork adopts another enforced provenance mechanism.             |
| `UP-003` | TUI package  | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Register the TUI workspace, renderer pins, and shared runtime dependencies. | No           | N/A         | Medium        | The fork drops the TUI client or upstream adds the same workspace. |
