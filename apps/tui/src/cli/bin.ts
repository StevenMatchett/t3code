#!/usr/bin/env node
/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off

import * as NodeOS from "node:os";
import NodeProcess from "node:process";
import * as NodeURL from "node:url";

import packageJson from "../../package.json" with { type: "json" };
import { formatTuiCliHelp, parseTuiCliArgs, TuiCliUsageError } from "./options.ts";

const context = {
  cwd: NodeProcess.env.INIT_CWD?.trim() || NodeProcess.cwd(),
  homeDir: NodeOS.homedir(),
};

async function main(): Promise<number> {
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
    NodeProcess.stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  const [{ runTuiPrototype }, { fileURLToPath }] = await Promise.all([
    import("./program.ts"),
    import("node:url"),
  ]);
  return runTuiPrototype({
    cli: parsed.options,
    serverEntryPath: fileURLToPath(new URL("../../../server/src/bin.ts", import.meta.url)),
  });
}

if (NodeURL.pathToFileURL(NodeProcess.argv[1] ?? "").href === import.meta.url) {
  main().then(
    (exitCode) => {
      NodeProcess.exitCode = exitCode;
    },
    (error: unknown) => {
      NodeProcess.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      NodeProcess.exitCode = 1;
    },
  );
}
