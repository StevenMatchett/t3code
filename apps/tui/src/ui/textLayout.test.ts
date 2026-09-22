import { describe, expect, it } from "@effect/vitest";
import { inlineTerminalText, wrapTerminalLines, wrapTerminalWords } from "./textLayout.ts";

describe("conversation text layout", () => {
  it("wraps prose at word boundaries and preserves explicit newlines", () => {
    expect(wrapTerminalWords("hello world again\n\n  next line", 10)).toEqual([
      "hello",
      "world",
      "again",
      "",
      "  next",
      "line",
    ]);
    expect(wrapTerminalWords("hello world", 5)).toEqual(["hello", "world"]);
    expect(wrapTerminalWords("hello   world", 7)).toEqual(["hello", "world"]);
  });
  it("falls back to grapheme-safe wrapping for long words and narrow viewports", () => {
    expect(wrapTerminalWords("  abcdef", 4)).toEqual(["  ab", "cdef"]);
    expect(wrapTerminalWords("界界 hello", 5)).toEqual(["界界", "hello"]);
    expect(wrapTerminalWords("e\u0301xx", 1)).toEqual(["e\u0301", "x", "x"]);
    expect(wrapTerminalWords("界a", 1)).toEqual(["?", "a"]);
  });
  it("wraps ASCII while preserving blank lines and indentation", () => {
    expect(wrapTerminalLines("  abcdef\n\nlast", 4)).toEqual(["  ab", "cdef", "", "last"]);
  });
  it("preserves grapheme clusters and uses terminal columns for wide text", () => {
    expect(wrapTerminalLines("ab界cd", 4)).toEqual(["ab界", "cd"]);
    expect(wrapTerminalLines("e\u0301xx", 1)).toEqual(["e\u0301", "x", "x"]);
  });
  it("does not pass terminal control sequences into visible labels or conversation rows", () => {
    expect(inlineTerminalText("\x1b[31mTitle\x1b[0m\nnext")).toBe("Title next");
    expect(wrapTerminalLines("\x1b]52;c;hidden\x07hello", 5)).toEqual(["hello"]);
  });
  it("handles a viewport narrower than one wide grapheme", () => {
    expect(wrapTerminalLines("界a", 1)).toEqual(["?", "a"]);
  });
});
