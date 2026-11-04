#!/usr/bin/env node
// Real-terminal smoke path: a disposable environment in a private tmux server, driven by send-keys.
// HOME and the state directory are temporary, so this never touches ~/.t3 or provider accounts.
// From apps/tui, with Node 26.4+: node scripts/tmux-smoke.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "t3-tui-smoke-"));
const frames = join(scratch, "frames");
const home = join(scratch, "home");
const workspace = join(scratch, "workspace");
for (const directory of [frames, home, workspace]) mkdirSync(directory, { recursive: true });
const socket = `t3-tui-smoke-${process.pid}`;
const tmux = (...args) => execFileSync("tmux", ["-L", socket, ...args], { encoding: "utf8" });

const port = await new Promise((resolvePort) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const { port: free } = server.address();
    server.close(() => resolvePort(free));
  });
});

spawnSync("npx", ["--yes", "tsc", "--noEmit", "false", "--outDir", "dist", "--noCheck"], {
  cwd: root,
  stdio: "inherit",
});

const launch = [
  `HOME=${home}`,
  `XDG_CONFIG_HOME=${join(home, ".config")}`,
  `XDG_STATE_HOME=${join(home, ".state")}`,
  process.execPath,
  "--experimental-ffi",
  join(root, "dist/cli/bin.js"),
  "--new-environment",
  "--state-dir",
  join(scratch, "state"),
  "--cwd",
  workspace,
  "--port",
  String(port),
].join(" ");

const pane = () => tmux("capture-pane", "-p", "-t", "smoke");
const waitFor = async (pattern, label, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = pane();
    if (pattern.test(text)) return text;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}.\n${pane()}`);
};
let index = 0;
const capture = (label) => {
  const text = pane();
  writeFileSync(join(frames, `${String(index++).padStart(2, "0")}-${label}.txt`), text);
  return text;
};
const send = (...keys) => tmux("send-keys", "-t", "smoke", ...keys);

let failed = false;
try {
  tmux("new-session", "-d", "-s", "smoke", "-x", "80", "-y", "24", launch);
  await waitFor(/Connected/, "the connected shell");
  capture("launch-empty");
  send("?");
  await waitFor(/Help|Keys/, "help");
  capture("help");
  send("Escape");
  await waitFor(/PROJECTS/, "help to close");
  send("C-k");
  await waitFor(/Search|Commands|Palette/i, "the palette");
  capture("palette");
  send("Escape");
  await waitFor(/PROJECTS/, "palette to close");
  send("p");
  await waitFor(/Add a project/, "the project form");
  capture("new-project");
  send("Escape");
  await waitFor(/PROJECTS/, "the form to close");
  tmux("resize-window", "-t", "smoke", "-x", "120", "-y", "40");
  await waitFor(/PROJECTS/, "the resized frame");
  capture("resized-120x40");
  send("C-c");
  await waitFor(/Quit|Close/i, "the quit confirmation");
  capture("quit-confirmation");
  send("y");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (spawnSync("tmux", ["-L", socket, "has-session", "-t", "smoke"]).status !== 0) break;
    await sleep(50);
  }
  if (spawnSync("tmux", ["-L", socket, "has-session", "-t", "smoke"]).status === 0)
    throw new Error(`The TUI did not exit.\n${pane()}`);
  process.stdout.write(`tmux smoke passed. Frames: ${frames}\n`);
} catch (error) {
  failed = true;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  spawnSync("tmux", ["-L", socket, "kill-server"]);
  rmSync(join(scratch, "state"), { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
