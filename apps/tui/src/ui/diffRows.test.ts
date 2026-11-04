import { describe, expect, it } from "@effect/vitest";
import { diffFileTree, type DiffFile } from "./diffFiles.ts";
import { parseDiffRows, splitDiffRows } from "./diffRows.ts";
import { diffSyntaxTokens } from "./diffSyntax.ts";

const DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -10,3 +10,4 @@ function top() {
 keep
-old one
+new one
+new two
 tail
`;

describe("diff rows", () => {
  it("numbers lines from the hunk header, and never reads the file header as a change", () => {
    const rows = parseDiffRows(DIFF);
    expect(rows.slice(0, 4).map((row) => row.kind)).toEqual(["meta", "meta", "meta", "hunk"]);
    expect(rows.slice(4).map((row) => [row.kind, row.oldLine, row.newLine])).toEqual([
      ["context", 10, 10],
      ["del", 11, null],
      ["add", null, 11],
      ["add", null, 12],
      ["context", 12, 13],
    ]);
  });

  it("pairs removals with the additions after them", () => {
    const split = splitDiffRows(parseDiffRows(DIFF)).slice(4);
    expect(split.map(({ left, right }) => [left?.code ?? null, right?.code ?? null])).toEqual([
      ["keep", "keep"],
      ["old one", "new one"],
      [null, "new two"],
      ["tail", "tail"],
    ]);
  });
});

describe("diff syntax", () => {
  const kinds = (code: string, path = "a.ts") =>
    diffSyntaxTokens(code, path).map((token) => [token.text, token.kind]);

  it("colors keywords, strings, and numbers, and keeps every character", () => {
    const code = `const name = "if" + 42; // done if`;
    expect(
      diffSyntaxTokens(code, "a.ts")
        .map((token) => token.text)
        .join(""),
    ).toBe(code);
    expect(kinds(code)).toContainEqual(["const", "keyword"]);
    expect(kinds(code)).toContainEqual([`"if"`, "string"]);
    expect(kinds(code)).toContainEqual(["42", "number"]);
    expect(kinds(code)).toContainEqual(["// done if", "comment"]);
  });

  it("does not read a comment marker inside a string", () => {
    expect(kinds(`url = "http://example.com"`)).toContainEqual([`"http://example.com"`, "string"]);
  });

  it("uses the file's own comment marker and leaves unknown files plain", () => {
    expect(kinds("x = 1 # note", "a.py")).toContainEqual(["# note", "comment"]);
    expect(kinds("if 1 # note", "notes.md")).toEqual([["if 1 # note", "plain"]]);
  });
});

describe("diff file tree", () => {
  const file = (path: string): DiffFile => ({
    id: path,
    path,
    additions: 1,
    deletions: 0,
    text: "",
  });

  it("adds one heading per directory, and keeps files selectable in their order", () => {
    const rows = diffFileTree([
      file("README.md"),
      file("src/a.ts"),
      file("src/b.ts"),
      file("src/deep/er/c.ts"),
      file("test/d.ts"),
    ]);
    expect(rows.map((row) => row.label)).toEqual([
      "README.md +1 -0",
      "src/",
      "a.ts +1 -0",
      "b.ts +1 -0",
      "deep/er/",
      "c.ts +1 -0",
      "test/",
      "d.ts +1 -0",
    ]);
    expect(rows.flatMap((row) => (row.kind === "file" ? [row.fileIndex] : []))).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });
});
