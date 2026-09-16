import { describe, expect, it } from "@effect/vitest";

import { runTuiLifecycle, type TuiLifecycleRenderEvents } from "./lifecycle.ts";
import { TuiShutdownController } from "./shutdown.ts";

interface TestSession {
  readonly id: "owned-child";
}

interface TestRuntime {
  readonly id: "renderer";
}

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function makeHarness() {
  const shutdown = new TuiShutdownController();
  const rendered = deferred<TuiLifecycleRenderEvents>();
  const childExit = deferred<{ exitCode: number | null; signal: NodeJS.Signals | null }>();
  const events: string[] = [];
  const errors: unknown[] = [];
  const run = runTuiLifecycle<TestSession, TestRuntime>({
    shutdown,
    start: async () => {
      events.push("start");
      return { id: "owned-child" };
    },
    drainChildOutput: () => events.push("drain"),
    render: async (handlers) => {
      events.push("render");
      rendered.resolve(handlers);
      return { id: "renderer" };
    },
    waitForChildExit: () => childExit.promise,
    closeRuntime: async () => {
      events.push("close");
    },
    clearBearer: () => events.push("clear-bearer"),
    terminateChild: (session) => events.push(`terminate:${session.id}`),
    reportError: (error) => errors.push(error),
  });
  return { shutdown, rendered, childExit, events, errors, run };
}

describe("TUI CLI lifecycle", () => {
  it("restores the terminal and clears credentials before terminating its owned child", async () => {
    const harness = makeHarness();
    await harness.rendered.promise;
    harness.shutdown.request({ kind: "signal", signal: "SIGTERM" });

    await expect(harness.run).resolves.toBe(143);
    expect(harness.events).toEqual([
      "start",
      "drain",
      "render",
      "close",
      "clear-bearer",
      "terminate:owned-child",
    ]);
    expect(harness.errors).toEqual([]);
  });

  it("handles raw-mode Ctrl+C through the same cleanup path", async () => {
    const harness = makeHarness();
    const handlers = await harness.rendered.promise;
    handlers.onInterrupt();

    await expect(harness.run).resolves.toBe(130);
    expect(harness.events.slice(-3)).toEqual(["close", "clear-bearer", "terminate:owned-child"]);
  });

  it("reports a render failure after cleaning up the authenticated child", async () => {
    const shutdown = new TuiShutdownController();
    const error = new Error("renderer failed");
    const events: string[] = [];
    const errors: unknown[] = [];

    const exitCode = await runTuiLifecycle<TestSession, TestRuntime>({
      shutdown,
      start: async () => ({ id: "owned-child" }),
      drainChildOutput: () => events.push("drain"),
      render: async () => {
        throw error;
      },
      waitForChildExit: async () => ({ exitCode: 0, signal: null }),
      closeRuntime: async () => {
        events.push("close");
      },
      clearBearer: () => events.push("clear-bearer"),
      terminateChild: () => events.push("terminate"),
      reportError: (reported) => errors.push(reported),
    });

    expect(exitCode).toBe(1);
    expect(events).toEqual(["drain", "clear-bearer", "terminate"]);
    expect(errors).toEqual([error]);
  });

  it("closes the TUI when its captured child exits", async () => {
    const harness = makeHarness();
    await harness.rendered.promise;
    harness.childExit.resolve({ exitCode: 17, signal: null });

    await expect(harness.run).resolves.toBe(17);
    expect(harness.events.slice(-3)).toEqual(["close", "clear-bearer", "terminate:owned-child"]);
  });
});
