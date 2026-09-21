import { describe, expect, it } from "@effect/vitest";
import { diffFiles } from "./diffFiles.ts";

describe("diff files", () => {
  it("separates files and counts hunk content, excluding metadata", () => {
    const files = diffFiles(
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n-old\n+new\n+++content\ndiff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-deleted",
    );
    expect(files.map(({ path, additions, deletions }) => ({ path, additions, deletions }))).toEqual(
      [
        { path: "a.ts", additions: 2, deletions: 1 },
        { path: "b.ts", additions: 0, deletions: 1 },
      ],
    );
    expect(files[0]?.text).not.toContain("deleted");
  });
  it("keeps rename and binary metadata and accepts empty patches", () => {
    expect(diffFiles("")).toEqual([]);
    expect(diffFiles("diff --git a/old b/new\nrename from old\nrename to new")[0]?.path).toBe(
      "new",
    );
    expect(diffFiles("diff --git a/image.png b/image.png\nBinary files differ")[0]).toMatchObject({
      path: "image.png",
      additions: 0,
      deletions: 0,
    });
  });
});
