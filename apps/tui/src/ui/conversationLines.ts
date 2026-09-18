import type { TimelineRow } from "../features/chat/timeline.ts";
import type { ThemeToken } from "./theme.ts";
import { inlineTerminalText, wrapTerminalLines } from "./textLayout.ts";

export interface ConversationLine {
  readonly id: string;
  readonly line: number;
  readonly text: string;
  readonly tone: ThemeToken;
  readonly strong: boolean;
}

export function conversationLines(
  rows: readonly TimelineRow[],
  width: number,
  expanded: boolean,
): readonly ConversationLine[] {
  return rows.flatMap((row) => {
    const error =
      row.kind === "error" ||
      (row.source === "activity" && (row.status === "failed" || row.status === "declined"));
    const tone: ThemeToken = error
      ? "danger"
      : row.kind === "user" || row.source === "checkpoint"
        ? "accent"
        : "muted";
    let texts: string[];
    if (row.source === "checkpoint") {
      const additions = row.files.reduce((sum, file) => sum + file.additions, 0);
      const deletions = row.files.reduce((sum, file) => sum + file.deletions, 0);
      texts =
        row.status === "ready"
          ? [
              `${row.text}  +${additions} -${deletions}`,
              ...row.files.flatMap((file) =>
                wrapTerminalLines(
                  `  ${file.path}  +${file.additions} -${file.deletions} (${file.kind})`,
                  width,
                ),
              ),
              "",
            ]
          : [`${row.text}: ${row.status}`, "  File counts unavailable.", ""];
    } else if (row.source === "activity") {
      if (!expanded && row.kind !== "tool" && !error) return [];
      const status =
        row.status === "inProgress" ? "running" : (row.status ?? (error ? "failed" : "tool"));
      const summary = [
        row.toolName,
        row.text,
        row.command && !row.text.includes(row.command) ? row.command : undefined,
      ]
        .filter(Boolean)
        .join(" - ");
      texts = [
        ...wrapTerminalLines(`[${status}] ${inlineTerminalText(summary)}`, width).slice(
          0,
          expanded ? undefined : 2,
        ),
        ...(row.files ?? []).flatMap((path) => wrapTerminalLines(`  File: ${path}`, width)),
        ...(expanded && row.detail
          ? wrapTerminalLines(row.detail, Math.max(1, width - 2)).map((text) => `  ${text}`)
          : []),
      ];
    } else {
      const label = row.kind === "user" ? "You" : row.kind === "assistant" ? "Assistant" : "System";
      texts = [
        label,
        ...wrapTerminalLines(row.text, Math.max(1, width - 2)).map((text) => `  ${text}`),
        "",
      ];
    }
    return texts.map((text, line) => ({
      id: row.id,
      line,
      text,
      tone: line === 0 ? tone : error ? "danger" : "text",
      strong: line === 0,
    }));
  });
}
