export type GlyphName =
  | "collapsed"
  | "connected"
  | "expanded"
  | "empty"
  | "error"
  | "info"
  | "pending"
  | "pin"
  | "pullRequest"
  | "stack"
  | "worktree"
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
  pin: "◆",
  pullRequest: "#",
  stack: "≡",
  worktree: "⑂",
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
  pin: "^",
  pullRequest: "#",
  stack: "=",
  worktree: "wt",
  success: "OK",
  warning: "!",
});

export function resolveGlyph(name: GlyphName, unicode: boolean) {
  return unicode ? unicodeGlyphs[name] : asciiGlyphs[name];
}
