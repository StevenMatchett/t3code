import { describe, expect, it } from "@effect/vitest";
import { buildComposerPromptHistoryEntries, stepComposerPromptHistory } from "./promptHistory.ts";

describe("prompt recall history", () => {
  it("keeps only user text, cleans GUI context, and collapses consecutive repeats", () => {
    expect(
      buildComposerPromptHistoryEntries([
        { id: "1", role: "user", text: "First" },
        { id: "2", role: "assistant", text: "Reply" },
        { id: "3", role: "user", text: "First" },
        { id: "4", role: "user", text: "" },
        { id: "5", role: "user", text: "Ultrathink:\nSecond" },
      ]),
    ).toEqual([
      { id: "3", prompt: "First" },
      { id: "5", prompt: "Second" },
    ]);
  });
  it("uses message identities when older pages or newer messages arrive", () => {
    const entries = [
      { id: "older", prompt: "Older" },
      { id: "active", prompt: "Active" },
      { id: "new", prompt: "New" },
    ];
    expect(
      stepComposerPromptHistory({
        direction: "backward",
        entries,
        position: { entryId: "active", recalled: "Active" },
        currentPrompt: "Active",
      })?.prompt,
    ).toBe("Older");
    expect(
      stepComposerPromptHistory({
        direction: "forward",
        entries,
        position: { entryId: "active", recalled: "Active" },
        currentPrompt: "Active",
      })?.prompt,
    ).toBe("New");
  });
  it("retains position when a repeated prompt is replaced with a newer ID", () => {
    expect(
      stepComposerPromptHistory({
        direction: "backward",
        entries: [
          { id: "older", prompt: "Older" },
          { id: "new-id", prompt: "Same" },
        ],
        position: { entryId: "old-id", recalled: "Same" },
        currentPrompt: "Same",
      })?.prompt,
    ).toBe("Older");
  });
  it("leaves typed text untouched and clears recall after the newest entry", () => {
    const entries = [{ id: "1", prompt: "Old" }];
    expect(
      stepComposerPromptHistory({
        direction: "backward",
        entries,
        position: null,
        currentPrompt: "Draft",
      }),
    ).toBeNull();
    expect(
      stepComposerPromptHistory({
        direction: "forward",
        entries,
        position: { entryId: "1", recalled: "Old" },
        currentPrompt: "Old",
      }),
    ).toEqual({ position: null, prompt: "" });
    expect(
      stepComposerPromptHistory({
        direction: "backward",
        entries: [],
        position: null,
        currentPrompt: "",
      }),
    ).toBeNull();
  });
});
