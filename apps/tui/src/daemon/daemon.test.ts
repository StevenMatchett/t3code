// @effect-diagnostics nodeBuiltinImport:off
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import {
  makeTuiDaemon,
  renderTuiDaemonLaunchdPlist,
  renderTuiDaemonSystemdUnit,
  selectTuiDaemonManager,
  tuiDaemonLaunch,
  TuiDaemonError,
} from "./daemon.ts";

// Stands in for the bundled server: answers the environment descriptor and `pair`.
const FAKE_SERVER = `
import * as http from "node:http";
if (process.argv[2] === "pair") {
  process.stdout.write("Pairing URL: http://example/pair#token=fake-token\\nToken: fake-token\\n");
} else {
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ environmentId: "env-1", home: process.env.T3CODE_HOME }));
  });
  server.listen(Number(process.env.T3CODE_PORT), process.env.T3CODE_HOST);
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
`;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

describe("selectTuiDaemonManager", () => {
  it("prefers launchd on macOS and systemd --user on Linux when it answers", () => {
    expect(selectTuiDaemonManager({ env: {}, platform: "darwin" }, () => false)).toBe("launchd");
    expect(selectTuiDaemonManager({ env: {}, platform: "linux" }, () => true)).toBe("systemd");
  });

  it("falls back to a background process without a service manager", () => {
    expect(selectTuiDaemonManager({ env: {}, platform: "linux" }, () => false)).toBe("process");
    expect(selectTuiDaemonManager({ env: {}, platform: "win32" }, () => true)).toBe("process");
  });

  it("honors and validates an explicit manager", () => {
    const env = { T3TUI_SERVICE_MANAGER: "process" };
    expect(selectTuiDaemonManager({ env, platform: "darwin" })).toBe("process");
    expect(() =>
      selectTuiDaemonManager({ env: { T3TUI_SERVICE_MANAGER: "cron" }, platform: "linux" }),
    ).toThrow(TuiDaemonError);
  });
});

describe("service files", () => {
  const launch = tuiDaemonLaunch({
    config: {
      version: 1,
      port: 3780,
      runtimeVersion: "1.2.3",
      manager: "systemd",
      nodePath: '/opt/my node/50% "fast"/node',
    },
    homeDir: "/home/a&b",
    path: "/usr/bin:/home/a&b/bin",
  });

  it("quotes systemd values so spaces, quotes, and % specifiers survive", () => {
    const unit = renderTuiDaemonSystemdUnit(launch);
    expect(unit).toContain('ExecStart="/opt/my node/50%% \\"fast\\"/node" ');
    expect(unit).toContain('Environment="T3CODE_HOME=/home/a&b/.t3-tui/daemon/server"');
    expect(unit).toContain('Environment="T3CODE_HOST=127.0.0.1"');
  });

  it("escapes plist text nodes", () => {
    const plist = renderTuiDaemonLaunchdPlist(launch, {
      label: "com.t3tui.server",
      homeDir: "/home/a&b",
    });
    expect(plist).toContain("<string>/usr/bin:/home/a&amp;b/bin</string>");
    expect(plist).not.toMatch(/a&b/);
  });
});

describe("process-managed daemon", () => {
  it("installs, pairs, stops, restarts on demand, and uninstalls without losing data", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tui-daemon-test-"));
    const artifactRoot = NodePath.join(root, "artifact");
    await NodeFSP.mkdir(NodePath.join(artifactRoot, "server"), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(artifactRoot, "server", "bin.mjs"), FAKE_SERVER);
    const homeDir = NodePath.join(root, "home");
    const port = await freePort();
    const daemon = makeTuiDaemon({
      homeDir,
      env: { T3TUI_SERVICE_MANAGER: "process", T3TUI_DAEMON_PORT: String(port), PATH: "/usr/bin" },
      platform: NodeProcess.platform,
      artifactRoot,
      packageVersion: "1.0.0",
      execPath: process.execPath,
      log: () => undefined,
    });
    cleanups.push(async () => {
      await daemon.uninstall();
      await NodeFSP.rm(root, { recursive: true, force: true });
    });

    expect(await daemon.status()).toMatchObject({ installed: false, running: false });
    const origin = await daemon.ensureRunning();
    expect(origin).toBe(`http://127.0.0.1:${port}`);
    expect(await daemon.status()).toMatchObject({ installed: true, running: true });
    // The service runs from its own copy, not from the (npx-cached) package.
    expect(
      NodeFS.existsSync(NodePath.join(daemon.paths.runtimeRoot, "1.0.0", "server", "bin.mjs")),
    ).toBe(true);
    expect(await daemon.mintPairingToken()).toBe("fake-token");

    expect(await daemon.stop()).toBe(true);
    expect((await daemon.status()).running).toBe(false);
    expect(await daemon.ensureRunning()).toBe(origin);
    expect((await daemon.status()).running).toBe(true);

    await NodeFSP.writeFile(NodePath.join(daemon.paths.serverHome, "state.sqlite"), "threads");
    expect(await daemon.uninstall()).toBe(true);
    expect(await daemon.status()).toMatchObject({ installed: false, running: false });
    expect(NodeFS.existsSync(daemon.paths.runtimeRoot)).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(daemon.paths.serverHome, "state.sqlite"))).toBe(true);
  });
});
