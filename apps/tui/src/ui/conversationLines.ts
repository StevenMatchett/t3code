import type { TimelineRow } from "../features/chat/timeline.ts";
import type { ThemeToken } from "./theme.ts";
import { inlineTerminalText, wrapTerminalLines } from "./textLayout.ts";
import { markdownLines, type MarkdownSpan } from "./markdownLines.ts";

export interface ConversationLine {
  readonly id: string;
  readonly line: number;
  readonly text: string;
  readonly tone: ThemeToken;
  readonly strong: boolean;
  readonly shell?: boolean;
  readonly highlight?: boolean;
  readonly spans?: readonly MarkdownSpan[];
}

export function conversationLines(
  rows: readonly TimelineRow[],
  width: number,
  expanded: boolean,
): readonly ConversationLine[] {
  return rows.flatMap<ConversationLine>((row) => {
    if (row.source === "message" && row.kind === "assistant") {
      return [
        ...markdownLines(row.text, width),
        { text: "", spans: [], tone: "text" as const, strong: false },
      ].map((line, index) => ({ ...line, id: row.id, line: index }));
    }
    const error =
      row.kind === "error" ||
      (row.source === "activity" && (row.status === "failed" || row.status === "declined"));
    const tone: ThemeToken = error
      ? "danger"
      : row.source === "checkpoint"
        ? "accent"
        : row.kind === "user"
          ? "text"
          : "muted";
    let texts: string[];
    let shellLines = 0;
    let highlightedLines = 0;
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
      const summary = row.command ?? [row.toolName, row.text].filter(Boolean).join(" - ");
      const heading = wrapTerminalLines(`[${status}] ${inlineTerminalText(summary)}`, width).slice(
        0,
        expanded ? undefined : 2,
      );
      shellLines = row.command ? heading.length : 0;
      texts = [
        ...heading,
        ...(row.files ?? []).flatMap((path) => wrapTerminalLines(`  File: ${path}`, width)),
        ...(expanded && row.detail
          ? wrapTerminalLines(row.detail, Math.max(1, width - 2)).map((text) => `  ${text}`)
          : []),
      ];
    } else {
      const wrapped = wrapTerminalLines(
        row.text,
        Math.max(1, width - (row.kind === "user" ? 2 : 0)),
      );
      highlightedLines = row.kind === "user" ? wrapped.length : 0;
      texts = [...wrapped, ""];
    }
    return texts.map((text, line) => ({
      id: row.id,
      line,
      text,
      tone: line === 0 ? tone : error ? "danger" : "text",
      strong: line === 0 && row.kind !== "user",
      ...(line < shellLines ? { shell: true } : {}),
      ...(line < highlightedLines ? { highlight: true } : {}),
    }));
  });
}
