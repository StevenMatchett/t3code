# Changelog

Releases of the `t3tui` npm package. The bundled T3 server version is shown by `t3tui --version`.

## 0.1.0 - Unreleased

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
