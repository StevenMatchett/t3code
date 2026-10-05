import { describe, expect, it } from "@effect/vitest";
import stringWidth from "string-width";
import { markdownLines } from "./markdownLines.ts";

describe("Markdown conversation layout", () => {
  it("renders Mermaid boxes and arrows while the raw toggle preserves the complete fence", () => {
    const source = "```mermaid\nflowchart LR; A[Start] --> B{Ready?}\nB -->|Yes| C[Done]\n```";
    const lines = markdownLines(source, 80);
    const rendered = lines.map((line) => line.text).join("\n");
    expect(rendered).toContain("┌");
    expect(rendered).toContain("►");
    expect(rendered).toContain("Start");
    expect(rendered).toContain("Ready?");
    expect(rendered).toContain("Yes");
    expect(rendered).toContain("Done");
    expect(rendered).not.toContain("flowchart");
    expect(rendered).not.toContain("-->");
    expect(
      markdownLines(source, 80, false)
        .map((line) => line.text)
        .join("\n"),
    ).toBe(source);
    expect(lines.slice(1).every((line) => !line.spans.some((span) => span.code))).toBe(true);
  });

  it.each([
    ["sequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Hi", "Alice", "Hello"],
    ["stateDiagram-v2\n[*] --> Idle\nIdle --> Done", "Idle", "Done"],
    ["classDiagram\nAnimal <|-- Duck\nAnimal: +int age", "Animal", "Duck"],
    ["erDiagram\nCUSTOMER ||--o{ ORDER : places", "CUSTOMER", "places"],
    ["xychart-beta\n x-axis [Jan, Feb]\n bar [10, 20]", "Jan", "Feb"],
  ])("renders supported Mermaid diagrams: %s", (source, first, second) => {
    const rendered = markdownLines(`~~~mermaid\n${source}\n~~~`, 120)
      .map((line) => line.text)
      .join("\n");
    expect(rendered).toContain(first);
    expect(rendered).toContain(second);
    expect(rendered).not.toContain("showing source");
    expect(rendered).not.toContain("\u001b");
  });

  it("uses ASCII diagram characters when Unicode is disabled", () => {
    const rendered = markdownLines(
      "```mermaid\ngraph LR\nA[Start] --> B[Done]\n```",
      80,
      true,
      false,
    )
      .map((line) => line.text)
      .join("\n");
    expect(rendered).toContain("+-----+");
    expect(rendered).toContain(">|");
    expect(rendered).not.toMatch(/[┌┐└┘─│►]/u);
  });

  it("waits for the closing fence before rendering streamed Mermaid", () => {
    const source = "```mermaid\nflowchart LR\nA[Start] --> B[Done]";
    const partial = markdownLines(source, 80)
      .map((line) => line.text)
      .join("\n");
    expect(partial).toContain("flowchart LR");
    expect(partial).not.toContain("┌");
    const complete = markdownLines(`${source}\n\`\`\``, 80)
      .map((line) => line.text)
      .join("\n");
    expect(complete).toContain("┌");
    expect(complete).not.toContain("flowchart LR");
  });

  it("preserves source for unsupported, invalid, overly large and empty diagrams", () => {
    for (const source of [
      'pie\n"Yes" : 3',
      "flowchart sideways\nA --> B",
      "flowchart TD",
      `flowchart TD\n${Array.from({ length: 90 }, () => `%% ${"x".repeat(100)}`).join("\n")}`,
      `flowchart TD\n${Array.from({ length: 42 }, (_, index) => `N${index} --> N${index + 1}`).join("\n")}`,
    ]) {
      const lines = markdownLines(`\`\`\`mermaid\n${source}\n\`\`\``, 80);
      expect(lines.map((line) => line.text).join("\n")).toContain("showing source");
      expect(
        lines
          .filter((line) => line.spans.some((span) => span.code))
          .map((line) => line.text)
          .join(""),
      ).toBe(source.replaceAll("\n", ""));
    }
  });

  it("shows source on narrow viewports and restores the diagram when widened", () => {
    const source = "```mermaid\nflowchart LR\nA[Start] --> B[Done]\n```";
    const narrow = markdownLines(source, 10);
    expect(narrow.every((line) => stringWidth(line.text) <= 10)).toBe(true);
    expect(
      narrow
        .filter((line) => line.spans.some((span) => span.code))
        .map((line) => line.text)
        .join(""),
    ).toBe("flowchart LRA[Start] --> B[Done]");
    const wide = markdownLines(source, 80)
      .map((line) => line.text)
      .join("\n");
    expect(wide).toContain("┌");
    expect(wide).not.toContain("showing source");
  });

  it("renders diagrams inside lists and quotes without damaging their indentation", () => {
    for (const source of [
      "- Diagram:\n  ```mermaid\n  graph LR\n  A --> B\n  ```",
      "> ```mermaid\n> graph LR\n> A --> B\n> ```",
    ]) {
      const lines = markdownLines(source, 30);
      expect(lines.some((line) => line.text.includes("┌"))).toBe(true);
      expect(lines.every((line) => stringWidth(line.text) <= 30)).toBe(true);
      expect(lines.map((line) => line.text).join("\n")).not.toContain("graph LR");
    }
  });
  it("combines nested emphasis, strikeout, escapes and reference links", () => {
    const lines = markdownLines(
      "***nested*** ~~old~~ \\*literal\\* [**Docs**][docs]\n\n[docs]: https://example.com",
      80,
    );
    const spans = lines.flatMap((line) => line.spans);
    expect(spans).toContainEqual({ text: "nested", bold: true, italic: true });
    expect(spans).toContainEqual({ text: "old", strikethrough: true });
    expect(lines.map((line) => line.text).join("\n")).toContain("*literal*");
    expect(spans).toContainEqual({ text: "Docs", bold: true, href: "https://example.com" });
    expect(lines.some((line) => line.text.includes("[docs]:"))).toBe(false);
  });

  it("lays out nested numbered lists and task checkboxes with their contents", () => {
    const lines = markdownLines("3. parent\n   - **child**\n\n- [x] Done\n- [ ] Pending", 80);
    expect(lines.map((line) => line.text)).toEqual([
      "3. parent",
      "   • child",
      "",
      "• [x] Done",
      "• [ ] Pending",
    ]);
  });

  it("fits tables to the viewport and retains cell styling and link destinations", () => {
    const source =
      "| Name | Status |\n| --- | ---: |\n| 界界 | **ready** |\n| [Docs](https://example.com/docs) | ~~old~~ |";
    for (const width of [80, 20, 8, 3]) {
      const lines = markdownLines(source, width);
      expect(lines.every((line) => stringWidth(line.text) <= width)).toBe(true);
      expect(
        lines.some((line) => line.spans.some((span) => span.bold && span.text.includes("r"))),
      ).toBe(true);
      expect(
        lines
          .flatMap((line) => line.spans)
          .filter((span) => span.href)
          .every((span) => span.href === "https://example.com/docs"),
      ).toBe(true);
      expect(lines.flatMap((line) => line.spans).some((span) => span.href)).toBe(true);
    }
    expect(markdownLines(source, 80).some((line) => line.text.includes("┼"))).toBe(true);
  });

  it("keeps source syntax and whitespace in raw mode, with usable wrapped links", () => {
    const source =
      "# Heading\n  **raw**   text\n[Docs](https://example.com/docs)\n\n```ts\n  x\n```\n";
    const lines = markdownLines(source, 80, false);
    expect(lines.map((line) => line.text).join("\n")).toBe(source);
    expect(
      lines.flatMap((line) => line.spans).some((span) => span.bold || span.italic || span.code),
    ).toBe(false);
    const wrapped = markdownLines("https://example.com/docs", 8, false);
    expect(wrapped.map((line) => line.text).join("")).toBe("https://example.com/docs");
    expect(
      wrapped
        .flatMap((line) => line.spans)
        .every((span) => span.href === "https://example.com/docs"),
    ).toBe(true);
  });

  it("renders hard line breaks, setext headings and indented literal code", () => {
    const lines = markdownLines("Title\n=====\n\nfirst  \nsecond\n\n    **literal**", 80);
    expect(lines[0]).toMatchObject({ text: "Title", tone: "accent", strong: true });
    expect(lines.map((line) => line.text)).toContain("first");
    expect(lines.map((line) => line.text)).toContain("second");
    expect(lines.at(-1)?.spans).toEqual([{ text: "**literal**", code: true }]);
  });
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
      "# Summary\n**Done** and *ready* with `code`\n\n- Item\n\n> Quote\n\n[Docs](https://example.com)",
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
