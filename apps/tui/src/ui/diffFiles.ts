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
