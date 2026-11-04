import { afterEach, describe, expect, it } from "@effect/vitest";
import type { CapturedFrame } from "@opentui/core";
import * as Option from "effect/Option";
import { act } from "react";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import {
  assistantMessage,
  makeDesignFixture,
  runningTurn,
  updateShellThread,
} from "../testing/designFixture.ts";
import { projectRecordedThreadTimeline } from "../features/chat/timeline.ts";
import { basicTerminalCapabilities } from "../ui/capabilities.ts";
import { UiProvider } from "../ui/context.tsx";
import { conversationLines } from "../ui/conversationLines.ts";
import { fuzzyScore } from "../ui/fuzzy.ts";
import { clampBox, fitControlWidths } from "../ui/layout.ts";
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

describe("composer controls", () => {
  it("keeps equal cells while labels fit, and never clips a short label to save a long one", () => {
    expect(fitControlWidths([15, 6, 13], 72)).toEqual([24, 24, 24]);
    const crowded = fitControlWidths([20, 16, 6, 13, 6], 72);
    expect(crowded.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(72);
    expect(crowded).toEqual([21, 17, 7, 14, 7]);
    const tight = fitControlWidths([40, 16, 6, 13, 6], 60);
    expect(tight.reduce((sum, width) => sum + width, 0)).toBe(60);
    expect(tight.slice(2)).toEqual([7, 14, 7]);
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

describe("list filters", () => {
  it("filters the diff file list with /, and Esc clears the filter before closing", async () => {
    const { driver } = await setup();
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("d");
    expect(driver.captureFrame()).toContain("search.test.ts +3 -0");
    await driver.input.pressKey("/");
    await driver.input.typeText("test");
    const filtered = driver.captureFrame();
    expect(filtered).toContain("search.test.ts +3 -0");
    expect(filtered).not.toContain("search.ts +4 -1");
    // Letters type into the filter instead of switching scope.
    await driver.input.typeText("s");
    expect(driver.captureFrame()).toContain("/ tests");
    expect(driver.captureFrame()).toContain("No files match");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("search.ts +4 -1");
    expect(driver.captureFrame()).toContain("Thread changes");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).not.toContain("Thread changes");
  });

  it("filters checkpoint prompts with /", async () => {
    const { driver, fixture } = await setup();
    const release = driver.registry.mount(fixture.states[0]!);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("e");
    expect(driver.captureFrame()).toContain("Add project search with keyboard");
    await driver.input.pressKey("/");
    await driver.input.typeText("zzz");
    expect(driver.captureFrame()).toContain("No prompts match.");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("Add project search with keyboard");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).not.toContain("Checkpoint restore");
    release();
  });
});

describe("input bursts", () => {
  it("routes each key to the layer the previous key opened, even in one chunk", async () => {
    const { driver } = await setup();
    await driver.input.typeText("?/zz");
    expect(driver.captureFrame()).toContain("No actions match");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("ESCAPE");
    await driver.input.typeText("/design");
    expect(rowOf(driver, "alpha")).toBeUndefined();
    expect(rowOf(driver, "beta")).toBeDefined();
  });
});

describe("folder form", () => {
  it("starts on the folder field and keeps text typed while folders load", async () => {
    const { driver, fixture } = await setup();
    await driver.input.pressKey("p");
    // The first browse has not settled yet when these keys arrive.
    await driver.input.typeText("/srv/app");
    await driver.flush();
    expect(driver.captureFrame()).toContain("/srv/app");
    expect(fixture.projects).toHaveLength(2);
  });
});

describe("folder filter", () => {
  it("filters folders with / when the list has focus", async () => {
    const { driver } = await setup();
    await driver.input.pressKey("p");
    await driver.flush();
    expect(driver.captureFrame()).toContain("code/");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("/");
    await driver.input.typeText("proj");
    expect(driver.captureFrame()).toContain("> projects/");
    expect(driver.captureFrame()).not.toContain(" code/");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("code/");
    expect(driver.captureFrame()).toContain("Add a project");
  });
});

describe("streaming stability", () => {
  const reply = `Here is the plan for the change.

1. Read the navigation module and note where the selection is stored.
2. Add a filter that keeps the selected row **visible** while typing.

\`\`\`ts
const visible = rows.filter((row) => row.title.includes(query));
\`\`\`

Then run the focused tests and report what changed.`;

  it("never rewrites earlier lines while a reply streams", () => {
    const rowsFor = (text: string) =>
      conversationLines(
        projectRecordedThreadTimeline({
          messages: [assistantMessage("stream", text, true)],
          activities: [],
        }),
        60,
        false,
      ).map((line) => line.text);
    const violations: string[] = [];
    let previous: readonly string[] = [];
    for (let end = 1; end <= reply.length; end += 3) {
      const lines = rowsFor(reply.slice(0, end));
      // The last few rows are still being written. Everything above them must hold still.
      const settled = previous.slice(0, Math.max(0, previous.length - 4));
      settled.forEach((line, index) => {
        if (lines[index] !== line)
          violations.push(
            `at ${end}, row ${index}: ${JSON.stringify(line)} -> ${JSON.stringify(lines[index])}`,
          );
      });
      previous = lines;
    }
    expect(violations).toEqual([]);
  });
});

describe("ascii mode", () => {
  it.each([
    "projects",
    "conversation",
    "bullets",
    "composer",
    "help",
    "palette",
    "diff",
    "new-thread",
  ])("prints only ASCII on the %s screen", async (screen) => {
    const fixture = makeDesignFixture();
    const driver = await createTuiTestDriver(
      <UiProvider capabilities={basicTerminalCapabilities}>
        <AppShell client={fixture.client} searchDebounceMs={0} />
      </UiProvider>,
      { width: 80, height: 24, kittyKeyboard: true },
    );
    drivers.push(driver);
    const open = async () => {
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("RETURN");
    };
    if (screen === "conversation") await open();
    if (screen === "bullets") {
      await open();
      await driver.input.pressKey("HOME");
    }
    if (screen === "composer") {
      await open();
      await driver.input.pressKey("i");
    }
    if (screen === "help") await driver.input.typeText("?");
    if (screen === "palette") await driver.input.pressKey("k", { ctrl: true });
    if (screen === "diff") {
      await open();
      await driver.input.pressKey("d");
    }
    if (screen === "new-thread") await driver.input.pressKey("n");
    const nonAscii = [...driver.captureRawFrame()].filter(
      (character) => character.charCodeAt(0) > 126,
    );
    expect([...new Set(nonAscii)]).toEqual([]);
  });
});

describe("workspace preview", () => {
  it("promises only what is possible on the current selection", async () => {
    const { driver, fixture } = await setup(120, 40);
    expect(driver.captureFrame()).toContain("Enter opens the project.");
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
    expect(driver.captureFrame()).not.toContain("Enter opens");
    expect(driver.captureFrame()).toContain("P adds a project.");
    await driver.input.pressKey("ARROW_RIGHT");
    await driver.input.pressKey("ARROW_RIGHT");
    expect(driver.captureFrame()).toContain("Nothing is archived.");
    expect(driver.captureFrame()).not.toContain("Enter opens");
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
    const frame = driver.captureFrame();
    expect(frame).toContain("Press P to add one.");
    // Nothing offers to open or expand a row that does not exist.
    const footer = frame.split("\n").slice(-2).join("\n");
    expect(footer).not.toMatch(/Enter\s+Open/u);
    expect(footer).not.toContain("Expand");
    await driver.input.pressKey("p");
    expect(driver.captureFrame()).toContain("Add a project");
  });
});
