/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off

import * as NodePath from "node:path";

import type { StartAndConnectAuthenticatedTuiEnvironmentOptions } from "../connection/authenticatedEnvironment.ts";
import { TUI_DAEMON_COMMANDS, type TuiDaemonCommand } from "../daemon/daemon.ts";

export const DEFAULT_TUI_PORT = 3_773;
export const DEFAULT_TUI_STATE_DIRECTORY_NAME = ".t3-tui";
export const TUI_LOOPBACK_HOST = "127.0.0.1";

export interface TuiCliOptions {
  readonly stateDir: string;
  readonly cwd: string;
  readonly port: number;
  readonly connect?: string;
  readonly pairStdin?: boolean;
  readonly newEnvironment?: boolean;
  readonly local?: boolean;
}

export type TuiCliParseResult =
  | { readonly action: "run"; readonly options: TuiCliOptions }
  | {
      readonly action: "daemon";
      readonly command: TuiDaemonCommand;
      readonly port?: number;
    }
  | { readonly action: "help" }
  | { readonly action: "version" };

export interface TuiCliParseContext {
  readonly cwd: string;
  readonly homeDir: string;
}

export interface TuiLaunchRuntime {
  readonly executable: string;
  readonly serverEntryPath: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
}

export class TuiCliUsageError extends Error {
  override readonly name = "TuiCliUsageError";
}

export function formatTuiCliError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : "TUI failed with an unexpected error.";
}

function resolveCliPath(value: string, context: TuiCliParseContext): string {
  if (value === "~") return context.homeDir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return NodePath.resolve(context.homeDir, value.slice(2));
  }
  return NodePath.resolve(context.cwd, value);
}

function isPathAtOrBelow(candidate: string, parent: string): boolean {
  const relative = NodePath.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${NodePath.sep}`) && relative !== "..");
}

function assertSafeStateDirectory(stateDir: string, context: TuiCliParseContext): void {
  const liveBaseDir = NodePath.resolve(context.homeDir, ".t3");
  const liveUserdataDir = NodePath.join(liveBaseDir, "userdata");
  if (stateDir === liveBaseDir || isPathAtOrBelow(stateDir, liveUserdataDir)) {
    throw new TuiCliUsageError(`Refusing to use the live T3 Code state directory: ${stateDir}`);
  }
}

function parsePort(value: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new TuiCliUsageError(`--port must be an integer between 1 and 65535; received ${value}`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TuiCliUsageError(`--port must be an integer between 1 and 65535; received ${value}`);
  }
  return port;
}

function splitFlag(argument: string): readonly [name: string, inlineValue: string | undefined] {
  const equalsIndex = argument.indexOf("=");
  return equalsIndex === -1
    ? [argument, undefined]
    : [argument.slice(0, equalsIndex), argument.slice(equalsIndex + 1)];
}

function parseConnectionOrigin(value: string): string {
  const url = URL.parse(value);
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname !== "/"
  ) {
    throw new TuiCliUsageError(
      "--connect requires an HTTP(S) origin without credentials, a path, or a pairing token.",
    );
  }
  return url.origin;
}

function parseDaemonArgs(argv: ReadonlyArray<string>): TuiCliParseResult {
  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h") return { action: "help" };
  if (!TUI_DAEMON_COMMANDS.includes(command as TuiDaemonCommand)) {
    throw new TuiCliUsageError(`Usage: t3tui daemon <${TUI_DAEMON_COMMANDS.join("|")}>`);
  }
  let port: number | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const [name, inlineValue] = splitFlag(rest[index]!);
    if (name !== "--port" || command !== "install" || port !== undefined) {
      throw new TuiCliUsageError("Only `t3tui daemon install` accepts one --port <port>.");
    }
    const value = inlineValue ?? rest[(index += 1)];
    if (value === undefined) throw new TuiCliUsageError("--port requires a value");
    port = parsePort(value);
  }
  return {
    action: "daemon",
    command: command as TuiDaemonCommand,
    ...(port === undefined ? {} : { port }),
  };
}

export function parseTuiCliArgs(
  argv: ReadonlyArray<string>,
  context: TuiCliParseContext,
): TuiCliParseResult {
  if (argv[0] === "daemon") return parseDaemonArgs(argv.slice(1));
  let stateDir: string | undefined;
  let cwd: string | undefined;
  let port: number | undefined;
  let connect: string | undefined;
  let pairStdin = false;
  let newEnvironment = false;
  let local = false;
  const seen = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--") continue;
    const [name, inlineValue] = splitFlag(argument);

    if (name === "--help" || name === "-h") return { action: "help" };
    if (name === "--version" || name === "-v") return { action: "version" };
    if (
      ![
        "--state-dir",
        "--cwd",
        "--port",
        "--connect",
        "--pair-stdin",
        "--new-environment",
        "--local",
      ].includes(name)
    ) {
      throw new TuiCliUsageError("Unknown argument. Use --help to see supported options.");
    }
    if (seen.has(name)) throw new TuiCliUsageError(`${name} may only be supplied once`);
    seen.add(name);
    if (name === "--pair-stdin" || name === "--new-environment" || name === "--local") {
      if (inlineValue !== undefined) throw new TuiCliUsageError(`${name} does not accept a value`);
      if (name === "--pair-stdin") pairStdin = true;
      else if (name === "--local") local = true;
      else newEnvironment = true;
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (
      value === undefined ||
      value.length === 0 ||
      (inlineValue === undefined && value.startsWith("-"))
    ) {
      throw new TuiCliUsageError(`${name} requires a value`);
    }
    if (inlineValue === undefined) index += 1;

    switch (name) {
      case "--state-dir":
        stateDir = resolveCliPath(value, context);
        break;
      case "--cwd":
        cwd = resolveCliPath(value, context);
        break;
      case "--port":
        port = parsePort(value);
        break;
      case "--connect":
        connect = parseConnectionOrigin(value);
        break;
    }
  }

  if (pairStdin && !connect) throw new TuiCliUsageError("--pair-stdin requires --connect <origin>");
  if (newEnvironment && (connect || pairStdin)) {
    throw new TuiCliUsageError(
      "--new-environment cannot be combined with existing-environment options",
    );
  }
  if (local && (connect || pairStdin || newEnvironment)) {
    throw new TuiCliUsageError("--local cannot be combined with other environment options");
  }
  const resolvedStateDir =
    stateDir ?? NodePath.resolve(context.homeDir, DEFAULT_TUI_STATE_DIRECTORY_NAME);
  assertSafeStateDirectory(resolvedStateDir, context);
  return {
    action: "run",
    options: {
      stateDir: resolvedStateDir,
      cwd: cwd ?? NodePath.resolve(context.cwd),
      port: port ?? DEFAULT_TUI_PORT,
      ...(connect ? { connect } : {}),
      ...(pairStdin ? { pairStdin } : {}),
      ...(newEnvironment ? { newEnvironment } : {}),
      ...(local ? { local } : {}),
    },
  };
}

export function formatTuiCliHelp(context: TuiCliParseContext): string {
  const defaultStateDir = NodePath.resolve(context.homeDir, DEFAULT_TUI_STATE_DIRECTORY_NAME);
  return [
    "Usage: t3-tui [options]",
    "",
    "Attach the TUI prototype to your saved T3 Code environment.",
    "Existing projects and threads stay on that server. The current UI is still a prototype.",
    "With no saved environment, the packaged t3tui starts and pairs with its own local server.",
    "",
    "Options:",
    "  --connect <origin>  Attach only to this HTTP(S) origin with its saved credential",
    "  --pair-stdin        Read a T3 pairing link or token from stdin, save the connection, and exit",
    "  --new-environment   Start a separate TUI environment instead of sharing T3 Code",
    "  --local             Use the packaged t3tui's own background server, even if another is saved",
    `  --state-dir <path>  TUI state directory (default: ${defaultStateDir})`,
    `  --cwd <path>        Provider working directory (default: ${context.cwd})`,
    `  --port <port>       Loopback server port (default: ${DEFAULT_TUI_PORT})`,
    "  -h, --help          Show help",
    "  -v, --version       Show version",
    "",
    "Background server (packaged t3tui only):",
    "  t3tui daemon install [--port <port>]  Install and start the local T3 server service",
    "  t3tui daemon start|stop|restart       Control the service",
    "  t3tui daemon status                   Show whether it runs, and where its logs are",
    "  t3tui daemon uninstall                Remove the service and keep your threads",
  ].join("\n");
}

export function buildTuiLaunchOptions(
  options: TuiCliOptions,
  runtime: TuiLaunchRuntime,
): StartAndConnectAuthenticatedTuiEnvironmentOptions {
  const env: NodeJS.ProcessEnv = {
    ...runtime.env,
    T3CODE_MODE: "desktop",
    T3CODE_PORT: String(options.port),
    T3CODE_HOST: TUI_LOOPBACK_HOST,
    T3CODE_HOME: options.stateDir,
    T3CODE_NO_BROWSER: "true",
    T3CODE_TELEMETRY_ENABLED: "false",
    T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
    T3CODE_TAILSCALE_SERVE: "false",
    T3CODE_TAILSCALE_SERVE_PORT: "443",
  };
  delete env.T3CODE_BOOTSTRAP_FD;
  delete env.T3CODE_DEV_AUTH_TOKEN;
  delete env.VITE_DEV_SERVER_URL;

  return {
    start: {
      executable: runtime.executable,
      args: [runtime.serverEntryPath],
      cwd: options.cwd,
      env,
      delivery: "fd3",
      bootstrap: {
        mode: "desktop",
        noBrowser: true,
        port: options.port,
        t3Home: options.stateDir,
        host: TUI_LOOPBACK_HOST,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      },
    },
    httpBaseUrl: `http://${TUI_LOOPBACK_HOST}:${options.port}`,
  };
}
