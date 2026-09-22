import stringWidth from "string-width";
import { normalizeTerminalText } from "../features/chat/terminalText.ts";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function inlineTerminalText(text: string): string {
  return normalizeTerminalText(text).replace(/\n/gu, " ");
}

/** Wraps a single styled paragraph, keeping words together across style boundaries. */
export function wrapTerminalSpans<T extends { readonly text: string }>(
  spans: readonly T[],
  columns: number,
  words = true,
): T[][] {
  const width = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
  if (stringWidth(spans.map((span) => span.text).join("")) <= width) return [[...spans]];
  const cells = spans.flatMap((span) =>
    Array.from(segmenter.segment(span.text), ({ segment }) => {
      const size = stringWidth(segment);
      return { span, text: size > width ? "?" : segment, size: Math.min(size, width) };
    }),
  );
  const lines: T[][] = [];
  let start = 0;
  while (start < cells.length) {
    let end = start;
    let used = 0;
    let boundary = -1;
    let hasWord = false;
    while (end < cells.length) {
      const cell = cells[end]!;
      if (words && cell.text === " " && hasWord && cells[end - 1]?.text !== " ") boundary = end;
      if (used + cell.size > width) break;
      if (cell.text !== " ") hasWord = true;
      used += cell.size;
      end += 1;
    }
    const overflow = end < cells.length;
    if (overflow && words && boundary > start) end = boundary;
    const line: T[] = [];
    let previous: T | undefined;
    for (let index = start; index < end; index += 1) {
      const cell = cells[index]!;
      if (previous === cell.span) {
        const last = line.length - 1;
        line[last] = { ...line[last]!, text: line[last]!.text + cell.text };
      } else line.push({ ...cell.span, text: cell.text });
      previous = cell.span;
    }
    lines.push(line);
    start = end;
    if (overflow && words) while (cells[start]?.text === " ") start += 1;
  }
  return lines;
}

export function wrapTerminalWords(text: string, columns: number): readonly string[] {
  return normalizeTerminalText(text)
    .split("\n")
    .flatMap((paragraph) =>
      wrapTerminalSpans([{ text: paragraph }], columns).map((line) =>
        line.map((span) => span.text).join(""),
      ),
    );
}

export function wrapTerminalLines(text: string, columns: number): readonly string[] {
  const width = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
  const lines: string[] = [];
  for (const paragraph of normalizeTerminalText(text).split("\n")) {
    if (/^[\u0020-\u007e]*$/u.test(paragraph)) {
      if (paragraph.length === 0) lines.push("");
      for (let index = 0; index < paragraph.length; index += width)
        lines.push(paragraph.slice(index, index + width));
      continue;
    }
    let line = "";
    let used = 0;
    for (const { segment } of segmenter.segment(paragraph)) {
      const size = stringWidth(segment);
      if (used + size > width && line.length > 0) {
        lines.push(line);
        line = "";
        used = 0;
      }
      line += size > width ? "?" : segment;
      used += Math.min(size, width);
    }
    lines.push(line);
  }
  return lines;
}
