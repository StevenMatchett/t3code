import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { EventId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { act } from "react";
import { parseColor, TextAttributes } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { defaultTheme } from "../ui/theme.ts";
import { AppShell } from "./AppShell.tsx";

import * as Browser from "../platform/browser.ts";

const drivers = new Set<TuiTestDriver>();
afterEach(async () => {
  await Promise.all([...drivers].map((driver) => driver.close()));
  drivers.clear();
  vi.restoreAllMocks();
});
async function setup(text?: string) {
  const fixture = makeClientFixture();
  const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
    width: 100,
    height: 32,
  });
  drivers.add(driver);
  await driver.input.pressKey("RETURN");
  await driver.input.pressKey("RETURN");
  if (text) {
    const thread = fixture.details[0]!;
    await act(async () =>
      driver.registry.set(fixture.states[0]!, {
        ...driver.registry.get(fixture.states[0]!),
        data: Option.some({ ...thread, messages: [{ ...thread.messages[0]!, text }] }),
      }),
    );
  }
  await driver.flush();
  const copy = vi.spyOn(driver.renderer, "copyToClipboardOSC52").mockReturnValue(true);
  return { driver, fixture, copy };
}

describe("Vim output navigation", () => {
  it("copies the right-clicked link without highlighting, including after wide characters", async () => {
    const { driver, copy } = await setup(
      "[First](https://example.com/first)\n👩‍💻 [Second](https://example.com/second?query=1#part)",
    );
    const frame = driver.captureFrame().split("\n");
    const row = frame.findIndex((line) => line.includes("Second"));
    // The emoji occupies two terminal cells even though it spans five UTF-16 units.
    await driver.mouse.click(6, row, MouseButtons.RIGHT, { delayMs: 0 });
    expect(driver.renderer.getSelection()).toBeNull();
    expect(driver.captureFrame()).toContain("Copy link");
    expect(driver.captureFrame()).toContain("Go to link");
    const item = driver.renderer.root.findDescendantById("output-link-menu-0")!;
    await driver.mouse.click(item.screenX + 1, item.screenY, MouseButtons.LEFT, { delayMs: 0 });
    expect(copy).toHaveBeenCalledExactlyOnceWith("https://example.com/second?query=1#part");
    expect(driver.renderer.root.findDescendantById("output-link-menu")).toBeUndefined();
    expect(driver.captureFrame()).toContain("Copied link");
  });

  it("opens the whole destination from a right-clicked wrapped URL", async () => {
    const url = "https://example.com/" + "a".repeat(110);
    const open = vi.spyOn(Browser, "openBrowser").mockResolvedValue(true);
    const { driver, copy } = await setup(url);
    const row = driver
      .captureFrame()
      .split("\n")
      .findIndex((line) => line.includes("https://"));
    await driver.mouse.click(4, row + 1, MouseButtons.RIGHT, { delayMs: 0 });
    expect(driver.captureFrame()).toContain("Copy link");
    await driver.input.pressKey("ARROW_DOWN");
    expect(driver.captureFrame()).toContain("> Go to link");
    await driver.input.pressKey("RETURN");
    expect(open).toHaveBeenCalledExactlyOnceWith(url);
    expect(copy).not.toHaveBeenCalled();
    expect(driver.renderer.root.findDescendantById("output-link-menu")).toBeUndefined();
  });

  it("dismisses the link menu with Escape or an outside click without executing an action", async () => {
    const open = vi.spyOn(Browser, "openBrowser").mockResolvedValue(true);
    const { driver, copy } = await setup("[Link](https://example.com)\nplain text");
    const row = driver
      .captureFrame()
      .split("\n")
      .findIndex((line) => line.includes("Link ("));
    await driver.mouse.click(3, row, MouseButtons.RIGHT, { delayMs: 0 });
    await driver.input.pressKey("ESCAPE");
    expect(driver.renderer.root.findDescendantById("output-link-menu")).toBeUndefined();
    expect(driver.renderer.root.findDescendantById("conversation-history")).toBeDefined();
    await driver.mouse.click(3, row, MouseButtons.RIGHT, { delayMs: 0 });
    await driver.mouse.click(90, row + 1, MouseButtons.LEFT, { delayMs: 0 });
    expect(driver.renderer.root.findDescendantById("output-link-menu")).toBeUndefined();
    await driver.mouse.click(3, row + 1, MouseButtons.RIGHT, { delayMs: 0 });
    expect(driver.renderer.root.findDescendantById("output-link-menu")).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it("keeps Enter in the link menu from submitting a focused draft", async () => {
    const { driver, fixture, copy } = await setup("[Link](https://example.com)");
    await driver.input.pressKey("RETURN");
    await driver.input.typeText("Do not send this draft");
    const row = driver
      .captureFrame()
      .split("\n")
      .findIndex((line) => line.includes("Link ("));
    await driver.mouse.click(3, row, MouseButtons.RIGHT, { delayMs: 0 });
    await driver.input.pressKey("RETURN");
    expect(copy).toHaveBeenCalledExactlyOnceWith("https://example.com");
    expect(fixture.commands).toHaveLength(0);
    expect(driver.registry.get(fixture.client.actions.state(fixture.details[0]!.id)).draft).toBe(
      "Do not send this draft",
    );
    await driver.input.typeText(" still editing");
    expect(driver.registry.get(fixture.client.actions.state(fixture.details[0]!.id)).draft).toBe(
      "Do not send this draft still editing",
    );
  });

  it("opens a mouse-highlighted label instead of the link under the Vim cursor", async () => {
    const open = vi.spyOn(Browser, "openBrowser").mockResolvedValue(true);
    const { driver } = await setup(
      "[First](https://example.com/first)\n👩‍💻 [Second](https://example.com/second)",
    );
    await driver.input.typeText("i");
    const frame = driver.captureFrame().split("\n");
    const row = frame.findIndex((line) => line.includes("Second"));
    await driver.mouse.drag(6, row, 7, row);
    expect(driver.renderer.getSelection()?.getSelectedText()).toContain("Se");
    await driver.input.pressKey("o", { shift: true });
    expect(open).toHaveBeenCalledExactlyOnceWith("https://example.com/second");
    await driver.input.typeText("gg");
    expect(driver.renderer.getSelection()).toBeNull();
    await driver.input.typeText("o");
    expect(open).toHaveBeenLastCalledWith("https://example.com/first");
  });

  it("opens the full URL from a mouse-selected wrapped fragment", async () => {
    const url = "https://example.com/" + "a".repeat(110);
    const open = vi.spyOn(Browser, "openBrowser").mockResolvedValue(true);
    const { driver } = await setup(url);
    const row = driver
      .captureFrame()
      .split("\n")
      .findIndex((line) => line.includes("https://"));
    await driver.mouse.drag(4, row + 1, 8, row + 1);
    expect(driver.renderer.getSelection()?.getSelectedText()).toBe("aaaaa");
    await driver.input.typeText("o");
    expect(open).toHaveBeenCalledExactlyOnceWith(url);
  });

  it("respects mouse selections with no link or multiple destinations", async () => {
    const open = vi.spyOn(Browser, "openBrowser").mockResolvedValue(true);
    const { driver } = await setup(
      "[One](https://example.com/1)\nplain text\n[Two](https://example.com/2)",
    );
    const row = driver
      .captureFrame()
      .split("\n")
      .findIndex((line) => line.includes("One ("));
    await driver.mouse.drag(3, row + 1, 7, row + 1);
    await driver.input.typeText("o");
    expect(driver.captureFrame()).toContain("No link selected");
    expect(open).not.toHaveBeenCalled();
    await driver.mouse.drag(3, row, 6, row + 2);
    await driver.input.typeText("o");
    expect(driver.captureFrame()).toContain("Select just one link");
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the link inside a visual selection with uppercase O and never falls back to a PR", async () => {
    const open = vi.spyOn(Browser, "openBrowser").mockResolvedValue(true);
    const { driver, fixture } = await setup("See [Example](https://example.com) here");
    const resolve = vi.spyOn(fixture.client, "resolvePullRequest");
    await driver.input.typeText("gg");
    await driver.input.pressKey("o", { shift: true });
    expect(driver.captureFrame()).toContain("No link selected");
    expect(resolve).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await driver.input.typeText("v");
    await driver.input.typeText("$");
    await driver.input.pressKey("o", { shift: true });
    expect(open).toHaveBeenCalledExactlyOnceWith("https://example.com");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("does not choose an arbitrary link when a selection contains two destinations", async () => {
    const open = vi.spyOn(Browser, "openBrowser").mockResolvedValue(true);
    const { driver } = await setup("[One](https://example.com/1) [Two](https://example.com/2)");
    await driver.input.typeText("ggv");
    await driver.input.typeText("$");
    await driver.input.typeText("o");
    expect(driver.captureFrame()).toContain("Select just one link");
    expect(open).not.toHaveBeenCalled();
  });

  it("identifies a link under the cursor and opens or copies its complete destination", async () => {
    const open = vi.spyOn(Browser, "openBrowser").mockResolvedValue(true);
    const { driver, copy } = await setup("👩‍💻 [Docs](https://example.com/docs) end");
    await driver.input.typeText("ggll");
    expect(driver.captureFrame()).toContain("o: open link");
    expect(
      driver
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .some(
          (span) => span.text.includes("ocs") && (span.attributes & TextAttributes.UNDERLINE) !== 0,
        ),
    ).toBe(true);
    await driver.input.typeText("o");
    expect(open).toHaveBeenCalledWith("https://example.com/docs");
    expect(driver.captureFrame()).toContain("Opened in browser");
    await driver.input.typeText("y");
    expect(copy).toHaveBeenLastCalledWith("https://example.com/docs");
    await driver.input.typeText("0");
    expect(driver.captureFrame()).not.toContain("o: open link");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("keeps wrapped URLs intact and reports unavailable or failing browsers", async () => {
    const url = "https://example.com/" + "a".repeat(110);
    const open = vi.spyOn(Browser, "openBrowser").mockResolvedValue(false);
    const { driver, copy } = await setup(url);
    await driver.input.typeText("ggjo");
    expect(open).toHaveBeenCalledWith(url);
    expect(driver.captureFrame()).toContain("Browser unavailable");
    await driver.input.typeText("y");
    expect(copy).toHaveBeenLastCalledWith(url);
    open.mockRejectedValueOnce(new Error("failed"));
    await driver.input.typeText("o");
    expect(driver.captureFrame()).toContain("Could not open browser");
  });

  it("shows the cursor immediately on entering output and returning from the composer", async () => {
    const { driver } = await setup();
    const cursors = () =>
      driver
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .filter(
          (span) =>
            span.bg.toInts().join() === parseColor(defaultTheme.text).toInts().join() &&
            span.fg.toInts().join() === parseColor(defaultTheme.panel).toInts().join(),
        );
    expect(cursors().some((span) => span.text === "V")).toBe(true);
    await driver.input.typeText("i");
    expect(cursors()).toHaveLength(0);
    await driver.input.pressKey("ESCAPE");
    expect(cursors().some((span) => span.text === "V")).toBe(true);
    await driver.input.typeText("v");
    await driver.input.pressKey("ESCAPE");
    expect(cursors().some((span) => span.text === "V")).toBe(true);
  });

  it("moves to a line, yanks with y/yy, and pastes without sending", async () => {
    const { driver, fixture, copy } = await setup();
    await driver.input.typeText("ggjyy");
    expect(copy).toHaveBeenLastCalledWith("Visible line 1\n");
    expect(driver.captureFrame()).toContain("Yanked to clipboard");
    await driver.input.typeText("p");
    expect(driver.registry.get(fixture.client.actions.state(fixture.details[0]!.id)).draft).toBe(
      "Visible line 1\n",
    );
    await driver.input.typeText("hello");
    expect(
      driver.registry.get(fixture.client.actions.state(fixture.details[0]!.id)).draft,
    ).toContain("hello");
  });

  it("highlights and yanks an inclusive visual selection in either direction", async () => {
    const { driver, copy } = await setup();
    await driver.input.typeText("ggvllllll");
    expect(driver.captureFrame()).toContain("VISUAL");
    expect(
      driver
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .some(
          (span) =>
            span.text.includes("Visible") &&
            (span.attributes & TextAttributes.INVERSE) === 0 &&
            span.fg.toInts().join() === parseColor(defaultTheme.panel).toInts().join() &&
            span.bg.toInts().join() === parseColor(defaultTheme.accent).toInts().join(),
        ),
    ).toBe(true);
    await driver.input.typeText("y");
    expect(copy).toHaveBeenLastCalledWith("Visible");
    await driver.input.typeText("vhhhhhhjy");
    expect(copy).toHaveBeenLastCalledWith("e line 0\nV");
  });

  it("selects whole lines with V and cancels selection before leaving history", async () => {
    const { driver, copy } = await setup();
    await driver.input.typeText("gg");
    await driver.input.pressKey("v", { shift: true });
    await driver.input.typeText("jy");
    expect(copy).toHaveBeenLastCalledWith("Visible line 0\nVisible line 1\n");
    await driver.input.typeText("v");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).not.toContain("VISUAL");
    expect(driver.captureFrame()).toContain("NORMAL");
    await driver.input.pressKey("END");
    expect(driver.captureFrame()).not.toContain("History / End: live");
  });

  it("moves by words and graphemes, and retains a local yank without clipboard support", async () => {
    const { driver, fixture, copy } = await setup("alpha beta\n👩‍💻 café 世界");
    copy.mockReturnValue(false);
    await driver.input.typeText("ggwvy");
    expect(copy).toHaveBeenLastCalledWith("b");
    await driver.input.typeText("bvy");
    expect(copy).toHaveBeenLastCalledWith("a");
    await driver.input.typeText("j0vy");
    expect(copy).toHaveBeenLastCalledWith("👩‍💻");
    expect(driver.captureFrame()).toContain("clipboard unavailable");
    await driver.input.typeText("p");
    expect(driver.registry.get(fixture.client.actions.state(fixture.details[0]!.id)).draft).toBe(
      "👩‍💻",
    );
  });

  it("keeps a selection anchored while output streams and accepts terminal paste", async () => {
    const { driver, fixture, copy } = await setup();
    await driver.input.typeText("ggvjj");
    const thread = fixture.details[0]!;
    await act(async () =>
      driver.registry.set(fixture.states[0]!, {
        ...driver.registry.get(fixture.states[0]!),
        data: Option.some({
          ...thread,
          messages: [
            {
              ...thread.messages[0]!,
              text: thread.messages[0]!.text + "\nNew streamed output",
              streaming: true,
            },
          ],
        }),
      }),
    );
    await driver.flush();
    await driver.input.typeText("y");
    expect(copy).toHaveBeenLastCalledWith("Visible line 0\nVisible line 1\nV");
    await driver.input.typeText("i");
    await driver.input.paste("External clipboard");
    expect(driver.registry.get(fixture.client.actions.state(thread.id)).draft).toBe(
      "External clipboard",
    );
  });

  it("selects agent output and pastes its yank into the conversation", async () => {
    const { driver, fixture, copy } = await setup();
    const thread = fixture.details[0]!;
    await act(async () =>
      driver.registry.set(fixture.states[0]!, {
        ...driver.registry.get(fixture.states[0]!),
        data: Option.some({
          ...thread,
          activities: [
            {
              id: EventId.make("agent-start"),
              kind: "task.started",
              tone: "info" as const,
              summary: "Researcher started",
              turnId: null,
              createdAt: thread.createdAt,
              payload: {
                taskId: "agent-one",
                taskType: "subagent",
                agentKind: "agent",
                title: "Researcher",
              },
            },
            {
              id: EventId.make("agent-tool"),
              kind: "tool.started",
              tone: "info" as const,
              summary: "Reading repository",
              turnId: null,
              createdAt: thread.createdAt,
              payload: {
                agentId: "agent-one",
                itemType: "commandExecution",
                toolCallId: "read-one",
                detail: "Inspecting repository",
              },
            },
          ],
        }),
      }),
    );
    await driver.flush();
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Agent: Researcher");
    await driver.input.typeText("ggvllllly");
    expect(copy.mock.lastCall?.[0].length).toBe(6);
    const yanked = copy.mock.lastCall?.[0];
    await driver.input.typeText("p");
    expect(driver.renderer.root.findDescendantById("agent-output-overlay")).toBeUndefined();
    expect(driver.registry.get(fixture.client.actions.state(thread.id)).draft).toBe(yanked);
  });

  it("scrolls with the cursor and supports G and half-page movement", async () => {
    const { driver, copy } = await setup();
    await driver.input.typeText("gg");
    await driver.input.pressKey("d", { ctrl: true });
    await driver.input.typeText("y");
    expect(copy.mock.lastCall?.[0]).toMatch(/^Visible line [1-9]\d*\n$/);
    await driver.input.pressKey("g", { shift: true });
    await driver.input.typeText("ky");
    expect(copy).toHaveBeenLastCalledWith("Visible line 59\n");
    expect(driver.captureFrame()).toContain("Visible line 59");
  });
});
