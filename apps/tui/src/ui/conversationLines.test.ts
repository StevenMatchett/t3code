import { describe, expect, it } from "@effect/vitest";
import { conversationLines } from "./conversationLines.ts";
import type { TimelineRow } from "../features/chat/timeline.ts";
import { EventId, MessageId, TurnId } from "@t3tools/contracts";

const base = {
  turnId: TurnId.make("turn-1"),
  createdAt: "2026-01-01T00:00:00.000Z",
  sourceId: EventId.make("event-1"),
};

describe("conversationLines", () => {
  const tool = (
    id: string,
    status = "completed" as "completed" | "inProgress" | "failed",
  ): TimelineRow => ({
    ...base,
    id,
    source: "activity",
    kind: "tool",
    text: id,
    activityKind: "tool.completed",
    activityTone: "tool",
    status,
    command: `echo ${id}`,
    detail: `output ${id}`,
  });

  it("collapses completed tools and supports individual and global expansion", () => {
    const rows = [tool("a"), tool("b"), tool("c")];
    const collapsed = conversationLines(rows, 100, false);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({
      toolGroupId: "tools:a",
      text: expect.stringContaining("3 tool calls"),
    });
    for (const lines of [
      conversationLines(rows, 100, true),
      conversationLines(rows, 100, false, new Map([["tools:a", true]])),
    ]) {
      expect(lines.map((line) => line.text).join("\n")).toContain("output c");
    }
    expect(conversationLines(rows, 100, true, new Map([["tools:a", false]]))).toHaveLength(1);
  });

  it("keeps running and failed tools visible and never groups across turns or messages", () => {
    const rows: TimelineRow[] = [
      tool("a"),
      tool("b"),
      tool("live", "inProgress"),
      tool("failed", "failed"),
      tool("c"),
      { ...tool("d"), turnId: TurnId.make("turn-2") },
      {
        ...base,
        id: "reply",
        sourceId: MessageId.make("reply"),
        source: "message",
        kind: "assistant",
        text: "Reply",
        streaming: false,
      },
      tool("e"),
    ];
    const lines = conversationLines(rows, 100, false);
    expect(lines.filter((line) => line.toolGroupId)).toHaveLength(1);
    const text = lines.map((line) => line.text).join("\n");
    expect(text).toContain("[running] echo live");
    expect(text).toContain("[failed] echo failed");
    expect(text).toContain("echo c");
    expect(text).toContain("echo d");
    expect(text).toContain("Reply");
  });

  it("shows tool calls with their files by default and hides reasoning until expanded", () => {
    const rows: TimelineRow[] = [
      {
        ...base,
        id: "a",
        source: "activity",
        kind: "tool",
        text: "Ran command",
        activityKind: "tool.completed",
        activityTone: "tool",
        status: "completed",
        command: "npm test",
        files: ["src/a.ts"],
      },
      {
        ...base,
        id: "b",
        source: "activity",
        kind: "reasoning",
        text: "thinking",
        activityKind: "reasoning",
        activityTone: "info",
      },
    ];
    const collapsed = conversationLines(rows, 80, false)
      .map((line) => line.text)
      .join("\n");
    expect(collapsed).toContain("[completed]");
    expect(collapsed).toContain("npm test");
    expect(collapsed).not.toContain("Ran command");
    expect(collapsed).toContain("File: src/a.ts");
    expect(collapsed).not.toContain("thinking");
    expect(
      conversationLines(rows, 80, true)
        .map((line) => line.text)
        .join("\n"),
    ).toContain("thinking");
  });

  it("renders checkpoint file changes with per-file and total additions and deletions", () => {
    const rows: TimelineRow[] = [
      {
        ...base,
        id: "c",
        source: "checkpoint",
        kind: "changes",
        text: "Turn 1 file changes",
        status: "ready",
        files: [
          { path: "src/a.ts", kind: "modified", additions: 12, deletions: 3 },
          { path: "src/b.ts", kind: "added", additions: 5, deletions: 0 },
        ],
      },
    ];
    const text = conversationLines(rows, 80, false)
      .map((line) => line.text)
      .join("\n");
    expect(text).toContain("+17 -3");
    expect(text).toContain("src/a.ts  +12 -3 (modified)");
    expect(text).toContain("src/b.ts  +5 -0 (added)");
  });

  it("omits role headings and highlights user content without highlighting its spacer", () => {
    const rows: TimelineRow[] = [
      {
        ...base,
        id: "user",
        source: "message",
        sourceId: MessageId.make("user-message"),
        kind: "user",
        text: "hello",
        streaming: false,
      },
      {
        ...base,
        id: "assistant",
        source: "message",
        sourceId: MessageId.make("assistant-message"),
        kind: "assistant",
        text: "hi there",
        streaming: false,
      },
    ];

    const lines = conversationLines(rows, 40, false);

    expect(lines.map((line) => line.text)).toEqual(["hello", "", "hi there", ""]);
    expect(lines[0]).toMatchObject({ highlight: true, tone: "text", strong: false });
    expect(lines.slice(1).every((line) => line.highlight === undefined)).toBe(true);
  });

  it("reserves horizontal padding when wrapping highlighted user messages", () => {
    const lines = conversationLines(
      [
        {
          ...base,
          id: "user",
          source: "message",
          sourceId: MessageId.make("user-message"),
          kind: "user",
          text: "123456789",
          streaming: false,
        },
      ],
      10,
      false,
    );

    expect(lines.map((line) => line.text)).toEqual(["12345678", "9", ""]);
    expect(lines.slice(0, 2).every((line) => line.highlight)).toBe(true);
    expect(lines[2]?.highlight).toBeUndefined();
  });
});
