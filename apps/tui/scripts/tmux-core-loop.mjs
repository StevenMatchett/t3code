#!/usr/bin/env node
// Drives the whole core loop in a real terminal: first launch, add a project, start a thread, send a
// prompt, answer an approval, review, and resize. A real T3 server runs against a synthetic Codex peer
// in a temporary HOME, so no real provider account or ~/.t3 is involved. It only presses keys the
// screen is showing, which makes it a learnability check as well as a smoke test.
// From apps/tui, with Node 26.4+: node scripts/tmux-core-loop.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { preparePeer } from "./provider-peer-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "t3-tui-core-"));
const frames = join(scratch, "frames");
mkdirSync(frames, { recursive: true });
const fixture = join(scratch, "fixture");
mkdirSync(fixture);
const peerEnv = await preparePeer(fixture, process.argv[2] ?? "approval");
// Only the `choices` scenario lists models, and a person has to pick one to start a thread.
const catalogSource = join(scratch, "catalog");
mkdirSync(catalogSource);
await preparePeer(catalogSource, "choices");
const scriptPath = peerEnv.T3_CODEX_COLLAB_SCRIPT;
writeFileSync(
  scriptPath,
  JSON.stringify({
    ...JSON.parse(readFileSync(scriptPath, "utf8")),
    models: JSON.parse(readFileSync(join(catalogSource, "peer/script.json"), "utf8")).models,
  }),
);
// --new-environment keeps its state below `standalone`, so the provider settings go there.
mkdirSync(join(fixture, "state/standalone/userdata"), { recursive: true });
copyFileSync(
  join(fixture, "state/userdata/settings.json"),
  join(fixture, "state/standalone/userdata/settings.json"),
);
const socket = `t3-tui-core-${process.pid}`;
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

const env = {
  HOME: fixture,
  XDG_CONFIG_HOME: join(fixture, "config"),
  XDG_DATA_HOME: join(fixture, "data"),
  XDG_CACHE_HOME: join(fixture, "cache"),
  XDG_STATE_HOME: join(fixture, "xdg-state"),
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
  SHELL: "/bin/sh",
  ...peerEnv,
};
const launch = [
  "env",
  ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
  process.execPath,
  "--experimental-ffi",
  join(root, "dist/cli/bin.js"),
  "--new-environment",
  "--state-dir",
  join(fixture, "state"),
  "--cwd",
  join(fixture, "workspace"),
  "--port",
  String(port),
].join(" ");

const pane = () => tmux("capture-pane", "-p", "-t", "core");
const send = (...keys) => tmux("send-keys", "-t", "core", ...keys);
const type = (text) => tmux("send-keys", "-t", "core", "-l", text);
const waitFor = async (pattern, label, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = pane();
    if (pattern.test(text)) return text;
    await sleep(1);
  }
  throw new Error(`Timed out waiting for ${label}.\n${pane()}`);
};
let index = 0;
const capture = (label) =>
  writeFileSync(join(frames, `${String(index++).padStart(2, "0")}-${label}.txt`), pane());

// Time from sending a key to that change being on screen, in a real terminal.
const latencies = new Map();
const timed = async (name, press, pattern) => {
  const started = performance.now();
  press();
  await waitFor(pattern, name, 15_000);
  latencies.set(name, [...(latencies.get(name) ?? []), performance.now() - started]);
};
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor((values.length * p) / 100))
  ];

// One capture round trip, which every latency below includes at least once.
const captureCost = () => {
  const samples = Array.from({ length: 30 }, () => {
    const started = performance.now();
    pane();
    return performance.now() - started;
  });
  return percentile(samples, 50);
};

let failed = false;
try {
  tmux("new-session", "-d", "-s", "core", "-x", "80", "-y", "24", launch);
  await waitFor(
    /No projects in this environment/,
    "the empty state naming the next action",
    60_000,
  );
  capture("first-launch");
  const overhead = captureCost();

  // The empty state says to press P.
  await timed("open form", () => send("p"), /Add a project/);
  await waitFor(/Folder/, "the folder field");
  capture("new-project");
  await waitFor(/Enter adds this folder/, "the folder to load");
  send("BSpace", "BSpace");
  type(join(fixture, "workspace"));
  await waitFor(/Folder\s+\/\S*workspace/, "the typed path");
  capture("folder-typed");
  send("Enter");
  await sleep(300);
  capture("folder-opened");
  send("Enter");
  await waitFor(/Threads \(0\)/, "the new project");
  capture("project-added");

  // The empty project says to press N.
  await waitFor(/N starts one/, "the empty project naming the next action");
  await timed("open form", () => send("n"), /New thread in/);
  capture("new-thread");
  await waitFor(/Model\s+(?!No provider)\S+/, "a provider model", 45_000);
  capture("new-thread-model-ready");
  type("Core loop");
  await waitFor(/Title\s+Core loop/, "the title");
  // Enter in the title creates the thread. The other fields have defaults.
  send("Enter");
  await waitFor(/No messages in this thread/, "the new thread");
  capture("thread-opened");

  // The empty thread says to press Enter.
  await timed("focus composer", () => send("Enter"), /MESSAGE/);
  const text = "Please review the change";
  for (let column = 0; column < text.length; column += 1) {
    const prefix = text.slice(0, column + 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await timed("type character", () => type(text[column]), new RegExp(prefix));
  }
  capture("composed");
  send("Enter");
  await waitFor(/Approval needed|Approve/, "the approval", 30_000);
  capture("approval");
  await timed("move approval choice", () => send("Down"), /> Decline/);
  await timed("move approval choice", () => send("Down"), /> Always allow this session/);
  capture("approval-choice");
  await timed("move approval choice", () => send("Down"), /> Always allow\s/);
  await timed("move approval choice", () => send("Down"), /> Approve\s/);
  send("Enter");
  await waitFor(/Response accepted|Done|Working|Ready/, "the response");
  capture("approved");

  // Esc followed instantly by a key reads as Alt+key in any terminal, so wait for each level.
  send("Escape");
  await waitFor(/CONVERSATION/, "the transcript");
  capture("transcript");
  await timed("open diff", () => send("d"), /Thread changes/);
  capture("diff");
  await timed("close overlay", () => send("Escape"), /CONVERSATION|MESSAGE/);
  await timed("open palette", () => send("C-k"), /Search and commands/);
  capture("palette");
  await timed("close overlay", () => send("Escape"), /CONVERSATION|MESSAGE/);
  await timed("open help", () => send("F1"), /Keyboard help/);
  capture("help");
  // A long list scrolling by key is the same render path as a long transcript.
  await timed("scroll by page", () => send("PageDown"), /\s(?!1-)\d+-\d+ of \d+/);
  capture("help-scrolled");
  await timed("close overlay", () => send("Escape"), /CONVERSATION|MESSAGE/);
  // Enough samples of the slowest opens to judge them, from the thread list where both keys apply.
  send("Escape");
  await waitFor(/THREADS/, "the thread list");
  for (let sample = 0; sample < 12; sample += 1) {
    await timed("open new thread form", () => send("n"), /New thread in/);
    await sleep(30);
    send("Escape");
    await waitFor(/THREADS/, "the form to close");
    await sleep(30);
    await timed("open new project form", () => send("p"), /Add a project/);
    await sleep(30);
    send("Escape");
    await waitFor(/THREADS/, "the form to close");
    await sleep(30);
  }
  send("Enter");
  await waitFor(/CONVERSATION/, "the conversation");
  // An idle client must not repaint: output and CPU both stay flat while nothing changes.
  const cpuTicks = () => {
    const pid = tmux("list-panes", "-t", "core", "-F", "#{pane_pid}").trim();
    const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
    return Number(fields[11]) + Number(fields[12]);
  };
  const idleStart = cpuTicks();
  await sleep(5_000);
  process.stdout.write(`idle CPU over 5s: ${(cpuTicks() - idleStart) * 10}ms\n`);
  tmux("resize-window", "-t", "core", "-x", "120", "-y", "40");
  await waitFor(/Threads \(1\)/, "the sidebar at 120 columns");
  capture("resized");
  send("C-c");
  await waitFor(/Close T3 TUI\?/, "the quit confirmation");
  send("y");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (spawnSync("tmux", ["-L", socket, "has-session", "-t", "core"]).status !== 0) break;
    await sleep(50);
  }
  process.stdout.write(`tmux core loop passed. Frames: ${frames}\n`);
  process.stdout.write(`capture round trip: ${overhead.toFixed(1)}ms\n`);
  for (const [name, values] of latencies)
    process.stdout.write(
      `${name}: p50 ${percentile(values, 50).toFixed(1)}ms p95 ${percentile(values, 95).toFixed(1)}ms (n=${values.length})\n`,
    );
} catch (error) {
  failed = true;
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\nFrames: ${frames}\n`,
  );
} finally {
  spawnSync("tmux", ["-L", socket, "kill-server"]);
  rmSync(fixture, { recursive: true, force: true });
  rmSync(catalogSource, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
