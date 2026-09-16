import {
  EventId,
  MessageId,
  TurnId,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { projectRecordedThreadTimeline, type TimelineActivityRow } from "./timeline.ts";

const baseTime = "2026-09-15T12:00:00.000Z";

function message(
  id: string,
  role: OrchestrationMessage["role"],
  overrides: Partial<Omit<OrchestrationMessage, "id" | "role">> = {},
): OrchestrationMessage {
  return {
    id: MessageId.make(id),
    role,
    text: `${role} ${id}`,
    turnId: TurnId.make("turn-1"),
    streaming: false,
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides,
  };
}

function activity(
  id: string,
  kind: string,
  overrides: Partial<Omit<OrchestrationThreadActivity, "id" | "kind">> = {},
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    kind,
    tone: "info",
    summary: kind,
    payload: {},
    turnId: TurnId.make("turn-1"),
    createdAt: baseTime,
    ...overrides,
  };
}

describe("projectRecordedThreadTimeline", () => {
  it("produces stable row identities and a total order independent of snapshot array order", () => {
    const user = message("user-1", "user");
    const assistant = message("assistant-1", "assistant");
    const tool = activity("tool-1", "tool.updated", {
      tone: "tool",
      sequence: 1,
      payload: { toolCallId: "call-1", status: "inProgress" },
    });
    const reasoning = activity("reasoning-1", "task.progress", {
      sequence: 2,
      summary: "Reviewing the change",
    });

    const forward = projectRecordedThreadTimeline({
      messages: [assistant, user],
      activities: [reasoning, tool],
    });
    const reversed = projectRecordedThreadTimeline({
      messages: [user, assistant],
      activities: [tool, reasoning],
    });

    expect(forward).toEqual(reversed);
    expect(forward.map((row) => row.id)).toEqual([
      "message:user-1",
      "activity:tool:turn-1:call-1",
      "activity:reasoning-1",
      "message:assistant-1",
    ]);
    expect(forward.map((row) => row.kind)).toEqual(["user", "tool", "reasoning", "assistant"]);
  });

  it("replays deterministically and deduplicates message, event, and tool lifecycle rows", () => {
    const partialMessage = message("assistant-1", "assistant", {
      text: "hel",
      streaming: true,
      updatedAt: "2026-09-15T12:00:01.000Z",
    });
    const completeMessage = message("assistant-1", "assistant", {
      text: "hello",
      streaming: false,
      updatedAt: "2026-09-15T12:00:02.000Z",
    });
    const started = activity("tool-update", "tool.updated", {
      tone: "tool",
      sequence: 10,
      summary: "Running command",
      payload: { toolCallId: "shell-1", status: "inProgress" },
    });
    const completed = activity("tool-complete", "tool.completed", {
      tone: "tool",
      sequence: 11,
      summary: "Ran command",
      payload: {
        toolCallId: "shell-1",
        status: "completed",
        data: { rawOutput: { stdout: "done" } },
      },
    });
    const recording = {
      messages: [partialMessage, completeMessage, completeMessage],
      activities: [started, completed, completed],
    };

    const first = projectRecordedThreadTimeline(recording);
    const replay = projectRecordedThreadTimeline(recording);

    expect(replay).toEqual(first);
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      id: "activity:tool:turn-1:shell-1",
      kind: "tool",
      sourceId: EventId.make("tool-complete"),
      status: "completed",
      detail: "done",
    });
    expect(first[1]).toMatchObject({
      id: "message:assistant-1",
      kind: "assistant",
      text: "hello",
      streaming: false,
    });
  });

  it("classifies normalized messages and activities without provider-specific payloads", () => {
    const rows = projectRecordedThreadTimeline({
      messages: [
        message("user-1", "user", { createdAt: "2026-09-15T12:00:00.000Z" }),
        message("assistant-1", "assistant", {
          createdAt: "2026-09-15T12:00:05.000Z",
        }),
      ],
      activities: [
        activity("reasoning-1", "task.progress", {
          createdAt: "2026-09-15T12:00:01.000Z",
          summary: "Checking types",
          payload: { detail: "Comparing the inferred types" },
        }),
        activity("tool-1", "item.updated", {
          createdAt: "2026-09-15T12:00:02.000Z",
          summary: "Running tests",
          payload: { itemType: "command_execution", status: "running" },
        }),
        activity("error-1", "runtime.error", {
          createdAt: "2026-09-15T12:00:03.000Z",
          tone: "error",
          summary: "Provider stopped",
          payload: { message: "The provider process exited" },
        }),
        activity("future-1", "future.activity", {
          createdAt: "2026-09-15T12:00:04.000Z",
          summary: "A newer server sent this",
          payload: { addedLater: true },
        }),
      ],
    });

    expect(rows.map((row) => row.kind)).toEqual([
      "user",
      "reasoning",
      "tool",
      "error",
      "activity",
      "assistant",
    ]);
    expect(rows[1]).toMatchObject({
      text: "Checking types",
      detail: "Comparing the inferred types",
    });
    expect(rows[2]).toMatchObject({ status: "inProgress" });
    expect(rows[3]).toMatchObject({ detail: "The provider process exited" });
    expect(rows[4]).toMatchObject({
      activityKind: "future.activity",
      text: "A newer server sent this",
    });
  });

  it("normalizes every display string before exposing hostile tool output", () => {
    const longLine = "x".repeat(200);
    const rows = projectRecordedThreadTimeline(
      {
        messages: [
          message("user-1", "user", {
            text: "\u001b]0;changed title\u0007Hello\u001b[31m red\u001b[0m\u0000",
          }),
        ],
        activities: [
          activity("tool-1", "tool.completed", {
            tone: "tool",
            createdAt: "2026-09-15T12:00:01.000Z",
            summary: "\u001b[2JRead output",
            payload: {
              toolCallId: "call-1",
              status: "completed",
              data: {
                rawOutput: {
                  stdout: `<b>literal markup</b> \ufffd\n${longLine}\u0007`,
                },
              },
            },
          }),
        ],
      },
      { maxLineLength: 32 },
    );

    expect(rows[0]).toMatchObject({ text: "Hello red" });
    const tool = rows[1] as TimelineActivityRow;
    expect(tool.text).toBe("Read output");
    expect(tool.detail?.split("\n")[0]).toBe("<b>literal markup</b> \ufffd");
    expect(tool.detail?.split("\n")[1]).toBe(`${"x".repeat(31)}…`);
    expect(tool.detail).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u);
  });

  it("keeps malformed tool identities deterministic without exposing their controls", () => {
    const recording = {
      messages: [],
      activities: [
        activity("tool-1", "tool.updated", {
          tone: "tool" as const,
          payload: { toolCallId: "bad\ud800\u001b[2Jid", status: "inProgress" },
        }),
      ],
    };

    const [row] = projectRecordedThreadTimeline(recording);

    expect(row?.id).toBe(
      "activity:tool:turn-1:%u0062%u0061%u0064%ud800%u001b%u005b%u0032%u004a%u0069%u0064",
    );
    expect(row).toMatchObject({ toolCallId: "bad�id" });
    expect(projectRecordedThreadTimeline(recording)).toEqual([row]);
  });
});
