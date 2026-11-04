import { describe, expect, it } from "vite-plus/test";
import { completePathDraft, pathCompletionAt } from "./pathCompletion.ts";

describe("path completion", () => {
  it("starts at an @ after whitespace or at the start of the draft", () => {
    expect(pathCompletionAt("@src", 4)).toEqual({ start: 0, end: 4, query: "src" });
    expect(pathCompletionAt("see @src/a", 10)).toEqual({ start: 4, end: 10, query: "src/a" });
    expect(pathCompletionAt("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("ignores emails, finished mentions, and a cursor elsewhere", () => {
    expect(pathCompletionAt("me@example.com", 14)).toBeNull();
    expect(pathCompletionAt("@src/a next", 11)).toBeNull();
    expect(pathCompletionAt("hello @src", 3)).toBeNull();
  });

  it("covers the whole token when the cursor is inside it", () => {
    expect(pathCompletionAt("@src/rest more", 4)).toEqual({ start: 0, end: 9, query: "src" });
  });

  it("replaces the token and keeps the text after it", () => {
    const text = "see @sr please";
    expect(completePathDraft(text, pathCompletionAt(text, 7)!, "src/a.ts")).toEqual({
      text: "see @src/a.ts please",
      cursor: 14,
    });
  });
});
