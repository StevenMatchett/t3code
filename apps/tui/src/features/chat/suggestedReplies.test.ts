import { describe, expect, it } from "@effect/vitest";
import { suggestedReplies } from "./suggestedReplies.ts";

describe("suggestedReplies", () => {
  it("finds a final numbered answer list", () => {
    expect(
      suggestedReplies("Which theme do you prefer?\n\n1. Dark\n2. Light\n3. System default"),
    ).toEqual(["Dark", "Light", "System default"]);
  });

  it("does not turn a numbered list of questions into replies", () => {
    expect(
      suggestedReplies(
        "Answer any or all:\n1. What's your favorite food?\n2. Which OS are you using?",
      ),
    ).toEqual([]);
  });

  it("requires a complete contiguous list at the end", () => {
    expect(suggestedReplies("Choose one?\n1. First\n3. Third")).toEqual([]);
    expect(suggestedReplies("Choose one?\n1. First\n2. Second\nMore detail follows.")).toEqual([]);
  });
});
