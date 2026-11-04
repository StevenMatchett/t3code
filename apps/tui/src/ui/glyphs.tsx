export type GlyphName =
  | "collapsed"
  | "connected"
  | "expanded"
  | "empty"
  | "error"
  | "info"
  | "pending"
  | "success"
  | "warning";

const unicodeGlyphs: Readonly<Record<GlyphName, string>> = Object.freeze({
  collapsed: "▸",
  connected: "●",
  expanded: "▾",
  empty: "◇",
  error: "×",
  info: "ℹ",
  pending: "…",
  success: "✓",
  warning: "!",
});

const asciiGlyphs: Readonly<Record<GlyphName, string>> = Object.freeze({
  collapsed: "+",
  connected: "*",
  expanded: "-",
  empty: "-",
  error: "X",
  info: "i",
  pending: "...",
  success: "OK",
  warning: "!",
});

export function resolveGlyph(name: GlyphName, unicode: boolean) {
  return unicode ? unicodeGlyphs[name] : asciiGlyphs[name];
}
