/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalTimers:off - Plain async process management that runs before any Effect runtime exists.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

/**
 * The T3 server that a packaged TUI (`npx t3tui`) runs in the background.
 *
 * It lives under `~/.t3-tui/daemon`, separate from T3 Code's `~/.t3`, and runs
 * from a copy of the package (`runtime/<version>`) so the service keeps working
 * after npm cleans its npx cache. The service manager is systemd --user on
 * Linux, launchd on macOS, and a detached process with a PID file elsewhere.
 */

export const DEFAULT_TUI_DAEMON_PORT = 3_780;
const DAEMON_HOST = "127.0.0.1";
const READY_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;

export type TuiDaemonManager = "systemd" | "launchd" | "process";

export interface TuiDaemonContext {
  readonly homeDir: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly platform: NodeJS.Platform;
  /** The packaged TUI directory: the one holding `server/bin.mjs` and `node_modules`. */
  readonly artifactRoot: string;
  readonly packageVersion: string;
  readonly execPath: string;
  readonly log?: (line: string) => void;
}

export interface TuiDaemonConfig {
  readonly version: 1;
  readonly port: number;
  readonly runtimeVersion: string;
  readonly manager: TuiDaemonManager;
  readonly nodePath: string;
}

export interface TuiDaemonStatus {
  readonly installed: boolean;
  readonly running: boolean;
  readonly origin: string;
  readonly config?: TuiDaemonConfig;
  readonly managerState?: string;
}

export class TuiDaemonError extends Error {
  override readonly name = "TuiDaemonError";
}

export function tuiDaemonPaths(homeDir: string) {
  const home = NodePath.join(homeDir, ".t3-tui", "daemon");
  return {
    home,
    configPath: NodePath.join(home, "daemon.json"),
    runtimeRoot: NodePath.join(home, "runtime"),
    serverHome: NodePath.join(home, "server"),
    logPath: NodePath.join(home, "server.log"),
    pidPath: NodePath.join(home, "server.pid"),
  };
}

/** `T3TUI_SERVICE_NAME` exists so smoke tests can install a disposable unit. */
function serviceNames(context: TuiDaemonContext) {
  const name = context.env.T3TUI_SERVICE_NAME?.trim() || "t3tui";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new TuiDaemonError(`T3TUI_SERVICE_NAME must be lowercase letters, digits, and dashes.`);
  }
  const configHome =
    context.env.XDG_CONFIG_HOME?.trim() || NodePath.join(context.homeDir, ".config");
  const label = `com.${name}.server`;
  return {
    systemdUnit: `${name}.service`,
    systemdUnitPath: NodePath.join(configHome, "systemd", "user", `${name}.service`),
    launchdLabel: label,
    launchdPlistPath: NodePath.join(context.homeDir, "Library", "LaunchAgents", `${label}.plist`),
  };
}

export function tuiDaemonOrigin(port: number): string {
  return `http://${DAEMON_HOST}:${port}`;
}

/** What the service manager runs, and with which environment. */
export function tuiDaemonLaunch(input: {
  readonly config: TuiDaemonConfig;
  readonly homeDir: string;
  readonly path: string;
}) {
  const paths = tuiDaemonPaths(input.homeDir);
  return {
    program: [
      input.config.nodePath,
      NodePath.join(paths.runtimeRoot, input.config.runtimeVersion, "server", "bin.mjs"),
      "serve",
    ],
    env: {
      PATH: input.path,
      T3CODE_HOME: paths.serverHome,
      T3CODE_HOST: DAEMON_HOST,
      T3CODE_PORT: String(input.config.port),
      T3CODE_NO_BROWSER: "true",
      T3CODE_TELEMETRY_ENABLED: "false",
      T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
      T3CODE_TAILSCALE_SERVE: "false",
    },
    logPath: paths.logPath,
  };
}

type TuiDaemonLaunch = ReturnType<typeof tuiDaemonLaunch>;

function quoteSystemd(value: string): string {
  return `"${value.replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function renderTuiDaemonSystemdUnit(launch: TuiDaemonLaunch): string {
  return [
    "[Unit]",
    "Description=T3 server for the T3 TUI",
    "StartLimitIntervalSec=300",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "Type=simple",
    "WorkingDirectory=%h",
    ...Object.entries(launch.env).map(
      ([key, value]) => `Environment=${quoteSystemd(`${key}=${value}`)}`,
    ),
    `ExecStart=${launch.program.map(quoteSystemd).join(" ")}`,
    // Agent tool calls are children of the server; one being OOM-killed must not stop the unit.
    "KillMode=mixed",
    "OOMPolicy=continue",
    // The server exits 130 after a graceful SIGTERM.
    "SuccessExitStatus=130 143",
    "Restart=on-failure",
    "RestartSec=5",
    `StandardOutput=append:${launch.logPath.replaceAll("%", "%%")}`,
    `StandardError=append:${launch.logPath.replaceAll("%", "%%")}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderTuiDaemonLaunchdPlist(
  launch: TuiDaemonLaunch,
  options: { readonly label: string; readonly homeDir: string },
): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  <string>${escapeXml(options.label)}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    ...launch.program.map((argument) => `    <string>${escapeXml(argument)}</string>`),
    `  </array>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    ...Object.entries(launch.env).flatMap(([key, value]) => [
      `    <key>${escapeXml(key)}</key>`,
      `    <string>${escapeXml(value)}</string>`,
    ]),
    `  </dict>`,
    `  <key>WorkingDirectory</key>`,
    `  <string>${escapeXml(options.homeDir)}</string>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    // Restart after a crash, but let `launchctl kill` or a clean exit stay stopped.
    `  <key>KeepAlive</key>`,
    `  <dict>`,
    `    <key>SuccessfulExit</key>`,
    `    <false/>`,
    `  </dict>`,
    `  <key>ThrottleInterval</key>`,
    `  <integer>5</integer>`,
    `  <key>ProcessType</key>`,
    `  <string>Interactive</string>`,
    `  <key>StandardOutPath</key>`,
    `  <string>${escapeXml(launch.logPath)}</string>`,
    `  <key>StandardErrorPath</key>`,
    `  <string>${escapeXml(launch.logPath)}</string>`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n");
}

function run(command: string, args: ReadonlyArray<string>) {
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runOrThrow(command: string, args: ReadonlyArray<string>) {
  const result = run(command, args);
  if (!result.ok) {
    throw new TuiDaemonError(
      `\`${command} ${args.join(" ")}\` failed${result.stderr.trim() ? `: ${result.stderr.trim()}` : "."}`,
    );
  }
  return result;
}

export function selectTuiDaemonManager(
  context: Pick<TuiDaemonContext, "env" | "platform">,
  probeSystemd: () => boolean = () => run("systemctl", ["--user", "show-environment"]).ok,
): TuiDaemonManager {
  const forced = context.env.T3TUI_SERVICE_MANAGER?.trim();
  if (forced === "systemd" || forced === "launchd" || forced === "process") return forced;
  if (forced) {
    throw new TuiDaemonError("T3TUI_SERVICE_MANAGER must be systemd, launchd, or process.");
  }
  if (context.platform === "darwin") return "launchd";
  if (context.platform === "linux" && probeSystemd()) return "systemd";
  return "process";
}

/** Probes the public descriptor, so it also proves the port belongs to a T3 server. */
async function probeTuiDaemon(origin: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/.well-known/t3/environment", origin), {
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { readonly environmentId?: unknown };
    return typeof body.environmentId === "string";
  } catch {
    return false;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function makeTuiDaemon(context: TuiDaemonContext) {
  const paths = tuiDaemonPaths(context.homeDir);
  const log = context.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  const readConfig = async (): Promise<TuiDaemonConfig | undefined> => {
    let text: string;
    try {
      text = await NodeFSP.readFile(paths.configPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const value = JSON.parse(text) as Partial<TuiDaemonConfig>;
    if (
      value.version !== 1 ||
      typeof value.port !== "number" ||
      typeof value.runtimeVersion !== "string" ||
      typeof value.nodePath !== "string" ||
      (value.manager !== "systemd" && value.manager !== "launchd" && value.manager !== "process")
    ) {
      throw new TuiDaemonError(
        `${paths.configPath} is not a valid daemon config. Run \`t3tui daemon uninstall\`, then try again.`,
      );
    }
    return value as TuiDaemonConfig;
  };

  const writeConfig = async (config: TuiDaemonConfig) => {
    await NodeFSP.mkdir(paths.home, { recursive: true, mode: 0o700 });
    const temp = `${paths.configPath}.${process.pid}.tmp`;
    await NodeFSP.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await NodeFSP.rename(temp, paths.configPath);
  };

  const uid = () => {
    const value = process.getuid?.();
    if (value === undefined) throw new TuiDaemonError("launchd needs a POSIX user id.");
    return value;
  };

  /** Copies the package so the service never points into npm's disposable npx cache. */
  const installRuntime = async (version: string) => {
    const target = NodePath.join(paths.runtimeRoot, version);
    if (NodeFS.existsSync(NodePath.join(target, "server", "bin.mjs"))) return target;
    await NodeFSP.mkdir(paths.runtimeRoot, { recursive: true, mode: 0o700 });
    const staging = await NodeFSP.mkdtemp(NodePath.join(paths.runtimeRoot, `.${version}-`));
    try {
      await NodeFSP.cp(context.artifactRoot, staging, { recursive: true });
      await NodeFSP.rename(staging, target);
    } catch (error) {
      await NodeFSP.rm(staging, { recursive: true, force: true });
      throw error;
    }
    return target;
  };

  const resolveNodePath = async (runtimeDirectory: string) => {
    // `npx node@26` runs a Node binary from the npx cache, which npm may delete.
    if (!context.execPath.split(NodePath.sep).includes("_npx")) return context.execPath;
    const copy = NodePath.join(
      runtimeDirectory,
      context.platform === "win32" ? "node.exe" : "node",
    );
    await NodeFSP.copyFile(context.execPath, copy);
    await NodeFSP.chmod(copy, 0o755);
    return copy;
  };

  const pruneRuntimes = async (keep: string) => {
    const entries = await NodeFSP.readdir(paths.runtimeRoot).catch(() => []);
    for (const entry of entries) {
      if (entry !== keep) {
        await NodeFSP.rm(NodePath.join(paths.runtimeRoot, entry), { recursive: true, force: true });
      }
    }
  };

  const defaultPort = () => {
    const value = Number(context.env.T3TUI_DAEMON_PORT);
    return Number.isSafeInteger(value) && value > 0 && value < 65_536
      ? value
      : DEFAULT_TUI_DAEMON_PORT;
  };

  // npm and npx prepend their temporary bin directories; the service outlives them.
  const servicePath = () =>
    (context.env.PATH ?? "")
      .split(NodePath.delimiter)
      .filter((entry) => entry && !entry.split(/[\\/]/).includes("node_modules"))
      .join(NodePath.delimiter);

  const launchFor = (config: TuiDaemonConfig) =>
    tuiDaemonLaunch({ config, homeDir: context.homeDir, path: servicePath() });

  const readPid = async () => {
    const text = await NodeFSP.readFile(paths.pidPath, "utf8").catch(() => "");
    const pid = Number(text.trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  };

  /** Only a PID we recorded, and only while it still runs our server entry. */
  const ownedProcessPid = async (config: TuiDaemonConfig) => {
    const pid = await readPid();
    if (pid === undefined || !isPidAlive(pid)) return undefined;
    if (context.platform === "win32") return pid;
    const command = run("ps", ["-p", String(pid), "-o", "command="]).stdout;
    return command.includes(launchFor(config).program[1]!) ? pid : undefined;
  };

  const startProcess = async (config: TuiDaemonConfig) => {
    if ((await ownedProcessPid(config)) !== undefined) return;
    const launch = launchFor(config);
    await NodeFSP.mkdir(paths.home, { recursive: true, mode: 0o700 });
    const logFd = NodeFS.openSync(launch.logPath, "a", 0o600);
    try {
      const child = NodeChildProcess.spawn(launch.program[0]!, launch.program.slice(1), {
        cwd: context.homeDir,
        env: { ...context.env, ...launch.env },
        detached: true,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true,
      });
      if (child.pid === undefined) throw new TuiDaemonError("Could not start the T3 server.");
      child.unref();
      await NodeFSP.writeFile(paths.pidPath, `${child.pid}\n`, { mode: 0o600 });
    } finally {
      NodeFS.closeSync(logFd);
    }
  };

  const stopProcess = async (config: TuiDaemonConfig) => {
    const pid = await ownedProcessPid(config);
    await NodeFSP.rm(paths.pidPath, { force: true });
    if (pid === undefined) return;
    process.kill(pid, "SIGTERM");
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (isPidAlive(pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (isPidAlive(pid)) process.kill(pid, "SIGKILL");
  };

  const writeServiceFile = async (config: TuiDaemonConfig) => {
    const names = serviceNames(context);
    const launch = launchFor(config);
    if (config.manager === "systemd") {
      await NodeFSP.mkdir(NodePath.dirname(names.systemdUnitPath), { recursive: true });
      await NodeFSP.writeFile(names.systemdUnitPath, renderTuiDaemonSystemdUnit(launch));
    } else if (config.manager === "launchd") {
      await NodeFSP.mkdir(NodePath.dirname(names.launchdPlistPath), { recursive: true });
      await NodeFSP.writeFile(
        names.launchdPlistPath,
        renderTuiDaemonLaunchdPlist(launch, {
          label: names.launchdLabel,
          homeDir: context.homeDir,
        }),
      );
    }
  };

  const startService = async (config: TuiDaemonConfig, { restart = false } = {}) => {
    const names = serviceNames(context);
    switch (config.manager) {
      case "systemd":
        runOrThrow("systemctl", ["--user", restart ? "restart" : "start", names.systemdUnit]);
        return;
      case "launchd": {
        const domain = `gui/${uid()}`;
        if (restart) run("launchctl", ["bootout", `${domain}/${names.launchdLabel}`]);
        if (!run("launchctl", ["bootstrap", domain, names.launchdPlistPath]).ok) {
          runOrThrow("launchctl", ["kickstart", `${domain}/${names.launchdLabel}`]);
        }
        return;
      }
      case "process":
        if (restart) await stopProcess(config);
        await startProcess(config);
    }
  };

  const stopService = async (config: TuiDaemonConfig) => {
    const names = serviceNames(context);
    switch (config.manager) {
      case "systemd":
        runOrThrow("systemctl", ["--user", "stop", names.systemdUnit]);
        return;
      case "launchd":
        // Unloading is the only stop launchd honors; the plist reloads at next login.
        run("launchctl", ["bootout", `gui/${uid()}/${names.launchdLabel}`]);
        return;
      case "process":
        await stopProcess(config);
    }
  };

  const managerState = (config: TuiDaemonConfig) => {
    const names = serviceNames(context);
    if (config.manager === "systemd") {
      const active = run("systemctl", ["--user", "is-active", names.systemdUnit]).stdout.trim();
      const enabled = run("systemctl", ["--user", "is-enabled", names.systemdUnit]).stdout.trim();
      return `systemd --user ${names.systemdUnit} (${active || "unknown"}, ${enabled || "unknown"})`;
    }
    if (config.manager === "launchd") {
      const loaded = run("launchctl", ["print", `gui/${uid()}/${names.launchdLabel}`]).ok;
      return `launchd ${names.launchdLabel} (${loaded ? "loaded" : "not loaded"})`;
    }
    return `background process (no service manager; starts with the TUI)`;
  };

  const waitUntilReady = async (config: TuiDaemonConfig) => {
    const origin = tuiDaemonOrigin(config.port);
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await probeTuiDaemon(origin)) return origin;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new TuiDaemonError(
      `The T3 server did not answer at ${origin}. See ${paths.logPath}. ` +
        "If another program uses that port, run `t3tui daemon install --port <port>`.",
    );
  };

  const install = async (options: { readonly port?: number } = {}) => {
    const previous = await readConfig();
    const runtimeDirectory = await installRuntime(context.packageVersion);
    const manager = selectTuiDaemonManager(context);
    if (previous && previous.manager !== manager) await uninstallService(previous);
    const config: TuiDaemonConfig = {
      version: 1,
      port: options.port ?? previous?.port ?? defaultPort(),
      runtimeVersion: context.packageVersion,
      manager,
      nodePath: await resolveNodePath(runtimeDirectory),
    };
    await NodeFSP.mkdir(paths.serverHome, { recursive: true, mode: 0o700 });
    // The server logs a short-lived pairing link at startup; keep the log private.
    await NodeFSP.appendFile(paths.logPath, "", { mode: 0o600 });
    await writeConfig(config);
    await writeServiceFile(config);
    if (manager === "systemd") {
      runOrThrow("systemctl", ["--user", "daemon-reload"]);
      runOrThrow("systemctl", ["--user", "enable", serviceNames(context).systemdUnit]);
    }
    await startService(config, { restart: previous !== undefined });
    const origin = await waitUntilReady(config);
    await pruneRuntimes(context.packageVersion);
    return { config, origin };
  };

  const uninstallService = async (config: TuiDaemonConfig) => {
    const names = serviceNames(context);
    await stopService(config).catch(() => undefined);
    if (config.manager === "systemd") {
      run("systemctl", ["--user", "disable", names.systemdUnit]);
      await NodeFSP.rm(names.systemdUnitPath, { force: true });
      run("systemctl", ["--user", "daemon-reload"]);
      run("systemctl", ["--user", "reset-failed", names.systemdUnit]);
    } else if (config.manager === "launchd") {
      await NodeFSP.rm(names.launchdPlistPath, { force: true });
    }
  };

  const uninstall = async () => {
    const config = await readConfig();
    if (config === undefined) return false;
    await uninstallService(config);
    await NodeFSP.rm(paths.runtimeRoot, { recursive: true, force: true });
    await NodeFSP.rm(paths.configPath, { force: true });
    await NodeFSP.rm(paths.pidPath, { force: true });
    return true;
  };

  const status = async (): Promise<TuiDaemonStatus> => {
    const config = await readConfig();
    const origin = tuiDaemonOrigin(config?.port ?? defaultPort());
    if (config === undefined) return { installed: false, running: false, origin };
    return {
      installed: true,
      running: await probeTuiDaemon(origin),
      origin,
      config,
      managerState: managerState(config),
    };
  };

  /**
   * Starts the server for the TUI, installing it on first use. A stopped
   * server from an older package is upgraded in place; a running one is left
   * alone so live agent work is not interrupted.
   */
  const ensureRunning = async () => {
    const config = await readConfig();
    if (config === undefined) {
      log("Setting up the T3 server as a background service (first run)…");
      return (await install()).origin;
    }
    const origin = tuiDaemonOrigin(config.port);
    if (await probeTuiDaemon(origin)) {
      if (config.runtimeVersion !== context.packageVersion) {
        log(
          `The background T3 server runs t3tui ${config.runtimeVersion}. ` +
            "Run `t3tui daemon install` to switch it to this version (restarts the server).",
        );
      }
      return origin;
    }
    if (config.runtimeVersion !== context.packageVersion) return (await install()).origin;
    await startService(config);
    return waitUntilReady(config);
  };

  /** Mints a one-time pairing token with the server's own `pair` command. */
  const mintPairingToken = async () => {
    const config = await readConfig();
    if (config === undefined) throw new TuiDaemonError("The T3 server is not installed.");
    const launch = launchFor(config);
    const result = NodeChildProcess.spawnSync(
      launch.program[0]!,
      [
        launch.program[1]!,
        "pair",
        "--base-dir",
        paths.serverHome,
        "--label",
        "T3 TUI",
        "--ttl",
        "2m",
      ],
      {
        encoding: "utf8",
        timeout: 60_000,
        windowsHide: true,
        env: { ...context.env, ...launch.env },
      },
    );
    const token = /^Token: (\S+)$/m.exec(result.stdout ?? "")?.[1];
    if (result.status !== 0 || token === undefined) {
      throw new TuiDaemonError(
        `Could not pair with the local T3 server${result.stderr?.trim() ? `: ${result.stderr.trim()}` : "."}`,
      );
    }
    return token;
  };

  const origin = async () => tuiDaemonOrigin((await readConfig())?.port ?? defaultPort());

  return {
    paths,
    origin,
    install,
    uninstall,
    status,
    ensureRunning,
    mintPairingToken,
    start: async () => {
      const config = await readConfig();
      if (config === undefined) return (await install()).origin;
      return ensureRunning();
    },
    stop: async () => {
      const config = await readConfig();
      if (config === undefined) return false;
      await stopService(config);
      return true;
    },
  };
}

export type TuiDaemon = ReturnType<typeof makeTuiDaemon>;

export type TuiDaemonCommand = "install" | "uninstall" | "start" | "stop" | "restart" | "status";

export const TUI_DAEMON_COMMANDS: ReadonlyArray<TuiDaemonCommand> = [
  "install",
  "uninstall",
  "start",
  "stop",
  "restart",
  "status",
];

export async function runTuiDaemonCommand(
  daemon: TuiDaemon,
  command: TuiDaemonCommand,
  options: { readonly port?: number; readonly write: (text: string) => void },
): Promise<number> {
  const { write } = options;
  switch (command) {
    case "install": {
      const { config, origin } = await daemon.install(
        options.port === undefined ? {} : { port: options.port },
      );
      write(
        `T3 server running at ${origin} (t3tui ${config.runtimeVersion}, ${config.manager}).\n`,
      );
      write(`Logs: ${daemon.paths.logPath}\n`);
      return 0;
    }
    case "start":
      write(`T3 server running at ${await daemon.start()}.\n`);
      return 0;
    case "restart": {
      await daemon.stop();
      write(`T3 server running at ${await daemon.start()}.\n`);
      return 0;
    }
    case "stop":
      write(
        (await daemon.stop()) ? "Stopped the T3 server.\n" : "The T3 server is not installed.\n",
      );
      return 0;
    case "uninstall":
      write(
        (await daemon.uninstall())
          ? `Removed the T3 server service. Your threads and settings are kept in ${daemon.paths.serverHome}.\n`
          : "The T3 server is not installed.\n",
      );
      return 0;
    case "status": {
      const status = await daemon.status();
      if (!status.installed || status.config === undefined) {
        write("T3 server: not installed. `t3tui` installs it on first launch.\n");
        return 3;
      }
      write(
        [
          `T3 server: ${status.running ? "running" : "stopped"} at ${status.origin}`,
          `  Version: t3tui ${status.config.runtimeVersion}`,
          `  Service: ${status.managerState}`,
          `  Data: ${daemon.paths.serverHome}`,
          `  Logs: ${daemon.paths.logPath}`,
          "",
        ].join("\n"),
      );
      return status.running ? 0 : 3;
    }
  }
}
