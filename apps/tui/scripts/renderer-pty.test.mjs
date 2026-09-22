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
  const child = pty.spawn(process.execPath, ["--experimental-ffi", childPath, action], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    env: { PATH: process.env.PATH, TERM: "xterm-256color", LANG: "en_US.UTF-8" },
  });
  let output = "";
  let acted = false;
  let followedUp = false;
  let keyboardDetected = false;
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
      if (action === "SHIFT_ENTER" && !keyboardDetected && output.includes("\x1b[?u")) {
        keyboardDetected = true;
        child.write("\x1b[?0u");
      }
      // oxlint-disable-next-line no-control-regex -- Match terminal keyboard negotiation sequences.
      const requests = [...output.matchAll(/\x1b\[[>=](\d+)(?:;\d+)?u/g)];
      if (
        !acted &&
        output.includes("__TUI_READY__") &&
        (action !== "SHIFT_ENTER" || requests.length > 0)
      ) {
        acted = true;
        if (action.startsWith("SIG")) child.kill(action);
        else if (["CTRL_C", "CONFIRM_EXIT", "CLICK_EXIT"].includes(action)) child.write("\x03");
        else if (action === "SHIFT_ENTER") {
          // Emulate Enter's legacy encoding unless the app requests all keys.
          const flags = Number(requests.at(-1)?.[1] ?? 0);
          const shiftEnter = flags & 8 ? "\x1b[13;2u" : "\r";
          child.write(
            `\x1b[102u\x1b[105u\x1b[114u\x1b[115u\x1b[116u\x1b[101;1;233u${shiftEnter}second\x1b[13u`,
          );
        } else child.write(action);
      }
      if (action === "CTRL_C" && !followedUp && output.includes("__TUI_CTRL_C__")) {
        followedUp = true;
        child.write("q");
      }
      if (
        ["CONFIRM_EXIT", "CLICK_EXIT"].includes(action) &&
        !followedUp &&
        output.includes("Close T3 TUI?")
      ) {
        followedUp = true;
        child.write(action === "CLICK_EXIT" ? "\x1b[<0;50;14M\x1b[<0;50;14m" : "y");
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
    if (action === "CTRL_C") {
      NodeAssert.equal(followedUp, true, "Ctrl+C reached the React keyboard handler");
    }
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
      ...(action === "SHIFT_ENTER" ? { submissions: ["firsté\nsecond"] } : {}),
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
  ["CONFIRM_EXIT", 130],
  ["CLICK_EXIT", 130],
  ["SHIFT_ENTER", 0],
  ["q", 0],
  ["CTRL_C", 0],
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
