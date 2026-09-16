import { afterEach, describe, expect, it } from "@effect/vitest";

import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { AppShell } from "./AppShell.tsx";

const activeDrivers = new Set<TuiTestDriver>();

async function renderShell(options?: Parameters<typeof createTuiTestDriver>[1]) {
  const driver = await createTuiTestDriver(<AppShell />, options);
  activeDrivers.add(driver);
  return driver;
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

describeWithNativeFfi("AppShell", () => {
  it("renders and drives deterministic route, focus, help, and back transitions", async () => {
    const driver = await renderShell({ width: 72, height: 14, kittyKeyboard: true });

    expect(driver.captureFrame()).toContain("Route: connection   Focus: connection-address");

    await driver.input.pressKey("3");
    await driver.input.pressKey("TAB");
    expect(driver.captureFrame()).toContain("Route: thread   Focus: conversation");

    await driver.input.pressKey("TAB");
    expect(driver.captureFrame()).toContain("Focus: composer");

    await driver.input.pressKey("TAB", { shift: true });
    expect(driver.captureFrame()).toContain("Focus: conversation");

    await driver.input.pressKey("?");
    expect(driver.captureFrame()).toContain("Keyboard help");

    await driver.input.pressKey("1");
    expect(driver.captureFrame()).toContain("Route: thread   Focus: conversation");

    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).not.toContain("Keyboard help");
    expect(driver.captureFrame()).toContain("Route: thread   Focus: conversation");

    await driver.input.pressKey("BACKSPACE");
    expect(driver.captureFrame()).toContain("Route: projects   Focus: project-list");
  });

  it("uses compact navigation and keeps state visible at a narrow width", async () => {
    const driver = await renderShell({ width: 32, height: 14 });

    expect(driver.captureFrame()).toContain("1 Conn  2 Proj  3 Chat  ? Help");
    expect(driver.captureFrame()).toContain("Route: connection");

    await driver.input.pressKey("2");
    await driver.input.pressKey("TAB");

    expect(driver.captureFrame()).toContain("Route: projects");
    expect(driver.captureFrame()).toContain("Focus: new-project");
    expect(driver.captureFrame()).toContain("Tab focus | Esc back");
  });
});
