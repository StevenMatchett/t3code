import { MouseButtons } from "@opentui/core/testing";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { PlanId, type VcsStatusResult } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "@effect/vitest";
import type { CapturedFrame } from "@opentui/core";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { act } from "react";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import {
  assistantMessage,
  makeDesignFixture,
  runningTurn,
  updateShellThread,
  updateThread,
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

describe("repeated overlays", () => {
  it.each([false, true])(
    "keeps opening forms after closing them (kitty=%s)",
    async (kittyKeyboard) => {
      const fixture = makeDesignFixture();
      const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
        width: 80,
        height: 24,
        kittyKeyboard,
      });
      drivers.push(driver);
      await driver.input.pressKey("RETURN");
      for (let round = 0; round < 3; round += 1) {
        await driver.input.pressKey("n");
        expect(driver.captureFrame()).toContain("New thread in");
        await driver.input.pressKey("ESCAPE");
        expect(driver.captureFrame()).toContain("THREADS");
        await driver.input.pressKey("p");
        expect(driver.captureFrame()).toContain("Add a project");
        await driver.input.pressKey("ESCAPE");
        expect(driver.captureFrame()).toContain("THREADS");
      }
    },
  );
});

describe("forms after a working session", () => {
  it.each([false, true])(
    "opens the project form from the thread list (kitty=%s)",
    async (kittyKeyboard) => {
      const fixture = makeDesignFixture();
      const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
        width: 80,
        height: 24,
        kittyKeyboard,
      });
      drivers.push(driver);
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("i");
      await driver.input.typeText("hello");
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("ESCAPE");
      await driver.input.pressKey("d");
      await driver.input.pressKey("ESCAPE");
      await driver.input.pressKey("k", { ctrl: true });
      await driver.input.pressKey("ESCAPE");
      await driver.input.pressKey("F1");
      await driver.input.pressKey("\u001b[6~");
      await driver.input.pressKey("ESCAPE");
      await driver.input.pressKey("ESCAPE");
      expect(driver.captureFrame()).toContain("THREADS");
      await driver.input.pressKey("n");
      await driver.input.pressKey("ESCAPE");
      expect(driver.captureFrame()).toContain("THREADS");
      await driver.input.pressKey("p");
      expect(driver.captureFrame()).toContain("Add a project");
    },
  );
});

describe("folder form", () => {
  it("opens again after a project was added", async () => {
    const { driver, fixture } = await setup();
    await driver.input.pressKey("p");
    await driver.flush();
    await driver.input.pressKey("RETURN");
    await driver.flush();
    expect(fixture.projects).toHaveLength(3);
    expect(driver.captureFrame()).not.toContain("Add a project");
    await driver.input.pressKey("p");
    await driver.flush();
    expect(driver.captureFrame()).toContain("Add a project");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).not.toContain("Add a project");
  });

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

describe("connection status", () => {
  it("shows the whole status in ASCII mode", async () => {
    const fixture = makeDesignFixture();
    const driver = await createTuiTestDriver(
      <UiProvider capabilities={basicTerminalCapabilities}>
        <AppShell client={fixture.client} />
      </UiProvider>,
      { width: 80, height: 24, kittyKeyboard: true },
    );
    drivers.push(driver);
    await act(async () =>
      driver.registry.update(fixture.client.connection as never, (state: object) => ({
        ...state,
        phase: "backoff",
      })),
    );
    await driver.flush();
    expect(driver.captureFrame().split("\n")[0]).toContain("... Reconnecting");
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

describe("help rows", () => {
  it("gives each direction its own key instead of repeating the arrow pair", async () => {
    const { driver } = await setup(120, 40);
    await driver.input.typeText("?");
    const frame = driver.captureFrame();
    expect(frame).toMatch(/↑\s+Previous row/u);
    expect(frame).toMatch(/↓\s+Next row/u);
    expect(frame).not.toMatch(/↑↓\s+Previous row/u);
  });
});

/** Text no terminal should ever receive from a diff: CSI, OSC, and C0 and C1 controls. */
const UNSAFE_DIFF = [
  "diff --git a/src/x.ts b/src/x.ts",
  "index 1\u001b]0;PWNED\u0007..2 100644",
  "--- a/src/x.ts",
  "+++ b/src/x.ts",
  "@@ -1,2 +1,5 @@ top\u001b[2Jhunk",
  "-gone \u001b]0;PWNED\u001b\\left",
  "+evil \u001b[31mRED\u001b[0m \u001b]0;PWNED\u0007tail",
  "+c0 a\u0001b\u0008c\u007fd",
  "+c1 e\u009b31mf\u009d0;PWNED\u009cg\u0085h",
  " keep\u001bPdcs\u001b\\ row",
].join("\n");
const SAFE_LINES = [
  "tophunk",
  "gone left",
  "evil RED tail",
  "c0 abcd",
  "c1 efgh",
  "keep row",
] as const;

// oxlint-disable-next-line no-control-regex -- control characters are what these tests look for.
const TERMINAL_CONTROLS = /[\u0000-\u001f\u007f-\u009f]/u;

function expectSanitizedDiff(frame: string) {
  expect(frame.replaceAll("\n", "")).not.toMatch(TERMINAL_CONTROLS);
  expect(frame).not.toContain("PWNED");
  for (const line of SAFE_LINES) expect(frame).toContain(line);
}

describe("diff viewer", () => {
  const DIFF = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -10,2 +10,3 @@",
    " const keep = 1;",
    "-const old = 2;",
    "+const fresh = 3;",
    "+const more = 4;",
  ].join("\n");
  async function openDiff(width: number, height: number, diff = DIFF) {
    const fixture = makeDesignFixture();
    const client = {
      ...fixture.client,
      diffs: {
        ...fixture.client.diffs,
        fullThreadDiff: () => Atom.make(AsyncResult.success({ diff })),
      } as never,
    };
    const driver = await createTuiTestDriver(<AppShell client={client} />, {
      width,
      height,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("d");
    await driver.flush();
    return { driver, fixture };
  }

  it("reads across side by side on a wide terminal, and V goes back to unified", async () => {
    const { driver } = await openDiff(200, 60);
    const row = () =>
      driver
        .captureFrame()
        .split("\n")
        .find((line) => line.includes("const old"))!;
    expect(row()).toContain("const fresh");
    await driver.input.pressKey("v");
    await driver.flush();
    expect(row()).not.toContain("const fresh");
  });

  it("draws no terminal control characters from a diff, side by side or unified", async () => {
    const { driver } = await openDiff(200, 60, UNSAFE_DIFF);
    expect(
      driver
        .captureRawFrame()
        .split("\n")
        .find((line) => line.includes("gone left")),
    ).toContain("evil RED tail");
    expectSanitizedDiff(driver.captureRawFrame());
    await driver.input.pressKey("v");
    await driver.flush();
    expect(
      driver
        .captureRawFrame()
        .split("\n")
        .find((line) => line.includes("gone left")),
    ).not.toContain("evil RED tail");
    expectSanitizedDiff(driver.captureRawFrame());
  });

  it("draws no terminal control characters from a file name in the comment prompt", async () => {
    const { driver } = await openDiff(
      200,
      60,
      [
        "diff --git a/x.ts b/x.ts",
        '+++ "b/\\u001b]0;PWNED\\u0007x.ts"',
        "@@ -1 +1 @@",
        "+line",
      ].join("\n"),
    );
    await driver.input.pressKey("TAB");
    for (let index = 0; index < 3; index += 1) await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("c");
    await driver.flush();
    const frame = driver.captureRawFrame();
    // The header row above shows the escape as harmless literal text, so check the prompt itself.
    const prompt = frame.split("\n").find((line) => line.includes("Comment on this line"));
    expect(prompt).toContain("x.ts:1");
    expect(prompt).not.toContain("PWNED");
    expect(frame.replaceAll("\n", "")).not.toMatch(TERMINAL_CONTROLS);
  });

  it("stays unified where two columns would not be readable", async () => {
    const { driver } = await openDiff(80, 24);
    // At this width the file list and the diff take turns on screen.
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("v");
    await driver.flush();
    const frame = driver.captureFrame();
    expect(frame.split("\n").find((line) => line.includes("const old"))).not.toContain("fresh");
  });

  it("hides whitespace changes on request, by asking the server", async () => {
    const requested: unknown[] = [];
    const fixture = makeDesignFixture();
    const client = {
      ...fixture.client,
      diffs: {
        ...fixture.client.diffs,
        fullThreadDiff: (target: { input: unknown }) => {
          requested.push(target.input);
          return Atom.make(AsyncResult.success({ diff: DIFF }));
        },
      } as never,
    };
    const driver = await createTuiTestDriver(<AppShell client={client} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("d");
    await driver.input.pressKey("i");
    await driver.flush();
    expect(requested.at(-1)).toMatchObject({ ignoreWhitespace: true });
    expect(driver.captureFrame()).toContain("Whitespace hidden");
    await driver.input.pressKey("i");
    await driver.flush();
    expect(requested.at(-1)).not.toHaveProperty("ignoreWhitespace");
  });

  it("compares the branch against a typed base, and Esc keeps the current one", async () => {
    const requested: unknown[] = [];
    const fixture = makeDesignFixture();
    const client = {
      ...fixture.client,
      diffs: {
        ...fixture.client.diffs,
        fullThreadDiff: () => Atom.make(AsyncResult.success({ diff: DIFF })),
      } as never,
      review: {
        ...fixture.client.review,
        diffPreview: (target: { input: unknown }) => {
          requested.push(target.input);
          return Atom.make(
            AsyncResult.success({
              sources: [{ kind: "branch-range", diff: DIFF, truncated: false }],
            }),
          );
        },
      } as never,
    };
    const driver = await createTuiTestDriver(<AppShell client={client} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("d");
    await driver.input.pressKey("b");
    await driver.flush();
    await driver.input.pressKey("ESCAPE");
    await driver.flush();
    expect(driver.captureFrame()).toContain("Saved changes");

    await driver.input.pressKey("b");
    await driver.flush();
    await driver.input.typeText("release");
    await driver.flush();
    await driver.input.pressKey("RETURN");
    await driver.flush();
    expect(requested.at(-1)).toMatchObject({ baseRef: "release" });
    expect(driver.captureFrame()).toContain("Branch against release");
  });

  it("colors code by syntax", async () => {
    const { driver } = await openDiff(120, 40);
    await driver.input.pressKey("TAB");
    await driver.flush();
    const line = driver.captureSpans().lines.find((item) =>
      item.spans
        .map((span) => span.text)
        .join("")
        .includes("const fresh"),
    )!;
    const color = (needle: string) =>
      line.spans
        .find((span) => span.text.includes(needle))!
        .fg.toInts()
        .join();
    expect(color("const")).not.toBe(color("fresh"));
  });

  it("sends a line comment to the message, and closing focuses the composer", async () => {
    const { driver, fixture } = await openDiff(120, 40);
    const id = fixture.threads[0]!.id;
    await driver.input.pressKey("TAB");
    for (let index = 0; index < 6; index += 1) await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("c");
    await driver.flush();
    await driver.input.typeText("Why three?");
    await driver.flush();
    await driver.input.pressKey("RETURN");
    await driver.flush();
    expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe(
      "src/a.ts:11: Why three?",
    );
    expect(driver.captureFrame()).toContain("1 comment in your message");

    await driver.input.pressKey("ESCAPE");
    await driver.flush();
    expect(driver.captureFrame()).toContain("MESSAGE");
  });

  it("will not comment on the file header, and Esc cancels a comment", async () => {
    const { driver, fixture } = await openDiff(120, 40);
    const id = fixture.threads[0]!.id;
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("c");
    await driver.flush();
    expect(driver.captureFrame()).not.toContain("Comment on this line");
    for (let index = 0; index < 6; index += 1) await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("c");
    await driver.input.typeText("nope");
    await driver.input.pressKey("ESCAPE");
    await driver.flush();
    expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe("");
    expect(driver.captureFrame()).toContain("Thread changes");
  });
});

describe("worktree cleanup and linked pull requests", () => {
  async function setupDelete(worktreePath: string | null) {
    const fixture = makeClientFixture();
    const thread = fixture.threads[0]!;
    Object.assign(thread, { worktreePath });
    const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("m");
    await driver.flush();
    return { driver, fixture, thread };
  }
  const press = async (driver: TuiTestDriver, key: string) => {
    await act(async () => {
      await driver.input.pressKey(key);
      await new Promise((resolve) => setImmediate(resolve));
    });
    await driver.flush();
  };
  const toDelete = async (driver: TuiTestDriver) => {
    for (let index = 0; index < 3; index += 1) await press(driver, "TAB");
    await press(driver, "RETURN");
    await press(driver, "RETURN");
  };

  it("asks about a worktree only this thread used, and Enter keeps it", async () => {
    const { driver, fixture } = await setupDelete("/worktrees/solo");
    await toDelete(driver);
    expect(driver.captureFrame()).toContain("Also remove the worktree at /worktrees/solo?");
    await press(driver, "RETURN");
    expect(fixture.removedWorktrees).toEqual([]);
    expect(fixture.managementCommands.at(-1)).toMatchObject({ type: "thread.delete" });
    expect(driver.captureFrame()).not.toContain("Also remove");
  });

  it("Esc at the worktree question deletes nothing", async () => {
    const { driver, fixture } = await setupDelete("/worktrees/solo");
    await toDelete(driver);
    await press(driver, "ESCAPE");
    expect(fixture.removedWorktrees).toEqual([]);
    expect(fixture.managementCommands.some((item) => item.type === "thread.delete")).toBe(false);
  });

  it("keeps the thread when its worktree cannot be removed", async () => {
    const { driver, fixture } = await setupDelete("/worktrees/solo");
    fixture.worktreeFailure.current = "The worktree has uncommitted changes.";
    await toDelete(driver);
    await press(driver, "TAB");
    await press(driver, "RETURN");
    expect(fixture.managementCommands.some((item) => item.type === "thread.delete")).toBe(false);
    expect(driver.captureFrame()).toContain("The worktree has uncommitted changes.");
  });

  it("removes the worktree when asked", async () => {
    const { driver, fixture } = await setupDelete("/worktrees/solo");
    await toDelete(driver);
    await press(driver, "TAB");
    await press(driver, "RETURN");
    expect(fixture.removedWorktrees).toMatchObject([{ path: "/worktrees/solo" }]);
    expect(fixture.managementCommands.at(-1)).toMatchObject({ type: "thread.delete" });
  });

  it("does not ask when the thread has no worktree", async () => {
    const { driver, fixture } = await setupDelete(null);
    await toDelete(driver);
    expect(driver.captureFrame()).not.toContain("Also remove");
    expect(fixture.removedWorktrees).toEqual([]);
  });

  it("shows the linked pull request in the thread", async () => {
    const fixture = makeDesignFixture();
    const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await act(async () =>
      updateThread(driver.registry, fixture, 0, (thread) => ({
        ...thread,
        pullRequests: [
          {
            number: 42,
            url: "https://github.com/example/repo/pull/42",
            source: "git-action",
            snapshot: { state: "open", title: "Add search" },
          },
        ] as never,
      })),
    );
    await driver.flush();
    expect(driver.captureFrame()).toContain("PR #42 open");
  });
});

describe("fork from a run", () => {
  it("offers the latest run in the palette and opens the fork", async () => {
    const fixture = makeDesignFixture();
    const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("fork thread");
    await act(async () => {
      await driver.input.pressKey("RETURN");
      await new Promise((resolve) => setImmediate(resolve));
    });
    await driver.flush();
    expect(fixture.forks).toEqual([
      {
        sourceThreadId: fixture.threads[0]!.id,
        runId: fixture.threads[0]!.latestTurn!.turnId,
        title: `${fixture.threads[0]!.title} fork`,
      },
    ]);
  });
});

describe("pull requests", () => {
  async function openList(patch?: string) {
    const fixture = makeClientFixture();
    const client =
      patch === undefined
        ? fixture.client
        : {
            ...fixture.client,
            pullRequests: {
              ...fixture.client.pullRequests,
              diff: () =>
                Atom.make(AsyncResult.success({ patch, truncated: false, nextCursor: null })),
            } as never,
          };
    const driver = await createTuiTestDriver(<AppShell client={client} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await tick(driver, () => driver.input.pressKey("k", { ctrl: true }));
    await driver.input.typeText("pull requests list");
    await tick(driver, () => driver.input.pressKey("RETURN"));
    return { driver, fixture };
  }
  const tick = async (driver: TuiTestDriver, run: () => Promise<unknown>) => {
    await act(async () => {
      await run();
      await new Promise((resolve) => setImmediate(resolve));
    });
    await driver.flush();
  };

  it("lists open pull requests with their status, and Tab changes the state", async () => {
    const { driver } = await openList();
    const frame = driver.captureFrame();
    expect(frame).toContain("#42 Add project search  ada · checks pass · approved");
    expect(frame).toContain("#43 Tidy the header");
    expect(frame).not.toContain("Old idea");

    await tick(driver, () => driver.input.pressKey("TAB"));
    expect(driver.captureFrame()).toContain("[closed]");
    expect(driver.captureFrame()).toContain("#7 Old idea");
  });

  it("filters with / and Esc clears the filter before closing", async () => {
    const { driver } = await openList();
    await driver.input.typeText("/");
    await driver.input.typeText("tidy");
    await driver.flush();
    expect(driver.captureFrame()).toContain("#43 Tidy the header");
    expect(driver.captureFrame()).not.toContain("#42");
    await driver.input.pressKey("ESCAPE");
    await driver.flush();
    expect(driver.captureFrame()).toContain("#42");
  });

  it("shows detail and checks, and merging asks first", async () => {
    const { driver, fixture } = await openList();
    await tick(driver, () => driver.input.pressKey("RETURN"));
    expect(driver.captureFrame()).toContain("feature-42 into main");
    expect(driver.captureFrame()).toContain("search index");
    expect(driver.captureFrame()).toContain("tests: success");

    await tick(driver, () => driver.input.pressKey("m"));
    expect(driver.captureFrame()).toContain("Merge #42 into main? Enter confirms, Esc cancels.");
    expect(fixture.pullRequestActionsRun).toEqual([]);
    await tick(driver, () => driver.input.pressKey("ESCAPE"));
    expect(fixture.pullRequestActionsRun).toEqual([]);

    await tick(driver, () => driver.input.pressKey("m"));
    await tick(driver, () => driver.input.pressKey("RETURN"));
    expect(fixture.pullRequestActionsRun).toMatchObject([{ number: 42, action: "merge" }]);
    expect(driver.captureFrame()).toContain("Merge: done.");
  });

  it("shows a refused action and stays open", async () => {
    const { driver, fixture } = await openList();
    fixture.pullRequestFailure.current = "Required checks have not passed.";
    await tick(driver, () => driver.input.pressKey("RETURN"));
    await tick(driver, () => driver.input.pressKey("u"));
    expect(driver.captureFrame()).toContain("Required checks have not passed.");
    expect(driver.captureFrame()).toContain("feature-42 into main");
  });

  it("offers only what the state allows, so a closed one can reopen but not merge", async () => {
    const { driver, fixture } = await openList();
    await tick(driver, () => driver.input.pressKey("TAB"));
    await tick(driver, () => driver.input.pressKey("RETURN"));
    await tick(driver, () => driver.input.pressKey("m"));
    expect(driver.captureFrame()).not.toContain("Enter confirms");
    await tick(driver, () => driver.input.pressKey("x"));
    expect(fixture.pullRequestActionsRun).toMatchObject([{ number: 7, action: "reopen" }]);
  });

  it("moves between summary, conversation, and code with Tab", async () => {
    const { driver } = await openList();
    await tick(driver, () => driver.input.pressKey("RETURN"));
    await tick(driver, () => driver.input.pressKey("TAB"));
    expect(driver.captureFrame()).toContain("Looks close.");
    expect(driver.captureFrame()).toContain("abcdef1 Add the index");
    await tick(driver, () => driver.input.pressKey("TAB"));
    expect(driver.captureFrame()).toContain("+const a = 2;");
    await tick(driver, () => driver.input.pressKey("TAB"));
    expect(driver.captureFrame()).toContain("search index");
  });

  it("submits a review, and a verdict other than approve needs a message", async () => {
    const { driver, fixture } = await openList();
    await tick(driver, () => driver.input.pressKey("RETURN"));
    await tick(driver, () => driver.input.pressKey("r"));
    await tick(driver, () => driver.input.pressKey("TAB"));
    expect(driver.captureFrame()).toContain("Request changes");
    await tick(driver, () => driver.input.pressKey("RETURN"));
    expect(fixture.pullRequestReviews).toEqual([]);
    expect(driver.captureFrame()).toContain("Request changes needs a message.");

    await driver.input.typeText("Please split this.");
    await driver.flush();
    await tick(driver, () => driver.input.pressKey("RETURN"));
    expect(fixture.pullRequestReviews).toMatchObject([
      { number: 42, verdict: "request-changes", body: "Please split this.", comments: [] },
    ]);
    expect(driver.captureFrame()).toContain("Review submitted.");
  });

  it("carries line notes from the code view into the review", async () => {
    const { driver, fixture } = await openList();
    await tick(driver, () => driver.input.pressKey("RETURN"));
    await tick(driver, () => driver.input.pressKey("TAB"));
    await tick(driver, () => driver.input.pressKey("TAB"));
    // The file header takes no note, so N does nothing until the cursor reaches code.
    await tick(driver, () => driver.input.pressKey("n"));
    expect(driver.captureFrame()).not.toContain("Comment on this line");
    for (let index = 0; index < 5; index += 1)
      await tick(driver, () => driver.input.pressKey("ARROW_DOWN"));
    await tick(driver, () => driver.input.pressKey("n"));
    await driver.input.typeText("Why two?");
    await driver.flush();
    await tick(driver, () => driver.input.pressKey("RETURN"));
    expect(driver.captureFrame()).toContain("1 note for your review");

    await tick(driver, () => driver.input.pressKey("r"));
    await tick(driver, () => driver.input.pressKey("RETURN"));
    expect(fixture.pullRequestReviews).toMatchObject([
      {
        verdict: "approve",
        comments: [{ path: "src/a.ts", position: { kind: "added", newLine: 1 }, body: "Why two?" }],
      },
    ]);
  });

  it("draws no terminal control characters from a pull request's code", async () => {
    const { driver } = await openList(UNSAFE_DIFF);
    await tick(driver, () => driver.input.pressKey("RETURN"));
    await tick(driver, () => driver.input.pressKey("TAB"));
    await tick(driver, () => driver.input.pressKey("TAB"));
    expectSanitizedDiff(driver.captureRawFrame());
  });

  const addNote = async (driver: TuiTestDriver, body: string) => {
    await tick(driver, () => driver.input.pressKey("TAB"));
    await tick(driver, () => driver.input.pressKey("TAB"));
    for (let index = 0; index < 5; index += 1)
      await tick(driver, () => driver.input.pressKey("ARROW_DOWN"));
    await tick(driver, () => driver.input.pressKey("n"));
    await driver.input.typeText(body);
    await driver.flush();
    await tick(driver, () => driver.input.pressKey("RETURN"));
  };

  it("keeps each pull request's notes while moving through a stack", async () => {
    const { driver, fixture } = await openList();
    await tick(driver, () => driver.input.pressKey("RETURN"));
    await addNote(driver, "First layer.");
    expect(driver.captureFrame()).toContain("1 note for your review");

    await tick(driver, () => driver.input.pressKey("]"));
    expect(driver.captureFrame()).toContain("Stack 2 of 2");
    expect(driver.captureFrame()).not.toContain("for your review");
    await addNote(driver, "Second layer.");
    expect(driver.captureFrame()).toContain("1 note for your review");

    await tick(driver, () => driver.input.pressKey("["));
    expect(driver.captureFrame()).toContain("Stack 1 of 2");
    expect(driver.captureFrame()).toContain("1 note for your review");

    await tick(driver, () => driver.input.pressKey("r"));
    await tick(driver, () => driver.input.pressKey("RETURN"));
    expect(fixture.pullRequestReviews).toMatchObject([
      { number: 42, comments: [{ body: "First layer." }] },
    ]);
    expect(driver.captureFrame()).not.toContain("for your review");

    // Submitting one layer's review leaves the other layer's notes alone.
    await tick(driver, () => driver.input.pressKey("]"));
    await tick(driver, () => driver.input.pressKey("r"));
    await tick(driver, () => driver.input.pressKey("RETURN"));
    expect(fixture.pullRequestReviews[1]).toMatchObject({
      number: 43,
      comments: [{ body: "Second layer." }],
    });
  });

  it("asks before Esc discards notes, and keeps them unless told otherwise", async () => {
    const { driver, fixture } = await openList();
    await tick(driver, () => driver.input.pressKey("RETURN"));
    await addNote(driver, "Keep me.");

    await tick(driver, () => driver.input.pressKey("ESCAPE"));
    expect(driver.captureFrame()).toContain("Discard 1 note on #42? Enter discards, Esc keeps.");
    expect(driver.captureFrame()).toContain("feature-42 into main");

    await tick(driver, () => driver.input.pressKey("ESCAPE"));
    expect(driver.captureFrame()).toContain("1 note for your review");
    expect(driver.captureFrame()).toContain("feature-42 into main");

    await tick(driver, () => driver.input.pressKey("r"));
    await tick(driver, () => driver.input.pressKey("ESCAPE"));
    await tick(driver, () => driver.input.pressKey("ESCAPE"));
    await tick(driver, () => driver.input.pressKey("RETURN"));
    expect(driver.captureFrame()).toContain("#43 Tidy the header");
    expect(driver.captureFrame()).not.toContain("feature-42 into main");

    await tick(driver, () => driver.input.pressKey("RETURN"));
    expect(driver.captureFrame()).not.toContain("for your review");
    await tick(driver, () => driver.input.pressKey("r"));
    await tick(driver, () => driver.input.pressKey("RETURN"));
    expect(fixture.pullRequestReviews).toMatchObject([{ number: 42, comments: [] }]);
  });

  it("names every layer with notes when Esc would discard them", async () => {
    const { driver } = await openList();
    await tick(driver, () => driver.input.pressKey("RETURN"));
    await addNote(driver, "First layer.");
    await tick(driver, () => driver.input.pressKey("]"));
    await tick(driver, () => driver.input.pressKey("ESCAPE"));
    expect(driver.captureFrame()).toContain("Discard 1 note on #42? Enter discards, Esc keeps.");
    await tick(driver, () => driver.input.pressKey("ESCAPE"));
    await addNote(driver, "Second layer.");
    await tick(driver, () => driver.input.pressKey("ESCAPE"));
    expect(driver.captureFrame()).toContain(
      "Discard 2 notes on #42, #43? Enter discards, Esc keeps.",
    );
  });

  it("goes straight back to the list when there are no notes", async () => {
    const { driver } = await openList();
    await tick(driver, () => driver.input.pressKey("RETURN"));
    await tick(driver, () => driver.input.pressKey("ESCAPE"));
    expect(driver.captureFrame()).toContain("#43 Tidy the header");
    expect(driver.captureFrame()).not.toContain("Discard");
  });

  it("moves through a stack with the bracket keys", async () => {
    const { driver, fixture } = await openList();
    await tick(driver, () => driver.input.pressKey("RETURN"));
    expect(driver.captureFrame()).toContain("Stack 1 of 2");
    await tick(driver, () => driver.input.pressKey("["));
    expect(driver.captureFrame()).toContain("#42");
    await tick(driver, () => driver.input.pressKey("]"));
    expect(driver.captureFrame()).toContain("#43");
    expect(driver.captureFrame()).toContain("Stack 2 of 2");
    expect(driver.captureFrame()).toContain("feature-43 into main");
    await tick(driver, () => driver.input.pressKey("t"));
    expect(fixture.pullRequestThreads).toEqual([43]);
  });

  it("starts a thread on the pull request", async () => {
    const { driver, fixture } = await openList();
    await tick(driver, () => driver.input.pressKey("RETURN"));
    await tick(driver, () => driver.input.pressKey("t"));
    expect(fixture.pullRequestThreads).toEqual([42]);
    expect(driver.captureFrame()).not.toContain("feature-42 into main");
  });

  it("says so on a server without pull requests", async () => {
    const fixture = makeClientFixture();
    const { pullRequests: _pullRequests, ...client } = fixture.client;
    const driver = await createTuiTestDriver(<AppShell client={client} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await tick(driver, () => driver.input.pressKey("k", { ctrl: true }));
    await driver.input.typeText("pull requests list");
    await tick(driver, () => driver.input.pressKey("RETURN"));
    expect(driver.captureFrame()).toContain("Pull requests need a newer T3 Code server.");
  });
});

describe("git panel", () => {
  const clean = {
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    aheadCount: 2,
  };
  async function setupGit(status: Partial<VcsStatusResult> = {}) {
    const fixture = makeClientFixture();
    Object.assign(fixture.gitStatus.current, status);
    const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await step(driver, "n", { ctrl: true });
    return { driver, fixture };
  }
  const step = async (
    driver: TuiTestDriver,
    ...args: Parameters<TuiTestDriver["input"]["pressKey"]>
  ) => {
    await act(async () => {
      await driver.input.pressKey(...args);
      await new Promise((resolve) => setImmediate(resolve));
    });
    await driver.flush();
  };
  const moveTo = async (driver: TuiTestDriver, label: string) => {
    for (let index = 0; index < 8 && !driver.captureFrame().includes(`> ${label}`); index += 1)
      await step(driver, "ARROW_DOWN");
    expect(driver.captureFrame()).toContain(`> ${label}`);
  };

  it("commits with a typed message and reports the result", async () => {
    const { driver, fixture } = await setupGit();
    expect(driver.captureFrame()).toContain("feature · 1 file changed");
    await step(driver, "RETURN");
    expect(driver.captureFrame()).toContain("leave empty to have one written");
    await driver.input.typeText("Fix the header");
    await driver.flush();
    await step(driver, "RETURN");
    expect(fixture.gitRuns.at(-1)?.input).toEqual({
      action: "commit",
      commitMessage: "Fix the header",
    });
    expect(driver.captureFrame()).toContain("Done");
  });

  it("paints its rows before the status arrives, and they cannot run yet", async () => {
    const fixture = makeClientFixture();
    const pending = Promise.withResolvers<VcsStatusResult>();
    const git = { ...fixture.client.git!, status: () => pending.promise };
    const driver = await createTuiTestDriver(<AppShell client={{ ...fixture.client, git }} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await step(driver, "n", { ctrl: true });
    expect(driver.captureFrame()).toContain("> Commit");
    expect(driver.captureFrame()).toContain("Reading the Git status...");
    const rowOfCommit = () =>
      driver
        .captureFrame()
        .split("\n")
        .findIndex((line) => line.includes("> Commit"));
    const row = rowOfCommit();
    await step(driver, "RETURN");
    expect(fixture.gitRuns).toEqual([]);
    expect(driver.captureFrame()).not.toContain("leave empty");

    await act(async () => {
      pending.resolve(fixture.gitStatus.current);
      await pending.promise;
    });
    await driver.flush();
    expect(driver.captureFrame()).toContain("feature · 1 file changed");
    expect(rowOfCommit()).toBe(row);
  });

  it("explains a disabled action instead of running it", async () => {
    const { driver, fixture } = await setupGit();
    await moveTo(driver, "Push");
    expect(driver.captureFrame()).toContain("Commit or stash local changes before pushing.");
    await step(driver, "RETURN");
    expect(fixture.gitRuns).toEqual([]);
  });

  it("creates a PR without a message step and offers to copy its URL", async () => {
    const { driver, fixture } = await setupGit(clean);
    await moveTo(driver, "Create PR");
    await step(driver, "RETURN");
    expect(fixture.gitRuns.at(-1)?.input).toEqual({ action: "create_pr" });
    expect(driver.captureFrame()).toMatch(/C\s+Copy URL/u);
  });

  it("stops before publishing from the default branch, and Enter alone cancels", async () => {
    const { driver, fixture } = await setupGit({ ...clean, isDefaultRef: true });
    await moveTo(driver, "Push");
    await step(driver, "RETURN");
    expect(driver.captureFrame()).toContain("Push to default branch?");
    await step(driver, "RETURN");
    expect(fixture.gitRuns).toEqual([]);

    await step(driver, "RETURN");
    await step(driver, "ARROW_DOWN");
    await step(driver, "RETURN");
    expect(fixture.gitRuns.at(-1)?.input).toEqual({ action: "push", featureBranch: true });
  });

  it("shows a failure and stays open", async () => {
    const { driver, fixture } = await setupGit(clean);
    fixture.gitFailure.current = "The remote rejected the push.";
    await moveTo(driver, "Push");
    await step(driver, "RETURN");
    expect(driver.captureFrame()).toContain("The remote rejected the push.");
    expect(driver.captureFrame()).toContain("> Push");
  });

  it("shows the running stage and refuses another action until it ends", async () => {
    const { driver, fixture } = await setupGit(clean);
    await act(async () =>
      driver.registry.update(fixture.gitActionState, (state) => ({
        ...state,
        isRunning: true,
        currentLabel: "Pushing to origin",
        hookName: "pre-push",
      })),
    );
    await driver.flush();
    expect(driver.captureFrame()).toContain("Pushing to origin · pre-push");
    await moveTo(driver, "Push");
    await step(driver, "RETURN");
    expect(fixture.gitRuns).toEqual([]);
    await step(driver, "ESCAPE");
    expect(driver.captureFrame()).toContain("Pushing to origin");
  });

  it("pulls", async () => {
    const { driver, fixture } = await setupGit(clean);
    await moveTo(driver, "Pull");
    await step(driver, "RETURN");
    expect(fixture.gitPulls.current).toBe(1);
    expect(driver.captureFrame()).toContain("Pulled into feature.");
  });

  it("switches branches and records the new one on the thread", async () => {
    const { driver, fixture } = await setupGit(clean);
    await moveTo(driver, "Switch branch...");
    await step(driver, "RETURN");
    expect(driver.captureFrame()).toContain("Switch branch");
    await driver.input.typeText("main");
    await driver.flush();
    await step(driver, "RETURN");
    expect(fixture.gitSwitches).toEqual(["main"]);
    expect(fixture.managementCommands.at(-1)).toMatchObject({
      type: "thread.meta.update",
      branch: "main",
    });
  });

  it("creates a branch from a name that matches nothing", async () => {
    const { driver, fixture } = await setupGit(clean);
    await moveTo(driver, "Switch branch...");
    await step(driver, "RETURN");
    await driver.input.typeText("brand-new");
    await driver.flush();
    expect(driver.captureFrame()).toContain("Create branch brand-new");
    await step(driver, "RETURN");
    expect(fixture.gitCreates).toEqual(["brand-new"]);
  });

  it("will not switch to a branch held by another worktree", async () => {
    const { driver, fixture } = await setupGit(clean);
    await moveTo(driver, "Switch branch...");
    await step(driver, "RETURN");
    await driver.input.typeText("taken");
    await driver.flush();
    await step(driver, "RETURN");
    expect(fixture.gitSwitches).toEqual([]);
    expect(driver.captureFrame()).toContain("taken is checked out in /elsewhere.");
  });

  it("says so on a server without git actions", async () => {
    const fixture = makeClientFixture();
    const { git: _git, ...client } = fixture.client;
    const driver = await createTuiTestDriver(<AppShell client={client} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await step(driver, "n", { ctrl: true });
    expect(driver.captureFrame()).toContain("Git actions need a newer T3 Code server.");
  });
});

describe("proposed plan", () => {
  const MARKDOWN = "# Add search\n\n- Index the projects\n- Add the filter\n";
  const PLAN = { id: PlanId.make("plan-1"), markdown: MARKDOWN, status: "active" as const };

  async function setupPlan(plan: { readonly status: "active" | "completed" } = PLAN) {
    const fixture = makeDesignFixture();
    const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await act(async () =>
      updateThread(driver.registry, fixture, 0, (thread) => ({
        ...thread,
        proposedPlan: { ...PLAN, ...plan },
      })),
    );
    await driver.flush();
    return { driver, fixture };
  }
  const press = async (
    driver: TuiTestDriver,
    ...args: Parameters<TuiTestDriver["input"]["pressKey"]>
  ) => {
    await act(async () => {
      await driver.input.pressKey(...args);
      await new Promise((resolve) => setImmediate(resolve));
    });
    await driver.flush();
  };

  it("offers a ready plan and implements it in this thread", async () => {
    const { driver, fixture } = await setupPlan();
    expect(driver.captureFrame()).toContain("Plan ready: Ctrl+L to review");
    await press(driver, "l", { ctrl: true });
    expect(driver.captureFrame()).toContain("Proposed plan");
    expect(driver.captureFrame()).toContain("Index the projects");

    await press(driver, "RETURN");
    expect(driver.captureFrame()).not.toContain("Index the projects");
    expect(fixture.commands.at(-1)).toMatchObject({
      type: "thread.turn.start",
      interactionMode: "default",
      sourceProposedPlan: { threadId: fixture.threads[0]!.id, planId: "plan-1" },
      message: { text: `PLEASE IMPLEMENT THIS PLAN:\n${MARKDOWN.trim()}` },
    });
  });

  it("implements in a new thread that keeps the source's checkout and opens it", async () => {
    const { driver, fixture } = await setupPlan();
    await press(driver, "l", { ctrl: true });
    await press(driver, "n");
    const [create, start] = fixture.planThreadStarts;
    expect(create).toMatchObject({
      type: "thread.create",
      title: "Implement Add search",
      projectId: fixture.threads[0]!.projectId,
      branch: fixture.threads[0]!.branch,
      worktreePath: fixture.threads[0]!.worktreePath,
    });
    expect(start).toMatchObject({
      type: "thread.turn.start",
      threadId: (create as { threadId: string }).threadId,
      sourceProposedPlan: { planId: "plan-1" },
    });
  });

  it("saves to a path the user can change, and Esc cancels", async () => {
    const { driver, fixture } = await setupPlan();
    await press(driver, "l", { ctrl: true });
    await press(driver, "s");
    expect(driver.captureFrame()).toContain("add-search.md");
    await press(driver, "ESCAPE");
    expect(driver.captureFrame()).toContain("Proposed plan");
    expect(fixture.writtenFiles).toEqual([]);

    await press(driver, "s");
    await press(driver, "RETURN");
    expect(fixture.writtenFiles).toEqual([
      {
        cwd: expect.any(String),
        relativePath: "add-search.md",
        contents: MARKDOWN,
      },
    ]);
    expect(driver.captureFrame()).toContain("Saved to add-search.md.");
  });

  it("refines by returning to the composer in plan mode", async () => {
    const { driver, fixture } = await setupPlan();
    await press(driver, "l", { ctrl: true });
    await press(driver, "r");
    expect(driver.captureFrame()).not.toContain("Index the projects");
    const thread = fixture.threads[0]!;
    expect(driver.registry.get(fixture.client.actions.state(thread.id)).interactionMode).toBe(
      "plan",
    );
    await driver.input.typeText("smaller");
    await driver.flush();
    expect(driver.registry.get(fixture.client.actions.state(thread.id)).draft).toBe("smaller");
  });

  it("shows an implemented plan without offering to run it again", async () => {
    const { driver, fixture } = await setupPlan({ status: "completed" });
    expect(driver.captureFrame()).not.toContain("Plan ready");
    await press(driver, "l", { ctrl: true });
    expect(driver.captureFrame()).toContain("Already implemented.");
    const sent = fixture.commands.length;
    await press(driver, "RETURN");
    await press(driver, "n");
    expect(fixture.commands.length).toBe(sent);
    expect(fixture.planThreadStarts).toEqual([]);
  });

  it("does nothing while the thread has no plan", async () => {
    const fixture = makeDesignFixture();
    const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await press(driver, "l", { ctrl: true });
    expect(driver.captureFrame()).not.toContain("Proposed plan");
  });
});

describe("inbox sidebar", () => {
  const CAPABILITIES = {
    repositoryIdentity: true,
    threadSettlement: true,
    threadSnooze: true,
    threadPinning: true,
    threadPinReorder: true,
    threadVisitedTracking: true,
  };

  async function setupInbox() {
    const fixture = makeDesignFixture();
    const client = { ...fixture.client, threadCapabilities: Atom.make(CAPABILITIES) };
    const driver = await createTuiTestDriver(<AppShell client={client} searchDebounceMs={0} />, {
      width: 120,
      height: 40,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("inbox sidebar");
    await driver.input.pressKey("RETURN");
    return { driver, fixture };
  }

  it("turns on from Ctrl+K, lists threads across projects, and turns back off", async () => {
    const { driver } = await setupInbox();
    expect(driver.captureFrame()).toContain("[All projects");
    expect(driver.captureFrame()).toContain("> Add project search");
    expect(driver.captureFrame()).toContain("  Improve onboarding copy");
    expect(driver.captureFrame()).not.toContain("Projects (2)");
    expect(rowOf(driver, "thread-0")).toBeDefined();
    expect(rowOf(driver, "thread-2")).toBeDefined();

    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("inbox sidebar");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Projects (2)");
  });

  const filterTo = async (driver: TuiTestDriver, title: string) => {
    await driver.input.pressKey("f");
    await driver.input.typeText(title);
    await driver.input.pressKey("RETURN");
    await driver.flush();
  };

  it("offers a row back to all projects while filtered to one", async () => {
    const { driver } = await setupInbox();
    expect(rowOf(driver, "all-projects")).toBeUndefined();

    await filterTo(driver, "Atlas");
    expect(driver.captureFrame()).toContain("[Atlas");
    expect(rowOf(driver, "all-projects")).toBeDefined();
    // Filtering leaves the cursor on a thread, so Enter does not undo what was just chosen.
    expect(driver.captureFrame()).toContain("  ← All projects");
    expect(driver.captureFrame()).toContain("> Add project search");

    await driver.input.pressKey("ARROW_UP");
    await driver.flush();
    expect(driver.captureFrame()).toContain("> ← All projects");
    expect(driver.captureFrame()).toContain("Enter shows all projects.");

    await driver.input.pressKey("RETURN");
    await driver.flush();
    expect(driver.captureFrame()).toContain("[All projects");
    expect(rowOf(driver, "all-projects")).toBeUndefined();
    expect(rowOf(driver, "thread-2")).toBeDefined();
  });

  it("reaches the row with Alt+Up from a conversation, and Alt+Down returns", async () => {
    const { driver } = await setupInbox();
    await filterTo(driver, "Atlas");
    await driver.input.pressKey("RETURN");
    await driver.flush();
    // Plain arrows belong to the conversation.
    await driver.input.pressKey("ARROW_UP");
    await driver.flush();
    expect(driver.captureFrame()).not.toContain("> ← All projects");

    await driver.input.pressKey("ARROW_UP", { meta: true });
    await driver.flush();
    expect(driver.captureFrame()).toContain("> ← All projects");
    expect(driver.captureFrame()).toContain("Enter shows all projects.");

    await driver.input.pressKey("ARROW_DOWN", { meta: true });
    await driver.flush();
    expect(driver.captureFrame()).toContain("  ← All projects");
    expect(driver.captureFrame()).toContain("> Add project search");

    await driver.input.pressKey("ARROW_UP", { meta: true });
    await driver.input.pressKey("RETURN");
    await driver.flush();
    expect(driver.captureFrame()).toContain("[All projects");
  });

  it("still wraps with Alt+Up when no project is filtered", async () => {
    const { driver } = await setupInbox();
    await driver.input.pressKey("RETURN");
    await driver.flush();
    await driver.input.pressKey("ARROW_UP", { meta: true });
    await driver.flush();
    expect(driver.captureFrame()).not.toContain("> Add project search");
    expect(rowOf(driver, "all-projects")).toBeUndefined();
  });

  it("goes back to all projects when the row is clicked", async () => {
    const { driver } = await setupInbox();
    await filterTo(driver, "Atlas");
    const row = rowOf(driver, "all-projects")!;
    await driver.mouse.click(row.screenX + 2, row.screenY, MouseButtons.LEFT, { delayMs: 0 });
    await driver.flush();
    expect(driver.captureFrame()).toContain("[All projects");
    expect(rowOf(driver, "all-projects")).toBeUndefined();
  });

  it("keeps the way out and the reason on a project with no threads", async () => {
    const { driver, fixture } = await setupInbox();
    await filterTo(driver, "Atlas");
    const atlas = fixture.threads[0]!.projectId;
    await act(async () =>
      driver.registry.update(fixture.shell, (state) => ({
        ...state,
        snapshot: Option.map(state.snapshot, (snapshot) => ({
          ...snapshot,
          threads: snapshot.threads.filter((thread) => thread.projectId !== atlas),
        })),
      })),
    );
    await driver.flush();
    expect(driver.captureFrame()).toContain("← All projects");
    expect(driver.captureFrame()).toContain("No threads in Atlas yet.");

    await driver.input.pressKey("RETURN");
    await driver.flush();
    expect(driver.captureFrame()).toContain("[All projects");
    expect(driver.captureFrame()).not.toContain("No threads in Atlas yet.");
  });

  it("settles from the keyboard, keeps the cursor in place, and Ctrl+Z undoes it", async () => {
    const { driver, fixture } = await setupInbox();
    const first = fixture.threads[0]!;
    const row = () => driver.renderer.root.findDescendantById(`navigation-${first.id}`);
    expect(row()).toBeDefined();
    await act(async () => {
      await driver.input.pressKey("x");
      await new Promise((resolve) => setImmediate(resolve));
    });
    await driver.flush();
    expect(row()).toBeUndefined();
    expect(driver.captureFrame()).toContain("Settled (1)");
    expect(driver.captureFrame()).toContain("Ctrl+Z undoes");

    await act(async () => {
      await driver.input.pressKey("z", { ctrl: true });
      await new Promise((resolve) => setImmediate(resolve));
    });
    await driver.flush();
    expect(row()).toBeDefined();
  });

  it("pins and marks unread from the keyboard", async () => {
    const { driver, fixture } = await setupInbox();
    const first = fixture.threads[0]!;
    const pinnedAt = () =>
      Option.getOrThrow(driver.registry.get(fixture.client.shell).snapshot).threads.find(
        (thread) => thread.id === first.id,
      )?.pinnedAt;
    expect(pinnedAt() ?? null).toBeNull();
    await act(async () => {
      await driver.input.pressKey("p", { shift: true });
      await new Promise((resolve) => setImmediate(resolve));
    });
    await driver.flush();
    expect(pinnedAt()).toEqual(expect.any(String));

    await act(async () => {
      await driver.input.pressKey("u", { shift: true });
      await new Promise((resolve) => setImmediate(resolve));
    });
    await driver.flush();
    expect(fixture.managementCommands.at(-1)).toMatchObject({
      type: "thread.mark-unread",
      threadId: first.id,
    });
  });

  it("steps and jumps between threads with Alt", async () => {
    const { driver, fixture } = await setupInbox();
    const conversationTitle = (index: number) => fixture.threads[index]!.title;
    await driver.input.pressKey("2", { meta: true });
    await driver.flush();
    expect(driver.captureFrame()).toContain(`> ${conversationTitle(1)}`);
    await driver.input.pressKey("ARROW_UP", { meta: true });
    await driver.flush();
    expect(driver.captureFrame()).toContain(`> ${conversationTitle(0)}`);
    await driver.input.pressKey("ARROW_DOWN", { meta: true });
    await driver.flush();
    expect(driver.captureFrame()).toContain(`> ${conversationTitle(1)}`);
  });

  it("selects threads with Space, settles them together, and undoes them together", async () => {
    const { driver } = await setupInbox();
    await driver.input.pressKey(" ");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey(" ");
    expect(driver.captureFrame()).toContain("2 selected");
    await act(async () => {
      await driver.input.pressKey("x");
      await new Promise((resolve) => setImmediate(resolve));
    });
    await driver.flush();
    expect(driver.captureFrame()).toContain("Settled (2)");
    expect(driver.captureFrame()).toContain("Settled 2 threads");
    expect(driver.captureFrame()).not.toContain("selected");
    await act(async () => {
      await driver.input.pressKey("z", { ctrl: true });
      await new Promise((resolve) => setImmediate(resolve));
    });
    await driver.flush();
    expect(driver.captureFrame()).toContain("Settled (0)");
  });

  it("clears the selection with Esc before anything else", async () => {
    const { driver } = await setupInbox();
    await driver.input.pressKey(" ");
    expect(driver.captureFrame()).toContain("1 selected");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).not.toContain("selected");
  });

  it("snoozes from a typed time, and refuses one it cannot read", async () => {
    const { driver, fixture } = await setupInbox();
    await driver.input.pressKey("z");
    expect(driver.captureFrame()).toContain("Custom...");
    await driver.input.pressKey("ARROW_UP");
    await driver.input.pressKey("RETURN");
    await driver.input.typeText("soon");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Enter a future time");
    for (let index = 0; index < 4; index += 1) await driver.input.pressKey("BACKSPACE");
    await driver.input.typeText("2h");
    expect(driver.captureFrame()).toContain("Wakes ");
    await act(async () => {
      await driver.input.pressKey("RETURN");
      await new Promise((resolve) => setImmediate(resolve));
    });
    await driver.flush();
    expect(driver.captureFrame()).toContain("Snoozed (1)");
    expect(fixture.threads.find((item) => item.snoozedUntil)).toBeDefined();
  });

  it("asks before deleting a selection, and Enter alone cancels", async () => {
    const { driver } = await setupInbox();
    await driver.input.pressKey(" ");
    await driver.input.typeText("m");
    expect(driver.captureFrame()).toContain("Delete (1)...");
    await driver.input.pressKey("ARROW_UP");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Delete 1 thread");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("1 selected");
    expect(rowOf(driver, "thread-0")).toBeDefined();
  });

  it("opens a shelf from its header with Enter", async () => {
    const { driver, fixture } = await setupInbox();
    const registry = driver.registry;
    updateShellThread(registry, fixture, 2, (thread) => ({
      ...thread,
      settledOverride: "settled",
      settledAt: "2026-03-02T15:01:00.000Z",
    }));
    await driver.flush();
    expect(rowOf(driver, "thread-2")).toBeUndefined();
    for (let index = 0; index < 5; index += 1) await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    expect(rowOf(driver, "thread-2")).toBeDefined();
  });
});
