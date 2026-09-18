import stringWidth from "string-width";
import { normalizeTerminalText } from "../features/chat/terminalText.ts";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function inlineTerminalText(text: string): string {
  return normalizeTerminalText(text).replace(/\n/gu, " ");
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
