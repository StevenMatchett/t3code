# TUI npm release

`npx t3tui` installs two kinds of npm package, both built by
[`apps/tui/scripts/build-npm-packages.mjs`](../../apps/tui/scripts/build-npm-packages.mjs):

- `@t3tui/<platform>-<arch>`: the TUI, the bundled server, and the native modules for one platform.
  It must be built on that platform.
- `t3tui`: a small launcher whose optional dependencies name the platform packages. npm installs
  only the one matching the user's machine.

The launcher must name only platform packages that are published at the same version, so pass the
set you will publish with `--platforms`. Publish the `.tgz` files, never the staging directories:
`npm publish <dir>` drops the bundled `node_modules`.

## Release

Every push to `tui-main` publishes a new version, except pushes that only change docs or Markdown.
The **TUI npm packages** workflow's `plan` job picks the version: one patch past the newest
`t3tui-v*` tag or npm version, or the version in `apps/tui/package.json` when that is newer. CI never
commits it back; to start a new minor or major version, raise `apps/tui/package.json` yourself.

Each platform then builds its package at that version and smoke-tests a clean `npx` install. The
`publish` job publishes the four `@t3tui/*` platform packages, then `t3tui`, with provenance, and
creates the `t3tui-v<version>` tag and GitHub release. The release notes are that version's
`CHANGELOG.md` section when there is one, or else the TUI's commits since the previous release.
Releases run one at a time. npm can take 10 to 15 minutes to make a new version installable.

A failed publish is safe to rerun: versions npm already has are skipped. Rerun the failed jobs, or
run the workflow from Actions with **publish** checked. Without **publish**, a manual run only
builds and uploads the tarballs as artifacts.

## Trusted publishing setup

The workflow publishes through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers),
so there is no npm token to store or rotate, and npm's 2FA does not prompt. Each of the five
packages (`t3tui`, `@t3tui/linux-x64`, `@t3tui/linux-arm64`, `@t3tui/darwin-arm64`,
`@t3tui/darwin-x64`) needs this once, on npmjs.com under the package's **Settings → Trusted
Publisher**:

- Publisher: GitHub Actions
- Organization or user: `StevenMatchett`
- Repository: `t3code`
- Workflow filename: `tui-npm-packages.yml`
- Environment: leave empty

A new platform package must be published by hand once before it can get a trusted publisher. The
packages' `repository.url` must stay `https://github.com/StevenMatchett/t3code`, which npm checks
against the workflow's repository.

## Build and test by hand

Build a platform's packages on that platform, then smoke-test a clean install. On Linux with a user
systemd manager, this installs a real unit with a disposable name and removes it afterwards:

```bash
cd apps/tui
node scripts/build-npm-packages.mjs /tmp/t3tui-npm --platforms linux-x64,linux-arm64,darwin-arm64,darwin-x64
node scripts/npx-smoke.mjs --tarballs /tmp/t3tui-npm            # real service manager
node scripts/npx-smoke.mjs --tarballs /tmp/t3tui-npm --manager process
```

`node scripts/docker-test.mjs` runs the same smoke on a clean Debian machine with systemd and a
local registry.

To publish by hand, publish every platform `.tgz` first, then the launcher:

```bash
npm publish --access public ./t3tui-linux-x64-<version>.tgz   # repeat for each platform
npm publish --access public ./t3tui-<version>.tgz
```

A path without `./` is read as a GitHub `user/repo` shorthand.
