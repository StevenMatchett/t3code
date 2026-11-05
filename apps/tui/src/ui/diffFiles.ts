export interface DiffFile {
  readonly id: string;
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly text: string;
}

function gitPath(value: string) {
  const path = value.trim();
  // Git quotes unusual filenames with C-style escapes. Keep undecodable paths readable.
  if (path.startsWith('"')) {
    try {
      return (JSON.parse(path) as string).replace(/^[ab]\//u, "");
    } catch {
      return path;
    }
  }
  return path.replace(/^[ab]\//u, "");
}

export function diffFiles(diff: string): readonly DiffFile[] {
  if (!diff.trim()) return [];
  return diff
    .split(/(?=^diff --git )/mu)
    .filter((part) => part.trim())
    .map((text, index) => {
      const lines = text.split("\n");
      const destination = lines.find((line) => line.startsWith("+++ "))?.slice(4);
      const original = lines.find((line) => line.startsWith("--- "))?.slice(4);
      const rename = lines.find((line) => line.startsWith("rename to "))?.slice(10);
      const header = / b\/(.*)$/u.exec(lines[0] ?? "")?.[1];
      const path =
        rename ??
        (destination && destination !== "/dev/null"
          ? gitPath(destination)
          : original
            ? gitPath(original)
            : (header ?? lines[0] ?? "Changes"));
      let inHunk = false;
      let additions = 0;
      let deletions = 0;
      for (const line of lines) {
        if (line.startsWith("@@")) inHunk = true;
        else if (inHunk && line.startsWith("+")) additions += 1;
        else if (inHunk && line.startsWith("-")) deletions += 1;
      }
      return { id: `${index}:${path}`, path, additions, deletions, text };
    });
}

export type DiffTreeRow =
  | {
      readonly kind: "directory";
      readonly id: string;
      readonly label: string;
      readonly depth: number;
    }
  | {
      readonly kind: "file";
      readonly id: string;
      readonly label: string;
      readonly depth: number;
      /** Where this file sits in the list it was built from. */
      readonly fileIndex: number;
    };

/**
 * Groups files under their directories for the file list. Files stay in their given order, so
 * the tree only adds headings and moving between files is unchanged.
 */
export function diffFileTree(files: readonly DiffFile[]): readonly DiffTreeRow[] {
  const rows: DiffTreeRow[] = [];
  const entries = files.map((file, fileIndex) => ({
    file,
    fileIndex,
    directories: file.path.split("/").slice(0, -1),
  }));
  const walk = (run: typeof entries, level: number, depth: number) => {
    let index = 0;
    while (index < run.length) {
      const { file, fileIndex, directories } = run[index]!;
      if (directories.length === level) {
        rows.push({
          kind: "file",
          id: file.id,
          label: `${file.path.split("/").at(-1)} +${file.additions} -${file.deletions}`,
          depth,
          fileIndex,
        });
        index += 1;
        continue;
      }
      let end = index + 1;
      while (run[end]?.directories[level] === directories[level]) end += 1;
      const group = run.slice(index, end);
      // Directories holding only one directory share its heading, so deep paths do not stair-step.
      let shared = level + 1;
      while (
        shared < directories.length &&
        group.every((entry) => entry.directories[shared] === directories[shared])
      )
        shared += 1;
      rows.push({
        kind: "directory",
        // A directory can come back in an unsorted list, so its first file tells the headings apart.
        id: `directory:${fileIndex}:${directories.slice(0, shared).join("/")}`,
        label: `${directories.slice(level, shared).join("/")}/`,
        depth,
      });
      walk(group, shared, depth + 1);
      index = end;
    }
  };
  walk(entries, 0, 0);
  return rows;
}
