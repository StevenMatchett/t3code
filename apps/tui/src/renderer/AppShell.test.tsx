import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import { act } from "react";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { AppShell } from "./AppShell.tsx";
import { UiProvider } from "../ui/context.tsx";
import { basicTerminalCapabilities } from "../ui/capabilities.ts";

const activeDrivers = new Set<TuiTestDriver>();
async function renderShell(options?: Parameters<typeof createTuiTestDriver>[1]) {
  const fixture = makeClientFixture();
  const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, options);
  activeDrivers.add(driver);
  return { driver, fixture };
}
afterEach(async () => {
  await Promise.all([...activeDrivers].map((driver) => driver.close()));
  activeDrivers.clear();
});

const runtime = globalThis as typeof globalThis & {
  process?: { getBuiltinModule?: (id: string) => unknown };
};
const describeWithNativeFfi = runtime.process?.getBuiltinModule?.("node:ffi")
  ? describe
  : describe.skip;

describeWithNativeFfi("connected AppShell", () => {
  it.each([false, true])(
    "opens actual project and thread selections with arrows, Tab, and Enter (kitty=%s)",
    async (kittyKeyboard) => {
      const { driver } = await renderShell({ width: 80, height: 24, kittyKeyboard });
      expect(driver.captureFrame()).toContain("> Alpha");
      await driver.input.pressKey("ARROW_DOWN");
      expect(driver.captureFrame()).toContain("> Beta");
      await driver.input.pressKey("RETURN");
      expect(driver.captureFrame()).toContain("Threads (1) - Beta");
      await driver.input.pressKey("ARROW_RIGHT");
      expect(driver.captureFrame()).toContain("reply-2");
      await driver.input.pressKey("ARROW_LEFT");
      expect(driver.captureFrame()).toContain("> Other project conversation");
      await driver.input.pressKey("ESCAPE");
      expect(driver.captureFrame()).toContain("> Beta");
      await driver.input.pressKey("TAB", { shift: true });
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("RETURN");
      expect(driver.captureFrame()).toContain("reply-1");
      expect(driver.captureFrame()).toContain("Message / Enter to write");
      expect(driver.captureFrame()).not.toContain("connected / live");
      expect(driver.captureFrame()).not.toContain("Creation, Git, and terminal UI");
      expect(driver.captureFrame()).not.toContain("New project");
    },
  );

  it("scrolls history, keeps the viewport through help and updates, and resumes following at End", async () => {
    const { driver, fixture } = await renderShell({ width: 72, height: 16 });
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Visible line 59");
    await driver.input.pressKey("HOME");
    expect(driver.captureFrame()).toContain("Visible line 0");
    await driver.input.pressKey("?");
    expect(driver.captureFrame()).toContain("Keyboard help");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Visible line 0");
    const thread = fixture.details[0]!;
    await act(async () => {
      driver.registry.set(fixture.states[0]!, {
        ...driver.registry.get(fixture.states[0]!),
        data: Option.some({
          ...thread,
          messages: [{ ...thread.messages[0]!, text: `${thread.messages[0]!.text}\nLive delta` }],
        }),
      });
    });
    await driver.flush();
    expect(driver.captureFrame()).toContain("Visible line 0");
    expect(driver.captureFrame()).not.toContain("Live delta");
    await driver.input.pressKey("END");
    expect(driver.captureFrame()).toContain("Live delta");
    await driver.resize(34, 18);
    expect(driver.captureFrame()).toContain("Live delta");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("> First conversation");
  });

  it("keeps a workspace sidebar on wide terminals and preserves an edited draft across compact resize", async () => {
    const { driver, fixture } = await renderShell({ width: 120, height: 32, kittyKeyboard: true });
    expect(driver.captureFrame()).toContain("Workspace");
    expect(driver.captureFrame()).toContain("/workspace/alpha");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Threads (2) - Alpha");
    expect(driver.captureFrame()).toContain("reply-1");
    await driver.input.pressKey("i");
    await driver.input.typeText("Keep this draft");
    await driver.resize(44, 20);
    expect(driver.captureFrame()).toContain("Keep this draft");
    expect(driver.captureFrame()).not.toContain("Threads (2) - Alpha");
    await driver.resize(120, 32);
    expect(driver.captureFrame()).toContain("Threads (2) - Alpha");
    expect(driver.captureFrame()).toContain("Keep this draft");
    expect(fixture.commands).toHaveLength(0);
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("TAB");
    expect(driver.captureFrame()).toContain("> Second conversation");
  });

  it("keeps selection and navigation readable with ASCII borders and no color", async () => {
    const fixture = makeClientFixture();
    const driver = await createTuiTestDriver(
      <UiProvider capabilities={basicTerminalCapabilities}>
        <AppShell client={fixture.client} />
      </UiProvider>,
      { width: 80, height: 24 },
    );
    activeDrivers.add(driver);
    expect(driver.captureFrame()).toContain("+-Projects (2)");
    expect(driver.captureFrame()).toContain("> Alpha");
    await driver.input.pressKey("ARROW_DOWN");
    expect(driver.captureFrame()).toContain("> Beta");
    expect(driver.captureFrame()).not.toContain("┌");
  });

  it("distinguishes an unavailable connection from an empty project list", async () => {
    const { driver, fixture } = await renderShell({ width: 80, height: 24 });
    await act(async () =>
      driver.registry.set(fixture.shell, {
        snapshot: Option.none(),
        status: "empty",
        error: Option.some("Unavailable"),
      }),
    );
    await driver.flush();
    expect(driver.captureFrame()).toContain("Connection unavailable");
    expect(driver.captureFrame()).not.toContain("No projects in this environment");
  });

  it("returns to the list if another client removes the open thread and handles empty lists", async () => {
    const { driver, fixture } = await renderShell();
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    const snapshot = Option.getOrThrow(driver.registry.get(fixture.shell).snapshot);
    await act(async () => {
      driver.registry.set(fixture.shell, {
        ...driver.registry.get(fixture.shell),
        snapshot: Option.some({ ...snapshot, threads: [] }),
      });
    });
    await driver.flush();
    expect(driver.captureFrame()).toContain("No active threads");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("No active threads");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("> Alpha");
  });
});
