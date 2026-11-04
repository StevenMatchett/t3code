import { afterEach, describe, expect, it } from "@effect/vitest";
import { act } from "react";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { makeDesignFixture, runningTurn, updateThread } from "../testing/designFixture.ts";
import { createActivityClock } from "../ui/activityClock.ts";
import { richTerminalCapabilities } from "../ui/capabilities.ts";
import { UiProvider } from "../ui/context.tsx";
import { ActivityClockProvider } from "../ui/ThreadActivityIndicator.tsx";
import { AppShell } from "./AppShell.tsx";

const drivers: TuiTestDriver[] = [];
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((driver) => driver.close()));
});

async function setup(animation = true) {
  const fixture = makeDesignFixture();
  let tickTimers = 0;
  let running = 0;
  const clock = createActivityClock(
    () => {
      tickTimers += 1;
      running += 1;
      return () => {
        running -= 1;
      };
    },
    () => () => undefined,
  );
  const driver = await createTuiTestDriver(
    <UiProvider capabilities={{ ...richTerminalCapabilities, animation }}>
      <ActivityClockProvider clock={clock}>
        <AppShell client={fixture.client} />
      </ActivityClockProvider>
    </UiProvider>,
    { width: 120, height: 40, kittyKeyboard: true },
  );
  drivers.push(driver);
  driver.registry.mount(fixture.states[0]!);
  const runTurn = async () => {
    await act(async () =>
      updateThread(driver.registry, fixture, 0, (thread) => ({
        ...thread,
        latestTurn: runningTurn,
      })),
    );
    await driver.flush();
  };
  return { driver, runTurn, running: () => running, ticks: () => tickTimers };
}

describe("idle wakeups", () => {
  it("runs no timer when nothing animates, including on a thread with a completed turn", async () => {
    const { driver, running, ticks } = await setup();
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Took 2m 11s");
    await driver.input.pressKey("i");
    await driver.input.typeText("typing is not animation");
    expect(running()).toBe(0);
    expect(ticks()).toBe(0);
  });

  it("does not grow active timers while idle", async () => {
    const { driver } = await setup();
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.flush();
    const timers = () =>
      process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;
    const settled = timers();
    await driver.flush();
    await driver.flush();
    expect(timers()).toBeLessThanOrEqual(settled);
  });

  it("ticks only while a running turn is visible, and stops under an overlay", async () => {
    const { driver, runTurn, running } = await setup();
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await runTurn();
    expect(running()).toBe(1);
    await driver.input.pressKey("d");
    expect(driver.captureFrame()).toContain("Thread changes");
    expect(running()).toBe(0);
    await driver.input.pressKey("ESCAPE");
    expect(running()).toBe(1);
  });

  it("honors T3_TUI_ANIMATION=0 with static spinners and timers", async () => {
    const { driver, runTurn, running, ticks } = await setup(false);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await runTurn();
    expect(driver.captureFrame()).toContain("Working");
    expect(running()).toBe(0);
    expect(ticks()).toBe(0);
  });
});
