import { describe, expect, it } from "@effect/vitest";
import stringWidth from "string-width";
import { markdownLines } from "./markdownLines.ts";

describe("Markdown conversation layout", () => {
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
