// Proves a clean `npx t3tui` works end to end, from locally packed tarballs or,
// with --registry, a registry the packages were published to:
// npm installs the packages into an empty cache, the first launch installs and
// starts the background server, pairs with it, and renders the TUI; a stopped
// server is started again by the next launch; uninstall removes the service.
//
//   node scripts/npx-smoke.mjs [--tarballs <dir> | --registry <url>]
//     [--manager auto|systemd|launchd|process] [--keep]
//
// HOME, the npm cache, the TUI state, and the server data are temporary. On
// systemd and launchd the service is real but uses a disposable unit name, and
// is uninstalled when the smoke finishes, pass or fail.
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeUtil from "node:util";

const { values: flags } = NodeUtil.parseArgs({
  options: {
    tarballs: { type: "string" },
    registry: { type: "string" },
    manager: { type: "string", default: "auto" },
    keep: { type: "boolean", default: false },
  },
});

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3tui-npx-smoke-"));
const home = NodePath.join(root, "home");
await NodeFSP.mkdir(home);

const key = `${NodeProcess.platform}-${NodeProcess.arch}`;
/** The `npx` arguments that install t3tui: tarballs by path, or just its name from a registry. */
async function packageArgs() {
  if (flags.registry) return ["t3tui"];
  let tarballs = flags.tarballs && NodePath.resolve(flags.tarballs);
  if (!tarballs) {
    NodeProcess.stdout.write("Building npm packages…\n");
    // Imported here so the registry mode runs without the monorepo, as in the Docker test.
    const { buildTuiNpmPackages } = await import("./build-npm-packages.mjs");
    tarballs = (await buildTuiNpmPackages({ directory: NodePath.join(root, "packages") })).output;
  }
  const files = await NodeFSP.readdir(tarballs);
  const platformTarball = files.find(
    (name) => name.startsWith(`t3tui-${key}-`) && name.endsWith(".tgz"),
  );
  const launcherTarball = files.find((name) => /^t3tui-\d[^/]*\.tgz$/.test(name));
  NodeAssert.ok(platformTarball && launcherTarball, `Missing tarballs in ${tarballs}`);
  return [
    "--package",
    NodePath.join(tarballs, platformTarball),
    "--package",
    NodePath.join(tarballs, launcherTarball),
    "t3tui",
  ];
}

const serviceName = `t3tui-smoke-${NodeCrypto.randomBytes(3).toString("hex")}`;
const port = await freePort();
const env = {
  HOME: home,
  PATH: NodeProcess.env.PATH,
  TERM: "xterm-256color",
  LANG: "en_US.UTF-8",
  npm_config_cache: NodePath.join(root, "npm-cache"),
  npm_config_update_notifier: "false",
  npm_config_fund: "false",
  npm_config_audit: "false",
  ...(flags.registry ? { npm_config_registry: flags.registry } : {}),
  T3TUI_SERVICE_NAME: serviceName,
  T3TUI_DAEMON_PORT: String(port),
  ...(flags.manager === "auto" ? {} : { T3TUI_SERVICE_MANAGER: flags.manager }),
  // The user's systemd manager only reads units from the real config directory.
  XDG_CONFIG_HOME: NodePath.join(NodeOS.homedir(), ".config"),
  ...(NodeProcess.env.XDG_RUNTIME_DIR ? { XDG_RUNTIME_DIR: NodeProcess.env.XDG_RUNTIME_DIR } : {}),
  ...(NodeProcess.env.DBUS_SESSION_BUS_ADDRESS
    ? { DBUS_SESSION_BUS_ADDRESS: NodeProcess.env.DBUS_SESSION_BUS_ADDRESS }
    : {}),
};
const npx = NodeProcess.platform === "win32" ? "npx.cmd" : "npx";
const npxArgs = ["--yes", ...(await packageArgs())];

function t3tui(...args) {
  const result = NodeChildProcess.spawnSync(npx, [...npxArgs, ...args], {
    cwd: home,
    env,
    encoding: "utf8",
    shell: NodeProcess.platform === "win32",
    timeout: 300_000,
  });
  NodeProcess.stdout.write(`$ t3tui ${args.join(" ")} (exit ${result.status})\n${result.stdout}`);
  return result;
}

// Colors and cursor moves split rendered text; matching runs on what is left between them.
// oxlint-disable-next-line no-control-regex -- strips terminal escape sequences
const visibleText = (output) => output.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, "");

/**
 * Opens the TUI in a pseudo-terminal, waits for its empty-environment screen, then sends each
 * step's keys and waits for its text to be drawn.
 */
async function openTui(pty, label, steps = []) {
  const child = pty.spawn(npx, npxArgs, {
    cwd: home,
    cols: 100,
    rows: 30,
    name: "xterm-256color",
    env,
  });
  let output = "";
  let exited = false;
  let waiter = null;
  child.onData((data) => {
    output += data;
    waiter?.check();
  });
  child.onExit(({ exitCode }) => {
    exited = true;
    waiter?.fail(new Error(`${label}: TUI exited ${exitCode}`));
  });
  const waitFor = (text, from, timeoutMs) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiter = null;
        reject(
          new Error(
            `${label}: timed out waiting for ${JSON.stringify(text)}: ${JSON.stringify(visibleText(output.slice(from)).slice(-2000))}`,
          ),
        );
      }, timeoutMs);
      waiter = {
        check: () => {
          if (!visibleText(output.slice(from)).includes(text)) return;
          clearTimeout(timer);
          waiter = null;
          resolve();
        },
        fail: (error) => {
          clearTimeout(timer);
          waiter = null;
          reject(error);
        },
      };
      waiter.check();
    });
  const started = Date.now();
  try {
    await waitFor("Press P to add one.", 0, 180_000);
    NodeProcess.stdout.write(`${label}: TUI connected in ${Date.now() - started} ms\n`);
    for (const step of steps) {
      const from = output.length;
      child.write(step.keys);
      await waitFor(step.expect, from, 30_000);
      NodeProcess.stdout.write(`${label}: ${step.name}\n`);
    }
    child.write("\x03");
    await new Promise((resolve) => {
      if (exited) resolve();
      const timer = setTimeout(resolve, 10_000);
      child.onExit(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  } finally {
    if (!exited) child.kill("SIGKILL");
  }
}

const DOWN = "\x1b[B";
/**
 * Settings against the real server: the provider summary proves the server's provider status
 * loaded, and "Saved." proves a settings change went through the RPC. The terminal repaints only
 * changed cells, so expectations stick to text a step draws fresh.
 */
const settingsSteps = [
  { name: "opened settings with live provider status", keys: ",", expect: "need setup" },
  { name: "opened general settings", keys: `${DOWN}\r`, expect: "Default permissions" },
  { name: "saved a server setting", keys: "\r", expect: "Saved." },
];

/** Turning off the first provider writes an explicit provider instance through the RPC. */
const providerSteps = [
  { name: "opened settings", keys: ",", expect: "need setup" },
  { name: "listed providers", keys: "\r", expect: "provider account" },
  { name: "opened the first provider", keys: "\r", expect: "Check again" },
  { name: "turned it off", keys: "\r", expect: "Turned off." },
];

let failed = false;
try {
  const version = t3tui("--version");
  NodeAssert.equal(version.status, 0, version.stderr);
  NodeAssert.match(version.stdout, /^t3-tui \d+\.\d+\.\d+/m);

  const before = t3tui("daemon", "status");
  NodeAssert.equal(before.status, 3, before.stderr);
  NodeAssert.match(before.stdout, /not installed/);

  // npm unpacked node-pty for this platform, so the smoke drives a real terminal with it.
  const npxRoot = NodePath.join(env.npm_config_cache, "_npx");
  const [installed] = await NodeFSP.readdir(npxRoot);
  const platformPackage = NodePath.join(npxRoot, installed, "node_modules", `t3tui-${key}`);
  const pty = NodeModule.createRequire(NodePath.join(platformPackage, "package.json"))("node-pty");

  await openTui(pty, "first launch (installs, starts, and pairs)", settingsSteps);
  const running = t3tui("daemon", "status");
  NodeAssert.equal(running.status, 0, running.stderr);
  NodeAssert.match(running.stdout, new RegExp(`running at http://127\\.0\\.0\\.1:${port}`));
  NodeProcess.stdout.write(`service: ${/Service: (.*)/.exec(running.stdout)?.[1]}\n`);
  if (flags.manager === "auto" && NodeProcess.platform === "linux") {
    NodeAssert.match(running.stdout, /systemd --user .*\(active, enabled\)/);
  }
  NodeAssert.ok(
    NodeFS.existsSync(NodePath.join(home, ".t3-tui", "environment-credential.json")),
    "the first launch saved a paired credential",
  );
  const serverSettings = NodePath.join(
    home,
    ".t3-tui",
    "daemon",
    "server",
    "userdata",
    "settings.json",
  );
  NodeAssert.match(
    NodeFS.readFileSync(serverSettings, "utf8"),
    /"defaultRuntimeMode":\s*"approval-required"/,
    "the settings screen saved to the server",
  );

  const stop = t3tui("daemon", "stop");
  NodeAssert.equal(stop.status, 0, stop.stderr);
  NodeAssert.equal(t3tui("daemon", "status").status, 3);

  await openTui(
    pty,
    "second launch (restarts a stopped server, reuses the credential)",
    providerSteps,
  );
  NodeAssert.match(
    NodeFS.readFileSync(serverSettings, "utf8"),
    /"providerInstances":\s*\{\s*"[a-zA-Z]+":\s*\{[^}]*"enabled":\s*false/,
    "turning a provider off saved an explicit instance",
  );
  NodeAssert.equal(t3tui("daemon", "status").status, 0);
} catch (error) {
  failed = true;
  NodeProcess.stderr.write(`${error.stack ?? error}\n`);
  const log = NodePath.join(home, ".t3-tui", "daemon", "server.log");
  if (NodeFS.existsSync(log)) {
    NodeProcess.stderr.write(
      `--- server.log (tail) ---\n${NodeFS.readFileSync(log, "utf8").slice(-4000)}\n`,
    );
  }
} finally {
  const uninstall = t3tui("daemon", "uninstall");
  if (uninstall.status !== 0) failed = true;
  const after = t3tui("daemon", "status");
  if (after.status !== 3) failed = true;
  const unit = NodePath.join(env.XDG_CONFIG_HOME, "systemd", "user", `${serviceName}.service`);
  if (NodeFS.existsSync(unit)) {
    failed = true;
    NodeProcess.stderr.write(`Leftover unit: ${unit}\n`);
  }
  if (flags.keep) NodeProcess.stdout.write(`Kept ${root}\n`);
  else await NodeFSP.rm(root, { recursive: true, force: true });
}

NodeProcess.stdout.write(failed ? "npx smoke FAILED\n" : "npx smoke passed\n");
process.exitCode = failed ? 1 : 0;
