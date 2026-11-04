export type DiffRowKind = "meta" | "hunk" | "add" | "del" | "context";

/** One line of a file's diff, with the line numbers a comment can point at. */
export interface DiffRow {
  readonly kind: DiffRowKind;
  /** The line as git printed it. */
  readonly raw: string;
  /** The code, without the +, -, or space that git prefixes. */
  readonly code: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

export function parseDiffRows(text: string): readonly DiffRow[] {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  return lines.map((raw): DiffRow => {
    const hunk = HUNK.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      return { kind: "hunk", raw, code: raw, oldLine: null, newLine: null };
    }
    if (raw.startsWith("diff --git")) inHunk = false;
    if (!inHunk || raw.startsWith("\\")) {
      return { kind: "meta", raw, code: raw, oldLine: null, newLine: null };
    }
    const code = raw.slice(1);
    if (raw.startsWith("+")) return { kind: "add", raw, code, oldLine: null, newLine: newLine++ };
    if (raw.startsWith("-")) return { kind: "del", raw, code, oldLine: oldLine++, newLine: null };
    return { kind: "context", raw, code, oldLine: oldLine++, newLine: newLine++ };
  });
}

export interface SplitDiffRow {
  readonly left: DiffRow | null;
  readonly right: DiffRow | null;
}

/** Pairs each run of removals with the additions after it, so a changed line reads across. */
export function splitDiffRows(rows: readonly DiffRow[]): readonly SplitDiffRow[] {
  const result: SplitDiffRow[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index]!;
    if (row.kind !== "del" && row.kind !== "add") {
      result.push({ left: row, right: row.kind === "context" ? row : null });
      index += 1;
      continue;
    }
    const removed: DiffRow[] = [];
    const added: DiffRow[] = [];
    while (rows[index]?.kind === "del") removed.push(rows[index++]!);
    while (rows[index]?.kind === "add") added.push(rows[index++]!);
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair += 1) {
      result.push({ left: removed[pair] ?? null, right: added[pair] ?? null });
    }
  }
  return result;
}
