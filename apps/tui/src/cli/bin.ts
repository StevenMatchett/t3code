#!/usr/bin/env node
/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off

import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import packageJson from "../../package.json" with { type: "json" };
import serverPackageJson from "../../../server/package.json" with { type: "json" };
import openTuiPackageJson from "../../node_modules/@opentui/core/package.json" with { type: "json" };
import { makeTuiDaemon, runTuiDaemonCommand } from "../daemon/daemon.ts";
import {
  formatTuiCliError,
  formatTuiCliHelp,
  parseTuiCliArgs,
  TuiCliUsageError,
} from "./options.ts";

declare const __TUI_UPSTREAM_BASE__: string;
declare const __TUI_SERVER_ENTRY__: string;

const context = {
  cwd: NodeProcess.env.INIT_CWD?.trim() || NodeProcess.cwd(),
  homeDir: NodeOS.homedir(),
};

const packagedServerEntry =
  typeof __TUI_SERVER_ENTRY__ === "string"
    ? NodeURL.fileURLToPath(new URL(__TUI_SERVER_ENTRY__, import.meta.url))
    : undefined;

/** Only the packaged build can run a daemon: it needs a self-contained copy of the server. */
function makePackagedDaemon(serverEntry: string) {
  return makeTuiDaemon({
    homeDir: context.homeDir,
    env: NodeProcess.env,
    platform: NodeProcess.platform,
    artifactRoot: NodePath.dirname(NodePath.dirname(serverEntry)),
    packageVersion: packageJson.version,
    execPath: NodeProcess.execPath,
  });
}

export async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseTuiCliArgs(NodeProcess.argv.slice(2), context);
  } catch (error) {
    if (!(error instanceof TuiCliUsageError)) throw error;
    NodeProcess.stderr.write(`${error.message}\n\n${formatTuiCliHelp(context)}\n`);
    return 2;
  }

  if (parsed.action === "help") {
    NodeProcess.stdout.write(`${formatTuiCliHelp(context)}\n`);
    return 0;
  }
  if (parsed.action === "version") {
    const base = typeof __TUI_UPSTREAM_BASE__ === "string" ? __TUI_UPSTREAM_BASE__ : "development";
    NodeProcess.stdout.write(
      `t3-tui ${packageJson.version}\nt3-server ${serverPackageJson.version} (${base})\nopentui ${openTuiPackageJson.version}\n`,
    );
    return 0;
  }

  if (parsed.action === "daemon") {
    if (packagedServerEntry === undefined) {
      NodeProcess.stderr.write(
        "Daemon commands are available in the packaged t3tui (npx t3tui).\n",
      );
      return 2;
    }
    try {
      return await runTuiDaemonCommand(makePackagedDaemon(packagedServerEntry), parsed.command, {
        ...(parsed.port === undefined ? {} : { port: parsed.port }),
        write: (text) => NodeProcess.stdout.write(text),
      });
    } catch (error) {
      NodeProcess.stderr.write(`${formatTuiCliError(error)}\n`);
      return 1;
    }
  }

  // React reads NODE_ENV when it is first imported. Its development build records a
  // performance.measure() entry per component render, and Node buffers those forever,
  // so a long-running session grows without bound. Set NODE_ENV=development to opt in.
  NodeProcess.env.NODE_ENV ??= "production";
  try {
    const { runTuiPrototype } = await import("./program.ts");
    return await runTuiPrototype({
      cli: parsed.options,
      serverEntryPath:
        packagedServerEntry ??
        NodeURL.fileURLToPath(new URL("../../../server/src/bin.ts", import.meta.url)),
      ...(packagedServerEntry === undefined
        ? {}
        : { localDaemon: makePackagedDaemon(packagedServerEntry) }),
    });
  } catch (error) {
    NodeProcess.stderr.write(`${formatTuiCliError(error)}\n`);
    return error instanceof TuiCliUsageError ? 2 : 1;
  }
}

if (NodeURL.pathToFileURL(NodeProcess.argv[1] ?? "").href === import.meta.url) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      NodeProcess.stderr.write(`${formatTuiCliError(error)}\n`);
      process.exitCode = 1;
    },
  );
}
