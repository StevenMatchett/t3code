#!/usr/bin/env node
/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off

import * as NodeOS from "node:os";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import packageJson from "../../package.json" with { type: "json" };
import serverPackageJson from "../../../server/package.json" with { type: "json" };
import openTuiPackageJson from "../../node_modules/@opentui/core/package.json" with { type: "json" };
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

  try {
    const { runTuiPrototype } = await import("./program.ts");
    const serverEntry =
      typeof __TUI_SERVER_ENTRY__ === "string"
        ? __TUI_SERVER_ENTRY__
        : "../../../server/src/bin.ts";
    return await runTuiPrototype({
      cli: parsed.options,
      serverEntryPath: NodeURL.fileURLToPath(new URL(serverEntry, import.meta.url)),
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
