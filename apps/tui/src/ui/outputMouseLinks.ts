import { TextRenderable, type Renderable, type Selection } from "@opentui/core";
import stringWidth from "string-width";
import type { ConversationLine } from "./conversationLines.ts";

const outputLines = new WeakMap<Renderable, ConversationLine>();

/** Hit-test terminal cells so wide characters and wrapped URLs retain their destination. */
export function outputLinkAtColumn(line: ConversationLine, column: number): string | null {
  let offset = 0;
  for (const span of line.spans ?? []) {
    const start = offset;
    offset += stringWidth(span.text);
    if (column >= start && column < offset) return span.href ?? null;
  }
  return null;
}

export function registerOutputLine(renderable: TextRenderable, line: ConversationLine) {
  outputLines.set(renderable, line);
}

/** Resolve against rendered spans, including labels and fragments of wrapped URLs. */
export function outputMouseLinks(selection: Selection | null, lines: readonly ConversationLine[]) {
  if (!selection) return null;
  const links = new Set<string>();
  let hasOutput = false;
  for (const renderable of selection.selectedRenderables) {
    const line = outputLines.get(renderable);
    if (!line || !lines.includes(line) || !(renderable instanceof TextRenderable)) continue;
    const range = renderable.getSelection();
    if (!range || range.start === range.end) continue;
    hasOutput = true;
    let offset = 0;
    for (const span of line.spans ?? []) {
      const start = offset;
      // OpenTUI selection offsets count terminal cells, not UTF-16 code units.
      offset += stringWidth(span.text);
      if (span.href && range.start < offset && range.end > start) links.add(span.href);
    }
  }
  return hasOutput ? links : null;
}
