#!/usr/bin/env node
import * as NodeChildProcess from "node:child_process";
import * as NodeProcess from "node:process";
import { inspectTuiNodeVersion } from "./runtime-compatibility.mjs";

const compatibility = inspectTuiNodeVersion(NodeProcess.versions.node);
if (!compatibility.supported) {
  NodeProcess.stderr.write(`${compatibility.message}\n`);
  process.exitCode = 1;
} else if (!NodeProcess.getBuiltinModule("node:ffi")) {
  const args = ["--experimental-ffi", ...NodeProcess.argv.slice(1)];
  if (NodeProcess.platform !== "win32" && NodeProcess.execve) {
    NodeProcess.execve(
      NodeProcess.execPath,
      [NodeProcess.execPath, ...args],
      Object.fromEntries(
        Object.entries(NodeProcess.env).filter(([, value]) => value !== undefined),
      ),
    );
  } else {
    const child = NodeChildProcess.spawn(NodeProcess.execPath, args, { stdio: "inherit" });
    const handlers = new Map(
      ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => [signal, () => child.kill(signal)]),
    );
    const cleanup = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };
    for (const [signal, handler] of handlers) process.on(signal, handler);
    child.once("error", () => {
      cleanup();
      NodeProcess.stderr.write("Could not start the TUI runtime.\n");
      process.exitCode = 1;
    });
    child.once("exit", (code) => {
      cleanup();
      process.exitCode = code ?? 1;
    });
  }
} else {
  try {
    const { main } = await import("./tui.mjs");
    process.exitCode = await main();
  } catch (error) {
    NodeProcess.stderr.write(`${error instanceof Error ? error.message : "TUI startup failed"}\n`);
    process.exitCode = 1;
  }
}
