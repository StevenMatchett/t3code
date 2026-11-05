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
    // Files in one directory line up, and a subdirectory sits one level inside its parent.
    expect(rows.map((row) => row.depth)).toEqual([0, 0, 1, 1, 1, 2, 0, 1]);
    expect(rows.flatMap((row) => (row.kind === "file" ? [row.fileIndex] : []))).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  const drawn = (paths: readonly string[]) =>
    diffFileTree(paths.map(file)).map((row) => `${"  ".repeat(row.depth)}${row.label}`);

  /** Each file's path as a reader follows the indentation, and every row's id. */
  const followed = (paths: readonly string[]) => {
    const rows = diffFileTree(paths.map(file));
    const headings: string[] = [];
    return {
      ids: rows.map((row) => row.id),
      paths: rows.flatMap((row) => {
        headings.length = row.depth;
        if (row.kind === "directory") {
          headings[row.depth] = row.label;
          return [];
        }
        return [`${headings.join("")}${row.label.replace(" +1 -0", "")}`];
      }),
    };
  };

  it("puts a sibling file after a deeper directory back in its own directory", () => {
    expect(drawn(["src/a/b/c.ts", "src/a/d.ts"])).toEqual([
      "src/a/",
      "  b/",
      "    c.ts +1 -0",
      "  d.ts +1 -0",
    ]);
  });

  it("keeps sibling directories level instead of nesting each inside the last", () => {
    expect(drawn(["src/a/b/c.ts", "src/a/d.ts", "src/e/f.ts", "src/g/h.ts", "src/i/j.ts"])).toEqual(
      [
        "src/",
        "  a/",
        "    b/",
        "      c.ts +1 -0",
        "    d.ts +1 -0",
        "  e/",
        "    f.ts +1 -0",
        "  g/",
        "    h.ts +1 -0",
        "  i/",
        "    j.ts +1 -0",
      ],
    );
  });

  it("starts each top-level directory at the left edge", () => {
    expect(drawn(["a/x.ts", "b/y.ts", "c/d/z.ts"])).toEqual([
      "a/",
      "  x.ts +1 -0",
      "b/",
      "  y.ts +1 -0",
      "c/d/",
      "  z.ts +1 -0",
    ]);
  });

  it("keeps root files at the root wherever they fall between directories", () => {
    expect(drawn(["README.md", "a/x.ts", "b.md", "c/y.ts", "z.md"])).toEqual([
      "README.md +1 -0",
      "a/",
      "  x.ts +1 -0",
      "b.md +1 -0",
      "c/",
      "  y.ts +1 -0",
      "z.md +1 -0",
    ]);
  });

  it("keeps the given file order when a directory comes back", () => {
    const paths = ["a/x.ts", "b/y.ts", "a/z.ts"];
    expect(drawn(paths)).toEqual([
      "a/",
      "  x.ts +1 -0",
      "b/",
      "  y.ts +1 -0",
      "a/",
      "  z.ts +1 -0",
    ]);
    const { ids } = followed(paths);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("files this branch's own diff where each file really is", () => {
    const paths = [
      "README.md",
      "apps/tui/src/app/state.ts",
      "apps/tui/src/features/git/gitMenu.ts",
      "apps/tui/src/features/git/pullRequestView.ts",
      "apps/tui/src/renderer/HelpPanel.tsx",
      "apps/tui/src/ui/conversationLines.test.ts",
      "apps/tui/src/ui/conversationLines.ts",
      "apps/tui/src/ui/diffFiles.ts",
      "apps/tui/src/ui/diffRows.test.ts",
      "apps/tui/src/ui/diffRows.ts",
      "apps/tui/src/ui/diffSyntax.ts",
      "apps/tui/src/ui/textLayout.ts",
    ];
    expect(followed(paths).paths).toEqual(paths);
    expect(drawn(paths).slice(0, 10)).toEqual([
      "README.md +1 -0",
      "apps/tui/src/",
      "  app/",
      "    state.ts +1 -0",
      "  features/git/",
      "    gitMenu.ts +1 -0",
      "    pullRequestView.ts +1 -0",
      "  renderer/",
      "    HelpPanel.tsx +1 -0",
      "  ui/",
    ]);
  });
});
