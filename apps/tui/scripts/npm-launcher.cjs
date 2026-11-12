#!/usr/bin/env node
// `bin/t3tui.js` of the `t3tui` npm package. Plain CommonJS so it loads on any
// Node npm runs on. It runs the TUI from the `t3tui-<platform>-<arch>` package
// npm installed as an optional dependency, borrowing Node 26 from npm when the
// current Node is too old for the TUI renderer.
"use strict";
const { spawnSync } = require("node:child_process");
const { constants } = require("node:os");
const { dirname, join } = require("node:path");
const { arch, platform } = require("node:process");

const SUPPORTED = __SUPPORTED_PLATFORMS__;
const key = platform + "-" + arch;

let packageDir;
try {
  packageDir = dirname(require.resolve("t3tui-" + key + "/package.json"));
} catch {
  process.stderr.write(
    [
      "t3tui: no build is available for this platform (" + key + ").",
      "Supported platforms: " + SUPPORTED.join(", ") + ".",
      "If yours is listed, reinstall t3tui so npm fetches its optional dependency.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (platform === "linux" && !process.report.getReport().header.glibcVersionRuntime) {
  process.stderr.write(
    "t3tui: Linux builds need glibc; musl distributions are not supported yet.\n",
  );
  process.exit(1);
}

const entry = join(packageDir, "t3-tui.mjs");
const [major, minor] = process.versions.node.split(".").map(Number);
const recentNode = major > 26 || (major === 26 && minor >= 4);
let command = process.execPath;
let args = [entry, ...process.argv.slice(2)];
if (!recentNode) {
  process.stderr.write(
    "t3tui: Node " +
      process.versions.node +
      " is older than 26.4; running with Node 26 from npm.\n",
  );
  command = platform === "win32" ? "npx.cmd" : "npx";
  args = ["--yes", "node@^26.4.0", ...args];
}

// Windows runs npx.cmd through a shell, which splits unquoted paths at spaces.
const shell = command.endsWith(".cmd");
const result = spawnSync(command, shell ? args.map((arg) => '"' + arg + '"') : args, {
  stdio: "inherit",
  shell,
});
if (result.error) {
  process.stderr.write("t3tui: failed to start " + command + ": " + result.error.message + "\n");
  process.exit(1);
}
// A child killed by a signal has no status; report it the way a shell would.
process.exit(result.status ?? 128 + (constants.signals[result.signal] || 1));
