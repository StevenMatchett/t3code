/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off

import * as NodePath from "node:path";

import type { StartAndConnectAuthenticatedTuiEnvironmentOptions } from "../connection/authenticatedEnvironment.ts";

export const DEFAULT_TUI_PORT = 3_773;
export const DEFAULT_TUI_STATE_DIRECTORY_NAME = ".t3-tui";
export const TUI_LOOPBACK_HOST = "127.0.0.1";

export interface TuiCliOptions {
  readonly stateDir: string;
  readonly cwd: string;
  readonly port: number;
}

export type TuiCliParseResult =
  | { readonly action: "run"; readonly options: TuiCliOptions }
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

export function parseTuiCliArgs(
  argv: ReadonlyArray<string>,
  context: TuiCliParseContext,
): TuiCliParseResult {
  let stateDir: string | undefined;
  let cwd: string | undefined;
  let port: number | undefined;
  const seen = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--") continue;
    const [name, inlineValue] = splitFlag(argument);

    if (name === "--help" || name === "-h") return { action: "help" };
    if (name === "--version" || name === "-v") return { action: "version" };
    if (name !== "--state-dir" && name !== "--cwd" && name !== "--port") {
      throw new TuiCliUsageError(`Unknown argument: ${argument}`);
    }
    if (seen.has(name)) throw new TuiCliUsageError(`${name} may only be supplied once`);
    seen.add(name);

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
    }
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
    },
  };
}

export function formatTuiCliHelp(context: TuiCliParseContext): string {
  const defaultStateDir = NodePath.resolve(context.homeDir, DEFAULT_TUI_STATE_DIRECTORY_NAME);
  return [
    "Usage: t3-tui [options]",
    "",
    "Run the local T3 Code TUI prototype.",
    "",
    "Options:",
    `  --state-dir <path>  TUI state directory (default: ${defaultStateDir})`,
    `  --cwd <path>        Provider working directory (default: ${context.cwd})`,
    `  --port <port>       Loopback server port (default: ${DEFAULT_TUI_PORT})`,
    "  -h, --help          Show help",
    "  -v, --version       Show version",
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
