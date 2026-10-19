import { describe, expect, it, vi } from "vite-plus/test";
import { EMPTY_TERMINAL_BUFFER_STATE } from "@t3tools/client-runtime/state/terminal";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver } from "../testing/driver.tsx";
import { ThreadTerminal } from "./ThreadTerminal.tsx";

const describeWithNativeFfi = process.getBuiltinModule("node:ffi") ? describe : describe.skip;

describeWithNativeFfi("ThreadTerminal", () => {
  it("sizes the shell after attachment and when the viewport changes", async () => {
    const fixture = makeClientFixture();
    const registry = AtomRegistry.make();
    registry.set(fixture.terminalBuffer, AsyncResult.success(EMPTY_TERMINAL_BUFFER_STATE));
    const resize = vi.spyOn(fixture.client.terminals!.resize, "run");
    const driver = await createTuiTestDriver(
      <ThreadTerminal
        client={fixture.client}
        environmentId={fixture.client.environmentId}
        threadId={fixture.threads[0]!.id}
        cwd="/workspace/alpha"
        worktreePath={null}
        active
        onBack={() => undefined}
      />,
      { registry, width: 100, height: 30 },
    );
    try {
      expect(resize).not.toHaveBeenCalled();
      await act(async () => {
        registry.set(
          fixture.terminalBuffer,
          AsyncResult.success({
            ...EMPTY_TERMINAL_BUFFER_STATE,
            version: 1,
            status: "running",
          }),
        );
      });
      await driver.flush();
      expect(resize.mock.calls.at(-1)?.[1].input).toMatchObject({ cols: 100, rows: 29 });
      await driver.resize(120, 40);
      expect(resize.mock.calls.at(-1)?.[1].input).toMatchObject({ cols: 120, rows: 39 });
    } finally {
      await driver.close();
    }
  });
});
