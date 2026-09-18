import { afterEach, describe, expect, it } from "@effect/vitest";
import { ApprovalRequestId, EventId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { act } from "react";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { AppShell } from "./AppShell.tsx";

const drivers = new Set<TuiTestDriver>();
afterEach(async () => {
  await Promise.all([...drivers].map((driver) => driver.close()));
  drivers.clear();
});
async function setup(kittyKeyboard = true, dispatch?: Parameters<typeof makeClientFixture>[0]) {
  const fixture = makeClientFixture(dispatch);
  const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
    width: 96,
    height: 28,
    kittyKeyboard,
  });
  drivers.add(driver);
  await driver.input.pressKey("RETURN");
  await driver.input.pressKey("RETURN");
  return { fixture, driver, id: fixture.details[0]!.id };
}
async function request(
  driver: TuiTestDriver,
  fixture: ReturnType<typeof makeClientFixture>,
  kind: string,
  payload: Record<string, unknown>,
) {
  const activity: OrchestrationThreadActivity = {
    id: EventId.make("pending-request"),
    kind,
    tone: "approval",
    summary: "Needs a response",
    payload,
    turnId: null,
    createdAt: fixture.details[0]!.createdAt,
  };
  await act(async () =>
    driver.registry.set(fixture.states[0]!, {
      ...driver.registry.get(fixture.states[0]!),
      data: Option.some({ ...fixture.details[0]!, activities: [activity] }),
    }),
  );
  await driver.flush();
}

describe("conversation interaction", () => {
  it.each([false, true])(
    "owns editing keys and submits multiline pasted prompts only on Enter (kitty=%s)",
    async (kittyKeyboard) => {
      const { driver, fixture, id } = await setup(kittyKeyboard);
      await driver.input.pressKey("RETURN");
      await driver.input.typeText("r? text");
      await driver.input.pressKey("ARROW_LEFT");
      await driver.input.typeText("!");
      await driver.input.paste("\nnext line");
      expect(fixture.commands).toHaveLength(0);
      expect(driver.captureFrame()).not.toContain("Keyboard help");
      const draft = driver.registry.get(fixture.client.actions.state(id)).draft;
      expect(draft).toContain("r?");
      expect(draft).toContain("\nnext line");
      await driver.input.pressKey("RETURN");
      expect(fixture.commands).toHaveLength(1);
      expect(fixture.commands[0]).toMatchObject({
        type: "thread.turn.start",
        threadId: id,
        message: { text: draft },
      });
      expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe("");
    },
  );

  it.each([false, true])(
    "inserts a newline with Ctrl+J without sending (kitty=%s)",
    async (kitty) => {
      const { driver, fixture, id } = await setup(kitty);
      await driver.input.pressKey("i");
      await driver.input.typeText("first");
      await driver.input.pressKey("j", { ctrl: true });
      await driver.input.typeText("second");
      expect(fixture.commands).toHaveLength(0);
      expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe("first\nsecond");
    },
  );

  it("shows tool calls by default and keeps reasoning chatter behind expand", async () => {
    const { driver, fixture } = await setup();
    await request(driver, fixture, "tool.completed", {
      itemType: "command_execution",
      toolCallId: "tool-1",
      status: "completed",
    });
    await driver.input.pressKey("HOME");
    expect(driver.captureFrame()).toContain("Needs a response");
    expect(driver.captureFrame()).toContain("completed");
    await driver.input.pressKey("i");
    await driver.input.typeText("t is prompt text");
    expect(driver.registry.get(fixture.client.actions.state(fixture.details[0]!.id)).draft).toBe(
      "t is prompt text",
    );
  });

  it("keeps failed tool outcomes visible when routine activity is collapsed", async () => {
    const { driver, fixture } = await setup();
    await request(driver, fixture, "tool.completed", {
      itemType: "command_execution",
      toolCallId: "failed-tool",
      status: "failed",
    });
    await driver.input.pressKey("HOME");
    expect(driver.captureFrame()).toContain("Needs a response");
  });

  it("keeps failed drafts across navigation and resize and blocks duplicate sends", async () => {
    const response = Promise.withResolvers<boolean>();
    const { driver, fixture, id } = await setup(true, () => response.promise);
    await driver.input.pressKey("i");
    await driver.input.typeText("preserve this prompt");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    expect(fixture.commands).toHaveLength(1);
    await act(async () => {
      response.resolve(false);
      await response.promise;
    });
    await driver.flush();
    expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe(
      "preserve this prompt",
    );
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("i");
    await driver.resize(48, 24);
    expect(driver.captureFrame()).toContain("preserve this prompt");
  });

  it("requires explicit review and confirmation of provider-supplied approval options", async () => {
    const { driver, fixture } = await setup();
    const requestId = ApprovalRequestId.make("native-approval");
    await request(driver, fixture, "approval.requested", {
      requestId,
      requestKind: "file-read",
      detail: "Read the selected file",
      options: [
        { decision: "decline", label: "Reject" },
        { decision: "acceptAlways", label: "Always allow", warning: "Only if you trust this" },
        { decision: "accept", label: "Once" },
      ],
    });
    await driver.input.pressKey("a");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("ARROW_DOWN");
    expect(driver.captureFrame()).toContain("Only if you trust this");
    await driver.input.pressKey("RETURN");
    expect(fixture.commands).toHaveLength(0);
    expect(driver.captureFrame()).toContain("Confirm Always allow?");
    await driver.input.pressKey("RETURN");
    expect(fixture.commands[0]).toMatchObject({
      type: "thread.approval.respond",
      requestId,
      decision: "acceptAlways",
    });
    await driver.input.pressKey("RETURN");
    expect(fixture.commands).toHaveLength(1);
  });

  it("answers multiple questions with opaque option values and custom text", async () => {
    const { driver, fixture } = await setup();
    const requestId = ApprovalRequestId.make("native-questions");
    await request(driver, fixture, "user-input.requested", {
      requestId,
      questions: [
        {
          id: " ids ",
          header: "Choose",
          question: "Select both",
          multiSelect: true,
          allowCustomAnswer: false,
          options: [
            { label: "First", value: " opaque-1 ", description: "First option" },
            { label: "Second", value: "opaque-2", description: "Second option" },
          ],
        },
        {
          id: "explanation",
          header: "Explain",
          question: "Explain your choice",
          multiSelect: false,
          allowCustomAnswer: true,
          options: [],
        },
      ],
    });
    await driver.input.pressKey("a");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey(" ");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey(" ");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Question 2/2");
    await driver.input.pressKey("RETURN");
    await driver.input.typeText("Use both, please.");
    await driver.input.pressKey("RETURN");
    expect(fixture.commands).toHaveLength(0);
    await driver.input.pressKey("RETURN");
    expect(fixture.commands[0]).toMatchObject({
      type: "thread.user-input.respond",
      requestId,
      answers: { " ids ": [" opaque-1 ", "opaque-2"], explanation: "Use both, please." },
    });
  });
});
