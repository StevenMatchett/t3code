import { describe, expect, it } from "@effect/vitest";
import stringWidth from "string-width";
import { markdownLines } from "./markdownLines.ts";

describe("Markdown conversation layout", () => {
  it("retains full destinations across wrapping and excludes prose punctuation", () => {
    const url = "https://example.com/a_(b)";
    const lines = markdownLines(`See ${url}.`, 10);
    expect(
      lines
        .flatMap((line) => line.spans)
        .filter((span) => span.href)
        .map((span) => span.text)
        .join(""),
    ).toBe(url);
    expect(
      lines
        .flatMap((line) => line.spans)
        .filter((span) => span.href)
        .every((span) => span.href === url),
    ).toBe(true);
    expect(
      markdownLines("[bad](javascript:alert) [file](file:///tmp/test)", 80)
        .flatMap((line) => line.spans)
        .some((span) => span.href),
    ).toBe(false);
  });

  it("wraps whole words without losing inline styles or explicit blank lines", () => {
    const lines = markdownLines("hello **beautiful world**\n\nnext line", 12);
    expect(lines.map((line) => line.text)).toEqual([
      "hello",
      "beautiful",
      "world",
      "",
      "next line",
    ]);
    expect(lines[1]?.spans).toEqual([{ text: "beautiful", bold: true }]);
    expect(lines[2]?.spans).toEqual([{ text: "world", bold: true }]);
  });
  it("keeps words together even when emphasis changes inside a word", () => {
    const lines = markdownLines("some **high**light here", 10);
    expect(lines.map((line) => line.text)).toEqual(["some", "highlight", "here"]);
    expect(lines[1]?.spans).toEqual([{ text: "high", bold: true }, { text: "light" }]);
  });
  it("preserves all whitespace in wrapped fenced code", () => {
    const lines = markdownLines("```\n  hello   world\n```", 8);
    expect(
      lines
        .slice(1)
        .map((line) => line.text)
        .join(""),
    ).toBe("  hello   world");
  });
  it("formats headings, inline emphasis, lists, quotes, and readable link destinations", () => {
    const lines = markdownLines(
      "# Summary\n**Done** and *ready* with `code`\n- Item\n> Quote\n[Docs](https://example.com)",
      80,
    );
    expect(lines[0]).toMatchObject({ text: "Summary", strong: true, tone: "accent" });
    expect(lines[1]?.spans).toContainEqual({ text: "Done", bold: true });
    expect(lines[1]?.spans).toContainEqual({ text: "ready", italic: true });
    expect(lines[1]?.spans).toContainEqual({ text: "code", code: true });
    expect(lines.map((line) => line.text)).toContain("• Item");
    expect(lines.map((line) => line.text)).toContain("│ Quote");
    expect(lines.at(-1)?.text).toBe("Docs (https://example.com)");
  });

  it("preserves literal fenced code including an unfinished streaming block", () => {
    const lines = markdownLines("```ts\nconst x = '**literal**';\n# code", 80);
    expect(lines.map((line) => line.text)).toEqual(["ts", "const x = '**literal**';", "# code"]);
    expect(lines[1]?.spans).toEqual([{ text: "const x = '**literal**';", code: true }]);
  });

  it("wraps styled Unicode to the viewport without losing emphasis", () => {
    const lines = markdownLines("**界界界abc**", 4);
    expect(lines.every((line) => stringWidth(line.text) <= 4)).toBe(true);
    expect(lines.map((line) => line.text).join("")).toBe("界界界abc");
    expect(lines.every((line) => line.spans.every((span) => span.bold))).toBe(true);
  });
});
