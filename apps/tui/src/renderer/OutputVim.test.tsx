import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { EventId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { act } from "react";
import { parseColor, TextAttributes } from "@opentui/core";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { defaultTheme } from "../ui/theme.ts";
import { AppShell } from "./AppShell.tsx";

const drivers = new Set<TuiTestDriver>();
afterEach(async () => {
  await Promise.all([...drivers].map((driver) => driver.close()));
  drivers.clear();
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
