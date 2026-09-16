import type { BoxProps } from "@opentui/react";

import { useThemeColor, useUi } from "./context.tsx";
import { resolveGlyph, type GlyphName } from "./glyphs.tsx";
import type { ThemeToken } from "./theme.ts";

export type StatusTone = "danger" | "info" | "muted" | "pending" | "success" | "warning";

const statusStyles: Readonly<
  Record<StatusTone, { readonly glyph: GlyphName; readonly token: ThemeToken }>
> = Object.freeze({
  danger: { glyph: "error", token: "danger" },
  info: { glyph: "info", token: "accent" },
  muted: { glyph: "empty", token: "muted" },
  pending: { glyph: "pending", token: "warning" },
  success: { glyph: "success", token: "success" },
  warning: { glyph: "warning", token: "warning" },
});

export interface StatusBadgeProps extends Omit<BoxProps, "children"> {
  readonly label: string;
  readonly tone: StatusTone;
}

export function StatusBadge({ label, tone, ...props }: StatusBadgeProps) {
  const { capabilities } = useUi();
  const style = statusStyles[tone];
  const color = useThemeColor(style.token);

  return (
    <box {...props} flexDirection="row" height={1}>
      <text {...(color ? { fg: color } : {})} truncate>
        {resolveGlyph(style.glyph, capabilities.unicode)} {label}
      </text>
    </box>
  );
}
