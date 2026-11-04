import { TextAttributes, type CapturedFrame, type RGBA } from "@opentui/core";

const escapeXml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const color = (value: RGBA) => `rgb(${value.toInts().slice(0, 3).join(",")})`;

/** Renders captured spans as an SVG, so frames can be converted into images people can review. */
export function frameToSvg(
  frame: CapturedFrame,
  {
    title,
    background = "#0d1117",
    foreground = "#8b949e",
    fontFamily = "DejaVu Sans Mono, Liberation Mono, monospace",
  }: {
    readonly title?: string;
    readonly background?: string;
    readonly foreground?: string;
    readonly fontFamily?: string;
  } = {},
) {
  const cell = 12;
  const line = 24;
  const padding = 24;
  const top = title ? 60 : padding;
  const width = frame.cols * cell + padding * 2;
  const height = frame.rows * line + top + padding;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<rect width="100%" height="100%" fill="${background}"/>`,
    ...(title
      ? [
          `<text x="24" y="32" font-family="${fontFamily}" font-size="16" fill="${foreground}">${escapeXml(title)}</text>`,
        ]
      : []),
    `<g font-family="${fontFamily}" font-size="20" xml:space="preserve">`,
  ];
  frame.lines.forEach((row, y) => {
    let column = 0;
    for (const span of row.spans) {
      const x = padding + column * cell;
      const py = top + y * line;
      const inverse = (span.attributes & TextAttributes.INVERSE) !== 0;
      const bg = inverse ? span.fg : span.bg;
      const fg = inverse ? span.bg : span.fg;
      if (bg.a > 0)
        parts.push(
          `<rect x="${x}" y="${py}" width="${span.width * cell}" height="${line}" fill="${color(bg)}"/>`,
        );
      if (span.text.trim())
        parts.push(
          `<text x="${x}" y="${py + 19}" fill="${color(fg)}" font-weight="${span.attributes & TextAttributes.BOLD ? "bold" : "normal"}"${span.attributes & TextAttributes.DIM ? ' opacity="0.6"' : ""}>${escapeXml(span.text)}</text>`,
        );
      column += span.width;
    }
  });
  return `${parts.join("\n")}</g></svg>`;
}
