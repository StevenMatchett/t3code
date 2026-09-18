import { describe, expect, it } from "@effect/vitest";
import { completeSkillDraft, skillCompletionAt } from "./skillCompletion.ts";

describe("slash skill completion", () => {
  it("uses the active token rather than the entire draft", () => {
    expect(skillCompletionAt("/", 1)).toMatchObject({ start: 0, end: 1, query: "" });
    expect(skillCompletionAt("Use /review next", 7)).toMatchObject({
      start: 4,
      end: 11,
      query: "re",
    });
    expect(skillCompletionAt("/model", 6)?.query).toBe("model");
  });
  it.each(["https://host/path", "/tmp/file", "a/b", "/review ", "/review\n"])(
    "does not complete an inactive slash in %s",
    (text) => {
      expect(skillCompletionAt(text, text.length)).toBeNull();
    },
  );
  it("keeps surrounding text and positions the caret after the selected invocation", () => {
    const text = "/rev remaining text";
    expect(completeSkillDraft(text, "$review ", skillCompletionAt(text, 4)!)).toEqual({
      text: "$review remaining text",
      cursor: 8,
    });
    const middle = "Please /rev this";
    expect(completeSkillDraft(middle, "/review ", skillCompletionAt(middle, 11)!)).toEqual({
      text: "/review Please this",
      cursor: 15,
    });
  });
});
