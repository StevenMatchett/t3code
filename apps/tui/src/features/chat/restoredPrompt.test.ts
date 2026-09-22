import { describe, expect, it } from "@effect/vitest";
import { recallableComposerPrompt } from "./restoredPrompt.ts";

describe("restoring prompts from GUI threads", () => {
  it("strips send-time terminal context and its inline label", () => {
    expect(
      recallableComposerPrompt(
        "Explain @terminal-1:2\n\n<terminal_context>\n- Terminal 1 line 2:\n  stale output\n</terminal_context>",
      ),
    ).toBe("Explain");
  });
  it("strips appended review context while preserving the user's text", () => {
    expect(
      recallableComposerPrompt(
        'Ultrathink:\nFix this\n<review_comment file="a.ts">old review</review_comment>',
      ),
    ).toBe("Fix this");
  });
  it("does not recall generated plan instructions", () => {
    expect(recallableComposerPrompt("PLEASE IMPLEMENT THIS PLAN:\nA plan")).toBe("");
  });
});
