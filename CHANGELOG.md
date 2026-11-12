# Changelog

Releases of the `t3tui` npm package. The bundled T3 server version is shown by `t3tui --version`.

## 0.1.1 - 2026-11-12

- The first interactive `npx t3tui` offers once to install the `t3tui` command
  (`npm install -g t3tui` at the same version), so later launches are just `t3tui`. It never asks
  again after an answer, when a `t3tui` command is already on `PATH`, or for commands such as
  `t3tui daemon status`. If npm cannot install globally, it says how to do it yourself.
- `t3tui --local` uses t3tui's own background server even when you have paired with another T3
  Code. Its pairing now lives in `~/.t3-tui/local`, so pairing with another T3 Code no longer
  replaces it, and you can switch either way.
- When a saved pairing with another T3 Code cannot be reached, `t3tui` names it and suggests
  starting it or running `t3tui --local`, instead of only reporting that it is unavailable.
- The README leads with `npm install -g t3tui` and explains how the launcher, the bundled server,
  the service, and pairing fit together.

## 0.1.0 - 2026-11-12

First installable release.

- `npx t3tui` installs the TUI with its own bundled T3 server. No clone, build, or separate server
  install is needed.
- The first launch installs the server as a background service (`systemd --user` on Linux, launchd
  on macOS, a background process elsewhere), starts it, and pairs the TUI with it automatically.
  Later launches start a stopped server and reuse the saved pairing.
- `t3tui daemon install|start|stop|restart|status|uninstall` manages the service. Uninstalling
  keeps your threads in `~/.t3-tui/daemon/server`.
- The server listens on `127.0.0.1:3780` by default. Use `T3TUI_DAEMON_PORT` or
  `t3tui daemon install --port <port>` to change it.
- On Node older than 26.4, `t3tui` runs the TUI with Node 26 from npm.
- Settings (press `,`) sets up providers from the TUI: see what each needs, install a managed CLI,
  sign in through the server (browser link, device code, terminal, or credentials), sign out, turn
  providers on or off, edit their config and environment variables, update the CLI, and add or
  remove extra accounts. **General** edits server defaults for new threads, worktrees, and
  branches. Messages that pointed to "T3 settings" now point here.
