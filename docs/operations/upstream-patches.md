# Upstream patch ledger

This ledger covers fork changes to files inherited from T3 Code. New files under `apps/tui` and
TUI-only documentation do not need entries. Update an entry when an upstream merge changes its
conflict risk or makes it unnecessary.

The ledger lives under operations because it is part of the fork maintenance runbook.

| ID | Category | Paths | Reason | Upstreamable | Upstream PR | Conflict risk | Removal condition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `UP-001` | Branding | `README.md` | Identify the public repository as an unaffiliated TUI fork. | No | N/A | Low | The repository stops being a public fork. |
| `UP-002` | Build policy | `package.json` | Check that fork history descends from the recorded full upstream SHA. | No | N/A | Low | The fork adopts another enforced provenance mechanism. |
