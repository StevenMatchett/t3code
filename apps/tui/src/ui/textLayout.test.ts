import { describe, expect, it } from "@effect/vitest";
import { inlineTerminalText, wrapTerminalLines } from "./textLayout.ts";

describe("conversation text layout", () => {
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
