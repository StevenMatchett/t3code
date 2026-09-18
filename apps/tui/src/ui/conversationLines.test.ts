import { describe, expect, it } from "@effect/vitest";
import { conversationLines } from "./conversationLines.ts";
import type { TimelineRow } from "../features/chat/timeline.ts";
import { EventId, TurnId } from "@t3tools/contracts";

const base = {
  turnId: TurnId.make("turn-1"),
  createdAt: "2026-01-01T00:00:00.000Z",
  sourceId: EventId.make("event-1"),
};

describe("conversationLines", () => {
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
    expect(collapsed).toContain("Ran command");
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
});
