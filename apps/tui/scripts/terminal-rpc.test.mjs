import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { it, vi } from "@effect/vitest";
import { useAtomValue } from "@effect/atom-react";
import { EmbeddedTerminalRenderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { WS_METHODS } from "@t3tools/contracts";
import { terminalOutputText } from "@t3tools/client-runtime/state/terminal";
import { Effect, SubscriptionRef } from "effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act, createElement, createRef, useLayoutEffect, useState } from "react";

import { EmbeddedTerminalSurface } from "../dist/renderer/embedded-terminal/EmbeddedTerminalSurface.js";
import { createTuiTestDriver } from "../dist/testing/driver.js";
import {
  attachTerminalFixture,
  makeTerminalEnvironmentFixture,
  makeTerminalFixtureCallbacks,
  openTerminalFixtureConnection,
} from "./terminal-fixture.mjs";

const rawProbe = String.raw`
process.stdin.setRawMode(true);
process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?2004h\x1b[?1000h\x1b[?1006h__RAW_READY__\r\n');
process.stdout.on('resize', () => process.stdout.write('SIZE:' + process.stdout.columns + 'x' + process.stdout.rows + '\r\n'));
process.stdin.on('data', data => {
  process.stdout.write('HEX[' + data.toString('hex') + ']\r\n');
  if (data.includes(3)) {
    process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[?1049l__PROBE_EXIT__\r\n');
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
});
`;

if (NodeProcess.platform === "win32") {
  it.skip("terminal RPC shell matrix needs the Windows fixture", () => {});
} else {
  it.live(
    "drives and reconnects one server PTY through the embedded emulator",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeTerminalEnvironmentFixture();
        const target = { threadId: "phase-zero-terminal", terminalId: "term-1" };
        const launch = { ...target, cwd: fixture.root, cols: 80, rows: 24 };
        const control = yield* openTerminalFixtureConnection(fixture);
        let view = yield* openTerminalFixtureConnection(fixture);
        let attached = yield* attachTerminalFixture(view, launch);
        const initial = yield* attached.waitFor((state) => state.status === "running");
        const originalPid = (yield* SubscriptionRef.get(attached.snapshot)).pid;
        const registry = AtomRegistry.make();
        const outputAtom = Atom.make(initial.output);
        const callbacks = makeTerminalFixtureCallbacks(() => view.client, target);
        const handle = createRef();
        const released = vi.fn();
        const copied = [];
        const focus = createRef();
        function Probe() {
          const output = useAtomValue(outputAtom);
          const [focused, setFocused] = useState(true);
          useLayoutEffect(() => {
            focus.current = () => setFocused(true);
          }, []);
          return createElement(EmbeddedTerminalSurface, {
            ...callbacks,
            ref: handle,
            output,
            focused,
            onReleaseFocus: () => {
              released();
              setFocused(false);
            },
            onCopy: (text) => {
              copied.push(text);
            },
          });
        }
        const driver = yield* Effect.acquireRelease(
          Effect.promise(() =>
            createTuiTestDriver(createElement(Probe), { registry, width: 80, height: 24 }),
          ),
          (driver) => Effect.promise(() => driver.close()),
        );
        const emulator = () => {
          const terminal = driver.renderer.root.findDescendantById("t3-embedded-terminal");
          NodeAssert.ok(terminal instanceof EmbeddedTerminalRenderable);
          return terminal;
        };
        const show = (state) =>
          Effect.promise(async () => {
            await act(async () => registry.set(outputAtom, state.output));
            await driver.flush();
          });
        const received = (text) =>
          attached
            .waitFor((state) => terminalOutputText(state.output).includes(text))
            .pipe(
              Effect.catchTag("TimeoutError", () =>
                Effect.gen(function* () {
                  const state = yield* SubscriptionRef.get(attached.state);
                  return yield* Effect.die(
                    new Error(
                      `Missing terminal marker ${JSON.stringify(text)}. Writes: ${JSON.stringify(callbacks.writes.slice(-10))}. Output tail: ${JSON.stringify(terminalOutputText(state.output).slice(-1_500))}`,
                    ),
                  );
                }),
              ),
            );
        const send = (data) => control.client[WS_METHODS.terminalWrite]({ ...target, data });
        yield* Effect.promise(() => callbacks.drainResize());
        yield* send("stty -echo; printf '\\033[2J\\033[H__%s__\\n' 'SHELL_READY'\n");
        yield* show(yield* received("__SHELL_READY__"));
        NodeAssert.ok(emulator().screen().text.includes("__SHELL_READY__"));
        yield* Effect.promise(() => driver.mouse.drag(0, 0, 14, 0));
        NodeAssert.equal(handle.current.copySelection(), true);
        NodeAssert.deepEqual(copied, ["__SHELL_READY__"]);

        yield* Effect.promise(async () => {
          handle.current.paste("printf '\\033[31m%s\\033[0m\\n' '漢字 café'");
          await driver.input.pressKey("RETURN");
          await handle.current.drainInput();
        });
        yield* show(yield* received("漢字 café"));
        NodeAssert.ok(emulator().screen().text.includes("漢字 café"));

        const probePath = NodePath.join(fixture.root, "input-probe.cjs");
        yield* Effect.promise(() => NodeFSP.writeFile(probePath, rawProbe));
        yield* send(`node '${probePath.replaceAll("'", "'\\''")}'\n`);
        yield* show(yield* received("__RAW_READY__"));
        NodeAssert.ok(emulator().screen().text.includes("__RAW_READY__"));
        NodeAssert.ok(!emulator().screen().text.includes("__SHELL_READY__"));

        yield* Effect.promise(() => driver.input.pressKey("ARROW_LEFT"));
        yield* Effect.promise(() => handle.current.drainInput());
        yield* show(yield* received("HEX[1b5b44]"));
        yield* Effect.promise(() => driver.input.pressKey("ESCAPE"));
        yield* Effect.promise(() => handle.current.drainInput());
        yield* show(yield* received("HEX[1b]"));
        yield* Effect.promise(async () => {
          handle.current.paste("漢字");
          await handle.current.drainInput();
        });
        const pasteHex = "HEX[1b5b3230307ee6bca2e5ad971b5b3230317e]";
        yield* show(yield* received(pasteHex));
        NodeAssert.ok(emulator().screen().text.includes(pasteHex));

        yield* Effect.promise(async () => {
          await driver.resize(100, 32);
          await callbacks.drainResize();
        });
        yield* show(yield* received("SIZE:100x32"));
        NodeAssert.equal(emulator().screen().columns, 100);
        NodeAssert.equal(emulator().screen().rows, 32);
        yield* Effect.promise(() => driver.mouse.click(4, 3, MouseButtons.LEFT, { delayMs: 0 }));
        yield* Effect.promise(() => handle.current.drainInput());
        yield* show(yield* received("1b5b3c303b353b344d"));
        yield* Effect.promise(() => driver.input.pressKey("z", { ctrl: true }));
        yield* Effect.promise(() => handle.current.drainInput());
        yield* show(yield* received("HEX[1a]"));
        yield* Effect.promise(() => driver.input.pressKey("F1"));
        yield* Effect.promise(() => handle.current.drainInput());
        yield* show(yield* received("HEX[1b4f50]"));

        const beforeRelease = callbacks.writes.length;
        yield* Effect.promise(() => driver.input.pressKey("\\", { ctrl: true }));
        yield* Effect.promise(() => handle.current.drainInput());
        NodeAssert.equal(released.mock.calls.length, 1);
        NodeAssert.equal(callbacks.writes.length, beforeRelease);
        NodeAssert.equal(emulator().focused, false);
        yield* Effect.promise(() => act(async () => focus.current()));

        const oldEmulator = emulator();
        yield* view.disconnect;
        yield* send("offline");
        view = yield* openTerminalFixtureConnection(fixture);
        attached = yield* attachTerminalFixture(view, target);
        yield* show(yield* received("HEX[6f66666c696e65]"));
        NodeAssert.equal((yield* SubscriptionRef.get(attached.snapshot)).pid, originalPid);
        NodeAssert.equal(oldEmulator.isDestroyed, true);
        for (const marker of [
          "__RAW_READY__",
          "HEX[1b5b44]",
          "HEX[1b]",
          pasteHex,
          "HEX[6f66666c696e65]",
        ]) {
          NodeAssert.equal(emulator().screen().text.split(marker).length - 1, 1, marker);
        }

        yield* Effect.promise(() => driver.input.pressKey("c", { ctrl: true }));
        yield* Effect.promise(() => handle.current.drainInput());
        yield* show(yield* received("__PROBE_EXIT__"));
        NodeAssert.ok(emulator().screen().text.includes("__SHELL_READY__"));
        NodeAssert.ok(emulator().screen().text.includes("__PROBE_EXIT__"));

        const applicationFile = NodePath.join(fixture.root, "application.txt");
        yield* Effect.promise(() =>
          NodeFSP.writeFile(applicationFile, "TUI_APP_FIXTURE\nSecond line\n"),
        );
        const quotedFile = `'${applicationFile.replaceAll("'", "'\\''")}'`;
        yield* send(`vi -u NONE -i NONE -n -N ${quotedFile}; printf '__%s__\\n' 'VIM_EXIT'\n`);
        yield* show(yield* received("TUI_APP_FIXTURE"));
        NodeAssert.ok(emulator().screen().text.includes("TUI_APP_FIXTURE"));
        yield* Effect.promise(async () => {
          await driver.input.typeText(":q!");
          await driver.input.pressKey("RETURN");
          await handle.current.drainInput();
        });
        yield* show(yield* received("__VIM_EXIT__"));
        NodeAssert.ok(emulator().screen().text.includes("__VIM_EXIT__"));

        yield* send(`less ${quotedFile}; printf '__%s__\\n' 'PAGER_EXIT'\n`);
        yield* show(yield* received("(END)"));
        NodeAssert.ok(emulator().screen().text.includes("TUI_APP_FIXTURE"));
        yield* Effect.promise(() => driver.input.pressKey("q"));
        yield* Effect.promise(() => handle.current.drainInput());
        yield* show(yield* received("__PAGER_EXIT__"));
        yield* send("node -i; printf '__%s__\\n' 'REPL_EXIT'\n");
        yield* show(yield* received("Welcome to Node.js"));
        yield* Effect.promise(async () => {
          handle.current.paste("console.log('__REPL_' + 'RESULT__')");
          await driver.input.pressKey("RETURN");
          await handle.current.drainInput();
        });
        yield* show(yield* received("__REPL_RESULT__"));
        NodeAssert.ok(emulator().screen().text.includes("__REPL_RESULT__"));
        yield* Effect.promise(() => driver.input.pressKey("d", { ctrl: true }));
        yield* Effect.promise(() => handle.current.drainInput());
        yield* show(yield* received("__REPL_EXIT__"));

        const beforeClear = yield* SubscriptionRef.get(attached.state);
        yield* control.client[WS_METHODS.terminalClear](target);
        yield* show(
          yield* attached.waitFor(
            (state) => state.output.resetVersion > beforeClear.output.resetVersion,
          ),
        );
        NodeAssert.equal(emulator().screen().text, "");
        NodeAssert.equal(emulator().focused, true);

        const beforeRestart = yield* SubscriptionRef.get(attached.state);
        const restarted = yield* control.client[WS_METHODS.terminalRestart]({
          ...launch,
          cols: 100,
          rows: 32,
        });
        yield* show(
          yield* attached.waitFor(
            (state) => state.lifecycleVersion > beforeRestart.lifecycleVersion,
          ),
        );
        NodeAssert.notEqual(restarted.pid, originalPid);
        NodeAssert.ok(!emulator().screen().text.includes("__RAW_READY__"));
        yield* send("printf '__%s__\\n' 'RESTARTED'\n");
        yield* show(yield* received("__RESTARTED__"));
        NodeAssert.ok(emulator().screen().text.includes("__RESTARTED__"));
        yield* control.client[WS_METHODS.terminalClose]({ ...target, deleteHistory: true });
        yield* attached.waitFor((state) => state.status === "closed");
        NodeAssert.deepEqual(callbacks.errors, []);
      }).pipe(Effect.scoped),
    60_000,
  );
}
