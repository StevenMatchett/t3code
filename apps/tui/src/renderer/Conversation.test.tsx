import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  EventId,
  TurnId,
  type OrchestrationThreadActivity,
  type UploadChatImageAttachment,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { act } from "react";
import { TextAttributes } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { AppShell } from "./AppShell.tsx";

const drivers = new Set<TuiTestDriver>();
afterEach(async () => {
  await Promise.all([...drivers].map((driver) => driver.close()));
  drivers.clear();
});
async function setup(
  kittyKeyboard = true,
  dispatch?: Parameters<typeof makeClientFixture>[0],
  loadImageAttachment?: (path: string) => Promise<UploadChatImageAttachment>,
) {
  const fixture = makeClientFixture(dispatch, loadImageAttachment);
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
  it("shows a timer while the session starts before a turn is projected", async () => {
    const { driver, fixture, id } = await setup();
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    await act(async () =>
      driver.registry.set(fixture.states[0]!, {
        ...driver.registry.get(fixture.states[0]!),
        data: Option.some({
          ...fixture.details[0]!,
          session: {
            threadId: id,
            status: "starting" as const,
            providerName: null,
            runtimeMode: "full-access" as const,
            activeTurnId: null,
            lastError: null,
            updatedAt: startedAt,
          },
        }),
      }),
    );
    await driver.flush();
    expect(
      driver
        .captureRawFrame()
        .split("\n")
        .find((line) => line.includes("[D Changes]")),
    ).toMatch(/Starting\s+1m \d+s/);
    await driver.resize(44, 28);
    expect(
      driver
        .captureRawFrame()
        .split("\n")
        .find((line) => line.includes("[D Changes]")),
    ).toMatch(/Starting\s+1m \d+s/);
  });

  it("shows live turn time and the local finish time after completion", async () => {
    const { driver, fixture } = await setup();
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    const completedAt = new Date(Date.now() - 5_000).toISOString();
    const turn = {
      turnId: TurnId.make("timed-turn"),
      state: "running" as const,
      requestedAt: startedAt,
      startedAt,
      completedAt: null,
      assistantMessageId: null,
    };
    await act(async () =>
      driver.registry.set(fixture.states[0]!, {
        ...driver.registry.get(fixture.states[0]!),
        data: Option.some({ ...fixture.details[0]!, latestTurn: turn }),
      }),
    );
    await driver.flush();
    const statusRow = () =>
      driver
        .captureRawFrame()
        .split("\n")
        .find((line) => line.includes("[D Changes]"));
    expect(statusRow()).toMatch(/Working\s+1m (4|5)s/);

    await act(async () =>
      driver.registry.set(fixture.states[0]!, {
        ...driver.registry.get(fixture.states[0]!),
        data: Option.some({
          ...fixture.details[0]!,
          latestTurn: { ...turn, state: "completed" as const, completedAt },
        }),
      }),
    );
    await driver.flush();
    const localTime = new Date(completedAt).toLocaleTimeString(undefined, { timeStyle: "short" });
    expect(statusRow()).toContain(`Took 1m 0s · Finished ${localTime}`);
  });

  it("shows only Local or Worktree immediately before Changes above the composer", async () => {
    const { driver, fixture } = await setup();
    const statusRow = () =>
      driver
        .captureRawFrame()
        .split("\n")
        .find((line) => line.includes("[D Changes]"));
    expect(statusRow()).toContain("Local  [D Changes]");
    await act(async () =>
      driver.registry.set(fixture.states[0]!, {
        ...driver.registry.get(fixture.states[0]!),
        data: Option.some({ ...fixture.details[0]!, worktreePath: "/tmp/wt" }),
      }),
    );
    await driver.flush();
    expect(statusRow()).toContain("Worktree  [D Changes]");
    expect(driver.captureRawFrame()).not.toContain("/tmp/wt");
    expect(statusRow()).not.toContain("Local");
    expect(
      driver
        .captureRawFrame()
        .split("\n")
        .filter((line) => line.includes("Worktree")),
    ).toHaveLength(1);
    const label = driver.renderer.root.findDescendantById("thread-workspace-label")!;
    const changes = driver.renderer.root.findDescendantById("thread-diff-action")!;
    expect(label.screenY).toBe(changes.screenY);
    expect(label.screenX).toBeLessThan(changes.screenX);
    expect(label.height).toBe(1);
  });

  it("expands grouped tools by mouse and toggles all details with T", async () => {
    const { driver, fixture } = await setup();
    const activities: OrchestrationThreadActivity[] = ["first", "second", "third"].map((name) => ({
      id: EventId.make(name),
      kind: "tool.completed",
      tone: "tool",
      summary: `echo ${name}`,
      payload: { command: `echo ${name}`, toolCallId: name, status: "completed" },
      turnId: null,
      createdAt: fixture.details[0]!.createdAt,
    }));
    await act(async () =>
      driver.registry.set(fixture.states[0]!, {
        ...driver.registry.get(fixture.states[0]!),
        data: Option.some({ ...fixture.details[0]!, messages: [], activities }),
      }),
    );
    await driver.flush();
    expect(driver.captureFrame()).toContain("3 tool calls");
    expect(driver.captureFrame()).not.toContain("echo first");
    const clickGroup = async () => {
      const lines = driver.captureRawFrame().split("\n");
      const y = lines.findIndex((line) => line.includes("3 tool calls"));
      expect(y).toBeGreaterThanOrEqual(0);
      await driver.mouse.click(lines[y]!.indexOf("3 tool calls"), y, MouseButtons.LEFT, {
        delayMs: 0,
      });
    };
    await clickGroup();
    expect(driver.captureFrame()).toContain("echo first");
    await clickGroup();
    expect(driver.captureFrame()).not.toContain("echo first");
    await driver.input.pressKey("t");
    expect(driver.captureFrame()).toContain("echo first");
    await driver.input.pressKey("t");
    expect(driver.captureFrame()).not.toContain("echo first");
  });

  it("searches output, navigates matches, and closes without changing the draft", async () => {
    const { driver, fixture, id } = await setup();
    await driver.input.pressKey("i");
    await driver.input.typeText("saved draft");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("/");
    expect(driver.renderer.root.findDescendantById("thread-search-input")).toBeDefined();
    await driver.input.typeText("visible line 1");
    expect(driver.captureFrame()).toContain("1/11");
    expect(driver.captureFrame()).toContain("Visible line 1");
    expect(
      driver
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .some(
          (span) =>
            span.text === "Visible line 1" && (span.attributes & TextAttributes.INVERSE) !== 0,
        ),
    ).toBe(true);
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("2/11");
    await driver.input.pressKey("RETURN", { shift: true });
    expect(driver.captureFrame()).toContain("1/11");
    await driver.input.typeText("missing");
    expect(driver.captureFrame()).toContain("No matches");
    await driver.input.pressKey("ESCAPE");
    expect(driver.renderer.root.findDescendantById("thread-search-input")).toBeUndefined();
    expect(driver.captureFrame()).toContain("CONVERSATION");
    expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe("saved draft");
    expect(fixture.commands).toHaveLength(0);
  });
  it("focuses inline questions, preserves the chat draft, and keeps answers when returning to history", async () => {
    const { driver, fixture, id } = await setup();
    await driver.input.pressKey("i");
    await driver.input.typeText("Keep this draft");
    const requestId = ApprovalRequestId.make("inline-choice");
    await request(driver, fixture, "user-input.requested", {
      requestId,
      questions: [
        {
          id: "theme",
          header: "Theme",
          question: "Which theme?",
          multiSelect: false,
          allowCustomAnswer: false,
          options: [{ label: "Dark", value: "dark", description: "Dark theme" }],
        },
      ],
    });
    expect(driver.captureFrame()).toContain("QUESTION");
    expect(driver.captureFrame()).toContain("Keep this draft");
    expect(driver.renderer.root.findDescendantById("conversation-history")).toBeDefined();
    const panel = driver.renderer.root.findDescendantById("inline-question")!;
    const composer = driver.renderer.root.findDescendantById("conversation-composer")!;
    expect(panel.screenY + panel.height).toBeLessThanOrEqual(composer.screenY);
    await driver.input.pressKey("RETURN");
    expect(fixture.commands).toHaveLength(0);
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("CONVERSATION");
    await driver.input.pressKey("a");
    expect(driver.captureFrame()).toContain("[x] Dark");
    await driver.input.pressKey("RETURN");
    expect(fixture.commands).toHaveLength(1);
    expect(fixture.commands[0]).toMatchObject({
      type: "thread.user-input.respond",
      requestId,
      answers: { theme: "dark" },
    });
    expect(driver.renderer.root.findDescendantById("inline-question")).toBeUndefined();
    expect(driver.captureFrame()).toContain("MESSAGE");
    expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe("Keep this draft");
  });

  it("routes long pasted answers into the inline question rather than the chat draft", async () => {
    const { driver, fixture, id } = await setup();
    await driver.resize(44, 24);
    const requestId = ApprovalRequestId.make("inline-text");
    await request(driver, fixture, "user-input.requested", {
      requestId,
      questions: [
        {
          id: "details",
          header: "Details",
          question: "What should change?",
          multiSelect: false,
          allowCustomAnswer: true,
          options: [],
        },
      ],
    });
    const answer = "Detailed answer. ".repeat(20).trim();
    await driver.input.paste(answer);
    expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe("");
    await driver.input.pressKey("RETURN");
    expect(fixture.commands).toHaveLength(0);
    await driver.input.pressKey("RETURN");
    expect(fixture.commands[0]).toMatchObject({
      type: "thread.user-input.respond",
      answers: { details: answer },
    });
  });

  it("defers question focus until the active terminal is closed", async () => {
    const { driver, fixture } = await setup();
    await driver.input.pressKey("t", { ctrl: true });
    await request(driver, fixture, "user-input.requested", {
      requestId: ApprovalRequestId.make("terminal-question"),
      questions: [
        {
          id: "choice",
          header: "Choice",
          question: "Continue?",
          multiSelect: false,
          allowCustomAnswer: false,
          options: [{ label: "Yes", value: "yes", description: "Continue" }],
        },
      ],
    });
    expect(driver.captureFrame()).toContain("[term-1]");
    expect(driver.renderer.root.findDescendantById("inline-question")).toBeUndefined();
    await driver.input.typeText("echo test");
    expect(fixture.terminalWrites.join("")).toContain("echo test");
    await driver.input.pressKey("\\", { ctrl: true });
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("QUESTION");
    expect(driver.captureFrame()).toContain("Continue?");
    expect(fixture.commands).toHaveLength(0);
  });
  it.each(["kitty", "ghostty", "escape-return"])(
    "inserts a newline with Shift+Enter (%s) and sends only on Enter",
    async (input) => {
      const { driver, fixture, id } = await setup();
      await driver.input.pressKey("i");
      await driver.input.typeText("first");
      if (input !== "kitty") {
        await act(async () => {
          driver.renderer.stdin.emit(
            "data",
            Buffer.from(input === "ghostty" ? "\x1b[13;2u" : "\x1b\r"),
          );
        });
        await driver.flush();
      } else {
        await driver.input.pressKey("RETURN", { shift: true });
      }
      await driver.input.typeText("second");
      expect(fixture.commands).toHaveLength(0);
      expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe("first\nsecond");
      expect(driver.captureFrame()).toContain("Shift+Enter");
      await driver.input.pressKey("RETURN");
      expect(fixture.commands).toHaveLength(1);
      expect(fixture.commands[0]).toMatchObject({
        type: "thread.turn.start",
        message: { text: "first\nsecond" },
      });
    },
  );

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

  it("turns a dropped image path into a visible attachment and sends it", async () => {
    const image = {
      type: "image" as const,
      id: "dropped-image",
      name: "screen shot.png",
      mimeType: "image/png",
      sizeBytes: 4,
      dataUrl: "data:image/png;base64,iVBORw==",
    };
    const { driver, fixture, id } = await setup(true, undefined, async (path) => {
      expect(path).toBe("/tmp/screen shot.png");
      return image;
    });

    await driver.input.paste("/tmp/screen\\ shot.png");
    await driver.flush();

    expect(driver.captureFrame()).toContain("[Image #1]");
    expect(driver.registry.get(fixture.client.actions.state(id)).attachments).toEqual([image]);
    await driver.input.pressKey("RETURN");
    expect(fixture.commands[0]).toMatchObject({
      type: "thread.turn.start",
      message: { text: "", attachments: [image] },
    });
  });

  it("recognizes an image path delivered as editor input instead of a paste event", async () => {
    const image = {
      type: "image" as const,
      id: "typed-drop-image",
      name: "screen shot.png",
      mimeType: "image/png",
      sizeBytes: 4,
      dataUrl: "data:image/png;base64,iVBORw==",
    };
    const { driver, fixture, id } = await setup(true, undefined, async () => image);

    await driver.input.pressKey("RETURN");
    await driver.input.typeText("/tmp/screen\\ shot.png");
    await driver.flush();

    expect(driver.captureFrame()).toContain("[Image #1]");
    expect(driver.registry.get(fixture.client.actions.state(id))).toMatchObject({
      draft: "",
      attachments: [image],
    });
  });

  it("shows clipboard text over 200 characters as a marker but sends its full text", async () => {
    const { driver, fixture, id } = await setup();
    const paste = "long paste ".repeat(21);

    await driver.input.paste(paste);

    expect(driver.captureFrame()).toContain(`[paste ${paste.length} characters]`);
    expect(driver.registry.get(fixture.client.actions.state(id)).draft).toBe(
      `[paste ${paste.length} characters]`,
    );
    await driver.input.pressKey("RETURN");
    expect(fixture.commands[0]).toMatchObject({
      type: "thread.turn.start",
      message: { text: paste },
    });
  });

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
    expect(driver.renderer.root.findDescendantById("conversation-history")).toBeDefined();
    expect(driver.renderer.root.findDescendantById("inline-question")).toBeDefined();
    await driver.input.pressKey(" ");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey(" ");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Question 2/2");
    expect(driver.captureFrame()).toContain("Type your answer");
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

  it("opens a fill-in answer directly from an option question with E", async () => {
    const { driver, fixture } = await setup();
    const requestId = ApprovalRequestId.make("option-or-custom");
    await request(driver, fixture, "user-input.requested", {
      requestId,
      questions: [
        {
          id: "direction",
          header: "Direction",
          question: "Which direction?",
          multiSelect: false,
          allowCustomAnswer: true,
          options: [
            { label: "Left", value: "left", description: "Go left" },
            { label: "Right", value: "right", description: "Go right" },
          ],
        },
      ],
    });

    expect(driver.captureFrame()).toContain("E type answer");
    await driver.input.pressKey("e");
    await driver.input.typeText("Straight ahead");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");

    expect(fixture.commands[0]).toMatchObject({
      type: "thread.user-input.respond",
      requestId,
      answers: { direction: "Straight ahead" },
    });
  });

  it("offers quick replies for a numbered choice list sent as a normal assistant message", async () => {
    const { driver, fixture, id } = await setup();
    const thread = fixture.details[0]!;
    await act(async () =>
      driver.registry.set(fixture.states[0]!, {
        ...driver.registry.get(fixture.states[0]!),
        data: Option.some({
          ...thread,
          messages: [
            {
              ...thread.messages[0]!,
              text: "Which theme do you prefer?\n\n1. Dark\n2. Light\n3. System default",
            },
          ],
        }),
      }),
    );
    await driver.flush();

    expect(driver.captureFrame()).toContain("[ Dark ]");
    expect(driver.captureFrame()).toContain("[ Light ]");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");

    expect(fixture.commands[0]).toMatchObject({
      type: "thread.turn.start",
      threadId: id,
      message: { text: "Light" },
    });
  });
});
