import * as NodeChildProcess from "node:child_process";
import * as NodeProcess from "node:process";

import { inspectTuiNodeVersion } from "./runtime-compatibility.mjs";

const [target, ...args] = NodeProcess.argv.slice(2);

if (!target) {
  NodeProcess.stderr.write("Usage: run-with-node-ffi.mjs <script> [...args]\n");
  NodeProcess.default.exitCode = 1;
} else {
  const nodeResult = inspectTuiNodeVersion(NodeProcess.versions.node);
  if (!nodeResult.supported) {
    NodeProcess.stderr.write(`${nodeResult.message}\n`);
    NodeProcess.default.exitCode = 1;
  } else {
    const existingNodeOptions = NodeProcess.env.NODE_OPTIONS?.trim();
    const nodeOptions = [existingNodeOptions, "--experimental-ffi"].filter(Boolean).join(" ");
    const child = NodeChildProcess.spawnSync(NodeProcess.execPath, [target, ...args], {
      env: { ...NodeProcess.env, NODE_OPTIONS: nodeOptions },
      stdio: "inherit",
    });

    if (child.error) throw child.error;
    NodeProcess.default.exitCode = child.status ?? 1;
  }
}
