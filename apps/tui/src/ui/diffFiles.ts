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
  let open: readonly string[] = [];
  files.forEach((file, fileIndex) => {
    const parts = file.path.split("/");
    const name = parts.pop()!;
    let shared = 0;
    while (shared < open.length && open[shared] === parts[shared]) shared += 1;
    open = open.slice(0, shared);
    // One heading for the directories this file newly enters, so deep paths do not stair-step.
    if (parts.length > shared) {
      rows.push({
        kind: "directory",
        id: `directory:${parts.join("/")}`,
        label: `${parts.slice(shared).join("/")}/`,
        depth: shared === 0 ? 0 : 1,
      });
      open = parts;
    }
    rows.push({
      kind: "file",
      id: file.id,
      label: `${name} +${file.additions} -${file.deletions}`,
      depth: parts.length === 0 ? 0 : shared === 0 ? 1 : 2,
      fileIndex,
    });
  });
  return rows;
}
