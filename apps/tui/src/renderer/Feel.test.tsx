import { afterEach, describe, expect, it } from "@effect/vitest";
import { MouseButtons } from "@opentui/core/testing";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { act } from "react";
import type { ConversationView, TuiSessionState } from "../persistence/sessionState.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import {
  assistantMessage,
  designAgents,
  designApproval,
  longTranscript,
  makeDesignFixture,
  runningTurn,
  updateThread,
  type DesignFixture,
} from "../testing/designFixture.ts";
import { conversationLines, conversationLineStats } from "../ui/conversationLines.ts";
import { projectRecordedThreadTimeline } from "../features/chat/timeline.ts";
import { calculateShellLayout } from "../ui/layout.ts";
import { AppShell } from "./AppShell.tsx";

const PAGE_UP = "\u001b[5~";

/** Just enough session state for a thread to remember its view. */
function makeMemorySession() {
  const conversations = new Map<string, ConversationView>();
  return {
    error: Atom.make<string | null>(null),
    soundsEnabled: true,
    saveSoundsEnabled: () => undefined,
    favoriteModels: () => [],
    saveFavoriteModels: () => undefined,
    themePreference: () => "auto" as const,
    saveThemePreference: () => undefined,
    shell: undefined,
    interactions: new Map(),
    saveShell: () => undefined,
    saveInteraction: () => undefined,
    conversation: (id: string) => conversations.get(id),
    saveConversation: (id: string, view: ConversationView) => {
      conversations.set(id, view);
    },
    composer: () => undefined,
    saveComposer: () => undefined,
    terminal: () => undefined,
    saveTerminal: () => undefined,
    sidebarLayout: () => "tree",
    saveSidebarLayout: () => undefined,
    close: () => undefined,
  } satisfies TuiSessionState;
}
const drivers: TuiTestDriver[] = [];
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((driver) => driver.close()));
});

async function setup(width = 100, height = 30) {
  const fixture = makeDesignFixture();
  const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
    width,
    height,
    kittyKeyboard: true,
  });
  drivers.push(driver);
  const releases = fixture.states.map((state) => driver.registry.mount(state));
  const update = async (index: number, change: Parameters<typeof updateThread>[3]) => {
    await act(async () => updateThread(driver.registry, fixture, index, change));
    await driver.flush();
  };
  return { driver, fixture, update, releases };
}

const openThread = async (driver: TuiTestDriver) => {
  await driver.input.pressKey("RETURN");
  await driver.input.pressKey("RETURN");
};

function composerTop(driver: TuiTestDriver) {
  return driver.renderer.root.findDescendantById("conversation-composer")!.screenY;
}

function statusRow(driver: TuiTestDriver) {
  return driver.renderer.root.findDescendantById("conversation-activity")!.screenY;
}

async function setRequests(
  update: Awaited<ReturnType<typeof setup>>["update"],
  requests: ReturnType<typeof designApproval>,
) {
  await update(0, (thread) => ({ ...thread, requests }));
}

describe("layout stability", () => {
  it("never moves the composer when status, find, queue, errors, or agents appear", async () => {
    const { driver, fixture, update } = await setup();
    await openThread(driver);
    const top = composerTop(driver);
    const status = statusRow(driver);
    const stable = () => {
      expect(composerTop(driver)).toBe(top);
      expect(statusRow(driver)).toBe(status);
    };

    await update(0, (thread) => ({ ...thread, latestTurn: runningTurn }));
    stable();
    await update(0, (thread) => ({ ...thread, agents: designAgents() }));
    stable();
    await update(0, (thread) => ({ ...thread, agents: [] }));
    await driver.input.pressKey("/");
    await driver.input.typeText("search");
    stable();
    await driver.input.pressKey("ESCAPE");
    stable();

    await driver.input.pressKey("i");
    await driver.input.typeText("queued text");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Queued (1)");
    stable();
    await driver.input.pressKey("u", { ctrl: true });
    stable();
    await act(async () => fixture.client.actions.setDraft(driver.registry, fixture.first.id, ""));
    await driver.flush();
    await driver.input.pressKey("RETURN");
    await driver.flush();
    stable();
  });

  it("keeps the row above the status line reserved, so a notice moves no transcript text", async () => {
    const { driver, update } = await setup();
    await update(0, (thread) => ({ ...thread, messages: longTranscript(40) }));
    await openThread(driver);
    await driver.input.pressKey(PAGE_UP);
    const before = driver.captureFrame().split("\n");
    await driver.input.pressKey("/");
    const after = driver.captureFrame().split("\n");
    const transcriptEnd = statusRow(driver) - 1;
    // Everything above the reserved row is unchanged, apart from the hints and the row itself.
    expect(after.slice(0, transcriptEnd)).toEqual(before.slice(0, transcriptEnd));
    expect(after[transcriptEnd]).toContain("Find:");
  });

  it("shows hints on the same two rows whichever region has focus", async () => {
    const { driver } = await setup(80, 24);
    const hintsTop = () => driver.renderer.root.findDescendantById("active-hotkeys")!.screenY;
    const top = hintsTop();
    await openThread(driver);
    expect(hintsTop()).toBe(top);
    await driver.input.pressKey("i");
    expect(hintsTop()).toBe(top);
    await driver.input.pressKey("k", { ctrl: true });
    expect(hintsTop()).toBe(top);
    await driver.input.pressKey("ESCAPE");
    expect(hintsTop()).toBe(top);
  });

  it("keeps the sidebar selection on the same row while metadata updates arrive", async () => {
    const { driver, fixture } = await setup(120, 40);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("ARROW_DOWN");
    const row = () => driver.renderer.root.findDescendantById("navigation-thread-1")!.screenY;
    const before = row();
    await act(async () =>
      driver.registry.update(fixture.shell, (shell) => ({
        ...shell,
        snapshot: Option.map(shell.snapshot, (snapshot) => ({
          ...snapshot,
          threads: snapshot.threads.map((thread) => ({
            ...thread,
            updatedAt: "2026-06-01T00:00:00.000Z",
          })),
        })),
      })),
    );
    await driver.flush();
    expect(row()).toBe(before);
    expect(driver.captureFrame()).toContain("> Improve onboarding copy");
  });

  it("keeps every approval option visible at 80x24", async () => {
    const { driver, update } = await setup(80, 24);
    await openThread(driver);
    await setRequests(update, designApproval());
    const frame = driver.captureFrame();
    for (const option of ["Cancel", "Decline", "Allow for this session", "Approve once"])
      expect(frame).toContain(option);
    expect(frame).toContain("Run: pnpm test");
  });
});

describe("honest labels", () => {
  it("stops asking for a response as soon as one is sent", async () => {
    const { driver, update } = await setup(80, 24);
    await openThread(driver);
    await update(0, (thread) => ({ ...thread, latestTurn: runningTurn }));
    await setRequests(update, designApproval());
    expect(driver.captureFrame()).toContain("Approval needed");
    await driver.input.pressKey("RETURN");
    await driver.flush();
    const frame = driver.captureFrame();
    expect(frame).toContain("Response sent.");
    expect(frame).not.toContain("A: respond to requests");
    expect(frame).not.toContain("Approval needed");
  });

  it("shows the whole breadcrumb at 80 columns by dropping header buttons", async () => {
    const fixture = makeDesignFixture();
    const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
      width: 80,
      height: 24,
    });
    drivers.push(driver);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    const header = driver.captureFrame().split("\n")[0]!;
    expect(header).toContain("Atlas › Add project search");
    expect(header).toContain("Connected");
  });

  it("gives the breadcrumb priority over the environment label", async () => {
    const { driver } = await setup(120, 40);
    await openThread(driver);
    expect(driver.captureFrame().split("\n")[0]).toContain("Atlas › Add project search");
    await driver.resize(200, 60);
    const wide = driver.captureFrame().split("\n")[0]!;
    expect(wide).toContain("Atlas › Add project search");
    expect(wide).toContain("Local workspace");
  });

  it.each([60, 80, 104])("keeps the connection status readable at width %i", async (width) => {
    const { driver } = await setup(width, 24);
    await openThread(driver);
    expect(driver.captureFrame().split("\n")[0]).toContain("Connected");
  });
});

describe("scroll anchoring", () => {
  it("does not move what you are reading when output arrives, and End returns to live", async () => {
    const { driver, update } = await setup();
    await update(0, (thread) => ({ ...thread, messages: longTranscript(60) }));
    await openThread(driver);
    await driver.input.pressKey(PAGE_UP);
    await driver.input.pressKey(PAGE_UP);
    const history = () => {
      const lines = driver.captureFrame().split("\n");
      const box = driver.renderer.root.findDescendantById("conversation-history")!;
      return lines.slice(box.screenY, box.screenY + box.height).join("\n");
    };
    const reading = history();
    expect(reading).not.toContain("Reply 58");

    await update(0, (thread) => ({
      ...thread,
      messages: [...thread.messages, assistantMessage("late", "Late output arrives")],
    }));
    expect(history()).toBe(reading);
    expect(driver.captureFrame()).toMatch(/\d+ below/);
    expect(driver.captureFrame()).toContain("History / End: live");

    await driver.input.pressKey("END");
    expect(history()).toContain("Late output arrives");
    expect(driver.captureFrame()).not.toContain("End: live");
  });

  it("releases follow on the first wheel step and resumes it at the bottom", async () => {
    const { driver, update } = await setup();
    await update(0, (thread) => ({ ...thread, messages: longTranscript(60) }));
    await openThread(driver);
    const box = driver.renderer.root.findDescendantById("conversation-history")!;
    await driver.mouse.scroll(box.screenX + 2, box.screenY + 2, "up", { delayMs: 0 });
    expect(driver.captureFrame()).toContain("End: live");
    await update(0, (thread) => ({
      ...thread,
      messages: [...thread.messages, assistantMessage("late-2", "Not yet on screen")],
    }));
    expect(driver.captureFrame()).not.toContain("Not yet on screen");
    for (let step = 0; step < 4; step += 1)
      await driver.mouse.scroll(box.screenX + 2, box.screenY + 2, "down", { delayMs: 0 });
    expect(driver.captureFrame()).toContain("Not yet on screen");
  });

  it("keeps the same content in view across a resize", async () => {
    const { driver, update } = await setup();
    await update(0, (thread) => ({ ...thread, messages: longTranscript(60) }));
    await openThread(driver);
    await driver.input.pressKey(PAGE_UP);
    await driver.input.pressKey(PAGE_UP);
    const topMessage = () => {
      const lines = driver.captureFrame().split("\n");
      const box = driver.renderer.root.findDescendantById("conversation-history")!;
      const visible = lines.slice(box.screenY, box.screenY + box.height).join(" ");
      return [...visible.matchAll(/(?:Prompt|Reply) (\d+)/gu)].map((match) => Number(match[1]));
    };
    const before = topMessage()[0]!;
    await driver.resize(70, 30);
    expect(Math.abs(topMessage()[0]! - before)).toBeLessThanOrEqual(2);
    await driver.resize(140, 40);
    expect(Math.abs(topMessage()[0]! - before)).toBeLessThanOrEqual(2);
  });

  it("restores the scroll position when leaving a thread and coming back", async () => {
    const session = makeMemorySession();
    const fixture = makeDesignFixture(session);
    const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
      width: 100,
      height: 30,
      kittyKeyboard: true,
    });
    drivers.push(driver);
    driver.registry.mount(fixture.states[0]!);
    await act(async () =>
      updateThread(driver.registry, fixture, 0, (thread) => ({
        ...thread,
        messages: longTranscript(60),
      })),
    );
    await openThread(driver);
    await driver.input.pressKey(PAGE_UP);
    await driver.input.pressKey(PAGE_UP);
    const history = () => {
      const lines = driver.captureFrame().split("\n");
      const box = driver.renderer.root.findDescendantById("conversation-history")!;
      return lines.slice(box.screenY, box.screenY + box.height).join("\n");
    };
    const reading = history();
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("reply-1");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("ARROW_UP");
    await driver.input.pressKey("RETURN");
    expect(history()).toBe(reading);
  });
});

describe("focus restoration", () => {
  it("returns focus and selection to exactly where they were when an overlay closes", async () => {
    const { driver, fixture } = await setup();
    await openThread(driver);
    await driver.input.pressKey("i");
    await driver.input.typeText("half written");
    await driver.input.pressKey("k", { ctrl: true });
    expect(driver.captureFrame()).toContain("Search and commands");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("MESSAGE");
    await driver.input.typeText(" draft");
    expect(driver.registry.get(fixture.client.actions.state(fixture.first.id)).draft).toBe(
      "half written draft",
    );
  });

  it("goes back exactly one level from a stacked overlay", async () => {
    const { driver } = await setup();
    await openThread(driver);
    await driver.input.pressKey("d");
    expect(driver.captureFrame()).toContain("Thread changes");
    await driver.input.pressKey("ARROW_DOWN");
    const diff = driver.captureFrame();
    await driver.input.pressKey("k", { ctrl: true });
    expect(driver.captureFrame()).toContain("Search and commands");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toBe(diff);
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("CONVERSATION");
  });

  it("keeps the sidebar selection when a dialog opens and closes over it", async () => {
    const { driver } = await setup(120, 40);
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("ARROW_DOWN");
    const before = driver.captureFrame();
    await driver.input.pressKey("m");
    expect(driver.captureFrame()).toContain("Manage thread");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toBe(before);
  });

  it("never loses a draft to Esc", async () => {
    const { driver, fixture } = await setup();
    await openThread(driver);
    await driver.input.pressKey("i");
    await driver.input.typeText("keep me");
    for (let level = 0; level < 4; level += 1) await driver.input.pressKey("ESCAPE");
    expect(driver.registry.get(fixture.client.actions.state(fixture.first.id)).draft).toBe(
      "keep me",
    );
  });

  it("opens the palette from every layer", async () => {
    const { driver } = await setup();
    const openAndClose = async () => {
      await driver.input.pressKey("k", { ctrl: true });
      expect(driver.captureFrame()).toContain("Search and commands");
      await driver.input.pressKey("ESCAPE");
    };
    await openAndClose();
    await openThread(driver);
    await openAndClose();
    await driver.input.pressKey("i");
    await openAndClose();
    await driver.input.pressKey("ESCAPE");
    await driver.input.typeText("?");
    await openAndClose();
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("n");
    expect(driver.captureFrame()).toContain("New thread in");
    await openAndClose();
    expect(driver.captureFrame()).toContain("New thread in");
  });
});

describe("no flicker", () => {
  it("shows cached content on the first frame after switching threads", async () => {
    const { driver } = await setup();
    await openThread(driver);
    expect(driver.captureFrame()).toContain("search docs");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("reply-1");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("ARROW_UP");
    // The first frame back already has the transcript, with no blank or loading frame between.
    await driver.input.pressKey("RETURN");
    const first = driver.captureRawFrame();
    expect(first).toContain("search docs");
    expect(first).not.toContain("Loading");
  });

  it("never renders a blank frame through a thread switch or overlay", async () => {
    const { driver } = await setup();
    const nonBlank = () => {
      const lines = driver
        .captureRawFrame()
        .split("\n")
        .filter((line) => line.trim().length > 0);
      expect(lines.length).toBeGreaterThan(10);
    };
    nonBlank();
    await openThread(driver);
    nonBlank();
    await driver.input.pressKey("k", { ctrl: true });
    nonBlank();
    await driver.input.pressKey("ESCAPE");
    nonBlank();
    await driver.input.pressKey("d");
    nonBlank();
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("ESCAPE");
    nonBlank();
  });

  it("does not flash a loading message for work that finishes quickly", async () => {
    const { driver, fixture } = await setup();
    await act(async () =>
      driver.registry.update(fixture.shell, (shell) => ({
        ...shell,
        snapshot: Option.none(),
        status: "empty" as const,
      })),
    );
    await driver.flush();
    expect(driver.captureFrame()).not.toContain("Loading your workspace");
  });
});

describe("streaming cost", () => {
  it("re-renders only the changed row, however long the thread is", () => {
    const messages = longTranscript(2_000);
    const thread = { messages, activities: [] };
    const render = (input: typeof thread) =>
      conversationLines(projectRecordedThreadTimeline(input), 80, false);
    const first = render(thread);
    expect(first.length).toBeGreaterThan(2_000);
    const before = conversationLineStats.rowsRendered;
    const next = render({
      ...thread,
      messages: [...messages, assistantMessage("streaming", "Fresh text", true)],
    });
    expect(next.length).toBeGreaterThan(first.length);
    expect(conversationLineStats.rowsRendered - before).toBe(1);
  });
});

describe("interaction details", () => {
  it("clicks a sidebar row through the same action as the keyboard", async () => {
    const { driver } = await setup(120, 40);
    const beta = driver.renderer.root.findDescendantById("navigation-beta")!;
    await driver.mouse.click(beta.screenX + 2, beta.screenY, MouseButtons.LEFT, { delayMs: 0 });
    expect(driver.captureFrame()).toContain("Threads (1) - Design system");
  });

  it("explains itself below the minimum size", async () => {
    const { driver } = await setup();
    await driver.resize(24, 6);
    expect(driver.captureFrame()).toContain("Terminal too small");
    await driver.resize(80, 24);
    expect(driver.captureFrame()).not.toContain("Terminal too small");
  });

  it("gives up the row under the header on short terminals", () => {
    expect(calculateShellLayout(80, 24).headerGap).toBe(0);
    expect(calculateShellLayout(120, 40).headerGap).toBe(1);
  });
});
