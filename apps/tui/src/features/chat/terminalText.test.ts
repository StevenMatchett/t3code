import { describe, expect, it } from "@effect/vitest";

import { normalizeTerminalText } from "./terminalText.ts";

describe("normalizeTerminalText", () => {
  it("removes CSI, OSC, string, C0, and C1 terminal controls", () => {
    const value = [
      "\u001b]0;window title\u0007",
      "safe",
      "\u001b[31m red\u001b[0m",
      "\u001bPprivate payload\u001b\\",
      "\u009dother title\u009c",
      " text\u0000\u0007",
    ].join("");

    expect(normalizeTerminalText(value)).toBe("safe red text");
  });

  it("normalizes line endings, tabs, and ill-formed Unicode", () => {
    expect(normalizeTerminalText("one\ttwo\r\nthree\rfour\ud800\ufffd")).toBe(
      "one    two\nthree\nfour\ufffd\ufffd",
    );
    expect(normalizeTerminalText("before\u001b🧪 after")).toBe("before🧪 after");
  });

  it("caps each line by Unicode code point and marks truncated lines", () => {
    expect(normalizeTerminalText("123456789\nshort", { maxLineLength: 6 })).toBe("12345…\nshort");
    expect(normalizeTerminalText("🧪🧪🧪", { maxLineLength: 2 })).toBe("🧪…");
    expect(normalizeTerminalText("ab", { maxLineLength: 1 })).toBe("…");
  });

  it("keeps Markdown HTML literal for a renderer to display as text", () => {
    expect(normalizeTerminalText('<img src="x" onerror="run()">')).toBe(
      '<img src="x" onerror="run()">',
    );
  });
});
