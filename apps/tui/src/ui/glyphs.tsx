import type { TextProps } from "@opentui/react";

import { useThemeColor, useUi } from "./context.tsx";
import type { ThemeToken } from "./theme.ts";

export type GlyphName =
  | "chevronRight"
  | "empty"
  | "error"
  | "info"
  | "pending"
  | "success"
  | "warning";

const unicodeGlyphs: Readonly<Record<GlyphName, string>> = Object.freeze({
  chevronRight: "›",
  empty: "◇",
  error: "×",
  info: "ℹ",
  pending: "…",
  success: "✓",
  warning: "!",
});

const asciiGlyphs: Readonly<Record<GlyphName, string>> = Object.freeze({
  chevronRight: ">",
  empty: "-",
  error: "X",
  info: "i",
  pending: "...",
  success: "OK",
  warning: "!",
});

const glyphTokens: Readonly<Record<GlyphName, ThemeToken>> = Object.freeze({
  chevronRight: "muted",
  empty: "muted",
  error: "danger",
  info: "accent",
  pending: "warning",
  success: "success",
  warning: "warning",
});

export function resolveGlyph(name: GlyphName, unicode: boolean) {
  return unicode ? unicodeGlyphs[name] : asciiGlyphs[name];
}

export interface GlyphProps extends Omit<TextProps, "children" | "content" | "fg"> {
  readonly name: GlyphName;
  readonly tone?: ThemeToken;
}

export function Glyph({ name, tone, ...props }: GlyphProps) {
  const { capabilities } = useUi();
  const color = useThemeColor(tone ?? glyphTokens[name]);
  return (
    <text {...props} {...(color ? { fg: color } : {})}>
      {resolveGlyph(name, capabilities.unicode)}
    </text>
  );
}
