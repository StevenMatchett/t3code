import stringWidth from "string-width";
import { normalizeTerminalText } from "../features/chat/terminalText.ts";
import type { ThemeToken } from "./theme.ts";

export interface MarkdownSpan {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly code?: boolean;
}
export interface MarkdownLine {
  readonly text: string;
  readonly spans: readonly MarkdownSpan[];
  readonly tone: ThemeToken;
  readonly strong: boolean;
}

function inline(text: string): MarkdownSpan[] {
  const pattern =
    /(`+)([^`]+?)\1|\*\*(.+?)\*\*|__(.+?)__|\*([^*]+?)\*|_([^_]+?)_|\[([^\]]+)\]\(([^)]+)\)/gu;
  const spans: MarkdownSpan[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) spans.push({ text: text.slice(offset, match.index) });
    if (match[2]) spans.push({ text: match[2], code: true });
    else if (match[3] || match[4]) spans.push({ text: match[3] ?? match[4]!, bold: true });
    else if (match[5] || match[6]) spans.push({ text: match[5] ?? match[6]!, italic: true });
    else spans.push({ text: `${match[7]} (${match[8]})` });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) spans.push({ text: text.slice(offset) });
  return spans;
}

/** Keeps Markdown layout in the same physical-line coordinate system as history scrolling. */
export function markdownLines(source: string, width: number): MarkdownLine[] {
  const columns = Math.max(1, width);
  const result: MarkdownLine[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let fence: string | null = null;
  for (const raw of normalizeTerminalText(source).split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/u.exec(raw);
    if (
      marker &&
      (!fence ||
        (marker[1]![0] === fence[0] && marker[1]!.length >= fence.length && !marker[2]!.trim()))
    ) {
      if (fence) {
        fence = null;
        continue;
      }
      fence = marker[1]!;
      result.push({
        text: marker[2]!.trim() || "Code",
        spans: [{ text: marker[2]!.trim() || "Code" }],
        tone: "muted",
        strong: true,
      });
      continue;
    }
    const heading = !fence ? /^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?$/u.exec(raw) : null;
    const quote = !fence && /^\s*>\s?/u.test(raw);
    const text = fence
      ? raw
      : heading
        ? heading[1]!
        : raw.replace(/^(\s*)[-*+]\s+/u, "$1• ").replace(/^\s*>\s?/u, "│ ");
    const spans = fence ? [{ text, code: true }] : inline(text);
    const tone: ThemeToken = heading ? "accent" : quote ? "muted" : "text";
    let current: MarkdownSpan[] = [];
    let used = 0;
    const flush = () => {
      result.push({
        text: current.map((span) => span.text).join(""),
        spans: current,
        tone,
        strong: !!heading,
      });
      current = [];
      used = 0;
    };
    for (const span of spans) {
      for (const { segment } of segmenter.segment(span.text)) {
        const size = stringWidth(segment);
        if (used + size > columns && used > 0) flush();
        const value = size > columns ? "?" : segment;
        const previous = current.at(-1);
        if (
          previous &&
          previous.bold === span.bold &&
          previous.italic === span.italic &&
          previous.code === span.code
        )
          current[current.length - 1] = { ...previous, text: previous.text + value };
        else current.push({ ...span, text: value });
        used += Math.min(size, columns);
      }
    }
    flush();
  }
  return result;
}
