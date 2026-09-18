import * as NodeAssert from "node:assert/strict";
import * as NodeModule from "node:module";
import * as NodeProcess from "node:process";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

import { assertCurrentTuiRuntime } from "./runtime-compatibility.mjs";

assertCurrentTuiRuntime();
const requireServer = NodeModule.createRequire(
  new URL("../../server/package.json", import.meta.url),
);
const pty = requireServer("node-pty");
const childPath = NodeURL.fileURLToPath(new URL("./renderer-pty-child.mjs", import.meta.url));

async function scenario(action, expectedCode) {
  const child = pty.spawn(process.execPath, ["--experimental-ffi", childPath], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    env: { PATH: process.env.PATH, TERM: "xterm-256color", LANG: "en_US.UTF-8" },
  });
  let output = "";
  let acted = false;
  let exited = false;
  let timer;
  const done = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `PTY scenario ${action} did not exit. Tail: ${JSON.stringify(output.slice(-1000))}`,
        ),
      );
    }, 15_000);
    child.onData((chunk) => {
      output += chunk;
      if (!acted && output.includes("__TUI_READY__")) {
        acted = true;
        if (action.startsWith("SIG")) child.kill(action);
        else child.write(action);
      }
    });
    child.onExit((event) => {
      exited = true;
      resolve(event);
    });
  });
  try {
    const exit = await done;
    NodeAssert.equal(acted, true, "renderer reached ready state");
    NodeAssert.equal(exit.exitCode, expectedCode, JSON.stringify(output.slice(-1000)));
    const match = /__TUI_RESULT__(\{[^\r\n]+\})/.exec(output);
    NodeAssert.ok(match, `missing restoration receipt: ${JSON.stringify(output.slice(-1000))}`);
    const result = JSON.parse(match[1]);
    NodeAssert.deepEqual(result, {
      termiosRestored: true,
      raw: false,
      rendererDestroyed: true,
      errors: expectedCode === 1 ? 1 : 0,
      exitCode: expectedCode,
    });
    const beforeReceipt = output.slice(0, match.index);
    const modes = new Map();
    for (const chunk of beforeReceipt.split("\x1b")) {
      const sequence = /^\[\?([\d;]+)([hl])/.exec(chunk);
      if (sequence) {
        for (const mode of sequence[1].split(";")) modes.set(Number(mode), sequence[2] === "h");
      }
    }
    NodeAssert.equal(modes.get(1049), false, "alternate screen released");
    NodeAssert.equal(modes.get(25), true, "cursor visible");
    for (const mode of [1000, 1002, 1003, 1006, 1016, 2004]) {
      NodeAssert.notEqual(modes.get(mode), true, `terminal mode ${mode} released`);
    }
  } finally {
    clearTimeout(timer);
    if (!exited) child.kill("SIGKILL");
  }
}

for (const [action, code] of [
  ["q", 0],
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
  ["f", 1],
  ["n", 1],
  ["e", 1],
  ["r", 1],
]) {
  NodeTest.test(
    `restores the host PTY after ${action}`,
    { skip: NodeProcess.platform === "win32" },
    async () => {
      await scenario(action, code);
    },
  );
}
