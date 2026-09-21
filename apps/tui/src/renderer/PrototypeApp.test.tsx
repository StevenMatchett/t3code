import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { MouseButtons } from "@opentui/core/testing";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { PrototypeApp } from "./PrototypeApp.tsx";

const drivers = new Set<TuiTestDriver>();

afterEach(async () => {
  await Promise.all([...drivers].map((driver) => driver.close()));
  drivers.clear();
});

async function setup() {
  const fixture = makeClientFixture();
  const onInterrupt = vi.fn();
  const driver = await createTuiTestDriver(
    <PrototypeApp client={fixture.client} onInterrupt={onInterrupt} />,
    { width: 80, height: 24 },
  );
  drivers.add(driver);
  return { driver, onInterrupt };
}

describe("PrototypeApp exit confirmation", () => {
  it("passes Ctrl+C through while the embedded terminal owns focus", async () => {
    const fixture = makeClientFixture();
    const onInterrupt = vi.fn();
    const driver = await createTuiTestDriver(
      <PrototypeApp client={fixture.client} onInterrupt={onInterrupt} />,
      { width: 96, height: 28, kittyKeyboard: true },
    );
    drivers.add(driver);

    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("t", { ctrl: true });
    await driver.input.pressKey("c", { ctrl: true });

    expect(fixture.terminalWrites).toContain("\x03");
    expect(driver.captureFrame()).not.toContain("Close T3 TUI?");
    expect(onInterrupt).not.toHaveBeenCalled();

    await driver.input.pressKey("\\", { ctrl: true });
    await driver.input.pressKey("c", { ctrl: true });
    expect(driver.captureFrame()).toContain("Close T3 TUI?");
  });

  it("defaults to cancellation and requires confirmation before interrupting", async () => {
    const { driver, onInterrupt } = await setup();

    await driver.input.pressKey("c", { ctrl: true });
    expect(driver.captureFrame()).toContain("Close T3 TUI?");
    expect(driver.captureFrame()).toContain("agents will keep running");
    expect(onInterrupt).not.toHaveBeenCalled();

    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).not.toContain("Close T3 TUI?");
    expect(onInterrupt).not.toHaveBeenCalled();

    await driver.input.pressKey("c", { ctrl: true });
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("RETURN");
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it("supports cancelling and confirming with the mouse", async () => {
    const { driver, onInterrupt } = await setup();
    await driver.input.pressKey("c", { ctrl: true });
    const cancel = driver.renderer.root.findDescendantById("exit-confirm-cancel");
    expect(cancel).toBeDefined();
    await driver.mouse.click(cancel!.screenX + 1, cancel!.screenY, MouseButtons.LEFT, {
      delayMs: 0,
    });
    expect(driver.captureFrame()).not.toContain("Close T3 TUI?");

    await driver.input.pressKey("c", { ctrl: true });
    const quit = driver.renderer.root.findDescendantById("exit-confirm-quit");
    expect(quit).toBeDefined();
    await driver.mouse.click(quit!.screenX + 1, quit!.screenY, MouseButtons.LEFT, { delayMs: 0 });
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it("treats a second Ctrl+C as confirmation", async () => {
    const { driver, onInterrupt } = await setup();
    await driver.input.pressKey("c", { ctrl: true });
    await driver.input.pressKey("c", { ctrl: true });
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });
});
