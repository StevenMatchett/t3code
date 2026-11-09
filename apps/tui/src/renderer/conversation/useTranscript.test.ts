import { describe, expect, it } from "@effect/vitest";
import { EventId, MessageId, TurnId } from "@t3tools/contracts";
import type { TimelineRow } from "../../features/chat/timeline.ts";
import { conversationLines } from "../../ui/conversationLines.ts";
import { promptStarts } from "./useTranscript.ts";

const base = {
  turnId: TurnId.make("turn-1"),
  createdAt: "2026-01-01T00:00:00.000Z",
  sourceId: EventId.make("event-1"),
};

const message = (id: string, kind: "user" | "assistant", text: string): TimelineRow => ({
  ...base,
  id,
  source: "message",
  sourceId: MessageId.make(id),
  kind,
  text,
  streaming: false,
});

describe("promptStarts", () => {
  it("finds the first line of each user prompt, even when one wraps", () => {
    const lines = conversationLines(
      [
        message("first", "user", "a prompt long enough to wrap onto a second line"),
        message("reply-1", "assistant", "**Answer** one"),
        message("second", "user", "short"),
        message("reply-2", "assistant", "Answer two"),
      ],
      20,
      false,
    );
    const starts = promptStarts(lines);
    expect(starts.map((index) => lines[index]?.id)).toEqual(["first", "second"]);
    expect(starts.every((index) => lines[index]?.line === 0)).toBe(true);
  });
});
