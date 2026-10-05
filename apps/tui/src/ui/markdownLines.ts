import { Lexer, type MarkedToken, type Token, type Tokens } from "marked";
import stringWidth from "string-width";

import { wrapTerminalSpans } from "./textLayout.ts";
import { normalizeTerminalText } from "../features/chat/terminalText.ts";
import type { ThemeToken } from "./theme.ts";
import { closedMermaidFence, mermaidDiagram } from "./mermaidDiagram.ts";

export interface MarkdownSpan {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly code?: boolean;
  readonly strikethrough?: boolean;
  readonly href?: string;
}
export interface MarkdownLine {
  readonly text: string;
  readonly spans: readonly MarkdownSpan[];
  readonly tone: ThemeToken;
  readonly strong: boolean;
}

function webUrl(text: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(text).protocol);
  } catch {
    return false;
  }
}

/** Detect before wrapping so every fragment retains the complete destination. */
function linkSpans(span: MarkdownSpan): MarkdownSpan[] {
  if (span.href) return [span];
  const result: MarkdownSpan[] = [];
  let offset = 0;
  for (const match of span.text.matchAll(/https?:\/\/[^\s<>"`]+/gu)) {
    let href = match[0].replace(/[.,;:!?]+$/u, "");
    while (href.endsWith(")") && href.split(")").length > href.split("(").length)
      href = href.slice(0, -1);
    href = href.replace(/[\]}]+$/u, "");
    if (!webUrl(href)) continue;
    if (match.index > offset) result.push({ ...span, text: span.text.slice(offset, match.index) });
    result.push({ ...span, text: href, href });
    offset = match.index + href.length;
  }
  if (offset < span.text.length) result.push({ ...span, text: span.text.slice(offset) });
  return result.length ? result : [span];
}

// No extensions are registered on this lexer; it emits the built-in token union.
const builtInTokens = (tokens: readonly Token[]) => tokens as readonly MarkedToken[];

type InlineStyle = Omit<MarkdownSpan, "text">;

function inline(tokens: readonly Token[], style: InlineStyle = {}): MarkdownSpan[] {
  return builtInTokens(tokens).flatMap((token): MarkdownSpan[] => {
    switch (token.type) {
      case "strong":
        return inline(token.tokens, { ...style, bold: true });
      case "em":
        return inline(token.tokens, { ...style, italic: true });
      case "del":
        return inline(token.tokens, { ...style, strikethrough: true });
      case "codespan":
        return linkSpans({ ...style, text: token.text, code: true });
      case "br":
        return [{ ...style, text: "\n" }];
      case "checkbox":
        return [{ ...style, text: token.checked ? "[x] " : "[ ] " }];
      case "link":
      case "image": {
        const href = webUrl(token.href) ? token.href : undefined;
        const label = inline(token.tokens, { ...style, ...(href ? { href } : {}) });
        if (token.type === "link" && token.text === token.href) return label;
        // Keep a readable destination alongside the label, including when no browser can open it.
        return [...label, { ...style, text: ` (${token.href})`, ...(href ? { href } : {}) }];
      }
      case "text":
        return token.tokens
          ? inline(token.tokens, style)
          : linkSpans({ ...style, text: token.text });
      case "escape":
        return [{ ...style, text: token.text }];
      default:
        return [{ ...style, text: token.raw }];
    }
  });
}

function physicalLines(spans: readonly MarkdownSpan[], width: number, words = true) {
  const paragraphs: MarkdownSpan[][] = [[]];
  for (const span of spans) {
    span.text.split("\n").forEach((text, index) => {
      if (index) paragraphs.push([]);
      if (text) paragraphs.at(-1)!.push({ ...span, text });
    });
  }
  return paragraphs.flatMap((paragraph) => wrapTerminalSpans(paragraph, width, words));
}

function line(
  spans: readonly MarkdownSpan[],
  tone: ThemeToken = "text",
  strong = false,
): MarkdownLine {
  return { text: spans.map((span) => span.text).join(""), spans, tone, strong };
}

function prefixLines(
  lines: readonly MarkdownLine[],
  first: string,
  rest = first,
  tone?: ThemeToken,
) {
  return lines.map((current, index) =>
    line(
      [{ text: index === 0 ? first : rest }, ...current.spans],
      tone ?? current.tone,
      current.strong,
    ),
  );
}

function tableLines(table: Tokens.Table, width: number): MarkdownLine[] {
  const rows = [table.header, ...table.rows].map((row, index) =>
    row.map((cell) => inline(cell.tokens, index === 0 ? { bold: true } : {})),
  );
  const columnCount = table.header.length;
  const available = width - 3 * (columnCount - 1);
  if (available < columnCount) {
    // Stack cells on very narrow terminals rather than clipping columns or their contents.
    if (!table.rows.length)
      return table.header.flatMap((cell) =>
        physicalLines(inline(cell.tokens, { bold: true }), width).map((spans) => line(spans)),
      );
    return table.rows.flatMap((row) =>
      row.flatMap((cell, index) =>
        physicalLines(
          [
            ...inline(table.header[index]!.tokens, { bold: true }),
            { text: ": " },
            ...inline(cell.tokens),
          ],
          width,
        ).map((spans) => line(spans)),
      ),
    );
  }
  const desired = table.header.map((_, index) =>
    Math.max(1, ...rows.map((row) => stringWidth(row[index]!.map((span) => span.text).join("")))),
  );
  const widths = desired.map((size) => Math.min(size, Math.floor(available / columnCount)));
  let remaining = available - widths.reduce((sum, size) => sum + size, 0);
  widths.forEach((size, index) => {
    const extra = Math.min(remaining, desired[index]! - size);
    widths[index] = size + extra;
    remaining -= extra;
  });
  const result: MarkdownLine[] = [];
  rows.forEach((row, rowIndex) => {
    const cells = row.map((spans, index) => physicalLines(spans, widths[index]!));
    const height = Math.max(...cells.map((cell) => cell.length));
    for (let rowLine = 0; rowLine < height; rowLine++) {
      const spans = cells.flatMap((cell, index) => {
        const content = cell[rowLine] ?? [];
        const padding = widths[index]! - stringWidth(content.map((span) => span.text).join(""));
        const align = table.align[index];
        const left = align === "right" ? padding : align === "center" ? Math.floor(padding / 2) : 0;
        return [
          ...(index ? [{ text: " │ " }] : []),
          { text: " ".repeat(left) },
          ...content,
          { text: " ".repeat(padding - left) },
        ];
      });
      result.push(line(spans));
    }
    if (rowIndex === 0)
      result.push(line([{ text: widths.map((size) => "─".repeat(size)).join("─┼─") }], "muted"));
  });
  return result;
}

function blocks(tokens: readonly Token[], width: number, unicode: boolean): MarkdownLine[] {
  const result: MarkdownLine[] = [];
  let previousRaw = "";
  let taskMarker: MarkdownSpan[] = [];
  const append = (
    spans: readonly MarkdownSpan[],
    tone: ThemeToken = "text",
    strong = false,
    words = true,
  ) => {
    result.push(...physicalLines(spans, width, words).map((spans) => line(spans, tone, strong)));
  };
  for (const token of builtInTokens(tokens)) {
    switch (token.type) {
      case "space": {
        const count =
          token.raw.split("\n").length - 1 - (result.length && !previousRaw.endsWith("\n") ? 1 : 0);
        for (let index = 0; index < count; index++) result.push(line([]));
        break;
      }
      case "heading":
        append(inline(token.tokens), "accent", true);
        break;
      case "paragraph":
      case "text":
        append([...taskMarker, ...(token.tokens ? inline(token.tokens) : [{ text: token.text }])]);
        taskMarker = [];
        break;
      case "code":
        if (token.lang?.trim().toLowerCase() === "mermaid" && closedMermaidFence(token.raw)) {
          const diagram = mermaidDiagram(token.text, unicode);
          if ("lines" in diagram && diagram.columns <= width) {
            append([{ text: "Mermaid" }], "muted", true);
            result.push(...diagram.lines.map((text) => line([{ text }])));
            break;
          }
          const reason =
            "reason" in diagram
              ? diagram.reason
              : `widen to ${diagram.columns} columns to view diagram; showing source`;
          append([{ text: `Mermaid · ${reason}` }], "muted", true);
        } else {
          append([{ text: token.lang || "Code" }], "muted", true);
        }
        append(linkSpans({ text: token.text, code: true }), "text", false, false);
        break;
      case "blockquote":
        result.push(
          ...prefixLines(
            blocks(token.tokens, Math.max(1, width - 2), unicode),
            width > 1 ? "│ " : "",
            undefined,
            "muted",
          ),
        );
        break;
      case "list":
        token.items.forEach((item, index) => {
          const prefix = token.ordered ? `${Number(token.start) + index}. ` : "• ";
          const visiblePrefix = stringWidth(prefix) < width ? prefix : "";
          const content = blocks(
            item.tokens,
            Math.max(1, width - stringWidth(visiblePrefix)),
            unicode,
          );
          result.push(
            ...prefixLines(content, visiblePrefix, " ".repeat(stringWidth(visiblePrefix))),
          );
        });
        break;
      case "checkbox":
        taskMarker = inline([token]);
        break;
      case "table":
        result.push(...tableLines(token, width));
        break;
      case "hr":
        append([{ text: "─".repeat(Math.min(40, width)) }], "muted");
        break;
      case "def":
        break;
      default:
        append([{ text: token.raw }]);
    }
    previousRaw = token.raw;
  }
  if (taskMarker.length) append(taskMarker);
  return result;
}

/** Keeps both display modes in history's physical-line coordinate system. */
export function markdownLines(
  source: string,
  width: number,
  renderMarkdown = true,
  unicode = true,
): MarkdownLine[] {
  const columns = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  const text = normalizeTerminalText(source);
  if (!renderMarkdown) {
    return text
      .split("\n")
      .flatMap((text) =>
        wrapTerminalSpans(linkSpans({ text }), columns, false).map((spans) => line(spans)),
      );
  }
  const trailing = /\n+$/u.exec(text)?.[0].length ?? 0;
  const result = blocks(Lexer.lex(text.replace(/\n+$/u, "")), columns, unicode);
  if (!result.length) result.push(line([]));
  for (let index = 0; index < trailing; index++) result.push(line([]));
  return result;
}
