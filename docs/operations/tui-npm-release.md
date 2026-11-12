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

## Build and verify

1. Bump `apps/tui/package.json` and move the `CHANGELOG.md` entry from Unreleased to the date.
2. Build every platform package. Either run the **TUI npm packages** workflow (Actions, then
   `workflow_dispatch`, which needs the workflow on the default branch) and download its
   artifacts, or build on each machine:

   ```bash
   cd apps/tui
   node scripts/build-npm-packages.mjs /tmp/t3tui-npm --platforms linux-x64,linux-arm64,darwin-arm64,darwin-x64
   ```

3. Smoke-test a clean install on each platform you can reach. On Linux with a user systemd manager,
   this installs a real unit with a disposable name and removes it afterwards:

   ```bash
   node scripts/npx-smoke.mjs --tarballs /tmp/t3tui-npm            # real service manager
   node scripts/npx-smoke.mjs --tarballs /tmp/t3tui-npm --manager process
   ```

## Publish

Publish every platform package first, then the launcher, so no install resolves a launcher whose
platform package is missing:

```bash
npm publish --access public /tmp/t3tui-npm/t3tui-linux-x64-<version>.tgz
# repeat for each platform tarball
npm publish --access public /tmp/t3tui-npm/t3tui-<version>.tgz
```

Then tag and release the commit:

```bash
git tag t3tui-v<version> && git push origin t3tui-v<version>
gh release create t3tui-v<version> --repo StevenMatchett/t3code --title "t3tui <version>" --notes-file <notes>
```
