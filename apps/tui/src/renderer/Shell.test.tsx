import { afterEach, describe, expect, it } from "@effect/vitest";
import type { CapturedFrame } from "@opentui/core";
import * as Option from "effect/Option";
import { act } from "react";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { makeDesignFixture, runningTurn, updateShellThread } from "../testing/designFixture.ts";
import { fuzzyScore } from "../ui/fuzzy.ts";
import { clampBox } from "../ui/layout.ts";
import { resolveThemeMode, themeModeFromColorfgbg } from "../ui/theme.ts";
import { AppShell } from "./AppShell.tsx";
import { App } from "./App.tsx";

const drivers: TuiTestDriver[] = [];
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((driver) => driver.close()));
});

async function setup(width = 120, height = 40) {
  const fixture = makeDesignFixture();
  const driver = await createTuiTestDriver(
    <AppShell client={fixture.client} searchDebounceMs={0} />,
    {
      width,
      height,
      kittyKeyboard: true,
    },
  );
  drivers.push(driver);
  return { driver, fixture };
}

const rowOf = (driver: TuiTestDriver, id: string) =>
  driver.renderer.root.findDescendantById(`navigation-${id}`);

function backgroundAt(frame: CapturedFrame, row: number, column: number) {
  let cursor = 0;
  for (const span of frame.lines[row]!.spans) {
    cursor += span.width;
    if (column < cursor) return span.bg.toInts().slice(0, 3).join(",");
  }
  return null;
}

describe("sidebar tree", () => {
  it("shows projects collapsed, expands with Space, and moving never reflows rows", async () => {
    const { driver } = await setup();
    expect(rowOf(driver, "alpha")).toBeDefined();
    expect(rowOf(driver, "beta")).toBeDefined();
    expect(rowOf(driver, "thread-0")).toBeUndefined();
    const betaRow = rowOf(driver, "beta")!.screenY;
    await driver.input.pressKey("ARROW_DOWN");
    expect(rowOf(driver, "beta")!.screenY).toBe(betaRow);
    expect(driver.captureFrame()).toContain("> Design system");
    await driver.input.pressKey("ARROW_UP");

    await driver.input.pressKey(" ");
    expect(rowOf(driver, "thread-0")).toBeDefined();
    expect(rowOf(driver, "thread-1")).toBeDefined();
    await driver.input.pressKey(" ");
    expect(rowOf(driver, "thread-0")).toBeUndefined();
  });

  it("enters a project with Enter and backs out one level with Esc, keeping it expanded", async () => {
    const { driver } = await setup();
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Threads (2) - Atlas");
    expect(driver.captureFrame()).toContain("> Add project search");
    await driver.input.pressKey("j");
    expect(driver.captureFrame()).toContain("> Improve onboarding copy");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("Projects (2)");
    expect(driver.captureFrame()).toContain("> Atlas");
    expect(rowOf(driver, "thread-1")).toBeDefined();
  });

  it("shows status chips that need attention on threads and collapsed projects", async () => {
    const { driver, fixture } = await setup();
    await act(async () =>
      updateShellThread(driver.registry, fixture, 2, (thread) => ({
        ...thread,
        hasPendingApprovals: true,
      })),
    );
    await driver.flush();
    const projectRow = rowOf(driver, "beta")!;
    expect(driver.captureFrame().split("\n")[projectRow.screenY]).toContain("[!]");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    const threadRow = rowOf(driver, "thread-2")!;
    expect(driver.captureFrame().split("\n")[threadRow.screenY]).toContain("[!]");
    await act(async () =>
      updateShellThread(driver.registry, fixture, 2, (thread) => ({
        ...thread,
        hasPendingApprovals: false,
        latestTurn: runningTurn,
        session: {
          threadId: thread.id,
          status: "running" as const,
          providerName: null,
          runtimeMode: "full-access" as const,
          activeTurnId: runningTurn.turnId,
          lastError: null,
          updatedAt: runningTurn.requestedAt,
        },
      })),
    );
    await driver.flush();
    expect(driver.captureFrame().split("\n")[rowOf(driver, "thread-2")!.screenY]).toMatch(
      /\d+[hms].*[|/\\-]/u,
    );
  });

  it("filters with /, keeps matching projects, and Esc clears", async () => {
    const { driver } = await setup();
    await driver.input.pressKey("/");
    await driver.input.typeText("keyboard");
    expect(rowOf(driver, "thread-2")).toBeDefined();
    expect(rowOf(driver, "thread-0")).toBeUndefined();
    expect(rowOf(driver, "alpha")).toBeUndefined();
    expect(rowOf(driver, "beta")).toBeDefined();
    // Letters type into the filter instead of firing shortcuts.
    await driver.input.typeText("n");
    expect(driver.captureFrame()).not.toContain("New thread in");
    await driver.input.pressKey("ESCAPE");
    expect(rowOf(driver, "alpha")).toBeDefined();
    expect(driver.captureFrame()).not.toContain("keyboardn");
  });

  it("keeps a filter applied after Enter until Esc clears it", async () => {
    const { driver } = await setup();
    await driver.input.pressKey("/");
    await driver.input.typeText("design");
    await driver.input.pressKey("RETURN");
    expect(rowOf(driver, "alpha")).toBeUndefined();
    await driver.input.pressKey("ESCAPE");
    expect(rowOf(driver, "alpha")).toBeDefined();
  });
});

describe("palette", () => {
  it("lists actions with the key that runs them, and > keeps only commands", async () => {
    const { driver } = await setup();
    await driver.input.pressKey("k", { ctrl: true });
    const frame = driver.captureFrame();
    expect(frame).toMatch(/New thread\s+N\s/u);
    expect(frame).toMatch(/Show archived threads\s+⇧A/u);
    expect(frame).toContain("Add project search");
    await driver.input.typeText(">");
    const commands = driver.captureFrame();
    expect(commands).toContain("New thread");
    expect(commands).not.toContain("Thread · ");
    expect(commands).not.toContain("Project · ");
  });

  it("runs an action from the palette through the same handler as its key", async () => {
    const { driver } = await setup();
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("view thread changes");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Thread changes");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).not.toContain("Thread changes");
  });

  it("ranks what you meant first, and starts on your last choice", async () => {
    const { driver } = await setup();
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("help");
    expect(driver.captureFrame()).toContain("> Keyboard help");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("k", { ctrl: true });
    expect(driver.captureFrame()).toContain("> Keyboard help");
  });

  it("offers Ctrl+K as a toggle", async () => {
    const { driver } = await setup();
    await driver.input.pressKey("k", { ctrl: true });
    expect(driver.captureFrame()).toContain("Search and commands");
    await driver.input.pressKey("k", { ctrl: true });
    expect(driver.captureFrame()).not.toContain("Search and commands");
  });

  it("ranks prefix and word matches over scattered letters", () => {
    expect(fuzzyScore("ne", "New thread")!).toBeGreaterThan(fuzzyScore("ne", "Keyboard net")!);
    expect(fuzzyScore("thread", "New thread")!).toBeGreaterThan(fuzzyScore("thread", "tmhrzeaxd")!);
    expect(fuzzyScore("zz", "New thread")).toBeNull();
  });
});

describe("help", () => {
  it("is generated, shows this screen first, and scrolls past the fold", async () => {
    const { driver } = await setup(80, 24);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.typeText("?");
    const first = driver.captureFrame();
    expect(first).toContain("HERE: CONVERSATION");
    expect(first).toContain("Write a message");
    expect(first).toMatch(/1-\d+ of \d+/u);
    await driver.input.pressKey("\u001b[6~");
    await driver.input.pressKey("\u001b[6~");
    const scrolled = driver.captureFrame();
    expect(scrolled).not.toEqual(first);
    expect(scrolled).not.toContain("Write a message");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("CONVERSATION");
  });

  it("differs by context and filters with /", async () => {
    const { driver } = await setup();
    await driver.input.typeText("?");
    expect(driver.captureFrame()).toContain("HERE: SIDEBAR");
    await driver.input.pressKey("/");
    await driver.input.typeText("zzzz");
    expect(driver.captureFrame()).toContain("No actions match");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("Keyboard help");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).not.toContain("Keyboard help");
  });

  it("opens with F1 while a text field owns the ? key", async () => {
    const { driver, fixture } = await setup();
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("i");
    await driver.input.typeText("?");
    expect(driver.registry.get(fixture.client.actions.state(fixture.first.id)).draft).toBe("?");
    expect(driver.captureFrame()).toMatch(/F1\s+Help/u);
    await driver.input.pressKey("F1");
    expect(driver.captureFrame()).toContain("Keyboard help");
  });
});

describe("hotkey bar", () => {
  it.each([
    [34, 24],
    [80, 24],
    [120, 40],
    [200, 60],
  ])("always offers search and help at %ix%i", async (width, height) => {
    const { driver } = await setup(width, height);
    const footer = () => driver.captureFrame().split("\n").slice(-2).join("\n");
    expect(footer()).toContain("Ctrl+K");
    expect(footer()).toMatch(/\?/u);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    expect(footer()).toContain("Ctrl+K");
    expect(footer()).toMatch(/\?/u);
    await driver.input.pressKey("i");
    expect(footer()).toContain("Ctrl+K");
    expect(footer()).toContain("F1");
  });

  it("keeps hints visible beside a toast", async () => {
    const { driver } = await setup(80, 24);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("y");
    const footer = driver.captureFrame().split("\n").slice(-2).join("\n");
    expect(footer).toContain("Ctrl+K");
  });
});

describe("themes", () => {
  it("previews live, saves on Enter, and restores on Esc", async () => {
    const { driver } = await setup(100, 30);
    const panelBackground = () => {
      const frame = driver.captureSpans();
      return backgroundAt(frame, frame.rows - 4, 3);
    };
    const dark = panelBackground();
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("choose theme");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Match terminal");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("ARROW_DOWN");
    expect(driver.captureFrame()).toContain("Now showing light");
    expect(panelBackground()).not.toEqual(dark);
    await driver.input.pressKey("ESCAPE");
    expect(panelBackground()).toEqual(dark);

    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("choose theme");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).not.toContain("Match terminal");
    expect(panelBackground()).not.toEqual(dark);
  });

  it("follows the terminal, then COLORFGBG, then dark", () => {
    expect(resolveThemeMode("auto", "light", undefined)).toBe("light");
    expect(resolveThemeMode("auto", null, "15;0")).toBe("dark");
    expect(resolveThemeMode("auto", null, "0;15")).toBe("light");
    expect(resolveThemeMode("auto", null, undefined)).toBe("dark");
    expect(resolveThemeMode("light", "dark", "15;0")).toBe("light");
    expect(themeModeFromColorfgbg("bad")).toBeNull();
  });
});

describe("dialogs", () => {
  it("clamps boxes to the area they open in", () => {
    expect(clampBox({ width: 40, height: 10 }, { width: 100, height: 28 })).toEqual({
      width: 40,
      height: 10,
      left: 0,
      top: 0,
    });
    // A near fit fills the area rather than leaving a sliver of what is behind.
    expect(clampBox({ width: 80, height: 21 }, { width: 76, height: 20 })).toEqual({
      width: 80,
      height: 21,
      left: 0,
      top: 0,
    });
    expect(clampBox({ width: 100, height: 40 }, { width: 50, height: 20 })).toEqual({
      width: 50,
      height: 20,
      left: 25,
      top: 10,
    });
  });

  it.each([
    [80, 24],
    [40, 12],
  ])("keeps the quit dialog on screen at %ix%i", async (width, height) => {
    const fixture = makeDesignFixture();
    const driver = await createTuiTestDriver(
      <App client={fixture.client} onInterrupt={() => undefined} />,
      { width, height, kittyKeyboard: true },
    );
    drivers.push(driver);
    await driver.input.pressKey("c", { ctrl: true });
    const dialog = driver.renderer.root.findDescendantById("exit-confirmation")!;
    expect(dialog.screenX).toBeGreaterThanOrEqual(0);
    expect(dialog.screenX + dialog.width).toBeLessThanOrEqual(width);
    expect(dialog.screenY + dialog.height).toBeLessThanOrEqual(height);
    expect(driver.captureFrame()).toContain("Close T3 TUI?");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).not.toContain("Close T3 TUI?");
  });
});

describe("states", () => {
  it("names the next action when empty", async () => {
    const { driver, fixture } = await setup(80, 24);
    await act(async () =>
      driver.registry.update(fixture.shell, (shell) => ({
        ...shell,
        snapshot: Option.map(shell.snapshot, (snapshot) => ({
          ...snapshot,
          projects: [],
          threads: [],
        })),
      })),
    );
    await driver.flush();
    expect(driver.captureFrame()).toContain("Press P to add one.");
    await driver.input.pressKey("p");
    expect(driver.captureFrame()).toContain("Add a project");
  });
});
