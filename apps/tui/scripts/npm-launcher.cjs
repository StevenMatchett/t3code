#!/usr/bin/env node
// `bin/t3tui.js` of the `t3tui` npm package, plain CommonJS so it loads on any Node npm runs on.
// Runs the TUI from the `@t3tui/<platform>-<arch>` optional dependency, borrowing Node 26 from npm
// when the current Node is too old. Run through npx, it offers once to install `t3tui` globally.
"use strict";
const { spawnSync } = require("node:child_process");
const {
  accessSync,
  constants: fsConstants,
  existsSync,
  mkdirSync,
  readSync,
  writeFileSync,
} = require("node:fs");
const { constants, homedir } = require("node:os");
const { delimiter, dirname, join, sep } = require("node:path");
const { arch, platform } = require("node:process");
const { isatty } = require("node:tty");

const SUPPORTED = __SUPPORTED_PLATFORMS__;
const key = platform + "-" + arch;

let packageDir;
try {
  packageDir = dirname(require.resolve("@t3tui/" + key + "/package.json"));
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

function commandOnPath() {
  const names = platform === "win32" ? ["t3tui.cmd", "t3tui.exe"] : ["t3tui"];
  // npx puts its own copy's .bin first on PATH; that one disappears with the cache.
  const dirs = (process.env.PATH || "")
    .split(delimiter)
    .filter((dir) => dir && !dir.split(sep).includes("_npx"));
  return dirs.some((dir) =>
    names.some((name) => {
      try {
        accessSync(join(dir, name), fsConstants.X_OK);
        return true;
      } catch {
        return false;
      }
    }),
  );
}

function readAnswer() {
  const byte = Buffer.alloc(1);
  let line = "";
  for (;;) {
    let read;
    try {
      read = readSync(0, byte, 0, 1, null);
    } catch (error) {
      // A terminal's stdin can be non-blocking; wait briefly instead of spinning.
      if (error.code !== "EAGAIN") return null;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      continue;
    }
    if (read === 0) return line;
    const char = byte.toString();
    if (char === "\n") return line;
    if (char !== "\r") line += char;
  }
}

function offerGlobalInstall() {
  const answerFile = join(homedir(), ".t3-tui", "install-prompt");
  if (existsSync(answerFile) || commandOnPath()) return;

  const version = require(join(__dirname, "..", "package.json")).version;
  process.stdout.write("Install the t3tui command (npm install -g t3tui@" + version + ")? [Y/n] ");
  const answer = readAnswer();
  if (answer === null) return;
  const accepted = /^(y|yes)?$/i.test(answer.trim());
  let outcome = "declined";
  if (accepted) {
    const npm = platform === "win32" ? "npm.cmd" : "npm";
    const env = { ...process.env };
    delete env.npm_config_package;
    const install = spawnSync(npm, ["install", "--global", "t3tui@" + version], {
      stdio: "inherit",
      env,
      shell: platform === "win32",
    });
    outcome = install.status === 0 ? "installed" : "failed";
    process.stdout.write(
      install.status !== 0
        ? "Could not install it. Run `npm install -g t3tui` yourself; if npm reports EACCES, see " +
            "https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally\n"
        : commandOnPath()
          ? "Installed. Next time, just run `t3tui`.\n"
          : "Installed, but npm's global bin directory is not on your PATH. Add the bin directory " +
            "under `npm prefix -g` to PATH.\n",
    );
  } else {
    process.stdout.write("OK. Run `npm install -g t3tui` any time to install it.\n");
  }
  try {
    mkdirSync(dirname(answerFile), { recursive: true });
    writeFileSync(answerFile, outcome + "\n");
  } catch {}
}

// Only a plain interactive launch from npx's cache asks; commands and scripts never block.
if (process.argv.length === 2 && isatty(0) && isatty(1) && __dirname.split(sep).includes("_npx")) {
  offerGlobalInstall();
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
