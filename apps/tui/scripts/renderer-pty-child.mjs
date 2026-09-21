import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import { useAtomValue } from "@effect/atom-react";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { useKeyboard } from "@opentui/react";
import { createElement, useEffect, useState } from "react";

import { runTuiLifecycle } from "../dist/cli/lifecycle.js";
import { TuiShutdownController } from "../dist/cli/shutdown.js";
import { startRendererRuntime } from "../dist/renderer/runtime.js";
import { PromptEditor } from "../dist/renderer/PromptEditor.js";

const termios = () =>
  NodeChildProcess.execFileSync("stty", ["-g"], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  }).trim();
const before = termios();
const registry = AtomRegistry.make();
const broken = Atom.make(false);
const shutdown = new TuiShutdownController();
const childExit = Promise.withResolvers();
const errors = [];
const testKeyboard = process.argv[2] === "SHIFT_ENTER";
const submissions = [];
let runtime;

function Probe() {
  const failed = useAtomValue(broken);
  const [draft, setDraft] = useState("");
  useKeyboard((key) => {
    if (key.ctrl && key.name.toLowerCase() === "c") {
      key.preventDefault();
      key.stopPropagation();
      NodeFS.writeSync(1, "\n__TUI_CTRL_C__\n");
    }
  });
  useEffect(() => {
    NodeFS.writeSync(1, "\n__TUI_READY__\n");
  }, []);
  if (failed) throw new Error("injected React failure");
  if (testKeyboard) {
    return createElement(PromptEditor, {
      focused: true,
      value: draft,
      onChange: setDraft,
      onSubmit: (text) => {
        submissions.push(text);
        childExit.resolve({ exitCode: 0, signal: null });
      },
    });
  }
  return createElement("textarea", { focused: true, initialValue: "PTY restoration fixture" });
}

function input(data) {
  switch (data.toString()) {
    case "q":
      childExit.resolve({ exitCode: 0, signal: null });
      break;
    case "f":
      registry.set(broken, true);
      break;
    case "n":
      runtime.renderer.root.render = () => {
        throw new Error("injected native failure");
      };
      runtime.renderer.requestRender();
      break;
    case "e":
      queueMicrotask(() => {
        throw new Error("injected uncaught exception");
      });
      break;
    case "r":
      void Promise.reject(new Error("injected rejection"));
      break;
  }
}

shutdown.attachToProcess(process);
process.stdin.on("data", input);
const exitCode = await runTuiLifecycle({
  shutdown,
  start: async () => ({}),
  render: async ({ onFatal }) => {
    runtime = await startRendererRuntime({
      registry,
      children: createElement(Probe),
      onError: onFatal,
    });
    return runtime;
  },
  waitForChildExit: () => childExit.promise,
  drainChildOutput: () => {},
  closeRuntime: (value) => value.close(),
  clearBearer: () => {},
  terminateChild: () => {},
  reportError: (error) => errors.push(error),
});
shutdown.disposeProcessListeners();
process.stdin.off("data", input);
const result = {
  termiosRestored: before === termios(),
  raw: process.stdin.isRaw,
  rendererDestroyed: runtime.renderer.isDestroyed,
  errors: errors.length,
  exitCode,
  ...(testKeyboard ? { submissions } : {}),
};
NodeFS.writeSync(1, `\n__TUI_RESULT__${JSON.stringify(result)}\n`);
process.exitCode = exitCode;
