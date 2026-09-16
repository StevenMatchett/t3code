# Synchronizing the fork with T3 Code

The fork keeps complete T3 Code history. The integration branch is `tui-main`. `origin` is the fork and `upstream` is
`https://github.com/pingdotgg/t3code.git`. Push access to `upstream` should remain disabled in local
clones.

[`UPSTREAM_BASE`](../../UPSTREAM_BASE) records the source commit used to start the fork. The
[patch ledger](./upstream-patches.md) records changes to upstream-owned files so a merge conflict
has context.

## Prepare a sync

1. Confirm the worktree is clean and all fork changes are committed.
2. Fetch `upstream/main` and tags without changing the integration branch.
3. Create a dedicated sync branch from the current fork integration branch.
4. Review upstream changes to contracts, persistence, authentication, provider adapters, migrations,
   and `packages/client-runtime` before merging.
5. Merge the selected upstream commit. Do not cherry-pick a server change without its contracts,
   migrations, fixtures, and client-runtime changes.
6. Resolve wire and event compatibility before TUI presentation differences.
7. Update the patch ledger for every conflict whose resolution changes a recorded fork patch.

## Verify a sync

Run focused checks for each conflicted package. At minimum, verify the retained server, contracts,
client runtime, provider packages, and TUI packages whose inputs changed. Replay migration tests
against a copy of the previous release database when the sync includes a migration.

Do not run a development server against the user's live T3 home. Follow the repository development
runbook and use worktree-local state.

After checks pass, record the merged upstream commit in the integration commit and release notes.
`UPSTREAM_BASE` remains the historical fork point; do not rewrite it on each merge.
